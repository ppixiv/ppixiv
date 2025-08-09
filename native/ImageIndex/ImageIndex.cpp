// Perceptual image searching.
// 
// References:
// https://grail.cs.washington.edu/projects/query/mrquery.pdf
// Fast Multiresolution Image Querying
//
// http://iqdb.org/code/ - Written with reference to this implementation, but
// this implementation was rewritten to avoid the GPL.  The main thing iqdb
// does that isn't in the paper is bucketing each individual coefficient, instead
// of just positive and negative coefficients, which is taking advantage of the
// fact that the paper was written in 1995 and we can afford to do this now.
// The rest is stuff we don't need (mostly database code).
//
// This doesn't handle storing data.  We assume we can fit all images in memory
// (at under 300 bytes per image this is a safe assumption), and images are preloaded
// at startup.
// 
// Calls are locked to allow multiple threads to query in parallel.  Adding and removing
// data is exclusive and takes an exclusive lock.  These locks aren't fair since std::shared_mutex
// is incomplete, so readers can starve writers.
#include "ImageIndex.h"

#include <math.h>
#include <algorithm>
#include <queue>
#include <vector>
#include <unordered_set>
#include <list>

using namespace std;

namespace
{
    // Bucket weights.  This is from the "Scanned" weights table in the paper.
    const float BucketWeights[6][3] =
    {
        { 5.00f, 19.21f, 34.37f },
        { 0.83f,  1.26f,  0.36f },
        { 1.01f,  0.44f,  0.45f },
        { 0.52f,  0.53f,  0.14f },
        { 0.47f,  0.28f,  0.18f },
        { 0.30f,  0.14f,  0.27f },
    };
}

// ImageSignatureAndId just groups an image ID and a ImageSignature for convenience.
class ImageIndex::ImageSignatureAndId
{
public:
    ImageSignatureAndId(uint64_t id_, ImageSignature signature_):
        id(id_),
        signature(signature_)
    { }

    const uint64_t id;
    const ImageSignature signature;
};

// This stores a set of image IDs for each coefficient.
class ImageIndex::Buckets
{
public:
    // Add image to the buckets for each of its coefficients.
    void Add(shared_ptr<const ImageSignatureAndId> image, int color)
    {
        // Add this image to the bucket for each of its coefficients.
        for(int coeff: image->signature.Signature[color])
            buckets[coeff + maxCoeff].push_back(image);
    }

    // Remove the given image from all buckets.
    void Remove(shared_ptr<const ImageSignatureAndId> image, int color)
    {
        // This isn't efficient and would need to be done differently if we need
        // to remove batches of images.
        auto bucket = image->signature.Signature[color];
        for(int coeff: image->signature.Signature[color])
        {
            auto bucket = buckets[coeff + maxCoeff];
            auto it = find(bucket.begin(), bucket.end(), image);
            if(it != bucket.end())
                bucket.erase(it);
        }
    }

    // Return the list of image IDs that contain the given coefficient.
    const vector<shared_ptr<const ImageSignatureAndId>> &Get(int coeff) const
    {
        return buckets[coeff + maxCoeff];
    }

private:
    // Coefficients are offset by maxCoeff, so negative magnitudes are at the start.
    static const size_t maxCoeff = ImageSignature::ImageSize * ImageSignature::ImageSize;
    vector<shared_ptr<const ImageSignatureAndId>> buckets[maxCoeff*2];
};

ImageIndex::ImageIndex()
{
    for(int c = 0; c < 3; ++c)
        m_pBuckets[c] = make_shared<Buckets>();
}

// This is declared here to make sure the dtor knows how to free our internal
// classes.
ImageIndex::~ImageIndex()
{
}


void ImageIndex::AddImage(uint64_t id, const ImageSignature &signature)
{
    std::unique_lock L(lock);

    // If the image is already indexed, remove the old entry.
    RemoveImageLocked(id);

    // Wrap the ImageSignature in an ImageSignatureAndId, so we can get the image ID
    // back more easily.
    auto image = make_shared<ImageSignatureAndId>(id, signature);

    m_AllImages[id] = image;
    for(int channel = 0; channel < 3; ++channel)
        m_pBuckets[channel]->Add(image, channel);
}

bool ImageIndex::GetImage(uint64_t id, ImageSignature &signature)
{
    std::shared_lock L(lock);

    auto signaturePtr = GetSignatureLocked(id);
    if(signaturePtr == nullptr)
        return false;

    signature = signaturePtr->signature;
    return true;
}

void ImageIndex::RemoveImage(uint64_t id)
{
    std::unique_lock L(lock);
    RemoveImageLocked(id);
}

void ImageIndex::RemoveImageLocked(uint64_t id)
{
    auto signature = GetSignatureLocked(id);
    if(signature == nullptr)
        return;

    m_AllImages.erase(id);
    for(int channel = 0; channel < 3; ++channel)
        m_pBuckets[channel]->Remove(signature, channel);
}

// A shared or exclusive lock must be held on the lock.
bool ImageIndex::HasImage(uint64_t id) const
{
    std::shared_lock L(lock);
    return m_AllImages.find(id) != m_AllImages.end();
}

// A shared or exclusive lock must be held on the lock.
shared_ptr<const ImageIndex::ImageSignatureAndId> ImageIndex::GetSignatureLocked(uint64_t id) const
{
    auto it = m_AllImages.find(id);
    if(it == m_AllImages.end())
        return nullptr;
    else
        return it->second;
}

std::vector<ImageIndex::SearchResult> ImageIndex::ImageSearch(const ImageSignature &signature, int maxResults) const
{
    std::shared_lock L(lock);

    // The accumulated score for each image.  Higher scores are more similar.
    unordered_map<shared_ptr<const ImageSignatureAndId>, float> scores;

    // Compare the average color value of each image.  Images with closer average
    // color are more similar, so have a smaller starting score.
    for(const auto it: m_AllImages)
    {
        shared_ptr<const ImageSignatureAndId> img = it.second;

        float score = 0;
        for(int c = 0; c < 1; c++)
        {
            float difference = fabsf(img->signature.AverageColor[c] - signature.AverageColor[c]);
            score -= BucketWeights[0][c] * difference;
        }
        scores[img] = score;
    }

    // The total score that can be added back to an image in this search:
    float totalWeight = 0;

    // For each color channel:
    for(int c = 0; c < 3; c++)
    {
        // For each coefficient:
        for(int16_t coeff: signature.Signature[c])
        {
            // Get the bucket containing all images sharing this coefficient index.
            const vector<shared_ptr<const ImageSignatureAndId>> &bucket = m_pBuckets[c]->Get(coeff);

            // coeff is the index of the coefficient (x+y*Pixels), and negative
            // if the original value was negative.  Flip these back to positive, and
            // get the original coordinates back.
            uint16_t idx = abs(coeff);
            int coeffX = idx % ImageSignature::ImageSize;
            int coeffY = idx / ImageSignature::ImageSize;

            // Figure out which weight bin this coefficient is in, and get the weight
            // for this channel.
            int bin = min(max(coeffX, coeffY), 5);
            float weight = BucketWeights[bin][c];
            totalWeight += weight;

            // Increase the score of images that have this coefficient.
            for(const shared_ptr<const ImageSignatureAndId> &image: bucket)
                scores[image] += weight;
        }
    }

    // If totalWeight is 0, there were no matching coefficients at all and we have
    // no results.
    if(totalWeight == 0)
        return { };

    // A queue of (-score, image) to find the best scores.  The score is stored
    // inverted in this, so it keeps better scores instead of worse ones.
    priority_queue<pair<float, shared_ptr<const ImageSignatureAndId>>> bestResults;
    for(const auto it: m_AllImages)
    {
        shared_ptr<const ImageSignatureAndId> img = it.second;
        float score = scores[img];

        // If we have the maximum number of results, ignore images that are worse than
        // the first (worst) entry.
        if(bestResults.size() == maxResults)
        {
            // Skip images with a lower score.
            if(score < -bestResults.top().first)
                continue;

            // Delete the worst entry.
            bestResults.pop();
        }

        bestResults.emplace(-score, img);
    }

    vector<SearchResult> results;
    while(!bestResults.empty())
    {
        uint64_t id = bestResults.top().second->id;
        float unweightedScore = -bestResults.top().first;
        float score = unweightedScore / totalWeight;
        results.emplace_back(id, score, unweightedScore);
        bestResults.pop();
    }

    // Adding from the priority queue put lower scores first.  Reverse the results so
    // better matches are at the top.
    reverse(results.begin(), results.end());
    return results;
}

ImageIndex::SearchResult ImageIndex::CompareSignatures(const ImageSignature &signature1, const ImageSignature &signature2) const
{
    std::shared_lock L(lock);

    // Compare the average color value of each image.  Images with closer average
    // color are more similar, so have a smaller starting score.
    float unweightedScore = 0;
    for(int c = 0; c < 1; c++)
    {
        float difference = fabsf(signature1.AverageColor[c] - signature2.AverageColor[c]);
        unweightedScore -= BucketWeights[0][c] * difference;
    }

    // The total score that can be added back to an image in this search:
    float totalWeight = 0;

    // For each color channel:
    for(int c = 0; c < 3; c++)
    {
        // For each coefficient:
        for(int16_t coeff: signature1.Signature[c])
        {
            // coeff is the index of the coefficient (x+y*Pixels), and negative
            // if the original value was negative.  Flip these back to positive, and
            // get the original coordinates back.
            uint16_t idx = abs(coeff);
            int coeffX = idx % ImageSignature::ImageSize;
            int coeffY = idx / ImageSignature::ImageSize;

            // Figure out which weight bin this coefficient is in, and get the weight
            // for this channel.
            int bin = min(max(coeffX, coeffY), 5);
            float weight = BucketWeights[bin][c];
            totalWeight += weight;

            // Increase the score of images that have this coefficient.
            unweightedScore += weight;
        }
    }

    float finalScore = unweightedScore / totalWeight;
    return SearchResult(0, finalScore, unweightedScore);
}

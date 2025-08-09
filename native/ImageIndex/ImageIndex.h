#ifndef ImageIndex_H
#define ImageIndex_H

#include <vector>
#include <unordered_map>
#include <memory>
#include <shared_mutex>
#include <stdint.h>

#include "ImageSignature.h"

class ImageIndex
{
public:
    ImageIndex();
    ~ImageIndex();

    // Add and remove images.
    void AddImage(uint64_t id, const ImageSignature &signature);
    bool GetImage(uint64_t id, ImageSignature &signature);
    void RemoveImage(uint64_t id);

    // Return true if id is already registered.
    bool HasImage(uint64_t id) const;

    // A result from Index::ImageSearch.
    struct SearchResult
    {
        SearchResult(uint64_t id_, float score_, float unweightedScore_): id(id_), score(score_), unweightedScore(unweightedScore_) { }

        uint64_t id = 0;
        float score = 0;

        // The total score, without scaling the value back to 0-1.  This is mostly for
        // debugging.
        float unweightedScore = 0;
    };

    // Find images similar to the given signature.
    std::vector<SearchResult> ImageSearch(const ImageSignature &signature, int maxResults) const;
    SearchResult CompareSignatures(const ImageSignature &signature1, const ImageSignature &signature2) const;

private:
    class Buckets;
    class ImageSignatureAndId;

    void RemoveImageLocked(uint64_t id);
    std::shared_ptr<const ImageSignatureAndId> GetSignatureLocked(uint64_t id) const;

    std::unordered_map<uint64_t, std::shared_ptr<const ImageSignatureAndId>> m_AllImages;
    std::shared_ptr<Buckets> m_pBuckets[3];
    mutable std::shared_mutex lock;

    ImageIndex(const ImageIndex &rhs) = delete;
    ImageIndex &operator=(const ImageIndex &rhs) = delete;
};

#endif

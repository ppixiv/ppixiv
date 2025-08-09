#include "ImageIndexInterface.h"
#include "ImageIndex.h"
#include <algorithm>
using namespace std;

extern "C"
{

ImageIndex *ImageIndex_Create()
{
    return new ImageIndex;
}

void ImageIndex_Destroy(ImageIndex *idx)
{
    delete idx;
}

void ImageIndex_AddImage(ImageIndex *idx, uint64_t id, const ImageSignature *signature)
{
    idx->AddImage(id, *signature);
}

void ImageIndex_RemoveImage(ImageIndex *idx, uint64_t id)
{
    idx->RemoveImage(id);
}

bool ImageIndex_HasImage(ImageIndex *idx, uint64_t id)
{
    return idx->HasImage(id);
}

int ImageIndex_ImageSearch(ImageIndex *idx, const ImageSignature *signature, int maxResults, ImageIndex::SearchResult *results)
{
    auto data = idx->ImageSearch(*signature, maxResults);
    int size = min(maxResults, (int) data.size());
    for(int i = 0; i < size; ++i)
        results[i] = data[i];

    return (int) data.size();
}

void ImageIndex_CompareSignatures(ImageIndex *idx, const ImageSignature *signature1, const ImageSignature *signature2, ImageIndex::SearchResult *result)
{
    *result = idx->CompareSignatures(*signature1, *signature2);
}

void ImageSignature_FromImageData(ImageSignature *signature, const uint8_t *imageData)
{
    signature->FromImageData(imageData);
}

int ImageSignature_ImageSize() { return ImageSignature::ImageSize; }
int ImageSignature_Size() { return sizeof(ImageSignature); }

}

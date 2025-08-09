#ifndef ImageIndexInterface_h
#define ImageIndexInterface_h

#include <stdint.h>
#include "ImageIndex.h"

// A simple interface to ImageIndex.  This is just to make it easier to access
// with things like Python's ctypes, so we can access this without building language-
// specific modules.  If you're using this in native code, just use ImageIndex directly.
extern "C"
{
    __declspec(dllexport) ImageIndex *ImageIndex_Create();
    __declspec(dllexport) void ImageIndex_Destroy(ImageIndex *idx);
    __declspec(dllexport) void ImageIndex_AddImage(ImageIndex *idx, uint64_t id, const ImageSignature *signature);
    __declspec(dllexport) void ImageIndex_RemoveImage(ImageIndex *idx, uint64_t id);
    __declspec(dllexport) bool ImageIndex_HasImage(ImageIndex *idx, uint64_t id);

    // ids and scores must be big enough to hold maxResults.  Returns the number
    // of results.
    __declspec(dllexport) int ImageIndex_ImageSearch(ImageIndex *idx, const ImageSignature *signature, int maxResults, ImageIndex::SearchResult *results);
    __declspec(dllexport) void ImageIndex_CompareSignatures(ImageIndex *idx, const ImageSignature *signature1, const ImageSignature *signature2, ImageIndex::SearchResult *result);

    __declspec(dllexport) void ImageSignature_FromImageData(ImageSignature *signature, const uint8_t *imageData);
    __declspec(dllexport) int ImageSignature_ImageSize();
    __declspec(dllexport) int ImageSignature_Size();
}

#endif

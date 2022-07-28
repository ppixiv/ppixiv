#ifndef ImageSignature_H
#define ImageSignature_H

#include <stdint.h>

// This is a POD type, so it can be stored to disk without serialization if
// you don't care about compatibility across devices.
struct ImageSignature
{
    // The input image size.  This can be changed, but must be a power of two.
    static const int ImageSize = 128;

    // The number of coefficients to store.  40 matches the recommendation in
    // the original paper.
    static const int NumCoefficients = 40;

    // Compute the signature for an image.  imageData must be ImageSize*ImageSize*3,
    // in packed RGB order.
    void FromImageData(const uint8_t *imageData);

    // The average YIQ value across the image:
    float AverageColor[3];

    // The indices of the largest coefficients in the image, with larger
    // magnitude coefficients first.  If the original coefficient was
    // negative, the index will be negative.
    int16_t Signature[3][NumCoefficients];
};

#endif

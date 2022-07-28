#include "ImageSignature.h"
#include <math.h> 
#include <queue>
#include <vector>

using namespace std;

static void Transpose(float *data, int width, int height)
{
    vector<float> B(width*height);

    for(int y=0; y < height; y++)
        for(int x=0; x < width; x++)
            B[x*height + y] = data[x + y*width];

    memcpy(data, B.data(), sizeof(float)*width*height);
}

// Textbook 1D and 2D Haar transforms.
//
// A vector<float> buffer of size length is passed to the 1D versions, so
// these don't need to reallocate it for each row.
static void ForwardHaar(float *data, unsigned length, vector<float> &temp)
{
    for(unsigned i = 0; i < length; i++)
        data[i] /= sqrtf(float(length));

    while(length > 1)
    {
        length /= 2;

        for(unsigned i = 0; i < length; i++)
        {
            temp[i]          = (data[2*i] + data[2*i+1]) / sqrtf(2.0f);
            temp[i + length] = (data[2*i] - data[2*i+1]) / sqrtf(2.0f);
        }

        memcpy(data, temp.data(), length*2*sizeof(float));
    }
}

static void ForwardHaar2D(float *data, int width, int height)
{
    vector<float> temp(width);

    for(int y=0; y < height; y++) 
        ForwardHaar(data+y*width, unsigned(width), temp);

    Transpose(data, width, height);

    for(int x=0; x < width; x++) 
        ForwardHaar(data+x*height, unsigned(height), temp);

    Transpose(data, height, width);
}

// Find the values with the largest magnitude, storing their indices.  size is
// the number of values in data.  count is the number of values to find.  Negative
// values will have a negative index value.
static void FindLargestCoefficients(const float *data, int size, int count, int16_t *indices)
{
    // A queue of (magnitude, index) pairs.  Magnitude is stored inverted, so this
    // sorts lower values first.
    priority_queue<pair<float,int>> results;
    for(int i = 0; i < size; i++)
    {
        float d = fabsf(data[i]);

        // Once results has count results available, only store values which are better
        // than the worst entry.
        if(results.size() == count)
        {
            if(d <= -results.top().first)
                continue;

            // Remove the worst entry.
            results.pop();
        }

        results.emplace(-d, i);
    }

    // Pop the results.  Smaller coefficients are earlier in the queue, so this
    // will add weaker coefficients first.
    while(!results.empty())
    {
        int index = results.top().second;
        results.pop();

        *indices = index;

        // If the original coefficient was negative, make the index negative.
        if(data[index] <= 0)
            *indices *= -1;

        indices++;
    }
}

void ImageSignature::FromImageData(const uint8_t *imageData)
{
    // Split the image channels apart and convert to YIQ.
    vector<float> data[3];
    for(int i = 0; i < 3; ++i)
        data[i].resize(ImageSize*ImageSize);

    for(int idx = 0; idx < ImageSize*ImageSize; idx++)
    {
        float r = *imageData++;
        float g = *imageData++;
        float b = *imageData++;

        // Convert from RGB to YIQ.
        // https://en.wikipedia.org/wiki/YIQ#From_RGB_to_YIQ_2
        data[0][idx] = r*+0.2990f + g*+0.5870f + b*+0.1140f; // Y
        data[1][idx] = r*+0.5959f + g*-0.2746f + b*-0.3213f; // I
        data[2][idx] = r*+0.2115f + g*-0.5227f + b*+0.3112f; // Q
    }

    // Run the transform on each channel.
    for(int i = 0; i < 3; ++i)
    {
        vector<float> &channel = data[i];
        ForwardHaar2D(channel.data(), ImageSize, ImageSize);

        // The first coefficient is the average color of the image on this channel.  Scale
        // this down from 0-255 to 0-1 and store it in AverageColor.  (Should this scale by
        // 128 for the I and Q channels?)
        AverageColor[i] = channel[0] / 256;

        // Find the largest coefficients.  Skip the first coefficient that we stored above.
        FindLargestCoefficients(channel.data()+1, int(channel.size()-1), NumCoefficients, Signature[i]);

        // Smaller coefficients were added first, since they're at the start of the
        // queue.  Flip it around to put larger coefficients first, since it makes
        // more sense, and allows simply truncating the list if fewer coefficients
        // are wanted.
        reverse(Signature[i], Signature[i] + NumCoefficients);
    }
}

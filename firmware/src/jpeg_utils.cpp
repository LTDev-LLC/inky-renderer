#include "jpeg_utils.h"
#include "logger.h"

#include <Arduino.h>
#include <algorithm>
#include <vector>

// Configure STB to use PSRAM for large buffers
#define STBI_MALLOC ps_malloc
#define STBI_REALLOC ps_realloc
#define STBI_FREE free
#define STBI_NO_STDIO // Disable file IO (we use memory only)
#define STBIW_MALLOC ps_malloc
#define STBIW_REALLOC ps_realloc
#define STBIW_FREE free

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

namespace jpeg_utils {

// Probe the JPEG data to determine its kind
JpegKind probeKind(const uint8_t *data, size_t len) {
  // Validate Magic Number: 0xFF, 0xD8 (SOI - Start of Image)
  if (len < 4 || data[0] != 0xFF || data[1] != 0xD8)
    return JpegKind::INVALID;

  size_t pos = 2; // Start after SOI

  // Use pos + 1 < len to ensure we can at least read a marker byte safely
  while (pos + 1 < len) {
    // Search for the next marker indicator (0xFF)
    if (data[pos] != 0xFF) {
      ++pos;
      continue;
    }

    // Skip any padding 0xFF bytes WITH bounds checking
    while (pos < len && data[pos] == 0xFF) {
      ++pos;
    }

    // If we ran out of data while skipping padding
    if (pos >= len)
      return JpegKind::INVALID;

    // Read the marker byte
    uint8_t marker = data[pos++];

    // Check for "Stand-alone" markers (no length/payload follows them)
    if (marker == 0xD8 || marker == 0xD9 || (marker >= 0xD0 && marker <= 0xD7))
      continue;

    // Start of Scan (SOS). Marks the beginning of compressed image data
    // If we reach this without finding a SOF marker, the image is invalid
    // or we shouldn't attempt to parse further
    if (marker == 0xDA)
      return JpegKind::INVALID;

    // Ensure we have enough data to read the 2-byte length field
    if (pos + 1 >= len)
      return JpegKind::INVALID;

    // Read Segment Length (Big Endian)
    uint16_t segLen = (data[pos] << 8) | data[pos + 1];

    // Sanity check: Length includes the 2 bytes for the length field itself
    if (segLen < 2 || pos + segLen > len)
      return JpegKind::INVALID;

    pos += 2; // Advance past the length bytes

    // Check for Start Of Frame (SOF) markers [0xC0..0xCF]
    if (marker == 0xC0)
      return JpegKind::BASELINE;
    if (marker == 0xC2)
      return JpegKind::PROGRESSIVE;

    // Explicitly ignore DHT/JPG/DAC
    if (marker == 0xC4 || marker == 0xC8 || marker == 0xCC) {
      // Just a table definition; skip payload
    } else if (marker >= 0xC1 && marker <= 0xCF) {
      // It is a Start of Frame marker, but not C0 or C2
      return JpegKind::OTHER;
    }

    // Skip the segment payload to reach the next marker
    pos += segLen - 2;
  }

  return JpegKind::INVALID;
}
// Callback for stbi_write_jpg_to_func
void stbiWriteFunc(void *context, void *data, int size) {
  std::vector<uint8_t> *vec = static_cast<std::vector<uint8_t> *>(context);
  const uint8_t *bytes = static_cast<const uint8_t *>(data);
  vec->insert(vec->end(), bytes, bytes + size);
}

// Convert a progressive JPEG (or any supported format) to a baseline JPEG
PsramVector convertToBaseline(PsramVector source) {
  int w, h, c;

// Determine required channels based on hardware
// Inkplate 6COLOR needs 3 (RGB), standard Inkplate needs only 1 (Grayscale)
// Using 1 channel saves ~2MB of PSRAM for a 1200x825 image
#if defined(ARDUINO_INKPLATECOLOR)
  const int req_channels = 3;
  Logger::log(Logger::LOG_DEBUG, "STB: Mode RGB (Color)");
#else
  const int req_channels = 1;
  Logger::log(Logger::LOG_DEBUG, "STB: Mode Grayscale (Mono)");
#endif

  Logger::logf(Logger::LOG_DEBUG, "STB: Start. PSRAM Free: %d",
               ESP.getFreePsram());

  // Decode the image 'req_channels' forces STB to output 1 byte per pixel (if
  // 1) or 3 bytes (if 3)
  unsigned char *imgData = stbi_load_from_memory(source.data(), source.size(),
                                                 &w, &h, &c, req_channels);

  if (!imgData) {
    Logger::logf(Logger::LOG_ERROR, "STB Decode Failed: %s",
                 stbi_failure_reason());
    return {};
  }

  Logger::logf(Logger::LOG_DEBUG, "STB: Decoded %dx%d. PSRAM Free: %d", w, h,
               ESP.getFreePsram());

  // Free the source memory ASAP to make room for the encoder
  source.clear();
  source.shrink_to_fit();

  // Encode to Baseline JPEG
  PsramVector output;

  // Reserve estimated size (1/4 of raw)
  if (psramFound())
    output.reserve((w * h * req_channels) / 4);

  // Use req_channels here as well to match the decoded buffer
  int result = stbi_write_jpg_to_func(stbiWriteFunc, &output, w, h,
                                      req_channels, imgData, 85);

  // Free the raw image data
  free(imgData);

  if (!result) {
    Logger::log(Logger::LOG_ERROR, "STB Encode Failed");
    return {};
  }

  // Free excess capacity in the output vector before returning
  // This ensures the vector only takes up exactly what it needs, preventing
  // wasted heap/PSRAM when the vector is passed back to the caller
  output.shrink_to_fit();

  Logger::logf(Logger::LOG_DEBUG, "STB: Complete. Size: %d (PSRAM Free: %d)",
               output.size(), ESP.getFreePsram());
  return output;
}

} // namespace jpeg_utils

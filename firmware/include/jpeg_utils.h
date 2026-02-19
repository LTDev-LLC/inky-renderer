#ifndef JPEG_UTILS_H
#define JPEG_UTILS_H

#include "psram_allocator.h"
#include <cstddef>
#include <cstdint>
#include <vector>

namespace jpeg_utils {
// JPEG classifications
enum class JpegKind : uint8_t { INVALID = 0, BASELINE, PROGRESSIVE, OTHER };

// Inspect raw JPEG bytes and return its kind
JpegKind probeKind(const uint8_t *data, std::size_t len);

// Use PsramVector for input and output to ensure large images stay in
// PSRAM
PsramVector convertToBaseline(PsramVector source);

// Generic predicate: true if probeKind(...) == Kind
template <JpegKind Kind>
inline bool isKind(const uint8_t *data, std::size_t len) {
  return probeKind(data, len) == Kind;
}

// Templated to accept std::vector OR PsramVector
template <JpegKind Kind, typename Container>
inline bool isKind(const Container &buf) {
  return isKind<Kind>(buf.data(), buf.size());
}

// Convenience aliases (Now templates to support both vector types)
template <typename Container> inline bool isProgressive(const Container &b) {
  return isKind<JpegKind::PROGRESSIVE>(b);
}

template <typename Container> inline bool isBaseline(const Container &b) {
  return isKind<JpegKind::BASELINE>(b);
}

template <typename Container> inline bool isInvalid(const Container &b) {
  return isKind<JpegKind::INVALID>(b);
}

template <typename Container> inline bool isOther(const Container &b) {
  return isKind<JpegKind::OTHER>(b);
}
} // namespace jpeg_utils

#endif

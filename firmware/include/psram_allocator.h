#ifndef PSRAM_ALLOCATOR_H
#define PSRAM_ALLOCATOR_H

#include <Arduino.h>
#include <memory>
#include <vector>

// Custom allocator to force std::vector to use PSRAM (External SPI RAM).
template <class T> struct PsramAllocator {
  // Set the std::vector to use this allocator
  typedef T value_type;

  // Default constructor
  PsramAllocator() noexcept = default;

  // Copy constructor (from same type)
  PsramAllocator(const PsramAllocator &) noexcept = default;

  // Template copy constructor (from different type)
  // Necessary for std::vector interals that rebbind to different types
  template <class U>
  constexpr PsramAllocator(const PsramAllocator<U> &) noexcept {}

  // Rebind struct
  template <class U> struct rebind {
    typedef PsramAllocator<U> other;
  };

  // Allocate
  T *allocate(std::size_t n) {
    // Prevent overflow
    if (n > std::size_t(-1) / sizeof(T))
#if __cpp_exceptions
      throw std::bad_alloc();
#else
      return nullptr;
#endif

    // Force allocation in PSRAM
    if (auto p = static_cast<T *>(ps_malloc(n * sizeof(T))))
      return p;

    // Allocation failed
#if __cpp_exceptions
    throw std::bad_alloc();
#else
    return nullptr;
#endif
  }

  // Deallocate
  void deallocate(T *p, std::size_t) noexcept { free(p); }
};

// Boilerplate equality operators
template <class T, class U>
bool operator==(const PsramAllocator<T> &, const PsramAllocator<U> &) {
  return true;
}

template <class T, class U>
bool operator!=(const PsramAllocator<T> &, const PsramAllocator<U> &) {
  return false;
}

// Convenience alias
using PsramVector = std::vector<uint8_t, PsramAllocator<uint8_t>>;

#endif

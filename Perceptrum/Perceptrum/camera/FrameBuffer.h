#pragma once

#include <vector>
#include <mutex>
#include <condition_variable>
#include <optional>
#include <atomic>
#include <cstdint>
#include "Frame.h"

// Thread-safe, dynamically resizable ring buffer for frames.
class FrameBuffer {
public:
    explicit FrameBuffer(size_t capacity);

    // Push a frame into the buffer. Old frames may be overwritten if full.
    void push(Frame&& frame);

    // Blocking pop: waits until a frame is available or stop is requested.
    std::optional<Frame> pop();

    // Non-blocking pop: returns immediately.
    std::optional<Frame> tryPop();

    // Change buffer capacity (can be called by DynamicBufferEngine).
    void setCapacity(size_t newCapacity);

    size_t capacity() const;
    size_t size() const;
    std::uint64_t overwriteCount() const;

    void requestStop();

    void clearBuffer();

private:
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::vector<Frame> buffer_;
    size_t head_ = 0;
    size_t tail_ = 0;
    size_t count_ = 0;
    std::atomic<std::uint64_t> overwriteCount_{ 0 };
    std::atomic<bool> stopRequested_{ false };
};

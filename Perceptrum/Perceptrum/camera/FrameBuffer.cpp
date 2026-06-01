#include "FrameBuffer.h"
#include <algorithm>  // std::min
#include <utility>    // std::move

FrameBuffer::FrameBuffer(size_t capacity)
    : buffer_(capacity) {
}

void FrameBuffer::push(Frame&& frame) {
    std::unique_lock lock(mutex_);
    if (buffer_.empty()) {
        return;
    }

    buffer_[head_] = std::move(frame);
    head_ = (head_ + 1) % buffer_.size();

    if (count_ < buffer_.size()) {
        ++count_;
    }
    else {
        // Overwrite oldest frame
        overwriteCount_.fetch_add(1, std::memory_order_relaxed);
        tail_ = (tail_ + 1) % buffer_.size();
    }

    cv_.notify_one();
}

/*
std::optional<Frame> FrameBuffer::pop() {
    std::unique_lock lock(mutex_);
    if (!cv_.wait_for(lock, std::chrono::seconds(5), [this] {
        return count_ > 0 || stopRequested_.load();
        })) {
        return std::nullopt; // Timeout - retorna vazio
    }

    Frame frame = std::move(buffer_[tail_]);
    tail_ = (tail_ + 1) % buffer_.size();
    --count_;
    return frame;
}
*/


std::optional<Frame> FrameBuffer::pop() {
    std::unique_lock lock(mutex_);

    if (!cv_.wait_for(lock, std::chrono::seconds(5), [this] {
        return count_ > 0 || stopRequested_.load();
        })) {
        return std::nullopt; // timeout
    }

    // If we woke due to stopRequested_ but there is no data, do NOT pop.
    if (count_ == 0) {
        return std::nullopt;
    }

    Frame frame = std::move(buffer_[tail_]);
    tail_ = (tail_ + 1) % buffer_.size();
    --count_;
    return frame;
}



std::optional<Frame> FrameBuffer::tryPop() {
    std::unique_lock lock(mutex_);
    if (count_ == 0) {
        return std::nullopt;
    }

    Frame frame = std::move(buffer_[tail_]);
    tail_ = (tail_ + 1) % buffer_.size();
    --count_;
    return frame;
}

void FrameBuffer::setCapacity(size_t newCapacity) {
    std::unique_lock lock(mutex_);
    if (newCapacity == 0) {
        buffer_.clear();
        head_ = tail_ = count_ = 0;
        return;
    }

    // TODO: implement smarter resizing (preserve newest frames).
    std::vector<Frame> newBuffer(newCapacity);
    size_t toCopy = std::min(count_, newCapacity);
    for (size_t i = 0; i < toCopy; ++i) {
        size_t idx = (tail_ + i) % buffer_.size();
        newBuffer[i] = std::move(buffer_[idx]);
    }

    buffer_ = std::move(newBuffer);
    head_ = toCopy % buffer_.size();
    tail_ = 0;
    count_ = toCopy;
}

size_t FrameBuffer::capacity() const {
    std::scoped_lock lock(mutex_);
    return buffer_.size();
}

size_t FrameBuffer::size() const {
    std::scoped_lock lock(mutex_);
    return count_;
}

std::uint64_t FrameBuffer::overwriteCount() const {
    return overwriteCount_.load(std::memory_order_relaxed);
}

void FrameBuffer::requestStop() {
    stopRequested_.store(true);
    cv_.notify_all();
}


void FrameBuffer::clearBuffer() {
    std::unique_lock<std::mutex> lock(mutex_);
    if (buffer_.empty()) {
        head_ = tail_ = count_ = 0;
        return;
    }

    // Reinitialize storage to release queued Frame payloads immediately
    std::vector<Frame> fresh(buffer_.size());
    buffer_.swap(fresh);

    head_ = tail_ = count_ = 0;
}

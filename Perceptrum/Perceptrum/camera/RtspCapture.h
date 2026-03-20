#pragma once
#include <string>
#include <optional>
#include <chrono>
#include <opencv2/core.hpp>

// Forward decls to avoid leaking FFmpeg headers in your public header.
struct AVFormatContext;
struct AVCodecContext;
struct AVCodec;
struct AVFrame;
struct AVPacket;
struct SwsContext;

struct RtspOpenParams {
    std::string url;
    int open_timeout_ms = 60000;  // like stimeout
    int read_timeout_ms = 60000;  // like rw_timeout
    int max_delay_us = 5'000'000;
    int buffer_size_bytes = 4 * 1024 * 1024;
    bool force_tcp = true;
    bool enable_reconnect = true;
    int  reconnect_max_delay_s = 10;

    // liga modo low - cpu(skip frames)
    bool low_cpu_skip_nonref = false;
};

class RtspCapture {
public:
    RtspCapture() = default;
    ~RtspCapture();

    bool open(const RtspOpenParams& p);
    void close();

    // Returns true and fills mat (BGR) when a frame is read/decoded.
    // Returns false on EoF or fatal error (caller can decide to reopen).
    bool read(cv::Mat& outBgr);

    // consome 1 pacote por chamada; só converte pra BGR se wantBgr == true
    bool pump(bool wantBgr, cv::Mat * outBgr);

    // Force reopen with backoff; keeps last params.
    bool reopen();

    // Non-fatal errors will return false; check last error string.
    const std::string& lastError() const { return lastError_; }

private:
    bool openInternal();
    void freeAll();
    bool ensureSws(int srcW, int srcH, int srcPixFmt);

    // interrupt callback support
    static int interruptCallback(void* opaque);

private:
    RtspOpenParams params_;
    std::string lastError_;

    AVFormatContext* fmt_ = nullptr;
    AVCodecContext* dec_ = nullptr;
    AVCodec* codec_ = nullptr;
    AVFrame* frame_ = nullptr;
    AVPacket* pkt_ = nullptr;
    SwsContext* sws_ = nullptr;
    int              vstream_index_ = -1;

    // Stall/timeout handling
    std::chrono::steady_clock::time_point ioStart_;
    int64_t open_deadline_ns_ = 0;   // for interrupt callback
    int64_t read_deadline_ns_ = 0;

    // Cached output buffer
    cv::Mat bgr_;
};

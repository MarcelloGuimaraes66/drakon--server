#pragma once
#include <string>
#include <optional>
#include <chrono>
#include <opencv2/core.hpp>

// Forward decls to avoid leaking FFmpeg headers in your public header.
struct AVFormatContext;
struct AVCodecContext;
struct AVCodec;
struct AVCodecParameters;
struct AVFrame;
struct AVPacket;
struct SwsContext;
struct AVBufferRef;

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
    bool prefer_nvidia_decode = false;
    bool require_hardware_decode = false;
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

    // Consume one packet per call; convert to BGR only when requested.
    bool pump(bool wantBgr, cv::Mat* outBgr);

    // Force reopen with backoff; keeps last params.
    bool reopen();

    // Non-fatal errors will return false; check last error string.
    const std::string& lastError() const { return lastError_; }
    const std::string& activeAccelerationMode() const { return activeAccelerationMode_; }
    const std::string& activeAccelerationBackend() const { return activeAccelerationBackend_; }
    const std::string& accelerationReason() const { return accelerationReason_; }
    const std::string& configuredAccelerationBackend() const { return configuredHardwareBackend_; }
    const std::string& selectedHardwareDevice() const { return selectedHardwareDevice_; }
    const std::string& accelerationDebugTrace() const { return accelerationDebugTrace_; }

private:
    bool openInternal();
    void freeAll();
    bool openDecoderContext(const AVCodecParameters* par, const char* requestedHardwareBackend);
    bool configureHardwareDecode(const char* backendName);
    void appendAccelerationDebugTrace_(const std::string& message);
    bool ensureSws(int srcW, int srcH, int srcPixFmt);
    void noteDecodedFrameAcceleration();
    AVFrame* currentFrameForConversion();
    bool convertCurrentFrameToBgr(cv::Mat& outBgr);

    // interrupt callback support
    static int interruptCallback(void* opaque);

private:
    RtspOpenParams params_;
    std::string lastError_;

    AVFormatContext* fmt_ = nullptr;
    AVCodecContext* dec_ = nullptr;
    AVCodec* codec_ = nullptr;
    AVFrame* frame_ = nullptr;
    AVFrame* swFrame_ = nullptr;
    AVPacket* pkt_ = nullptr;
    SwsContext* sws_ = nullptr;
    AVBufferRef* hwDeviceCtx_ = nullptr;
    int              vstream_index_ = -1;
    int hwPixFmt_ = -1;
    int swsSrcPixFmt_ = -1;
    bool requestedGpuDecode_ = false;
    bool requireHardwareDecode_ = false;
    std::string activeAccelerationMode_{ "cpu" };
    std::string activeAccelerationBackend_;
    std::string accelerationReason_;
    std::string configuredHardwareBackend_;
    std::string selectedHardwareDevice_;
    std::string accelerationDebugTrace_;
    bool accelerationFrameModeRecorded_ = false;

    // Stall/timeout handling
    std::chrono::steady_clock::time_point ioStart_;
    int64_t open_deadline_ns_ = 0;   // for interrupt callback
    int64_t read_deadline_ns_ = 0;

    // Cached output buffer
    cv::Mat bgr_;
};

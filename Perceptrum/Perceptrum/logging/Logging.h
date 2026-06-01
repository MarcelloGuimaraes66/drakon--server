#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <exception>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

struct ErrorLogContext {
    std::string flow;
    std::string functionName;
    std::string operation;
    std::string contextJson;
};

struct LogItem {
    std::string cameraId;
    std::string line;      // already formatted line (includes \n)
    std::string rawMessage;
    std::string occurredAtIsoUtc;
    std::string level;
    ErrorLogContext errorContext;
    bool important = false;
};

struct CameraLogStream {
    std::ofstream stream;

    // periodic flush
    std::chrono::steady_clock::time_point lastFlush = std::chrono::steady_clock::now();
    int pendingLines = 0;

    // console throttling per camera (done in logger thread)
    std::chrono::steady_clock::time_point lastConsole = std::chrono::steady_clock::now();

    bool disabled = false;
    bool headerWritten = false;
};

struct ErrorExportItem {
    std::string sourceId;
    std::string level;
    std::string message;
    std::string occurredAtIsoUtc;
    ErrorLogContext context;
};

class Logger {
public:
    static Logger& instance();

    // Keeps your existing call sites
    void logDebug(const std::string& cameraId, const std::string& message);
    // Writes a DEBUG line without promoting it to ERROR/agent stream based on keyword heuristics.
    void logDebugNoEscalation(const std::string& cameraId, const std::string& message);
    // Writes a WARNING line and keeps it in the important/agent stream.
    void logWarning(const std::string& cameraId, const std::string& message);
    // Writes a structured ERROR line and schedules async export to the backend/db.
    void logError(
        const std::string& cameraId,
        const std::string& message,
        const ErrorLogContext& context = {}
    );
    void logException(
        const std::string& cameraId,
        const ErrorLogContext& context,
        const std::exception& ex
    );
    void logUnknownException(
        const std::string& cameraId,
        const ErrorLogContext& context
    );

    // (Optional) If you ever use it in the future
    void logCameraSample(const std::string& cameraId,
        long long frame_time_ms,
        double inferenceLatencyMs,
        double cpuMemPercent,
        double gpuMemPercent,
        double cpuUsagePercent,
        double gpuUsagePercent);

    // Call this once when exiting (after camera threads stop)
    void shutdown(int timeoutMs = 1500) noexcept;

private:
    Logger();
    ~Logger();

    Logger(const Logger&) = delete;
    Logger& operator=(const Logger&) = delete;

private:
    void workerLoop_() noexcept;
    void errorExportLoop_() noexcept;
    CameraLogStream* getOrCreateStream_(const std::string& cameraId) noexcept;

    void enqueue_(LogItem&& item) noexcept;
    void enqueueErrorExport_(ErrorExportItem&& item) noexcept;
    bool flushErrorBatch_(const std::vector<ErrorExportItem>& batch) noexcept;

private:
    std::atomic<bool> stopping_{ false };

    std::mutex qMutex_;
    std::condition_variable qCv_;
    std::deque<LogItem> q_;
    const size_t maxQueue_ = 20000; // bounded: never block real-time threads
    std::atomic<uint64_t> dropped_{ 0 };

    std::mutex errorQMutex_;
    std::condition_variable errorCv_;
    std::deque<ErrorExportItem> errorQ_;
    const size_t maxErrorQueue_ = 5000;
    std::atomic<uint64_t> droppedError_{ 0 };

    std::thread worker_;
    std::thread errorWorker_;

    // accessed only by worker thread (no extra locks needed)
    std::unordered_map<std::string, CameraLogStream> streams_;

    // base dir
    std::string logDir_ = "logs";
};

#include "Logging.h"

#include <algorithm>
#include <array>
#include <filesystem>
#include <iostream>
#include <cstdio>
#include <sstream>
#include <iomanip>
#include <ctime>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fs = std::filesystem;

static void safeCerr(const std::string& msg) noexcept {
    try { std::cerr << msg << "\n"; }
    catch (...) {}
}

Logger& Logger::instance() {
    static Logger inst;
    return inst;
}

Logger::Logger() {
    try {
        fs::create_directories(logDir_);
    }
    catch (const std::exception& ex) {
        safeCerr(std::string("[Logger] Failed to create logs directory: ") + ex.what());
    }
    catch (...) {
        safeCerr("[Logger] Failed to create logs directory: unknown exception");
    }

    // start worker
    worker_ = std::thread(&Logger::workerLoop_, this);
}

Logger::~Logger() {
    // NEVER hang in destructor. Best-effort stop with short timeout.
    shutdown(500);
}

void Logger::shutdown(int timeoutMs) noexcept {
    bool expected = false;
    if (!stopping_.compare_exchange_strong(expected, true)) {
        return; // already stopping
    }

    try {
        qCv_.notify_all();
    }
    catch (...) {}

    if (!worker_.joinable()) return;

#ifdef _WIN32
    // Wait with timeout; if it doesn't stop, detach so process can exit.
    HANDLE h = (HANDLE)worker_.native_handle();
    DWORD w = WaitForSingleObject(h, (DWORD)timeoutMs);
    if (w == WAIT_OBJECT_0) {
        try { worker_.join(); }
        catch (...) {}
    }
    else {
        try { worker_.detach(); }
        catch (...) {}
    }
#else
    // Non-Windows: no timed join available; detach to avoid shutdown hang.
    try { worker_.detach(); }
    catch (...) {}
#endif
}

void Logger::enqueue_(LogItem&& item) noexcept {
    if (stopping_.load()) return;

    try {
        std::unique_lock<std::mutex> lk(qMutex_, std::try_to_lock);
        if (!lk.owns_lock()) {
            // avoid blocking real-time threads
            dropped_.fetch_add(1);
            return;
        }

        if (q_.size() >= maxQueue_) {
            // drop oldest (or you can drop newest — either is fine)
            q_.pop_front();
            dropped_.fetch_add(1);
        }

        q_.push_back(std::move(item));
        qCv_.notify_one();
    }
    catch (...) {
        // never throw from logging
    }
}

static bool isImportantMsg(const std::string& s) {
    std::string lower = s;
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
        });

    static constexpr std::array<const char*, 19> kErrorTokens = {
        "error",
        "erro",
        "failed",
        "failure",
        "exception",
        "invalid",
        "cannot",
        "unable",
        "timeout",
        "timed out",
        "threw",
        "throw",
        "crash",
        "fatal",
        "denied",
        "refused",
        "offline",
        "unreachable",
        "falha"
    };

    for (const char* token : kErrorTokens) {
        if (lower.find(token) != std::string::npos) {
            return true;
        }
    }
    return false;
}

void Logger::logDebug(const std::string& cameraId, const std::string& message) {
    const bool important = isImportantMsg(message);

    // timestamp (HH:MM:SS)
    char buf[32]{};
    try {
        auto now = std::chrono::system_clock::now();
        std::time_t now_c = std::chrono::system_clock::to_time_t(now);
        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &now_c);
#else
        localtime_r(&now_c, &tm);
#endif
        std::strftime(buf, sizeof(buf), "%H:%M:%S", &tm);
    }
    catch (...) {
        std::snprintf(buf, sizeof(buf), "??:??:??");
    }

    std::string line;
    line.reserve(message.size() + 64);
    line += "[";
    line += buf;
    line += important ? "] [ERROR] " : "] [DEBUG] ";
    line += message;
    line += "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = std::move(line);
    item.important = important;

    enqueue_(std::move(item));
}

void Logger::logCameraSample(const std::string& cameraId,
    long long frame_time_ms,
    double inferenceLatencyMs,
    double cpuMemPercent,
    double gpuMemPercent,
    double cpuUsagePercent,
    double gpuUsagePercent)
{
    std::ostringstream oss;
    oss << std::left
        << std::setw(16) << frame_time_ms
        << std::setw(8) << cameraId
        << std::setw(12) << std::fixed << std::setprecision(1) << inferenceLatencyMs
        << std::setw(12) << std::setprecision(1) << cpuMemPercent
        << std::setw(12) << std::setprecision(1) << gpuMemPercent
        << std::setw(12) << std::setprecision(1) << cpuUsagePercent
        << std::setw(12) << std::setprecision(1) << gpuUsagePercent
        << "\n";

    LogItem item;
    item.cameraId = cameraId;
    item.line = oss.str();
    item.important = false;
    enqueue_(std::move(item));
}

CameraLogStream* Logger::getOrCreateStream_(const std::string& cameraId) noexcept {
    const std::string streamId = cameraId.empty() ? "agent" : cameraId;

    auto it = streams_.find(streamId);
    if (it != streams_.end()) return &it->second;

    CameraLogStream s;

    std::string filename = logDir_ + "/" + streamId + ".log";
    try {
        s.stream.open(filename, std::ios::app);
        if (!s.stream.is_open()) {
            s.disabled = true;
            safeCerr("[Logger] Failed to open log file: " + filename + " (disabled for stream " + streamId + ")");
        }
    }
    catch (...) {
        s.disabled = true;
        safeCerr("[Logger] Exception opening log file: " + filename + " (disabled for stream " + streamId + ")");
    }

    auto [insIt, _] = streams_.emplace(streamId, std::move(s));
    return &insIt->second;
}

static void writeSampleHeader(std::ofstream& out) {
    out << std::left
        << std::setw(16) << "frame_time_ms"
        << std::setw(8) << "camera"
        << std::setw(12) << "lat_ms"
        << std::setw(12) << "cpu_mem%"
        << std::setw(12) << "gpu_mem%"
        << std::setw(12) << "cpu%"
        << std::setw(12) << "gpu%"
        << "\n";
}

void Logger::workerLoop_() noexcept {
    std::vector<LogItem> batch;
    batch.reserve(512);

    while (!stopping_.load()) {
        batch.clear();

        // wait for work
        {
            std::unique_lock<std::mutex> lk(qMutex_);
            qCv_.wait_for(lk, std::chrono::milliseconds(200), [&] {
                return stopping_.load() || !q_.empty();
                });

            while (!q_.empty() && batch.size() < 512) {
                batch.push_back(std::move(q_.front()));
                q_.pop_front();
            }
        }

        if (batch.empty()) continue;

                // process batch (NO locks held here)
        for (auto& item : batch) {
            const std::string targetLogId =
                item.important ? "agent" : (item.cameraId.empty() ? "agent" : item.cameraId);

            CameraLogStream* s = getOrCreateStream_(targetLogId);
            if (!s || s->disabled || !s->stream.is_open()) continue;

            try {
                // If this file looks like sample log (you can remove this if you don't want headers)
                // Write header once if file is empty.
                if (!s->headerWritten) {
                    auto pos = s->stream.tellp();
                    if (pos == std::streampos(0)) {
                        // only if it's a new file
                        writeSampleHeader(s->stream);
                        s->stream.flush();
                    }
                    s->headerWritten = true;
                }

                if (item.important && !item.cameraId.empty() && item.cameraId != "agent") {
                    s->stream << "[src=" << item.cameraId << "] ";
                }
                s->stream << item.line;
                s->pendingLines++;

                auto now = std::chrono::steady_clock::now();
                if (s->pendingLines >= 50 || (now - s->lastFlush) > std::chrono::seconds(1)) {
                    s->stream.flush();
                    s->lastFlush = now;
                    s->pendingLines = 0;
                }

                // Console output for important logs only.
                if (item.important) {
                    const std::string sourceId = item.cameraId.empty() ? "agent" : item.cameraId;
                    std::cout << "[" << sourceId << "] " << item.line; // item.line already has \n
                }

            }
            catch (...) {
                s->disabled = true;
                safeCerr("[Logger] Exception writing log for stream " + targetLogId + " (disabled)");
            }
        }
    }

    // Best-effort flush on exit (won't be waited forever due to shutdown timeout)
    try {
        for (auto& kv : streams_) {
            auto& s = kv.second;
            if (s.stream.is_open()) {
                try { s.stream.flush(); }
                catch (...) {}
                try { s.stream.close(); }
                catch (...) {}
            }
        }
    }
    catch (...) {}
}

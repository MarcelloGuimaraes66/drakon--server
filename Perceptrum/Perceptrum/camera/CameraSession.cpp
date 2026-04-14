// CameraSession.cpp
#include "CameraSession.h"

#include <iostream>
#include <chrono>
#include <deque>
#include <thread>
#include <condition_variable>
#include <functional>
#define NOMINMAX
#include <windows.h>
#include <Psapi.h>
#include <Iphlpapi.h>
#include <Netioapi.h>
#include <Pdh.h>
#include <TlHelp32.h>
#include <ctime>

#pragma comment(lib, "iphlpapi.lib")
#pragma comment(lib, "pdh.lib")

#include "../logging/Logging.h"
#include "RtspCapture.h"
#include "MotionDetector.h"
#include "PerfMetrics.h"
#include <opencv2/opencv.hpp>



#include "../core/AgentCore.h"
#include "../core/TemporalEngine.h"
#include "../comm/BackendConfig.h"
#include "../comm/PairingClient.h"
#include "../generated/Branding.h"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <unordered_map>
#include <set>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <nlohmann/json.hpp>
#include <curl/curl.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <cctype>
#include <regex>

#include "../comm/TelegramNotifier.h"

using json = nlohmann::json;




namespace fs = std::filesystem;

static bool jsonBoolLikeCamera_(const nlohmann::json& value, bool fallback = false)
{
    try {
        if (value.is_boolean()) return value.get<bool>();
        if (value.is_number_integer()) return value.get<int>() != 0;
        if (value.is_number()) return std::abs(value.get<double>()) > 1e-9;
        if (value.is_string()) {
            std::string normalized = value.get<std::string>();
            std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
                });
            if (normalized == "1" || normalized == "true" || normalized == "yes" || normalized == "on") {
                return true;
            }
            if (normalized == "0" || normalized == "false" || normalized == "no" || normalized == "off") {
                return false;
            }
        }
    }
    catch (...) {
    }
    return fallback;
}

static bool isAlertChannelEnabledForAlgorithmCamera_(
    const AlgorithmConfig& algo,
    const std::string& channelName)
{
    if (!algo.alertChannels.is_object()) {
        return false;
    }

    const auto directIt = algo.alertChannels.find(channelName);
    if (directIt != algo.alertChannels.end()) {
        const nlohmann::json& channel = *directIt;
        if (channel.is_object() && channel.contains("enabled")) {
            return jsonBoolLikeCamera_(channel["enabled"], false);
        }
        return jsonBoolLikeCamera_(channel, false);
    }

    std::string normalizedChannel = channelName;
    std::transform(normalizedChannel.begin(), normalizedChannel.end(), normalizedChannel.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
        });
    for (auto it = algo.alertChannels.begin(); it != algo.alertChannels.end(); ++it) {
        std::string candidate = it.key();
        std::transform(candidate.begin(), candidate.end(), candidate.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
            });
        if (candidate != normalizedChannel) continue;
        if (it.value().is_object() && it.value().contains("enabled")) {
            return jsonBoolLikeCamera_(it.value()["enabled"], false);
        }
        return jsonBoolLikeCamera_(it.value(), false);
    }

    return false;
}

static std::wstring utf8ToWide(const std::string& str);
static std::string getExecutableDir();

struct TempOpenCvClipPathGuardCamera_ {
    std::string path;

    ~TempOpenCvClipPathGuardCamera_()
    {
        if (path.empty()) return;
        std::error_code ec;
        fs::remove(fs::path(path), ec);
    }
};

static bool openVideoCaptureForClipPathCamera_(
    const std::string& clipPath,
    cv::VideoCapture& outCap,
    std::string& outTempOpenPath,
    std::string* outErr = nullptr);

static constexpr auto kDashboardThumbnailIntervalCamera_ = std::chrono::seconds(3);
static bool buildFrameWindowCroppedClipWithFfmpegCamera_(
    const std::string& srcClipPath,
    const AlgorithmConfig::FrameWindowNorm& frameWindow,
    std::string& outClipPath,
    std::string* outErr = nullptr);
static bool extractBoundaryFrameToMatFromClipCamera_(
    const std::string& clipPath,
    bool useLastMoment,
    cv::Mat& outFrame,
    std::string* outErr = nullptr);
static bool detectMotionInAnyRegionFromStillPairCamera_(
    const cv::Mat& previousFrame,
    const cv::Mat& currentFrame,
    const std::vector<AlgorithmConfig::AnalysisRegion>& polygonRegions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds,
    std::string* outErr);

static std::string describeClipPathForLogsCamera_(const std::string& clipPath)
{
    if (clipPath.empty()) {
        return "<empty>";
    }

    std::error_code ec;
    const fs::path path(clipPath);
    const bool exists = fs::exists(path, ec) && !ec;
    const std::uintmax_t size = exists ? fs::file_size(path, ec) : 0;
    const bool hasSize = exists && !ec;
    return clipPath +
        " exists=" + std::string(exists ? "1" : "0") +
        " size=" + (hasSize ? std::to_string(size) : std::string("n/a"));
}

#ifdef _WIN32
static void ensureOpenCvVideoIoThreadReadyCamera_()
{
    thread_local bool attempted = false;
    if (attempted) return;
    attempted = true;

    const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(hr) && hr != S_FALSE && hr != RPC_E_CHANGED_MODE) {
        try {
            Logger::instance().logDebug(
                "CameraSession",
                "OpenCV video I/O CoInitializeEx failed hr=" + std::to_string(hr)
            );
        }
        catch (...) {
        }
    }
}
#else
static void ensureOpenCvVideoIoThreadReadyCamera_() {}
#endif

static bool waitForReadableClipPathCamera_(
    const std::string& clipPath,
    std::string* outErr = nullptr)
{
    constexpr int kMaxAttempts = 8;
    constexpr auto kRetryDelay = std::chrono::milliseconds(50);
    for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
        std::error_code ec;
        const fs::path path(clipPath);
        const bool exists = fs::exists(path, ec) && !ec;
        const std::uintmax_t size = exists ? fs::file_size(path, ec) : 0;
        if (exists && !ec && size > 0) {
            std::ifstream ifs(path, std::ios::binary);
            if (ifs.good()) {
                return true;
            }
        }
        if (attempt + 1 < kMaxAttempts) {
            std::this_thread::sleep_for(kRetryDelay);
        }
    }

    if (outErr) {
        *outErr = "clip not readable yet: " + describeClipPathForLogsCamera_(clipPath);
    }
    return false;
}

struct CaptureThreadMetricSample {
    std::string backendBaseUrl;
    std::string clientId;
    std::string exeToken;
    int cameraId = -1;
    std::string threadName;
    double cpuPercent = 0.0;
    std::uint64_t captureMemEstimatedBytes = 0;
    std::uint64_t processWorkingSetBytes = 0;
    std::uint64_t processPrivateBytes = 0;
    int queueDepth = 0;
    std::string sampledAtIso;
};

static std::string nowUtcIso8601Ms_() {
    SYSTEMTIME st{};
    GetSystemTime(&st);
    char buffer[48];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay),
        static_cast<unsigned>(st.wHour),
        static_cast<unsigned>(st.wMinute),
        static_cast<unsigned>(st.wSecond),
        static_cast<unsigned>(st.wMilliseconds)
    );
    return std::string(buffer);
}

static bool readProcessMemorySnapshot_(
    std::uint64_t& workingSetBytes,
    std::uint64_t& privateBytes)
{
    PROCESS_MEMORY_COUNTERS_EX pmc{};
    const BOOL ok = GetProcessMemoryInfo(
        GetCurrentProcess(),
        reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&pmc),
        sizeof(pmc)
    );
    if (!ok) {
        workingSetBytes = 0;
        privateBytes = 0;
        return false;
    }

    workingSetBytes = static_cast<std::uint64_t>(pmc.WorkingSetSize);
    privateBytes = static_cast<std::uint64_t>(pmc.PrivateUsage);
    return true;
}

static std::uint64_t steadyNowMs_() {
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count()
    );
}

static std::uint64_t steadyToMs_(const std::chrono::steady_clock::time_point& value) {
    return static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(value.time_since_epoch()).count()
    );
}

static double fpsFromHistory_(const std::deque<std::chrono::steady_clock::time_point>& history) {
    if (history.size() < 2) return 0.0;
    const auto span = std::chrono::duration<double>(history.back() - history.front()).count();
    if (span <= 0.0) return 0.0;
    return static_cast<double>(history.size() - 1) / span;
}

static void enqueueCaptureThreadMetricSample_(CaptureThreadMetricSample sample);

// Helper: same convention as FrameDiskWriter
static fs::path getInferenceTempDirForCameraId(const std::string& cameraId)
{
    fs::path base = AppBrand::inferenceLoopTempRoot();
    base /= "cam_" + cameraId;
    return base;
}

static std::string sanitizeCameraAgentEventToken_(const std::string& value)
{
    std::string out;
    out.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            out.push_back(static_cast<char>(std::tolower(ch)));
        }
        else if (ch == '_' || ch == '-') {
            out.push_back(static_cast<char>(ch));
        }
        else {
            out.push_back('_');
        }
    }
    if (out.empty()) return "camera_agent";
    return out;
}

static std::string buildCameraAgentRunId_(
    const CameraConfig& config,
    const AlgorithmConfig& algo)
{
    const std::string sessionToken =
        !config.cameraSessionId.empty()
            ? config.cameraSessionId
            : ("camera_" + sanitizeCameraAgentEventToken_(config.id));
    const std::string algoToken =
        algo.algorithmId > 0
            ? std::to_string(algo.algorithmId)
            : sanitizeCameraAgentEventToken_(algo.type);
    return sessionToken + ":camera_agent:" + algoToken;
}

static std::string buildCameraAgentResultEventId_(
    const std::string& agentRunId,
    const std::string& eventAtUtc,
    int frameIndex)
{
    const std::string timestampToken = sanitizeCameraAgentEventToken_(
        eventAtUtc.empty() ? nowUtcIso8601Ms_() : eventAtUtc
    );
    std::string eventId = agentRunId + ":result:" + timestampToken;
    if (frameIndex >= 0) {
        eventId += ":" + std::to_string(frameIndex);
    }
    return eventId;
}

static int normalizeRecordingProfileFps_(int fps);
static int captureProfileFpsForSeconds_(
    const std::vector<VideoCaptureProfile>& profiles,
    int clipSeconds);
static std::string captureProfilesLogString_(const std::vector<VideoCaptureProfile>& profiles);
static bool sameCaptureProfiles_(
    const std::vector<VideoCaptureProfile>& lhs,
    const std::vector<VideoCaptureProfile>& rhs);

static bool parseSegmentTsFromClipPathForInference_(
    const fs::path& clipPath,
    std::string& outStartTs,
    std::string& outEndTs)
{
    outStartTs.clear();
    outEndTs.clear();

    std::string name = clipPath.filename().string();
    const std::string processingSuffix = ".processing";
    if (name.size() > processingSuffix.size() &&
        name.rfind(processingSuffix) == (name.size() - processingSuffix.size()))
    {
        name = name.substr(0, name.size() - processingSuffix.size());
    }

    const auto dot = name.rfind('.');
    if (dot != std::string::npos) {
        name = name.substr(0, dot);
    }

    std::vector<std::string> parts;
    {
        std::stringstream ss(name);
        std::string tok;
        while (std::getline(ss, tok, '_')) parts.push_back(tok);
    }

    if (parts.size() < 6) return false;

    auto isDigitsLen = [](const std::string& s, size_t n) -> bool {
        if (s.size() != n) return false;
        return std::all_of(s.begin(), s.end(), [](unsigned char c) { return std::isdigit(c) != 0; });
    };

    if (!isDigitsLen(parts[1], 8) || !isDigitsLen(parts[2], 6) ||
        !isDigitsLen(parts[3], 8) || !isDigitsLen(parts[4], 6))
    {
        return false;
    }

    outStartTs = parts[1] + "_" + parts[2];
    outEndTs = parts[3] + "_" + parts[4];
    return true;
}

static bool convertCompactLocalTimestampToUtcIsoForInference_(
    const std::string& compactLocalTs,
    std::string& outUtcIso)
{
    outUtcIso.clear();
    if (compactLocalTs.size() != 15 || compactLocalTs[8] != '_') {
        return false;
    }

    std::tm tmLocal{};
    try {
        tmLocal.tm_year = std::stoi(compactLocalTs.substr(0, 4)) - 1900;
        tmLocal.tm_mon = std::stoi(compactLocalTs.substr(4, 2)) - 1;
        tmLocal.tm_mday = std::stoi(compactLocalTs.substr(6, 2));
        tmLocal.tm_hour = std::stoi(compactLocalTs.substr(9, 2));
        tmLocal.tm_min = std::stoi(compactLocalTs.substr(11, 2));
        tmLocal.tm_sec = std::stoi(compactLocalTs.substr(13, 2));
        tmLocal.tm_isdst = -1;
    }
    catch (...) {
        return false;
    }

    const std::time_t tt = std::mktime(&tmLocal);
    if (tt == static_cast<std::time_t>(-1)) {
        return false;
    }

    std::tm tmUtc{};
#ifdef _WIN32
    gmtime_s(&tmUtc, &tt);
#else
    gmtime_r(&tt, &tmUtc);
#endif
    char buf[32];
    if (std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tmUtc) == 0) {
        return false;
    }
    outUtcIso = std::string(buf);
    return true;
}

static bool parseSegmentUtcRangeFromClipPathForInference_(
    const fs::path& clipPath,
    std::string& outStartUtcIso,
    std::string& outEndUtcIso)
{
    outStartUtcIso.clear();
    outEndUtcIso.clear();

    std::string startLocalTs;
    std::string endLocalTs;
    if (!parseSegmentTsFromClipPathForInference_(clipPath, startLocalTs, endLocalTs)) {
        return false;
    }

    return convertCompactLocalTimestampToUtcIsoForInference_(startLocalTs, outStartUtcIso) &&
        convertCompactLocalTimestampToUtcIsoForInference_(endLocalTs, outEndUtcIso);
}

static bool isStrictSixtySecondClipForCore_(const std::string& clipPath)
{
    if (clipPath.empty()) return false;
    const fs::path p(clipPath);
    std::string file = p.filename().string();
    std::transform(file.begin(), file.end(), file.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    const std::string suffix = "_60s.mp4";
    if (suffix.size() > file.size() ||
        !std::equal(suffix.rbegin(), suffix.rend(), file.rbegin()))
    {
        return false;
    }

    std::string startTs;
    std::string endTs;
    if (!parseSegmentTsFromClipPathForInference_(p, startTs, endTs)) return false;
    return !startTs.empty() && !endTs.empty();
}

static std::string localDateTokenYYYYMMDD_()
{
    SYSTEMTIME st{};
    GetLocalTime(&st);
    char buffer[16];
    std::snprintf(
        buffer,
        sizeof(buffer),
        "%04u%02u%02u",
        static_cast<unsigned>(st.wYear),
        static_cast<unsigned>(st.wMonth),
        static_cast<unsigned>(st.wDay)
    );
    return std::string(buffer);
}



void CameraSession::setOwner(AgentCore* owner)
{
    owner_ = owner;

    frameDiskWriter_.setJobsCopyTargetsProvider([this]() -> std::vector<FrameDiskWriter::JobsCopyTarget> {
        if (!owner_) return {};

        int camId = 0;
        try { camId = std::stoi(config_.id); }
        catch (...) { return {}; }

        return owner_->getActiveJobStepsForCamera(camId);
    });

    frameDiskWriter_.setCaptureProfiles(getEffectiveRecordingProfiles_());



    /*
    // Wire predicate AFTER owner_ is known
    frameDiskWriter_.setJobsCopyPredicate([this]() -> bool {
        if (!owner_) return false;

        // config_.id is a string ("49"), JobRuntime/AgentCore uses int cameraId
        int camId = 0;
        try {
            camId = std::stoi(config_.id);
        }
        catch (...) {
            return false;
        }

        return owner_->isJobsCaptureEnabled(camId);
        });
    */
}

void CameraSession::setDirectServiceRequested(bool requested)
{
    directServiceRequested_.store(requested, std::memory_order_relaxed);
}

std::string CameraSession::currentStartOrigin_() const
{
    if (directServiceRequested_.load(std::memory_order_relaxed)) {
        return "direct";
    }

    if (config_.isDrakonFindTemporarySession || config_.isVideoSearchTemporarySession) {
        return config_.startOrigin;
    }

    int camId = 0;
    try {
        camId = std::stoi(config_.id);
    }
    catch (...) {
        camId = 0;
    }

    if (owner_ && camId > 0) {
        const auto activeJobIds = owner_->getActiveJobIdsForCamera(camId);
        if (!activeJobIds.empty()) {
            return "job";
        }
    }

    if (config_.startOrigin == "job") {
        return "job";
    }

    if (!config_.startOrigin.empty() && config_.startOrigin != "direct") {
        return config_.startOrigin;
    }

    return "";
}

bool CameraSession::shouldPublishDashboardThumbnail_() const
{
    if (!owner_) {
        return false;
    }

    if (!streamOnline_.load(std::memory_order_relaxed)) {
        return false;
    }

    if (config_.isDrakonFindTemporarySession || config_.isVideoSearchTemporarySession) {
        return false;
    }

    // Publish dashboard thumbnails for any non-temporary live session. Job-started
    // RTSP sessions also need thumbnail heartbeats so the UI can leave
    // "Reconnecting" and render the current preview.
    return true;
}

void CameraSession::maybePublishDashboardThumbnail_(
    const cv::Mat& frame,
    std::chrono::steady_clock::time_point now)
{
    if (frame.empty() || !shouldPublishDashboardThumbnail_()) {
        return;
    }

    if (lastThumbnailSent_.time_since_epoch().count() == 0) {
        lastThumbnailSent_ = now - kDashboardThumbnailIntervalCamera_;
    }

    if ((now - lastThumbnailSent_) < kDashboardThumbnailIntervalCamera_) {
        return;
    }

    sendThumbnail_(frame);
    lastThumbnailSent_ = now;
}

CameraSession::OpenMonitorSnapshot CameraSession::getOpenMonitorSnapshot() const
{
    OpenMonitorSnapshot snapshot;
    try {
        snapshot.cameraId = std::stoi(config_.id);
    }
    catch (...) {
        snapshot.cameraId = -1;
    }

    snapshot.cameraName = config_.name;
    snapshot.streamOnline = streamOnline_.load(std::memory_order_relaxed);
    snapshot.captureEnabled = captureEnabled_.load(std::memory_order_relaxed);
    snapshot.inferenceEnabled = inferenceEnabled_.load(std::memory_order_relaxed);
    snapshot.actualFps = telemetryActualFps_.load(std::memory_order_relaxed);
    snapshot.expectedFps = config_.expectedFps;
    snapshot.queueDepth = telemetryQueueDepth_.load(std::memory_order_relaxed);
    snapshot.overwrittenFrames = buffer_.overwriteCount();
    snapshot.reconnectCount = telemetryReconnectCount_.load(std::memory_order_relaxed);
    snapshot.width = telemetryFrameWidth_.load(std::memory_order_relaxed);
    snapshot.height = telemetryFrameHeight_.load(std::memory_order_relaxed);
    snapshot.useGpu = config_.useGpu;
    snapshot.captureThreadCpuPercent = telemetryCaptureThreadCpuPercent_.load(std::memory_order_relaxed);
    snapshot.captureMemEstimatedBytes = telemetryCaptureMemEstimatedBytes_.load(std::memory_order_relaxed);
    snapshot.processWorkingSetBytes = telemetryProcessWorkingSetBytes_.load(std::memory_order_relaxed);
    snapshot.processPrivateBytes = telemetryProcessPrivateBytes_.load(std::memory_order_relaxed);
    snapshot.captureReadLatencyTotalUs =
        telemetryCaptureReadLatencyTotalUs_.load(std::memory_order_relaxed);
    snapshot.captureReadSamples =
        telemetryCaptureReadSamples_.load(std::memory_order_relaxed);
    snapshot.decodeLatencyTotalUs =
        telemetryDecodeLatencyTotalUs_.load(std::memory_order_relaxed);
    snapshot.decodeSamples =
        telemetryDecodeSamples_.load(std::memory_order_relaxed);
    snapshot.diskReadBytesTotal =
        telemetryDiskReadBytesTotal_.load(std::memory_order_relaxed);
    snapshot.diskReadLatencyTotalUs =
        telemetryDiskReadLatencyTotalUs_.load(std::memory_order_relaxed);
    snapshot.diskReadOperations =
        telemetryDiskReadOperations_.load(std::memory_order_relaxed);
    snapshot.inferenceInputTotal =
        telemetryInferenceInputTotal_.load(std::memory_order_relaxed);
    snapshot.inferenceProcessedTotal =
        telemetryInferenceProcessedTotal_.load(std::memory_order_relaxed);
    snapshot.inferenceSuccessCount =
        telemetryInferenceSuccessCount_.load(std::memory_order_relaxed);
    snapshot.inferenceErrorCount =
        telemetryInferenceErrorCount_.load(std::memory_order_relaxed);

    const auto writerTelemetry = frameDiskWriter_.getIoTelemetrySnapshot();
    snapshot.diskWriteBytesTotal = writerTelemetry.bytesWrittenTotal;
    snapshot.diskWriteLatencyTotalUs = writerTelemetry.writeLatencyTotalUs;
    snapshot.diskWriteOperations = writerTelemetry.writeOperations;

    const std::uint64_t nowMs = steadyNowMs_();
    const std::uint64_t lastFrameMs = telemetryLastFrameTickMs_.load(std::memory_order_relaxed);
    snapshot.lastFrameAgeMs = (lastFrameMs > 0 && nowMs >= lastFrameMs) ? (nowMs - lastFrameMs) : 0;
    const std::uint64_t lastInferenceMs = telemetryLastInferenceTickMs_.load(std::memory_order_relaxed);
    snapshot.lastInferenceAgeMs =
        (lastInferenceMs > 0 && nowMs >= lastInferenceMs) ? (nowMs - lastInferenceMs) : 0;

    if (owner_ && snapshot.cameraId > 0) {
        snapshot.activeJobIds = owner_->getActiveJobIdsForCamera(snapshot.cameraId);
    }

    int enabledAlgorithmsCount = 0;
    for (const auto& algoType : config_.enabledAlgorithms) {
        if (!algoType.empty()) {
            enabledAlgorithmsCount += 1;
        }
    }
    snapshot.consumerCount = enabledAlgorithmsCount + static_cast<int>(snapshot.activeJobIds.size());
    return snapshot;
}




struct FaceTargetRef {
    int id = -1;
    std::string person_name;
    std::string person_description;
    std::string image_b64;
    std::string mime_type = "image/jpeg";
};

static std::vector<AlgorithmConfig::AnalysisRegion> collectPolygonRegionsForAlgo_(
    const AlgorithmConfig& algo)
{
    std::vector<AlgorithmConfig::AnalysisRegion> out;
    out.reserve(algo.analysisRegions.size());
    for (const auto& region : algo.analysisRegions) {
        if (!region.enabled) continue;
        if (region.fullFrame) continue;
        if (region.polygonNorm.size() < 3) continue;
        out.push_back(region);
    }
    return out;
}

static bool isFrameWindowActiveCamera_(const AlgorithmConfig::FrameWindowNorm& frameWindow)
{
    return frameWindow.enabled &&
        frameWindow.width > 1e-6 &&
        frameWindow.height > 1e-6 &&
        (frameWindow.x > 1e-6 ||
         frameWindow.y > 1e-6 ||
         frameWindow.width < (1.0 - 1e-6) ||
         frameWindow.height < (1.0 - 1e-6));
}

static AlgorithmConfig::FrameWindowNorm resolveFrameWindowForAlgoCamera_(
    const AlgorithmConfig& algo)
{
    for (const auto& region : algo.analysisRegions) {
        if (isFrameWindowActiveCamera_(region.frameWindowNorm)) {
            return region.frameWindowNorm;
        }
    }
    return AlgorithmConfig::FrameWindowNorm{};
}

static cv::Rect frameWindowToRectCamera_(
    const AlgorithmConfig::FrameWindowNorm& frameWindow,
    const cv::Size& size)
{
    if (size.width <= 0 || size.height <= 0) return cv::Rect();
    if (!isFrameWindowActiveCamera_(frameWindow)) {
        return cv::Rect(0, 0, size.width, size.height);
    }

    const double x1Norm = (std::max)(0.0, (std::min)(1.0, frameWindow.x));
    const double y1Norm = (std::max)(0.0, (std::min)(1.0, frameWindow.y));
    const double x2Norm = (std::max)(x1Norm, (std::min)(1.0, frameWindow.x + frameWindow.width));
    const double y2Norm = (std::max)(y1Norm, (std::min)(1.0, frameWindow.y + frameWindow.height));

    int x1 = static_cast<int>(std::floor(x1Norm * static_cast<double>(size.width)));
    int y1 = static_cast<int>(std::floor(y1Norm * static_cast<double>(size.height)));
    int x2 = static_cast<int>(std::ceil(x2Norm * static_cast<double>(size.width)));
    int y2 = static_cast<int>(std::ceil(y2Norm * static_cast<double>(size.height)));

    x1 = (std::max)(0, (std::min)(size.width - 1, x1));
    y1 = (std::max)(0, (std::min)(size.height - 1, y1));
    x2 = (std::max)(x1 + 1, (std::min)(size.width, x2));
    y2 = (std::max)(y1 + 1, (std::min)(size.height, y2));

    return cv::Rect(x1, y1, x2 - x1, y2 - y1);
}

static cv::Mat cropFrameToFrameWindowCamera_(
    const cv::Mat& frame,
    const AlgorithmConfig::FrameWindowNorm& frameWindow,
    cv::Rect* outCropRect = nullptr)
{
    if (frame.empty()) return cv::Mat();
    const cv::Rect cropRect = frameWindowToRectCamera_(frameWindow, frame.size());
    if (outCropRect) *outCropRect = cropRect;
    if (cropRect.width <= 0 || cropRect.height <= 0) return cv::Mat();
    return frame(cropRect).clone();
}

static std::vector<AlgorithmConfig::AnalysisRegionPoint> clipPolygonToFrameWindowCamera_(
    const std::vector<AlgorithmConfig::AnalysisRegionPoint>& polygon,
    const AlgorithmConfig::FrameWindowNorm& frameWindow)
{
    using Point = AlgorithmConfig::AnalysisRegionPoint;
    if (!isFrameWindowActiveCamera_(frameWindow) || polygon.size() < 3) {
        return polygon;
    }

    const double minX = (std::max)(0.0, (std::min)(1.0, frameWindow.x));
    const double minY = (std::max)(0.0, (std::min)(1.0, frameWindow.y));
    const double maxX = (std::max)(minX, (std::min)(1.0, frameWindow.x + frameWindow.width));
    const double maxY = (std::max)(minY, (std::min)(1.0, frameWindow.y + frameWindow.height));

    auto intersectAtX = [](const Point& a, const Point& b, double x) -> Point {
        const double dx = b.x - a.x;
        if (std::abs(dx) <= 1e-9) {
            return Point{ x, a.y };
        }
        const double t = (x - a.x) / dx;
        return Point{ x, a.y + ((b.y - a.y) * t) };
    };
    auto intersectAtY = [](const Point& a, const Point& b, double y) -> Point {
        const double dy = b.y - a.y;
        if (std::abs(dy) <= 1e-9) {
            return Point{ a.x, y };
        }
        const double t = (y - a.y) / dy;
        return Point{ a.x + ((b.x - a.x) * t), y };
    };
    auto clipEdge = [](const std::vector<Point>& input, const auto& inside, const auto& intersect) {
        std::vector<Point> output;
        if (input.empty()) return output;
        output.reserve(input.size() + 4);

        Point prev = input.back();
        bool prevInside = inside(prev);
        for (const auto& curr : input) {
            const bool currInside = inside(curr);
            if (currInside) {
                if (!prevInside) {
                    output.push_back(intersect(prev, curr));
                }
                output.push_back(curr);
            }
            else if (prevInside) {
                output.push_back(intersect(prev, curr));
            }
            prev = curr;
            prevInside = currInside;
        }
        return output;
    };

    std::vector<Point> clipped = polygon;
    clipped = clipEdge(
        clipped,
        [&](const Point& p) { return p.x >= minX; },
        [&](const Point& a, const Point& b) { return intersectAtX(a, b, minX); }
    );
    clipped = clipEdge(
        clipped,
        [&](const Point& p) { return p.x <= maxX; },
        [&](const Point& a, const Point& b) { return intersectAtX(a, b, maxX); }
    );
    clipped = clipEdge(
        clipped,
        [&](const Point& p) { return p.y >= minY; },
        [&](const Point& a, const Point& b) { return intersectAtY(a, b, minY); }
    );
    clipped = clipEdge(
        clipped,
        [&](const Point& p) { return p.y <= maxY; },
        [&](const Point& a, const Point& b) { return intersectAtY(a, b, maxY); }
    );
    return clipped;
}

static std::vector<AlgorithmConfig::AnalysisRegion> remapRegionsToFrameWindowCamera_(
    const std::vector<AlgorithmConfig::AnalysisRegion>& regions,
    const AlgorithmConfig::FrameWindowNorm& frameWindow)
{
    if (!isFrameWindowActiveCamera_(frameWindow)) return regions;

    std::vector<AlgorithmConfig::AnalysisRegion> out;
    out.reserve(regions.size());
    const double invWidth = frameWindow.width > 1e-6 ? (1.0 / frameWindow.width) : 1.0;
    const double invHeight = frameWindow.height > 1e-6 ? (1.0 / frameWindow.height) : 1.0;

    for (const auto& region : regions) {
        AlgorithmConfig::AnalysisRegion next = region;
        next.frameWindowNorm = AlgorithmConfig::FrameWindowNorm{};
        if (!next.fullFrame && !next.polygonNorm.empty()) {
            auto clippedPolygon = clipPolygonToFrameWindowCamera_(next.polygonNorm, frameWindow);
            if (clippedPolygon.size() < 3) {
                continue;
            }
            for (auto& point : clippedPolygon) {
                point.x = (std::max)(0.0, (std::min)(1.0, (point.x - frameWindow.x) * invWidth));
                point.y = (std::max)(0.0, (std::min)(1.0, (point.y - frameWindow.y) * invHeight));
            }
            next.polygonNorm = std::move(clippedPolygon);
        }
        out.push_back(std::move(next));
    }
    return out;
}

std::string base64_encode(const unsigned char* bytes_to_encode, size_t in_len);

static bool encodeFrameToJpegDataUrlCamera_(
    const cv::Mat& frame,
    std::string& outDataUrl)
{
    outDataUrl.clear();
    if (frame.empty()) return false;
    std::vector<uchar> jpegBytes;
    if (!cv::imencode(".jpg", frame, jpegBytes) || jpegBytes.empty()) {
        return false;
    }
    outDataUrl =
        std::string("data:image/jpeg;base64,") +
        base64_encode(jpegBytes.data(), jpegBytes.size());
    return !outDataUrl.empty();
}

static bool buildCroppedClipForFrameWindowCamera_(
    const std::string& srcClipPath,
    const AlgorithmConfig::FrameWindowNorm& frameWindow,
    std::string& outClipPath,
    std::string* outErr = nullptr)
{
    return buildFrameWindowCroppedClipWithFfmpegCamera_(
        srcClipPath,
        frameWindow,
        outClipPath,
        outErr
    );
}

static std::vector<cv::Point> regionPolygonToPixelsForCamera_(
    const AlgorithmConfig::AnalysisRegion& region,
    const cv::Size& size)
{
    std::vector<cv::Point> polygon;
    if (size.width <= 0 || size.height <= 0) return polygon;
    polygon.reserve(region.polygonNorm.size());
    const int maxX = (std::max)(0, size.width - 1);
    const int maxY = (std::max)(0, size.height - 1);
    for (const auto& p : region.polygonNorm) {
        const double nx = std::max(0.0, std::min(1.0, p.x));
        const double ny = std::max(0.0, std::min(1.0, p.y));
        int x = static_cast<int>(std::round(nx * maxX));
        int y = static_cast<int>(std::round(ny * maxY));
        x = (std::max)(0, (std::min)(maxX, x));
        y = (std::max)(0, (std::min)(maxY, y));
        polygon.emplace_back(x, y);
    }
    return polygon;
}

static cv::Scalar regionOverlayColorByIndexCamera_(std::size_t index)
{
    static const cv::Scalar palette[] = {
        cv::Scalar(255, 170, 64),
        cv::Scalar(110, 200, 255),
        cv::Scalar(120, 255, 170),
        cv::Scalar(190, 140, 255),
        cv::Scalar(255, 120, 180),
        cv::Scalar(140, 255, 255)
    };
    return palette[index % (sizeof(palette) / sizeof(palette[0]))];
}

static int drawAnalysisOverlaysOnFrameCamera_(
    cv::Mat& frame,
    const std::vector<AlgorithmConfig::AnalysisRegion>& polygonRegions,
    std::vector<std::string>* outDrawnRegionIds)
{
    if (frame.empty() || polygonRegions.empty()) return 0;
    cv::Mat overlay = frame.clone();
    int drawn = 0;
    if (outDrawnRegionIds) outDrawnRegionIds->clear();

    for (std::size_t i = 0; i < polygonRegions.size(); ++i) {
        const auto& region = polygonRegions[i];
        const auto polygon = regionPolygonToPixelsForCamera_(region, frame.size());
        if (polygon.size() < 3) continue;
        const cv::Scalar color = regionOverlayColorByIndexCamera_(i);
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::fillPoly(overlay, polygons, color, cv::LINE_AA);
        drawn++;
        if (outDrawnRegionIds && !region.regionId.empty()) {
            outDrawnRegionIds->push_back(region.regionId);
        }
    }

    if (drawn <= 0) return 0;
    cv::addWeighted(overlay, 0.20, frame, 0.80, 0.0, frame);

    for (std::size_t i = 0; i < polygonRegions.size(); ++i) {
        const auto& region = polygonRegions[i];
        const auto polygon = regionPolygonToPixelsForCamera_(region, frame.size());
        if (polygon.size() < 3) continue;

        const cv::Scalar color = regionOverlayColorByIndexCamera_(i);
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::polylines(frame, polygons, true, color, 2, cv::LINE_AA);
        for (const auto& pt : polygon) {
            cv::circle(frame, pt, 4, color, cv::FILLED, cv::LINE_AA);
        }

        std::string label = region.label;
        if (label.empty()) label = region.regionId;
        if (label.empty()) continue;

        cv::Point anchor = polygon.front();
        int baseline = 0;
        const double fontScale = 0.62;
        const int thickness = 2;
        const cv::Size textSize =
            cv::getTextSize(label, cv::FONT_HERSHEY_SIMPLEX, fontScale, thickness, &baseline);

        int boxLeft = anchor.x - (textSize.width / 2);
        int boxTop = anchor.y - textSize.height - 8;
        boxLeft = (std::max)(0, (std::min)(boxLeft, frame.cols - textSize.width - 12));
        boxTop = (std::max)(0, (std::min)(boxTop, frame.rows - textSize.height - 12));

        cv::Rect labelRect(
            boxLeft,
            boxTop,
            textSize.width + 12,
            textSize.height + 10);

        cv::rectangle(frame, labelRect, cv::Scalar(18, 24, 40), cv::FILLED, cv::LINE_AA);
        cv::rectangle(frame, labelRect, color, 1, cv::LINE_AA);

        cv::Point textOrg(labelRect.x + 6, labelRect.y + labelRect.height - 6);
        cv::putText(
            frame,
            label,
            textOrg,
            cv::FONT_HERSHEY_SIMPLEX,
            fontScale,
            cv::Scalar(245, 248, 255),
            thickness,
            cv::LINE_AA
        );
    }

    return drawn;
}

static bool detectMotionInAnyRegionFromClipCamera_(
    const std::string& clipPath,
    const std::vector<AlgorithmConfig::AnalysisRegion>& polygonRegions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds,
    std::string* outErr)
{
    outMotion = false;
    if (outTriggeredRegionIds) outTriggeredRegionIds->clear();
    if (polygonRegions.empty()) {
        outMotion = true;
        return true;
    }

    cv::Mat firstFrame;
    if (!extractBoundaryFrameToMatFromClipCamera_(clipPath, false, firstFrame, outErr) ||
        firstFrame.empty())
    {
        return false;
    }

    cv::Mat lastFrame;
    if (!extractBoundaryFrameToMatFromClipCamera_(clipPath, true, lastFrame, outErr) ||
        lastFrame.empty())
    {
        return false;
    }
    return detectMotionInAnyRegionFromStillPairCamera_(
        firstFrame,
        lastFrame,
        polygonRegions,
        outMotion,
        outTriggeredRegionIds,
        outErr
    );
}

static bool detectMotionInAnyRegionFromStillPairCamera_(
    const cv::Mat& previousFrame,
    const cv::Mat& currentFrame,
    const std::vector<AlgorithmConfig::AnalysisRegion>& polygonRegions,
    bool& outMotion,
    std::vector<std::string>* outTriggeredRegionIds,
    std::string* outErr)
{
    outMotion = false;
    if (outTriggeredRegionIds) outTriggeredRegionIds->clear();
    if (polygonRegions.empty()) {
        outMotion = true;
        return true;
    }
    if (previousFrame.empty() || currentFrame.empty()) {
        if (outErr) *outErr = "previous/current frame empty";
        return false;
    }

    cv::Mat prev = previousFrame;
    cv::Mat cur = currentFrame;
    if (prev.size() != cur.size()) {
        cv::resize(cur, cur, prev.size(), 0, 0, cv::INTER_AREA);
    }

    cv::Mat prevGray;
    cv::Mat curGray;
    cv::cvtColor(prev, prevGray, cv::COLOR_BGR2GRAY);
    cv::cvtColor(cur, curGray, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(prevGray, prevGray, cv::Size(5, 5), 0);
    cv::GaussianBlur(curGray, curGray, cv::Size(5, 5), 0);

    cv::Mat diff;
    cv::Mat motionMask;
    cv::absdiff(curGray, prevGray, diff);
    cv::threshold(diff, motionMask, 18, 255, cv::THRESH_BINARY);
    cv::erode(motionMask, motionMask, cv::Mat(), cv::Point(-1, -1), 1);
    cv::dilate(motionMask, motionMask, cv::Mat(), cv::Point(-1, -1), 1);

    std::set<std::string> triggered;
    for (const auto& region : polygonRegions) {
        const auto polygon = regionPolygonToPixelsForCamera_(region, motionMask.size());
        if (polygon.size() < 3) continue;

        cv::Mat roiMask(motionMask.size(), CV_8U, cv::Scalar(0));
        std::vector<std::vector<cv::Point>> polygons{ polygon };
        cv::fillPoly(roiMask, polygons, cv::Scalar(255));

        cv::Mat roiMotion;
        cv::bitwise_and(motionMask, roiMask, roiMotion);
        const int changed = cv::countNonZero(roiMotion);
        const int area = (std::max)(1, cv::countNonZero(roiMask));
        const int minChanged = (std::max)(20, static_cast<int>(std::llround(static_cast<double>(area) * 0.01)));
        if (changed >= minChanged) {
            outMotion = true;
            if (!region.regionId.empty()) {
                triggered.insert(region.regionId);
            }
        }
    }

    if (outTriggeredRegionIds) {
        outTriggeredRegionIds->assign(triggered.begin(), triggered.end());
    }
    return true;
}

static bool buildOverlayClipForRegionsCamera_(
    const std::string& srcClipPath,
    const std::vector<AlgorithmConfig::AnalysisRegion>& polygonRegions,
    std::string& outClipPath,
    std::vector<std::string>* outDrawnRegionIds)
{
    outClipPath.clear();
    if (outDrawnRegionIds) outDrawnRegionIds->clear();
    if (polygonRegions.empty()) return false;

    ensureOpenCvVideoIoThreadReadyCamera_();

    cv::VideoCapture cap;
    TempOpenCvClipPathGuardCamera_ tempOpenPathGuard;
    if (!openVideoCaptureForClipPathCamera_(srcClipPath, cap, tempOpenPathGuard.path)) {
        return false;
    }

    cv::Mat firstFrame;
    if (!cap.read(firstFrame) || firstFrame.empty()) {
        return false;
    }

    const int width = firstFrame.cols;
    const int height = firstFrame.rows;
    if (width <= 0 || height <= 0) return false;

    double fps = cap.get(cv::CAP_PROP_FPS);
    if (!std::isfinite(fps) || fps <= 0.0) fps = 10.0;

    std::string dstClipPath = srcClipPath + ".roi_overlay.mp4";
    cv::VideoWriter writer;
    const std::vector<int> fourccCandidates = {
        cv::VideoWriter::fourcc('a', 'v', 'c', '1'),
        cv::VideoWriter::fourcc('m', 'p', '4', 'v')
    };
    for (const int fourcc : fourccCandidates) {
        if (writer.open(dstClipPath, fourcc, fps, cv::Size(width, height), true)) {
            break;
        }
    }
    if (!writer.isOpened()) return false;

    {
        cv::Mat drawFrame = firstFrame.clone();
        drawAnalysisOverlaysOnFrameCamera_(drawFrame, polygonRegions, outDrawnRegionIds);
        writer.write(drawFrame);
    }

    cv::Mat frame;
    while (cap.read(frame)) {
        if (frame.empty()) continue;
        cv::Mat drawFrame = frame.clone();
        drawAnalysisOverlaysOnFrameCamera_(drawFrame, polygonRegions, nullptr);
        writer.write(drawFrame);
    }

    writer.release();
    cap.release();
    if (!waitForReadableClipPathCamera_(dstClipPath)) {
        return false;
    }
    outClipPath = dstClipPath;
    return true;
}


// Returns path to the oldest .mp4 in the inference folder for this camera, or empty optional.
static std::optional<std::string> getOldestInferenceClipForCamera(const std::string& cameraId)
{
    try {
        std::error_code ec;
        fs::path dir = getInferenceTempDirForCameraId(cameraId);

        if (!fs::exists(dir, ec) || !fs::is_directory(dir, ec)) {
            return std::nullopt;
        }

        fs::path bestPath;
        fs::file_time_type bestTime;
        bool found = false;

        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            if (entry.path().extension() != ".mp4") continue;

            auto t = entry.last_write_time(ec);
            if (ec) continue;

            if (!found || t < bestTime) {
                bestPath = entry.path();
                bestTime = t;
                found = true;
            }
        }

        if (!found) {
            return std::nullopt;
        }

        return bestPath.string();
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraId,
            std::string("getOldestInferenceClipForCamera: exception: ") + ex.what()
        );
        return std::nullopt;
    }
}

static std::optional<std::string> getOldestInferenceImageForCamera(const std::string& cameraId)
{
    try {
        std::error_code ec;
        fs::path dir = getInferenceTempDirForCameraId(cameraId) / "images";

        if (!fs::exists(dir, ec) || !fs::is_directory(dir, ec)) {
            return std::nullopt;
        }

        auto isImageExt = [](const fs::path& p) {
            std::string ext = p.extension().string();
            std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            });
            return ext == ".jpg" || ext == ".jpeg" || ext == ".png";
        };

        fs::path bestPath;
        fs::file_time_type bestTime;
        bool found = false;

        for (const auto& entry : fs::directory_iterator(dir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            if (!isImageExt(entry.path())) continue;

            auto t = entry.last_write_time(ec);
            if (ec) continue;

            if (!found || t < bestTime) {
                bestPath = entry.path();
                bestTime = t;
                found = true;
            }
        }

        if (!found) {
            return std::nullopt;
        }

        return bestPath.string();
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraId,
            std::string("getOldestInferenceImageForCamera: exception: ") + ex.what()
        );
        return std::nullopt;
    }
}

static size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    ((std::string*)userp)->append((char*)contents, size * nmemb);
    return size * nmemb;
}

// Very small base64 encoder (no line breaks)
static const std::string base64_chars =
"ABCDEFGHIJKLMNOPQRSTUVWXYZ"
"abcdefghijklmnopqrstuvwxyz"
"0123456789+/";

std::string base64_encode(const unsigned char* bytes_to_encode, size_t in_len) {
    std::string ret;
    int i = 0;
    int j = 0;
    unsigned char char_array_3[3];
    unsigned char char_array_4[4];

    while (in_len--) {
        char_array_3[i++] = *(bytes_to_encode++);
        if (i == 3) {
            char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
            char_array_4[1] = ((char_array_3[0] & 0x03) << 4) +
                ((char_array_3[1] & 0xf0) >> 4);
            char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) +
                ((char_array_3[2] & 0xc0) >> 6);
            char_array_4[3] = char_array_3[2] & 0x3f;

            for (i = 0; i < 4; ++i)
                ret += base64_chars[char_array_4[i]];
            i = 0;
        }
    }

    if (i) {
        for (j = i; j < 3; ++j)
            char_array_3[j] = '\0';

        char_array_4[0] = (char_array_3[0] & 0xfc) >> 2;
        char_array_4[1] = ((char_array_3[0] & 0x03) << 4) +
            ((char_array_3[1] & 0xf0) >> 4);
        char_array_4[2] = ((char_array_3[1] & 0x0f) << 2) +
            ((char_array_3[2] & 0xc0) >> 6);
        char_array_4[3] = char_array_3[2] & 0x3f;

        for (j = 0; j < i + 1; ++j)
            ret += base64_chars[char_array_4[j]];

        while ((i++ < 3))
            ret += '=';
    }

    return ret;
}

std::string read_file_binary(const std::string& path) {
    std::ifstream ifs(path, std::ios::binary);
    if (!ifs) throw std::runtime_error("Cannot open file: " + path);
    std::vector<unsigned char> buffer((std::istreambuf_iterator<char>(ifs)),
        std::istreambuf_iterator<char>());
    return std::string(buffer.begin(), buffer.end());
}



static const std::unordered_map<std::string, std::string> kAlgorithmPrompts = {
    { "weapon",   "Analyze the frame and detect if anyone is carrying a visible firearm or knife." },
    { "robbery",  "Analyze the frame and detect if any person has their hands in the air like they are getting robbed." },
    { "masked",   "Check if any person is wearing a face-covering/balaclava mask that hides identity." },
    { "fallen",   "Check if any person appears to be lying on the ground as if they have fallen." },
    { "crowd",    "Check if there is an unusually large crowd or gathering." },
    { "abandoned","Check if there is an backpacks left alone that looks abandoned." },
    { "intruder", "Check if there is a person where they should not be (intruder detection)." },
    { "reid", "Check if there is a person similar to the one described in the prompt." }
};



// Delay para considerar a câmera "idle" e começar a pular frames
static constexpr auto kIdlePurgeDelay = std::chrono::seconds(3);

CameraSession::CameraSession(const CameraConfig& cfg,
    std::shared_ptr<void> /*bufferEngine*/,
    std::shared_ptr<void> /*inferenceFactory*/)
    : config_(cfg),
    // ~2 segundos de buffer; o kernel pode ajustar depois se precisar
    buffer_(static_cast<size_t>(cfg.expectedFps * 2)),
    motionDetector_(config_.id, 0.01, std::chrono::seconds(5)),
    frameDiskWriter_(cfg.id, "frames", cfg.storage.storeFrames, std::chrono::milliseconds(1000), std::chrono::seconds(cfg.timeOffsetSeconds), 1.0, cfg.storage.retentionDays, cfg.storage.hydrateExistingSegments),
    directServiceRequested_(
        !cfg.isDrakonFindTemporarySession &&
        !cfg.isVideoSearchTemporarySession &&
        (cfg.startOrigin.empty() || cfg.startOrigin == "direct")
    ),
    lastThumbnailSent_(std::chrono::steady_clock::now() - std::chrono::seconds(60))
{
    frameDiskWriter_.setInferenceCopyEnabledProvider([this]() -> bool {
        return hasDirectVideoInferenceConfigured_();
    });
    frameDiskWriter_.setInferenceImageCopyEnabledProvider([this]() -> bool {
        return hasDirectImageInferenceConfigured_();
    });
    frameDiskWriter_.setForceVideoCaptureProvider([this]() -> bool {
        return shouldForceVideoCapture_();
    });
    frameDiskWriter_.setCaptureProfiles(getConfiguredVideoCaptureProfiles_());
}

CameraSession::~CameraSession() {
    stop();
}

void CameraSession::start() {
    if (running_) return;

    running_ = true;
    streamOnline_.store(false, std::memory_order_relaxed);
    descriptionCheckStarted_.store(false, std::memory_order_release);
    firstFrameSaved_.store(false, std::memory_order_release);
    descriptionFrameRequested_.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(firstFrameMutex_);
        firstFrameForDescription_.release();
    }
    {
        std::lock_guard<std::mutex> lock(customImageMotionMutex_);
        customImagePreviousByAlgo_.clear();
    }
    {
        std::lock_guard<std::mutex> lock(customRunEveryMutex_);
        customLastRunAtByAlgo_.clear();
    }

    Logger::instance().logDebug(
        "agent",
        "CameraSession::start() for camera " + config_.id +
        " RTSP=" + config_.rtspUrl
    );


    Logger::instance().logDebug(
        config_.id,
        "START camera session. RTSP=" + config_.rtspUrl
    );

    // Agora usamos o nome que você pediu: base_camera_thread().
    if (owner_ &&
        !config_.isDrakonFindTemporarySession &&
        !config_.isVideoSearchTemporarySession) {
        try {
            const int cameraIdValue = std::stoi(config_.id);
            nlohmann::json details = nlohmann::json::object();
            if (!config_.cameraSessionId.empty()) {
                details["camera_session_id"] = config_.cameraSessionId;
                details["event_id"] = config_.cameraSessionId + ":camera_started";
            }
            if (!config_.name.empty()) {
                details["camera_name"] = config_.name;
            }
            const std::string runtimeStartOrigin = currentStartOrigin_();
            if (!runtimeStartOrigin.empty()) {
                details["start_origin"] = runtimeStartOrigin;
            }
            {
                std::lock_guard<std::mutex> lock(algorithmsMutex_);
                if (!config_.enabledAlgorithms.empty()) {
                    details["enabled_algorithms"] = config_.enabledAlgorithms;
                }
            }
            owner_->postAgentEvent(
                "camera_started",
                cameraIdValue,
                "",
                "Camera session started.",
                details
            );
        }
        catch (...) {
        }
    }

    base_camera_thread();
}

void CameraSession::base_camera_thread() {
    // Thread de captura
    captureThread_ = std::thread(&CameraSession::captureLoop_, this);

    // Thread de inferência
    inferenceThread_ = std::thread(&CameraSession::inferenceLoop_, this);

    // Thread para envio de thumbnails (não bloqueia a captura)
    thumbnailStop_.store(false);
    thumbnailThread_ = std::thread(&CameraSession::thumbnailLoop_, this);
}






void CameraSession::stop() {
    Logger::instance().logDebug(
        config_.id,
        "CameraSession::stop(): ENTER"
    );

    try {
        bool wasRunning = running_.exchange(false);
        streamOnline_.store(false, std::memory_order_relaxed);
        descriptionFrameRequested_.store(false, std::memory_order_release);
        firstFrameCv_.notify_all();
        if (!wasRunning) {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): running_ was already false, will still join threads if needed"
            );
        }
        else {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): running_ set to false"
            );
        }


        // [THUMB] Stop thumbnail worker early and wake it if it's waiting
        thumbnailStop_.store(true);
        thumbnailCv_.notify_all();
        Logger::instance().logDebug(
            config_.id,
            "CameraSession::stop(): thumbnailStop_ set + thumbnailCv_ notified"
        );


        // Wake anybody blocked on the buffer
        streamOnline_.store(false, std::memory_order_relaxed);
        buffer_.requestStop();
        Logger::instance().logDebug(
            config_.id,
            "CameraSession::stop(): buffer_.requestStop() done"
        );

        if (descriptionThread_.joinable()) {
            Logger::instance().logDebug(config_.id, "CameraSession::stop(): joining descriptionThread_...");
            descriptionThread_.join();
            Logger::instance().logDebug(config_.id, "CameraSession::stop(): descriptionThread_ joined");
        }

        if (captureThread_.joinable()) {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): joining captureThread_..."
            );
            captureThread_.join();
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): captureThread_ joined"
            );
        }
        else {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): captureThread_ not joinable"
            );
        }

        if (inferenceThread_.joinable()) {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): joining inferenceThread_..."
            );
            inferenceThread_.join();
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): inferenceThread_ joined"
            );
        }
        else {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): inferenceThread_ not joinable"
            );
        }

        // [THUMB] Now join thumbnail thread (after capture/inference so nothing enqueues anymore)
        if (thumbnailThread_.joinable()) {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): joining thumbnailThread_..."
            );
            thumbnailThread_.join();
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): thumbnailThread_ joined"
            );
        }
        else {
            Logger::instance().logDebug(
                config_.id,
                "CameraSession::stop(): thumbnailThread_ not joinable"
            );
        }


        Logger::instance().logDebug(
            config_.id,
            "CameraSession::stop(): EXIT"
        );

        if (owner_ &&
            wasRunning &&
            !config_.isDrakonFindTemporarySession &&
            !config_.isVideoSearchTemporarySession) {
            try {
                const int cameraIdValue = std::stoi(config_.id);
                nlohmann::json details = nlohmann::json::object();
                if (!config_.cameraSessionId.empty()) {
                    details["camera_session_id"] = config_.cameraSessionId;
                    details["event_id"] = config_.cameraSessionId + ":camera_stopped";
                }
                if (!config_.name.empty()) {
                    details["camera_name"] = config_.name;
                }
                const std::string runtimeStartOrigin = currentStartOrigin_();
                if (!runtimeStartOrigin.empty()) {
                    details["start_origin"] = runtimeStartOrigin;
                }
                {
                    std::lock_guard<std::mutex> lock(algorithmsMutex_);
                    if (!config_.enabledAlgorithms.empty()) {
                        details["enabled_algorithms"] = config_.enabledAlgorithms;
                    }
                }
                owner_->postAgentEvent(
                    "camera_stopped",
                    cameraIdValue,
                    "",
                    "Camera session stopped.",
                    details
                );
            }
            catch (...) {
            }
        }
    }
    catch (const std::exception& e) {
        Logger::instance().logDebug(
            config_.id,
            std::string("CameraSession::stop(): std::exception: ") + e.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            config_.id,
            "CameraSession::stop(): unknown exception"
        );
    }
}






/*
// Change return type to json
std::string httpPostJsonGemini(const std::string& api_key, const std::string& modelName, const json& bodyJson) {
    const std::string url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        modelName  + ":generateContent?key=" + api_key;

    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("curl_easy_init failed");

    std::string response;
    std::string body = bodyJson.dump();

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 90L);           // Timeout total: 60s
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);    // Timeout conexão: 30s

    CURLcode res = curl_easy_perform(curl);
    if (res != CURLE_OK) {
        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        throw std::runtime_error(std::string("curl_easy_perform() failed: ") +
            curl_easy_strerror(res));
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    return response;
}
*/



// - Retries up to 3x on transient curl errors (including timeouts).
// - Optional callback is called once, on the first retry (so UI can show "Still analyzing...").
std::string httpPostJsonGemini(
    const std::string& api_key,
    const std::string& modelName,
    const json& bodyJson,
    const std::function<void()>& onFirstRetry)
{
    const std::string url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        modelName + ":generateContent?key=" + api_key;

    const std::string body = bodyJson.dump();

    auto isTransient = [](CURLcode c) {
        switch (c) {
        case CURLE_OPERATION_TIMEDOUT:
        case CURLE_COULDNT_CONNECT:
        case CURLE_COULDNT_RESOLVE_HOST:
        case CURLE_SEND_ERROR:
        case CURLE_RECV_ERROR:
            return true;
        default:
            return false;
        }
        };

    bool notified = false;
    std::string lastErr;

    for (int attempt = 1; attempt <= 3; ++attempt) {
        CURL* curl = curl_easy_init();
        if (!curl) throw std::runtime_error("curl_easy_init failed");

        std::string response;

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body.size());
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

        // Keep these bounded so threads never hang forever.
        // Vision-video requests can be slow, but we still need an upper bound.
        curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 90L);
        curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

        CURLcode res = curl_easy_perform(curl);

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);

        if (res == CURLE_OK) {
            return response;
        }

        lastErr = std::string("curl_easy_perform() failed: ") + curl_easy_strerror(res);

        if (attempt < 3 && isTransient(res)) {
            if (!notified && onFirstRetry) {
                notified = true;
                try { onFirstRetry(); }
                catch (...) {}
            }
            // simple backoff: 250ms, 500ms
            const int backoffMs = (attempt == 1) ? 250 : 500;
            std::this_thread::sleep_for(std::chrono::milliseconds(backoffMs));
            continue;
        }

        throw std::runtime_error(lastErr);
    }

    throw std::runtime_error(lastErr.empty() ? "httpPostJsonGemini failed" : lastErr);
}

// Backward-compatible overload
std::string httpPostJsonGemini(const std::string& api_key, const std::string& modelName, const json& bodyJson) {
    return httpPostJsonGemini(api_key, modelName, bodyJson, nullptr);
}

static std::string httpPostJsonOpenAIForDescription(
    const std::string& apiKey,
    const json& bodyJson)
{
    CURL* curl = curl_easy_init();
    if (!curl) throw std::runtime_error("curl_easy_init failed in httpPostJsonOpenAIForDescription");

    std::string response;
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, ("Authorization: Bearer " + apiKey).c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    const std::string body = bodyJson.dump();
    const std::string url = "https://api.openai.com/v1/chat/completions";

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, (long)body.size());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 90L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    CURLcode res = curl_easy_perform(curl);
    long httpCode = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(std::string("OpenAI curl error: ") + curl_easy_strerror(res));
    }
    if (httpCode < 200 || httpCode >= 300) {
        throw std::runtime_error(
            "OpenAI HTTP " + std::to_string(httpCode) + " body=" + response
        );
    }

    return response;
}

static std::string extractOpenAITextForDescription(const json& respJson)
{
    if (!respJson.is_object()) return "";
    if (!respJson.contains("choices") || !respJson["choices"].is_array() || respJson["choices"].empty()) {
        return "";
    }

    const auto& choice0 = respJson["choices"][0];
    if (!choice0.is_object() || !choice0.contains("message") || !choice0["message"].is_object()) {
        return "";
    }

    const auto& message = choice0["message"];
    if (!message.contains("content")) return "";

    const auto& content = message["content"];
    if (content.is_string()) {
        return content.get<std::string>();
    }
    if (content.is_array()) {
        std::string out;
        for (const auto& part : content) {
            if (part.is_object() && part.contains("text") && part["text"].is_string()) {
                out += part["text"].get<std::string>();
            }
        }
        return out;
    }
    return "";
}

static std::string describe_environment_openai_from_bytes(
    const std::string& api_key,
    const std::vector<unsigned char>& img_bytes,
    const std::string& model_name = "gpt-5.1",
    const std::string& mime_type = "image/jpeg")
{
    std::string img_b64 = base64_encode(
        reinterpret_cast<const unsigned char*>(img_bytes.data()),
        img_bytes.size()
    );
    const std::string dataUrl = "data:" + mime_type + ";base64," + img_b64;

    std::ostringstream prompt;
    prompt << "You are " << AppBrand::kAssistantName << ", a CCTV environment classifier.\n";
    prompt << "Classify the camera place and describe only the environment.\n";
    prompt << "Do not mention people, faces, or specific movable objects.\n";
    prompt << "Pick exactly ONE label from this list:\n";
    prompt << "kitchen, living_room, bedroom, childrens_room, office_room, corridor, elevator, classroom, "
              "parking_lot, garage, street, intersection, park, yard, frontyard, backyard, store, supermarket, "
              "warehouse, staircase, lobby, reception, restaurant, bar, cafe, gym, front_door, back_door, "
              "other_indoor, other_outdoor.\n";
    prompt << "Output format must be exactly:\n";
    prompt << "LABEL: <label>\n";
    prompt << "DESCRIPTION: <one short sentence about environment only>\n";
    prompt << "No JSON, no markdown, no extra text.";

    json content = json::array();
    content.push_back({ { "type", "text" }, { "text", prompt.str() } });
    content.push_back({
        { "type", "image_url" },
        { "image_url", {
            { "url", dataUrl },
            { "detail", "low" }
        } }
        });

    json body = {
        { "model", model_name },
        { "messages", json::array({
            {
                { "role", "user" },
                { "content", content }
            }
        })},
        { "max_completion_tokens", 220 }
    };

    const std::string raw = httpPostJsonOpenAIForDescription(api_key, body);
    const auto resp = json::parse(raw, nullptr, false);
    if (!resp.is_object()) {
        throw std::runtime_error("OpenAI environment description invalid JSON: " + raw);
    }

    const std::string text = extractOpenAITextForDescription(resp);
    if (text.empty()) {
        throw std::runtime_error("OpenAI environment description returned empty text: " + raw);
    }
    return text;
}



std::string describe_environment_gemini_from_bytes(
    const std::string& api_key,
    const std::vector<unsigned char>& img_bytes,
    const std::string& mime_type = "image/jpeg"
) {
    // base64 only, no data: URL for inline_data
    std::string img_b64 = base64_encode(
        reinterpret_cast<const unsigned char*>(img_bytes.data()),
        img_bytes.size()
    );

    // SYSTEM RULES focados em descrição de ambiente
    std::string system_rules =
        "You are " + std::string(AppBrand::kAssistantName) + ", a CCTV camera ENVIRONMENT classifier.\n"
        "Your job is to identify what kind of PLACE the camera is looking at and "
        "briefly describe the ENVIRONMENT ONLY.\n"
        "You MUST NOT mention people, faces, or specific small objects such as "
        "computers, phones, tables, cars, bottles, etc.\n"
        "Focus only on the location type, layout, size, lighting and general "
        "atmosphere.\n"
        "Pick exactly ONE label that best matches the scene from this list:\n"
        "kitchen, living_room, bedroom, childrens_room, office_room, corridor, "
        "elevator, classroom, parking_lot, garage, street, intersection, park, "
        "yard, frontyard, backyard, store, supermarket, warehouse, staircase, "
        "lobby, reception, restaurant, bar, cafe, gym, front_door, back_door, other_indoor, other_outdoor.\n"
        "OUTPUT FORMAT (exactly two lines):\n"
        "LABEL: <one label from the list above>\n"
        "DESCRIPTION: <ONE short sentence describing the environment only>\n"
        "Do not add anything else. No JSON, no quotes, no bullet points, no extra commentary.\n";

    
    // Body no formato Gemini v1beta generateContent
    json body = {
        {"system_instruction", {
            {"role", "system"},
            {"parts", json::array({
                json{{"text", system_rules}}
            })}
        }},
        {"contents", json::array({
            {
                {"role", "user"},
                {"parts", json::array({
                    json{{"text", "Classify and describe the environment of this camera image."}},
                    json{{"inline_data", {
                        {"mime_type", mime_type},
                        {"data", img_b64}
                    }}}
                })}
            }
        })},
        {"generation_config", {
            {"max_output_tokens", 250}
        }}
    };

    std::string raw = httpPostJsonGemini(api_key, "gemini-2.0-flash-lite", body);
    auto j = json::parse(raw);

    if (!j.contains("candidates") || j["candidates"].empty()) {
        throw std::runtime_error("No candidates in environment description response: " + raw);
    }

    auto content = j["candidates"][0]["content"];
    if (!content.contains("parts") || !content["parts"].is_array()) {
        throw std::runtime_error("Unexpected response format in environment description: " + raw);
    }

    std::string full_text;
    for (const auto& part : content["parts"]) {
        if (part.contains("text") && part["text"].is_string()) {
            full_text += part["text"].get<std::string>();
        }
    }

    if (full_text.empty()) {
        throw std::runtime_error("Empty text in environment description response: " + raw);
    }

    return full_text;
}





static bool loadMochaAuth(std::string& baseUrl,
    std::string& exeToken,
    std::string& clientId)
{
    // Shared config for backend base URL
    baseUrl = GetPerceptrumBaseUrl();

    PairingClient pairing(baseUrl);
    bool ok = pairing.loadSavedToken(exeToken, clientId);

    return ok;
}

struct AuthorizedHttpResponse {
    long httpStatus = 0;
    std::string body;
};

static AuthorizedHttpResponse httpPostJsonAuthorizedDetailed(const std::string& url,
    const std::string& exeToken,
    const json& bodyJson);






static std::string httpPostJsonAuthorized(const std::string& url,
    const std::string& exeToken,
    const json& bodyJson)
{
    CURL* curl = curl_easy_init();
    if (!curl)
        throw std::runtime_error("curl_easy_init failed in httpPostJsonAuthorized");

    std::string response;
    struct curl_slist* headers = nullptr;

    // Authorization header
    std::string authHeader = "Authorization: Bearer " + exeToken;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    // Serialize JSON body
    std::string body = bodyJson.dump();

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));

    // Same write callback you already use
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);           // Timeout total: 60s
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);    // Timeout conexão: 30s

    CURLcode res = curl_easy_perform(curl);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("curl_easy_perform failed in httpPostJsonAuthorized: ") +
            curl_easy_strerror(res)
        );
    }

    return response;
}

static AuthorizedHttpResponse httpPostJsonAuthorizedDetailed(const std::string& url,
    const std::string& exeToken,
    const json& bodyJson)
{
    CURL* curl = curl_easy_init();
    if (!curl)
        throw std::runtime_error("curl_easy_init failed in httpPostJsonAuthorizedDetailed");

    std::string response;
    long httpStatus = 0;
    struct curl_slist* headers = nullptr;

    std::string authHeader = "Authorization: Bearer " + exeToken;
    headers = curl_slist_append(headers, authHeader.c_str());
    headers = curl_slist_append(headers, "Content-Type: application/json");

    std::string body = bodyJson.dump();

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);

    CURLcode res = curl_easy_perform(curl);
    if (res == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &httpStatus);
    }

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("curl_easy_perform failed in httpPostJsonAuthorizedDetailed: ") +
            curl_easy_strerror(res)
        );
    }

    return AuthorizedHttpResponse{ httpStatus, response };
}







static std::string httpGetJsonAuthorized(const std::string& url,
    const std::string& exeToken)
{
    CURL* curl = curl_easy_init();
    if (!curl)
        throw std::runtime_error("curl_easy_init failed in httpGetJsonAuthorized");

    std::string response;
    struct curl_slist* headers = nullptr;

    std::string authHeader = "Authorization: Bearer " + exeToken;
    headers = curl_slist_append(headers, authHeader.c_str());

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_HTTPGET, 1L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 60L);           // Timeout total: 60s
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);    // Timeout conexão: 30s

    CURLcode res = curl_easy_perform(curl);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        throw std::runtime_error(
            std::string("curl_easy_perform failed in httpGetJsonAuthorized: ") +
            curl_easy_strerror(res)
        );
    }

    return response;
}







void CameraSession::sendCameraDescription(const std::string& cameraIdStr,
    const std::string& description,
    bool descriptionFirstCheckSuccessful)
{
    try {
        // Get baseUrl, exeToken, clientId exactly like your other code
        std::string baseUrl;
        std::string exeToken;
        std::string clientId;

        if (!loadMochaAuth(baseUrl, exeToken, clientId)) {
            Logger::instance().logDebug(
                "core",
                "sendCameraDescription: no saved token, skipping"
            );
            return;
        }

        int cameraId = std::stoi(cameraIdStr);

        json body;
        body["camera_id"] = cameraId;
        body["description"] = description;
        body["description_first_check_successful"] = descriptionFirstCheckSuccessful ? 1 : 0;
        if (descriptionFirstCheckSuccessful) {
            body["description_first_check_success_at"] = nowUtcIso8601Ms_();
        }

        const std::string url =
            baseUrl + "/api/agent/camera-description?client_id=" + clientId;

        Logger::instance().logDebug(
            cameraIdStr,
            "sendCameraDescription: POST " + url
        );

        // Same helper you use for /api/agent/events or /api/agent/thumbnails
        std::string response = httpPostJsonAuthorized(url, exeToken, body);

        Logger::instance().logDebug(
            cameraIdStr,
            "sendCameraDescription: response = " + response
        );
    }
    catch (const std::exception& e) {
        Logger::instance().logDebug(
            "core",
            std::string("sendCameraDescription failed: ") + e.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            "core",
            "sendCameraDescription failed: unknown exception"
        );
    }
}



static inline std::string TrimCopy(std::string s) {
    auto isSpace = [](unsigned char c) { return std::isspace(c); };
    while (!s.empty() && isSpace((unsigned char)s.front())) s.erase(s.begin());
    while (!s.empty() && isSpace((unsigned char)s.back()))  s.pop_back();
    return s;
}

static bool ParseStructuredCameraDescription(
    const std::string& raw,
    std::string& outLabel,
    std::string& outDescription)
{
    outLabel.clear();
    outDescription.clear();

    const std::string text = TrimCopy(raw);
    if (text.empty()) return false;

    std::smatch m;
    const std::regex inlineRx(R"(LABEL:\s*(.+?)\s*DESCRIPTION:\s*([\s\S]+)$)", std::regex::icase);
    if (std::regex_search(text, m, inlineRx) && m.size() >= 3) {
        outLabel = TrimCopy(m[1].str());
        outDescription = TrimCopy(m[2].str());
        return !outLabel.empty() && !outDescription.empty();
    }

    const std::regex labelRx(R"(LABEL:\s*([^\r\n]+))", std::regex::icase);
    const std::regex descRx(R"(DESCRIPTION:\s*([\s\S]+)$)", std::regex::icase);
    std::smatch labelMatch;
    std::smatch descMatch;
    if (!std::regex_search(text, labelMatch, labelRx) || labelMatch.size() < 2) return false;
    if (!std::regex_search(text, descMatch, descRx) || descMatch.size() < 2) return false;

    outLabel = TrimCopy(labelMatch[1].str());
    outDescription = TrimCopy(descMatch[1].str());
    return !outLabel.empty() && !outDescription.empty();
}

static bool IsPlaceholderDescription(const std::string& descRaw) {
    std::string label;
    std::string description;
    return !ParseStructuredCameraDescription(descRaw, label, description);
}





void CameraSession::checkCameraDescriptionOnce_() {
    // Ensure we run this only once per CameraSession
    bool expected = false;
    if (!descriptionCheckStarted_.compare_exchange_strong(expected, true)) {
        return; // already started
    }

    // Se já existe uma thread rodando, não criar outra
    if (descriptionThread_.joinable()) {
        return;
    }

    try {
        // Capturar cópias dos dados necessários ANTES de lançar a thread
        std::string cameraId = config_.id;

        // Usar thread gerenciada ao invés de detached
        descriptionThread_ = std::thread([this, cameraId]() {
            try {
                // Verificar se ainda estamos rodando
                if (!running_.load()) return;

                std::string baseUrl;
                std::string exeToken;
                std::string clientId;

                if (!loadMochaAuth(baseUrl, exeToken, clientId)) {
                    Logger::instance().logDebug(
                        cameraId,
                        "checkCameraDescriptionOnce_: no saved token, skipping description check"
                    );
                    return;
                }

                if (!running_.load()) return;  // Check novamente

                std::ostringstream url;
                url << baseUrl
                    << "/api/agent/camera-description?client_id="
                    << clientId
                    << "&camera_id="
                    << cameraId;

                const std::string response = httpGetJsonAuthorized(url.str(), exeToken);

                if (!running_.load()) return;

                json j = json::parse(response, nullptr, false);
                if (!j.is_object()) {
                    Logger::instance().logDebug(
                        cameraId,
                        "checkCameraDescriptionOnce_: invalid JSON response"
                    );
                    return;
                }

                const bool hasDescription = j.value("has_description", false);
                const std::string description = j.value("description", "");

                const bool shouldGenerate = (!hasDescription) || IsPlaceholderDescription(description);

                if (shouldGenerate) {
                    Logger::instance().logDebug(
                        cameraId,
                        "Camera description not filled yet - will try Gemini environment description"
                    );

                    if (!running_.load()) return;

                    // === pegar o primeiro frame salvo ===
                    cv::Mat frameCopy;
                    {
                        std::lock_guard<std::mutex> lock(firstFrameMutex_);
                        if (!firstFrameSaved_.load(std::memory_order_acquire) ||
                            firstFrameForDescription_.empty()) {
                            Logger::instance().logDebug(
                                cameraId,
                                "checkCameraDescriptionOnce_: firstFrameForDescription_ not available; will retry later"
                            );
                            descriptionCheckStarted_.store(false, std::memory_order_release);
                            return;
                        }
                        frameCopy = firstFrameForDescription_.clone();
                    }

                    // === converter para JPEG em memória ===
                    std::vector<uchar> jpgBuf;
                    if (!cv::imencode(".jpg", frameCopy, jpgBuf)) {
                        Logger::instance().logDebug(cameraId, "checkCameraDescriptionOnce_: imencode failed...");
                        descriptionCheckStarted_.store(false, std::memory_order_release);
                        return;
                    }

                    if (!running_.load()) return;

                    try {
                        std::string envDescription = describe_environment_gemini_from_bytes(
                            "AIzaSyA_c5lgj1--kFYMDL0y4d58hXnT5-J-7M0",
                            jpgBuf,
                            "image/jpeg"
                        );

                        if (envDescription.empty()) {
                            Logger::instance().logDebug(
                                cameraId,
                                "Gemini returned empty env description; will retry later"
                            );
                            descriptionCheckStarted_.store(false, std::memory_order_release);
                            return;
                        }

                        if (!running_.load()) return;

                        Logger::instance().logDebug(cameraId, "Gemini environment description: " + envDescription);
                        sendCameraDescription(cameraId, envDescription, true);
                    }
                    catch (const std::exception& e) {
                        Logger::instance().logDebug(cameraId, std::string("checkCameraDescriptionOnce_: Gemini env description exception: ") + e.what());
                        descriptionCheckStarted_.store(false, std::memory_order_release);
                    }
                }
                else {
                    Logger::instance().logDebug(
                        cameraId,
                        "Camera description present: " + description
                    );
                }
            }
            catch (const std::exception& e) {
                Logger::instance().logDebug(
                    cameraId,
                    std::string("checkCameraDescriptionOnce_: exception: ") + e.what()
                );
            }
            catch (...) {
                Logger::instance().logDebug(
                    cameraId,
                    "checkCameraDescriptionOnce_: unknown exception"
                );
            }
            });
        // NÃO chama .detach() - a thread é gerenciada pelo membro descriptionThread_
    }
    catch (const std::exception& e) {
        Logger::instance().logDebug(
            config_.id,
            std::string("checkCameraDescriptionOnce_ launch thread exception: ") + e.what()
        );
    }
}


static std::string toUtcIso8601(std::chrono::system_clock::time_point tp)
{
    using namespace std::chrono;

    const auto ms = duration_cast<milliseconds>(tp.time_since_epoch()) % 1000;
    std::time_t t = system_clock::to_time_t(tp);

    std::tm tmUtc{};
#ifdef _WIN32
    gmtime_s(&tmUtc, &t);
#else
    gmtime_r(&t, &tmUtc);
#endif

    std::ostringstream oss;
    oss << std::put_time(&tmUtc, "%Y-%m-%dT%H:%M:%S")
        << '.' << std::setw(3) << std::setfill('0') << ms.count()
        << 'Z';
    return oss.str();
}


std::string CameraSession::getLastJobStillTsUtcIso() const {
    std::lock_guard<std::mutex> lock(jobStillMutex_);
    return lastJobStillTsUtcIso_;
}

std::string CameraSession::getLastJobStillJpegBase64() const {
    std::lock_guard<std::mutex> lock(jobStillMutex_);
    return lastJobStillB64_;
}

void CameraSession::maybeUpdateJobStill_(const cv::Mat& frame, std::chrono::steady_clock::time_point now) {
    static const auto kJobStillInterval = std::chrono::seconds(10);

    auto sysNow = std::chrono::system_clock::now();

    std::string tsUtcIso = toUtcIso8601(sysNow);

    if (lastJobStillAt_.time_since_epoch().count() == 0) {
        lastJobStillAt_ = now - kJobStillInterval;
    }
    if ((now - lastJobStillAt_) < kJobStillInterval) return;

    std::vector<uchar> jpgBuf;
    if (!cv::imencode(".jpg", frame, jpgBuf)) return;

    std::string b64 = base64_encode(
        reinterpret_cast<const unsigned char*>(jpgBuf.data()),
        jpgBuf.size()
    );

    {
        std::lock_guard<std::mutex> lock(jobStillMutex_);
        lastJobStillB64_ = std::move(b64);
        lastJobStillTsUtcIso_ = std::move(tsUtcIso);
        lastJobStillAt_ = now;
    }
}

















void CameraSession::captureLoop_() {

    try {
        streamOnline_.store(false, std::memory_order_relaxed);

        // measure cpu usage
        ThreadCpuMeter cpuMeter;
        cpuMeter.init();

        auto lastCpuLog = std::chrono::steady_clock::now();

        int cameraNumericId = -1;
        try {
            cameraNumericId = std::stoi(config_.id);
        }
        catch (...) {
            cameraNumericId = -1;
        }

        telemetryActualFps_.store(0.0, std::memory_order_relaxed);
        telemetryQueueDepth_.store(0, std::memory_order_relaxed);
        telemetryCaptureThreadCpuPercent_.store(0.0, std::memory_order_relaxed);
        telemetryCaptureMemEstimatedBytes_.store(0, std::memory_order_relaxed);
        telemetryProcessWorkingSetBytes_.store(0, std::memory_order_relaxed);
        telemetryProcessPrivateBytes_.store(0, std::memory_order_relaxed);
        telemetryFrameWidth_.store(0, std::memory_order_relaxed);
        telemetryFrameHeight_.store(0, std::memory_order_relaxed);
        telemetryLastFrameTickMs_.store(0, std::memory_order_relaxed);
        telemetryReconnectCount_.store(0, std::memory_order_relaxed);
        telemetryCaptureReadLatencyTotalUs_.store(0, std::memory_order_relaxed);
        telemetryCaptureReadSamples_.store(0, std::memory_order_relaxed);
        telemetryDecodeLatencyTotalUs_.store(0, std::memory_order_relaxed);
        telemetryDecodeSamples_.store(0, std::memory_order_relaxed);
        telemetryDiskReadBytesTotal_.store(0, std::memory_order_relaxed);
        telemetryDiskReadLatencyTotalUs_.store(0, std::memory_order_relaxed);
        telemetryDiskReadOperations_.store(0, std::memory_order_relaxed);
        telemetryInferenceInputTotal_.store(0, std::memory_order_relaxed);
        telemetryInferenceProcessedTotal_.store(0, std::memory_order_relaxed);
        telemetryLastInferenceTickMs_.store(0, std::memory_order_relaxed);
        telemetryInferenceSuccessCount_.store(0, std::memory_order_relaxed);
        telemetryInferenceErrorCount_.store(0, std::memory_order_relaxed);

        auto shouldOnlyCaptureOnMotion = [&]() -> bool {
            if (!owner_ || cameraNumericId <= 0) return true;
            if (!owner_->isJobsCaptureEnabled(cameraNumericId)) return true;
            return owner_->shouldOnlyCaptureOnMotion(cameraNumericId);
        };

        auto consumeBootstrapCaptureOnce = [&]() -> bool {
            if (!owner_ || cameraNumericId <= 0) return false;
            if (!owner_->isJobsCaptureEnabled(cameraNumericId)) return false;
            return owner_->consumeJobsBootstrapCaptureIfRequested(cameraNumericId);
        };

        std::vector<VideoCaptureProfile> appliedRecordingProfiles = getEffectiveRecordingProfiles_();
        frameDiskWriter_.setCaptureProfiles(appliedRecordingProfiles);
        auto refreshRecordingProfiles = [&]() -> const std::vector<VideoCaptureProfile>& {
            const std::vector<VideoCaptureProfile> effectiveRecordingProfiles = getEffectiveRecordingProfiles_();
            if (!sameCaptureProfiles_(effectiveRecordingProfiles, appliedRecordingProfiles)) {
                Logger::instance().logDebug(
                    config_.id,
                    "captureLoop_: updating recording profiles from " +
                    captureProfilesLogString_(appliedRecordingProfiles) + " to " +
                    captureProfilesLogString_(effectiveRecordingProfiles)
                );
                appliedRecordingProfiles = effectiveRecordingProfiles;
                frameDiskWriter_.setCaptureProfiles(appliedRecordingProfiles);
            }
            return appliedRecordingProfiles;
        };



        // ============================================================
        // 1) BRANCH WEBCAM LOCAL (0..5) – sobrescreve RTSP quando setado
        // ============================================================
        if (config_.webcam_index >= 0 && config_.webcam_index <= 5) {
            Logger::instance().logDebug(
                config_.id,
                "captureLoop_: using local webcam index = " + std::to_string(config_.webcam_index)
            );

            cv::VideoCapture cap(config_.webcam_index, cv::CAP_DSHOW); // ou CAP_ANY se preferir
            if (!cap.isOpened()) {
                Logger::instance().logDebug(
                    config_.id,
                    "captureLoop_: failed to open local webcam index=" + std::to_string(config_.webcam_index)
                );
                streamOnline_.store(false, std::memory_order_relaxed);
                buffer_.requestStop();
                running_ = false;
                return;
            }

            streamOnline_.store(true, std::memory_order_relaxed);

            std::deque<std::chrono::steady_clock::time_point> timestampHistory;
            constexpr size_t kFpsWindow = 30;

            int consecutiveReadFails = 0;
            const int   kFailsBeforeGiveUp = 50;
            const auto  kReadFailSleep = std::chrono::milliseconds(100);

            // Intervalo de envio para a thread de inferência,
            // vindo de cfg.frameCaptureIntervalSeconds (1, 8, 12, etc.)
            const int intervalSeconds = (config_.frameCaptureIntervalSeconds > 0)
                ? config_.frameCaptureIntervalSeconds
                : 3; // fallback

            const auto enqueueInterval = std::chrono::seconds(intervalSeconds);
            auto lastSentToBuffer = std::chrono::steady_clock::now() - enqueueInterval;

            Logger::instance().logDebug(
                config_.id,
                "captureLoop_ (webcam) StorageConfig: storeFrames=" +
                std::string(config_.storage.storeFrames ? "true" : "false") +
                ", retentionDays=" + std::to_string(config_.storage.retentionDays)
            );

            while (running_) {
                refreshRecordingProfiles();

                if (config_.storage.retentionDays > 0) {
                    try {
                        frameDiskWriter_.runRetentionCleanupIfDue();
                    }
                    catch (...) {
                        Logger::instance().logDebug(config_.id, "captureLoop_ (webcam): retention cleanup threw");
                    }
                }

                //Logger::instance().logDebug(config_.id, "captureLoop_: heartbeat");

                // 0) Always read a frame from webcam
                cv::Mat frameMat;
                const auto captureReadStartedAt = std::chrono::steady_clock::now();
                const bool readOk = cap.read(frameMat) && !frameMat.empty();
                const auto captureReadLatencyUs = static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::steady_clock::now() - captureReadStartedAt
                    ).count()
                );
                telemetryCaptureReadLatencyTotalUs_.fetch_add(
                    captureReadLatencyUs,
                    std::memory_order_relaxed
                );
                telemetryCaptureReadSamples_.fetch_add(1, std::memory_order_relaxed);
                telemetryDecodeLatencyTotalUs_.fetch_add(
                    captureReadLatencyUs,
                    std::memory_order_relaxed
                );
                telemetryDecodeSamples_.fetch_add(1, std::memory_order_relaxed);
                if (!readOk) {
                    ++consecutiveReadFails;

                    if (consecutiveReadFails >= kFailsBeforeGiveUp) {
                        Logger::instance().logDebug(
                            config_.id,
                            "captureLoop_ (webcam): too many consecutive read fails, stopping."
                        );
                        break;
                    }

                    std::this_thread::sleep_for(kReadFailSleep);
                    continue;
                }
                consecutiveReadFails = 0;

                // --- Resize Frame (igual RTSP) ---
                {
                    const int targetW = 1920;
                    const int targetH = 1080;

                    // Only downscale (avoid upscaling noisy low-res streams)
                    if (frameMat.cols > targetW || frameMat.rows > targetH) {
                        cv::Mat resized;
                        cv::resize(
                            frameMat,
                            resized,
                            cv::Size(targetW, targetH),
                            0, 0,
                            cv::INTER_AREA   // best for downscaling
                        );
                        frameMat = std::move(resized);
                    }
                }

                auto now = std::chrono::steady_clock::now();
                telemetryLastFrameTickMs_.store(steadyToMs_(now), std::memory_order_relaxed);
                telemetryFrameWidth_.store(frameMat.cols, std::memory_order_relaxed);
                telemetryFrameHeight_.store(frameMat.rows, std::memory_order_relaxed);

                maybeUpdateJobStill_(frameMat, now);

                // salva o primeiro frame na memoria para descrição de ambiente <<< 
                if (!firstFrameSaved_.load(std::memory_order_acquire)) {
                    std::lock_guard<std::mutex> lock(firstFrameMutex_);
                    if (!firstFrameSaved_.load(std::memory_order_relaxed)) {
                        firstFrameForDescription_ = frameMat.clone();   // cópia independente
                        firstFrameSaved_.store(true, std::memory_order_release);

                        Logger::instance().logDebug(
                            config_.id,
                            "captureLoop_ (webcam): stored firstFrameForDescription_"
                        );
                    }
                }

                // Launch one-time description check in background
                checkCameraDescriptionOnce_();

                // --- Thumbnail update every 3 seconds ---
                if (lastThumbnailSent_.time_since_epoch().count() == 0) {
                    // segurança, caso não tenha sido inicializado
                    lastThumbnailSent_ = now - kDashboardThumbnailIntervalCamera_;
                }

                if ((now - lastThumbnailSent_) >= kDashboardThumbnailIntervalCamera_) {
                    sendThumbnail_(frameMat);
                    lastThumbnailSent_ = now;
                }

                // Atualiza detector de movimento
                motionDetector_.update(frameMat);
                bool recent = motionDetector_.hasRecentMotion();
                bool prevCap = captureEnabled_.load(std::memory_order_relaxed);
                bool prevInf = inferenceEnabled_.load(std::memory_order_relaxed);
                if (recent) {
                    lastMotionForImageSnapshot_ = now;
                }

                // grava no disco quando houver movimento, ou sempre quando o job desse camera permitir.
                const bool captureOnMotionOnly = shouldOnlyCaptureOnMotion();
                const bool forceVideoCapture = shouldForceVideoCapture_();
                const bool forceBootstrapCapture = config_.storage.storeFrames ? consumeBootstrapCaptureOnce() : false;
                bool forceImageSnapshotTick = false;
                if (config_.storage.storeFrames) {
                    const bool hasMotionInSnapshotWindow =
                        lastMotionForImageSnapshot_ != std::chrono::steady_clock::time_point::min() &&
                        (now - lastMotionForImageSnapshot_) <= std::chrono::seconds(60);
                    forceImageSnapshotTick =
                        hasMotionInSnapshotWindow &&
                        frameDiskWriter_.shouldEmitImageSnapshotOnlyNow();
                }
                const bool captureEnabled =
                    config_.storage.storeFrames &&
                    (forceVideoCapture || recent || !captureOnMotionOnly || forceBootstrapCapture || forceImageSnapshotTick);
                if (captureEnabled) {
                    frameDiskWriter_.save(frameMat);
                }

                if (recent) {
                    lastMotionSeen_ = now;
                }
                captureEnabled_.store(captureEnabled, std::memory_order_relaxed);
                inferenceEnabled_.store(recent, std::memory_order_relaxed);

                if (config_.storage.storeFrames) {
                    try {
                        frameDiskWriter_.flushVideoClipIfIdle(std::chrono::seconds(10));
                    }
                    catch (const std::exception& e) {
                        Logger::instance().logDebug(config_.id,
                            std::string("frameDiskWriter_.flushVideoClipIfIdle() EXCEPTION: ") + e.what());
                    }
                    catch (...) {
                        Logger::instance().logDebug(config_.id,
                            "frameDiskWriter_.flushVideoClipIfIdle() UNKNOWN EXCEPTION");
                    }
                }

                // Decide se vamos pular frames por inatividade prolongada
                bool idleLong = (now - lastMotionSeen_) >= kIdlePurgeDelay;
                skipFrames_.store(idleLong, std::memory_order_relaxed);

                // Só enfileira para inferência quando não estiver pulando
                // e respeitando o intervalo de frame_rate
                if (!skipFrames_.load(std::memory_order_relaxed)) {
                    if ((now - lastSentToBuffer) >= enqueueInterval) {
                        Frame frame;
                        frame.timestamp = now;
                        frame.image = frameMat;
                        frame.cameraId = config_.id;

                        buffer_.push(std::move(frame));
                        lastSentToBuffer = now;

                        timestampHistory.push_back(now);
                        if (timestampHistory.size() > kFpsWindow) {
                            timestampHistory.pop_front();
                        }

                        Logger::instance().logDebug(
                            config_.id,
                            "captureLoop_ (webcam): enqueued frame to buffer (intervalSeconds=" +
                            std::to_string(intervalSeconds) + ")"
                        );
                    }
                }

                if (captureEnabled != prevCap) {
                    Logger::instance().logDebug(
                        config_.id,
                        "captureEnabled (webcam)=" + std::to_string(captureEnabled ? 1 : 0)
                    );
                }

                if (recent != prevInf) {
                    Logger::instance().logDebug(
                        config_.id,
                        "inferenceEnabled (webcam)=" + std::to_string(recent ? 1 : 0)
                    );
                }

                // measure cpu usage
                auto tnow = std::chrono::steady_clock::now();
                if (tnow - lastCpuLog >= std::chrono::seconds(5)) {
                    double pct = cpuMeter.samplePercent(); // % de 1 core no intervalo
                    const double actualFps = fpsFromHistory_(timestampHistory);
                    const size_t queueDepthRaw = buffer_.size();
                    const int queueDepth = static_cast<int>(
                        std::min<size_t>(queueDepthRaw, static_cast<size_t>(std::numeric_limits<int>::max()))
                    );

                    std::uint64_t processWorkingSetBytes = 0;
                    std::uint64_t processPrivateBytes = 0;
                    readProcessMemorySnapshot_(processWorkingSetBytes, processPrivateBytes);

                    std::uint64_t frameBytes = 0;
                    if (!frameMat.empty()) {
                        const std::uint64_t pixels = static_cast<std::uint64_t>(frameMat.total());
                        const std::uint64_t bytesPerPixel = static_cast<std::uint64_t>(frameMat.elemSize());
                        if (
                            bytesPerPixel > 0 &&
                            pixels > 0 &&
                            pixels <= (std::numeric_limits<std::uint64_t>::max() / bytesPerPixel)
                            ) {
                            frameBytes = pixels * bytesPerPixel;
                        }
                    }
                    std::uint64_t captureMemEstimatedBytes = frameBytes;
                    if (frameBytes > 0) {
                        const std::uint64_t estimatedBufferedFrames =
                            static_cast<std::uint64_t>(queueDepth) + 1ULL;
                        if (estimatedBufferedFrames <=
                            (std::numeric_limits<std::uint64_t>::max() / frameBytes)) {
                            captureMemEstimatedBytes = estimatedBufferedFrames * frameBytes;
                        }
                        else {
                            captureMemEstimatedBytes = std::numeric_limits<std::uint64_t>::max();
                        }
                    }

                    Logger::instance().logDebug(
                        config_.id,
                        "captureLoop_ CPU(thread) ~ " + std::to_string(pct) + "% of 1 core (avg last 5s)"
                    );

                    telemetryActualFps_.store(actualFps, std::memory_order_relaxed);
                    telemetryQueueDepth_.store(queueDepth, std::memory_order_relaxed);
                    telemetryCaptureThreadCpuPercent_.store(pct, std::memory_order_relaxed);
                    telemetryCaptureMemEstimatedBytes_.store(captureMemEstimatedBytes, std::memory_order_relaxed);
                    telemetryProcessWorkingSetBytes_.store(processWorkingSetBytes, std::memory_order_relaxed);
                    telemetryProcessPrivateBytes_.store(processPrivateBytes, std::memory_order_relaxed);

                    if (owner_ && cameraNumericId > 0) {
                        const std::string clientId = owner_->getClientId();
                        const std::string exeToken = owner_->getExeToken();
                        const std::string backendBaseUrl = owner_->getBackendBaseUrl();
                        if (!clientId.empty() && !exeToken.empty() && !backendBaseUrl.empty()) {
                            CaptureThreadMetricSample sample;
                            sample.backendBaseUrl = backendBaseUrl;
                            sample.clientId = clientId;
                            sample.exeToken = exeToken;
                            sample.cameraId = cameraNumericId;
                            sample.threadName = "captureLoop";
                            sample.cpuPercent = pct;
                            sample.captureMemEstimatedBytes = captureMemEstimatedBytes;
                            sample.processWorkingSetBytes = processWorkingSetBytes;
                            sample.processPrivateBytes = processPrivateBytes;
                            sample.queueDepth = queueDepth;
                            sample.sampledAtIso = nowUtcIso8601Ms_();
                            enqueueCaptureThreadMetricSample_(std::move(sample));
                        }
                    }

                    lastCpuLog = tnow;
                }


            }

            cap.release();
            streamOnline_.store(false, std::memory_order_relaxed);
            buffer_.requestStop();
            Logger::instance().logDebug(config_.id, "captureLoop_ (webcam) exiting.");
            return; // não cai na lógica RTSP
        }




        // ============================================================
        // 2) BRANCH ORIGINAL: RTSP (comportamento atual preservado)
        // ============================================================


        Logger::instance().logDebug(
            config_.id,
            "captureLoop_ starting. raw rtspUrl field = " + config_.rtspUrl
        );

        // Split cfg.rtspUrl into candidates separated by '|'
        std::vector<std::string> candidates;
        {
            const std::string& raw = config_.rtspUrl;
            size_t start = 0;
            while (start < raw.size()) {
                size_t sep = raw.find('|', start);
                std::string token = raw.substr(
                    start,
                    (sep == std::string::npos) ? std::string::npos : sep - start
                );
                if (!token.empty())
                    candidates.push_back(token);
                if (sep == std::string::npos)
                    break;
                start = sep + 1;
            }
        }

        if (candidates.empty()) {
            Logger::instance().logDebug(
                config_.id,
                "captureLoop_: no RTSP candidates found, aborting."
            );
            streamOnline_.store(false, std::memory_order_relaxed);
            buffer_.requestStop();
            running_ = false;
            return;
        }

        // --- Robust RTSP config (same as before) ---
        RtspOpenParams p;
        p.open_timeout_ms = config_.isDrakonFindTemporarySession ? 20000 : 5000;
        p.read_timeout_ms = config_.isDrakonFindTemporarySession ? 5000 : 3000;
        p.force_tcp = true;
        p.buffer_size_bytes = 4 * 1024 * 1024;
        p.max_delay_us = 2'000'000; // optional: reduce latency vs 5s
        p.enable_reconnect = true;
        p.reconnect_max_delay_s = 5; // optional: was 10

        // Troque true/false pra comparar rápido
        const bool kUsePumpMode = true;
        p.low_cpu_skip_nonref = kUsePumpMode;


        RtspCapture cap;
        std::string activeUrl;
        std::string lastErr;


        MotionUpdateParams mdNormal; // usa defaults internos (tudo nullopt)

        MotionUpdateParams mdPump;   // mais robusto contra noise/luz em 1 FPS
        mdPump.thresholdValue = 22;   // era 20
        mdPump.minChangedPixels = 100;  // era 80 (mata speckle/noise)
        mdPump.sensitivity = 0.022; // era 0.02 (slow path usa *0.5 => 0.02)
        mdPump.bgAlpha = 0.03; // era 0.2 aprende luz mais rápido (menos falso positivo por sombra)
        mdPump.globalChangeFrac = 0.5;  // opcional (era 0.5)


        auto openAnyCandidate = [&]() -> bool {
            lastErr.clear();
            activeUrl.clear();

            for (size_t i = 0; i < candidates.size(); ++i) {
                p.url = candidates[i];
                Logger::instance().logDebug(config_.id,
                    "captureLoop_: trying RTSP candidate[" + std::to_string(i) + "] = " + p.url);

                if (cap.open(p)) {
                    activeUrl = p.url;
                    streamOnline_.store(true, std::memory_order_relaxed);
                    Logger::instance().logDebug(config_.id,
                        "captureLoop_: opened RTSP candidate[" + std::to_string(i) + "] = " + activeUrl);
                    return true;
                }

                lastErr = cap.lastError();
                Logger::instance().logDebug(config_.id,
                    "captureLoop_: failed candidate[" + std::to_string(i) + "]: " + lastErr);
            }
            return false;
            };

        // --- Initial connect / reconnect notifications ---
        int backoffSec = 1;
        int initialReconnectAttempt = 0;
        int runtimeReconnectAttempt = 0;
        constexpr auto kReconnectReminderInterval = std::chrono::minutes(2);
        auto startupLastReconnectNotificationAt = std::chrono::steady_clock::time_point{};
        auto runtimeLastReconnectNotificationAt = std::chrono::steady_clock::time_point{};
        auto offlineSince = std::chrono::steady_clock::time_point{};

        auto buildReconnectNotificationMessage = [&](const std::string& phase,
            bool isReminder,
            int attemptNo,
            int nextRetryDelaySec)
        {
            std::string message;
            if (phase == "startup") {
                message = isReminder
                    ? "Camera is still offline. Automatic reconnection is still trying to connect."
                    : "Camera could not be started. Automatic reconnection is trying to connect.";
            }
            else {
                message = isReminder
                    ? "Camera is still offline. Automatic reconnection is still trying to reconnect."
                    : "Camera connection was lost. Automatic reconnection is trying to restore the stream.";
            }

            if (attemptNo > 0) {
                message += " Attempt #" + std::to_string(attemptNo) + ".";
            }
            if (nextRetryDelaySec > 0) {
                message += " Next retry in about " + std::to_string(nextRetryDelaySec) + "s.";
            }

            return message;
        };

        auto notifyReconnectStatus = [&](const std::string& phase,
            bool isReminder,
            int attemptNo,
            int nextRetryDelaySec,
            const std::string& reason)
        {
            if (!owner_ ||
                config_.isDrakonFindTemporarySession ||
                config_.isVideoSearchTemporarySession) return;

            nlohmann::json extraDetails = nlohmann::json::object();
            extraDetails["failure_phase"] = phase;
            extraDetails["candidate_count"] = static_cast<int>(candidates.size());
            extraDetails["reconnecting"] = true;
            extraDetails["notification_kind"] = isReminder ? "reminder" : "initial";
            if (attemptNo > 0) {
                extraDetails["attempt_number"] = attemptNo;
            }
            if (nextRetryDelaySec > 0) {
                extraDetails["next_retry_delay_seconds"] = nextRetryDelaySec;
            }
            if (!reason.empty()) {
                extraDetails["failure_reason_raw"] = reason;
            }
            if (offlineSince.time_since_epoch().count() > 0) {
                const auto offlineSeconds = std::chrono::duration_cast<std::chrono::seconds>(
                    std::chrono::steady_clock::now() - offlineSince
                ).count();
                if (offlineSeconds >= 0) {
                    extraDetails["offline_seconds"] = offlineSeconds;
                }
            }
            const std::string runtimeStartOrigin = currentStartOrigin_();
            if (!runtimeStartOrigin.empty()) {
                extraDetails["start_origin"] = runtimeStartOrigin;
            }
            if (!config_.cameraSessionId.empty()) {
                extraDetails["camera_session_id"] = config_.cameraSessionId;
                extraDetails["event_id"] =
                    config_.cameraSessionId +
                    ":camera_connection_failed:" +
                    phase + ":" +
                    std::to_string(attemptNo) +
                    (isReminder ? ":reminder" : ":first");
            }
            {
                std::lock_guard<std::mutex> lock(algorithmsMutex_);
                if (!config_.enabledAlgorithms.empty()) {
                    extraDetails["enabled_algorithms"] = config_.enabledAlgorithms;
                }
            }
            if (config_.isDrakonFindTemporarySession) {
                extraDetails["temporary_session"] = true;
            }

            owner_->notifyCameraConnectionError(
                config_.id,
                config_.rtspUrl,
                buildReconnectNotificationMessage(phase, isReminder, attemptNo, nextRetryDelaySec),
                extraDetails
            );
        };

        auto maybeNotifyReconnectStatus = [&](const std::string& phase,
            bool forceNow,
            int attemptNo,
            int nextRetryDelaySec,
            const std::string& reason)
        {
            auto& lastNotificationAt =
                phase == "startup"
                ? startupLastReconnectNotificationAt
                : runtimeLastReconnectNotificationAt;
            const auto now = std::chrono::steady_clock::now();
            const bool hasPreviousNotification = lastNotificationAt.time_since_epoch().count() != 0;
            if (!forceNow && hasPreviousNotification &&
                (now - lastNotificationAt) < kReconnectReminderInterval) {
                return;
            }

            lastNotificationAt = now;
            notifyReconnectStatus(
                phase,
                hasPreviousNotification,
                attemptNo,
                nextRetryDelaySec,
                reason
            );
        };

        auto notifyCameraOnline = [&](const std::string& onlinePhase,
            int reconnectAttempts)
        {
            if (!owner_ ||
                config_.isDrakonFindTemporarySession ||
                config_.isVideoSearchTemporarySession) return;

            try {
                nlohmann::json details = nlohmann::json::object();
                details["online_phase"] = onlinePhase;
                details["recovered"] = reconnectAttempts > 0;
                if (reconnectAttempts > 0) {
                    details["reconnect_attempts"] = reconnectAttempts;
                }
                const std::string runtimeStartOrigin = currentStartOrigin_();
                if (!runtimeStartOrigin.empty()) {
                    details["start_origin"] = runtimeStartOrigin;
                }
                if (!config_.cameraSessionId.empty()) {
                    details["camera_session_id"] = config_.cameraSessionId;
                    details["event_id"] =
                        config_.cameraSessionId + ":" +
                        (reconnectAttempts > 0 ? "camera_recovered:" : "camera_online:") +
                        std::to_string(reconnectAttempts);
                }
                {
                    std::lock_guard<std::mutex> lock(algorithmsMutex_);
                    if (!config_.enabledAlgorithms.empty()) {
                        details["enabled_algorithms"] = config_.enabledAlgorithms;
                    }
                }
                if (!activeUrl.empty()) {
                    details["active_rtsp_url"] = activeUrl;
                }

                const int cameraIdValue = std::stoi(config_.id);
                owner_->postAgentEvent(
                    reconnectAttempts > 0 ? "camera_recovered" : "camera_online",
                    cameraIdValue,
                    "",
                    reconnectAttempts > 0
                        ? "Camera connection restored. Stream is back online."
                        : "Camera connected successfully and is online.",
                    details
                );
            }
            catch (...) {
            }
        };

        while (running_ && activeUrl.empty()) {
            // Keep retention cleanup active even when RTSP is still trying to connect.
            // Otherwise, old clips may never be removed while the camera stays offline.
            if (config_.storage.retentionDays > 0) {
                try {
                    frameDiskWriter_.runRetentionCleanupIfDue();
                }
                catch (...) {
                    Logger::instance().logDebug(
                        config_.id,
                        "captureLoop_ (rtsp init-connect): retention cleanup threw"
                    );
                }
            }

            if (openAnyCandidate()) {
                break;
            }

            if (offlineSince.time_since_epoch().count() == 0) {
                offlineSince = std::chrono::steady_clock::now();
                startupLastReconnectNotificationAt = std::chrono::steady_clock::time_point{};
            }

            ++initialReconnectAttempt;
            telemetryReconnectCount_.fetch_add(1, std::memory_order_relaxed);
            maybeNotifyReconnectStatus(
                "startup",
                initialReconnectAttempt == 1,
                initialReconnectAttempt,
                backoffSec,
                lastErr.empty() ? "failed to open any RTSP candidate" : lastErr
            );

            std::this_thread::sleep_for(std::chrono::seconds(backoffSec));
            backoffSec = std::min(backoffSec * 2, 30); // cap at 30s
        }

        if (!running_) {
            streamOnline_.store(false, std::memory_order_relaxed);
            buffer_.requestStop();
            return;
        }
        if (activeUrl.empty()) {
            streamOnline_.store(false, std::memory_order_relaxed);
            buffer_.requestStop();
            return;
        }

        // connected now
        backoffSec = 1;
        runtimeReconnectAttempt = 0;
        startupLastReconnectNotificationAt = std::chrono::steady_clock::time_point{};
        offlineSince = std::chrono::steady_clock::time_point{};
        notifyCameraOnline(
            initialReconnectAttempt > 0 ? "startup_reconnected" : "startup_connected",
            initialReconnectAttempt
        );




        // ---- from here down your loop is unchanged, except logs now use activeUrl if you want ----

        std::deque<std::chrono::steady_clock::time_point> timestampHistory;
        constexpr size_t kFpsWindow = 30;

        int consecutiveReadFails = 0;
        const int   kFailsBeforeReopen = 2;
        const auto  kReadFailSleep = std::chrono::milliseconds(100);


        // Intervalo de envio para a thread de inferência,
        // vindo de cfg.frameCaptureIntervalSeconds (1, 8, 12, etc.)
        const int intervalSeconds = (config_.frameCaptureIntervalSeconds > 0)
            ? config_.frameCaptureIntervalSeconds
            : 12; // fallback

        const auto enqueueInterval = std::chrono::seconds(intervalSeconds);
        auto lastSentToBuffer = std::chrono::steady_clock::now() - enqueueInterval;


        Logger::instance().logDebug(
            config_.id,
            "captureLoop_ StorageConfig: storeFrames=" +
            std::string(config_.storage.storeFrames ? "true" : "false") +
            ", retentionDays=" + std::to_string(config_.storage.retentionDays)
        );

        bool offline = false;
        auto nextTick = std::chrono::steady_clock::now();

        auto onOffline = [&](const std::string& reason) {
            if (!offline) {
                offline = true;
                offlineSince = std::chrono::steady_clock::now();
                runtimeLastReconnectNotificationAt = std::chrono::steady_clock::time_point{};
                Logger::instance().logDebug(config_.id, "RTSP OFFLINE: " + reason);
                streamOnline_.store(false, std::memory_order_relaxed);
                if (owner_) {
                    maybeNotifyReconnectStatus("runtime", true, 0, 1, reason);
                }
                // Important: do NOT requestStop here (that’s for shutdown).
                buffer_.clearBuffer(); // flush stale frames while offline
            }
            };

        auto onOnline = [&]() {
            if (offline) {
                const int reconnectAttempts = runtimeReconnectAttempt;
                offline = false;
                streamOnline_.store(true, std::memory_order_relaxed);
                runtimeLastReconnectNotificationAt = std::chrono::steady_clock::time_point{};
                offlineSince = std::chrono::steady_clock::time_point{};
                notifyCameraOnline("runtime_reconnected", reconnectAttempts);
                runtimeReconnectAttempt = 0;
                Logger::instance().logDebug(config_.id, "RTSP ONLINE again: " + activeUrl);
            }
            };


        while (running_) {
            const auto& activeRecordingProfiles = refreshRecordingProfiles();
            const int activeRecordingFps = (std::max)(
                captureProfileFpsForSeconds_(activeRecordingProfiles, 10),
                captureProfileFpsForSeconds_(activeRecordingProfiles, 60)
            );
            if (config_.storage.retentionDays > 0) {
                try {
                    frameDiskWriter_.runRetentionCleanupIfDue();
                }
                catch (...) {
                    Logger::instance().logDebug(config_.id, "captureLoop_ (rtsp): retention cleanup threw");
                }
            }

            cv::Mat frameMat;

            if (!kUsePumpMode) {
                const auto captureReadStartedAt = std::chrono::steady_clock::now();
                const bool readOk = cap.read(frameMat) && !frameMat.empty();
                const auto captureReadLatencyUs = static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::steady_clock::now() - captureReadStartedAt
                    ).count()
                );
                telemetryCaptureReadLatencyTotalUs_.fetch_add(
                    captureReadLatencyUs,
                    std::memory_order_relaxed
                );
                telemetryCaptureReadSamples_.fetch_add(1, std::memory_order_relaxed);
                telemetryDecodeLatencyTotalUs_.fetch_add(
                    captureReadLatencyUs,
                    std::memory_order_relaxed
                );
                telemetryDecodeSamples_.fetch_add(1, std::memory_order_relaxed);

                if (!readOk) {
                    ++consecutiveReadFails;

                    if (consecutiveReadFails >= kFailsBeforeReopen) {
                        onOffline("Capture stalled: " + cap.lastError());

                        // Hard reset and reconnect (try all candidates)
                        streamOnline_.store(false, std::memory_order_relaxed);
                        cap.close();
                        activeUrl.clear();

                        int reconnectBackoff = 1;
                        while (running_ && !openAnyCandidate()) {
                            ++runtimeReconnectAttempt;
                            telemetryReconnectCount_.fetch_add(1, std::memory_order_relaxed);
                            maybeNotifyReconnectStatus(
                                "runtime",
                                false,
                                runtimeReconnectAttempt,
                                reconnectBackoff,
                                lastErr.empty() ? "failed to reconnect to any RTSP candidate" : lastErr
                            );
                            std::this_thread::sleep_for(std::chrono::seconds(reconnectBackoff));
                            reconnectBackoff = (std::min)(reconnectBackoff * 2, 30);

                        }

                        if (!running_) break;

                        consecutiveReadFails = 0;
                        onOnline();
                    }
                    else {
                        std::this_thread::sleep_for(std::chrono::milliseconds(200));
                    }

                    continue;
                }
            
            }
            // CONVERTER PARA BGR APENAS 1 FRAME POR SEGUNDO
            else {
                const int normalizedRecordingFps = activeRecordingFps > 0 ? activeRecordingFps : 1;
                const auto tick = std::chrono::milliseconds(
                    (std::max)(1, static_cast<int>(std::llround(1000.0 / static_cast<double>(normalizedRecordingFps))))
                );

                // mantém RTSP fluindo sem converter pra BGR
                const auto captureReadStartedAt = std::chrono::steady_clock::now();
                const bool pumpOk = cap.pump(false, nullptr);
                const auto captureReadLatencyUs = static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::steady_clock::now() - captureReadStartedAt
                    ).count()
                );
                telemetryCaptureReadLatencyTotalUs_.fetch_add(
                    captureReadLatencyUs,
                    std::memory_order_relaxed
                );
                telemetryCaptureReadSamples_.fetch_add(1, std::memory_order_relaxed);

                if (!pumpOk) {
                    ++consecutiveReadFails;
                    if (consecutiveReadFails >= kFailsBeforeReopen) {
                        onOffline("Capture stalled: " + cap.lastError());

                        // Hard reset and reconnect (try all candidates)
                        streamOnline_.store(false, std::memory_order_relaxed);
                        cap.close();
                        activeUrl.clear();

                        int reconnectBackoff = 1;
                        while (running_ && !openAnyCandidate()) {
                            ++runtimeReconnectAttempt;
                            telemetryReconnectCount_.fetch_add(1, std::memory_order_relaxed);
                            maybeNotifyReconnectStatus(
                                "runtime",
                                false,
                                runtimeReconnectAttempt,
                                reconnectBackoff,
                                lastErr.empty() ? "failed to reconnect to any RTSP candidate" : lastErr
                            );
                            std::this_thread::sleep_for(std::chrono::seconds(reconnectBackoff));
                            reconnectBackoff = (std::min)(reconnectBackoff * 2, 30);

                        }

                        if (!running_) break;

                        consecutiveReadFails = 0;
                        onOnline();
                    }
                    else {
                        std::this_thread::sleep_for(std::chrono::milliseconds(200));
                    }

                    continue;
                }

                auto nowTick = std::chrono::steady_clock::now();
                if (nowTick < nextTick) {
                    continue; // ainda não é hora do próximo frame (5 FPS)
                }

                // hora do sample: tenta obter 1 Mat (BGR) numa janela curta
                const auto decodeStartedAt = std::chrono::steady_clock::now();
                const auto deadline = nowTick + std::chrono::milliseconds(180);
                while (running_ && std::chrono::steady_clock::now() < deadline) {
                    cap.pump(true, &frameMat);
                    if (!frameMat.empty()) break;
                }
                const auto decodeLatencyUs = static_cast<std::uint64_t>(
                    std::chrono::duration_cast<std::chrono::microseconds>(
                        std::chrono::steady_clock::now() - decodeStartedAt
                    ).count()
                );
                telemetryDecodeLatencyTotalUs_.fetch_add(
                    decodeLatencyUs,
                    std::memory_order_relaxed
                );
                telemetryDecodeSamples_.fetch_add(1, std::memory_order_relaxed);

                nextTick = std::chrono::steady_clock::now() + tick;

                if (frameMat.empty()) {
                    // não conseguiu produzir Mat nesse tick; tenta no próximo ciclo
                    continue;
                }
            
            }

            consecutiveReadFails = 0;


            // --- Resize Frame ---
            {
                //const int targetW = 1024;
                //const int targetH = 768;

                const int targetW = 1920;
                const int targetH = 1080;

                // Only downscale (avoid upscaling noisy low-res streams)
                if (frameMat.cols > targetW || frameMat.rows > targetH) {
                    cv::Mat resized;
                    cv::resize(
                        frameMat,
                        resized,
                        cv::Size(targetW, targetH),
                        0, 0,
                        cv::INTER_AREA   // best for downscaling
                    );
                    frameMat = std::move(resized);
                }
            }


            auto now = std::chrono::steady_clock::now();
            telemetryLastFrameTickMs_.store(steadyToMs_(now), std::memory_order_relaxed);
            telemetryFrameWidth_.store(frameMat.cols, std::memory_order_relaxed);
            telemetryFrameHeight_.store(frameMat.rows, std::memory_order_relaxed);

            maybeUpdateJobStill_(frameMat, now);

            // salva o primeiro frame na memoria para descrição de ambiente <<< 
            if (!firstFrameSaved_.load(std::memory_order_acquire)) {
                std::lock_guard<std::mutex> lock(firstFrameMutex_);
                if (!firstFrameSaved_.load(std::memory_order_relaxed)) {
                    firstFrameForDescription_ = frameMat.clone();   // cópia independente
                    firstFrameSaved_.store(true, std::memory_order_release);

                    Logger::instance().logDebug(
                        config_.id,
                        "captureLoop_: stored firstFrameForDescription_"
                    );
                }
            }

            // Launch one-time description check in background
            checkCameraDescriptionOnce_();


            


            // Update MotionDetector
            try {
                if (kUsePumpMode) motionDetector_.update(frameMat, mdPump);
                else              motionDetector_.update(frameMat, mdNormal);

                //motionDetector_.update(frameMat);
            }
            catch (const std::exception& e) {
                Logger::instance().logDebug(config_.id,
                    std::string("motionDetector_.update() EXCEPTION: ") + e.what());
                continue; // não mate a thread, apenas pule este frame
            }
            catch (...) {
                Logger::instance().logDebug(config_.id,
                    "motionDetector_.update() UNKNOWN EXCEPTION");
                continue;
            }

            bool recent = motionDetector_.hasRecentMotion();
            bool prevInf = inferenceEnabled_.load(std::memory_order_relaxed);
            if (recent) {
                lastMotionForImageSnapshot_ = now;
            }


            maybePublishDashboardThumbnail_(frameMat, now);

            

            // save history frames (motion-only by default; can be overridden per active job/camera)
            bool prevCap = captureEnabled_.load(std::memory_order_relaxed);
            const bool captureOnMotionOnly = shouldOnlyCaptureOnMotion();
            const bool forceVideoCapture = shouldForceVideoCapture_();
            const bool forceBootstrapCapture = config_.storage.storeFrames ? consumeBootstrapCaptureOnce() : false;
            bool forceImageSnapshotTick = false;
            if (config_.storage.storeFrames) {
                const bool hasMotionInSnapshotWindow =
                    lastMotionForImageSnapshot_ != std::chrono::steady_clock::time_point::min() &&
                    (now - lastMotionForImageSnapshot_) <= std::chrono::seconds(60);
                forceImageSnapshotTick =
                    hasMotionInSnapshotWindow &&
                    frameDiskWriter_.shouldEmitImageSnapshotOnlyNow();
            }
            const bool captureEnabled =
                config_.storage.storeFrames &&
                (forceVideoCapture || recent || !captureOnMotionOnly || forceBootstrapCapture || forceImageSnapshotTick);
            if (captureEnabled) {
                try {
                    frameDiskWriter_.save(frameMat);
                }
                catch (const std::exception& e) {
                    Logger::instance().logDebug(config_.id,
                        std::string("frameDiskWriter_.save() EXCEPTION: ") + e.what());
                }
                catch (...) {
                    Logger::instance().logDebug(config_.id,
                        "frameDiskWriter_.save() UNKNOWN EXCEPTION");
                }
            }
            //if (config_.storage.storeFrames && recent) {
                //frameDiskWriter_.save(frameMat);
            //}
            

            if (recent) {
                lastMotionSeen_ = now;
            }
            captureEnabled_.store(captureEnabled, std::memory_order_relaxed);
            inferenceEnabled_.store(recent, std::memory_order_relaxed);

            if (config_.storage.storeFrames) {
                try {
                    frameDiskWriter_.flushVideoClipIfIdle(std::chrono::seconds(10));
                }
                catch (const std::exception& e) {
                    Logger::instance().logDebug(config_.id,
                        std::string("frameDiskWriter_.flushVideoClipIfIdle() EXCEPTION: ") + e.what());
                }
                catch (...) {
                    Logger::instance().logDebug(config_.id,
                        "frameDiskWriter_.flushVideoClipIfIdle() UNKNOWN EXCEPTION");
                }
            }

            // Decide if we should skip sending frames to inference
            bool idleLong = (now - lastMotionSeen_) >= kIdlePurgeDelay;
            skipFrames_.store(idleLong, std::memory_order_relaxed);

            // Only enqueue when not skipping AND respecting frame_rate interval
            if (!skipFrames_.load(std::memory_order_relaxed)) {
                if ((now - lastSentToBuffer) >= enqueueInterval) {
                    Frame frame;
                    frame.timestamp = now;
                    frame.image = frameMat;
                    frame.cameraId = config_.id;

                    buffer_.push(std::move(frame));
                    lastSentToBuffer = now;

                    timestampHistory.push_back(now);
                    if (timestampHistory.size() > kFpsWindow) {
                        timestampHistory.pop_front();
                    }

                    Logger::instance().logDebug(
                        config_.id,
                        "captureLoop_: enqueued frame to buffer (intervalSeconds=" +
                        std::to_string(intervalSeconds) + ")"
                    );
                }
            }

            if (captureEnabled != prevCap) {
                Logger::instance().logDebug(
                    config_.id,
                    "captureEnabled=" + std::to_string(captureEnabled ? 1 : 0)
                );
            }

            if (recent != prevInf) {
                Logger::instance().logDebug(
                    config_.id,
                    "inferenceEnabled=" + std::to_string(recent ? 1 : 0)
                );
            }

            // measure cpu usage
            auto tnow = std::chrono::steady_clock::now();
            if (tnow - lastCpuLog >= std::chrono::seconds(5)) {
                double pct = cpuMeter.samplePercent(); // % de 1 core no intervalo
                const double actualFps = fpsFromHistory_(timestampHistory);
                const size_t queueDepthRaw = buffer_.size();
                const int queueDepth = static_cast<int>(
                    std::min<size_t>(queueDepthRaw, static_cast<size_t>(std::numeric_limits<int>::max()))
                );

                std::uint64_t processWorkingSetBytes = 0;
                std::uint64_t processPrivateBytes = 0;
                readProcessMemorySnapshot_(processWorkingSetBytes, processPrivateBytes);

                std::uint64_t frameBytes = 0;
                if (!frameMat.empty()) {
                    const std::uint64_t pixels = static_cast<std::uint64_t>(frameMat.total());
                    const std::uint64_t bytesPerPixel = static_cast<std::uint64_t>(frameMat.elemSize());
                    if (
                        bytesPerPixel > 0 &&
                        pixels > 0 &&
                        pixels <= (std::numeric_limits<std::uint64_t>::max() / bytesPerPixel)
                        ) {
                        frameBytes = pixels * bytesPerPixel;
                    }
                }
                std::uint64_t captureMemEstimatedBytes = frameBytes;
                if (frameBytes > 0) {
                    const std::uint64_t estimatedBufferedFrames =
                        static_cast<std::uint64_t>(queueDepth) + 1ULL;
                    if (estimatedBufferedFrames <=
                        (std::numeric_limits<std::uint64_t>::max() / frameBytes)) {
                        captureMemEstimatedBytes = estimatedBufferedFrames * frameBytes;
                    }
                    else {
                        captureMemEstimatedBytes = std::numeric_limits<std::uint64_t>::max();
                    }
                }

                Logger::instance().logDebug(
                    config_.id,
                    "captureLoop_ CPU(thread) ~ " + std::to_string(pct) + "% of 1 core (avg last 5s)"
                );

                telemetryActualFps_.store(actualFps, std::memory_order_relaxed);
                telemetryQueueDepth_.store(queueDepth, std::memory_order_relaxed);
                telemetryCaptureThreadCpuPercent_.store(pct, std::memory_order_relaxed);
                telemetryCaptureMemEstimatedBytes_.store(captureMemEstimatedBytes, std::memory_order_relaxed);
                telemetryProcessWorkingSetBytes_.store(processWorkingSetBytes, std::memory_order_relaxed);
                telemetryProcessPrivateBytes_.store(processPrivateBytes, std::memory_order_relaxed);

                if (owner_ && cameraNumericId > 0) {
                    const std::string clientId = owner_->getClientId();
                    const std::string exeToken = owner_->getExeToken();
                    const std::string backendBaseUrl = owner_->getBackendBaseUrl();
                    if (!clientId.empty() && !exeToken.empty() && !backendBaseUrl.empty()) {
                        CaptureThreadMetricSample sample;
                        sample.backendBaseUrl = backendBaseUrl;
                        sample.clientId = clientId;
                        sample.exeToken = exeToken;
                        sample.cameraId = cameraNumericId;
                        sample.threadName = "captureLoop";
                        sample.cpuPercent = pct;
                        sample.captureMemEstimatedBytes = captureMemEstimatedBytes;
                        sample.processWorkingSetBytes = processWorkingSetBytes;
                        sample.processPrivateBytes = processPrivateBytes;
                        sample.queueDepth = queueDepth;
                        sample.sampledAtIso = nowUtcIso8601Ms_();
                        enqueueCaptureThreadMetricSample_(std::move(sample));
                    }
                }

                lastCpuLog = tnow;
            }


        }


        streamOnline_.store(false, std::memory_order_relaxed);
        cap.close();

    }
    catch (const std::exception& e) {
        Logger::instance().logDebug(
            config_.id,
            std::string("captureLoop_ crashed with std::exception: ") + e.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            config_.id,
            "captureLoop_ crashed with unknown exception."
        );
    }

    streamOnline_.store(false, std::memory_order_relaxed);
    buffer_.requestStop();
    Logger::instance().logDebug(config_.id, "captureLoop_ exiting.");
}





static std::wstring utf8ToWide(const std::string& str)
{
    if (str.empty()) return L"";

    int size_needed = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), nullptr, 0);
    std::wstring result(size_needed, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), (int)str.size(), &result[0], size_needed);
    return result;
}



static std::string getExecutableDir()
{
    char buffer[MAX_PATH];
    DWORD len = GetModuleFileNameA(NULL, buffer, MAX_PATH);
    if (len == 0) {
        return "";
    }

    // Convert full EXE path ? parent folder
    fs::path exePath(buffer);
    return exePath.parent_path().string();
}

static bool runHiddenProcessCamera_(
    const std::wstring& cmdLine,
    DWORD& outExitCode,
    std::string* outErr = nullptr)
{
    outExitCode = 1;

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi{};
    std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
    cmdBuf.push_back(L'\0');

    const BOOL ok = CreateProcessW(
        nullptr,
        cmdBuf.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        nullptr,
        &si,
        &pi
    );
    if (!ok) {
        if (outErr) *outErr = "CreateProcessW failed";
        return false;
    }

    WaitForSingleObject(pi.hProcess, INFINITE);
    GetExitCodeProcess(pi.hProcess, &outExitCode);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
}

static bool buildOpenCvCompatibleClipWithFfmpegCamera_(
    const std::string& inputPath,
    std::string& outNormalizedPath,
    std::string* outErr = nullptr)
{
    outNormalizedPath = inputPath + ".opencv_normalized.mp4";

    std::error_code ec;
    fs::remove(fs::path(outNormalizedPath), ec);

    fs::path ffmpegPath = fs::path(getExecutableDir()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(inputPath);
    std::wstring outW = utf8ToWide(outNormalizedPath);

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -i \"" + inW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    DWORD exitCode = 1;
    if (!runHiddenProcessCamera_(cmdLine, exitCode, outErr)) {
        return false;
    }

    if (exitCode != 0) {
        if (outErr) *outErr = "ffmpeg normalize failed rc=" + std::to_string(exitCode);
        return false;
    }

    if (!fs::exists(fs::path(outNormalizedPath), ec) || ec) {
        if (outErr) *outErr = "normalized output missing: " + outNormalizedPath;
        return false;
    }

    return true;
}

static bool buildFrameWindowCroppedClipWithFfmpegCamera_(
    const std::string& srcClipPath,
    const AlgorithmConfig::FrameWindowNorm& frameWindow,
    std::string& outClipPath,
    std::string* outErr)
{
    outClipPath.clear();
    if (!isFrameWindowActiveCamera_(frameWindow)) {
        if (outErr) *outErr = "frame window inactive";
        return false;
    }

    std::error_code ec;
    const fs::path srcPath(srcClipPath);
    if (!fs::exists(srcPath, ec) || ec) {
        if (outErr) *outErr = "source clip missing: " + srcClipPath;
        return false;
    }

    fs::path ffmpegPath = fs::path(getExecutableDir()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    const double x1Norm = (std::max)(0.0, (std::min)(1.0, frameWindow.x));
    const double y1Norm = (std::max)(0.0, (std::min)(1.0, frameWindow.y));
    const double x2Norm =
        (std::max)(x1Norm + 1e-6, (std::min)(1.0, frameWindow.x + frameWindow.width));
    const double y2Norm =
        (std::max)(y1Norm + 1e-6, (std::min)(1.0, frameWindow.y + frameWindow.height));
    const double widthNorm = x2Norm - x1Norm;
    const double heightNorm = y2Norm - y1Norm;
    if (widthNorm <= 1e-6 || heightNorm <= 1e-6) {
        if (outErr) *outErr = "frame window crop rect invalid";
        return false;
    }

    auto fmt = [](double value) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(6) << value;
        return oss.str();
    };

    const std::string widthExpr =
        "max(2,trunc(iw*" + fmt(widthNorm) + "/2)*2)";
    const std::string heightExpr =
        "max(2,trunc(ih*" + fmt(heightNorm) + "/2)*2)";
    const std::string xExpr =
        "max(0,trunc(iw*" + fmt(x1Norm) + "/2)*2)";
    const std::string yExpr =
        "max(0,trunc(ih*" + fmt(y1Norm) + "/2)*2)";
    const std::string cropFilter =
        "crop=w='" + widthExpr +
        "':h='" + heightExpr +
        "':x='" + xExpr +
        "':y='" + yExpr + "'";

    outClipPath = srcClipPath + ".frame_window.mp4";
    fs::remove(fs::path(outClipPath), ec);

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(srcClipPath);
    std::wstring outW = utf8ToWide(outClipPath);
    std::wstring filterW = utf8ToWide(cropFilter);

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -i \"" + inW + L"\""
        L" -vf \"" + filterW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    DWORD exitCode = 1;
    if (!runHiddenProcessCamera_(cmdLine, exitCode, outErr)) {
        return false;
    }
    if (exitCode != 0) {
        if (outErr) {
            *outErr =
                "ffmpeg frame-window crop failed rc=" + std::to_string(exitCode) +
                " src=" + describeClipPathForLogsCamera_(srcClipPath) +
                " filter=" + cropFilter;
        }
        return false;
    }

    if (!waitForReadableClipPathCamera_(outClipPath, outErr)) {
        return false;
    }

    return true;
}

static bool extractBoundaryFrameToMatFromClipCamera_(
    const std::string& clipPath,
    bool useLastMoment,
    cv::Mat& outFrame,
    std::string* outErr)
{
    outFrame.release();

    std::error_code ec;
    const fs::path srcPath(clipPath);
    if (!fs::exists(srcPath, ec) || ec) {
        if (outErr) *outErr = "source clip missing: " + clipPath;
        return false;
    }

    fs::path ffmpegPath = fs::path(getExecutableDir()) / "ffmpeg.exe";
    if (!fs::exists(ffmpegPath, ec) || ec) {
        if (outErr) *outErr = "ffmpeg missing: " + ffmpegPath.string();
        return false;
    }

    fs::path jpgPath = srcPath;
    jpgPath +=
        (useLastMoment ? ".lastframe_" : ".firstframe_") +
        std::to_string(steadyNowMs_()) + "_" +
        std::to_string(static_cast<unsigned long>(GetCurrentThreadId())) +
        ".jpg";
    fs::remove(jpgPath, ec);

    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring inW = utf8ToWide(clipPath);
    std::wstring outW = utf8ToWide(jpgPath.string());

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error ";
    if (useLastMoment) {
        cmdLine += L" -sseof -0.20 ";
    }
    cmdLine +=
        L" -i \"" + inW + L"\""
        L" -frames:v 1 -q:v 3 "
        L" \"" + outW + L"\"";

    DWORD exitCode = 1;
    if (!runHiddenProcessCamera_(cmdLine, exitCode, outErr)) {
        return false;
    }
    if (exitCode != 0 && useLastMoment) {
        cmdLine =
            L"\"" + ffmpegW + L"\""
            L" -y -hide_banner -loglevel error"
            L" -i \"" + inW + L"\""
            L" -frames:v 1 -q:v 3 "
            L" \"" + outW + L"\"";
        if (!runHiddenProcessCamera_(cmdLine, exitCode, outErr)) {
            return false;
        }
    }

    if (exitCode != 0 || !fs::exists(jpgPath, ec) || ec) {
        if (outErr) {
            *outErr =
                "ffmpeg boundary frame extract failed rc=" + std::to_string(exitCode) +
                " clip=" + clipPath;
        }
        return false;
    }

    outFrame = cv::imread(jpgPath.string(), cv::IMREAD_COLOR);
    std::error_code rmEc;
    fs::remove(jpgPath, rmEc);
    if (outFrame.empty()) {
        if (outErr) *outErr = "cv::imread failed for extracted frame";
        return false;
    }

    return true;
}

static bool tryOpenVideoCaptureWithPreferredBackendsCamera_(
    const std::string& clipPath,
    cv::VideoCapture& outCap)
{
    ensureOpenCvVideoIoThreadReadyCamera_();

    if (clipPath.empty()) {
        outCap.release();
        return false;
    }

#ifdef _WIN32
    const std::vector<int> apiPreferences = {
        cv::CAP_FFMPEG,
        cv::CAP_MSMF,
        cv::CAP_ANY
    };
#else
    const std::vector<int> apiPreferences = {
        cv::CAP_FFMPEG,
        cv::CAP_ANY
    };
#endif
    for (const int apiPreference : apiPreferences) {
        outCap.release();
        if (outCap.open(clipPath, apiPreference)) {
            return true;
        }
    }

    outCap.release();
    return false;
}

static bool tryOpenVideoCaptureWithRetryCamera_(
    const std::string& clipPath,
    cv::VideoCapture& outCap)
{
    constexpr int kMaxOpenAttempts = 4;
    constexpr auto kRetryDelay = std::chrono::milliseconds(75);
    for (int attempt = 0; attempt < kMaxOpenAttempts; ++attempt) {
        if (tryOpenVideoCaptureWithPreferredBackendsCamera_(clipPath, outCap)) {
            return true;
        }
        if (attempt + 1 < kMaxOpenAttempts) {
            std::this_thread::sleep_for(kRetryDelay);
        }
    }
    return false;
}

static bool openVideoCaptureForClipPathCamera_(
    const std::string& clipPath,
    cv::VideoCapture& outCap,
    std::string& outTempOpenPath,
    std::string* outErr)
{
    outTempOpenPath.clear();
    outCap.release();

    auto clearTempPath = [](const std::string& path) {
        if (path.empty()) return;
        std::error_code ec;
        fs::remove(fs::path(path), ec);
    };
    auto tryOpen = [&](const std::string& path) -> bool {
        return tryOpenVideoCaptureWithRetryCamera_(path, outCap);
    };

    std::string readableErr;
    if (!waitForReadableClipPathCamera_(clipPath, &readableErr)) {
        if (outErr) *outErr = readableErr;
        return false;
    }

    if (tryOpen(clipPath)) {
        return true;
    }

    std::string normalizedPath;
    std::string normalizeErr;
    if (!buildOpenCvCompatibleClipWithFfmpegCamera_(clipPath, normalizedPath, &normalizeErr)) {
        if (outErr) {
            *outErr =
                "failed to normalize clip for OpenCV: " + normalizeErr +
                " src=" + describeClipPathForLogsCamera_(clipPath) +
                " normalized_output=" + normalizedPath;
        }
        return false;
    }

    readableErr.clear();
    if (!waitForReadableClipPathCamera_(normalizedPath, &readableErr)) {
        const std::string normalizedDesc = describeClipPathForLogsCamera_(normalizedPath);
        clearTempPath(normalizedPath);
        if (outErr) {
            *outErr =
                "normalized clip not readable yet normalized=" + normalizedDesc +
                " src=" + describeClipPathForLogsCamera_(clipPath) +
                " reason=" + readableErr;
        }
        return false;
    }

    if (!tryOpen(normalizedPath)) {
        const std::string normalizedDesc = describeClipPathForLogsCamera_(normalizedPath);
        clearTempPath(normalizedPath);
        if (outErr) {
            *outErr =
                "failed to open normalized clip normalized=" +
                normalizedDesc +
                " src=" + describeClipPathForLogsCamera_(clipPath);
        }
        return false;
    }

    outTempOpenPath = normalizedPath;
    return true;
}


static bool buildSampledClipWithFfmpeg(
    const std::string& inputPath,
    int analysisSpeed,
    std::string& outSampledPath,
    const std::string& cameraIdForLog
) {
    if (analysisSpeed <= 1) {
        // Caller shouldn't come here for 1, but be safe.
        outSampledPath = inputPath;
        return true;
    }

    // EXE dir + ffmpeg.exe
    fs::path ffmpegPath = fs::path(getExecutableDir()) / "ffmpeg.exe";
    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());

    // Output sampled clip path
    outSampledPath = inputPath + ".sampled.mp4";

    // Wide versions of input/output paths
    std::wstring inW = utf8ToWide(inputPath);
    std::wstring outW = utf8ToWide(outSampledPath);
    std::wstring fpsW = utf8ToWide(std::to_string(analysisSpeed));

    // ffmpeg command line (wide)
    /*
    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""                // "C:\...\Perceptrum\ffmpeg.exe"
        L" -y -i \"" + inW + L"\""             // -i "inputPath"
        L" -vf fps=1/" + fpsW +                // -vf fps=1/N
        L" -t 10 \"" + outW + L"\"";           // -t 10 "outSampledPath"
    */

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -i \"" + inW + L"\""
        L" -map 0:v:0 -an -sn -dn"
        L" -vf fps=1/" + fpsW +
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" \"" + outW + L"\"";


    // Optional: log a UTF-8 version of the command for debugging
    {
        std::string ffmpegPathStr = ffmpegPath.string();
        std::string cmdUtf8 =
            "\"" + ffmpegPathStr + "\" -y -i \"" + inputPath +
            "\" -vf fps=1/" + std::to_string(analysisSpeed) +
            " \"" + outSampledPath + "\"";

        Logger::instance().logDebug(
            cameraIdForLog,
            "buildSampledClipWithFfmpeg: running command: " + cmdUtf8
        );
    }

    // Standard CreateProcessW pattern (no console window)
    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    // Make mutable buffer for CreateProcessW
    std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
    cmdBuf.push_back(L'\0');

    BOOL ok = CreateProcessW(
        nullptr,            // lpApplicationName
        cmdBuf.data(),      // lpCommandLine
        nullptr,            // lpProcessAttributes
        nullptr,            // lpThreadAttributes
        FALSE,              // bInheritHandles
        CREATE_NO_WINDOW,   // dwCreationFlags (no terminal window)
        nullptr,            // lpEnvironment
        nullptr,            // lpCurrentDirectory
        &si,
        &pi
    );

    if (!ok) {
        DWORD err = GetLastError();
        Logger::instance().logDebug(
            cameraIdForLog,
            "buildSampledClipWithFfmpeg: CreateProcessW failed, GetLastError=" +
            std::to_string(err)
        );
        return false;
    }


    // Wait for ffmpeg to finish (max 5 seconds)
    constexpr DWORD kFfmpegTimeoutMs = 5000;
    DWORD waitRes = WaitForSingleObject(pi.hProcess, kFfmpegTimeoutMs);

    if (waitRes == WAIT_TIMEOUT) {
        Logger::instance().logDebug(
            cameraIdForLog,
            "buildSampledClipWithFfmpeg: ffmpeg TIMEOUT after 5s -> terminating process"
        );

        if (!TerminateProcess(pi.hProcess, 124)) {
            DWORD terr = GetLastError();
            Logger::instance().logDebug(
                cameraIdForLog,
                "buildSampledClipWithFfmpeg: TerminateProcess failed, GetLastError=" + std::to_string(terr)
            );
        }

        // Give it a moment to exit
        WaitForSingleObject(pi.hProcess, 2000);

        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);

        return false;
    }
    else if (waitRes != WAIT_OBJECT_0) {
        DWORD werr = GetLastError();
        Logger::instance().logDebug(
            cameraIdForLog,
            "buildSampledClipWithFfmpeg: WaitForSingleObject failed, GetLastError=" + std::to_string(werr)
        );

        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);

        return false;
    }

    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    if (exitCode != 0) {
        Logger::instance().logDebug(
            cameraIdForLog,
            "buildSampledClipWithFfmpeg: ffmpeg failed, exitCode=" +
            std::to_string(static_cast<int>(exitCode))
        );
        return false;
    }


    // Quick sanity check: can we open the result?
    std::ifstream test(outSampledPath, std::ios::binary);
    if (!test) {
        Logger::instance().logDebug(
            cameraIdForLog,
            "buildSampledClipWithFfmpeg: failed to open sampled clip: " + outSampledPath
        );
        return false;
    }

    Logger::instance().logDebug(
        cameraIdForLog,
        "buildSampledClipWithFfmpeg: successfully built sampled clip "
        "(analysis_speed=" + std::to_string(analysisSpeed) + "): " + outSampledPath
    );

    return true;
}

struct PendingInferenceClip_ {
    fs::path path;
    std::string startTs;
    std::string endTs;
    std::string clipKey;
    fs::file_time_type lastWrite{};
};

static std::vector<PendingInferenceClip_> collectPendingInferenceClipsForCamera_(
    const std::string& cameraId)
{
    std::vector<PendingInferenceClip_> out;
    std::error_code ec;
    const fs::path dir = getInferenceTempDirForCameraId(cameraId);
    if (!fs::exists(dir, ec) || ec || !fs::is_directory(dir, ec) || ec) {
        return out;
    }

    for (const auto& entry : fs::directory_iterator(dir, ec)) {
        if (ec) break;
        if (!entry.is_regular_file(ec)) {
            if (ec) break;
            continue;
        }
        if (entry.path().extension() != ".mp4") continue;

        PendingInferenceClip_ clip;
        clip.path = entry.path();
        if (!parseSegmentTsFromClipPathForInference_(entry.path(), clip.startTs, clip.endTs)) {
            continue;
        }
        clip.clipKey = !clip.endTs.empty() ? clip.endTs : entry.path().filename().string();
        clip.lastWrite = entry.last_write_time(ec);
        if (ec) break;
        out.push_back(std::move(clip));
    }

    if (ec) {
        out.clear();
        return out;
    }

    std::sort(out.begin(), out.end(), [](const PendingInferenceClip_& a, const PendingInferenceClip_& b) {
        if (a.clipKey != b.clipKey) return a.clipKey < b.clipKey;
        if (a.lastWrite != b.lastWrite) return a.lastWrite < b.lastWrite;
        return a.path.string() < b.path.string();
    });
    return out;
}

static int chooseAdaptiveInferenceBatchClipCount_(
    const std::vector<PendingInferenceClip_>& pending)
{
    if (pending.empty()) return 0;

    long long oldestAgeSeconds = 0;
    const auto nowFileClock = fs::file_time_type::clock::now();
    if (pending.front().lastWrite <= nowFileClock) {
        oldestAgeSeconds = std::chrono::duration_cast<std::chrono::seconds>(
            nowFileClock - pending.front().lastWrite
        ).count();
    }

    if (pending.size() >= 3 || oldestAgeSeconds >= 25) return 3;
    if (pending.size() >= 2 || oldestAgeSeconds >= 15) return 2;
    return 1;
}

static bool concatVideoClipsWithFfmpeg_(
    const std::vector<fs::path>& segments,
    const fs::path& outPath,
    const std::string& cameraIdForLog)
{
    if (segments.empty()) return false;

    std::error_code ec;
    fs::create_directories(outPath.parent_path(), ec);
    if (ec) {
        Logger::instance().logDebug(
            cameraIdForLog,
            "concatVideoClipsWithFfmpeg_: create_directories failed: " + ec.message()
        );
        return false;
    }

    fs::path listPath = outPath;
    listPath += ".concat.txt";
    {
        std::ofstream ofs(listPath, std::ios::trunc);
        if (!ofs.is_open()) {
            Logger::instance().logDebug(
                cameraIdForLog,
                "concatVideoClipsWithFfmpeg_: failed opening concat list: " + listPath.string()
            );
            return false;
        }
        for (const auto& segment : segments) {
            std::string normalized = fs::absolute(segment).string();
            std::replace(normalized.begin(), normalized.end(), '\\', '/');
            ofs << "file '" << normalized << "'\n";
        }
    }

    fs::path ffmpegPath = fs::path(getExecutableDir()) / "ffmpeg.exe";
    std::wstring ffmpegW = utf8ToWide(ffmpegPath.string());
    std::wstring listW = utf8ToWide(listPath.string());
    std::wstring outW = utf8ToWide(outPath.string());

    std::wstring cmdLine =
        L"\"" + ffmpegW + L"\""
        L" -y -hide_banner -loglevel error"
        L" -safe 0 -f concat -i \"" + listW + L"\""
        L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
        L" -an "
        L" \"" + outW + L"\"";

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi{};
    std::vector<wchar_t> cmdBuf(cmdLine.begin(), cmdLine.end());
    cmdBuf.push_back(L'\0');

    const BOOL ok = CreateProcessW(
        nullptr,
        cmdBuf.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        nullptr,
        &si,
        &pi
    );
    if (!ok) {
        std::error_code rmEc;
        fs::remove(listPath, rmEc);
        Logger::instance().logDebug(
            cameraIdForLog,
            "concatVideoClipsWithFfmpeg_: CreateProcessW failed"
        );
        return false;
    }

    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);

    std::error_code rmEc;
    fs::remove(listPath, rmEc);

    if (exitCode != 0) {
        Logger::instance().logDebug(
            cameraIdForLog,
            "concatVideoClipsWithFfmpeg_: ffmpeg exited with code " + std::to_string(exitCode)
        );
        return false;
    }

    return fs::exists(outPath);
}

struct AdaptiveInferenceBatch_ {
    std::string clipPath;
    int windowSeconds = 10;
    size_t sourceCount = 1;
};

static std::optional<AdaptiveInferenceBatch_> acquireAdaptiveInferenceBatchForCamera_(
    const std::string& cameraId)
{
    const std::vector<PendingInferenceClip_> pending = collectPendingInferenceClipsForCamera_(cameraId);
    if (pending.empty()) return std::nullopt;

    const int clipCount = (std::min)(chooseAdaptiveInferenceBatchClipCount_(pending), static_cast<int>(pending.size()));
    if (clipCount <= 1) {
        AdaptiveInferenceBatch_ batch;
        batch.clipPath = pending.front().path.string();
        batch.windowSeconds = 10;
        batch.sourceCount = 1;
        return batch;
    }

    std::vector<fs::path> selectedPaths;
    selectedPaths.reserve(static_cast<size_t>(clipCount));
    for (int i = 0; i < clipCount; ++i) {
        selectedPaths.push_back(pending[static_cast<size_t>(i)].path);
    }

    const PendingInferenceClip_& first = pending.front();
    const PendingInferenceClip_& last = pending[static_cast<size_t>(clipCount - 1)];
    const int windowSeconds = clipCount * 10;

    fs::path assembledDir = getInferenceTempDirForCameraId(cameraId) / "_assembled";
    std::error_code dirEc;
    fs::create_directories(assembledDir, dirEc);
    if (dirEc) {
        return AdaptiveInferenceBatch_{ first.path.string(), 10, 1 };
    }

    fs::path assembledPath =
        assembledDir /
        (cameraId + "_" + first.startTs.substr(0, 8) + "_" + first.startTs.substr(9, 6) +
         "_" + last.endTs.substr(0, 8) + "_" + last.endTs.substr(9, 6) +
         "_" + std::to_string(windowSeconds) + "s.mp4");

    if (!concatVideoClipsWithFfmpeg_(selectedPaths, assembledPath, cameraId)) {
        return AdaptiveInferenceBatch_{ first.path.string(), 10, 1 };
    }

    for (const auto& srcPath : selectedPaths) {
        std::error_code rmEc;
        fs::remove(srcPath, rmEc);
    }

    AdaptiveInferenceBatch_ batch;
    batch.clipPath = assembledPath.string();
    batch.windowSeconds = windowSeconds;
    batch.sourceCount = static_cast<size_t>(clipCount);
    return batch;
}





/*
void sendTokenUsageAsync(
    const std::string& cameraId,
    int promptTokens,
    int outputTokens,
    int totalTokens,
    const std::string& source,
    const std::string& algoType,
    const std::string& cameraSessionId,
    int cameraAlgorithmId,
    const std::string& agentRunId,
    const std::string& clientId,
    const std::string& exeToken,
    const std::string& backendBaseUrl
)
{
    std::thread([cameraId, promptTokens, outputTokens, totalTokens,
        source, algoType, clientId, exeToken, backendBaseUrl]() {
            try {
                nlohmann::json body = {
                    { "camera_id",      cameraId },
                    { "prompt_tokens",  promptTokens },
                    { "output_tokens",  outputTokens },
                    { "total_tokens",   totalTokens },
                    { "source",         source },
                    { "algo_type",      algoType }
                };

                std::string url = backendBaseUrl +
                    "/api/agent/token-usage?client_id=" + clientId;

                std::string resp = httpPostJsonAuthorized(url, exeToken, body);

                Logger::instance().logDebug(
                    cameraId,
                    "sendTokenUsageAsync: server response=" + resp
                );

                // Optional: parse resp and act on status == "stop"
                try {
                    auto j = nlohmann::json::parse(resp);
                    if (j.contains("status") && j["status"].is_string()) {
                        std::string status = j["status"].get<std::string>();
                        std::string reason = j.value("reason", "");
                        if (status == "stop") {
                            Logger::instance().logDebug(
                                cameraId,
                                "sendTokenUsageAsync: token limit reached, stopping agents. Reason=" + reason
                            );
                            // TODO: mark camera as tokens_exhausted_ in your state
                        }
                    }
                }
                catch (const std::exception& ex) {
                    Logger::instance().logDebug(
                        cameraId,
                        std::string("sendTokenUsageAsync: JSON parse error: ") + ex.what()
                    );
                }
            }
            catch (const std::exception& ex) {
                Logger::instance().logDebug(
                    cameraId,
                    std::string("sendTokenUsageAsync failed: ") + ex.what()
                );
            }
            catch (...) {
                Logger::instance().logDebug(
                    cameraId,
                    "sendTokenUsageAsync failed: unknown exception"
                );
            }
        }).detach();
}
*/






static std::mutex g_captureMetricsMutex;
static std::condition_variable g_captureMetricsCv;
static std::unordered_map<std::string, CaptureThreadMetricSample> g_captureMetricsLatestByKey;
static std::atomic<bool> g_captureMetricsWorkerRunning{ false };
static std::thread g_captureMetricsWorkerThread;
static bool g_captureMetricsDirty = false;

static std::string buildCaptureMetricsKey_(const CaptureThreadMetricSample& sample) {
    return sample.backendBaseUrl + "|" + sample.clientId + "|" +
        std::to_string(sample.cameraId) + "|" + sample.threadName;
}

static void flushCaptureMetricsSnapshot_() {
    std::vector<CaptureThreadMetricSample> snapshot;
    {
        std::lock_guard<std::mutex> lock(g_captureMetricsMutex);
        if (!g_captureMetricsDirty || g_captureMetricsLatestByKey.empty()) {
            return;
        }

        snapshot.reserve(g_captureMetricsLatestByKey.size());
        for (const auto& it : g_captureMetricsLatestByKey) {
            snapshot.push_back(it.second);
        }
        g_captureMetricsDirty = false;
    }

    std::unordered_map<std::string, std::vector<CaptureThreadMetricSample>> groups;
    groups.reserve(snapshot.size());
    for (const auto& sample : snapshot) {
        const std::string groupKey =
            sample.backendBaseUrl + "|" + sample.clientId + "|" + sample.exeToken;
        groups[groupKey].push_back(sample);
    }

    auto clampToI64 = [](std::uint64_t value) -> long long {
        const std::uint64_t clamped = std::min<std::uint64_t>(
            value,
            static_cast<std::uint64_t>(std::numeric_limits<long long>::max())
        );
        return static_cast<long long>(clamped);
        };

    for (const auto& entry : groups) {
        const auto& groupSamples = entry.second;
        if (groupSamples.empty()) continue;

        const auto& ref = groupSamples.front();
        if (ref.backendBaseUrl.empty() || ref.clientId.empty() || ref.exeToken.empty()) {
            continue;
        }

        nlohmann::json samplesJson = nlohmann::json::array();
        for (const auto& sample : groupSamples) {
            if (sample.cameraId <= 0) continue;
            const std::string threadName = sample.threadName.empty()
                ? std::string("captureLoop")
                : sample.threadName;
            const double cpuPercent = std::isfinite(sample.cpuPercent)
                ? std::max(0.0, std::min(sample.cpuPercent, 10000.0))
                : 0.0;
            const int queueDepth = std::max(0, sample.queueDepth);
            const std::string sampledAt = sample.sampledAtIso.empty()
                ? nowUtcIso8601Ms_()
                : sample.sampledAtIso;

            samplesJson.push_back({
                { "camera_id", sample.cameraId },
                { "thread_name", threadName },
                { "cpu_percent", cpuPercent },
                { "capture_mem_estimated_bytes", clampToI64(sample.captureMemEstimatedBytes) },
                { "process_working_set_bytes", clampToI64(sample.processWorkingSetBytes) },
                { "process_private_bytes", clampToI64(sample.processPrivateBytes) },
                { "queue_depth", queueDepth },
                { "sampled_at", sampledAt }
                });
        }

        if (samplesJson.empty()) continue;

        try {
            const nlohmann::json body = {
                { "samples", samplesJson }
            };
            const std::string url = ref.backendBaseUrl +
                "/api/agent/capture-thread-metrics?client_id=" + ref.clientId;
            const std::string response = httpPostJsonAuthorized(url, ref.exeToken, body);
            Logger::instance().logDebug(
                "CaptureMetricsWorker",
                "flush ok, samples=" + std::to_string(samplesJson.size()) +
                ", response=" + response
            );
        }
        catch (const std::exception& ex) {
            Logger::instance().logDebug(
                "CaptureMetricsWorker",
                std::string("flush failed: ") + ex.what()
            );
        }
        catch (...) {
            Logger::instance().logDebug("CaptureMetricsWorker", "flush failed: unknown exception");
        }
    }
}

static void captureMetricsWorker_() {
    const auto flushInterval = std::chrono::seconds(30);
    auto nextFlushAt = std::chrono::steady_clock::now() + flushInterval;

    while (g_captureMetricsWorkerRunning.load(std::memory_order_acquire)) {
        {
            std::unique_lock<std::mutex> lock(g_captureMetricsMutex);
            g_captureMetricsCv.wait_for(lock, std::chrono::seconds(1), [] {
                return !g_captureMetricsWorkerRunning.load(std::memory_order_acquire) ||
                    g_captureMetricsDirty;
                });
        }

        if (!g_captureMetricsWorkerRunning.load(std::memory_order_acquire)) {
            break;
        }

        const auto now = std::chrono::steady_clock::now();
        if (now >= nextFlushAt) {
            flushCaptureMetricsSnapshot_();
            nextFlushAt = now + flushInterval;
        }
    }

    // Best effort final flush on shutdown.
    flushCaptureMetricsSnapshot_();
    Logger::instance().logDebug("CaptureMetricsWorker", "worker thread exiting");
}

void startCaptureMetricsWorker() {
    if (g_captureMetricsWorkerRunning.load(std::memory_order_acquire)) return;
    g_captureMetricsWorkerRunning.store(true, std::memory_order_release);
    g_captureMetricsWorkerThread = std::thread(captureMetricsWorker_);
    Logger::instance().logDebug("CaptureMetricsWorker", "worker thread started");
}

void stopCaptureMetricsWorker() {
    if (!g_captureMetricsWorkerRunning.load(std::memory_order_acquire)) return;
    g_captureMetricsWorkerRunning.store(false, std::memory_order_release);
    g_captureMetricsCv.notify_all();
    if (g_captureMetricsWorkerThread.joinable()) {
        g_captureMetricsWorkerThread.join();
    }
    {
        std::lock_guard<std::mutex> lock(g_captureMetricsMutex);
        g_captureMetricsLatestByKey.clear();
        g_captureMetricsDirty = false;
    }
    Logger::instance().logDebug("CaptureMetricsWorker", "worker thread stopped");
}

struct OpenMonitorCpuTimesSample {
    std::uint64_t idle100ns = 0;
    std::uint64_t kernel100ns = 0;
    std::uint64_t user100ns = 0;
    bool valid = false;
};

struct OpenMonitorProcessCpuSample {
    std::uint64_t kernel100ns = 0;
    std::uint64_t user100ns = 0;
    std::uint64_t wallClockMs = 0;
    bool valid = false;
};

struct OpenMonitorProcessIoSample {
    std::uint64_t readBytes = 0;
    std::uint64_t writeBytes = 0;
    std::uint64_t otherBytes = 0;
    std::uint64_t wallClockMs = 0;
    bool valid = false;
};

struct OpenMonitorNetworkSample {
    std::uint64_t rxBytes = 0;
    std::uint64_t txBytes = 0;
    std::uint64_t wallClockMs = 0;
    bool valid = false;
};

struct OpenMonitorDiskThroughputSample {
    double readBytesPerSec = 0.0;
    double writeBytesPerSec = 0.0;
    bool valid = false;
};

struct OpenMonitorCameraRateState {
    std::uint64_t sampledAtMs = 0;
    std::uint64_t captureReadLatencyTotalUs = 0;
    std::uint64_t captureReadSamples = 0;
    std::uint64_t decodeLatencyTotalUs = 0;
    std::uint64_t decodeSamples = 0;
    std::uint64_t diskReadBytesTotal = 0;
    std::uint64_t diskReadLatencyTotalUs = 0;
    std::uint64_t diskReadOperations = 0;
    std::uint64_t diskWriteBytesTotal = 0;
    std::uint64_t diskWriteLatencyTotalUs = 0;
    std::uint64_t diskWriteOperations = 0;
    std::uint64_t inferenceInputTotal = 0;
    std::uint64_t inferenceProcessedTotal = 0;
    bool valid = false;
};

static std::mutex g_openMonitorWorkerMutex;
static std::condition_variable g_openMonitorWorkerCv;
static std::atomic<bool> g_openMonitorWorkerRunning{ false };
static std::thread g_openMonitorWorkerThread;
static AgentCore* g_openMonitorWorkerOwner = nullptr;
static std::mutex g_systemActivityLogMutex;
static constexpr std::uintmax_t kSystemActivityLogRotateBytes = 64ull * 1024ull * 1024ull;
static constexpr int kSystemActivityLogRotateFiles = 5;

static std::wstring readEnvironmentVariableWide_(const wchar_t* name) {
    DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
    if (required == 0) {
        return std::wstring();
    }

    std::wstring value(static_cast<size_t>(required), L'\0');
    DWORD written = GetEnvironmentVariableW(name, value.data(), required);
    if (written == 0 || written >= required) {
        return std::wstring();
    }

    value.resize(static_cast<size_t>(written));
    return value;
}

static fs::path systemActivityLogPath_() {
    const std::wstring fromEnv = readEnvironmentVariableWide_(L"SYSTEM_ACTIVITY_LOG_PATH");
    if (!fromEnv.empty()) {
        return fs::path(fromEnv);
    }
    return fs::current_path() / "logs" / "system-activity.jsonl";
}

static fs::path systemActivityRotatedPath_(const fs::path& basePath, int index) {
    return fs::path(basePath.wstring() + L"." + std::to_wstring(index));
}

static void rotateSystemActivityLogIfNeeded_(const fs::path& logPath) {
    std::error_code ec;
    if (!fs::exists(logPath, ec) || ec) {
        return;
    }

    const std::uintmax_t currentSize = fs::file_size(logPath, ec);
    if (ec || currentSize < kSystemActivityLogRotateBytes) {
        return;
    }

    const fs::path oldestPath = systemActivityRotatedPath_(logPath, kSystemActivityLogRotateFiles);
    fs::remove(oldestPath, ec);
    ec.clear();

    for (int index = kSystemActivityLogRotateFiles; index >= 2; --index) {
        const fs::path fromPath = systemActivityRotatedPath_(logPath, index - 1);
        if (!fs::exists(fromPath, ec) || ec) {
            ec.clear();
            continue;
        }

        const fs::path toPath = systemActivityRotatedPath_(logPath, index);
        fs::remove(toPath, ec);
        ec.clear();
        fs::rename(fromPath, toPath, ec);
        if (ec) {
            std::error_code copyEc;
            fs::copy_file(fromPath, toPath, fs::copy_options::overwrite_existing, copyEc);
            if (!copyEc) {
                fs::remove(fromPath, copyEc);
            }
            ec.clear();
        }
    }

    const fs::path firstRotatedPath = systemActivityRotatedPath_(logPath, 1);
    fs::remove(firstRotatedPath, ec);
    ec.clear();
    fs::rename(logPath, firstRotatedPath, ec);
    if (ec) {
        std::error_code copyEc;
        fs::copy_file(logPath, firstRotatedPath, fs::copy_options::overwrite_existing, copyEc);
        if (!copyEc) {
            fs::remove(logPath, copyEc);
        }
    }
}

static std::string openMonitorSnapshotId_(const std::string& sampledAt) {
    std::string snapshotId;
    snapshotId.reserve(sampledAt.size() + 3);
    snapshotId += "om-";
    for (unsigned char ch : sampledAt) {
        if (std::isalnum(ch) != 0) {
            snapshotId.push_back(static_cast<char>(ch));
        }
        else {
            snapshotId.push_back('-');
        }
    }
    return snapshotId;
}

static std::string asciiPreview_(const std::string& value, std::size_t maxLength = 2048) {
    std::string preview;
    preview.reserve((std::min)(value.size(), maxLength) + 3);
    for (unsigned char ch : value) {
        if (preview.size() >= maxLength) {
            preview += "...";
            break;
        }

        if (ch == '\r' || ch == '\n' || ch == '\t') {
            preview.push_back(' ');
        }
        else if (ch >= 32 && ch <= 126) {
            preview.push_back(static_cast<char>(ch));
        }
        else {
            preview.push_back('?');
        }
    }
    return preview;
}

static void appendSystemActivityLogEntry_(const json& entry) {
    std::lock_guard<std::mutex> lock(g_systemActivityLogMutex);

    try {
        const fs::path logPath = systemActivityLogPath_();
        if (logPath.empty()) {
            return;
        }

        std::error_code ec;
        if (!logPath.parent_path().empty()) {
            fs::create_directories(logPath.parent_path(), ec);
        }

        rotateSystemActivityLogIfNeeded_(logPath);

        std::ofstream out(logPath, std::ios::app | std::ios::binary);
        if (!out.is_open()) {
            Logger::instance().logDebug("OpenMonitorWorker", "system activity log open failed");
            return;
        }

        out << entry.dump() << '\n';
        out.flush();
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            "OpenMonitorWorker",
            std::string("system activity log write failed: ") + ex.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug("OpenMonitorWorker", "system activity log write failed: unknown exception");
    }
}

static std::uint64_t fileTimeToU64_(const FILETIME& value) {
    ULARGE_INTEGER li{};
    li.LowPart = value.dwLowDateTime;
    li.HighPart = value.dwHighDateTime;
    return li.QuadPart;
}

static bool readSystemCpuTimes_(OpenMonitorCpuTimesSample& out) {
    FILETIME idle{};
    FILETIME kernel{};
    FILETIME user{};
    if (!GetSystemTimes(&idle, &kernel, &user)) {
        return false;
    }
    out.idle100ns = fileTimeToU64_(idle);
    out.kernel100ns = fileTimeToU64_(kernel);
    out.user100ns = fileTimeToU64_(user);
    out.valid = true;
    return true;
}

static bool readProcessCpuTimes_(OpenMonitorProcessCpuSample& out) {
    FILETIME creation{};
    FILETIME exit{};
    FILETIME kernel{};
    FILETIME user{};
    if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
        return false;
    }
    out.kernel100ns = fileTimeToU64_(kernel);
    out.user100ns = fileTimeToU64_(user);
    out.wallClockMs = GetTickCount64();
    out.valid = true;
    return true;
}

static bool readProcessIoSample_(OpenMonitorProcessIoSample& out)
{
    IO_COUNTERS counters{};
    if (!GetProcessIoCounters(GetCurrentProcess(), &counters)) {
        return false;
    }
    out.readBytes = static_cast<std::uint64_t>(counters.ReadTransferCount);
    out.writeBytes = static_cast<std::uint64_t>(counters.WriteTransferCount);
    out.otherBytes = static_cast<std::uint64_t>(counters.OtherTransferCount);
    out.wallClockMs = GetTickCount64();
    out.valid = true;
    return true;
}

static bool readNetworkSample_(OpenMonitorNetworkSample& out)
{
    ULONG tableSize = 0;
    DWORD status = GetIfTable(nullptr, &tableSize, FALSE);
    if (status != ERROR_INSUFFICIENT_BUFFER || tableSize == 0) {
        return false;
    }

    std::vector<unsigned char> tableBuffer(tableSize);
    MIB_IFTABLE* table = reinterpret_cast<MIB_IFTABLE*>(tableBuffer.data());
    status = GetIfTable(table, &tableSize, FALSE);
    if (status != NO_ERROR || table == nullptr) {
        return false;
    }

    std::uint64_t rxBytes = 0;
    std::uint64_t txBytes = 0;
    for (DWORD idx = 0; idx < table->dwNumEntries; ++idx) {
        const MIB_IFROW& row = table->table[idx];
        if (row.dwOperStatus != IF_OPER_STATUS_OPERATIONAL) {
            continue;
        }
        if (row.dwType == IF_TYPE_SOFTWARE_LOOPBACK || row.dwType == IF_TYPE_TUNNEL) {
            continue;
        }
        rxBytes += static_cast<std::uint64_t>(row.dwInOctets);
        txBytes += static_cast<std::uint64_t>(row.dwOutOctets);
    }

    out.rxBytes = rxBytes;
    out.txBytes = txBytes;
    out.wallClockMs = GetTickCount64();
    out.valid = true;
    return true;
}

static bool sampleDiskThroughput_(OpenMonitorDiskThroughputSample& out)
{
    static PDH_HQUERY query = nullptr;
    static PDH_HCOUNTER readCounter = nullptr;
    static PDH_HCOUNTER writeCounter = nullptr;
    static bool initialized = false;
    static bool collectedOnce = false;

    if (!initialized) {
        initialized = true;
        if (PdhOpenQueryW(nullptr, 0, &query) != ERROR_SUCCESS) {
            query = nullptr;
            return false;
        }
        if (PdhAddEnglishCounterW(
                query,
                L"\\PhysicalDisk(_Total)\\Disk Read Bytes/sec",
                0,
                &readCounter
            ) != ERROR_SUCCESS ||
            PdhAddEnglishCounterW(
                query,
                L"\\PhysicalDisk(_Total)\\Disk Write Bytes/sec",
                0,
                &writeCounter
            ) != ERROR_SUCCESS) {
            if (query != nullptr) {
                PdhCloseQuery(query);
            }
            query = nullptr;
            readCounter = nullptr;
            writeCounter = nullptr;
            return false;
        }
    }

    if (query == nullptr || readCounter == nullptr || writeCounter == nullptr) {
        return false;
    }

    if (PdhCollectQueryData(query) != ERROR_SUCCESS) {
        return false;
    }

    if (!collectedOnce) {
        collectedOnce = true;
        return false;
    }

    PDH_FMT_COUNTERVALUE readValue{};
    PDH_FMT_COUNTERVALUE writeValue{};
    if (PdhGetFormattedCounterValue(readCounter, PDH_FMT_DOUBLE, nullptr, &readValue) != ERROR_SUCCESS ||
        PdhGetFormattedCounterValue(writeCounter, PDH_FMT_DOUBLE, nullptr, &writeValue) != ERROR_SUCCESS) {
        return false;
    }

    out.readBytesPerSec =
        (readValue.CStatus == ERROR_SUCCESS && std::isfinite(readValue.doubleValue))
            ? (std::max)(0.0, readValue.doubleValue)
            : 0.0;
    out.writeBytesPerSec =
        (writeValue.CStatus == ERROR_SUCCESS && std::isfinite(writeValue.doubleValue))
            ? (std::max)(0.0, writeValue.doubleValue)
            : 0.0;
    out.valid = true;
    return true;
}

static int countCurrentProcessThreads_() {
    const DWORD currentPid = GetCurrentProcessId();
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE) {
        return 0;
    }

    THREADENTRY32 entry{};
    entry.dwSize = sizeof(entry);
    int threadCount = 0;
    if (Thread32First(snapshot, &entry)) {
        do {
            if (entry.th32OwnerProcessID == currentPid) {
                threadCount += 1;
            }
            entry.dwSize = sizeof(entry);
        } while (Thread32Next(snapshot, &entry));
    }

    CloseHandle(snapshot);
    return threadCount;
}

static std::uint64_t processUptimeSeconds_() {
    FILETIME creation{};
    FILETIME exit{};
    FILETIME kernel{};
    FILETIME user{};
    if (!GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
        return 0;
    }

    FILETIME nowFt{};
    GetSystemTimeAsFileTime(&nowFt);
    const std::uint64_t creationTicks = fileTimeToU64_(creation);
    const std::uint64_t nowTicks = fileTimeToU64_(nowFt);
    if (nowTicks <= creationTicks) {
        return 0;
    }
    return (nowTicks - creationTicks) / 10'000'000ULL;
}

static std::string currentDriveRoot_() {
    char buffer[MAX_PATH] = { 0 };
    DWORD length = GetCurrentDirectoryA(MAX_PATH, buffer);
    if (length >= 3) {
        return std::string(buffer, buffer + 3);
    }
    return std::string("C:\\");
}

static void flushOpenMonitorSnapshot_(
    AgentCore* owner,
    OpenMonitorCpuTimesSample& previousSystemCpu,
    OpenMonitorProcessCpuSample& previousProcessCpu,
    OpenMonitorProcessIoSample& previousProcessIo,
    OpenMonitorNetworkSample& previousNetwork,
    std::unordered_map<int, OpenMonitorCameraRateState>& previousCameraState)
{
    if (owner == nullptr) return;

    const std::string clientId = owner->getClientId();
    const std::string exeToken = owner->getExeToken();
    const std::string backendBaseUrl = owner->getBackendBaseUrl();
    if (clientId.empty() || exeToken.empty() || backendBaseUrl.empty()) {
        return;
    }

    const std::string sampledAt = nowUtcIso8601Ms_();
    const std::uint64_t sampledAtMs = GetTickCount64();
    const auto snapshots = owner->collectOpenMonitorCameraSnapshots();

    OpenMonitorCpuTimesSample currentSystemCpu;
    double cpuTotalPercent = 0.0;
    if (readSystemCpuTimes_(currentSystemCpu)) {
        if (previousSystemCpu.valid) {
            const std::uint64_t idleDelta = currentSystemCpu.idle100ns - previousSystemCpu.idle100ns;
            const std::uint64_t kernelDelta = currentSystemCpu.kernel100ns - previousSystemCpu.kernel100ns;
            const std::uint64_t userDelta = currentSystemCpu.user100ns - previousSystemCpu.user100ns;
            const std::uint64_t totalDelta = kernelDelta + userDelta;
            if (totalDelta > 0 && totalDelta >= idleDelta) {
                cpuTotalPercent = (static_cast<double>(totalDelta - idleDelta) * 100.0) /
                    static_cast<double>(totalDelta);
            }
        }
        previousSystemCpu = currentSystemCpu;
    }

    SYSTEM_INFO systemInfo{};
    GetSystemInfo(&systemInfo);
    const unsigned int logicalCoresRaw =
        (std::max)(1u, static_cast<unsigned int>(systemInfo.dwNumberOfProcessors));
    const int logicalCores = static_cast<int>(logicalCoresRaw);

    MEMORYSTATUSEX memStatus{};
    memStatus.dwLength = sizeof(memStatus);
    const bool hasMemoryStatus = GlobalMemoryStatusEx(&memStatus) != FALSE;

    ULARGE_INTEGER freeBytesAvailable{};
    ULARGE_INTEGER totalBytes{};
    ULARGE_INTEGER totalFreeBytes{};
    const bool hasDiskStats = GetDiskFreeSpaceExA(
        currentDriveRoot_().c_str(),
        &freeBytesAvailable,
        &totalBytes,
        &totalFreeBytes
    ) != FALSE;

    std::uint64_t processWorkingSetBytes = 0;
    std::uint64_t processPrivateBytes = 0;
    readProcessMemorySnapshot_(processWorkingSetBytes, processPrivateBytes);

    DWORD handleCount = 0;
    if (!GetProcessHandleCount(GetCurrentProcess(), &handleCount)) {
        handleCount = 0;
    }

    OpenMonitorProcessIoSample currentProcessIo;
    double processReadBytesPerSec = 0.0;
    double processWriteBytesPerSec = 0.0;
    double processOtherBytesPerSec = 0.0;
    if (readProcessIoSample_(currentProcessIo)) {
        if (previousProcessIo.valid && currentProcessIo.wallClockMs > previousProcessIo.wallClockMs) {
            const double wallSeconds =
                static_cast<double>(currentProcessIo.wallClockMs - previousProcessIo.wallClockMs) / 1000.0;
            if (wallSeconds > 0.0) {
                if (currentProcessIo.readBytes >= previousProcessIo.readBytes) {
                    processReadBytesPerSec =
                        static_cast<double>(currentProcessIo.readBytes - previousProcessIo.readBytes) / wallSeconds;
                }
                if (currentProcessIo.writeBytes >= previousProcessIo.writeBytes) {
                    processWriteBytesPerSec =
                        static_cast<double>(currentProcessIo.writeBytes - previousProcessIo.writeBytes) / wallSeconds;
                }
                if (currentProcessIo.otherBytes >= previousProcessIo.otherBytes) {
                    processOtherBytesPerSec =
                        static_cast<double>(currentProcessIo.otherBytes - previousProcessIo.otherBytes) / wallSeconds;
                }
            }
        }
        previousProcessIo = currentProcessIo;
    }

    OpenMonitorProcessCpuSample currentProcessCpu;
    double processCpuPercent = 0.0;
    if (readProcessCpuTimes_(currentProcessCpu)) {
        if (previousProcessCpu.valid && currentProcessCpu.wallClockMs > previousProcessCpu.wallClockMs) {
            const std::uint64_t processDelta100ns =
                (currentProcessCpu.kernel100ns - previousProcessCpu.kernel100ns) +
                (currentProcessCpu.user100ns - previousProcessCpu.user100ns);
            const double wallSeconds =
                static_cast<double>(currentProcessCpu.wallClockMs - previousProcessCpu.wallClockMs) / 1000.0;
            if (wallSeconds > 0.0 && logicalCores > 0) {
                const double processSeconds = static_cast<double>(processDelta100ns) / 10'000'000.0;
                processCpuPercent = (processSeconds / (wallSeconds * static_cast<double>(logicalCores))) * 100.0;
            }
        }
        previousProcessCpu = currentProcessCpu;
    }

    OpenMonitorNetworkSample currentNetwork;
    double networkRxBytesPerSec = 0.0;
    double networkTxBytesPerSec = 0.0;
    if (readNetworkSample_(currentNetwork)) {
        if (previousNetwork.valid && currentNetwork.wallClockMs > previousNetwork.wallClockMs) {
            const double wallSeconds =
                static_cast<double>(currentNetwork.wallClockMs - previousNetwork.wallClockMs) / 1000.0;
            if (wallSeconds > 0.0) {
                if (currentNetwork.rxBytes >= previousNetwork.rxBytes) {
                    networkRxBytesPerSec =
                        static_cast<double>(currentNetwork.rxBytes - previousNetwork.rxBytes) / wallSeconds;
                }
                if (currentNetwork.txBytes >= previousNetwork.txBytes) {
                    networkTxBytesPerSec =
                        static_cast<double>(currentNetwork.txBytes - previousNetwork.txBytes) / wallSeconds;
                }
            }
        }
        previousNetwork = currentNetwork;
    }

    OpenMonitorDiskThroughputSample diskThroughput;
    sampleDiskThroughput_(diskThroughput);

    auto clampToI64 = [](std::uint64_t value) -> long long {
        const std::uint64_t clamped = std::min<std::uint64_t>(
            value,
            static_cast<std::uint64_t>(std::numeric_limits<long long>::max())
        );
        return static_cast<long long>(clamped);
    };

    auto ratePerSecond = [](std::uint64_t currentValue,
                            std::uint64_t previousValue,
                            std::uint64_t currentMs,
                            std::uint64_t previousMs,
                            bool hasPrevious) -> double {
        if (!hasPrevious || currentMs <= previousMs || currentValue < previousValue) {
            return 0.0;
        }
        const double wallSeconds = static_cast<double>(currentMs - previousMs) / 1000.0;
        if (wallSeconds <= 0.0) {
            return 0.0;
        }
        return static_cast<double>(currentValue - previousValue) / wallSeconds;
    };

    auto averageLatencyMs = [](std::uint64_t currentTotalUs,
                               std::uint64_t currentOps,
                               std::uint64_t previousTotalUs,
                               std::uint64_t previousOps,
                               bool hasPrevious) -> double {
        std::uint64_t effectiveTotalUs = currentTotalUs;
        std::uint64_t effectiveOps = currentOps;
        if (hasPrevious &&
            currentTotalUs >= previousTotalUs &&
            currentOps >= previousOps) {
            effectiveTotalUs -= previousTotalUs;
            effectiveOps -= previousOps;
        }
        if (effectiveOps == 0) {
            return 0.0;
        }
        return static_cast<double>(effectiveTotalUs) /
            static_cast<double>(effectiveOps) /
            1000.0;
    };

    int activeCameras = 0;
    int totalConsumers = 0;
    nlohmann::json camerasJson = nlohmann::json::array();
    nlohmann::json threadsJson = nlohmann::json::array();
    for (const auto& snapshot : snapshots) {
        if (snapshot.cameraId <= 0) {
            continue;
        }

        if (snapshot.streamOnline) {
            activeCameras += 1;
        }
        totalConsumers += (std::max)(0, snapshot.consumerCount);

        const auto previousCamera = previousCameraState.find(snapshot.cameraId);
        const bool hasPreviousCamera =
            previousCamera != previousCameraState.end() && previousCamera->second.valid;
        const OpenMonitorCameraRateState previousState =
            hasPreviousCamera ? previousCamera->second : OpenMonitorCameraRateState{};

        const double captureReadLatencyMs = averageLatencyMs(
            snapshot.captureReadLatencyTotalUs,
            snapshot.captureReadSamples,
            previousState.captureReadLatencyTotalUs,
            previousState.captureReadSamples,
            hasPreviousCamera
        );
        const double decodeLatencyMs = averageLatencyMs(
            snapshot.decodeLatencyTotalUs,
            snapshot.decodeSamples,
            previousState.decodeLatencyTotalUs,
            previousState.decodeSamples,
            hasPreviousCamera
        );
        const double diskReadLatencyMs = averageLatencyMs(
            snapshot.diskReadLatencyTotalUs,
            snapshot.diskReadOperations,
            previousState.diskReadLatencyTotalUs,
            previousState.diskReadOperations,
            hasPreviousCamera
        );
        const double diskWriteLatencyMs = averageLatencyMs(
            snapshot.diskWriteLatencyTotalUs,
            snapshot.diskWriteOperations,
            previousState.diskWriteLatencyTotalUs,
            previousState.diskWriteOperations,
            hasPreviousCamera
        );
        const double diskReadBytesPerSec = ratePerSecond(
            snapshot.diskReadBytesTotal,
            previousState.diskReadBytesTotal,
            sampledAtMs,
            previousState.sampledAtMs,
            hasPreviousCamera
        );
        const double diskWriteBytesPerSec = ratePerSecond(
            snapshot.diskWriteBytesTotal,
            previousState.diskWriteBytesTotal,
            sampledAtMs,
            previousState.sampledAtMs,
            hasPreviousCamera
        );
        const double inferenceInputRate = ratePerSecond(
            snapshot.inferenceInputTotal,
            previousState.inferenceInputTotal,
            sampledAtMs,
            previousState.sampledAtMs,
            hasPreviousCamera
        );
        const double inferenceProcessingRate = ratePerSecond(
            snapshot.inferenceProcessedTotal,
            previousState.inferenceProcessedTotal,
            sampledAtMs,
            previousState.sampledAtMs,
            hasPreviousCamera
        );

        camerasJson.push_back({
            { "camera_id", snapshot.cameraId },
            { "sampled_at", sampledAt },
            { "actual_fps", snapshot.actualFps },
            { "expected_fps", snapshot.expectedFps },
            { "last_frame_age_ms", clampToI64(snapshot.lastFrameAgeMs) },
            { "queue_depth", (std::max)(0, snapshot.queueDepth) },
            { "overwritten_frames", clampToI64(snapshot.overwrittenFrames) },
            { "reconnect_count", clampToI64(snapshot.reconnectCount) },
            { "consumer_count", (std::max)(0, snapshot.consumerCount) },
            { "camera_name", snapshot.cameraName },
            { "configured_fps", snapshot.expectedFps },
            { "width", snapshot.width },
            { "height", snapshot.height },
            { "use_gpu", snapshot.useGpu },
            { "stream_online", snapshot.streamOnline },
            { "capture_enabled", snapshot.captureEnabled },
            { "inference_enabled", snapshot.inferenceEnabled },
            { "active_job_ids", snapshot.activeJobIds },
            { "capture_read_latency_ms", captureReadLatencyMs },
            { "decode_latency_ms", decodeLatencyMs },
            { "disk_read_bytes_per_sec", diskReadBytesPerSec },
            { "disk_read_latency_ms", diskReadLatencyMs },
            { "disk_write_bytes_per_sec", diskWriteBytesPerSec },
            { "disk_write_latency_ms", diskWriteLatencyMs },
            { "last_inference_age_ms", clampToI64(snapshot.lastInferenceAgeMs) },
            { "inference_input_rate", inferenceInputRate },
            { "inference_processing_rate", inferenceProcessingRate },
            { "inference_success_count", clampToI64(snapshot.inferenceSuccessCount) },
            { "inference_error_count", clampToI64(snapshot.inferenceErrorCount) }
        });

        threadsJson.push_back({
            { "camera_id", snapshot.cameraId },
            { "thread_name", "captureLoop" },
            { "sampled_at", sampledAt },
            { "thread_cpu_percent", snapshot.captureThreadCpuPercent },
            { "queue_depth", (std::max)(0, snapshot.queueDepth) },
            { "dropped_items", clampToI64(snapshot.overwrittenFrames) },
            { "camera_name", snapshot.cameraName },
            { "capture_mem_estimated_bytes", clampToI64(snapshot.captureMemEstimatedBytes) },
            { "process_working_set_bytes", clampToI64(snapshot.processWorkingSetBytes) },
            { "process_private_bytes", clampToI64(snapshot.processPrivateBytes) },
            { "capture_read_latency_ms", captureReadLatencyMs },
            { "decode_latency_ms", decodeLatencyMs },
            { "disk_write_bytes_per_sec", diskWriteBytesPerSec },
            { "disk_write_latency_ms", diskWriteLatencyMs }
        });

        threadsJson.push_back({
            { "camera_id", snapshot.cameraId },
            { "thread_name", "inferenceLoop" },
            { "sampled_at", sampledAt },
            { "thread_cpu_percent", nullptr },
            { "queue_depth", (std::max)(0, snapshot.queueDepth) },
            { "dropped_items", 0 },
            { "camera_name", snapshot.cameraName },
            { "input_rate", inferenceInputRate },
            { "processing_rate", inferenceProcessingRate },
            { "last_inference_age_ms", clampToI64(snapshot.lastInferenceAgeMs) },
            { "success_count", clampToI64(snapshot.inferenceSuccessCount) },
            { "error_count", clampToI64(snapshot.inferenceErrorCount) },
            { "disk_read_bytes_per_sec", diskReadBytesPerSec },
            { "disk_read_latency_ms", diskReadLatencyMs }
        });

        previousCameraState[snapshot.cameraId] = OpenMonitorCameraRateState{
            sampledAtMs,
            snapshot.captureReadLatencyTotalUs,
            snapshot.captureReadSamples,
            snapshot.decodeLatencyTotalUs,
            snapshot.decodeSamples,
            snapshot.diskReadBytesTotal,
            snapshot.diskReadLatencyTotalUs,
            snapshot.diskReadOperations,
            snapshot.diskWriteBytesTotal,
            snapshot.diskWriteLatencyTotalUs,
            snapshot.diskWriteOperations,
            snapshot.inferenceInputTotal,
            snapshot.inferenceProcessedTotal,
            true
        };
    }

    const std::string snapshotId = openMonitorSnapshotId_(sampledAt);
    const nlohmann::json body = {
        { "snapshot_id", snapshotId },
        { "sampled_at", sampledAt },
        { "host", {
            { "sampled_at", sampledAt },
            { "cpu_total_percent", cpuTotalPercent },
            { "logical_cores", logicalCores },
            { "ram_total_bytes", hasMemoryStatus ? clampToI64(memStatus.ullTotalPhys) : 0LL },
            { "ram_used_bytes", hasMemoryStatus ? clampToI64(memStatus.ullTotalPhys - memStatus.ullAvailPhys) : 0LL },
            { "ram_available_bytes", hasMemoryStatus ? clampToI64(memStatus.ullAvailPhys) : 0LL },
            { "disk_total_bytes", hasDiskStats ? clampToI64(totalBytes.QuadPart) : 0LL },
            { "disk_free_bytes", hasDiskStats ? clampToI64(totalFreeBytes.QuadPart) : 0LL },
            { "disk_read_bytes_per_sec", diskThroughput.valid ? diskThroughput.readBytesPerSec : 0.0 },
            { "disk_write_bytes_per_sec", diskThroughput.valid ? diskThroughput.writeBytesPerSec : 0.0 },
            { "net_rx_bytes_per_sec", networkRxBytesPerSec },
            { "net_tx_bytes_per_sec", networkTxBytesPerSec }
        } },
        { "process", {
            { "sampled_at", sampledAt },
            { "process_cpu_percent", processCpuPercent },
            { "working_set_bytes", clampToI64(processWorkingSetBytes) },
            { "private_bytes", clampToI64(processPrivateBytes) },
            { "handle_count", static_cast<int>(handleCount) },
            { "thread_count", countCurrentProcessThreads_() },
            { "uptime_seconds", clampToI64(processUptimeSeconds_()) },
            { "active_cameras", activeCameras },
            { "unique_streams", static_cast<int>(snapshots.size()) },
            { "total_consumers", totalConsumers },
            { "process_read_bytes_per_sec", processReadBytesPerSec },
            { "process_write_bytes_per_sec", processWriteBytesPerSec },
            { "process_other_bytes_per_sec", processOtherBytesPerSec }
        } },
        { "cameras", camerasJson },
        { "threads", threadsJson }
    };

    bool transportOk = false;
    bool backendOk = false;
    long httpStatus = 0;
    std::string responsePreview;
    std::string errorMessage;

    try {
        const std::string url = backendBaseUrl + "/api/agent/open-monitor-snapshot?client_id=" + clientId;
        const AuthorizedHttpResponse response = httpPostJsonAuthorizedDetailed(url, exeToken, body);
        transportOk = true;
        httpStatus = response.httpStatus;
        responsePreview = asciiPreview_(response.body);
        backendOk = httpStatus >= 200 && httpStatus < 300;
        if (backendOk) {
            Logger::instance().logDebug(
                "OpenMonitorWorker",
                "flush ok, cameras=" + std::to_string(camerasJson.size()) +
                ", threads=" + std::to_string(threadsJson.size()) +
                ", response=" + response.body
            );
        }
        else {
            errorMessage = "unexpected HTTP status " + std::to_string(httpStatus);
            Logger::instance().logDebug(
                "OpenMonitorWorker",
                "flush failed: " + errorMessage +
                ", response=" + responsePreview
            );
        }
    }
    catch (const std::exception& ex) {
        errorMessage = asciiPreview_(ex.what());
        Logger::instance().logDebug("OpenMonitorWorker", std::string("flush failed: ") + ex.what());
    }
    catch (...) {
        errorMessage = "unknown exception";
        Logger::instance().logDebug("OpenMonitorWorker", "flush failed: unknown exception");
    }

    appendSystemActivityLogEntry_(nlohmann::json{
        { "logged_at", nowUtcIso8601Ms_() },
        { "snapshot_id", snapshotId },
        { "sampled_at", sampledAt },
        { "client_id", clientId },
        { "transport_ok", transportOk },
        { "backend_ok", backendOk },
        { "http_status", httpStatus > 0 ? nlohmann::json(httpStatus) : nlohmann::json(nullptr) },
        { "error", errorMessage.empty() ? nlohmann::json(nullptr) : nlohmann::json(errorMessage) },
        { "response_preview", responsePreview.empty() ? nlohmann::json(nullptr) : nlohmann::json(responsePreview) },
        { "snapshot", body }
    });
}

static void openMonitorWorker_() {
    OpenMonitorCpuTimesSample previousSystemCpu;
    OpenMonitorProcessCpuSample previousProcessCpu;
    OpenMonitorProcessIoSample previousProcessIo;
    OpenMonitorNetworkSample previousNetwork;
    std::unordered_map<int, OpenMonitorCameraRateState> previousCameraState;
    readSystemCpuTimes_(previousSystemCpu);
    readProcessCpuTimes_(previousProcessCpu);
    readProcessIoSample_(previousProcessIo);
    readNetworkSample_(previousNetwork);
    OpenMonitorDiskThroughputSample initialDiskThroughput;
    sampleDiskThroughput_(initialDiskThroughput);

    const auto flushInterval = std::chrono::seconds(15);
    while (g_openMonitorWorkerRunning.load(std::memory_order_acquire)) {
        AgentCore* owner = nullptr;
        {
            std::unique_lock<std::mutex> lock(g_openMonitorWorkerMutex);
            g_openMonitorWorkerCv.wait_for(lock, flushInterval, [] {
                return !g_openMonitorWorkerRunning.load(std::memory_order_acquire);
            });
            owner = g_openMonitorWorkerOwner;
        }

        if (!g_openMonitorWorkerRunning.load(std::memory_order_acquire)) {
            break;
        }

        flushOpenMonitorSnapshot_(
            owner,
            previousSystemCpu,
            previousProcessCpu,
            previousProcessIo,
            previousNetwork,
            previousCameraState
        );
    }

    Logger::instance().logDebug("OpenMonitorWorker", "worker thread exiting");
}

void startOpenMonitorWorker(AgentCore* owner) {
    {
        std::lock_guard<std::mutex> lock(g_openMonitorWorkerMutex);
        g_openMonitorWorkerOwner = owner;
    }
    if (g_openMonitorWorkerRunning.load(std::memory_order_acquire)) return;
    g_openMonitorWorkerRunning.store(true, std::memory_order_release);
    g_openMonitorWorkerThread = std::thread(openMonitorWorker_);
    Logger::instance().logDebug("OpenMonitorWorker", "worker thread started");
}

void stopOpenMonitorWorker() {
    if (!g_openMonitorWorkerRunning.load(std::memory_order_acquire)) {
        std::lock_guard<std::mutex> lock(g_openMonitorWorkerMutex);
        g_openMonitorWorkerOwner = nullptr;
        return;
    }

    g_openMonitorWorkerRunning.store(false, std::memory_order_release);
    g_openMonitorWorkerCv.notify_all();
    if (g_openMonitorWorkerThread.joinable()) {
        g_openMonitorWorkerThread.join();
    }
    {
        std::lock_guard<std::mutex> lock(g_openMonitorWorkerMutex);
        g_openMonitorWorkerOwner = nullptr;
    }
    Logger::instance().logDebug("OpenMonitorWorker", "worker thread stopped");
}

static void enqueueCaptureThreadMetricSample_(CaptureThreadMetricSample sample) {
    if (!g_captureMetricsWorkerRunning.load(std::memory_order_acquire)) return;
    if (sample.cameraId <= 0 || sample.clientId.empty() ||
        sample.exeToken.empty() || sample.backendBaseUrl.empty()) {
        return;
    }

    const std::string key = buildCaptureMetricsKey_(sample);
    {
        std::lock_guard<std::mutex> lock(g_captureMetricsMutex);
        constexpr std::size_t kMaxTrackedEntries = 2048;
        const auto existing = g_captureMetricsLatestByKey.find(key);
        if (existing == g_captureMetricsLatestByKey.end() &&
            g_captureMetricsLatestByKey.size() >= kMaxTrackedEntries) {
            return;
        }
        g_captureMetricsLatestByKey[key] = std::move(sample);
        g_captureMetricsDirty = true;
    }
    g_captureMetricsCv.notify_one();
}

static std::queue<std::function<void()>> g_tokenUsageQueue;
static std::mutex g_tokenQueueMutex;
static std::condition_variable g_tokenQueueCv;
static std::atomic<bool> g_tokenWorkerRunning{ false };
static std::thread g_tokenWorkerThread;

void tokenUsageWorker() {
    while (g_tokenWorkerRunning.load()) {
        std::function<void()> task;
        {
            std::unique_lock<std::mutex> lock(g_tokenQueueMutex);
            g_tokenQueueCv.wait_for(lock, std::chrono::seconds(1), [] {
                return !g_tokenUsageQueue.empty() || !g_tokenWorkerRunning.load();
                });

            if (!g_tokenWorkerRunning.load() && g_tokenUsageQueue.empty()) {
                break;  // Sair quando parar e fila vazia
            }

            if (g_tokenUsageQueue.empty()) continue;

            task = std::move(g_tokenUsageQueue.front());
            g_tokenUsageQueue.pop();
        }

        if (task) {
            try {
                task();
            }
            catch (const std::exception& ex) {
                Logger::instance().logDebug("TokenWorker",
                    std::string("task exception: ") + ex.what());
            }
        }
    }

    Logger::instance().logDebug("TokenWorker", "worker thread exiting");
}

// Chamar no início do programa (ex: em AgentCore::start ou main)
void startTokenUsageWorker() {
    if (g_tokenWorkerRunning.load()) return;
    g_tokenWorkerRunning.store(true);
    g_tokenWorkerThread = std::thread(tokenUsageWorker);
    Logger::instance().logDebug("TokenWorker", "worker thread started");
}

// Chamar no final do programa (ex: em AgentCore::stop ou antes de sair)
void stopTokenUsageWorker() {
    if (!g_tokenWorkerRunning.load()) return;
    g_tokenWorkerRunning.store(false);
    g_tokenQueueCv.notify_all();
    if (g_tokenWorkerThread.joinable()) {
        g_tokenWorkerThread.join();
    }
    Logger::instance().logDebug("TokenWorker", "worker thread stopped");
}
// ============ FIM TOKEN USAGE WORKER ============






void sendTokenUsageAsync(
    const std::string& cameraId,
    int promptTokens,
    int outputTokens,
    int totalTokens,
    const std::string& source,
    const std::string& algoType,
    const std::string& cameraSessionId,
    int cameraAlgorithmId,
    const std::string& agentRunId,
    const std::string& clientId,
    const std::string& exeToken,
    const std::string& backendBaseUrl
)
{
    // Criar a tarefa com cópias dos parâmetros
    auto task = [cameraId, promptTokens, outputTokens, totalTokens,
        source, algoType, cameraSessionId, cameraAlgorithmId, agentRunId,
        clientId, exeToken, backendBaseUrl]() {
        try {
            nlohmann::json body = {
                { "camera_id",      cameraId },
                { "prompt_tokens",  promptTokens },
                { "output_tokens",  outputTokens },
                { "total_tokens",   totalTokens },
                { "source",         source },
                { "algo_type",      algoType }
            };
            if (!cameraSessionId.empty()) {
                body["camera_session_id"] = cameraSessionId;
            }
            if (cameraAlgorithmId > 0) {
                body["camera_algorithm_id"] = cameraAlgorithmId;
            }
            if (!agentRunId.empty()) {
                body["agent_run_id"] = agentRunId;
            }

            std::string url = backendBaseUrl +
                "/api/agent/token-usage?client_id=" + clientId;

            std::string resp = httpPostJsonAuthorized(url, exeToken, body);

            Logger::instance().logDebug(
                cameraId,
                "sendTokenUsageAsync: server response=" + resp
            );

            // Optional: parse resp and act on status == "stop"
            try {
                auto j = nlohmann::json::parse(resp);
                if (j.contains("status") && j["status"].is_string()) {
                    std::string status = j["status"].get<std::string>();
                    std::string reason = j.value("reason", "");
                    if (status == "stop") {
                        Logger::instance().logDebug(
                            cameraId,
                            "sendTokenUsageAsync: token limit reached, stopping agents. Reason=" + reason
                        );
                    }
                }
            }
            catch (const std::exception& ex) {
                Logger::instance().logDebug(
                    cameraId,
                    std::string("sendTokenUsageAsync: JSON parse error: ") + ex.what()
                );
            }
        }
        catch (const std::exception& ex) {
            Logger::instance().logDebug(
                cameraId,
                std::string("sendTokenUsageAsync failed: ") + ex.what()
            );
        }
        catch (...) {
            Logger::instance().logDebug(
                cameraId,
                "sendTokenUsageAsync failed: unknown exception"
            );
        }
        };

    // Enfileirar ao invés de criar thread
    {
        std::lock_guard<std::mutex> lock(g_tokenQueueMutex);

        // Limite de 100 tarefas na fila para evitar memory leak
        if (g_tokenUsageQueue.size() >= 100) {
            Logger::instance().logDebug(
                cameraId,
                "sendTokenUsageAsync: queue full, dropping token usage report"
            );
            return;
        }

        g_tokenUsageQueue.push(std::move(task));
    }
    g_tokenQueueCv.notify_one();
}







struct GeminiVideoResult {
    std::string answer;
    int promptTokens = 0;
    int outputTokens = 0;
    int totalTokens = 0;
};



static std::string pickGeminiModelName(
    const std::string& modelTier)
{
    // Normalize
    std::string t = modelTier;
    for (auto& c : t) c = (char)std::tolower((unsigned char)c);

    if (t == "pro") {
        return "gemini-3-flash-preview"; //"gemini-2.5-flash";
    }
    if (t == "plus") {
        return "gemini-2.5-flash"; //"gemini-2.0-flash";
    }

    return "gemini-2.0-flash-lite";
}





GeminiVideoResult  ask_video_question_gemini_from_bytes(
    const std::string& api_key,
    const std::vector<unsigned char>& video_bytes,
    const std::string& question,
    const std::string& mime_type,
    const std::vector<FaceTargetRef>& face_targets,
    int analysis_speed,
    const std::string& model_tier
) {
    std::string video_b64 = base64_encode(
        reinterpret_cast<const unsigned char*>(video_bytes.data()),
        video_bytes.size()
    );

    std::string system_rules =
        "You are " + std::string(AppBrand::kAssistantName) + ", a security event detector.\n"
        "You ONLY answer about the specific event categories requested.\n"
        "For each category you MUST follow the output schema exactly.\n"
        "You MUST output a single JSON object exactly in the format described.\n"
        "Never add explanations or extra sentences outside the JSON.\n";

    json parts = json::array();

    // --- MULTI TARGET FaceID references (optional) ---
    if (!face_targets.empty()) {
        parts.push_back(json{ {"text",
            "FACEID_TARGETS:\n"
            "- You will receive one or more reference FACE images.\n"
            "- Each reference is labeled with TARGET_ID and TARGET_NAME.\n"
            "- If you detect a matching person in the CCTV video, you MUST return "
            "\"faceid\": {\"match\":\"YES\",\"target_id\":<id>,\"target_name\":\"<name>\"}.\n"
            "- If no match, return \"faceid\": {\"match\":\"NO\",\"target_id\":null,\"target_name\":\"\"}.\n"
        } });

        for (const auto& t : face_targets) {
            parts.push_back(json{ {"text",
                "USER_REFERENCE_IMAGE (FaceID target)\n"
                "TARGET_ID: " + std::to_string(t.id) + "\n"
                "TARGET_NAME: " + t.person_name + "\n"
                "TARGET_DESC: " + t.person_description + "\n"
            } });
            parts.push_back(json{ {"inline_data", {
                {"mime_type", t.mime_type},
                {"data", t.image_b64}
            }} });
        }
    }

    // question + video
    parts.push_back(json{ {"text", question} });
    parts.push_back(json{ {"inline_data", {
        {"mime_type", mime_type},
        {"data", video_b64}
    }} });

    json body = {
        {"system_instruction", {
            {"role", "system"},
            {"parts", json::array({ json{{"text", system_rules}} })}
        }},
        {"contents", json::array({
            { {"role", "user"}, {"parts", parts} }
        })},
        {"generation_config", { {"max_output_tokens", 2000} }}
    };

    std::string modelName = pickGeminiModelName(model_tier);

    std::string raw = httpPostJsonGemini(api_key, modelName, body); //  gemini-2.0-flash-lite  gemini-2.0-flash   gemini-2.5-flash
    auto j = json::parse(raw);



    //LOG INPUT OUTPUT TOKENS
    int promptTokens = 0;
    int outputTokens = 0;
    int totalTokens = 0;

    if (j.contains("usageMetadata") && j["usageMetadata"].is_object()) {
        const auto& u = j["usageMetadata"];

        if (u.contains("promptTokenCount") && u["promptTokenCount"].is_number_integer()) {
            promptTokens = u["promptTokenCount"].get<int>();
        }
        if (u.contains("candidatesTokenCount") && u["candidatesTokenCount"].is_number_integer()) {
            outputTokens = u["candidatesTokenCount"].get<int>();
        }
        if (u.contains("totalTokenCount") && u["totalTokenCount"].is_number_integer()) {
            totalTokens = u["totalTokenCount"].get<int>();
        }
    }
    Logger::instance().logDebug(
        "API_TOKENS",
        "Gemini tokens | prompt=" + std::to_string(promptTokens) +
        " | output=" + std::to_string(outputTokens) +
        " | total=" + std::to_string(totalTokens)
    );



    if (!j.contains("candidates") || j["candidates"].empty()) {
        throw std::runtime_error("No candidates in VIDEO response: " + raw);
    }

    auto content = j["candidates"][0]["content"];
    if (!content.contains("parts") || !content["parts"].is_array()) {
        throw std::runtime_error("Invalid VIDEO response: " + raw);
    }

    std::string answer;
    for (auto& part : content["parts"]) {
        if (part.contains("text")) {
            answer += part["text"].get<std::string>();
        }
    }

    GeminiVideoResult result;
    result.answer = answer;
    result.promptTokens = promptTokens;
    result.outputTokens = outputTokens;
    result.totalTokens = totalTokens;
    return result;


    //return answer;
}











std::string build_multi_algo_question(
    const std::vector<std::string>& algos,
    const std::unordered_map<std::string, std::string>& algoLlmPrompts,
    bool hasFaceTargets
) {
    if (algos.empty()) return "empty";

    std::string q;

    // JSON schema example
    q += "{\n";
    for (size_t i = 0; i < algos.size(); ++i) {
        const std::string& algo = algos[i];

        if (algo == "faceid" && hasFaceTargets) {
            q += "  \"faceid\": { \"match\": \"NO\", \"target_id\": null, \"target_name\": \"\" }";
        }
        else {
            q += "  \"" + algo + "\": \"NO\"";
            q += "  \"" + algo + "_reasoning\": \"...short explanation...\",\n";



        }

        q += (i + 1 < algos.size()) ? ",\n" : "\n";
    }
    q += "}\n\n";


    q +=
        "CRITICAL VISUAL CONFIRMATION RULES:\n"
        "1. You are a security supervisor. Be skeptical. Most footage is normal.\n"
        "2. Only output YES if the action is CLEAR and UNAMBIGUOUS.\n"
        "3. If the video is blurry, or the action is blocked, or you are unsure -> output NO.\n"
        "4. FALSE POSITIVE CHECK: explicitely look for reasons why this might NOT be the event (e.g., shadows, perspective tricks, normal behavior).\n";

    q +=
        "RULES FOR DECISION:\n"
        "- Do NOT add any keys beyond the ones listed.\n"
        "- For non-faceid keys: value MUST be exactly \"YES\" or \"NO\".\n";

    if (hasFaceTargets && std::find(algos.begin(), algos.end(), "faceid") != algos.end()) {
        q +=
            "- For faceid: you MUST return an OBJECT with keys: match, target_id, target_name.\n"
            "  match MUST be \"YES\" or \"NO\".\n"
            "  If match==\"YES\", target_id MUST be one of the provided TARGET_IDs and target_name must match its TARGET_NAME.\n"
            "  If match==\"NO\", target_id must be null and target_name must be empty string.\n";
    }

    q += "\nEVENT CATEGORY DEFINITIONS:\n";

    for (const auto& algo : algos) {
        auto it = kAlgorithmPrompts.find(algo);
        if (it != kAlgorithmPrompts.end()) {
            q += "- " + algo + ": " + it->second + "\n";
        }

        auto pit = algoLlmPrompts.find(algo);
        if (pit != algoLlmPrompts.end() && !pit->second.empty()) {
            q += "  EXTRA INSTRUCTIONS for \"" + algo + "\": " + pit->second + "\n";
        }
    }

    q += "\nReturn ONLY the JSON object, nothing else.\n";
    return q;
}











void CameraSession::updateTelegramSettings(bool enabled, std::string botToken, std::string chatId)
{
    std::lock_guard<std::mutex> lock(algorithmsMutex_);
    config_.telegramEnabled = enabled;
    config_.telegramBotToken = std::move(botToken);
    config_.telegramChatId = std::move(chatId);
}

void CameraSession::updateAlgorithms(std::vector<AlgorithmConfig> algos)
{
    using TemporalEvidenceTrail = std::deque<CameraSession::TemporalEvidenceItem>;

    std::vector<AlgorithmConfig> algosSnapshot = std::move(algos);
    int cameraIdNumeric = 0;
    try {
        cameraIdNumeric = std::stoi(config_.id);
    }
    catch (...) {
        cameraIdNumeric = 0;
    }

    auto promptCoreForAlgo = [&](const AlgorithmConfig& algo) -> std::string {
        return algo.promptTemplate.empty() ? algo.llmPrompt : algo.promptTemplate;
    };
    auto promptHashForAlgo = [&](const AlgorithmConfig& algo) -> std::string {
        return temporal::computePromptRevisionHash(promptCoreForAlgo(algo), algo.alertCondition);
    };
    auto payloadPlanMatchesAlgo = [&](const AlgorithmConfig& algo) -> bool {
        return temporal::decisionCacheable(algo.temporalPlanEnvelope) &&
               temporal::planMatchesPromptRevision(
                   algo.temporalPlanEnvelope,
                   promptCoreForAlgo(algo),
                   algo.alertCondition
               );
    };
    auto slotPlanMatchesAlgo = [&](const TemporalRuntimeSlot& slot, const AlgorithmConfig& algo) -> bool {
        if (!temporal::decisionCacheable(slot.planEnvelope)) return false;
        const std::string promptHash = promptHashForAlgo(algo);
        return (!slot.promptHash.empty() && slot.promptHash == promptHash) ||
               temporal::planMatchesPromptRevision(
                   slot.planEnvelope,
                   promptCoreForAlgo(algo),
                   algo.alertCondition
               );
    };

    if (owner_) {
        for (auto& algo : algosSnapshot) {
            if (!algo.isCustomV2) continue;

            const std::string promptCore = promptCoreForAlgo(algo);
            if (temporal::trim(promptCore).empty() || temporal::trim(algo.alertCondition).empty()) {
                continue;
            }

            nlohmann::json envelope = algo.temporalPlanEnvelope;
            const std::string temporalSlotKey =
                algo.type + "#" +
                std::to_string(algo.algorithmId > 0 ? algo.algorithmId : 0);
            {
                std::lock_guard<std::mutex> temporalLock(temporalMutex_);
                auto it = temporalByAlgo_.find(temporalSlotKey);
                if (it != temporalByAlgo_.end() && slotPlanMatchesAlgo(it->second, algo)) {
                    envelope = it->second.planEnvelope;
                }
            }
            if (!temporal::decisionCacheable(envelope) ||
                !temporal::planMatchesPromptRevision(envelope, promptCore, algo.alertCondition))
            {
                envelope = nlohmann::json::object();
            }
            owner_->ensureTemporalPlanForRuntime(
                "camera_algorithm",
                algo.algorithmId > 0 ? algo.algorithmId : cameraIdNumeric,
                promptCore,
                algo.alertCondition,
                algo.negativeCondition,
                algo.inputType.empty() ? std::string("video") : algo.inputType,
                "pt-BR",
                algo.inferenceModel,
                algo.modelApiKey,
                envelope,
                algo.algorithmId > 0,
                config_.id
            );
            if (temporal::decisionCacheable(envelope)) {
                algo.temporalPlanEnvelope = envelope;
            }
        }
    }

    {
        std::lock_guard<std::mutex> lock(algorithmsMutex_);
        config_.enabledAlgorithms.clear();
        config_.enabledAlgorithms.reserve(algosSnapshot.size());
        for (const auto& algo : algosSnapshot) {
            if (!algo.type.empty()) {
                config_.enabledAlgorithms.push_back(algo.type);
            }
        }
        config_.algorithms = algosSnapshot;
        algosSnapshot = config_.algorithms;
    }
    {
        std::lock_guard<std::mutex> runLock(customRunEveryMutex_);
        customLastRunAtByAlgo_.clear();
    }
    {
        std::lock_guard<std::mutex> temporalLock(temporalMutex_);
        std::unordered_map<std::string, TemporalRuntimeSlot> nextTemporal;
        std::unordered_map<std::string, TemporalEvidenceTrail> nextTemporalEvidence;
        for (const auto& algo : algosSnapshot) {
            const std::string key =
                algo.type + "#" +
                std::to_string(algo.algorithmId > 0 ? algo.algorithmId : 0);
            TemporalRuntimeSlot slot;
            auto it = temporalByAlgo_.find(key);
            if (it != temporalByAlgo_.end()) {
                slot = it->second;
            }
            if (!slotPlanMatchesAlgo(slot, algo)) {
                slot.planEnvelope = payloadPlanMatchesAlgo(algo)
                    ? algo.temporalPlanEnvelope
                    : nlohmann::json::object();
                slot.state = temporal::defaultState();
            }
            if (!slotPlanMatchesAlgo(slot, algo) && payloadPlanMatchesAlgo(algo)) {
                slot.planEnvelope = algo.temporalPlanEnvelope;
            }
            if (!slot.state.is_object() || slot.state.empty()) {
                slot.state = temporal::defaultState();
            }
            slot.promptHash = promptHashForAlgo(algo);
            auto inserted = nextTemporal.emplace(key, std::move(slot));

            auto itEvidence = this->temporalEvidenceByAlgo_.find(key);
            if (itEvidence != this->temporalEvidenceByAlgo_.end() &&
                slotPlanMatchesAlgo(inserted.first->second, algo))
            {
                nextTemporalEvidence.emplace(key, itEvidence->second);
            } else {
                nextTemporalEvidence.emplace(key, TemporalEvidenceTrail{});
            }
        }
        temporalByAlgo_ = std::move(nextTemporal);
        this->temporalEvidenceByAlgo_ = std::move(nextTemporalEvidence);
    }

    frameDiskWriter_.setCaptureProfiles(getEffectiveRecordingProfiles_());
}

static bool hasSuffix_(const std::string& value, const std::string& suffix)
{
    if (suffix.size() > value.size()) return false;
    return std::equal(suffix.rbegin(), suffix.rend(), value.rbegin());
}

static int normalizeRecordingProfileFps_(int fps)
{
    if (fps < 1) return 1;
    if (fps > 10) return 10;
    return fps;
}

static int captureProfileFpsForSeconds_(
    const std::vector<VideoCaptureProfile>& profiles,
    int clipSeconds)
{
    const int normalizedSeconds = clipSeconds > 10 ? 60 : 10;
    for (const auto& profile : profiles) {
        if ((profile.clipSeconds > 10 ? 60 : 10) == normalizedSeconds) {
            return normalizeRecordingProfileFps_(profile.fps);
        }
    }
    return 0;
}

static std::string captureProfilesLogString_(const std::vector<VideoCaptureProfile>& profiles)
{
    if (profiles.empty()) return "none";

    std::ostringstream oss;
    bool first = true;
    for (const auto& profile : profiles) {
        if (!first) oss << ", ";
        first = false;
        const int seconds = profile.clipSeconds > 10 ? 60 : 10;
        oss << seconds << "s@" << normalizeRecordingProfileFps_(profile.fps) << "fps";
    }
    return oss.str();
}

static bool sameCaptureProfiles_(
    const std::vector<VideoCaptureProfile>& lhs,
    const std::vector<VideoCaptureProfile>& rhs)
{
    return captureProfileFpsForSeconds_(lhs, 10) == captureProfileFpsForSeconds_(rhs, 10) &&
           captureProfileFpsForSeconds_(lhs, 60) == captureProfileFpsForSeconds_(rhs, 60);
}

static std::optional<std::string> getNextStoredFrameClipForCamera(
    const std::string& cameraId,
    const std::string& suffix,
    const std::string& minClipKeyExclusive = "",
    const std::string& requiredEndDateTokenYYYYMMDD = "")
{
    try {
        std::error_code ec;
        const fs::path camRoot = fs::path("frames") / ("cam_" + cameraId);
        if (!fs::exists(camRoot, ec) || !fs::is_directory(camRoot, ec)) {
            return std::nullopt;
        }

        fs::path bestPath;
        fs::file_time_type bestTime{};
        std::string bestClipKey;
        bool found = false;

        for (fs::recursive_directory_iterator it(camRoot, ec), end; !ec && it != end; it.increment(ec)) {
            if (ec) break;

            const auto& entry = *it;
            if (!entry.is_regular_file(ec)) {
                if (ec) break;
                continue;
            }

            const std::string filename = entry.path().filename().string();
            if (!hasSuffix_(filename, suffix)) {
                continue;
            }
            if (entry.path().string().find("_merge_failed") != std::string::npos) {
                continue;
            }
            if (!requiredEndDateTokenYYYYMMDD.empty()) {
                std::string startTs;
                std::string endTs;
                if (!parseSegmentTsFromClipPathForInference_(entry.path(), startTs, endTs)) {
                    continue;
                }
                if (endTs.size() < 8 || endTs.substr(0, 8) != requiredEndDateTokenYYYYMMDD) {
                    continue;
                }
            }

            const auto t = entry.last_write_time(ec);
            if (ec) break;

            // Avoid selecting a clip that may still be flushing to disk.
            if (suffix == "_60s.mp4") {
                const auto nowFileClock = fs::file_time_type::clock::now();
                if (t > nowFileClock) {
                    continue;
                }
                const auto age = nowFileClock - t;
                if (age < std::chrono::seconds(2)) {
                    continue;
                }
            }

            std::string clipKey;
            {
                std::string startTs;
                std::string endTs;
                if (parseSegmentTsFromClipPathForInference_(entry.path(), startTs, endTs) && !endTs.empty()) {
                    clipKey = endTs;
                }
                else {
                    clipKey = entry.path().filename().string();
                }
            }
            if (!minClipKeyExclusive.empty() && !clipKey.empty() && clipKey <= minClipKeyExclusive) {
                continue;
            }

            if (!found ||
                (!clipKey.empty() && (bestClipKey.empty() || clipKey < bestClipKey)) ||
                (clipKey == bestClipKey && t < bestTime) ||
                (clipKey == bestClipKey && t == bestTime && entry.path().string() < bestPath.string()))
            {
                bestPath = entry.path();
                bestTime = t;
                bestClipKey = clipKey;
                found = true;
            }
        }

        if (ec || !found) {
            return std::nullopt;
        }
        return bestPath.string();
    }
    catch (const std::exception& ex) {
        Logger::instance().logDebug(
            cameraId,
            std::string("getNextStoredFrameClipForCamera: exception: ") + ex.what()
        );
        return std::nullopt;
    }
}

static std::mutex gUsedStoredClipByAlgoMu_;
static std::unordered_map<std::string, std::string> gUsedStoredClipKeyByAlgo_;

static std::string makeStoredClipUsageKey_(const std::string& clipPath)
{
    std::string startTs;
    std::string endTs;
    if (parseSegmentTsFromClipPathForInference_(fs::path(clipPath), startTs, endTs) && !endTs.empty()) {
        return endTs;
    }
    return fs::path(clipPath).filename().string();
}

static std::string getLastCoreWindowUsedKeyForAlgo_(
    const std::string& cameraId,
    const std::string& algoType)
{
    const std::string slot = cameraId + "|" + algoType;
    std::lock_guard<std::mutex> lock(gUsedStoredClipByAlgoMu_);
    auto it = gUsedStoredClipKeyByAlgo_.find(slot);
    return (it != gUsedStoredClipKeyByAlgo_.end()) ? it->second : std::string();
}

static bool wasCoreWindowAlreadyUsedForAlgo_(
    const std::string& cameraId,
    const std::string& algoType,
    const std::string& clipPath)
{
    const std::string slot = cameraId + "|" + algoType;
    const std::string clipKey = makeStoredClipUsageKey_(clipPath);
    std::lock_guard<std::mutex> lock(gUsedStoredClipByAlgoMu_);
    auto it = gUsedStoredClipKeyByAlgo_.find(slot);
    return it != gUsedStoredClipKeyByAlgo_.end() && it->second == clipKey;
}

static void markCoreWindowUsedForAlgo_(
    const std::string& cameraId,
    const std::string& algoType,
    const std::string& clipPath)
{
    const std::string slot = cameraId + "|" + algoType;
    const std::string clipKey = makeStoredClipUsageKey_(clipPath);
    if (clipKey.empty()) return;

    std::lock_guard<std::mutex> lock(gUsedStoredClipByAlgoMu_);
    if (gUsedStoredClipKeyByAlgo_.size() > 50000) {
        gUsedStoredClipKeyByAlgo_.clear();
    }
    gUsedStoredClipKeyByAlgo_[slot] = clipKey;
}

bool CameraSession::matchesStartConfig(const CameraConfig& cfg) const
{
    return
        config_.id == cfg.id &&
        config_.webcam_index == cfg.webcam_index &&
        config_.rtspUrl == cfg.rtspUrl &&
        config_.storage.storeFrames == cfg.storage.storeFrames &&
        config_.storage.retentionDays == cfg.storage.retentionDays &&
        config_.frameCaptureIntervalSeconds == cfg.frameCaptureIntervalSeconds &&
        config_.analysisSpeed == cfg.analysisSpeed &&
        config_.modelTier == cfg.modelTier &&
        config_.isDrakonFindTemporarySession == cfg.isDrakonFindTemporarySession &&
        config_.isVideoSearchTemporarySession == cfg.isVideoSearchTemporarySession &&
        config_.forceVideoRecordingWithoutInference == cfg.forceVideoRecordingWithoutInference;
}

bool CameraSession::hasDirectVideoInferenceConfigured_()
{
    std::lock_guard<std::mutex> lock(algorithmsMutex_);

    for (const auto& ac : config_.algorithms) {
        if (ac.isCustomV2) {
            std::string inputType = ac.inputType;
            std::transform(inputType.begin(), inputType.end(), inputType.begin(),
                [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

            if (inputType.empty() || inputType == "video") {
                return true;
            }
            continue;
        }

        // Legacy/non-custom camera algorithms are consumed by video inferenceLoop_.
        return true;
    }

    return false;
}

std::vector<VideoCaptureProfile> CameraSession::getConfiguredVideoCaptureProfiles_() const
{
    std::lock_guard<std::mutex> lock(algorithmsMutex_);

    int tenSecondFps = 0;
    int sixtySecondFps = 0;
    for (const auto& ac : config_.algorithms) {
        if (!ac.isCustomV2) {
            tenSecondFps = (std::max)(tenSecondFps, 1);
            continue;
        }

        std::string inputType = ac.inputType;
        std::transform(inputType.begin(), inputType.end(), inputType.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (inputType.empty()) inputType = "video";

        std::string inferenceModel = ac.inferenceModel;
        std::transform(inferenceModel.begin(), inferenceModel.end(), inferenceModel.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (inferenceModel.empty()) inferenceModel = "ultra";

        if (inferenceModel == "core") {
            inputType = "video";
        }
        if (inputType != "video") {
            continue;
        }

        const int requestedFps = normalizeRecordingProfileFps_(ac.modelFps);
        const int clipSeconds = (inferenceModel == "core" || ac.runEverySeconds > 10) ? 60 : 10;
        if (clipSeconds > 10) {
            sixtySecondFps = (std::max)(sixtySecondFps, requestedFps);
        }
        else {
            tenSecondFps = (std::max)(tenSecondFps, requestedFps);
        }
    }

    if (shouldForceVideoCapture_() && tenSecondFps <= 0 && sixtySecondFps <= 0) {
        tenSecondFps = 1;
    }

    std::vector<VideoCaptureProfile> profiles;
    if (tenSecondFps > 0) {
        profiles.push_back(VideoCaptureProfile{ 10, tenSecondFps });
    }
    if (sixtySecondFps > 0) {
        profiles.push_back(VideoCaptureProfile{ 60, sixtySecondFps });
    }
    return profiles;
}

std::vector<VideoCaptureProfile> CameraSession::getEffectiveRecordingProfiles_() const
{
    int tenSecondFps = 0;
    int sixtySecondFps = 0;
    if (!config_.isDrakonFindTemporarySession) {
        const std::vector<VideoCaptureProfile> configuredProfiles = getConfiguredVideoCaptureProfiles_();
        tenSecondFps = captureProfileFpsForSeconds_(configuredProfiles, 10);
        sixtySecondFps = captureProfileFpsForSeconds_(configuredProfiles, 60);
    }

    int cameraNumericId = 0;
    try {
        cameraNumericId = std::stoi(config_.id);
    }
    catch (...) {
        cameraNumericId = 0;
    }

    if (owner_ && cameraNumericId > 0) {
        if (!config_.isDrakonFindTemporarySession) {
            tenSecondFps = (std::max)(tenSecondFps, owner_->getJobsRequestedVideoCaptureFps(cameraNumericId, 10));
            sixtySecondFps = (std::max)(sixtySecondFps, owner_->getJobsRequestedVideoCaptureFps(cameraNumericId, 60));
            tenSecondFps = (std::max)(tenSecondFps, owner_->getChatRequestedVideoCaptureFps(cameraNumericId, 10));
            sixtySecondFps = (std::max)(sixtySecondFps, owner_->getChatRequestedVideoCaptureFps(cameraNumericId, 60));
        }
        tenSecondFps = (std::max)(tenSecondFps, owner_->getDrakonFindRequestedVideoCaptureFps(cameraNumericId, 10));
        sixtySecondFps = (std::max)(sixtySecondFps, owner_->getDrakonFindRequestedVideoCaptureFps(cameraNumericId, 60));
    }

    if (shouldForceVideoCapture_() && tenSecondFps <= 0 && sixtySecondFps <= 0) {
        tenSecondFps = 1;
    }

    std::vector<VideoCaptureProfile> profiles;
    if (tenSecondFps > 0) {
        profiles.push_back(VideoCaptureProfile{ 10, normalizeRecordingProfileFps_(tenSecondFps) });
    }
    if (sixtySecondFps > 0) {
        profiles.push_back(VideoCaptureProfile{ 60, normalizeRecordingProfileFps_(sixtySecondFps) });
    }
    return profiles;
}

bool CameraSession::hasDirectImageInferenceConfigured_()
{
    std::lock_guard<std::mutex> lock(algorithmsMutex_);

    for (const auto& ac : config_.algorithms) {
        if (!ac.isCustomV2) continue;

        std::string inputType = ac.inputType;
        std::transform(inputType.begin(), inputType.end(), inputType.begin(),
            [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

        if (inputType == "image") {
            return true;
        }
    }

    return false;
}

bool CameraSession::shouldForceVideoCapture_() const
{
    if (config_.forceVideoRecordingWithoutInference) {
        return true;
    }

    if (!owner_) {
        return false;
    }

    int cameraNumericId = 0;
    try {
        cameraNumericId = std::stoi(config_.id);
    }
    catch (...) {
        return false;
    }

    // Drakon Find 60s windows must keep writing frames even when the motion
    // gate is idle, otherwise the rolling 60s clip never reaches finalization.
    return
        owner_->getChatRequestedVideoCaptureFps(cameraNumericId, 10) > 0 ||
        owner_->getChatRequestedVideoCaptureFps(cameraNumericId, 60) > 0 ||
        owner_->getDrakonFindRequestedVideoCaptureFps(cameraNumericId, 10) > 0 ||
        owner_->getDrakonFindRequestedVideoCaptureFps(cameraNumericId, 60) > 0;
}

bool CameraSession::isCustomAlgorithmDueNow_(const std::string& algoType, int runEverySeconds)
{
    const int normalizedRunEverySeconds = runEverySeconds <= 10 ? 10 : 60;
    const auto now = std::chrono::steady_clock::now();

    std::lock_guard<std::mutex> lock(customRunEveryMutex_);
    auto it = customLastRunAtByAlgo_.find(algoType);
    if (it == customLastRunAtByAlgo_.end()) {
        return true;
    }
    if (it->second.time_since_epoch().count() == 0) {
        return true;
    }

    const auto elapsedSeconds =
        std::chrono::duration_cast<std::chrono::seconds>(now - it->second).count();
    return elapsedSeconds >= normalizedRunEverySeconds;
}

bool CameraSession::shouldRunCustomAlgorithmNow_(const std::string& algoType, int runEverySeconds)
{
    const int normalizedRunEverySeconds = runEverySeconds <= 10 ? 10 : 60;
    const auto now = std::chrono::steady_clock::now();

    std::lock_guard<std::mutex> lock(customRunEveryMutex_);
    auto& lastRunAt = customLastRunAtByAlgo_[algoType];
    if (lastRunAt.time_since_epoch().count() != 0) {
        const auto elapsedSeconds =
            std::chrono::duration_cast<std::chrono::seconds>(now - lastRunAt).count();
        if (elapsedSeconds < normalizedRunEverySeconds) {
            return false;
        }
    }
    lastRunAt = now;
    return true;
}




void CameraSession::inferenceLoop_() {
    using TemporalEvidenceItem = CameraSession::TemporalEvidenceItem;
    using TemporalEvidenceTrail = std::deque<CameraSession::TemporalEvidenceItem>;

    Logger::instance().logDebug(config_.id, "inferenceLoop_: starting");

    const int analysisSpeed = config_.analysisSpeed;      // e.g. 1, 3, 5, 10
    const std::string modelTier = config_.modelTier;      // "light" | "plus" | "pro"

    auto recordDiskReadSample = [this](std::size_t bytes, const std::chrono::steady_clock::duration& duration) {
        const auto latencyUs = static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::microseconds>(duration).count()
        );
        if (bytes > 0) {
            telemetryDiskReadBytesTotal_.fetch_add(
                static_cast<std::uint64_t>(bytes),
                std::memory_order_relaxed
            );
        }
        telemetryDiskReadLatencyTotalUs_.fetch_add(latencyUs, std::memory_order_relaxed);
        telemetryDiskReadOperations_.fetch_add(1, std::memory_order_relaxed);
    };

    auto recordDecodeSample = [this](const std::chrono::steady_clock::duration& duration) {
        const auto latencyUs = static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::microseconds>(duration).count()
        );
        telemetryDecodeLatencyTotalUs_.fetch_add(latencyUs, std::memory_order_relaxed);
        telemetryDecodeSamples_.fetch_add(1, std::memory_order_relaxed);
    };

    auto recordInferenceInput = [this]() {
        telemetryInferenceInputTotal_.fetch_add(1, std::memory_order_relaxed);
    };

    auto recordInferenceOutcome = [this](bool success) {
        telemetryInferenceProcessedTotal_.fetch_add(1, std::memory_order_relaxed);
        if (success) {
            telemetryInferenceSuccessCount_.fetch_add(1, std::memory_order_relaxed);
        }
        else {
            telemetryInferenceErrorCount_.fetch_add(1, std::memory_order_relaxed);
        }
        telemetryLastInferenceTickMs_.store(steadyNowMs_(), std::memory_order_relaxed);
    };

    auto buildTemporalStateSummaryForLog = [](
        const nlohmann::json& state,
        const nlohmann::json& planEnvelope) -> std::string
    {
        const std::size_t eventsCount =
            state.is_object() && state.contains("events") && state["events"].is_array()
                ? state["events"].size()
                : 0u;
        const std::size_t entitiesCount =
            state.is_object() && state.contains("entities") && state["entities"].is_object()
                ? state["entities"].size()
                : 0u;
        const std::size_t identityMemoryCount =
            state.is_object() && state.contains("identity_memory") && state["identity_memory"].is_array()
                ? state["identity_memory"].size()
                : 0u;
        const std::size_t lastRoundEvidenceKeyCount =
            state.is_object() &&
            state.contains("meta") &&
            state["meta"].is_object() &&
            state["meta"].contains("last_round_evidence_keys") &&
            state["meta"]["last_round_evidence_keys"].is_array()
                ? state["meta"]["last_round_evidence_keys"].size()
                : 0u;
        const std::size_t candidateDecisionCount =
            state.is_object() &&
            state.contains("meta") &&
            state["meta"].is_object() &&
            state["meta"].contains("last_round_candidate_decisions") &&
            state["meta"]["last_round_candidate_decisions"].is_array()
                ? state["meta"]["last_round_candidate_decisions"].size()
                : 0u;
        const std::size_t identityMemoryFallbackCount =
            state.is_object() &&
            state.contains("meta") &&
            state["meta"].is_object() &&
            state["meta"].contains("last_round_identity_memory_fallbacks") &&
            state["meta"]["last_round_identity_memory_fallbacks"].is_array()
                ? state["meta"]["last_round_identity_memory_fallbacks"].size()
                : 0u;
        const std::size_t operatorStateCount =
            state.is_object() &&
            state.contains("meta") &&
            state["meta"].is_object() &&
            state["meta"].contains("operator_state") &&
            state["meta"]["operator_state"].is_object()
                ? state["meta"]["operator_state"].size()
                : 0u;
        const nlohmann::json stateSlice = temporal::buildStateSlice(state, planEnvelope);

        return
            "events_count=" + std::to_string(eventsCount) +
            " entities_count=" + std::to_string(entitiesCount) +
            " identity_memory_count=" + std::to_string(identityMemoryCount) +
            " last_round_evidence_keys_count=" + std::to_string(lastRoundEvidenceKeyCount) +
            " candidate_decisions_count=" + std::to_string(candidateDecisionCount) +
            " identity_memory_fallback_count=" + std::to_string(identityMemoryFallbackCount) +
            " operator_state_count=" + std::to_string(operatorStateCount) +
            " state_slice=" + stateSlice.dump();
    };

    auto normalizeCustomVideoRunEverySeconds = [](const AlgorithmConfig& algo) {
        std::string inputType = algo.inputType;
        std::transform(inputType.begin(), inputType.end(), inputType.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        if (inputType.empty()) inputType = "video";

        std::string inferenceModel = algo.inferenceModel;
        std::transform(inferenceModel.begin(), inferenceModel.end(), inferenceModel.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        if (inferenceModel.empty()) inferenceModel = "ultra";

        if (inputType != "video") {
            return 10;
        }
        if (inferenceModel == "core") {
            return 60;
        }
        return algo.runEverySeconds > 10 ? 60 : 10;
    };

    auto isCustomVideoAlgorithm = [&](const AlgorithmConfig& algo) {
        if (!algo.isCustomV2) return false;
        std::string inputType = algo.inputType;
        std::transform(inputType.begin(), inputType.end(), inputType.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        if (inputType.empty()) inputType = "video";
        return inputType == "video";
    };

    auto customVideoAlgorithmUsesSixtySecondWindow = [&](const AlgorithmConfig& algo) {
        return isCustomVideoAlgorithm(algo) && normalizeCustomVideoRunEverySeconds(algo) > 10;
    };

    auto customVideoAlgorithmNeedsBaseWindow = [&](const AlgorithmConfig& algo) {
        return isCustomVideoAlgorithm(algo) && normalizeCustomVideoRunEverySeconds(algo) <= 10;
    };



    try {
        while (running_) {

            // 1) Check if we have pending video clips for this camera and adapt the
            // processing window to backlog so no 10s segments are silently stranded.
            auto batchOpt = acquireAdaptiveInferenceBatchForCamera_(config_.id);

            if (!batchOpt.has_value()) {
                auto imageOpt = getOldestInferenceImageForCamera(config_.id);
                if (!imageOpt.has_value()) {
                    std::optional<Frame> opt = buffer_.pop();

                    if (!opt.has_value()) {
                        if (!running_) break;
                        std::this_thread::sleep_for(std::chrono::milliseconds(5));
                        continue;
                    }

                    bool hasDirectSixtySecondCustomVideoAlgorithm = false;
                    {
                        std::lock_guard<std::mutex> lock(algorithmsMutex_);
                        for (const auto& ac : config_.algorithms) {
                            if (customVideoAlgorithmUsesSixtySecondWindow(ac)) {
                                hasDirectSixtySecondCustomVideoAlgorithm = true;
                                break;
                            }
                        }
                    }

                    // Keep draining one frame so captureLoop_ does not stall, but still
                    // allow direct 60s custom video algorithms to run from finalized clips.
                    if (!hasDirectSixtySecondCustomVideoAlgorithm) {
                        continue;
                    }
                }
                else {
                const std::string imagePath = *imageOpt;
                auto removeProcessedImage = [&]() {
                    std::error_code rmEc;
                    fs::remove(imagePath, rmEc);
                    if (rmEc) {
                        Logger::instance().logDebug(
                            config_.id,
                            "inferenceLoop_: failed to remove processed image snapshot: " + rmEc.message()
                        );
                    }
                };

                std::vector<AlgorithmConfig> customImageAlgos;
                {
                    std::lock_guard<std::mutex> lock(algorithmsMutex_);
                    for (const auto& ac : config_.algorithms) {
                        if (!ac.isCustomV2) continue;
                        std::string inputType = ac.inputType;
                        std::transform(inputType.begin(), inputType.end(), inputType.begin(), [](unsigned char c) {
                            return static_cast<char>(std::tolower(c));
                        });
                        if (inputType == "image") {
                            customImageAlgos.push_back(ac);
                        }
                    }
                }

                if (customImageAlgos.empty() || !owner_) {
                    removeProcessedImage();
                    continue;
                }

                std::vector<unsigned char> rawImageBytes;
                {
                    const auto diskReadStartedAt = std::chrono::steady_clock::now();
                    std::ifstream ifs(imagePath, std::ios::binary);
                    if (!ifs) {
                        Logger::instance().logDebug(
                            config_.id,
                            "inferenceLoop_: failed opening image snapshot for inference: " + imagePath
                        );
                        removeProcessedImage();
                        continue;
                    }
                    rawImageBytes.assign(
                        std::istreambuf_iterator<char>(ifs),
                        std::istreambuf_iterator<char>()
                    );
                    recordDiskReadSample(
                        rawImageBytes.size(),
                        std::chrono::steady_clock::now() - diskReadStartedAt
                    );
                }
                if (rawImageBytes.empty()) {
                    removeProcessedImage();
                    continue;
                }

                recordInferenceInput();

                std::string imageMimeType = "image/jpeg";
                {
                    std::string ext = fs::path(imagePath).extension().string();
                    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) {
                        return static_cast<char>(std::tolower(c));
                    });
                    if (ext == ".png") {
                        imageMimeType = "image/png";
                    }
                }

                const std::string baseImageDataUrl =
                    std::string("data:") + imageMimeType + ";base64," +
                    base64_encode(rawImageBytes.data(), rawImageBytes.size());
                const auto decodeStartedAt = std::chrono::steady_clock::now();
                cv::Mat decodedSnapshotFrame = cv::imread(imagePath, cv::IMREAD_COLOR);
                recordDecodeSample(std::chrono::steady_clock::now() - decodeStartedAt);

                auto nowTimestampIso = []() {
                    auto now = std::chrono::system_clock::now();
                    auto msSinceEpoch =
                        std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
                    std::time_t tt = static_cast<std::time_t>(msSinceEpoch / 1000);
                    std::tm tm{};
#ifdef _WIN32
                    localtime_s(&tm, &tt);
#else
                    localtime_r(&tt, &tm);
#endif
                    char tsBuf[32];
                    std::strftime(tsBuf, sizeof(tsBuf), "%Y-%m-%dT%H:%M:%S", &tm);
                    return std::string(tsBuf);
                };

                auto stripDataUrlPrefix = [](const std::string& dataUrl) {
                    const auto commaPos = dataUrl.find(',');
                    if (commaPos == std::string::npos) return dataUrl;
                    return dataUrl.substr(commaPos + 1);
                };

                int cameraIdNumeric = -1;
                try {
                    cameraIdNumeric = std::stoi(config_.id);
                }
                catch (...) {
                    cameraIdNumeric = -1;
                }

                std::string clientId;
                std::string exeToken;
                std::string backendBaseUrl;
                if (owner_) {
                    clientId = owner_->getClientId();
                    exeToken = owner_->getExeToken();
                    backendBaseUrl = owner_->getBackendBaseUrl();
                }

                for (const auto& customAlgo : customImageAlgos) {
                    if (customAlgo.modelApiKey.empty()) {
                        continue;
                    }

                    bool shouldInfer = true;
                    const auto frameWindow = resolveFrameWindowForAlgoCamera_(customAlgo);
                    const bool hasFrameWindow = isFrameWindowActiveCamera_(frameWindow);
                    cv::Mat snapshotFrameForAlgo = decodedSnapshotFrame;
                    if (hasFrameWindow) {
                        if (decodedSnapshotFrame.empty()) {
                            shouldInfer = false;
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: image mode failed to decode snapshot for frame window algo=" +
                                customAlgo.type
                            );
                        }
                        else {
                            snapshotFrameForAlgo =
                                cropFrameToFrameWindowCamera_(decodedSnapshotFrame, frameWindow, nullptr);
                            if (snapshotFrameForAlgo.empty()) {
                                shouldInfer = false;
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: image mode crop returned empty frame for algo=" +
                                    customAlgo.type
                                );
                            }
                        }
                    }

                    std::string inferenceImageDataUrl = baseImageDataUrl;
                    std::vector<std::string> overlayRegionIds;
                    std::vector<std::string> motionTriggeredRegionIds;

                    const auto polygonRegions = remapRegionsToFrameWindowCamera_(
                        collectPolygonRegionsForAlgo_(customAlgo),
                        frameWindow
                    );
                        std::vector<AlgorithmConfig::AnalysisRegion> motionRegions = polygonRegions;
                        if (motionRegions.empty() && hasFrameWindow) {
                            AlgorithmConfig::AnalysisRegion viewportRegion;
                            viewportRegion.enabled = true;
                            viewportRegion.fullFrame = false;
                            viewportRegion.polygonNorm = {
                                { 0.0, 0.0 },
                            { 1.0, 0.0 },
                            { 1.0, 1.0 },
                            { 0.0, 1.0 }
                        };
                        motionRegions.push_back(std::move(viewportRegion));
                    }

                    if (!motionRegions.empty() && customAlgo.onlyCaptureOnMotion) {
                        if (snapshotFrameForAlgo.empty()) {
                            shouldInfer = false;
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: image mode failed to prepare snapshot for ROI motion algo=" +
                                customAlgo.type
                            );
                        }
                        else {
                            cv::Mat previousSnapshot;
                            {
                                std::lock_guard<std::mutex> lock(customImageMotionMutex_);
                                auto itPrev = customImagePreviousByAlgo_.find(customAlgo.type);
                                if (itPrev != customImagePreviousByAlgo_.end() && !itPrev->second.empty()) {
                                    previousSnapshot = itPrev->second.clone();
                                }
                                customImagePreviousByAlgo_[customAlgo.type] = snapshotFrameForAlgo.clone();
                            }

                            if (previousSnapshot.empty()) {
                                shouldInfer = false;
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: waiting previous snapshot for ROI motion algo=" +
                                    customAlgo.type
                                );
                            }
                            else {
                                bool hasRegionMotion = false;
                                std::string motionErr;
                                if (!detectMotionInAnyRegionFromStillPairCamera_(
                                    previousSnapshot,
                                    snapshotFrameForAlgo,
                                    motionRegions,
                                    hasRegionMotion,
                                    &motionTriggeredRegionIds,
                                    &motionErr))
                                {
                                    shouldInfer = false;
                                    Logger::instance().logDebug(
                                        config_.id,
                                        "inferenceLoop_: image ROI motion check failed algo=" +
                                        customAlgo.type + " err=" + motionErr
                                    );
                                }
                                else if (!hasRegionMotion) {
                                    shouldInfer = false;
                                    Logger::instance().logDebug(
                                        config_.id,
                                        "inferenceLoop_: image ROI motion not detected, skipping algo=" +
                                        customAlgo.type
                                    );
                                }
                            }
                        }
                    }
                    else if (customAlgo.onlyCaptureOnMotion) {
                        shouldInfer = inferenceEnabled_.load(std::memory_order_relaxed);
                    }

                    if (!shouldInfer) {
                        continue;
                    }
                    if (!shouldRunCustomAlgorithmNow_(customAlgo.type, customAlgo.runEverySeconds)) {
                        continue;
                    }

                    if (hasFrameWindow) {
                        if (!encodeFrameToJpegDataUrlCamera_(snapshotFrameForAlgo, inferenceImageDataUrl)) {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: failed to encode cropped image for algo=" + customAlgo.type
                            );
                            continue;
                        }
                    }

                    if (!polygonRegions.empty()) {
                        cv::Mat decoded = snapshotFrameForAlgo.empty()
                            ? cv::Mat()
                            : snapshotFrameForAlgo.clone();
                        if (!decoded.empty()) {
                            drawAnalysisOverlaysOnFrameCamera_(decoded, polygonRegions, &overlayRegionIds);
                            if (!encodeFrameToJpegDataUrlCamera_(decoded, inferenceImageDataUrl)) {
                                inferenceImageDataUrl.clear();
                            }
                        }
                    }
                    if (inferenceImageDataUrl.empty()) {
                        continue;
                    }

                    std::vector<FaceReferenceImage> faceReferences;
                    for (const auto& target : customAlgo.faceTargets) {
                        for (const auto& image : target.images) {
                            if (image.imageUrl.empty()) continue;
                            std::vector<unsigned char> imageBytes;
                            if (!owner_->downloadUrlToBytes_(image.imageUrl, imageBytes)) continue;
                            FaceReferenceImage ref;
                            ref.targetId = target.id;
                            ref.targetName = target.name;
                            ref.targetDescription = target.description;
                            ref.referenceImageUrl = image.imageUrl;
                            ref.imageDataUrl =
                                std::string("data:image/jpeg;base64,") +
                                base64_encode(imageBytes.data(), imageBytes.size());
                            faceReferences.push_back(std::move(ref));
                        }
                    }

                    std::vector<NegativeReferenceImage> negativeReferences;
                    for (const auto& image : customAlgo.negativeReferenceImages) {
                        if (image.imageUrl.empty()) continue;
                        std::vector<unsigned char> imageBytes;
                        if (!owner_->downloadUrlToBytes_(image.imageUrl, imageBytes)) continue;
                        NegativeReferenceImage ref;
                        ref.imageId = image.id;
                        ref.imageDataUrl =
                            std::string("data:image/jpeg;base64,") +
                            base64_encode(imageBytes.data(), imageBytes.size());
                        negativeReferences.push_back(std::move(ref));
                    }

                    const std::string nowIsoForInference = temporal::nowIso();
                    const std::string basePromptCore =
                        customAlgo.promptTemplate.empty() ? customAlgo.llmPrompt : customAlgo.promptTemplate;
                    const std::string temporalPromptHash =
                        temporal::computePromptRevisionHash(basePromptCore, customAlgo.alertCondition);
                    std::string runtimePrompt = basePromptCore;
                    bool temporalPlanActive = false;
                    bool temporalReport = false;
                    nlohmann::json temporalOperatorResults = nlohmann::json::array();
                    const std::string temporalLanguage = "pt-BR";
                    const std::string temporalSlotKey =
                        customAlgo.type + "#" +
                        std::to_string(customAlgo.algorithmId > 0 ? customAlgo.algorithmId : 0);
                    TemporalRuntimeSlot temporalSlot;
                    temporalSlot.state = temporal::defaultState();
                    const bool payloadPlanMatchesCurrentPrompt =
                        temporal::decisionCacheable(customAlgo.temporalPlanEnvelope) &&
                        temporal::planMatchesPromptRevision(
                            customAlgo.temporalPlanEnvelope,
                            basePromptCore,
                            customAlgo.alertCondition
                        );
                    {
                        std::lock_guard<std::mutex> lock(temporalMutex_);
                        auto itTemporal = temporalByAlgo_.find(temporalSlotKey);
                        if (itTemporal != temporalByAlgo_.end()) {
                            temporalSlot = itTemporal->second;
                        }
                    }
                    const bool slotPlanMatchesCurrentPrompt =
                        temporal::decisionCacheable(temporalSlot.planEnvelope) &&
                        ((!temporalSlot.promptHash.empty() && temporalSlot.promptHash == temporalPromptHash) ||
                         temporal::planMatchesPromptRevision(
                             temporalSlot.planEnvelope,
                             basePromptCore,
                             customAlgo.alertCondition
                         ));
                    if (!slotPlanMatchesCurrentPrompt) {
                        temporalSlot.planEnvelope = payloadPlanMatchesCurrentPrompt
                            ? customAlgo.temporalPlanEnvelope
                            : nlohmann::json::object();
                        temporalSlot.state = temporal::defaultState();
                        temporalSlot.visualState = nlohmann::json::object();
                    }
                    if (!temporalSlot.state.is_object() || temporalSlot.state.empty()) {
                        temporalSlot.state = temporal::defaultState();
                    }
                    if (!temporalSlot.visualState.is_object()) {
                        temporalSlot.visualState = nlohmann::json::object();
                    }
                    temporalSlot.promptHash = temporalPromptHash;

                        if (owner_) {
                            const bool temporalPlanReady = owner_->ensureTemporalPlanForRuntime(
                                "camera_algorithm",
                                customAlgo.algorithmId > 0 ? customAlgo.algorithmId : cameraIdNumeric,
                                basePromptCore,
                                customAlgo.alertCondition,
                                customAlgo.negativeCondition,
                                customAlgo.inputType.empty() ? std::string("image") : customAlgo.inputType,
                                temporalLanguage,
                                customAlgo.inferenceModel,
                                customAlgo.modelApiKey,
                                temporalSlot.planEnvelope,
                                customAlgo.algorithmId > 0,
                                config_.id
                            );
                            if (temporal::decisionCacheable(temporalSlot.planEnvelope)) {
                                temporalSlot.promptHash = temporalPromptHash;
                                std::lock_guard<std::mutex> lock(temporalMutex_);
                                temporalByAlgo_[temporalSlotKey] = temporalSlot;
                            }
                            if (temporalPlanReady && temporal::planUsable(temporalSlot.planEnvelope)) {
                                temporalSlot.promptHash = temporalPromptHash;
                                const nlohmann::json temporalInput = temporal::buildInferenceInput(
                                    temporalSlot.planEnvelope,
                                    temporalSlot.state,
                                    cameraIdNumeric,
                                    nowIsoForInference
                                );
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: temporal input injected (image) algo=" + customAlgo.type +
                                    " camera_id=" + std::to_string(cameraIdNumeric) +
                                    " now_utc=" +
                                    temporalInput.value("time_context", nlohmann::json::object()).value("now_utc", "") +
                                    " payload=" + temporalInput.dump()
                                );
                                runtimePrompt += temporal::runtimePromptAppendix(temporalInput);
                                temporalPlanActive = true;
                            }
                        }

                    int primaryPromptTokens = 0;
                    int primaryOutputTokens = 0;
                    int primaryTotalTokens = 0;
                    VideoHit primaryHit = owner_->runCameraCustomImageInference(
                        cameraIdNumeric,
                        inferenceImageDataUrl,
                        runtimePrompt,
                        faceReferences,
                        negativeReferences,
                        customAlgo.alertCondition,
                        customAlgo.modelName,
                        customAlgo.modelApiKey,
                        nowIsoForInference,
                        primaryPromptTokens,
                        primaryOutputTokens,
                        primaryTotalTokens
                    );
                    const int cameraAlgorithmId = customAlgo.algorithmId > 0 ? customAlgo.algorithmId : 0;
                    const std::string cameraAgentRunId = buildCameraAgentRunId_(config_, customAlgo);
                    const std::string eventDisplayName =
                        customAlgo.displayName.empty() ? customAlgo.type : customAlgo.displayName;

                    if (!clientId.empty() && !exeToken.empty() && !backendBaseUrl.empty()) {
                        sendTokenUsageAsync(
                            config_.id,
                            primaryPromptTokens,
                            primaryOutputTokens,
                            primaryTotalTokens,
                            "agent",
                            customAlgo.type,
                            config_.cameraSessionId,
                            cameraAlgorithmId,
                            cameraAgentRunId,
                            clientId,
                            exeToken,
                            backendBaseUrl
                        );
                    }

                    bool finalAlert = primaryHit.alertCondition;
                    const bool llmAlertCondition = primaryHit.alertCondition;
                    std::string decisionSource = "llm";
                    std::string temporalDecisionSummary;

                    const bool localAlertSignal = finalAlert;
                    const std::string localDecisionSource = decisionSource;
                    if (temporalPlanActive) {
                        temporal::applyRound(
                            temporalSlot.state,
                            temporalSlot.planEnvelope,
                            primaryHit.identityPatch,
                            primaryHit.observations,
                            primaryHit.temporalEvidenceCandidates,
                            nowIsoForInference,
                            primaryHit.answer,
                            primaryHit.unknownReasons,
                            std::string(),
                            std::string(),
                            primaryHit.faceIdentityMatches
                        );
                        const nlohmann::json candidateDecisions =
                            temporal::extractLastRoundCandidateDecisions(temporalSlot.state);
                        if (candidateDecisions.is_array() && !candidateDecisions.empty()) {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: temporal candidate decisions (image) algo=" + customAlgo.type +
                                " camera_id=" + config_.id +
                                " decisions=" + candidateDecisions.dump()
                            );
                        }
                        Logger::instance().logDebug(
                            config_.id,
                            "inferenceLoop_: temporal state after applyRound (image) algo=" + customAlgo.type +
                            " camera_id=" + config_.id + " " +
                            buildTemporalStateSummaryForLog(
                                temporalSlot.state,
                                temporalSlot.planEnvelope)
                        );
                        const temporal::EvalResult eval = temporal::evaluate(
                            temporalSlot.state,
                            temporalSlot.planEnvelope,
                            nowIsoForInference
                        );
                        const bool fallbackToLocalAlert =
                            temporal::shouldFallbackToLocalAlert(eval, localAlertSignal);
                        temporalOperatorResults = eval.operatorResults;
                        temporalReport = eval.report;
                        finalAlert = eval.alert;
                        primaryHit.alertCondition = eval.alert;
                        decisionSource = "temporal_engine";
                        temporalDecisionSummary = eval.summary;
                        if (finalAlert &&
                            temporal::shouldSuppressStalePresenceCarryAlert(
                                temporalOperatorResults,
                                localAlertSignal,
                                primaryHit.answer,
                                primaryHit.unknownReasons,
                                primaryHit.identityPatch,
                                primaryHit.observations))
                        {
                            finalAlert = false;
                            primaryHit.alertCondition = false;
                            decisionSource = localDecisionSource;
                            temporalDecisionSummary = "Suppressed stale presence carry because the current batch has no visible target evidence.";
                        }
                        else if (finalAlert &&
                            temporal::shouldSuppressThreatCarryAlert(
                                temporalSlot.planEnvelope,
                                localAlertSignal,
                                primaryHit.answer,
                                primaryHit.unknownReasons,
                                primaryHit.identityPatch,
                                primaryHit.observations))
                        {
                            finalAlert = false;
                            primaryHit.alertCondition = false;
                            decisionSource = localDecisionSource;
                            temporalDecisionSummary = "Suppressed stale threat carry because the current batch has no visible threat evidence.";
                        }
                        temporalSlot.touchedAt = std::chrono::steady_clock::now();
                        temporalSlot.promptHash = temporalPromptHash;
                        {
                            std::lock_guard<std::mutex> lock(temporalMutex_);
                            temporalByAlgo_[temporalSlotKey] = temporalSlot;
                        }
                        if (fallbackToLocalAlert && !finalAlert) {
                            finalAlert = true;
                            primaryHit.alertCondition = true;
                            decisionSource = localDecisionSource;
                            const std::string fallbackSummary =
                                temporal::describeLocalAlertFallback(eval);
                            if (temporalDecisionSummary.empty()) {
                                temporalDecisionSummary = fallbackSummary;
                            } else {
                                temporalDecisionSummary += "; " + fallbackSummary;
                            }
                        }
                    }

                    const bool identityCardsMaterialized =
                        owner_ &&
                        owner_->materializeOperationalIdentityCards(
                            primaryHit,
                            temporalSlot.state,
                            temporalSlot.visualState,
                            config_.id,
                            "CameraSession::inferenceLoop_(image)"
                        );
                    if (identityCardsMaterialized) {
                        temporalSlot.touchedAt = std::chrono::steady_clock::now();
                        temporalSlot.promptHash = temporalPromptHash;
                        std::lock_guard<std::mutex> lock(temporalMutex_);
                        temporalByAlgo_[temporalSlotKey] = temporalSlot;
                    }

                    const std::string cameraAgentEventAtUtc =
                        !primaryHit.eventTimestampUtcIso.empty()
                            ? primaryHit.eventTimestampUtcIso
                            : nowIsoForInference;
                    const std::string cameraAgentResultEventId =
                        buildCameraAgentResultEventId_(
                            cameraAgentRunId,
                            cameraAgentEventAtUtc,
                            primaryHit.eventFrameIndex
                        );

                    if (owner_) {
                        nlohmann::json cameraAgentResultDetails = nlohmann::json::object();
                        cameraAgentResultDetails["camera_id"] = cameraIdNumeric;
                        cameraAgentResultDetails["camera_name"] = config_.name;
                        cameraAgentResultDetails["source_type"] = "camera_algorithm";
                        cameraAgentResultDetails["event_id"] = cameraAgentResultEventId;
                        cameraAgentResultDetails["agent_run_id"] = cameraAgentRunId;
                        cameraAgentResultDetails["agent_label"] = eventDisplayName;
                        cameraAgentResultDetails["algorithm_type"] = customAlgo.type;
                        cameraAgentResultDetails["algo_type"] = customAlgo.type;
                        cameraAgentResultDetails["input_type"] =
                            customAlgo.inputType.empty() ? std::string("image") : customAlgo.inputType;
                        cameraAgentResultDetails["inference_model"] = customAlgo.inferenceModel;
                        cameraAgentResultDetails["model"] = customAlgo.modelName;
                        cameraAgentResultDetails["answer"] = primaryHit.answer;
                        cameraAgentResultDetails["decision_source"] = decisionSource;
                        cameraAgentResultDetails["llm_alert_condition"] = llmAlertCondition;
                        cameraAgentResultDetails["final_alert_condition"] = finalAlert;
                        if (!primaryHit.primaryIdentityCardId.empty()) {
                            cameraAgentResultDetails["primary_identity_card_id"] =
                                primaryHit.primaryIdentityCardId;
                        }
                        if (primaryHit.identityCards.is_array() && !primaryHit.identityCards.empty()) {
                            cameraAgentResultDetails["identity_cards"] = primaryHit.identityCards;
                        }
                        cameraAgentResultDetails["prompt_tokens"] = primaryPromptTokens;
                        cameraAgentResultDetails["output_tokens"] = primaryOutputTokens;
                        cameraAgentResultDetails["total_tokens"] = primaryTotalTokens;
                        cameraAgentResultDetails["event_timestamp_utc"] = cameraAgentEventAtUtc;
                        if (!config_.cameraSessionId.empty()) {
                            cameraAgentResultDetails["camera_session_id"] = config_.cameraSessionId;
                        }
                        if (cameraAlgorithmId > 0) {
                            cameraAgentResultDetails["camera_algorithm_id"] = cameraAlgorithmId;
                            cameraAgentResultDetails["algorithm_id"] = cameraAlgorithmId;
                        }
                        if (temporalPlanActive) {
                            cameraAgentResultDetails["operator_results"] = temporalOperatorResults;
                            if (!temporalDecisionSummary.empty()) {
                                cameraAgentResultDetails["temporal_decision_summary"] =
                                    temporalDecisionSummary;
                            }
                        }
                        owner_->postAgentEvent(
                            "camera_agent_result",
                            cameraIdNumeric > 0 ? std::optional<int>(cameraIdNumeric) : std::nullopt,
                            "",
                            "Camera AI agent evaluated the current image input.",
                            cameraAgentResultDetails
                        );
                    }

                    if (temporalPlanActive && temporalReport && owner_) {
                        const nlohmann::json reportIdentityCards =
                            owner_->collectOperationalIdentityCards(
                                temporalSlot.state,
                                temporalSlot.visualState
                            );
                        std::string reportPrimaryIdentityCardId = primaryHit.primaryIdentityCardId;
                        if (reportPrimaryIdentityCardId.empty() &&
                            reportIdentityCards.is_array() &&
                            !reportIdentityCards.empty() &&
                            reportIdentityCards[0].is_object() &&
                            reportIdentityCards[0].contains("card_id") &&
                            reportIdentityCards[0]["card_id"].is_string())
                        {
                            reportPrimaryIdentityCardId =
                                reportIdentityCards[0]["card_id"].get<std::string>();
                        }
                        nlohmann::json reportDetails = nlohmann::json::object();
                        reportDetails["camera_id"] = cameraIdNumeric;
                        reportDetails["camera_name"] = config_.name;
                        reportDetails["source_type"] = "camera_algorithm";
                        reportDetails["event_id"] = cameraAgentResultEventId + ":temporal";
                        reportDetails["agent_run_id"] = cameraAgentRunId;
                        reportDetails["agent_label"] = eventDisplayName;
                        reportDetails["input_type"] =
                            customAlgo.inputType.empty() ? std::string("image") : customAlgo.inputType;
                        reportDetails["algorithm_type"] = customAlgo.type;
                        reportDetails["algo_type"] = customAlgo.type;
                        reportDetails["inference_model"] = customAlgo.inferenceModel;
                        reportDetails["model"] = customAlgo.modelName;
                        reportDetails["operator_results"] = temporalOperatorResults;
                        reportDetails["answer"] = primaryHit.answer;
                        reportDetails["decision_source"] = decisionSource;
                        reportDetails["llm_alert_condition"] = llmAlertCondition;
                        reportDetails["final_alert_condition"] = finalAlert;
                        if (!reportPrimaryIdentityCardId.empty()) {
                            reportDetails["primary_identity_card_id"] =
                                reportPrimaryIdentityCardId;
                        }
                        if (reportIdentityCards.is_array() && !reportIdentityCards.empty()) {
                            reportDetails["identity_cards"] = reportIdentityCards;
                        }
                        else if (primaryHit.identityCards.is_array() && !primaryHit.identityCards.empty()) {
                            reportDetails["identity_cards"] = primaryHit.identityCards;
                        }
                        reportDetails["prompt_tokens"] = primaryPromptTokens;
                        reportDetails["output_tokens"] = primaryOutputTokens;
                        reportDetails["total_tokens"] = primaryTotalTokens;
                        reportDetails["event_timestamp_utc"] = cameraAgentEventAtUtc;
                        if (!config_.cameraSessionId.empty()) {
                            reportDetails["camera_session_id"] = config_.cameraSessionId;
                        }
                        if (cameraAlgorithmId > 0) {
                            reportDetails["camera_algorithm_id"] = cameraAlgorithmId;
                            reportDetails["algorithm_id"] = cameraAlgorithmId;
                        }
                        if (!temporalDecisionSummary.empty()) {
                            reportDetails["temporal_decision_summary"] = temporalDecisionSummary;
                        }
                        owner_->postAgentEvent(
                            "temporal_report",
                            std::optional<int>(cameraIdNumeric),
                            "",
                            "",
                            reportDetails
                        );
                    }

                    if (finalAlert) {
                        const std::string timestampIso = nowTimestampIso();

                        std::vector<std::string> alertRegionIds = primaryHit.alertRegionIds;
                        if (alertRegionIds.empty() && !overlayRegionIds.empty()) {
                            alertRegionIds = overlayRegionIds;
                        }
                        if (alertRegionIds.empty() && !motionTriggeredRegionIds.empty()) {
                            alertRegionIds = motionTriggeredRegionIds;
                        }

                        std::set<std::string> alertRegionNamesSet;
                        for (const auto& regionId : alertRegionIds) {
                            for (const auto& region : customAlgo.analysisRegions) {
                                if (region.regionId == regionId) {
                                    const std::string nm = region.label.empty() ? region.regionId : region.label;
                                    if (!nm.empty()) alertRegionNamesSet.insert(nm);
                                }
                            }
                        }

                        nlohmann::json extra = nlohmann::json::object();
                        extra["algorithm_type"] = customAlgo.type;
                        extra["alert_region_ids"] = alertRegionIds;
                        extra["alert_region_names"] = std::vector<std::string>(
                            alertRegionNamesSet.begin(),
                            alertRegionNamesSet.end()
                        );
                        extra["validator_model"] = "";
                        extra["source_type"] = "camera_algorithm";
                        extra["event_id"] = cameraAgentResultEventId + ":alert";
                        extra["decision_source"] = decisionSource;
                        extra["llm_alert_condition"] = llmAlertCondition;
                        extra["final_alert_condition"] = finalAlert;
                        extra["agent_run_id"] = cameraAgentRunId;
                        extra["agent_label"] = eventDisplayName;
                        extra["answer"] = primaryHit.answer;
                        if (!primaryHit.primaryIdentityCardId.empty()) {
                            extra["primary_identity_card_id"] = primaryHit.primaryIdentityCardId;
                        }
                        if (primaryHit.identityCards.is_array() && !primaryHit.identityCards.empty()) {
                            extra["identity_cards"] = primaryHit.identityCards;
                        }
                        if (!config_.cameraSessionId.empty()) {
                            extra["camera_session_id"] = config_.cameraSessionId;
                        }
                        if (cameraAlgorithmId > 0) {
                            extra["camera_algorithm_id"] = cameraAlgorithmId;
                            extra["algorithm_id"] = cameraAlgorithmId;
                        }
                        if (temporalPlanActive) {
                            extra["temporal_operator_results"] = temporalOperatorResults;
                            if (!temporalDecisionSummary.empty()) {
                                extra["temporal_decision_summary"] = temporalDecisionSummary;
                            }
                        }

                        owner_->sendAlgoEvent(
                            config_.id,
                            config_.name,
                            eventDisplayName,
                            timestampIso,
                            "image",
                            stripDataUrlPrefix(inferenceImageDataUrl),
                            extra
                        );
                    }
                }

                removeProcessedImage();
                recordInferenceOutcome(true);
                continue;
                }
            }

            std::string clipPath;
            int adaptiveWindowSeconds = 10;
            size_t adaptiveSourceCount = 0;
            if (batchOpt.has_value()) {
                clipPath = batchOpt->clipPath;
                adaptiveWindowSeconds = batchOpt->windowSeconds;
                adaptiveSourceCount = batchOpt->sourceCount;
                Logger::instance().logDebug(
                    config_.id,
                    "inferenceLoop_: selected video window for inference: " + clipPath +
                    " window_seconds=" + std::to_string(adaptiveWindowSeconds) +
                    " source_clip_count=" + std::to_string(adaptiveSourceCount)
                );
            }

            // 2) Build list of active algos & LLM prompts (same as before)
            std::vector<AlgorithmConfig> algosCopy;
            {
                std::lock_guard<std::mutex> lock(algorithmsMutex_);
                algosCopy = config_.algorithms;
            }

            std::vector<std::string> activeAlgos;
            std::unordered_map<std::string, std::string> algoLlmPrompts;
            std::string activeAlgosList;

            std::unordered_map<std::string, std::string> algoDisplayNames;
            std::vector<AlgorithmConfig> customV2Algos;
            


            std::vector<FaceTargetRef> faceTargets;
            faceTargets.reserve(8);

            for (const auto& ac : algosCopy) {
                if (ac.isCustomV2) {
                    customV2Algos.push_back(ac);
                    continue;
                }

                activeAlgos.push_back(ac.type);

                if (!ac.llmPrompt.empty()) {
                    algoLlmPrompts[ac.type] = ac.llmPrompt;
                }

                if (!ac.displayName.empty()) algoDisplayNames[ac.type] = ac.displayName;
                else algoDisplayNames[ac.type] = ac.type;

                if (ac.type == "faceid") {
                    if (ac.configJson.contains("faceid_targets") &&
                        ac.configJson["faceid_targets"].is_array())
                    {
                        for (const auto& t : ac.configJson["faceid_targets"]) {
                            FaceTargetRef ref;

                            if (t.contains("id") && t["id"].is_number_integer())
                                ref.id = t["id"].get<int>();

                            if (t.contains("person_name") && t["person_name"].is_string())
                                ref.person_name = t["person_name"].get<std::string>();

                            if (t.contains("person_description") && t["person_description"].is_string())
                                ref.person_description = t["person_description"].get<std::string>();

                            std::string imageUrl;
                            if (t.contains("image_url") && t["image_url"].is_string())
                                imageUrl = t["image_url"].get<std::string>();

                            if (!imageUrl.empty() && owner_) {
                                std::vector<unsigned char> imgBytes;
                                if (owner_->downloadUrlToBytes_(imageUrl, imgBytes)) {
                                    ref.image_b64 = base64_encode(imgBytes.data(), imgBytes.size());
                                    ref.mime_type = "image/jpeg";
                                    if (ref.id >= 0 && !ref.image_b64.empty()) {
                                        faceTargets.push_back(std::move(ref));
                                    }
                                }
                            }
                        }
                    }

                    // Only inject the heavy FaceID rules if we actually have targets
                    if (!faceTargets.empty()) {
                        std::string& p = algoLlmPrompts["faceid"];
                        p += "\nREFERENCE IMAGE LOGIC:\n"
                            "- Sometimes the user provides MULTIPLE reference images before the CCTV frames.\n"
                            "- Each reference image is tagged as USER_REFERENCE_IMAGE and is ALWAYS a close-up selfie or a crop of a single HUMAN FACE.\n"
                            "- Each reference image is labeled with TARGET_ID and TARGET_NAME (and may include TARGET_DESC).\n"
                            "- Treat each reference face as a possible target person.\n"
                            "- Your job is to check if a VERY SIMILAR FACE appears in the CCTV video at any moment.\n\n"
                            "INSTRUCTIONS FOR FACE MATCHING:\n"
                            "1. First, analyze EACH USER_REFERENCE_IMAGE and memorize distinct features for each target:\n"
                            "   (Bald head, Beard style, Hair style, Glasses, Hair color, Ethnicity, Gender, Age, Facial hair style, Facial hair color).\n"
                            "   Keep the association: TARGET_ID + TARGET_NAME -> features.\n"
                            "2. For each CCTV frame, analyze every person's face visible.\n"
                            "3. For each visible face, compare against ALL targets using specifically:\n"
                            "   Hair vs Baldness, Hair style, Hair color, Ethnicity, Gender, Age, Facial hair style, Facial hair color.\n"
                            "4. If the person is facing away or you cannot see the face clearly, do not attempt to classify.\n"
                            "5. If you are not very sure about the match do not classify positively.\n"
                            "6. If more than one target could match, choose the single BEST match (highest similarity / most consistent features).\n"
                            "7. Output REQUIREMENT:\n"
                            "   - If a match is found, return: \"faceid\": {\"match\":\"YES\",\"target_id\":<TARGET_ID>,\"target_name\":\"<TARGET_NAME>\"}\n"
                            "   - If no match is found, return: \"faceid\": {\"match\":\"NO\",\"target_id\":null,\"target_name\":\"\"}\n";
                    }

                }
            }

            auto buildTelegramSettingsSnapshot = [&]() {
                TelegramSettings ts;
                std::lock_guard<std::mutex> lock(algorithmsMutex_);
                if (config_.telegramEnabled &&
                    !config_.telegramBotToken.empty() &&
                    !config_.telegramChatId.empty())
                {
                    ts.enabled = true;
                    ts.profile = "camera_" + config_.id;
                    ts.chat_id = config_.telegramChatId;
                    ts.bot_token = config_.telegramBotToken;
                }
                return ts;
                };

            auto sendTelegramAlertForAlgorithm = [&](const AlgorithmConfig& algo,
                const std::string& alertClipPath,
                const std::string& caption)
            {
                if (!isAlertChannelEnabledForAlgorithmCamera_(algo, "telegram")) {
                    return;
                }
                if (alertClipPath.empty()) {
                    Logger::instance().logDebug(
                        config_.id,
                        "Telegram alert skipped because clip path is empty for algo=" + algo.type
                    );
                    return;
                }

                TelegramSettings ts = buildTelegramSettingsSnapshot();
                if (!ts.enabled) {
                    Logger::instance().logDebug(
                        config_.id,
                        "Telegram alert skipped because Telegram integration is not configured for algo=" + algo.type
                    );
                    return;
                }

                std::string err;
                const bool ok = TelegramNotifier::SendDocument(ts, alertClipPath, caption, &err);
                if (!ok) {
                    Logger::instance().logDebug(
                        config_.id,
                        "Telegram SendDocument failed for algo=" + algo.type + ": " + err
                    );
                }
                else {
                    Logger::instance().logDebug(
                        config_.id,
                        "Telegram alert sent successfully for algo=" + algo.type
                    );
                }
                };


            /*
            for (const auto& ac : algosCopy) {
                if (!activeAlgosList.empty()) activeAlgosList += ",";
                activeAlgosList += ac.type;

                activeAlgos.push_back(ac.type);

                if (!ac.llmPrompt.empty()) {
                    algoLlmPrompts[ac.type] = ac.llmPrompt;
                }
            }
            */

            //std::string question = build_multi_algo_question(activeAlgos, algoLlmPrompts);

            const bool hasFaceTargets = !faceTargets.empty();
            std::string question = build_multi_algo_question(activeAlgos, algoLlmPrompts, hasFaceTargets);
            for (const auto& algoType : activeAlgos) {
                if (!activeAlgosList.empty()) activeAlgosList += ",";
                activeAlgosList += algoType;
            }


            if (question == "empty" && customV2Algos.empty()) {
                Logger::instance().logDebug(
                    config_.id,
                    "inferenceLoop_: no enabled algorithms, deleting clip and skipping inference"
                );

                std::error_code rmEc;
                fs::remove(clipPath, rmEc);
                if (rmEc) {
                    Logger::instance().logDebug(
                        config_.id,
                        "inferenceLoop_: failed to remove clip with no algos: " + rmEc.message()
                    );
                }
                continue;
            }

            try {
                bool hasCustomVideoBaseWindowDemand = false;
                for (const auto& customAlgo : customV2Algos) {
                    if (customVideoAlgorithmNeedsBaseWindow(customAlgo)) {
                        hasCustomVideoBaseWindowDemand = true;
                        break;
                    }
                }

                const bool hasBaseVideoWindow = !clipPath.empty();
                const bool needBaseVideoWindow =
                    hasBaseVideoWindow && (!activeAlgos.empty() || hasCustomVideoBaseWindowDemand);

                bool inferenceInputRecorded = false;
                auto ensureInferenceInputRecorded = [&]() {
                    if (!inferenceInputRecorded) {
                        recordInferenceInput();
                        inferenceInputRecorded = true;
                    }
                };

                std::vector<unsigned char> videoBytes;
                std::string finalClipPath = clipPath;
                std::string sampledPath;

                if (needBaseVideoWindow) {
                    if (analysisSpeed > 1) {
                        if (buildSampledClipWithFfmpeg(clipPath, analysisSpeed, sampledPath, config_.id)) {
                            finalClipPath = sampledPath;
                        }
                        else {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: sampling failed, falling back to original clip"
                            );
                        }
                    }

                    {
                        const auto diskReadStartedAt = std::chrono::steady_clock::now();
                        std::ifstream ifs(finalClipPath, std::ios::binary);
                        if (!ifs) {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: failed to open clip for reading: " + finalClipPath
                            );
                            // Remove original broken clip so we don't get stuck on it
                            std::error_code rmEc;
                            fs::remove(clipPath, rmEc);
                            continue;
                        }
                        videoBytes.assign(
                            std::istreambuf_iterator<char>(ifs),
                            std::istreambuf_iterator<char>()
                        );
                        recordDiskReadSample(
                            videoBytes.size(),
                            std::chrono::steady_clock::now() - diskReadStartedAt
                        );
                    }
                }

                if (needBaseVideoWindow && !activeAlgos.empty() && question != "empty") {
                    ensureInferenceInputRecorded();
                    Logger::instance().logDebug(
                        config_.id,
                        "inferenceLoop_: sending video window to API, size=" +
                        std::to_string(videoBytes.size()) +
                        " bytes | window_seconds=" + std::to_string(adaptiveWindowSeconds) +
                        " | algos=" + activeAlgosList
                    );

                    // 4) Call Gemini VIDEO endpoint (NEW)
                    Logger::instance().logDebug(
                        config_.id,
                        "QUESTION PROMPT =" + question
                    );

                    GeminiVideoResult result = ask_video_question_gemini_from_bytes(
                        "AIzaSyA_c5lgj1--kFYMDL0y4d58hXnT5-J-7M0",
                        videoBytes,
                        question,
                        "video/mp4",
                        faceTargets,
                        analysisSpeed,
                        modelTier
                    );

                    Logger::instance().logDebug(
                        config_.id,
                        "API VIDEO answer for algos=" + activeAlgosList + ": " + result.answer
                    );

                    std::string algoTypeForUsage = activeAlgosList.empty() ? "multi" : activeAlgosList;

                    // Get auth + URL from AgentCore via owner_
                    std::string clientId;
                    std::string exeToken;
                    std::string backendBaseUrl;

                    if (owner_) {
                        clientId = owner_->getClientId();
                        exeToken = owner_->getExeToken();
                        backendBaseUrl = owner_->getBackendBaseUrl();
                    }
                    else {
                        Logger::instance().logDebug(
                            config_.id,
                            "inferenceLoop_: owner_ is null, cannot send token usage"
                        );
                    }

                    if (!clientId.empty() && !exeToken.empty() && !backendBaseUrl.empty()) {
                        sendTokenUsageAsync(
                            config_.id,
                            result.promptTokens,
                            result.outputTokens,
                            result.totalTokens,
                            "agent",
                            algoTypeForUsage,
                            config_.cameraSessionId,
                            0,
                            "",
                            clientId,
                            exeToken,
                            backendBaseUrl
                        );
                    }

                    // 5) Parse JSON & emit events (same pattern as before)
                    try {
                    std::string jsonStr = result.answer;
                    auto firstBrace = jsonStr.find('{');
                    auto lastBrace = jsonStr.rfind('}');
                    if (firstBrace == std::string::npos ||
                        lastBrace == std::string::npos ||
                        lastBrace < firstBrace)
                    {
                        throw std::runtime_error("Could not find JSON braces in VIDEO answer");
                    }
                    jsonStr = jsonStr.substr(firstBrace, lastBrace - firstBrace + 1);

                    json ans = json::parse(jsonStr);


                    std::string matchedFaceTargetName;
                    int matchedFaceTargetId = -1;

                    if (ans.contains("faceid") && ans["faceid"].is_object()) {
                        const auto& f = ans["faceid"];
                        const std::string match = f.value("match", "NO");
                        if (match == "YES") {
                            matchedFaceTargetName = f.value("target_name", "");
                            matchedFaceTargetId = f.value("target_id", -1);
                        }
                    }

                    // Build a timestamp string based on current wall clock
                    auto now = std::chrono::system_clock::now();
                    auto msSinceEpoch =
                        std::chrono::duration_cast<std::chrono::milliseconds>(
                            now.time_since_epoch()
                        ).count();

                    std::time_t tt = static_cast<std::time_t>(msSinceEpoch / 1000);
                    std::tm tm{};
#ifdef _WIN32
                    localtime_s(&tm, &tt);
#else
                    localtime_r(&tt, &tm);
#endif
                    char tsBuf[32];
                    std::strftime(tsBuf, sizeof(tsBuf), "%Y-%m-%dT%H:%M:%S", &tm);
                    std::string timestampIso(tsBuf);


                    std::string videoB64;

                    try {
                        std::ifstream ifs(clipPath, std::ios::binary);
                        if (!ifs) {
                            Logger::instance().logDebug(config_.id, "failed to open clip: " + clipPath);
                        }
                        else {
                            const auto diskReadStartedAt = std::chrono::steady_clock::now();
                            std::string data(
                                (std::istreambuf_iterator<char>(ifs)),
                                std::istreambuf_iterator<char>()
                            );
                            recordDiskReadSample(
                                data.size(),
                                std::chrono::steady_clock::now() - diskReadStartedAt
                            );

                            videoB64 = base64_encode(
                                reinterpret_cast<const unsigned char*>(data.data()),
                                data.size()
                            );
                        }
                    }
                    catch (const std::exception& ex) {
                        Logger::instance().logDebug(
                            config_.id,
                            std::string("inferenceLoop_: failed to read video for alert: ") + ex.what()
                        );
                    }



                    for (const auto& algoType : activeAlgos) {
                        std::string result = "NO";

                        if (algoType == "faceid") {
                            if (ans.contains("faceid") && ans["faceid"].is_object()) {
                                result = ans["faceid"].value("match", "NO");
                            }
                            else if (ans.contains("faceid") && ans["faceid"].is_string()) {
                                // backward compatibility if model returns old schema
                                result = ans["faceid"].get<std::string>();
                            }
                        }
                        else {
                            if (ans.contains(algoType) && ans[algoType].is_string()) {
                                result = ans[algoType].get<std::string>();
                            }
                        }

                        if (result == "YES") {
                            if (owner_) {
                                std::string display =
                                    algoDisplayNames.count(algoType) ? algoDisplayNames[algoType] : algoType;
                                const AlgorithmConfig* matchedAlgoConfig = nullptr;
                                for (const auto& configuredAlgo : algosCopy) {
                                    if (configuredAlgo.type == algoType) {
                                        matchedAlgoConfig = &configuredAlgo;
                                        break;
                                    }
                                }

                                // ? If faceid matched, append the name so the frontend receives it immediately
                                if (algoType == "faceid" && !matchedFaceTargetName.empty()) {
                                    display += " - " + matchedFaceTargetName;  // e.g. "FaceID (Face Search) - edu"
                                }

                                owner_->sendAlgoEvent(
                                    config_.id,
                                    config_.name,
                                    display,
                                    timestampIso,
                                    "video",
                                    videoB64
                                );
                                if (matchedAlgoConfig != nullptr) {
                                    const std::string caption =
                                        "Camera: " + config_.name +
                                        " | Evento: " + display +
                                        " | " + timestampIso;
                                    sendTelegramAlertForAlgorithm(*matchedAlgoConfig, clipPath, caption);
                                }

                            }
                        }

                    }

                    }
                    catch (const std::exception& e) {
                        Logger::instance().logDebug(
                            config_.id,
                            std::string("VIDEO JSON parse / event emit failed: ") + e.what() +
                            " | raw_answer=" + result.answer
                        );
                    }
                }

                if (!customV2Algos.empty()) {
                    auto toLower = [](std::string value) {
                        std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) {
                            return static_cast<char>(std::tolower(c));
                            });
                        return value;
                    };

                    std::string clientId;
                    std::string exeToken;
                    std::string backendBaseUrl;
                    if (owner_) {
                        clientId = owner_->getClientId();
                        exeToken = owner_->getExeToken();
                        backendBaseUrl = owner_->getBackendBaseUrl();
                    }

                    auto nowTimestampIso = []() {
                        auto now = std::chrono::system_clock::now();
                        auto msSinceEpoch =
                            std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
                        std::time_t tt = static_cast<std::time_t>(msSinceEpoch / 1000);
                        std::tm tm{};
#ifdef _WIN32
                        localtime_s(&tm, &tt);
#else
                        localtime_r(&tt, &tm);
#endif
                        char tsBuf[32];
                        std::strftime(tsBuf, sizeof(tsBuf), "%Y-%m-%dT%H:%M:%S", &tm);
                        return std::string(tsBuf);
                        };

                    for (const auto& customAlgo : customV2Algos) {
                        if (!owner_) break;
                        if (toLower(customAlgo.inputType) != "video") {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: skipping custom algorithm non-video input type=" +
                                customAlgo.type + " input_type=" + customAlgo.inputType
                            );
                            continue;
                        }
                        if (customAlgo.modelApiKey.empty()) {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: skipping custom algorithm missing model api key type=" +
                                customAlgo.type
                            );
                            continue;
                        }

                        std::string normalizedInferenceModel = customAlgo.inferenceModel;
                        std::transform(
                            normalizedInferenceModel.begin(),
                            normalizedInferenceModel.end(),
                            normalizedInferenceModel.begin(),
                            [](unsigned char c) { return static_cast<char>(std::tolower(c)); }
                        );
                        const int normalizedRunEverySeconds =
                            normalizeCustomVideoRunEverySeconds(customAlgo);
                        const bool useSixtySecondWindow = normalizedRunEverySeconds > 10;
                        const int expectedVideoWindowSeconds = useSixtySecondWindow
                            ? 60
                            : adaptiveWindowSeconds;

                        std::string segmentSourcePath;
                        std::vector<unsigned char> segmentSourceBytes;
                        if (useSixtySecondWindow) {
                            if (!isCustomAlgorithmDueNow_(customAlgo.type, normalizedRunEverySeconds)) {
                                continue;
                            }

                            const std::string requiredDateToken = localDateTokenYYYYMMDD_();
                            const std::string lastUsedClipKey =
                                getLastCoreWindowUsedKeyForAlgo_(config_.id, customAlgo.type);
                            auto sixtySecondClipOpt = getNextStoredFrameClipForCamera(
                                config_.id,
                                "_60s.mp4",
                                lastUsedClipKey,
                                requiredDateToken
                            );
                            if (!sixtySecondClipOpt.has_value()) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video waiting for a finalized current-day 60s clip before inference algo=" +
                                    customAlgo.type + " required_date=" + requiredDateToken
                                );
                                continue;
                            }
                            if (!isStrictSixtySecondClipForCore_(*sixtySecondClipOpt)) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video rejected non-strict 60s clip algo=" +
                                    customAlgo.type + " clip=" + *sixtySecondClipOpt
                                );
                                continue;
                            }

                            segmentSourcePath = *sixtySecondClipOpt;
                            segmentSourceBytes.clear();
                            const auto diskReadStartedAt = std::chrono::steady_clock::now();
                            std::ifstream coreClipIfs(segmentSourcePath, std::ios::binary);
                            if (!coreClipIfs) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video failed to open 60s clip: " + segmentSourcePath
                                );
                                continue;
                            }
                            segmentSourceBytes.assign(
                                std::istreambuf_iterator<char>(coreClipIfs),
                                std::istreambuf_iterator<char>()
                            );
                            recordDiskReadSample(
                                segmentSourceBytes.size(),
                                std::chrono::steady_clock::now() - diskReadStartedAt
                            );
                            if (segmentSourceBytes.empty()) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video 60s clip is empty: " + segmentSourcePath
                                );
                                continue;
                            }
                        }
                        else {
                            if (finalClipPath.empty() || videoBytes.empty()) {
                                continue;
                            }
                            segmentSourcePath = finalClipPath;
                            segmentSourceBytes = videoBytes;
                        }

                        const auto frameWindow = resolveFrameWindowForAlgoCamera_(customAlgo);
                        const bool hasFrameWindow = isFrameWindowActiveCamera_(frameWindow);
                        std::string croppedSegmentSourcePath;
                        std::vector<unsigned char> preparedSegmentBytes = segmentSourceBytes;
                        std::string preparedSegmentPath = segmentSourcePath;
                        if (hasFrameWindow) {
                            std::string cropErr;
                            if (!buildCroppedClipForFrameWindowCamera_(
                                segmentSourcePath,
                                frameWindow,
                                croppedSegmentSourcePath,
                                &cropErr))
                            {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video failed to build cropped clip algo=" +
                                    customAlgo.type + " clip=" + segmentSourcePath +
                                    " err=" + cropErr
                                );
                                continue;
                            }

                            preparedSegmentPath = croppedSegmentSourcePath;
                            preparedSegmentBytes.clear();
                            const auto diskReadStartedAt = std::chrono::steady_clock::now();
                            std::ifstream croppedClipIfs(preparedSegmentPath, std::ios::binary);
                            if (!croppedClipIfs) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video failed to open cropped clip algo=" +
                                    customAlgo.type + " clip=" + preparedSegmentPath
                                );
                                std::error_code rmEc;
                                fs::remove(croppedSegmentSourcePath, rmEc);
                                continue;
                            }
                            preparedSegmentBytes.assign(
                                std::istreambuf_iterator<char>(croppedClipIfs),
                                std::istreambuf_iterator<char>()
                            );
                            recordDiskReadSample(
                                preparedSegmentBytes.size(),
                                std::chrono::steady_clock::now() - diskReadStartedAt
                            );
                            if (preparedSegmentBytes.empty()) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom video cropped clip is empty algo=" +
                                    customAlgo.type + " clip=" + preparedSegmentPath
                                );
                                std::error_code rmEc;
                                fs::remove(croppedSegmentSourcePath, rmEc);
                                continue;
                            }
                        }

                        auto cleanupPreparedSegment = [&]() {
                            if (croppedSegmentSourcePath.empty()) return;
                            std::error_code rmEc;
                            fs::remove(croppedSegmentSourcePath, rmEc);
                            croppedSegmentSourcePath.clear();
                        };

                        const std::vector<AlgorithmConfig::AnalysisRegion> polygonRegions =
                            remapRegionsToFrameWindowCamera_(
                                collectPolygonRegionsForAlgo_(customAlgo),
                                frameWindow
                            );
                        std::vector<AlgorithmConfig::AnalysisRegion> motionRegions = polygonRegions;
                        if (motionRegions.empty() && hasFrameWindow) {
                            AlgorithmConfig::AnalysisRegion viewportRegion;
                            viewportRegion.enabled = true;
                            viewportRegion.fullFrame = false;
                            viewportRegion.polygonNorm = {
                                { 0.0, 0.0 },
                                { 1.0, 0.0 },
                                { 1.0, 1.0 },
                                { 0.0, 1.0 }
                            };
                            motionRegions.push_back(std::move(viewportRegion));
                        }
                        std::vector<std::string> motionTriggeredRegionIds;
                        bool shouldInfer = true;
                        if (!motionRegions.empty() && customAlgo.onlyCaptureOnMotion) {
                            bool hasRegionMotion = false;
                            std::string motionErr;
                            if (!detectMotionInAnyRegionFromClipCamera_(
                                preparedSegmentPath,
                                motionRegions,
                                hasRegionMotion,
                                &motionTriggeredRegionIds,
                                &motionErr))
                            {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom region motion detection failed algo=" +
                                    customAlgo.type + " err=" + motionErr
                                );
                                shouldInfer = false;
                            }
                            else if (!hasRegionMotion) {
                                shouldInfer = false;
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom region motion not detected, skipping algo=" +
                                    customAlgo.type
                                );
                            }
                        }
                        else if (customAlgo.onlyCaptureOnMotion) {
                            shouldInfer = inferenceEnabled_.load(std::memory_order_relaxed);
                        }
                        if (!shouldInfer) {
                            cleanupPreparedSegment();
                            continue;
                        }

                        if (!shouldRunCustomAlgorithmNow_(customAlgo.type, normalizedRunEverySeconds)) {
                            cleanupPreparedSegment();
                            continue;
                        }

                        if (useSixtySecondWindow) {
                            markCoreWindowUsedForAlgo_(config_.id, customAlgo.type, segmentSourcePath);
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: custom video using 60s VIDEO clip algo=" +
                                customAlgo.type + " clip=" + segmentSourcePath
                            );
                        }

                        ensureInferenceInputRecorded();

                        EncodedVideoSegment primarySegment;
                        primarySegment.bytes = preparedSegmentBytes;
                        try {
                            primarySegment.cameraId = std::stoi(config_.id);
                        }
                        catch (...) {
                            primarySegment.cameraId = -1;
                        }
                        primarySegment.cameraName = config_.name;
                        primarySegment.sourceFilePath = preparedSegmentPath;
                        primarySegment.isTempFile =
                            (!sampledPath.empty() && segmentSourcePath == sampledPath) ||
                            !croppedSegmentSourcePath.empty();
                        if (!parseSegmentUtcRangeFromClipPathForInference_(
                            fs::path(segmentSourcePath),
                            primarySegment.startTs,
                            primarySegment.endTs
                        )) {
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: unable to parse segment timestamps from clip path: " + segmentSourcePath
                            );
                        }

                        std::string overlayClipPath;
                        std::vector<std::string> overlayRegionIds;
                        if (!polygonRegions.empty()) {
                            if (buildOverlayClipForRegionsCamera_(
                                preparedSegmentPath,
                                polygonRegions,
                                overlayClipPath,
                                &overlayRegionIds))
                            {
                                std::ifstream overlayIfs(overlayClipPath, std::ios::binary);
                                if (overlayIfs) {
                                    const auto diskReadStartedAt = std::chrono::steady_clock::now();
                                    primarySegment.bytes.assign(
                                        std::istreambuf_iterator<char>(overlayIfs),
                                        std::istreambuf_iterator<char>()
                                    );
                                    recordDiskReadSample(
                                        primarySegment.bytes.size(),
                                        std::chrono::steady_clock::now() - diskReadStartedAt
                                    );
                                    primarySegment.sourceFilePath = overlayClipPath;
                                    primarySegment.isTempFile = true;
                                }
                                else {
                                    Logger::instance().logDebug(
                                        config_.id,
                                        "inferenceLoop_: failed to open overlay clip, fallback to source clip"
                                    );
                                }
                            }
                        }

                        std::vector<FaceReferenceImage> faceReferences;
                        for (const auto& target : customAlgo.faceTargets) {
                            for (const auto& image : target.images) {
                                if (image.imageUrl.empty()) continue;
                                std::vector<unsigned char> imageBytes;
                                if (!owner_->downloadUrlToBytes_(image.imageUrl, imageBytes)) continue;
                                FaceReferenceImage ref;
                                ref.targetId = target.id;
                                ref.targetName = target.name;
                                ref.targetDescription = target.description;
                                ref.referenceImageUrl = image.imageUrl;
                                ref.imageDataUrl =
                                    std::string("data:image/jpeg;base64,") +
                                    base64_encode(imageBytes.data(), imageBytes.size());
                                faceReferences.push_back(std::move(ref));
                            }
                        }

                        std::vector<NegativeReferenceImage> negativeReferences;
                        for (const auto& image : customAlgo.negativeReferenceImages) {
                            if (image.imageUrl.empty()) continue;
                            std::vector<unsigned char> imageBytes;
                            if (!owner_->downloadUrlToBytes_(image.imageUrl, imageBytes)) continue;
                            NegativeReferenceImage ref;
                            ref.imageId = image.id;
                            ref.imageDataUrl =
                                std::string("data:image/jpeg;base64,") +
                                base64_encode(imageBytes.data(), imageBytes.size());
                            negativeReferences.push_back(std::move(ref));
                        }

                        const std::string nowIsoForInference = temporal::nowIso();
                        const std::string temporalDecisionNowIso =
                            temporal::decisionAnchorUtc(nowIsoForInference, primarySegment.endTs);
                        const std::string basePromptCore =
                            customAlgo.promptTemplate.empty() ? customAlgo.llmPrompt : customAlgo.promptTemplate;
                        const std::string temporalPromptHash =
                            temporal::computePromptRevisionHash(basePromptCore, customAlgo.alertCondition);
                        std::string runtimePrompt = basePromptCore;
                        bool temporalPlanActive = false;
                        bool temporalReport = false;
                        nlohmann::json temporalOperatorResults = nlohmann::json::array();
                        const std::string temporalLanguage = "pt-BR";
                        const std::string temporalSlotKey =
                            customAlgo.type + "#" +
                            std::to_string(customAlgo.algorithmId > 0 ? customAlgo.algorithmId : 0);
                        TemporalRuntimeSlot temporalSlot;
                        temporalSlot.state = temporal::defaultState();
                        auto trimEvidenceValue = [](const std::string& value) -> std::string {
                            const auto first = value.find_first_not_of(" \t\r\n");
                            if (first == std::string::npos) return std::string();
                            const auto last = value.find_last_not_of(" \t\r\n");
                            return value.substr(first, last - first + 1);
                        };
                        auto mergeTemporalEvidenceTrailLocked =
                            [&](TemporalEvidenceTrail& trail,
                                const std::vector<TemporalEvidenceCandidate>& candidates,
                                const std::vector<std::string>& acceptedEvidenceKeys) {
                                if (trail.empty() && candidates.empty()) return;

                                std::set<std::string> acceptedKeys;
                                for (const auto& rawKey : acceptedEvidenceKeys) {
                                    const std::string key = trimEvidenceValue(rawKey);
                                    if (!key.empty()) acceptedKeys.insert(key);
                                }

                                std::set<std::string> existingKeys;
                                for (const auto& item : trail) {
                                    const std::string key = trimEvidenceValue(item.evidenceKey);
                                    if (!key.empty()) existingKeys.insert(key);
                                }

                                constexpr std::size_t kMaxTemporalEvidenceTrailItems = 48;
                                for (const auto& candidate : candidates) {
                                    const std::string evidenceKey = trimEvidenceValue(candidate.evidenceKey);
                                    if (evidenceKey.empty()) continue;
                                    if (!acceptedKeys.empty() && acceptedKeys.find(evidenceKey) == acceptedKeys.end()) {
                                        continue;
                                    }
                                    if (!existingKeys.insert(evidenceKey).second) continue;
                                    if (trimEvidenceValue(candidate.imageJpegBase64).empty()) continue;

                                    TemporalEvidenceItem item;
                                    item.evidenceKey = evidenceKey;
                                    item.eventName = trimEvidenceValue(candidate.eventName);
                                    item.entityId = trimEvidenceValue(candidate.entityId);
                                    item.zone = trimEvidenceValue(candidate.zone);
                                    item.frameIndex = candidate.frameIndex;
                                    item.frameTimestampInSegment =
                                        trimEvidenceValue(candidate.frameTimestampInSegment);
                                    item.timestampName = trimEvidenceValue(candidate.timestampName);
                                    item.timestampUtcIso = trimEvidenceValue(candidate.timestampUtcIso);
                                    item.timestampLocalIso = trimEvidenceValue(candidate.timestampLocalIso);
                                    item.reason = trimEvidenceValue(candidate.reason);
                                    item.imageJpegBase64 = trimEvidenceValue(candidate.imageJpegBase64);
                                    trail.push_back(std::move(item));
                                }

                                while (trail.size() > kMaxTemporalEvidenceTrailItems) {
                                    trail.pop_front();
                                }
                            };
                        auto buildTemporalAlertGroupImages =
                            [&](const TemporalEvidenceTrail& trail,
                                const nlohmann::json& operatorResults,
                                const std::vector<std::string>& fallbackEvidenceKeys) -> nlohmann::json {
                                std::set<std::string> requestedEvidenceKeys;
                                auto enqueueRequestedKey = [&](const std::string& rawKey) {
                                    const std::string key = trimEvidenceValue(rawKey);
                                    if (!key.empty()) requestedEvidenceKeys.insert(key);
                                };

                                if (operatorResults.is_array()) {
                                    for (const auto& result : operatorResults) {
                                        if (!result.is_object()) continue;
                                        if (temporal::lower(temporal::trim(temporal::strField(result, "value"))) != "true") {
                                            continue;
                                        }
                                        const auto itContributing = result.find("contributing_events");
                                        if (itContributing == result.end() || !itContributing->is_array()) continue;
                                        for (const auto& contributing : *itContributing) {
                                            if (!contributing.is_object()) continue;
                                            enqueueRequestedKey(
                                                temporal::strField(contributing, "temporal_evidence_key"));
                                        }
                                    }
                                }

                                if (requestedEvidenceKeys.empty()) {
                                    for (const auto& key : fallbackEvidenceKeys) {
                                        enqueueRequestedKey(key);
                                    }
                                }

                                auto selectImagesForKeys = [&](const std::set<std::string>& selectedKeys) {
                                    nlohmann::json out = nlohmann::json::array();
                                    std::set<std::string> visualKeys;
                                    constexpr std::size_t kMaxAlertImages = 8;
                                    for (const auto& item : trail) {
                                        const std::string evidenceKey = trimEvidenceValue(item.evidenceKey);
                                        if (!selectedKeys.empty() &&
                                            selectedKeys.find(evidenceKey) == selectedKeys.end())
                                        {
                                            continue;
                                        }
                                        if (trimEvidenceValue(item.imageJpegBase64).empty()) continue;

                                        std::string visualKey = item.timestampName;
                                        if (visualKey.empty() && item.frameIndex >= 0) {
                                            visualKey = "frame:" + std::to_string(item.frameIndex);
                                        }
                                        if (visualKey.empty()) {
                                            visualKey = trimEvidenceValue(item.timestampUtcIso);
                                        }
                                        if (visualKey.empty()) {
                                            visualKey = evidenceKey;
                                        }
                                        if (!visualKeys.insert(visualKey).second) continue;

                                        nlohmann::json entry = nlohmann::json::object();
                                        entry["camera_id"] = primarySegment.cameraId;
                                        entry["camera_name"] = primarySegment.cameraName;
                                        entry["image_jpeg_b64"] = item.imageJpegBase64;
                                        entry["temporal_evidence_key"] = evidenceKey;
                                        if (!item.timestampUtcIso.empty()) {
                                            entry["snapshot_ts_utc_iso"] = item.timestampUtcIso;
                                        }
                                        if (!item.timestampLocalIso.empty()) {
                                            entry["snapshot_ts_local_iso"] = item.timestampLocalIso;
                                        }
                                        if (!item.timestampName.empty()) {
                                            entry["timestamp_name"] = item.timestampName;
                                        }
                                        if (item.frameIndex >= 0) {
                                            entry["frame_index"] = item.frameIndex;
                                        }
                                        if (!item.frameTimestampInSegment.empty()) {
                                            entry["frame_timestamp_in_segment"] = item.frameTimestampInSegment;
                                        }
                                        if (!item.eventName.empty()) {
                                            entry["event"] = item.eventName;
                                        }
                                        if (!item.entityId.empty()) {
                                            entry["entity_id"] = item.entityId;
                                        }
                                        if (!item.zone.empty()) {
                                            entry["zone"] = item.zone;
                                        }
                                        if (!item.reason.empty()) {
                                            entry["reason"] = item.reason;
                                        }
                                        out.push_back(std::move(entry));
                                    }

                                    if (out.size() > kMaxAlertImages) {
                                        const auto keepFrom = out.size() - kMaxAlertImages;
                                        out.erase(out.begin(), out.begin() + static_cast<std::ptrdiff_t>(keepFrom));
                                    }
                                    return out;
                                };

                                nlohmann::json selectedImages = selectImagesForKeys(requestedEvidenceKeys);
                                if (selectedImages.empty() && !trail.empty()) {
                                    std::set<std::string> fallbackKeys;
                                    fallbackKeys.insert(trimEvidenceValue(trail.back().evidenceKey));
                                    selectedImages = selectImagesForKeys(fallbackKeys);
                                }
                                return selectedImages;
                            };
                        const bool payloadPlanMatchesCurrentPrompt =
                            temporal::decisionCacheable(customAlgo.temporalPlanEnvelope) &&
                            temporal::planMatchesPromptRevision(
                                customAlgo.temporalPlanEnvelope,
                                basePromptCore,
                                customAlgo.alertCondition
                            );
                        {
                            std::lock_guard<std::mutex> lock(temporalMutex_);
                            auto itTemporal = temporalByAlgo_.find(temporalSlotKey);
                            if (itTemporal != temporalByAlgo_.end()) {
                                temporalSlot = itTemporal->second;
                            }
                        }
                        const bool slotPlanMatchesCurrentPrompt =
                            temporal::decisionCacheable(temporalSlot.planEnvelope) &&
                            ((!temporalSlot.promptHash.empty() && temporalSlot.promptHash == temporalPromptHash) ||
                             temporal::planMatchesPromptRevision(
                                 temporalSlot.planEnvelope,
                                 basePromptCore,
                                 customAlgo.alertCondition
                             ));
                        const bool resetTemporalEvidenceTrail = !slotPlanMatchesCurrentPrompt;
                        if (!slotPlanMatchesCurrentPrompt) {
                            temporalSlot.planEnvelope = payloadPlanMatchesCurrentPrompt
                                ? customAlgo.temporalPlanEnvelope
                                : nlohmann::json::object();
                            temporalSlot.state = temporal::defaultState();
                            temporalSlot.visualState = nlohmann::json::object();
                            {
                                std::lock_guard<std::mutex> lock(temporalMutex_);
                                this->temporalEvidenceByAlgo_[temporalSlotKey].clear();
                            }
                        }
                        if (!temporalSlot.state.is_object() || temporalSlot.state.empty()) {
                            temporalSlot.state = temporal::defaultState();
                        }
                        if (!temporalSlot.visualState.is_object()) {
                            temporalSlot.visualState = nlohmann::json::object();
                        }
                        temporalSlot.promptHash = temporalPromptHash;

                        if (owner_) {
                            const bool temporalPlanReady = owner_->ensureTemporalPlanForRuntime(
                                "camera_algorithm",
                                customAlgo.algorithmId > 0 ? customAlgo.algorithmId : primarySegment.cameraId,
                                basePromptCore,
                                customAlgo.alertCondition,
                                customAlgo.negativeCondition,
                                customAlgo.inputType.empty() ? std::string("video") : customAlgo.inputType,
                                temporalLanguage,
                                customAlgo.inferenceModel,
                                customAlgo.modelApiKey,
                                temporalSlot.planEnvelope,
                                customAlgo.algorithmId > 0,
                                config_.id
                            );
                            if (temporal::decisionCacheable(temporalSlot.planEnvelope)) {
                                temporalSlot.promptHash = temporalPromptHash;
                                std::lock_guard<std::mutex> lock(temporalMutex_);
                                temporalByAlgo_[temporalSlotKey] = temporalSlot;
                            }
                            if (temporalPlanReady && temporal::planUsable(temporalSlot.planEnvelope)) {
                                temporalSlot.promptHash = temporalPromptHash;
                                const nlohmann::json temporalInput = temporal::buildInferenceInput(
                                    temporalSlot.planEnvelope,
                                    temporalSlot.state,
                                    primarySegment.cameraId,
                                    temporalDecisionNowIso,
                                    primarySegment.startTs,
                                    primarySegment.endTs
                                );
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: temporal input injected (video) algo=" + customAlgo.type +
                                    " camera_id=" + std::to_string(primarySegment.cameraId) +
                                    " segment_start=" + primarySegment.startTs +
                                    " segment_end=" + primarySegment.endTs +
                                    " now_utc=" +
                                    temporalInput.value("time_context", nlohmann::json::object()).value("now_utc", "") +
                                    " payload=" + temporalInput.dump()
                                );
                                runtimePrompt += temporal::runtimePromptAppendix(temporalInput);
                                temporalPlanActive = true;
                            }
                        }

                        int primaryPromptTokens = 0;
                        int primaryOutputTokens = 0;
                        int primaryTotalTokens = 0;
                        VideoHit primaryHit = owner_->runCameraCustomVideoInference(
                            primarySegment,
                            runtimePrompt,
                            faceReferences,
                            negativeReferences,
                            customAlgo.alertCondition,
                            customAlgo.modelName,
                            customAlgo.modelApiKey,
                            customAlgo.modelFps,
                            customAlgo.runningResolution,
                            customAlgo.videoPackagingMode,
                            expectedVideoWindowSeconds,
                            primaryPromptTokens,
                            primaryOutputTokens,
                            primaryTotalTokens
                        );
                        const int cameraAlgorithmId = customAlgo.algorithmId > 0 ? customAlgo.algorithmId : 0;
                        const std::string cameraAgentRunId = buildCameraAgentRunId_(config_, customAlgo);
                        const std::string eventDisplayName =
                            customAlgo.displayName.empty() ? customAlgo.type : customAlgo.displayName;

                        if (!clientId.empty() && !exeToken.empty() && !backendBaseUrl.empty()) {
                            sendTokenUsageAsync(
                                config_.id,
                                primaryPromptTokens,
                                primaryOutputTokens,
                                primaryTotalTokens,
                                "agent",
                                customAlgo.type,
                                config_.cameraSessionId,
                                cameraAlgorithmId,
                                cameraAgentRunId,
                                clientId,
                                exeToken,
                                backendBaseUrl
                            );
                        }

                        bool finalAlert = primaryHit.alertCondition;
                        const bool llmAlertCondition = primaryHit.alertCondition;
                        std::string decisionSource = "llm";
                        std::string temporalDecisionSummary;

                        const bool localAlertSignal = finalAlert;
                        const std::string localDecisionSource = decisionSource;
                        std::vector<std::string> roundEvidenceKeys;
                        TemporalEvidenceTrail temporalEvidenceTrailSnapshot;
                        if (temporalPlanActive) {
                            temporal::applyRound(
                                temporalSlot.state,
                                temporalSlot.planEnvelope,
                                primaryHit.identityPatch,
                                primaryHit.observations,
                                primaryHit.temporalEvidenceCandidates,
                                temporalDecisionNowIso,
                                primaryHit.answer,
                                primaryHit.unknownReasons,
                                primarySegment.startTs,
                                primarySegment.endTs,
                                primaryHit.faceIdentityMatches
                            );
                            const nlohmann::json candidateDecisions =
                                temporal::extractLastRoundCandidateDecisions(temporalSlot.state);
                            if (candidateDecisions.is_array() && !candidateDecisions.empty()) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: temporal candidate decisions (video) algo=" + customAlgo.type +
                                    " camera_id=" + std::to_string(primarySegment.cameraId) +
                                    " decisions=" + candidateDecisions.dump()
                                );
                            }
                            Logger::instance().logDebug(
                                config_.id,
                                "inferenceLoop_: temporal state after applyRound (video) algo=" + customAlgo.type +
                                " camera_id=" + std::to_string(primarySegment.cameraId) + " " +
                                buildTemporalStateSummaryForLog(
                                    temporalSlot.state,
                                    temporalSlot.planEnvelope)
                            );
                            const temporal::EvalResult eval = temporal::evaluate(
                                temporalSlot.state,
                                temporalSlot.planEnvelope,
                                temporalDecisionNowIso
                            );
                            const bool fallbackToLocalAlert =
                                temporal::shouldFallbackToLocalAlert(eval, localAlertSignal);
                            temporalOperatorResults = eval.operatorResults;
                            temporalReport = eval.report;
                            finalAlert = eval.alert;
                            primaryHit.alertCondition = eval.alert;
                            decisionSource = "temporal_engine";
                            temporalDecisionSummary = eval.summary;
                            roundEvidenceKeys = temporal::extractLastRoundEvidenceKeys(temporalSlot.state);
                            if (finalAlert &&
                                temporal::shouldSuppressStalePresenceCarryAlert(
                                    temporalOperatorResults,
                                    localAlertSignal,
                                    primaryHit.answer,
                                    primaryHit.unknownReasons,
                                    primaryHit.identityPatch,
                                    primaryHit.observations))
                            {
                                finalAlert = false;
                                primaryHit.alertCondition = false;
                                decisionSource = localDecisionSource;
                                temporalDecisionSummary = "Suppressed stale presence carry because the current batch has no visible target evidence.";
                            }
                            else if (finalAlert &&
                                temporal::shouldSuppressThreatCarryAlert(
                                    temporalSlot.planEnvelope,
                                    localAlertSignal,
                                    primaryHit.answer,
                                    primaryHit.unknownReasons,
                                    primaryHit.identityPatch,
                                    primaryHit.observations))
                            {
                                finalAlert = false;
                                primaryHit.alertCondition = false;
                                decisionSource = localDecisionSource;
                                temporalDecisionSummary = "Suppressed stale threat carry because the current batch has no visible threat evidence.";
                            }
                            temporalSlot.touchedAt = std::chrono::steady_clock::now();
                            temporalSlot.promptHash = temporalPromptHash;
                            {
                                std::lock_guard<std::mutex> lock(temporalMutex_);
                                temporalByAlgo_[temporalSlotKey] = temporalSlot;
                                TemporalEvidenceTrail& trail =
                                    this->temporalEvidenceByAlgo_[temporalSlotKey];
                                if (resetTemporalEvidenceTrail) {
                                    trail.clear();
                                }
                                mergeTemporalEvidenceTrailLocked(
                                    trail,
                                    primaryHit.temporalEvidenceCandidates,
                                    roundEvidenceKeys
                                );
                                temporalEvidenceTrailSnapshot = trail;
                            }
                            if (fallbackToLocalAlert && !finalAlert) {
                                finalAlert = true;
                                primaryHit.alertCondition = true;
                                decisionSource = localDecisionSource;
                                const std::string fallbackSummary =
                                    temporal::describeLocalAlertFallback(eval);
                                if (temporalDecisionSummary.empty()) {
                                    temporalDecisionSummary = fallbackSummary;
                                } else {
                                    temporalDecisionSummary += "; " + fallbackSummary;
                                }
                            }
                        }

                        const bool identityCardsMaterialized =
                            owner_ &&
                            owner_->materializeOperationalIdentityCards(
                                primaryHit,
                                temporalSlot.state,
                                temporalSlot.visualState,
                                config_.id,
                                "CameraSession::inferenceLoop_(video)"
                            );
                        if (identityCardsMaterialized) {
                            temporalSlot.touchedAt = std::chrono::steady_clock::now();
                            temporalSlot.promptHash = temporalPromptHash;
                            std::lock_guard<std::mutex> lock(temporalMutex_);
                            temporalByAlgo_[temporalSlotKey] = temporalSlot;
                        }

                        const std::string cameraAgentEventAtUtc =
                            !primaryHit.eventTimestampUtcIso.empty()
                                ? primaryHit.eventTimestampUtcIso
                                : temporalDecisionNowIso;
                        const std::string cameraAgentResultEventId =
                            buildCameraAgentResultEventId_(
                                cameraAgentRunId,
                                cameraAgentEventAtUtc,
                                primaryHit.eventFrameIndex
                            );
                        std::string segmentStartUtc;
                        std::string segmentEndUtc;
                        convertCompactLocalTimestampToUtcIsoForInference_(
                            primarySegment.startTs,
                            segmentStartUtc
                        );
                        convertCompactLocalTimestampToUtcIsoForInference_(
                            primarySegment.endTs,
                            segmentEndUtc
                        );

                        if (owner_) {
                            nlohmann::json cameraAgentResultDetails = nlohmann::json::object();
                            cameraAgentResultDetails["camera_id"] = primarySegment.cameraId;
                            cameraAgentResultDetails["camera_name"] = primarySegment.cameraName;
                            cameraAgentResultDetails["source_type"] = "camera_algorithm";
                            cameraAgentResultDetails["event_id"] = cameraAgentResultEventId;
                            cameraAgentResultDetails["agent_run_id"] = cameraAgentRunId;
                            cameraAgentResultDetails["agent_label"] = eventDisplayName;
                            cameraAgentResultDetails["algorithm_type"] = customAlgo.type;
                            cameraAgentResultDetails["algo_type"] = customAlgo.type;
                            cameraAgentResultDetails["input_type"] =
                                customAlgo.inputType.empty() ? std::string("video") : customAlgo.inputType;
                            cameraAgentResultDetails["video_packaging_mode"] =
                                customAlgo.videoPackagingMode;
                            cameraAgentResultDetails["inference_model"] = customAlgo.inferenceModel;
                            cameraAgentResultDetails["model"] = customAlgo.modelName;
                            cameraAgentResultDetails["answer"] = primaryHit.answer;
                            cameraAgentResultDetails["decision_source"] = decisionSource;
                            cameraAgentResultDetails["llm_alert_condition"] = llmAlertCondition;
                            cameraAgentResultDetails["final_alert_condition"] = finalAlert;
                            if (!primaryHit.primaryIdentityCardId.empty()) {
                                cameraAgentResultDetails["primary_identity_card_id"] =
                                    primaryHit.primaryIdentityCardId;
                            }
                            if (primaryHit.identityCards.is_array() && !primaryHit.identityCards.empty()) {
                                cameraAgentResultDetails["identity_cards"] = primaryHit.identityCards;
                            }
                            cameraAgentResultDetails["prompt_tokens"] = primaryPromptTokens;
                            cameraAgentResultDetails["output_tokens"] = primaryOutputTokens;
                            cameraAgentResultDetails["total_tokens"] = primaryTotalTokens;
                            cameraAgentResultDetails["event_timestamp_utc"] = cameraAgentEventAtUtc;
                            if (!segmentStartUtc.empty()) {
                                cameraAgentResultDetails["segment_start_utc"] = segmentStartUtc;
                            }
                            if (!segmentEndUtc.empty()) {
                                cameraAgentResultDetails["segment_end_utc"] = segmentEndUtc;
                            }
                            if (primaryHit.eventFrameIndex >= 0) {
                                cameraAgentResultDetails["frame_index"] = primaryHit.eventFrameIndex;
                            }
                            if (!primaryHit.eventFrameTimestampInSegment.empty()) {
                                cameraAgentResultDetails["frame_timestamp_in_segment"] =
                                    primaryHit.eventFrameTimestampInSegment;
                            }
                            if (!primaryHit.eventTimestampName.empty()) {
                                cameraAgentResultDetails["timestamp_name"] =
                                    primaryHit.eventTimestampName;
                            }
                            if (!config_.cameraSessionId.empty()) {
                                cameraAgentResultDetails["camera_session_id"] =
                                    config_.cameraSessionId;
                            }
                            if (cameraAlgorithmId > 0) {
                                cameraAgentResultDetails["camera_algorithm_id"] =
                                    cameraAlgorithmId;
                                cameraAgentResultDetails["algorithm_id"] = cameraAlgorithmId;
                            }
                            if (temporalPlanActive) {
                                cameraAgentResultDetails["operator_results"] =
                                    temporalOperatorResults;
                                if (!temporalDecisionSummary.empty()) {
                                    cameraAgentResultDetails["temporal_decision_summary"] =
                                        temporalDecisionSummary;
                                }
                            }
                            owner_->postAgentEvent(
                                "camera_agent_result",
                                primarySegment.cameraId > 0
                                    ? std::optional<int>(primarySegment.cameraId)
                                    : std::nullopt,
                                "",
                                "Camera AI agent evaluated the current video input.",
                                cameraAgentResultDetails
                            );
                        }

                        if (temporalPlanActive && temporalReport && owner_) {
                            const nlohmann::json reportIdentityCards =
                                owner_->collectOperationalIdentityCards(
                                    temporalSlot.state,
                                    temporalSlot.visualState
                                );
                            std::string reportPrimaryIdentityCardId = primaryHit.primaryIdentityCardId;
                            if (reportPrimaryIdentityCardId.empty() &&
                                reportIdentityCards.is_array() &&
                                !reportIdentityCards.empty() &&
                                reportIdentityCards[0].is_object() &&
                                reportIdentityCards[0].contains("card_id") &&
                                reportIdentityCards[0]["card_id"].is_string())
                            {
                                reportPrimaryIdentityCardId =
                                    reportIdentityCards[0]["card_id"].get<std::string>();
                            }
                            nlohmann::json reportDetails = nlohmann::json::object();
                            reportDetails["camera_id"] = primarySegment.cameraId;
                            reportDetails["camera_name"] = primarySegment.cameraName;
                            reportDetails["source_type"] = "camera_algorithm";
                            reportDetails["event_id"] = cameraAgentResultEventId + ":temporal";
                            reportDetails["agent_run_id"] = cameraAgentRunId;
                            reportDetails["agent_label"] = eventDisplayName;
                            reportDetails["algorithm_type"] = customAlgo.type;
                            reportDetails["algo_type"] = customAlgo.type;
                            reportDetails["input_type"] =
                                customAlgo.inputType.empty() ? std::string("video") : customAlgo.inputType;
                            reportDetails["video_packaging_mode"] = customAlgo.videoPackagingMode;
                            reportDetails["inference_model"] = customAlgo.inferenceModel;
                            reportDetails["model"] = customAlgo.modelName;
                            reportDetails["operator_results"] = temporalOperatorResults;
                            reportDetails["answer"] = primaryHit.answer;
                            reportDetails["decision_source"] = decisionSource;
                            reportDetails["llm_alert_condition"] = llmAlertCondition;
                            reportDetails["final_alert_condition"] = finalAlert;
                            if (!reportPrimaryIdentityCardId.empty()) {
                                reportDetails["primary_identity_card_id"] =
                                    reportPrimaryIdentityCardId;
                            }
                            if (reportIdentityCards.is_array() && !reportIdentityCards.empty()) {
                                reportDetails["identity_cards"] = reportIdentityCards;
                            }
                            else if (primaryHit.identityCards.is_array() && !primaryHit.identityCards.empty()) {
                                reportDetails["identity_cards"] = primaryHit.identityCards;
                            }
                            reportDetails["prompt_tokens"] = primaryPromptTokens;
                            reportDetails["output_tokens"] = primaryOutputTokens;
                            reportDetails["total_tokens"] = primaryTotalTokens;
                            reportDetails["event_timestamp_utc"] = cameraAgentEventAtUtc;
                            if (!segmentStartUtc.empty()) {
                                reportDetails["segment_start_utc"] = segmentStartUtc;
                            }
                            if (!segmentEndUtc.empty()) {
                                reportDetails["segment_end_utc"] = segmentEndUtc;
                            }
                            if (!config_.cameraSessionId.empty()) {
                                reportDetails["camera_session_id"] = config_.cameraSessionId;
                            }
                            if (cameraAlgorithmId > 0) {
                                reportDetails["camera_algorithm_id"] = cameraAlgorithmId;
                                reportDetails["algorithm_id"] = cameraAlgorithmId;
                            }
                            if (!temporalDecisionSummary.empty()) {
                                reportDetails["temporal_decision_summary"] = temporalDecisionSummary;
                            }
                            owner_->postAgentEvent(
                                "temporal_report",
                                std::optional<int>(primarySegment.cameraId),
                                "",
                                "",
                                reportDetails
                            );
                        }

                        if (finalAlert) {
                            const std::string timestampIso =
                                primaryHit.eventTimestampLocalIso.empty()
                                    ? nowTimestampIso()
                                    : primaryHit.eventTimestampLocalIso;

                            std::vector<std::string> alertRegionIds = primaryHit.alertRegionIds;
                            if (alertRegionIds.empty() && !motionTriggeredRegionIds.empty()) {
                                alertRegionIds = motionTriggeredRegionIds;
                            }

                            std::set<std::string> alertRegionNamesSet;
                            for (const auto& regionId : alertRegionIds) {
                                for (const auto& region : customAlgo.analysisRegions) {
                                    if (region.regionId == regionId) {
                                        const std::string nm = region.label.empty() ? region.regionId : region.label;
                                        if (!nm.empty()) alertRegionNamesSet.insert(nm);
                                    }
                                }
                            }

                            nlohmann::json extra = nlohmann::json::object();
                            extra["algorithm_type"] = customAlgo.type;
                            extra["video_packaging_mode"] = customAlgo.videoPackagingMode;
                            extra["alert_region_ids"] = alertRegionIds;
                            extra["alert_region_names"] = std::vector<std::string>(
                                alertRegionNamesSet.begin(),
                                alertRegionNamesSet.end()
                            );
                            extra["validator_model"] = "";
                            extra["source_type"] = "camera_algorithm";
                            extra["event_id"] = cameraAgentResultEventId + ":alert";
                            extra["decision_source"] = decisionSource;
                            extra["llm_alert_condition"] = llmAlertCondition;
                            extra["final_alert_condition"] = finalAlert;
                            extra["agent_run_id"] = cameraAgentRunId;
                            extra["agent_label"] = eventDisplayName;
                            extra["answer"] = primaryHit.answer;
                            if (!primaryHit.primaryIdentityCardId.empty()) {
                                extra["primary_identity_card_id"] = primaryHit.primaryIdentityCardId;
                            }
                            if (primaryHit.identityCards.is_array() && !primaryHit.identityCards.empty()) {
                                extra["identity_cards"] = primaryHit.identityCards;
                            }
                            if (!config_.cameraSessionId.empty()) {
                                extra["camera_session_id"] = config_.cameraSessionId;
                            }
                            if (cameraAlgorithmId > 0) {
                                extra["camera_algorithm_id"] = cameraAlgorithmId;
                                extra["algorithm_id"] = cameraAlgorithmId;
                            }
                            if (primaryHit.eventFrameIndex >= 0) {
                                extra["frame_index"] = primaryHit.eventFrameIndex;
                            }
                            if (!primaryHit.eventFrameTimestampInSegment.empty()) {
                                extra["frame_timestamp_in_segment"] =
                                    primaryHit.eventFrameTimestampInSegment;
                            }
                            if (!primaryHit.eventTimestampName.empty()) {
                                extra["timestamp_name"] = primaryHit.eventTimestampName;
                            }
                            if (!primaryHit.eventTimestampUtcIso.empty()) {
                                extra["event_timestamp_utc"] = primaryHit.eventTimestampUtcIso;
                            }
                            if (!segmentStartUtc.empty()) {
                                extra["segment_start_utc"] = segmentStartUtc;
                            }
                            if (!segmentEndUtc.empty()) {
                                extra["segment_end_utc"] = segmentEndUtc;
                            }
                            extra["event_timestamp_source"] =
                                primaryHit.eventTimestampLocalIso.empty()
                                    ? "alert_emit_time"
                                    : "llm_frame_reference";
                            if (temporalPlanActive) {
                                extra["temporal_operator_results"] = temporalOperatorResults;
                                if (!temporalDecisionSummary.empty()) {
                                    extra["temporal_decision_summary"] = temporalDecisionSummary;
                                }
                                const nlohmann::json temporalGroupImages =
                                    buildTemporalAlertGroupImages(
                                        temporalEvidenceTrailSnapshot,
                                        temporalOperatorResults,
                                        roundEvidenceKeys);
                                if (temporalGroupImages.is_array() && !temporalGroupImages.empty()) {
                                    extra["group_images"] = temporalGroupImages;
                                    extra["group_image_count"] = temporalGroupImages.size();
                                }
                            }

                            if (primarySegment.bytes.empty()) {
                                Logger::instance().logDebug(
                                    config_.id,
                                    "inferenceLoop_: custom alert skipped event because segment bytes are empty"
                                );
                            }
                            else {
                                std::string videoB64 = base64_encode(
                                    primarySegment.bytes.data(),
                                    primarySegment.bytes.size()
                                );

                                owner_->sendAlgoEvent(
                                    config_.id,
                                    config_.name,
                                    eventDisplayName,
                                    timestampIso,
                                    "video",
                                    videoB64,
                                    extra
                                );

                                const std::string caption =
                                    "Camera: " + config_.name +
                                    " | Evento: " + eventDisplayName +
                                    " | " + timestampIso;
                                sendTelegramAlertForAlgorithm(
                                    customAlgo,
                                    primarySegment.sourceFilePath,
                                    caption
                                );
                            }
                        }

                        if (!overlayClipPath.empty()) {
                            std::error_code overlayRmEc;
                            fs::remove(overlayClipPath, overlayRmEc);
                        }
                        cleanupPreparedSegment();
                    }
                }

                // 6) Done with this clip: delete it from temp
                if (!clipPath.empty()) {
                    std::error_code rmEc;
                    fs::remove(clipPath, rmEc);
                    if (rmEc) {
                        Logger::instance().logDebug(
                            config_.id,
                            "inferenceLoop_: failed to remove processed clip: " +
                            rmEc.message()
                        );
                    }
                }

                // If we created a sampled clip, clean it up too
                if (!sampledPath.empty()) {
                    std::error_code rmEc2;
                    fs::remove(sampledPath, rmEc2);
                    if (rmEc2) {
                        Logger::instance().logDebug(
                            config_.id,
                            "inferenceLoop_: failed to remove sampled clip: " +
                            rmEc2.message()
                        );
                    }
                }

                if (inferenceInputRecorded) {
                    recordInferenceOutcome(true);
                }

            }
            catch (const std::exception& ex) {
                recordInferenceOutcome(false);
                Logger::instance().logDebug(
                    config_.id,
                    std::string("VIDEO API call failed: ") + ex.what()
                );

                // Best effort: remove this clip so we don't loop on a bad file forever
                std::error_code rmEc;
                fs::remove(clipPath, rmEc);
            }
        }
    }
    catch (const std::exception& e) {
        telemetryInferenceErrorCount_.fetch_add(1, std::memory_order_relaxed);
        Logger::instance().logDebug(
            config_.id,
            std::string("inferenceLoop_ crashed with std::exception: ") + e.what()
        );
    }
    catch (...) {
        telemetryInferenceErrorCount_.fetch_add(1, std::memory_order_relaxed);
        Logger::instance().logDebug(
            config_.id,
            "inferenceLoop_ crashed with unknown exception."
        );
    }

    Logger::instance().logDebug(config_.id, "inferenceLoop_: exiting");
}





void CameraSession::enqueueThumbnail_(std::string b64) {
    if (thumbnailStop_.load()) return;

    // Keep only the most recent thumbnail (overwrite previous)
    {
        std::lock_guard<std::mutex> lock(thumbnailMutex_);
        pendingThumbnailB64_ = std::move(b64);
        thumbnailPending_ = true;
    }
    thumbnailCv_.notify_one();
}

void CameraSession::thumbnailLoop_() {
    Logger::instance().logDebug(config_.id, "thumbnailLoop_: started");

    while (!thumbnailStop_.load()) {
        std::string b64;

        {
            std::unique_lock<std::mutex> lock(thumbnailMutex_);
            thumbnailCv_.wait(lock, [this]() {
                return thumbnailStop_.load() || thumbnailPending_;
                });

            if (thumbnailStop_.load()) break;

            // Take latest thumbnail and clear pending flag
            b64 = std::move(pendingThumbnailB64_);
            pendingThumbnailB64_.clear();
            thumbnailPending_ = false;
        }

        // Call owner outside the lock (never block enqueue/capture)
        try {
            AgentCore* owner = owner_;
            if (owner && !b64.empty()) {
                owner->sendThumbnail(config_.id, b64);
            }
        }
        catch (...) {
            Logger::instance().logDebug(
                config_.id,
                "thumbnailLoop_: sendThumbnail unknown exception"
            );
        }
    }

    Logger::instance().logDebug(config_.id, "thumbnailLoop_: exiting");
}





void CameraSession::sendThumbnail_(const cv::Mat& frame) {
    try {
        if (!owner_) {
            return;
        }

        // 1) Redimensionar para um tamanho bom de dashboard
        // 16:9 pequeno (480x270) funciona bem
        const int thumbW = 480;
        const int thumbH = 270;

        cv::Mat resized;
        const cv::Mat* src = &frame;

        if (frame.cols > thumbW || frame.rows > thumbH) {
            cv::resize(
                frame,
                resized,
                cv::Size(thumbW, thumbH),
                0, 0,
                cv::INTER_AREA
            );
            src = &resized;
        }

        // 2) JPEG em memória
        std::vector<uchar> jpgBuf;
        if (!cv::imencode(".jpg", *src, jpgBuf)) {
            Logger::instance().logDebug(
                config_.id,
                "sendThumbnail_: failed to imencode frame to JPEG"
            );
            return;
        }

        // 3) Base64
        std::string imgB64 = base64_encode(
            reinterpret_cast<const unsigned char*>(jpgBuf.data()),
            jpgBuf.size()
        );

        // 4) Delega para o AgentCore mandar para o Mocha
        //owner_->sendThumbnail(config_.id, imgB64);
        enqueueThumbnail_(std::move(imgB64));
    }
    catch (const std::exception& e) {
        Logger::instance().logDebug(
            config_.id,
            std::string("sendThumbnail_ std::exception: ") + e.what()
        );
    }
    catch (...) {
        Logger::instance().logDebug(
            config_.id,
            "sendThumbnail_ unknown exception"
        );
    }
}

#include "LinuxCameraSessionManager.h"

#include "LinuxFrameDiskWriter.h"
#include "LinuxRtspCandidateBuilder.h"

#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_process.h"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <system_error>
#include <thread>
#include <vector>

#ifndef _WIN32
#include <unistd.h>
#endif

namespace {

using Clock = std::chrono::steady_clock;

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

std::string Lower(std::string value)
{
    value = Trim(std::move(value));
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string ReadEnv(const char* name)
{
    return Trim(perceptrum::platform::ReadEnvVar(name));
}

bool IsTrueEnv(const char* name)
{
    const std::string value = Lower(ReadEnv(name));
    return value == "1" || value == "true" || value == "yes" || value == "on";
}

std::string ResolveWebcamFrameRate()
{
    const std::string raw = ReadEnv("APP_AGENT_WEBCAM_FRAMERATE");
    if (!raw.empty()) {
        try {
            const int parsed = std::stoi(raw);
            if (parsed > 0 && parsed <= 60) {
                return std::to_string(parsed);
            }
        } catch (...) {
        }
    }
    return "15";
}

int ReadStartFrameTimeoutMs()
{
    std::string raw = ReadEnv("APP_AGENT_RTSP_START_FRAME_TIMEOUT_MS");
    if (raw.empty()) {
        raw = ReadEnv("APP_AGENT_WEBCAM_START_FRAME_TIMEOUT_MS");
    }
    if (!raw.empty()) {
        try {
            return std::clamp(std::stoi(raw), 500, 15000);
        } catch (...) {
        }
    }
    return 5000;
}

int ClampCaptureSeconds(int profileSeconds)
{
    const std::string raw = ReadEnv("APP_AGENT_RECORDING_CAPTURE_SECONDS");
    if (!raw.empty()) {
        try {
            const int parsed = std::stoi(raw);
            if (parsed > 0) {
                return std::clamp(parsed, 1, profileSeconds);
            }
        } catch (...) {
        }
    }
    return profileSeconds;
}

std::string FormatLocalTime(std::chrono::system_clock::time_point value, const char* format)
{
    const std::time_t time = std::chrono::system_clock::to_time_t(value);
    std::tm local{};
#ifdef _WIN32
    localtime_s(&local, &time);
#else
    localtime_r(&time, &local);
#endif
    std::ostringstream out;
    out << std::put_time(&local, format);
    return out.str();
}

std::filesystem::path CameraClipDirectory(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::string& cameraId)
{
    const auto now = std::chrono::system_clock::now();
    return perceptrum::linux_runtime::LinuxCameraRecordingsRoot(paths) /
        ("cam_" + cameraId) /
        FormatLocalTime(now, "%Y") /
        FormatLocalTime(now, "%m") /
        FormatLocalTime(now, "%d");
}

bool FfmpegAvailable()
{
    const std::filesystem::path resolved =
        perceptrum::platform::SearchExecutableInPath("ffmpeg");
    return !resolved.empty() && resolved != std::filesystem::path("ffmpeg");
}

bool IsAllowedSyntheticSource(std::string_view value)
{
    if (!IsTrueEnv("APP_AGENT_RTSP_ALLOW_TEST_SOURCE")) {
        return false;
    }
    return value.rfind("lavfi:", 0) == 0 || value.rfind("file:", 0) == 0;
}

bool IsWebcamDeviceSource(std::string_view value)
{
    return value.rfind("v4l2:", 0) == 0 || value.rfind("/dev/video", 0) == 0;
}

bool IsRtspSource(std::string_view value)
{
    return value.rfind("rtsp://", 0) == 0 || value.rfind("rtsps://", 0) == 0;
}

std::string FrameErrorPrefixForSource(const std::string& source)
{
    return IsRtspSource(source) ? "rtsp_frame" : "webcam_frame";
}

std::string DevicePathFromSource(const std::string& source)
{
    return source.rfind("v4l2:", 0) == 0 ? source.substr(5) : source;
}

bool ValidateSourceForStart(const std::string& source, std::string& error)
{
    error.clear();
    if (!FfmpegAvailable()) {
        error = "ffmpeg_not_found";
        return false;
    }
    if (source.empty()) {
        error = "camera_source_empty";
        return false;
    }
    if (IsAllowedSyntheticSource(source)) {
        return true;
    }
    if (IsRtspSource(source)) {
        return true;
    }
    if (!IsWebcamDeviceSource(source)) {
        error = "camera_source_unsupported";
        return false;
    }

    const std::string devicePath = DevicePathFromSource(source);
    std::error_code ec;
    if (!std::filesystem::exists(devicePath, ec)) {
        error = "webcam_device_not_found: " + devicePath;
        return false;
    }
#ifndef _WIN32
    if (::access(devicePath.c_str(), R_OK) != 0) {
        error = "webcam_permission_denied: " + devicePath;
        return false;
    }
#endif
    return true;
}

std::vector<std::string> BuildInputArgs(const std::string& source, bool loopFiles)
{
    if (source.rfind("lavfi:", 0) == 0) {
        return { "-f", "lavfi", "-i", source.substr(6) };
    }
    if (source.rfind("file:", 0) == 0) {
        if (loopFiles) {
            return { "-stream_loop", "-1", "-i", source.substr(5) };
        }
        return { "-i", source.substr(5) };
    }
    if (IsRtspSource(source)) {
        return {
            "-rtsp_transport",
            "tcp",
            "-timeout",
            "3000000",
            "-i",
            source,
        };
    }
    return {
        "-f",
        "v4l2",
        "-framerate",
        ResolveWebcamFrameRate(),
        "-i",
        DevicePathFromSource(source),
    };
}

std::vector<std::string> BuildThumbnailArgs(
    const std::string& source,
    const std::filesystem::path& outputPath)
{
    std::vector<std::string> args = {
        "-y",
        "-hide_banner",
        "-loglevel",
        "quiet",
        "-nostdin",
    };
    const std::vector<std::string> inputArgs = BuildInputArgs(source, false);
    args.insert(args.end(), inputArgs.begin(), inputArgs.end());
    args.insert(args.end(), {
        "-frames:v",
        "1",
        "-q:v",
        "3",
        outputPath.string(),
    });
    return args;
}

std::vector<std::string> BuildRecordingArgs(
    const std::string& source,
    const std::filesystem::path& clipDirectory,
    const std::string& cameraId,
    int segmentSeconds,
    int profileSeconds)
{
    std::vector<std::string> args = {
        "-y",
        "-hide_banner",
        "-loglevel",
        "quiet",
        "-nostdin",
    };
    const std::vector<std::string> inputArgs = BuildInputArgs(source, true);
    args.insert(args.end(), inputArgs.begin(), inputArgs.end());

    const std::filesystem::path pattern =
        clipDirectory / (cameraId + "_%Y%m%d_%H%M%S_" + std::to_string(profileSeconds) + "s.mp4");
    args.insert(args.end(), {
        "-an",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-r",
        "5",
        "-c:v",
        "mpeg4",
        "-q:v",
        "5",
        "-f",
        "segment",
        "-segment_time",
        std::to_string(segmentSeconds),
        "-reset_timestamps",
        "1",
        "-strftime",
        "1",
        "-segment_format",
        "mp4",
        pattern.string(),
    });
    return args;
}

bool RunThumbnailProbe(
    const std::string& source,
    const std::filesystem::path& outputPath,
    int timeoutMs,
    std::string& error)
{
    perceptrum::platform::ProcessHandle process;
    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = "ffmpeg";
    options.arguments = BuildThumbnailArgs(source, outputPath);

    if (!perceptrum::platform::LaunchProcess(options, process, error)) {
        if (error.empty()) {
            error = FrameErrorPrefixForSource(source) + "_launch_failed";
        }
        return false;
    }

    int exitCode = 1;
    if (!perceptrum::platform::WaitForProcessExit(process, timeoutMs, exitCode)) {
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(process, 124, 1000, &terminateError);
        perceptrum::platform::CloseProcess(process);
        error = FrameErrorPrefixForSource(source) + "_timeout";
        return false;
    }
    perceptrum::platform::CloseProcess(process);

    if (exitCode != 0) {
        error = FrameErrorPrefixForSource(source) + "_ffmpeg_exit_" + std::to_string(exitCode);
        return false;
    }

    std::error_code ec;
    if (!std::filesystem::exists(outputPath, ec) ||
        std::filesystem::file_size(outputPath, ec) <= 0) {
        error = FrameErrorPrefixForSource(source) + "_not_captured";
        return false;
    }
    return true;
}

} // namespace

namespace perceptrum::linux_runtime {

struct LinuxCameraSessionManager::Session {
    RuntimePaths paths;
    perceptrum::runtime::IRuntimeLogger* logger = nullptr;
    LinuxRtspCameraConfig config;
    std::string source;
    std::vector<std::string> candidates;
    std::string activeSource;
    std::filesystem::path thumbnailPath;
    std::filesystem::path clipDirectory;
    std::atomic<bool> stopRequested{ false };
    std::atomic<int> reconnectAttempts{ 0 };
    std::atomic<int> nextRetryDelaySeconds{ 0 };
    std::atomic<bool> reconnecting{ false };
    std::thread worker;
    mutable std::mutex processMutex;
    perceptrum::platform::ProcessHandle recordingProcess;
    std::string lastError;
    std::chrono::system_clock::time_point startedAt;
};

LinuxCameraSessionManager::LinuxCameraSessionManager(
    RuntimePaths paths,
    perceptrum::runtime::IRuntimeLogger* logger)
    : paths_(std::move(paths))
    , logger_(logger)
{
}

LinuxCameraSessionManager::~LinuxCameraSessionManager()
{
    shutdown();
}

std::shared_ptr<LinuxCameraSessionManager::Session> LinuxCameraSessionManager::findSessionLocked(
    const std::string& cameraId) const
{
    const auto it = sessions_.find(cameraId);
    return it == sessions_.end() ? nullptr : it->second;
}

LinuxCameraSessionStartResult LinuxCameraSessionManager::startCamera(
    const LinuxRtspCameraConfig& config)
{
    const auto startedAt = Clock::now();
    LinuxCameraSessionStartResult result;
    result.cameraId = config.cameraId;
    result.cameraName = config.cameraName;
    result.connectionMethod = config.connectionMethod;
    result.webcamIndex = config.webcamIndex;
    result.thumbnailRoot = LinuxCameraThumbnailRoot(paths_).string();
    result.recordingsRoot = LinuxCameraRecordingsRoot(paths_).string();
    result.inferenceTempRoot = LinuxInferenceTempRoot(paths_).string();
    result.jobsInferenceTempRoot = LinuxJobsInferenceTempRoot(paths_).string();

    std::vector<std::string> candidates = config.rtspCandidates;
    if (candidates.empty() && !config.rtspUrl.empty()) {
        candidates = SplitLinuxRtspCandidateList(config.rtspUrl);
        if (candidates.empty()) {
            candidates.push_back(config.rtspUrl);
        }
    }
    result.candidateCount = static_cast<int>(candidates.size());
    if (candidates.empty()) {
        result.error = "camera_source_empty";
        return result;
    }
    result.source = IsRtspSource(candidates.front())
        ? MaskLinuxRtspCredentials(candidates.front())
        : candidates.front();

    std::shared_ptr<Session> staleSession;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto existing = findSessionLocked(config.cameraId);
        if (existing) {
            bool processRunning = false;
            {
                std::lock_guard<std::mutex> processLock(existing->processMutex);
                processRunning = perceptrum::platform::IsProcessRunning(existing->recordingProcess);
            }
            if (processRunning) {
                result.started = true;
                result.reused = true;
                result.thumbnailGenerated = !existing->thumbnailPath.empty();
                result.recordingSessionStarted = true;
                result.source = IsRtspSource(existing->activeSource)
                    ? MaskLinuxRtspCredentials(existing->activeSource)
                    : existing->activeSource;
                result.activeRtspUrlMasked = IsRtspSource(existing->activeSource)
                    ? MaskLinuxRtspCredentials(existing->activeSource)
                    : std::string();
                result.candidateCount = static_cast<int>(existing->candidates.size());
                result.reconnectAttempts = existing->reconnectAttempts.load();
                result.reconnecting = existing->reconnecting.load();
                result.thumbnailPath = existing->thumbnailPath.string();
                result.clipDirectory = existing->clipDirectory.string();
                result.error = existing->lastError;
                result.startLatencyMs = static_cast<int>(
                    std::chrono::duration_cast<std::chrono::milliseconds>(
                        Clock::now() - startedAt).count());
                return result;
            }
            sessions_.erase(config.cameraId);
            staleSession = existing;
        }
    }
    if (staleSession) {
        stopSession(staleSession);
    }

    std::error_code ec;
    const std::filesystem::path thumbnailRoot = LinuxCameraThumbnailRoot(paths_);
    std::filesystem::create_directories(thumbnailRoot, ec);
    if (ec) {
        result.error = "thumbnail_directory_unavailable: " + ec.message();
        return result;
    }

    const std::filesystem::path clipDirectory = CameraClipDirectory(paths_, config.cameraId);
    std::filesystem::create_directories(clipDirectory, ec);
    if (ec) {
        result.error = "recording_directory_unavailable: " + ec.message();
        return result;
    }

    const std::filesystem::path thumbnailPath = thumbnailRoot / (config.cameraId + "-latest.jpg");
    std::string activeSource;
    std::string lastError;
    std::string lastRtspCandidateMasked;
    const int frameTimeoutMs = ReadStartFrameTimeoutMs();
    for (const auto& candidate : candidates) {
        if (IsRtspSource(candidate)) {
            lastRtspCandidateMasked = MaskLinuxRtspCredentials(candidate);
            result.attemptedRtspUrlsMasked.push_back(lastRtspCandidateMasked);
        }

        std::string validationError;
        if (!ValidateSourceForStart(candidate, validationError)) {
            lastError = validationError;
            continue;
        }

        std::string captureError;
        if (RunThumbnailProbe(candidate, thumbnailPath, frameTimeoutMs, captureError)) {
            activeSource = candidate;
            break;
        }
        lastError = captureError;
    }

    if (activeSource.empty()) {
        result.activeRtspUrlMasked = lastRtspCandidateMasked;
        result.error = lastError.empty()
            ? "camera_start_failed: no candidate produced a frame"
            : lastError;
        result.thumbnailPath = thumbnailPath.string();
        result.clipDirectory = clipDirectory.string();
        return result;
    }

    auto session = std::make_shared<Session>();
    session->paths = paths_;
    session->logger = logger_;
    session->config = config;
    session->source = activeSource;
    session->activeSource = activeSource;
    session->candidates = candidates;
    session->thumbnailPath = thumbnailPath;
    session->clipDirectory = clipDirectory;
    session->startedAt = std::chrono::system_clock::now();

    session->worker = std::thread([session]() {
        const std::vector<int> profiles = ResolveLinuxRecordingProfiles();
        const int profileSeconds = profiles.empty() ? 10 : profiles.front();
        const int segmentSeconds = ClampCaptureSeconds(profileSeconds);
        std::size_t candidateIndex = 0;
        for (std::size_t i = 0; i < session->candidates.size(); ++i) {
            if (session->candidates[i] == session->activeSource) {
                candidateIndex = i;
                break;
            }
        }
        int reconnectBackoffSeconds = 1;

        while (!session->stopRequested.load()) {
            std::error_code ec;
            std::filesystem::create_directories(session->clipDirectory, ec);
            if (ec) {
                session->lastError = "recording_directory_unavailable: " + ec.message();
                break;
            }

            const std::string recordingSource =
                session->candidates.empty()
                    ? session->source
                    : session->candidates[candidateIndex % session->candidates.size()];

            perceptrum::platform::ProcessHandle process;
            perceptrum::platform::ProcessLaunchOptions options;
            options.executablePath = "ffmpeg";
            options.arguments = BuildRecordingArgs(
                recordingSource,
                session->clipDirectory,
                session->config.cameraId,
                segmentSeconds,
                profileSeconds);

            std::string launchError;
            if (!perceptrum::platform::LaunchProcess(options, process, launchError)) {
                session->lastError = launchError.empty()
                    ? "recording_ffmpeg_launch_failed"
                    : "recording_ffmpeg_launch_failed: " + launchError;
                session->reconnecting.store(true);
                session->reconnectAttempts.fetch_add(1);
                session->nextRetryDelaySeconds.store(reconnectBackoffSeconds);
                if (!session->candidates.empty()) {
                    candidateIndex = (candidateIndex + 1) % session->candidates.size();
                }
                std::this_thread::sleep_for(std::chrono::seconds(reconnectBackoffSeconds));
                reconnectBackoffSeconds = std::min(reconnectBackoffSeconds * 2, 30);
                continue;
            }

            {
                std::lock_guard<std::mutex> lock(session->processMutex);
                session->recordingProcess = process;
                session->activeSource = recordingSource;
            }
            session->reconnecting.store(false);
            session->nextRetryDelaySeconds.store(0);
            reconnectBackoffSeconds = 1;

            if (session->logger != nullptr) {
                session->logger->info(
                    "camera",
                    "Linux camera recording session started for camera " + session->config.cameraId +
                        " source=" + MaskLinuxRtspCredentials(recordingSource));
            }

            while (!session->stopRequested.load()) {
                bool running = false;
                {
                    std::lock_guard<std::mutex> lock(session->processMutex);
                    running = perceptrum::platform::IsProcessRunning(session->recordingProcess);
                }
                if (!running) {
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }

            {
                std::lock_guard<std::mutex> lock(session->processMutex);
                if (session->stopRequested.load()) {
                    std::string terminateError;
                    (void)perceptrum::platform::TerminateProcess(
                        session->recordingProcess,
                        0,
                        2000,
                        &terminateError);
                } else {
                    int exitCode = 0;
                    if (perceptrum::platform::TryGetProcessExitCode(session->recordingProcess, exitCode) &&
                        exitCode != 0) {
                        session->lastError = "recording_ffmpeg_exit_" + std::to_string(exitCode);
                    }
                }
                perceptrum::platform::CloseProcess(session->recordingProcess);
            }

            if (!session->stopRequested.load()) {
                session->reconnecting.store(true);
                session->reconnectAttempts.fetch_add(1);
                session->nextRetryDelaySeconds.store(reconnectBackoffSeconds);
                if (!session->candidates.empty()) {
                    candidateIndex = (candidateIndex + 1) % session->candidates.size();
                }
                std::this_thread::sleep_for(std::chrono::seconds(reconnectBackoffSeconds));
                reconnectBackoffSeconds = std::min(reconnectBackoffSeconds * 2, 30);
            }
        }
    });

    {
        std::lock_guard<std::mutex> lock(mutex_);
        sessions_[config.cameraId] = session;
    }

    result.started = true;
    result.thumbnailGenerated = true;
    result.recordingSessionStarted = true;
    result.source = IsRtspSource(activeSource)
        ? MaskLinuxRtspCredentials(activeSource)
        : activeSource;
    result.activeRtspUrlMasked = IsRtspSource(activeSource)
        ? MaskLinuxRtspCredentials(activeSource)
        : std::string();
    result.thumbnailPath = thumbnailPath.string();
    result.clipDirectory = clipDirectory.string();
    result.startLatencyMs = static_cast<int>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            Clock::now() - startedAt).count());
    return result;
}

LinuxCameraSessionStopResult LinuxCameraSessionManager::stopCamera(
    const std::string& cameraId) noexcept
{
    LinuxCameraSessionStopResult result;
    result.cameraId = cameraId;

    std::shared_ptr<Session> session;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto it = sessions_.find(cameraId);
        if (it == sessions_.end()) {
            result.stopped = true;
            result.wasRunning = false;
            return result;
        }
        session = it->second;
        sessions_.erase(it);
    }

    result.wasRunning = true;
    stopSession(session);
    result.stopped = true;
    return result;
}

void LinuxCameraSessionManager::stopSession(const std::shared_ptr<Session>& session) noexcept
{
    if (!session) {
        return;
    }
    session->stopRequested.store(true);
    {
        std::lock_guard<std::mutex> lock(session->processMutex);
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(
            session->recordingProcess,
            0,
            2000,
            &terminateError);
        perceptrum::platform::CloseProcess(session->recordingProcess);
    }
    if (session->worker.joinable()) {
        session->worker.join();
    }
    if (logger_ != nullptr) {
        logger_->info("camera", "Linux camera session stopped for camera " + session->config.cameraId);
    }
}

void LinuxCameraSessionManager::shutdown() noexcept
{
    std::vector<std::shared_ptr<Session>> sessions;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& item : sessions_) {
            sessions.push_back(item.second);
        }
        sessions_.clear();
    }
    for (const auto& session : sessions) {
        stopSession(session);
    }
}

nlohmann::json LinuxCameraSessionManager::statusJson() const
{
    nlohmann::json activeCameraIds = nlohmann::json::array();
    nlohmann::json lastErrors = nlohmann::json::object();
    nlohmann::json lastThumbnails = nlohmann::json::object();
    nlohmann::json clipDirectories = nlohmann::json::object();
    nlohmann::json ffmpegPids = nlohmann::json::object();
    nlohmann::json activeRtspUrls = nlohmann::json::object();
    nlohmann::json candidateCounts = nlohmann::json::object();
    nlohmann::json reconnectAttempts = nlohmann::json::object();
    nlohmann::json reconnecting = nlohmann::json::object();
    nlohmann::json nextRetryDelays = nlohmann::json::object();

    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& item : sessions_) {
        const auto& cameraId = item.first;
        const auto& session = item.second;
        activeCameraIds.push_back(cameraId);
        lastErrors[cameraId] = session->lastError;
        lastThumbnails[cameraId] = session->thumbnailPath.string();
        clipDirectories[cameraId] = session->clipDirectory.string();
        if (IsRtspSource(session->activeSource)) {
            activeRtspUrls[cameraId] = MaskLinuxRtspCredentials(session->activeSource);
        } else {
            activeRtspUrls[cameraId] = nullptr;
        }
        candidateCounts[cameraId] = session->candidates.size();
        reconnectAttempts[cameraId] = session->reconnectAttempts.load();
        reconnecting[cameraId] = session->reconnecting.load();
        nextRetryDelays[cameraId] = session->nextRetryDelaySeconds.load();

        nlohmann::json pids = nlohmann::json::array();
        {
            std::lock_guard<std::mutex> processLock(session->processMutex);
            if (perceptrum::platform::IsProcessRunning(session->recordingProcess) &&
                session->recordingProcess.processId > 0) {
                pids.push_back(session->recordingProcess.processId);
            }
        }
        ffmpegPids[cameraId] = pids;
    }

    return {
        { "active_count", activeCameraIds.size() },
        { "active_camera_ids", activeCameraIds },
        { "last_errors_by_camera", lastErrors },
        { "last_thumbnail_by_camera", lastThumbnails },
        { "clip_directories_by_camera", clipDirectories },
        { "ffmpeg_child_pids_by_camera", ffmpegPids },
        { "active_rtsp_url_by_camera", activeRtspUrls },
        { "candidate_count_by_camera", candidateCounts },
        { "reconnect_attempts_by_camera", reconnectAttempts },
        { "reconnecting_by_camera", reconnecting },
        { "next_retry_delay_seconds_by_camera", nextRetryDelays },
    };
}

} // namespace perceptrum::linux_runtime

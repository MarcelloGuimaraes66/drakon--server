#include "LinuxFrameDiskWriter.h"

#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_process.h"

#include <algorithm>
#include <chrono>
#include <ctime>
#include <filesystem>
#include <iomanip>
#include <set>
#include <sstream>
#include <system_error>
#include <utility>

namespace {

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

std::string ResolveWebcamFrameRate()
{
    const std::string raw = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_WEBCAM_FRAMERATE"));
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

int ClampCaptureSeconds(int profileSeconds)
{
    const std::string raw = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_RECORDING_CAPTURE_SECONDS"));
    if (!raw.empty()) {
        try {
            const int parsed = std::stoi(raw);
            if (parsed > 0) {
                return std::min(parsed, profileSeconds);
            }
        } catch (...) {
        }
    }
    return profileSeconds;
}

std::tm LocalTimeFromSystemClock(std::chrono::system_clock::time_point value)
{
    const std::time_t time = std::chrono::system_clock::to_time_t(value);
    std::tm local{};
#ifdef _WIN32
    localtime_s(&local, &time);
#else
    localtime_r(&time, &local);
#endif
    return local;
}

std::string FormatLocalTime(std::chrono::system_clock::time_point value, const char* format)
{
    std::ostringstream out;
    const std::tm local = LocalTimeFromSystemClock(value);
    out << std::put_time(&local, format);
    return out.str();
}

std::filesystem::path ClipPathForProfile(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::string& cameraId,
    int profileSeconds,
    std::chrono::system_clock::time_point startAt)
{
    const auto endAt = startAt + std::chrono::seconds(profileSeconds);
    const std::filesystem::path dayDir =
        perceptrum::linux_runtime::LinuxCameraRecordingsRoot(paths) /
        ("cam_" + cameraId) /
        FormatLocalTime(startAt, "%Y") /
        FormatLocalTime(startAt, "%m") /
        FormatLocalTime(startAt, "%d");

    std::ostringstream filename;
    filename << cameraId << '_'
             << FormatLocalTime(startAt, "%Y%m%d_%H%M%S") << '_'
             << FormatLocalTime(endAt, "%Y%m%d_%H%M%S") << '_'
             << profileSeconds << "s.mp4";
    return dayDir / filename.str();
}

std::vector<std::string> BuildInputArgs(const perceptrum::linux_runtime::LinuxRtspCameraConfig& config)
{
    if (config.rtspUrl.rfind("lavfi:", 0) == 0) {
        return { "-f", "lavfi", "-i", config.rtspUrl.substr(6) };
    }
    if (config.rtspUrl.rfind("file:", 0) == 0) {
        return { "-i", config.rtspUrl.substr(5) };
    }
    if (config.rtspUrl.rfind("v4l2:", 0) == 0 || config.rtspUrl.rfind("/dev/video", 0) == 0) {
        return {
            "-f",
            "v4l2",
            "-framerate",
            ResolveWebcamFrameRate(),
            "-i",
            config.rtspUrl.rfind("v4l2:", 0) == 0 ? config.rtspUrl.substr(5) : config.rtspUrl,
        };
    }
    return {
        "-rtsp_transport",
        "tcp",
        "-timeout",
        "3000000",
        "-i",
        config.rtspUrl,
    };
}

std::vector<std::string> BuildClipArgs(
    const perceptrum::linux_runtime::LinuxRtspCameraConfig& config,
    int captureSeconds,
    const std::filesystem::path& outputPath)
{
    std::vector<std::string> args = {
        "-y",
        "-hide_banner",
        "-loglevel",
        "quiet",
        "-nostdin",
    };

    const std::vector<std::string> inputArgs = BuildInputArgs(config);
    args.insert(args.end(), inputArgs.begin(), inputArgs.end());
    args.insert(args.end(), {
        "-t",
        std::to_string(captureSeconds),
        "-an",
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-r",
        "5",
        "-c:v",
        "mpeg4",
        "-q:v",
        "5",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        outputPath.string(),
    });
    return args;
}

bool RunFfmpeg(const std::vector<std::string>& args, int timeoutMs, std::string& error)
{
    perceptrum::platform::ProcessHandle process;
    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = "ffmpeg";
    options.arguments = args;

    if (!perceptrum::platform::LaunchProcess(options, process, error)) {
        return false;
    }

    int exitCode = 1;
    if (!perceptrum::platform::WaitForProcessExit(process, timeoutMs, exitCode)) {
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(process, 124, 2000, &terminateError);
        perceptrum::platform::CloseProcess(process);
        error = "ffmpeg timeout";
        return false;
    }
    perceptrum::platform::CloseProcess(process);

    if (exitCode != 0) {
        error = "ffmpeg exit_code=" + std::to_string(exitCode);
        return false;
    }
    return true;
}

} // namespace

namespace perceptrum::linux_runtime {

std::filesystem::path LinuxCameraThumbnailRoot(const RuntimePaths& paths)
{
    return paths.cacheRoot / "agentcore" / "camera-thumbnails";
}

std::filesystem::path LinuxCameraRecordingsRoot(const RuntimePaths& paths)
{
    return paths.dataRoot / "frames";
}

std::filesystem::path LinuxInferenceTempRoot(const RuntimePaths& paths)
{
    return paths.cacheRoot / "agentcore" / "inference-temp";
}

std::filesystem::path LinuxJobsInferenceTempRoot(const RuntimePaths& paths)
{
    return paths.cacheRoot / "agentcore" / "jobs-inference-temp";
}

std::vector<int> ResolveLinuxRecordingProfiles()
{
    std::string raw = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_RECORDING_PROFILES"));
    if (raw.empty()) {
        raw = "10";
    }

    std::vector<int> profiles;
    std::set<int> seen;
    std::stringstream stream(raw);
    std::string token;
    while (std::getline(stream, token, ',')) {
        token = Trim(std::move(token));
        if (token.empty()) {
            continue;
        }
        try {
            const int value = std::stoi(token);
            if ((value == 10 || value == 60 || value == 300) && seen.insert(value).second) {
                profiles.push_back(value);
            }
        } catch (...) {
        }
    }

    if (profiles.empty()) {
        profiles.push_back(10);
    }
    return profiles;
}

std::vector<LinuxFrameDiskWriterClipResult> WriteLinuxCameraClips(
    const RuntimePaths& paths,
    const LinuxRtspCameraConfig& config)
{
    std::vector<LinuxFrameDiskWriterClipResult> results;
    const std::vector<int> profiles = ResolveLinuxRecordingProfiles();
    const auto startAt = std::chrono::system_clock::now();

    for (const int profileSeconds : profiles) {
        LinuxFrameDiskWriterClipResult result;
        result.profileSeconds = profileSeconds;
        result.path = ClipPathForProfile(paths, config.cameraId, profileSeconds, startAt);

        std::error_code errorCode;
        std::filesystem::create_directories(result.path.parent_path(), errorCode);
        if (errorCode) {
            result.error = "recording_directory_unavailable: " + errorCode.message();
            results.push_back(std::move(result));
            continue;
        }

        const std::filesystem::path tempPath = result.path.string() + ".tmp";
        const int captureSeconds = ClampCaptureSeconds(profileSeconds);
        std::string error;
        const bool ok = RunFfmpeg(
            BuildClipArgs(config, captureSeconds, tempPath),
            std::max(7000, (captureSeconds + 5) * 1000),
            error);
        if (!ok) {
            result.error = "recording_clip_failed: " + error;
            std::filesystem::remove(tempPath, errorCode);
            results.push_back(std::move(result));
            continue;
        }

        std::filesystem::rename(tempPath, result.path, errorCode);
        if (errorCode) {
            result.error = "recording_clip_rename_failed: " + errorCode.message();
            std::filesystem::remove(tempPath, errorCode);
            results.push_back(std::move(result));
            continue;
        }

        result.generated =
            std::filesystem::exists(result.path, errorCode) &&
            std::filesystem::file_size(result.path, errorCode) > 0;
        if (!result.generated) {
            result.error = "recording_clip_failed: ffmpeg did not write a clip";
        }
        results.push_back(std::move(result));
    }

    return results;
}

} // namespace perceptrum::linux_runtime

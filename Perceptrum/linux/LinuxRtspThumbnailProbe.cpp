#include "LinuxRtspThumbnailProbe.h"

#include "LinuxFrameDiskWriter.h"
#include "LinuxRtspCandidateBuilder.h"

#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_process.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <system_error>
#include <vector>

#include <nlohmann/json.hpp>

namespace {

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

std::string ReadString(const nlohmann::json& value, const char* key)
{
    const auto it = value.find(key);
    if (it == value.end() || it->is_null() || !it->is_string()) {
        return {};
    }
    return Trim(it->get<std::string>());
}

int ReadInt(const nlohmann::json& value, const char* key, int fallback = -1)
{
    const auto it = value.find(key);
    if (it == value.end() || it->is_null()) {
        return fallback;
    }
    if (it->is_number_integer()) {
        return it->get<int>();
    }
    if (it->is_string()) {
        try {
            return std::stoi(Trim(it->get<std::string>()));
        } catch (...) {
        }
    }
    return fallback;
}

bool LooksLikeRtsp(std::string_view value)
{
    return value.rfind("rtsp://", 0) == 0 || value.rfind("rtsps://", 0) == 0;
}

bool LooksLikeWebcam(std::string_view value)
{
    return value.rfind("v4l2:", 0) == 0 || value.rfind("/dev/video", 0) == 0;
}

bool IsAllowedSyntheticSource(std::string_view value)
{
    const std::string allowed =
        Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_RTSP_ALLOW_TEST_SOURCE"));
    if (allowed != "1" && allowed != "true" && allowed != "TRUE") {
        return false;
    }
    return value.rfind("lavfi:", 0) == 0 || value.rfind("file:", 0) == 0;
}

bool LooksLikeSupportedCameraSource(std::string_view value)
{
    return LooksLikeRtsp(value) || LooksLikeWebcam(value) || IsAllowedSyntheticSource(value);
}

std::string ResolveWebcamSource(int webcamIndex)
{
    const std::string testSource =
        Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_WEBCAM_TEST_SOURCE"));
    if (!testSource.empty() && IsAllowedSyntheticSource(testSource)) {
        return testSource;
    }

    const std::string device =
        Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_WEBCAM_DEVICE"));
    if (!device.empty()) {
        return device.rfind("v4l2:", 0) == 0 ? device : "v4l2:" + device;
    }

    if (webcamIndex < 0) {
        webcamIndex = 0;
    }
    return "v4l2:/dev/video" + std::to_string(webcamIndex);
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

std::filesystem::path ThumbnailRoot(const perceptrum::linux_runtime::RuntimePaths& paths)
{
    return perceptrum::linux_runtime::LinuxCameraThumbnailRoot(paths);
}

std::filesystem::path EventPath(const perceptrum::linux_runtime::RuntimePaths& paths)
{
    return paths.stateRoot / "events" / "agent_events.jsonl";
}

std::optional<perceptrum::linux_runtime::LinuxRtspCameraConfig> ConfigFromCameraJson(
    const nlohmann::json& camera)
{
    if (!camera.is_object()) {
        return std::nullopt;
    }

    std::vector<std::string> rtspCandidates =
        perceptrum::linux_runtime::BuildLinuxRtspCandidatesFromCameraJson(camera);
    std::string rtspUrl = rtspCandidates.empty() ? std::string() : rtspCandidates.front();

    perceptrum::linux_runtime::LinuxRtspCameraConfig config;
    config.connectionMethod = ReadString(camera, "connection_method");
    if (config.connectionMethod.empty()) {
        config.connectionMethod = ReadString(camera, "connectionMethod");
    }
    if (config.connectionMethod.empty()) {
        config.connectionMethod = rtspUrl.empty() ? "WEBCAM" : "RTSP";
    }
    config.webcamIndex = ReadInt(camera, "webcam_index", ReadInt(camera, "webcamIndex", -1));
    const std::string normalizedMethod = Lower(config.connectionMethod);
    if (rtspUrl.empty() && (normalizedMethod == "webcam" || config.webcamIndex >= 0)) {
        rtspUrl = ResolveWebcamSource(config.webcamIndex);
        config.connectionMethod = "WEBCAM";
        if (config.webcamIndex < 0) {
            config.webcamIndex = 0;
        }
    }
    if (rtspUrl.empty()) {
        return std::nullopt;
    }
    config.rtspUrl = std::move(rtspUrl);
    config.rtspCandidates = std::move(rtspCandidates);
    config.cameraId = ReadString(camera, "camera_id");
    if (config.cameraId.empty()) {
        config.cameraId = ReadString(camera, "id");
    }
    if (config.cameraId.empty() && camera.contains("camera_id") && camera["camera_id"].is_number_integer()) {
        config.cameraId = std::to_string(camera["camera_id"].get<int>());
    }
    if (config.cameraId.empty()) {
        config.cameraId = "linux-rtsp-camera";
    }

    config.cameraName = ReadString(camera, "camera_name");
    if (config.cameraName.empty()) {
        config.cameraName = ReadString(camera, "name");
    }
    if (config.cameraName.empty()) {
        config.cameraName = Lower(config.connectionMethod) == "webcam"
            ? "Linux webcam"
            : "Linux RTSP camera";
    }

    return config;
}

std::vector<std::string> BuildFfmpegArgs(
    const perceptrum::linux_runtime::LinuxRtspCameraConfig& config,
    const std::filesystem::path& thumbnailPath)
{
    std::vector<std::string> args = {
        "-y",
        "-hide_banner",
        "-loglevel",
        "quiet",
        "-nostdin",
    };

    if (config.rtspUrl.rfind("lavfi:", 0) == 0) {
        args.push_back("-f");
        args.push_back("lavfi");
        args.push_back("-i");
        args.push_back(config.rtspUrl.substr(6));
    } else if (config.rtspUrl.rfind("file:", 0) == 0) {
        args.push_back("-i");
        args.push_back(config.rtspUrl.substr(5));
    } else if (config.rtspUrl.rfind("v4l2:", 0) == 0 ||
               config.rtspUrl.rfind("/dev/video", 0) == 0) {
        args.push_back("-f");
        args.push_back("v4l2");
        args.push_back("-framerate");
        args.push_back(ResolveWebcamFrameRate());
        args.push_back("-i");
        args.push_back(config.rtspUrl.rfind("v4l2:", 0) == 0
            ? config.rtspUrl.substr(5)
            : config.rtspUrl);
    } else {
        args.push_back("-rtsp_transport");
        args.push_back("tcp");
        args.push_back("-timeout");
        args.push_back("3000000");
        args.push_back("-i");
        args.push_back(config.rtspUrl);
    }

    args.push_back("-frames:v");
    args.push_back("1");
    args.push_back("-q:v");
    args.push_back("3");
    args.push_back(thumbnailPath.string());
    return args;
}

bool WriteEvent(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const perceptrum::linux_runtime::LinuxRtspCameraConfig& config,
    const perceptrum::linux_runtime::LinuxRtspThumbnailResult& result)
{
    const std::filesystem::path path = EventPath(paths);
    std::error_code errorCode;
    std::filesystem::create_directories(path.parent_path(), errorCode);
    if (errorCode) {
        return false;
    }

    std::ofstream stream(path, std::ios::binary | std::ios::app);
    if (!stream.is_open()) {
        return false;
    }

    nlohmann::json event = {
        { "type", "linux_rtsp_thumbnail" },
        { "camera_id", config.cameraId },
        { "camera_name", config.cameraName },
        { "connection_method", config.connectionMethod },
        { "webcam_index", config.webcamIndex >= 0 ? nlohmann::json(config.webcamIndex) : nlohmann::json(nullptr) },
        { "rtsp_url_masked", perceptrum::linux_runtime::MaskLinuxRtspCredentials(config.rtspUrl) },
        { "thumbnail_generated", result.thumbnailGenerated },
        { "thumbnail_path", result.thumbnailPath },
        { "recording_clip_generated", result.recordingClipGenerated },
        { "recordings_root", result.recordingsRoot },
        { "clip_paths", result.clipPaths },
        { "recording_profiles", result.recordingProfiles },
        { "error", result.error },
    };
    stream << event.dump() << '\n';
    return stream.good();
}

} // namespace

namespace perceptrum::linux_runtime {

std::optional<LinuxRtspCameraConfig> ResolveLinuxRtspCameraConfig(
    const RuntimePaths& paths,
    std::string* errorMessage)
{
    if (errorMessage != nullptr) {
        errorMessage->clear();
    }

    LinuxRtspCameraConfig envConfig;
    envConfig.rtspUrl = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_RTSP_URL"));
    envConfig.connectionMethod = "RTSP";
    if (!envConfig.rtspUrl.empty()) {
        envConfig.rtspCandidates =
            SplitLinuxRtspCandidateList(envConfig.rtspUrl);
        if (!envConfig.rtspCandidates.empty()) {
            envConfig.rtspUrl = envConfig.rtspCandidates.front();
        }
        const std::string cameraId = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_CAMERA_ID"));
        const std::string cameraName = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_CAMERA_NAME"));
        if (!cameraId.empty()) {
            envConfig.cameraId = cameraId;
        }
        if (!cameraName.empty()) {
            envConfig.cameraName = cameraName;
        }
        return envConfig;
    }

    const std::string webcamIndexRaw = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_WEBCAM_INDEX"));
    const std::string webcamDevice = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_WEBCAM_DEVICE"));
    const std::string webcamTestSource = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_WEBCAM_TEST_SOURCE"));
    if (!webcamIndexRaw.empty() || !webcamDevice.empty() || !webcamTestSource.empty()) {
        int webcamIndex = 0;
        if (!webcamIndexRaw.empty()) {
            try {
                webcamIndex = std::max(0, std::stoi(webcamIndexRaw));
            } catch (...) {
                webcamIndex = 0;
            }
        }
        envConfig.connectionMethod = "WEBCAM";
        envConfig.webcamIndex = webcamIndex;
        envConfig.rtspUrl = ResolveWebcamSource(webcamIndex);
        const std::string cameraId = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_CAMERA_ID"));
        const std::string cameraName = Trim(perceptrum::platform::ReadEnvVar("APP_AGENT_CAMERA_NAME"));
        envConfig.cameraId = cameraId.empty() ? "linux-webcam-" + std::to_string(webcamIndex) : cameraId;
        envConfig.cameraName = cameraName.empty() ? "Linux webcam " + std::to_string(webcamIndex) : cameraName;
        return envConfig;
    }

    std::ifstream stream(AgentConfigPath(paths), std::ios::binary);
    if (!stream.is_open()) {
        return std::nullopt;
    }

    nlohmann::json document = nlohmann::json::parse(stream, nullptr, false);
    if (document.is_discarded() || !document.is_object()) {
        if (errorMessage != nullptr) {
            *errorMessage = "agent_config.json is not valid JSON.";
        }
        return std::nullopt;
    }

    if (auto config = ConfigFromCameraJson(document); config.has_value()) {
        return config;
    }

    const auto camerasIt = document.find("cameras");
    if (camerasIt != document.end() && camerasIt->is_array()) {
        for (const auto& camera : *camerasIt) {
            if (auto config = ConfigFromCameraJson(camera); config.has_value()) {
                return config;
            }
        }
    }

    const auto linuxCameraIt = document.find("linux_rtsp_camera");
    if (linuxCameraIt != document.end()) {
        return ConfigFromCameraJson(*linuxCameraIt);
    }

    return std::nullopt;
}

LinuxRtspThumbnailResult RunLinuxRtspThumbnailProbe(
    const RuntimePaths& paths,
    const LinuxRtspCameraConfig& config)
{
    LinuxRtspThumbnailResult result;
    result.configured = true;
    result.cameraId = config.cameraId;
    result.cameraName = config.cameraName;
    result.thumbnailRoot = LinuxCameraThumbnailRoot(paths).string();
    result.recordingsRoot = LinuxCameraRecordingsRoot(paths).string();
    result.inferenceTempRoot = LinuxInferenceTempRoot(paths).string();
    result.jobsInferenceTempRoot = LinuxJobsInferenceTempRoot(paths).string();
    result.recordingProfiles = ResolveLinuxRecordingProfiles();

    if (!LooksLikeSupportedCameraSource(config.rtspUrl)) {
        result.error = "camera_config_invalid: camera config must be rtsp://, WEBCAM/webcam_index, /dev/videoN, or an allowed test source";
        result.eventPath = EventPath(paths).string();
        result.eventPublished = WriteEvent(paths, config, result);
        return result;
    }

    std::error_code errorCode;
    const std::filesystem::path thumbnailRoot = ThumbnailRoot(paths);
    std::filesystem::create_directories(thumbnailRoot, errorCode);
    if (errorCode) {
        result.error = "thumbnail_directory_unavailable: " + errorCode.message();
        result.eventPath = EventPath(paths).string();
        result.eventPublished = WriteEvent(paths, config, result);
        return result;
    }

    const std::filesystem::path thumbnailPath =
        thumbnailRoot / (config.cameraId + "-latest.jpg");
    perceptrum::platform::ProcessHandle process;
    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = "ffmpeg";
    options.arguments = BuildFfmpegArgs(config, thumbnailPath);

    std::string errorMessage;
    if (!perceptrum::platform::LaunchProcess(options, process, errorMessage)) {
        result.error = "rtsp_camera_start_failed: " + errorMessage;
        result.eventPath = EventPath(paths).string();
        result.eventPublished = WriteEvent(paths, config, result);
        return result;
    }

    result.cameraStarted = true;
    int exitCode = 1;
    if (!perceptrum::platform::WaitForProcessExit(process, 7000, exitCode)) {
        (void)perceptrum::platform::TerminateProcess(process, 124, 2000, &errorMessage);
        result.error = "rtsp_thumbnail_timeout: ffmpeg did not produce a frame within 7 seconds";
    } else if (exitCode != 0) {
        result.error = "rtsp_thumbnail_failed: ffmpeg exit_code=" + std::to_string(exitCode);
    }
    perceptrum::platform::CloseProcess(process);

    result.thumbnailPath = thumbnailPath.string();
    result.thumbnailGenerated =
        result.error.empty() &&
        std::filesystem::exists(thumbnailPath, errorCode) &&
        std::filesystem::file_size(thumbnailPath, errorCode) > 0;
    if (!result.thumbnailGenerated && result.error.empty()) {
        result.error = "rtsp_thumbnail_failed: ffmpeg did not write a thumbnail";
    }

    const std::vector<LinuxFrameDiskWriterClipResult> clips = WriteLinuxCameraClips(paths, config);
    for (const auto& clip : clips) {
        if (clip.generated) {
            result.recordingClipGenerated = true;
            result.clipPaths.push_back(clip.path.string());
        } else if (result.error.empty()) {
            result.error = clip.error.empty()
                ? "recording_clip_failed"
                : clip.error;
        }
    }

    result.eventPath = EventPath(paths).string();
    result.eventPublished = WriteEvent(paths, config, result);
    return result;
}

} // namespace perceptrum::linux_runtime

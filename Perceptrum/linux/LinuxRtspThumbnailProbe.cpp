#include "LinuxRtspThumbnailProbe.h"

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

std::string ReadString(const nlohmann::json& value, const char* key)
{
    const auto it = value.find(key);
    if (it == value.end() || it->is_null() || !it->is_string()) {
        return {};
    }
    return Trim(it->get<std::string>());
}

bool LooksLikeRtsp(std::string_view value)
{
    return value.rfind("rtsp://", 0) == 0 || value.rfind("rtsps://", 0) == 0;
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

std::string MaskCredentials(std::string value)
{
    const std::size_t scheme = value.find("://");
    if (scheme == std::string::npos) {
        return value;
    }

    const std::size_t authorityStart = scheme + 3;
    const std::size_t authorityEnd = value.find_first_of("/?#", authorityStart);
    const std::size_t at = value.find('@', authorityStart);
    if (at == std::string::npos || (authorityEnd != std::string::npos && at > authorityEnd)) {
        return value;
    }

    value.replace(authorityStart, at - authorityStart, "***:***");
    return value;
}

std::filesystem::path ThumbnailRoot(const perceptrum::linux_runtime::RuntimePaths& paths)
{
    return paths.cacheRoot / "agentcore" / "rtsp-thumbnails";
}

std::filesystem::path EventPath(const perceptrum::linux_runtime::RuntimePaths& paths)
{
    return paths.dataRoot / "agent_events.jsonl";
}

std::optional<perceptrum::linux_runtime::LinuxRtspCameraConfig> ConfigFromCameraJson(
    const nlohmann::json& camera)
{
    if (!camera.is_object()) {
        return std::nullopt;
    }

    std::string rtspUrl = ReadString(camera, "rtsp_url");
    if (rtspUrl.empty()) {
        rtspUrl = ReadString(camera, "rtspUrl");
    }
    if (rtspUrl.empty()) {
        rtspUrl = ReadString(camera, "stream_url");
    }
    if (rtspUrl.empty()) {
        rtspUrl = ReadString(camera, "streamUrl");
    }
    if (rtspUrl.empty()) {
        return std::nullopt;
    }

    perceptrum::linux_runtime::LinuxRtspCameraConfig config;
    config.rtspUrl = std::move(rtspUrl);
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
        config.cameraName = "Linux RTSP camera";
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
        "error",
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
    } else {
        args.push_back("-rtsp_transport");
        args.push_back("tcp");
        args.push_back("-stimeout");
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
        { "rtsp_url_masked", MaskCredentials(config.rtspUrl) },
        { "thumbnail_generated", result.thumbnailGenerated },
        { "thumbnail_path", result.thumbnailPath },
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
    if (!envConfig.rtspUrl.empty()) {
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

    if (!LooksLikeRtsp(config.rtspUrl) && !IsAllowedSyntheticSource(config.rtspUrl)) {
        result.error = "rtsp_config_invalid: APP_AGENT_RTSP_URL or camera config must start with rtsp://";
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

    result.eventPath = EventPath(paths).string();
    result.eventPublished = WriteEvent(paths, config, result);
    return result;
}

} // namespace perceptrum::linux_runtime

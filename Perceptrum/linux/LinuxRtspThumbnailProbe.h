#pragma once

#include "RuntimePaths.h"

#include <optional>
#include <string>

namespace perceptrum::linux_runtime {

struct LinuxRtspCameraConfig {
    std::string cameraId = "linux-rtsp-camera";
    std::string cameraName = "Linux RTSP camera";
    std::string rtspUrl;
};

struct LinuxRtspThumbnailResult {
    bool configured = false;
    bool cameraStarted = false;
    bool thumbnailGenerated = false;
    bool eventPublished = false;
    std::string cameraId;
    std::string cameraName;
    std::string thumbnailPath;
    std::string eventPath;
    std::string error;
};

std::optional<LinuxRtspCameraConfig> ResolveLinuxRtspCameraConfig(
    const RuntimePaths& paths,
    std::string* errorMessage = nullptr);

LinuxRtspThumbnailResult RunLinuxRtspThumbnailProbe(
    const RuntimePaths& paths,
    const LinuxRtspCameraConfig& config);

} // namespace perceptrum::linux_runtime

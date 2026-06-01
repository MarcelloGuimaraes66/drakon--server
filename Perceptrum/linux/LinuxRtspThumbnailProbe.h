#pragma once

#include "RuntimePaths.h"

#include <optional>
#include <string>
#include <vector>

namespace perceptrum::linux_runtime {

struct LinuxRtspCameraConfig {
    std::string cameraId = "linux-rtsp-camera";
    std::string cameraName = "Linux RTSP camera";
    std::string connectionMethod = "RTSP";
    std::string rtspUrl;
    std::vector<std::string> rtspCandidates;
    int webcamIndex = -1;
};

struct LinuxRtspThumbnailResult {
    bool configured = false;
    bool cameraStarted = false;
    bool thumbnailGenerated = false;
    bool eventPublished = false;
    bool recordingClipGenerated = false;
    std::string cameraId;
    std::string cameraName;
    std::string thumbnailPath;
    std::string thumbnailRoot;
    std::string recordingsRoot;
    std::vector<std::string> clipPaths;
    std::vector<int> recordingProfiles;
    std::string inferenceTempRoot;
    std::string jobsInferenceTempRoot;
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

#pragma once

#include "LinuxRtspThumbnailProbe.h"
#include "RuntimePaths.h"

#include <filesystem>
#include <string>
#include <vector>

namespace perceptrum::linux_runtime {

struct LinuxFrameDiskWriterClipResult {
    int profileSeconds = 0;
    std::filesystem::path path;
    bool generated = false;
    std::string error;
};

std::filesystem::path LinuxCameraThumbnailRoot(const RuntimePaths& paths);
std::filesystem::path LinuxCameraRecordingsRoot(const RuntimePaths& paths);
std::filesystem::path LinuxInferenceTempRoot(const RuntimePaths& paths);
std::filesystem::path LinuxJobsInferenceTempRoot(const RuntimePaths& paths);

std::vector<int> ResolveLinuxRecordingProfiles();
std::vector<LinuxFrameDiskWriterClipResult> WriteLinuxCameraClips(
    const RuntimePaths& paths,
    const LinuxRtspCameraConfig& config);

} // namespace perceptrum::linux_runtime

#pragma once

#include "LinuxRtspThumbnailProbe.h"
#include "RuntimePaths.h"

#include "../Perceptrum/runtime/interfaces/IRuntimeLogger.h"

#include <filesystem>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include <nlohmann/json.hpp>

namespace perceptrum::linux_runtime {

struct LinuxCameraSessionStartResult {
    bool started = false;
    bool reused = false;
    bool thumbnailGenerated = false;
    bool recordingSessionStarted = false;
    int startLatencyMs = 0;
    std::string cameraId;
    std::string cameraName;
    std::string connectionMethod;
    int webcamIndex = -1;
    std::string source;
    std::string activeRtspUrlMasked;
    std::vector<std::string> attemptedRtspUrlsMasked;
    int candidateCount = 0;
    int reconnectAttempts = 0;
    bool reconnecting = false;
    std::string thumbnailPath;
    std::string thumbnailRoot;
    std::string recordingsRoot;
    std::string clipDirectory;
    std::string inferenceTempRoot;
    std::string jobsInferenceTempRoot;
    std::string error;
};

struct LinuxCameraSessionStopResult {
    bool stopped = false;
    bool wasRunning = false;
    std::string cameraId;
    std::string error;
};

class LinuxCameraSessionManager final {
public:
    LinuxCameraSessionManager(
        RuntimePaths paths,
        perceptrum::runtime::IRuntimeLogger* logger);
    ~LinuxCameraSessionManager();

    LinuxCameraSessionStartResult startCamera(const LinuxRtspCameraConfig& config);
    LinuxCameraSessionStopResult stopCamera(const std::string& cameraId) noexcept;
    void shutdown() noexcept;
    nlohmann::json statusJson() const;

private:
    struct Session;

    std::shared_ptr<Session> findSessionLocked(const std::string& cameraId) const;
    void stopSession(const std::shared_ptr<Session>& session) noexcept;

    RuntimePaths paths_;
    perceptrum::runtime::IRuntimeLogger* logger_ = nullptr;
    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::shared_ptr<Session>> sessions_;
};

} // namespace perceptrum::linux_runtime

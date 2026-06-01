#pragma once

#include "AgentCoreStatusContract.h"

#include <memory>
#include <string>
#include <string_view>

namespace perceptrum::runtime {

struct AgentRuntimeStatus {
    bool enabled = false;
    bool running = false;
    bool agentCoreEnabled = false;
    bool agentCorePartial = false;
    bool cameraCaptureEnabled = false;
    bool rtspCaptureEnabled = false;
    bool jobRuntimeEnabled = false;
    bool frameWriterEnabled = false;
    bool rootsValid = false;
    bool brandingValid = false;
    bool configLoaded = false;
    bool lightweightDependenciesAvailable = false;
    bool rtspCameraConfigured = false;
    bool rtspCameraStarted = false;
    bool rtspThumbnailGenerated = false;
    bool rtspEventPublished = false;
    bool cameraRecordingClipGenerated = false;
    std::string mode = "linux_minimal";
    std::string runtimeName = "linux_minimal_agent_runtime";
    std::string integrationStatus = "linux_minimal_runtime_ready";
    std::string error;
    std::string unsupportedFeatureGate;
    std::string rtspCameraId;
    std::string rtspCameraName;
    std::string rtspThumbnailPath;
    std::string rtspEventPath;
    std::string rtspLastError;
    std::string cameraThumbnailRoot;
    std::string cameraRecordingsRoot;
    std::string cameraRecordingClipPaths;
    std::string cameraRecordingProfiles;
    std::string inferenceTempRoot;
    std::string jobsInferenceTempRoot;
    std::string jobRuntimeLastCommandType;
    std::string jobRuntimeLastError;
    std::string jobRuntimeLlmProvider;
    std::string cameraSessionStatusJson;
    int jobRuntimeCommandsPolled = 0;
    int jobRuntimeCommandsCompleted = 0;
    int jobRuntimeCommandsFailed = 0;
    std::string agentCorePathAdapter;
    std::string agentCoreHttpClient;
    std::string agentCoreClock;
    std::string agentCoreLifecycle;
    AgentCoreStatusContract agentCoreStatus;
};

class IAgentRuntime {
public:
    virtual ~IAgentRuntime() = default;

    virtual bool start() = 0;
    virtual void stop() noexcept = 0;
    virtual AgentRuntimeStatus status() const = 0;
};

class IAgentCoreFactory {
public:
    virtual ~IAgentCoreFactory() = default;

    virtual std::unique_ptr<IAgentRuntime> create(
        std::string_view baseUrl,
        std::string_view exeToken,
        std::string_view clientId) = 0;
};

} // namespace perceptrum::runtime

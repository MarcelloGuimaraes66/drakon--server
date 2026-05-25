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

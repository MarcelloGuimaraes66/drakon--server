#include "AgentCorePortable.h"

#include <utility>

namespace {

perceptrum::runtime::AgentCoreCapabilityStatus AvailableCapability(const char* name)
{
    return {
        name,
        true,
        false,
        {},
        {},
    };
}

perceptrum::runtime::AgentCoreCapabilityStatus GateBlockedCapability(
    const char* name,
    const char* gateName,
    const char* reason)
{
    return {
        name,
        false,
        true,
        gateName,
        reason,
    };
}

bool PathEmpty(const std::filesystem::path& path)
{
    return path.empty();
}

} // namespace

namespace perceptrum::core {

perceptrum::runtime::AgentCoreStatusContract BuildPortableAgentCoreStatus(
    std::string configSource,
    bool configLoaded,
    bool configValid,
    std::string blockedReason)
{
    perceptrum::runtime::AgentCoreStatusContract status;
    status.providerName = "linux_portable_agentcore_status_provider";
    status.contractVersion = "agentcore.status.v1";
    status.fullAgentCoreActive = true;
    status.partialModeAvailable = false;
    status.blockedReason = std::move(blockedReason);
    status.configSource = std::move(configSource);
    status.configLoaded = configLoaded;
    status.configValid = configValid;
    status.capabilities = {
        AvailableCapability("portable_agent_core"),
        AvailableCapability("portable_paths"),
        AvailableCapability("portable_logging"),
        AvailableCapability("portable_secure_store"),
        AvailableCapability("portable_http_client"),
        AvailableCapability("portable_clock_timezone"),
        AvailableCapability("portable_process_lifecycle"),
        GateBlockedCapability(
            "camera_capture",
            "PERCEPTRUM_ENABLE_CAMERA_CAPTURE",
            "CameraSession is intentionally excluded from the portable Linux AgentCore foundation"),
        GateBlockedCapability(
            "rtsp_capture",
            "PERCEPTRUM_ENABLE_RTSP_CAPTURE",
            "RTSP capture remains outside the portable Linux AgentCore foundation"),
        GateBlockedCapability(
            "frame_writer",
            "PERCEPTRUM_ENABLE_FRAME_WRITER",
            "FrameDiskWriter is intentionally excluded from the portable Linux AgentCore foundation"),
        GateBlockedCapability(
            "job_runtime",
            "PERCEPTRUM_ENABLE_JOB_RUNTIME",
            "JobRuntime is intentionally excluded from the portable Linux AgentCore foundation"),
    };
    return status;
}

AgentCorePortableRuntime::AgentCorePortableRuntime(AgentCorePortableDependencies dependencies)
    : dependencies_(dependencies)
{
    status_.enabled = true;
    status_.agentCoreEnabled = true;
    status_.agentCorePartial = true;
    status_.cameraCaptureEnabled = false;
    status_.rtspCaptureEnabled = false;
    status_.jobRuntimeEnabled = false;
    status_.frameWriterEnabled = false;
    status_.mode = "linux_agentcore_portable";
    status_.runtimeName = "linux_portable_agentcore_runtime";
    status_.integrationStatus = "linux_portable_agentcore_ready";
    status_.agentCoreStatus = BuildPortableAgentCoreStatus("portable_agentcore:uninitialized", false, true);
    status_.agentCorePathAdapter = "linux_agentcore_path_adapter";
    status_.agentCoreHttpClient = "linux_agentcore_curl_http_client";
    status_.agentCoreClock = "linux_agentcore_clock_adapter";
    status_.agentCoreLifecycle = "linux_agentcore_lifecycle_adapter";
}

bool AgentCorePortableRuntime::validateDependencies()
{
    if (dependencies_.paths == nullptr ||
        dependencies_.logger == nullptr ||
        dependencies_.tokenStore == nullptr ||
        dependencies_.pairingConfigStore == nullptr ||
        dependencies_.httpClient == nullptr ||
        dependencies_.clock == nullptr ||
        dependencies_.lifecycle == nullptr) {
        status_.error = "portable_agentcore_dependency_missing";
        status_.integrationStatus = "portable_agentcore_dependency_missing";
        status_.agentCoreStatus = BuildPortableAgentCoreStatus(
            "portable_agentcore:dependencies",
            false,
            false,
            status_.error);
        return false;
    }

    const AgentCorePortableRoots roots = dependencies_.paths->roots();
    if (PathEmpty(roots.dataRoot) ||
        PathEmpty(roots.configRoot) ||
        PathEmpty(roots.cacheRoot) ||
        PathEmpty(roots.stateRoot) ||
        PathEmpty(roots.logRoot)) {
        status_.error = "portable_agentcore_paths_invalid";
        status_.integrationStatus = "portable_agentcore_paths_invalid";
        status_.agentCoreStatus = BuildPortableAgentCoreStatus(
            dependencies_.paths->configSource(),
            false,
            false,
            status_.error);
        return false;
    }

    return true;
}

bool AgentCorePortableRuntime::start()
{
    status_.running = false;
    status_.error.clear();
    status_.unsupportedFeatureGate.clear();
    status_.agentCorePartial = true;

    if (!validateDependencies()) {
        if (dependencies_.logger != nullptr) {
            dependencies_.logger->error("agentcore", status_.error);
        }
        return false;
    }

    std::string configError;
    const auto config = dependencies_.pairingConfigStore->readPairingConfig(&configError);
    const bool configValid = configError.empty();
    if (!configValid) {
        status_.error = "portable_agentcore_config_invalid: " + configError;
        status_.integrationStatus = "portable_agentcore_config_invalid";
        status_.configLoaded = false;
        status_.agentCoreStatus = BuildPortableAgentCoreStatus(
            dependencies_.paths->configSource(),
            false,
            false,
            status_.error);
        dependencies_.logger->error("agentcore", status_.error);
        return false;
    }

    status_.configLoaded = config.has_value();
    status_.lightweightDependenciesAvailable = true;
    status_.rootsValid = true;
    status_.brandingValid = true;
    status_.running = true;
    status_.agentCorePartial = false;
    status_.integrationStatus = "linux_portable_agentcore_running";
    status_.agentCoreStatus = BuildPortableAgentCoreStatus(
        dependencies_.paths->configSource(),
        status_.configLoaded,
        true);

    dependencies_.logger->info(
        "agentcore",
        "portable AgentCore initialized pid=" + std::to_string(dependencies_.clock->processId()) +
            " timezone=" + dependencies_.clock->timezone());
    return true;
}

void AgentCorePortableRuntime::stop() noexcept
{
    status_.running = false;
    if (status_.integrationStatus == "linux_portable_agentcore_running") {
        status_.integrationStatus = "linux_portable_agentcore_stopped";
    }
}

perceptrum::runtime::AgentRuntimeStatus AgentCorePortableRuntime::status() const
{
    return status_;
}

} // namespace perceptrum::core

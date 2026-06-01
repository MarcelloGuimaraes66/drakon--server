#include "AgentCoreStatus.h"

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

} // namespace

namespace perceptrum::core {

perceptrum::runtime::AgentCoreStatusContract BuildLinuxMinimalAgentCoreStatus(
    const AgentCoreLightweightConfigStatus& configStatus)
{
    const std::string defaultBlockedReason =
        "full_agentcore_excluded_from_linux_minimal_build: AgentCore.cpp depends on "
        "Win32, OpenCV, CameraSession, RTSP, FrameDiskWriter and JobRuntime";

    perceptrum::runtime::AgentCoreStatusContract status;
    status.providerName = "linux_minimal_agentcore_status_provider";
    status.contractVersion = "agentcore.status.v1";
    status.fullAgentCoreActive = false;
    status.partialModeAvailable = true;
    status.blockedReason = configStatus.blockedReason.empty()
        ? defaultBlockedReason
        : configStatus.blockedReason;
    status.configSource = configStatus.configSource;
    status.configLoaded = configStatus.configLoaded;
    status.configValid = configStatus.configValid;
    status.capabilities = {
        AvailableCapability("status_config_contract"),
        AvailableCapability("runtime_paths_config"),
        GateBlockedCapability(
            "full_agent_core",
            "PERCEPTRUM_ENABLE_AGENT_CORE",
            "AgentCore.cpp is intentionally outside the Linux minimal target"),
        GateBlockedCapability(
            "camera_capture",
            "PERCEPTRUM_ENABLE_CAMERA_CAPTURE",
            "CameraSession/OpenCV capture is outside the Linux minimal target"),
        GateBlockedCapability(
            "rtsp_capture",
            "PERCEPTRUM_ENABLE_RTSP_CAPTURE",
            "RTSP capture remains behind the Linux feature gate"),
        GateBlockedCapability(
            "frame_writer",
            "PERCEPTRUM_ENABLE_FRAME_WRITER",
            "FrameDiskWriter remains behind the Linux feature gate"),
        GateBlockedCapability(
            "job_runtime",
            "PERCEPTRUM_ENABLE_JOB_RUNTIME",
            "JobRuntime remains behind the Linux feature gate"),
    };
    return status;
}

} // namespace perceptrum::core

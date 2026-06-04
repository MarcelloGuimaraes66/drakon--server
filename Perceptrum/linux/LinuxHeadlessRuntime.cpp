#include "LinuxHeadlessRuntime.h"

#include "LinuxFrameDiskWriter.h"
#include "LinuxRuntimeAdapters.h"

#include "../Perceptrum/core/AgentCoreStatus.h"
#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/runtime/HeadlessService.h"
#include "../Perceptrum/runtime/interfaces/ITokenStore.h"

#include <chrono>
#include <csignal>
#include <fstream>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>

#ifndef PERCEPTRUM_VERSION
#define PERCEPTRUM_VERSION "1.0.0"
#endif

#ifndef PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE
#define PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE 0
#endif
#ifndef PERCEPTRUM_ENABLE_CAMERA_CAPTURE
#define PERCEPTRUM_ENABLE_CAMERA_CAPTURE 0
#endif
#ifndef PERCEPTRUM_ENABLE_RTSP_CAPTURE
#define PERCEPTRUM_ENABLE_RTSP_CAPTURE 0
#endif
#ifndef PERCEPTRUM_ENABLE_FRAME_WRITER
#define PERCEPTRUM_ENABLE_FRAME_WRITER 0
#endif
#ifndef PERCEPTRUM_ENABLE_JOB_RUNTIME
#define PERCEPTRUM_ENABLE_JOB_RUNTIME 0
#endif

namespace {

volatile std::sig_atomic_t g_stopRequested = 0;

void HandleStopSignal(int)
{
    g_stopRequested = 1;
}

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

bool HasReadableExeToken(const perceptrum::runtime::ITokenStore& tokenStore)
{
    const auto token = tokenStore.readToken();
    return token.has_value() && !Trim(*token).empty();
}

bool RtspThumbnailGateSet(const perceptrum::linux_runtime::LinuxFeatureGates& gates)
{
    return gates.cameraCapture &&
        gates.rtspCapture &&
        gates.frameWriter &&
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE != 0 &&
        PERCEPTRUM_ENABLE_RTSP_CAPTURE != 0 &&
        PERCEPTRUM_ENABLE_FRAME_WRITER != 0;
}

bool LinuxJobRuntimeGateSet(const perceptrum::linux_runtime::LinuxFeatureGates& gates)
{
    return gates.jobRuntime && PERCEPTRUM_ENABLE_JOB_RUNTIME != 0;
}

void MarkCapabilityAvailable(
    perceptrum::runtime::AgentRuntimeStatus& status,
    std::string_view capabilityName)
{
    for (auto& capability : status.agentCoreStatus.capabilities) {
        if (capability.name == capabilityName) {
            capability.available = true;
            capability.blockedByGate = false;
            capability.gateName.clear();
            capability.blockedReason.clear();
            return;
        }
    }
}

std::string ResolveSnapshotBaseUrl(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::optional<perceptrum::linux_runtime::AgentConfig>& config)
{
    if (config.has_value() && !config->baseUrl.empty()) {
        return config->baseUrl;
    }

    return perceptrum::linux_runtime::ResolveBaseUrl();
}

std::string ResolveSnapshotStatus(
    const std::optional<perceptrum::linux_runtime::AgentConfig>& config,
    bool configInvalid,
    bool tokenReadable,
    std::string_view overrideStatus,
    bool loopActive,
    const perceptrum::runtime::AgentRuntimeStatus& runtimeStatus)
{
    if (!overrideStatus.empty()) {
        return std::string(overrideStatus);
    }

    if (!runtimeStatus.error.empty()) {
        if (!runtimeStatus.unsupportedFeatureGate.empty()) {
            return "feature_gate_unsupported";
        }
        return runtimeStatus.integrationStatus.empty() ? "runtime_error" : runtimeStatus.integrationStatus;
    }

    if (configInvalid) {
        return "config_invalid";
    }

    if (!config.has_value() || (!config->paired && !config->provisioned)) {
        return "not_paired";
    }

    if (!tokenReadable) {
        return "secure_store_unavailable";
    }

    if (loopActive) {
        return "running";
    }

    if (config->provisioned) {
        return "provisioned";
    }

    return "headless_ready";
}

perceptrum::runtime::AgentRuntimeStatus BuildDefaultLinuxMinimalStatus()
{
    const auto gates = perceptrum::linux_runtime::ResolveLinuxFeatureGates();
    perceptrum::runtime::AgentRuntimeStatus status;
    status.enabled = true;
    status.agentCoreEnabled = false;
    status.agentCorePartial = true;
    status.cameraCaptureEnabled = false;
    status.rtspCaptureEnabled = false;
    status.jobRuntimeEnabled = false;
    status.frameWriterEnabled = false;
    status.mode = "linux_minimal";
    status.runtimeName = "linux_minimal_agent_runtime";
    status.integrationStatus = "linux_minimal_runtime_ready";
    status.agentCoreStatus = perceptrum::core::BuildLinuxMinimalAgentCoreStatus();
    status.agentCorePathAdapter = "linux_runtime_paths_adapter";
    status.agentCoreHttpClient = "not_loaded";
    status.agentCoreClock = "linux_runtime_clock_adapter";
    status.agentCoreLifecycle = "linux_process_lifecycle_adapter";
    const bool rtspThumbnailEnabled = RtspThumbnailGateSet(gates);
    const bool linuxJobRuntimeEnabled = LinuxJobRuntimeGateSet(gates);
    if (rtspThumbnailEnabled) {
        status.cameraCaptureEnabled = true;
        status.rtspCaptureEnabled = true;
        status.frameWriterEnabled = true;
        status.integrationStatus = "linux_rtsp_camera_waiting_for_config";
        status.agentCoreStatus.blockedReason =
            "full_agentcore_excluded_from_linux_minimal_build: Linux is running the gated RTSP thumbnail path only";
        MarkCapabilityAvailable(status, "camera_capture");
        MarkCapabilityAvailable(status, "rtsp_capture");
        MarkCapabilityAvailable(status, "frame_writer");
    }
    if (linuxJobRuntimeEnabled) {
        const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
        status.jobRuntimeEnabled = true;
        status.inferenceTempRoot = perceptrum::linux_runtime::LinuxInferenceTempRoot(paths).string();
        status.jobsInferenceTempRoot = perceptrum::linux_runtime::LinuxJobsInferenceTempRoot(paths).string();
        status.integrationStatus = "linux_job_runtime_ready";
        MarkCapabilityAvailable(status, "job_runtime");
    }
    if (gates.agentCore && !PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE) {
        status.unsupportedFeatureGate = "PERCEPTRUM_ENABLE_AGENT_CORE";
    } else if (gates.cameraCapture && !rtspThumbnailEnabled) {
        status.unsupportedFeatureGate = "PERCEPTRUM_ENABLE_CAMERA_CAPTURE";
    } else if (gates.rtspCapture && !rtspThumbnailEnabled) {
        status.unsupportedFeatureGate = "PERCEPTRUM_ENABLE_RTSP_CAPTURE";
    } else if (gates.jobRuntime && PERCEPTRUM_ENABLE_JOB_RUNTIME == 0) {
        status.unsupportedFeatureGate = "PERCEPTRUM_ENABLE_JOB_RUNTIME";
    } else if (gates.frameWriter && !rtspThumbnailEnabled) {
        status.unsupportedFeatureGate = "PERCEPTRUM_ENABLE_FRAME_WRITER";
    }
    if (!status.unsupportedFeatureGate.empty()) {
        status.integrationStatus = "unsupported_feature_gate";
        status.error = "unsupported_feature_gate: " + status.unsupportedFeatureGate +
            " is not supported by linux_minimal_agent_runtime";
        status.agentCoreStatus.blockedReason = status.error;
    }
    return status;
}

nlohmann::json BuildFeatureGateSnapshot()
{
    const auto gates = perceptrum::linux_runtime::ResolveLinuxFeatureGates();
    return nlohmann::json{
        { "PERCEPTRUM_ENABLE_AGENT_CORE", gates.agentCore },
        { "PERCEPTRUM_ENABLE_CAMERA_CAPTURE", gates.cameraCapture },
        { "PERCEPTRUM_ENABLE_RTSP_CAPTURE", gates.rtspCapture },
        { "PERCEPTRUM_ENABLE_JOB_RUNTIME", gates.jobRuntime },
        { "PERCEPTRUM_ENABLE_FRAME_WRITER", gates.frameWriter },
    };
}

nlohmann::json ParseCameraSessionStatus(std::string_view raw)
{
    if (raw.empty()) {
        return {
            { "active_count", 0 },
            { "active_camera_ids", nlohmann::json::array() },
            { "last_errors_by_camera", nlohmann::json::object() },
            { "last_thumbnail_by_camera", nlohmann::json::object() },
            { "clip_directories_by_camera", nlohmann::json::object() },
            { "ffmpeg_child_pids_by_camera", nlohmann::json::object() },
        };
    }

    nlohmann::json parsed = nlohmann::json::parse(raw, nullptr, false);
    return parsed.is_object() ? parsed : nlohmann::json::object();
}

} // namespace

namespace perceptrum::linux_runtime {

std::string HeadlessIntegrationStatus()
{
    return "headless_blocked_by_platform_coupling";
}

bool IsHeadlessServiceHeaderAvailable()
{
    static_assert(sizeof(PerceptrumCore::HeadlessServiceOptions) > 0);
    return true;
}

void AppendAgentLog(const RuntimePaths& paths, std::string_view message)
{
    LinuxRuntimeLogger logger(paths);
    logger.info("agent", message);
}

nlohmann::json BuildAgentCoreCapabilitiesSnapshot(
    const perceptrum::runtime::AgentCoreStatusContract& status)
{
    nlohmann::json capabilities = nlohmann::json::array();
    for (const auto& capability : status.capabilities) {
        capabilities.push_back({
            { "name", capability.name },
            { "available", capability.available },
            { "blocked_by_gate", capability.blockedByGate },
            { "gate", capability.gateName },
            { "blocked_reason", capability.blockedReason },
        });
    }
    return capabilities;
}

nlohmann::json BuildHeadlessHealthSnapshotWithTokenStore(
    const RuntimePaths& paths,
    const perceptrum::runtime::ITokenStore& tokenStore,
    std::string_view overrideStatus,
    bool loopActive,
    const perceptrum::runtime::AgentRuntimeStatus* runtimeStatus)
{
    const auto defaultStatus = BuildDefaultLinuxMinimalStatus();
    const auto& agentStatus = runtimeStatus != nullptr ? *runtimeStatus : defaultStatus;
    const nlohmann::json cameraSessions = ParseCameraSessionStatus(agentStatus.cameraSessionStatusJson);
    std::string configError;
    const auto config = ReadAgentConfig(paths, &configError);
    const bool configInvalid = !configError.empty();
    const bool tokenReadable = config.has_value() && (config->paired || config->provisioned)
        ? HasReadableExeToken(tokenStore)
        : false;
    const std::string status = ResolveSnapshotStatus(
        config,
        configInvalid,
        tokenReadable,
        overrideStatus,
        loopActive,
        agentStatus);

    const std::string timezone = config.has_value() && !config->timezone.empty()
        ? config->timezone
        : RuntimeTimezone();

    return nlohmann::json{
        { "version", PERCEPTRUM_VERSION },
        { "status", status },
        { "paired", config.has_value() && config->paired },
        { "provisioned", config.has_value() && config->provisioned },
        { "base_url", RedactSensitiveRuntimeText(ResolveSnapshotBaseUrl(paths, config)) },
        { "client_id", config.has_value() ? config->clientId : "" },
        { "exe_id", config.has_value() ? config->exeId : "" },
        { "pid", CurrentProcessId() },
        { "heartbeat_unix_ms", UnixTimeMillisecondsNow() },
        { "heartbeat_utc", UtcTimestampNow() },
        { "runtime_timezone", timezone },
        { "data_root", paths.dataRoot.string() },
        { "config_root", paths.configRoot.string() },
        { "cache_root", paths.cacheRoot.string() },
        { "state_root", paths.stateRoot.string() },
        { "log_root", paths.logRoot.string() },
        { "secure_store_available", tokenReadable },
        { "config_error", configInvalid ? configError : "" },
        { "runtime_mode", agentStatus.mode },
        { "headless_service", "linux_headless_runtime_adapter" },
        { "headless_service_header_available", IsHeadlessServiceHeaderAvailable() },
        { "runtime_logger", "linux_runtime_logger_adapter" },
        { "token_store", "linux_token_store_adapter" },
        { "agent_runtime", agentStatus.runtimeName },
        { "headless_ready", agentStatus.running && agentStatus.error.empty() },
        { "headless_integration_status", RedactSensitiveRuntimeText(agentStatus.integrationStatus.empty() ? HeadlessIntegrationStatus() : agentStatus.integrationStatus) },
        { "agent_runtime_enabled", agentStatus.enabled },
        { "agent_runtime_running", agentStatus.running },
        { "agent_core_enabled", agentStatus.agentCoreEnabled },
        { "agent_core_partial", agentStatus.agentCorePartial },
        { "agent_core_status_provider", agentStatus.agentCoreStatus.providerName },
        { "agent_core_contract_version", agentStatus.agentCoreStatus.contractVersion },
        { "agent_core_blocked_reason", RedactSensitiveRuntimeText(agentStatus.agentCoreStatus.blockedReason) },
        { "agent_core_config_source", agentStatus.agentCoreStatus.configSource },
        { "agent_core_config_loaded", agentStatus.agentCoreStatus.configLoaded },
        { "agent_core_config_valid", agentStatus.agentCoreStatus.configValid },
        { "agent_core_path_adapter", agentStatus.agentCorePathAdapter },
        { "agent_core_http_client", agentStatus.agentCoreHttpClient },
        { "agent_core_clock", agentStatus.agentCoreClock },
        { "agent_core_lifecycle", agentStatus.agentCoreLifecycle },
        { "agent_core_capabilities", BuildAgentCoreCapabilitiesSnapshot(agentStatus.agentCoreStatus) },
        { "camera_capture_enabled", agentStatus.cameraCaptureEnabled },
        { "rtsp_capture_enabled", agentStatus.rtspCaptureEnabled },
        { "rtsp_camera_configured", agentStatus.rtspCameraConfigured },
        { "rtsp_camera_started", agentStatus.rtspCameraStarted },
        { "rtsp_camera_id", RedactSensitiveRuntimeText(agentStatus.rtspCameraId) },
        { "rtsp_camera_name", RedactSensitiveRuntimeText(agentStatus.rtspCameraName) },
        { "rtsp_thumbnail_generated", agentStatus.rtspThumbnailGenerated },
        { "rtsp_thumbnail_path", agentStatus.rtspThumbnailPath },
        { "rtsp_event_published", agentStatus.rtspEventPublished },
        { "rtsp_event_path", agentStatus.rtspEventPath },
        { "rtsp_last_error", RedactSensitiveRuntimeText(agentStatus.rtspLastError) },
        { "camera_thumbnail_root", agentStatus.cameraThumbnailRoot },
        { "camera_recordings_root", agentStatus.cameraRecordingsRoot },
        { "camera_recording_clip_generated", agentStatus.cameraRecordingClipGenerated },
        { "camera_recording_clip_paths", agentStatus.cameraRecordingClipPaths },
        { "camera_recording_profiles", agentStatus.cameraRecordingProfiles },
        { "linux_camera_sessions", cameraSessions },
        { "active_camera_sessions", cameraSessions.value("active_camera_ids", nlohmann::json::array()) },
        { "camera_session_last_errors", cameraSessions.value("last_errors_by_camera", nlohmann::json::object()) },
        { "camera_session_last_thumbnails", cameraSessions.value("last_thumbnail_by_camera", nlohmann::json::object()) },
        { "camera_session_clip_directories", cameraSessions.value("clip_directories_by_camera", nlohmann::json::object()) },
        { "camera_session_ffmpeg_child_pids", cameraSessions.value("ffmpeg_child_pids_by_camera", nlohmann::json::object()) },
        { "inference_temp_root", agentStatus.inferenceTempRoot },
        { "jobs_inference_temp_root", agentStatus.jobsInferenceTempRoot },
        { "job_runtime_enabled", agentStatus.jobRuntimeEnabled },
        { "job_runtime_last_command_type", agentStatus.jobRuntimeLastCommandType },
        { "job_runtime_last_error", RedactSensitiveRuntimeText(agentStatus.jobRuntimeLastError) },
        { "job_runtime_llm_provider", agentStatus.jobRuntimeLlmProvider },
        { "job_runtime_commands_polled", agentStatus.jobRuntimeCommandsPolled },
        { "job_runtime_commands_completed", agentStatus.jobRuntimeCommandsCompleted },
        { "job_runtime_commands_failed", agentStatus.jobRuntimeCommandsFailed },
        { "frame_writer_enabled", agentStatus.frameWriterEnabled },
        { "runtime_roots_valid", agentStatus.rootsValid },
        { "branding_valid", agentStatus.brandingValid },
        { "config_loaded", agentStatus.configLoaded },
        { "lightweight_dependencies_available", agentStatus.lightweightDependenciesAvailable },
        { "feature_gates", BuildFeatureGateSnapshot() },
        { "unsupported_feature_gate", agentStatus.unsupportedFeatureGate },
        { "runtime_error", RedactSensitiveRuntimeText(agentStatus.error) },
    };
}

nlohmann::json BuildHeadlessHealthSnapshot(
    const RuntimePaths& paths,
    std::string_view overrideStatus,
    bool loopActive,
    const perceptrum::runtime::AgentRuntimeStatus* runtimeStatus)
{
    LinuxTokenStore tokenStore(paths);
    return BuildHeadlessHealthSnapshotWithTokenStore(paths, tokenStore, overrideStatus, loopActive, runtimeStatus);
}

bool WriteHeadlessHealthSnapshot(
    const RuntimePaths& paths,
    std::string& errorMessage,
    std::string_view overrideStatus,
    bool loopActive,
    const perceptrum::runtime::AgentRuntimeStatus* runtimeStatus)
{
    errorMessage.clear();

    std::ofstream stream(HealthSnapshotPath(paths), std::ios::binary | std::ios::trunc);
    if (!stream.is_open()) {
        errorMessage = "Failed to open agent_health.json for writing.";
        return false;
    }

    stream << BuildHeadlessHealthSnapshot(paths, overrideStatus, loopActive, runtimeStatus).dump(2) << '\n';
    if (!stream.good()) {
        errorMessage = "Failed to write agent_health.json.";
        return false;
    }

    return true;
}

std::optional<nlohmann::json> ReadHeadlessHealthSnapshot(
    const RuntimePaths& paths,
    std::string& errorMessage)
{
    errorMessage.clear();

    std::ifstream stream(HealthSnapshotPath(paths), std::ios::binary);
    if (!stream.is_open()) {
        errorMessage = "No health snapshot found at " + HealthSnapshotPath(paths).string();
        return std::nullopt;
    }

    nlohmann::json snapshot = nlohmann::json::parse(stream, nullptr, false);
    if (snapshot.is_discarded() || !snapshot.is_object()) {
        errorMessage = "Health snapshot is not valid JSON.";
        return std::nullopt;
    }

    return snapshot;
}

int RunLinuxHeadlessRuntime()
{
    g_stopRequested = 0;

    const auto paths = ResolveRuntimePaths();
    std::string errorMessage;
    if (!EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    std::signal(SIGINT, HandleStopSignal);
    std::signal(SIGTERM, HandleStopSignal);

    LinuxRuntimeLogger logger(paths);
    LinuxMinimalAgentCoreFactory agentFactory(paths, &logger);
    auto agentRuntime = agentFactory.create("", "", "");

    logger.info("agent", "perceptrum-agent starting linux minimal agent runtime");
    logger.info("agent", "AgentCore/camera/RTSP/jobs/frame writer are disabled by default feature gates");

    if (!agentRuntime || !agentRuntime->start()) {
        const auto status = agentRuntime ? agentRuntime->status() : BuildDefaultLinuxMinimalStatus();
        const std::string error = status.error.empty()
            ? "linux_minimal_agent_runtime failed to start"
            : status.error;
        const std::string snapshotStatus = status.unsupportedFeatureGate.empty()
            ? "runtime_error"
            : "feature_gate_unsupported";
        logger.error("agent", error);
        (void)WriteHeadlessHealthSnapshot(paths, errorMessage, snapshotStatus, false, &status);
        std::cerr << error << '\n';
        return status.unsupportedFeatureGate.empty() ? 1 : 78;
    }

    while (!g_stopRequested) {
        const auto status = agentRuntime->status();
        if (!WriteHeadlessHealthSnapshot(paths, errorMessage, {}, true, &status)) {
            std::cerr << errorMessage << '\n';
            logger.error("agent", "failed to write health snapshot");
            return 1;
        }

        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    agentRuntime->stop();
    const auto stoppedStatus = agentRuntime->status();
    if (!WriteHeadlessHealthSnapshot(paths, errorMessage, "stopped", false, &stoppedStatus)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    logger.info("agent", "perceptrum-agent stopped linux minimal agent runtime");
    return 0;
}

} // namespace perceptrum::linux_runtime

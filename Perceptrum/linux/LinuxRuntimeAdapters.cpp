#include "LinuxRuntimeAdapters.h"

#include "LinuxRtspThumbnailProbe.h"

#include "../Perceptrum/core/AgentCoreStatus.h"
#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_secure_store.h"
#include "../Perceptrum/runtime/BrandingRuntime.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <fstream>
#include <utility>

#ifndef PERCEPTRUM_ENABLE_AGENT_CORE
#define PERCEPTRUM_ENABLE_AGENT_CORE 0
#endif

#ifndef PERCEPTRUM_ENABLE_CAMERA_CAPTURE
#define PERCEPTRUM_ENABLE_CAMERA_CAPTURE 0
#endif

#ifndef PERCEPTRUM_ENABLE_RTSP_CAPTURE
#define PERCEPTRUM_ENABLE_RTSP_CAPTURE 0
#endif

#ifndef PERCEPTRUM_ENABLE_JOB_RUNTIME
#define PERCEPTRUM_ENABLE_JOB_RUNTIME 0
#endif

#ifndef PERCEPTRUM_ENABLE_FRAME_WRITER
#define PERCEPTRUM_ENABLE_FRAME_WRITER 0
#endif

namespace {

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

bool ParseBoolFeatureGate(const char* name, bool compileDefault)
{
    std::string value = perceptrum::platform::ReadEnvVar(name);
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });

    if (value == "1" || value == "true" || value == "yes" || value == "on") {
        return true;
    }
    if (value == "0" || value == "false" || value == "no" || value == "off") {
        return false;
    }
    return compileDefault;
}

void SetUnsupportedGate(
    perceptrum::runtime::AgentRuntimeStatus& status,
    std::string_view gateName)
{
    if (!status.unsupportedFeatureGate.empty()) {
        return;
    }

    status.unsupportedFeatureGate = std::string(gateName);
    status.error = "unsupported_feature_gate: " + status.unsupportedFeatureGate +
        " is not supported by linux_minimal_agent_runtime";
    status.integrationStatus = "unsupported_feature_gate";
}

bool RtspThumbnailGateSet(const perceptrum::linux_runtime::LinuxFeatureGates& gates)
{
    return gates.cameraCapture && gates.rtspCapture && gates.frameWriter;
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

void ApplyRtspThumbnailStatus(
    perceptrum::runtime::AgentRuntimeStatus& status,
    const perceptrum::linux_runtime::LinuxRtspThumbnailResult& result)
{
    status.rtspCameraConfigured = result.configured;
    status.rtspCameraStarted = result.cameraStarted;
    status.rtspThumbnailGenerated = result.thumbnailGenerated;
    status.rtspEventPublished = result.eventPublished;
    status.rtspCameraId = result.cameraId;
    status.rtspCameraName = result.cameraName;
    status.rtspThumbnailPath = result.thumbnailPath;
    status.rtspEventPath = result.eventPath;
    status.rtspLastError = result.error;

    if (result.configured) {
        status.integrationStatus = result.thumbnailGenerated
            ? "linux_rtsp_thumbnail_ready"
            : "linux_rtsp_thumbnail_unavailable";
    } else {
        status.integrationStatus = "linux_rtsp_camera_waiting_for_config";
    }
}

} // namespace

namespace perceptrum::linux_runtime {

LinuxFeatureGates ResolveLinuxFeatureGates()
{
    return {
        ParseBoolFeatureGate("PERCEPTRUM_ENABLE_AGENT_CORE", PERCEPTRUM_ENABLE_AGENT_CORE != 0),
        ParseBoolFeatureGate("PERCEPTRUM_ENABLE_CAMERA_CAPTURE", PERCEPTRUM_ENABLE_CAMERA_CAPTURE != 0),
        ParseBoolFeatureGate("PERCEPTRUM_ENABLE_RTSP_CAPTURE", PERCEPTRUM_ENABLE_RTSP_CAPTURE != 0),
        ParseBoolFeatureGate("PERCEPTRUM_ENABLE_JOB_RUNTIME", PERCEPTRUM_ENABLE_JOB_RUNTIME != 0),
        ParseBoolFeatureGate("PERCEPTRUM_ENABLE_FRAME_WRITER", PERCEPTRUM_ENABLE_FRAME_WRITER != 0),
    };
}

LinuxRuntimeLogger::LinuxRuntimeLogger(RuntimePaths paths)
    : paths_(std::move(paths))
{
}

void LinuxRuntimeLogger::debug(std::string_view component, std::string_view message) noexcept
{
    write("DEBUG", component, message);
}

void LinuxRuntimeLogger::info(std::string_view component, std::string_view message) noexcept
{
    write("INFO", component, message);
}

void LinuxRuntimeLogger::warn(std::string_view component, std::string_view message) noexcept
{
    write("WARN", component, message);
}

void LinuxRuntimeLogger::error(std::string_view component, std::string_view message) noexcept
{
    write("ERROR", component, message);
}

void LinuxRuntimeLogger::write(
    std::string_view level,
    std::string_view component,
    std::string_view message) noexcept
{
    try {
        std::ofstream stream(AgentLogPath(paths_), std::ios::app);
        if (!stream.is_open()) {
            return;
        }

        stream << UtcTimestampNow() << ' '
               << '[' << level << "] "
               << '[' << component << "] "
               << message << '\n';
    } catch (...) {
    }
}

LinuxTokenStore::LinuxTokenStore(RuntimePaths paths)
    : paths_(std::move(paths))
{
}

std::optional<std::string> LinuxTokenStore::readToken() const
{
    const auto token = perceptrum::platform::ReadProtectedLocalText(ExeTokenSecretPath(paths_));
    if (!token.has_value()) {
        return std::nullopt;
    }

    const std::string trimmed = Trim(*token);
    return trimmed.empty() ? std::nullopt : std::optional<std::string>(trimmed);
}

bool LinuxTokenStore::writeToken(std::string_view token)
{
    return perceptrum::platform::WriteProtectedLocalText(ExeTokenSecretPath(paths_), token);
}

bool LinuxTokenStore::hasToken() const
{
    return readToken().has_value();
}

void LinuxTokenStore::clearToken() noexcept
{
    perceptrum::platform::RemoveProtectedLocalText(ExeTokenSecretPath(paths_));
}

LinuxPairingConfigStore::LinuxPairingConfigStore(RuntimePaths paths)
    : paths_(std::move(paths))
{
}

std::optional<perceptrum::runtime::PairingConfig> LinuxPairingConfigStore::readPairingConfig(
    std::string* errorMessage) const
{
    const auto agentConfig = ReadAgentConfig(paths_, errorMessage);
    if (!agentConfig.has_value()) {
        return std::nullopt;
    }

    perceptrum::runtime::PairingConfig config;
    config.baseUrl = agentConfig->baseUrl;
    config.clientId = agentConfig->clientId;
    config.exeId = agentConfig->exeId;
    config.timezone = agentConfig->timezone;
    config.state = agentConfig->state;
    config.createdUtc = agentConfig->createdUtc;
    config.updatedUtc = agentConfig->updatedUtc;
    config.lastBackendStatus = agentConfig->lastBackendStatus;
    config.paired = agentConfig->paired;
    config.provisioned = agentConfig->provisioned;
    return config;
}

bool LinuxPairingConfigStore::writePairingConfig(
    const perceptrum::runtime::PairingConfig& config,
    std::string* errorMessage)
{
    AgentConfig agentConfig;
    agentConfig.baseUrl = config.baseUrl;
    agentConfig.clientId = config.clientId;
    agentConfig.exeId = config.exeId;
    agentConfig.timezone = config.timezone;
    agentConfig.state = config.state;
    agentConfig.createdUtc = config.createdUtc;
    agentConfig.updatedUtc = config.updatedUtc;
    agentConfig.lastBackendStatus = config.lastBackendStatus;
    agentConfig.paired = config.paired;
    agentConfig.provisioned = config.provisioned;

    return WriteAgentConfig(paths_, agentConfig, errorMessage) &&
        PersistNonSensitiveCompatibilityFiles(paths_, agentConfig, errorMessage);
}

LinuxMinimalAgentRuntime::LinuxMinimalAgentRuntime(
    RuntimePaths paths,
    perceptrum::runtime::IRuntimeLogger* logger)
    : paths_(std::move(paths))
    , logger_(logger)
    , gates_(ResolveLinuxFeatureGates())
{
    status_.enabled = true;
    status_.agentCoreEnabled = false;
    status_.agentCorePartial = true;
    status_.cameraCaptureEnabled = false;
    status_.rtspCaptureEnabled = false;
    status_.jobRuntimeEnabled = false;
    status_.frameWriterEnabled = false;
    status_.mode = "linux_minimal";
    status_.runtimeName = "linux_minimal_agent_runtime";
    status_.integrationStatus = "linux_minimal_runtime_ready";
    status_.agentCoreStatus = perceptrum::core::BuildLinuxMinimalAgentCoreStatus();
}

bool LinuxMinimalAgentRuntime::validateLightweightDependency(std::string_view executableName)
{
    const auto resolved = perceptrum::platform::SearchExecutableInPath(std::filesystem::path(std::string(executableName)));
    return !resolved.empty() && resolved != std::filesystem::path(std::string(executableName));
}

bool LinuxMinimalAgentRuntime::start()
{
    status_.running = false;
    status_.error.clear();
    status_.unsupportedFeatureGate.clear();
    status_.rtspCameraConfigured = false;
    status_.rtspCameraStarted = false;
    status_.rtspThumbnailGenerated = false;
    status_.rtspEventPublished = false;
    status_.rtspCameraId.clear();
    status_.rtspCameraName.clear();
    status_.rtspThumbnailPath.clear();
    status_.rtspEventPath.clear();
    status_.rtspLastError.clear();
    status_.agentCoreStatus = perceptrum::core::BuildLinuxMinimalAgentCoreStatus();

    std::string errorMessage;
    status_.rootsValid = EnsureRuntimeDirectories(paths_, &errorMessage);
    if (!status_.rootsValid) {
        status_.error = errorMessage;
        status_.integrationStatus = "runtime_roots_invalid";
        if (logger_ != nullptr) {
            logger_->error("agent", "LinuxMinimalAgentRuntime: runtime roots invalid");
        }
        return false;
    }

    status_.brandingValid =
        !static_cast<std::string_view>(AppBrand::kBrandId).empty() &&
        !static_cast<std::string_view>(AppBrand::kDisplayName).empty();
    if (!status_.brandingValid) {
        status_.error = "branding_invalid: brand id or display name is empty";
        status_.integrationStatus = "branding_invalid";
        if (logger_ != nullptr) {
            logger_->error("agent", "LinuxMinimalAgentRuntime: branding invalid");
        }
        return false;
    }

    std::string configError;
    const auto config = ReadAgentConfig(paths_, &configError);
    if (!configError.empty()) {
        status_.error = "config_invalid: " + configError;
        status_.integrationStatus = "config_invalid";
        status_.agentCoreStatus = perceptrum::core::BuildLinuxMinimalAgentCoreStatus({
            "runtime_paths:agent_config.json",
            false,
            false,
            status_.error,
        });
        if (logger_ != nullptr) {
            logger_->error("agent", "LinuxMinimalAgentRuntime: config invalid");
        }
        return false;
    }
    status_.configLoaded = config.has_value();
    status_.agentCoreStatus = perceptrum::core::BuildLinuxMinimalAgentCoreStatus({
        "runtime_paths:agent_config.json",
        status_.configLoaded,
        true,
        {},
    });

    bool dependenciesAvailable = true;
    constexpr std::array<std::string_view, 3> kLightweightDependencies = {
        "ffmpeg",
        "ffprobe",
        "node",
    };
    for (const std::string_view dependency : kLightweightDependencies) {
        dependenciesAvailable = validateLightweightDependency(dependency) && dependenciesAvailable;
    }
    status_.lightweightDependenciesAvailable = dependenciesAvailable;
    if (!dependenciesAvailable) {
        status_.error = "dependency_unavailable: ffmpeg, ffprobe and node must be available in PATH";
        status_.integrationStatus = "dependency_unavailable";
        if (logger_ != nullptr) {
            logger_->error("agent", "LinuxMinimalAgentRuntime: lightweight dependency missing");
        }
        return false;
    }

    const bool rtspThumbnailEnabled = RtspThumbnailGateSet(gates_);
    if (rtspThumbnailEnabled) {
        status_.cameraCaptureEnabled = true;
        status_.rtspCaptureEnabled = true;
        status_.frameWriterEnabled = true;
        MarkCapabilityAvailable(status_, "camera_capture");
        MarkCapabilityAvailable(status_, "rtsp_capture");
        MarkCapabilityAvailable(status_, "frame_writer");
        status_.agentCoreStatus.blockedReason =
            "full_agentcore_excluded_from_linux_minimal_build: Linux is running the gated RTSP thumbnail path only";
    }

    if (gates_.agentCore) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_AGENT_CORE");
    }
    if (gates_.cameraCapture && !rtspThumbnailEnabled) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_CAMERA_CAPTURE");
    }
    if (gates_.rtspCapture && !rtspThumbnailEnabled) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_RTSP_CAPTURE");
    }
    if (gates_.jobRuntime) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_JOB_RUNTIME");
    }
    if (gates_.frameWriter && !rtspThumbnailEnabled) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_FRAME_WRITER");
    }

    if (!status_.unsupportedFeatureGate.empty()) {
        status_.agentCoreStatus.blockedReason = status_.error;
        if (logger_ != nullptr) {
            logger_->error("agent", status_.error);
        }
        return false;
    }

    if (rtspThumbnailEnabled) {
        std::string cameraConfigError;
        const auto cameraConfig = ResolveLinuxRtspCameraConfig(paths_, &cameraConfigError);
        if (!cameraConfigError.empty()) {
            status_.rtspLastError = "rtsp_config_invalid: " + cameraConfigError;
            status_.integrationStatus = "linux_rtsp_config_invalid";
            if (logger_ != nullptr) {
                logger_->error("agent", status_.rtspLastError);
            }
        } else if (cameraConfig.has_value()) {
            const LinuxRtspThumbnailResult result = RunLinuxRtspThumbnailProbe(paths_, *cameraConfig);
            ApplyRtspThumbnailStatus(status_, result);
            if (logger_ != nullptr) {
                if (result.thumbnailGenerated) {
                    logger_->info("agent", "Linux RTSP thumbnail generated at " + result.thumbnailPath);
                } else {
                    logger_->warn("agent", "Linux RTSP thumbnail unavailable: " + result.error);
                }
            }
        } else {
            LinuxRtspThumbnailResult result;
            result.configured = false;
            ApplyRtspThumbnailStatus(status_, result);
            if (logger_ != nullptr) {
                logger_->warn("agent", "Linux RTSP thumbnail gates enabled but no RTSP camera config found");
            }
        }
    }

    status_.running = true;
    if (status_.integrationStatus == "linux_minimal_runtime_ready") {
        status_.integrationStatus = "linux_minimal_runtime_running";
    }
    if (logger_ != nullptr) {
        logger_->info("agent", "LinuxMinimalAgentRuntime: started with heavy feature gates disabled");
    }
    return true;
}

void LinuxMinimalAgentRuntime::stop() noexcept
{
    status_.running = false;
    if (status_.integrationStatus == "linux_minimal_runtime_running") {
        status_.integrationStatus = "linux_minimal_runtime_stopped";
    }
}

perceptrum::runtime::AgentRuntimeStatus LinuxMinimalAgentRuntime::status() const
{
    return status_;
}

LinuxMinimalAgentCoreFactory::LinuxMinimalAgentCoreFactory(
    RuntimePaths paths,
    perceptrum::runtime::IRuntimeLogger* logger)
    : paths_(std::move(paths))
    , logger_(logger)
{
}

std::unique_ptr<perceptrum::runtime::IAgentRuntime> LinuxMinimalAgentCoreFactory::create(
    std::string_view baseUrl,
    std::string_view exeToken,
    std::string_view clientId)
{
    (void)baseUrl;
    (void)exeToken;
    (void)clientId;
    return std::make_unique<LinuxMinimalAgentRuntime>(paths_, logger_);
}

perceptrum::runtime::RuntimeRoots ToRuntimeRoots(const RuntimePaths& paths)
{
    return {
        paths.dataRoot,
        paths.configRoot,
        paths.cacheRoot,
        paths.stateRoot,
        paths.logRoot,
    };
}

} // namespace perceptrum::linux_runtime

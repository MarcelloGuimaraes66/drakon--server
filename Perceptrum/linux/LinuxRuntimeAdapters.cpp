#include "LinuxRuntimeAdapters.h"

#include "LinuxFrameDiskWriter.h"
#include "LinuxJobRuntime.h"
#include "LinuxRtspThumbnailProbe.h"

#include "../Perceptrum/core/AgentCorePortable.h"
#include "../Perceptrum/core/AgentCoreStatus.h"
#include "../Perceptrum/orchestrator/HttpUtils.h"
#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_secure_store.h"
#include "../Perceptrum/runtime/BrandingRuntime.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <fstream>
#include <string_view>
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

#ifndef PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE
#define PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE 0
#endif

namespace {

std::string Trim(std::string value)
{
    return perceptrum::platform::TrimAscii(std::move(value));
}

bool ParseBoolFeatureGate(const char* name, bool compileDefault)
{
    (void)compileDefault;
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
    return false;
}

bool IsTokenBoundary(char ch)
{
    const unsigned char uch = static_cast<unsigned char>(ch);
    return std::isalnum(uch) == 0 && ch != '_' && ch != '-';
}

std::string ToLowerAscii(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

size_t FindInsensitive(const std::string& text, std::string_view needle, size_t start)
{
    if (needle.empty() || start >= text.size()) {
        return std::string::npos;
    }

    const std::string loweredText = ToLowerAscii(text);
    const std::string loweredNeedle = ToLowerAscii(std::string(needle));
    return loweredText.find(loweredNeedle, start);
}

void MaskHeaderValue(std::string& text, std::string_view headerName)
{
    size_t pos = 0;
    while ((pos = FindInsensitive(text, headerName, pos)) != std::string::npos) {
        size_t cursor = pos + headerName.size();
        while (cursor < text.size() && std::isspace(static_cast<unsigned char>(text[cursor])) != 0) {
            ++cursor;
        }
        if (cursor >= text.size() || text[cursor] != ':') {
            pos += headerName.size();
            continue;
        }
        ++cursor;
        while (cursor < text.size() && std::isspace(static_cast<unsigned char>(text[cursor])) != 0) {
            ++cursor;
        }

        size_t end = text.find_first_of("\r\n", cursor);
        if (end == std::string::npos) {
            end = text.size();
        }
        if (end > cursor) {
            text.replace(cursor, end - cursor, "****");
            pos = cursor + 4;
        } else {
            pos = cursor;
        }
    }
}

void MaskDelimitedKeyValue(std::string& text, std::string_view key)
{
    size_t pos = 0;
    while ((pos = FindInsensitive(text, key, pos)) != std::string::npos) {
        const bool beforeOk =
            pos == 0 ||
            IsTokenBoundary(text[pos - 1]) ||
            text[pos - 1] == '"' ||
            text[pos - 1] == '\'';
        if (!beforeOk) {
            pos += key.size();
            continue;
        }

        size_t cursor = pos + key.size();
        if (cursor < text.size() && (text[cursor] == '"' || text[cursor] == '\'')) {
            ++cursor;
        }
        while (cursor < text.size() && std::isspace(static_cast<unsigned char>(text[cursor])) != 0) {
            ++cursor;
        }
        if (cursor >= text.size() || (text[cursor] != ':' && text[cursor] != '=')) {
            pos += key.size();
            continue;
        }
        ++cursor;
        while (cursor < text.size() && std::isspace(static_cast<unsigned char>(text[cursor])) != 0) {
            ++cursor;
        }

        const bool quoted = cursor < text.size() && (text[cursor] == '"' || text[cursor] == '\'');
        const char quote = quoted ? text[cursor++] : '\0';
        const size_t valueStart = cursor;
        size_t valueEnd = valueStart;
        if (quoted) {
            bool escaped = false;
            while (valueEnd < text.size()) {
                const char ch = text[valueEnd];
                if (escaped) {
                    escaped = false;
                } else if (ch == '\\') {
                    escaped = true;
                } else if (ch == quote) {
                    break;
                }
                ++valueEnd;
            }
        } else {
            valueEnd = text.find_first_of(" \t\r\n,;&|)]}\"'", valueStart);
            if (valueEnd == std::string::npos) {
                valueEnd = text.size();
            }
        }

        if (valueEnd > valueStart) {
            text.replace(valueStart, valueEnd - valueStart, "****");
            pos = valueStart + 4;
        } else {
            pos = cursor;
        }
    }
}

void RedactUrlUserInfoForScheme(std::string& text, std::string_view scheme)
{
    size_t pos = 0;
    while ((pos = FindInsensitive(text, scheme, pos)) != std::string::npos) {
        const size_t authorityStart = pos + scheme.size();
        size_t authorityEnd = text.find_first_of("/?# \t\r\n\"'<>|,)]}", authorityStart);
        if (authorityEnd == std::string::npos) {
            authorityEnd = text.size();
        }
        const size_t at = text.find('@', authorityStart);
        if (at != std::string::npos && at < authorityEnd) {
            text.replace(authorityStart, at - authorityStart, "***:***");
            pos = authorityStart + 7;
        } else {
            pos = authorityEnd;
        }
    }
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
    return gates.cameraCapture &&
        gates.rtspCapture &&
        gates.frameWriter &&
        PERCEPTRUM_ENABLE_CAMERA_CAPTURE != 0 &&
        PERCEPTRUM_ENABLE_RTSP_CAPTURE != 0 &&
        PERCEPTRUM_ENABLE_FRAME_WRITER != 0;
}

bool LinuxJobRuntimeGateSet(const perceptrum::linux_runtime::LinuxFeatureGates& gates)
{
    return gates.jobRuntime &&
        PERCEPTRUM_ENABLE_JOB_RUNTIME != 0;
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
    status.cameraRecordingClipGenerated = result.recordingClipGenerated;
    status.rtspCameraId = result.cameraId;
    status.rtspCameraName = result.cameraName;
    status.rtspThumbnailPath = result.thumbnailPath;
    status.rtspEventPath = result.eventPath;
    status.rtspLastError = result.error;
    status.cameraThumbnailRoot = result.thumbnailRoot;
    status.cameraRecordingsRoot = result.recordingsRoot;
    status.inferenceTempRoot = result.inferenceTempRoot;
    status.jobsInferenceTempRoot = result.jobsInferenceTempRoot;
    status.cameraRecordingClipPaths.clear();
    for (const auto& path : result.clipPaths) {
        if (!status.cameraRecordingClipPaths.empty()) {
            status.cameraRecordingClipPaths += ";";
        }
        status.cameraRecordingClipPaths += path;
    }
    status.cameraRecordingProfiles.clear();
    for (const int profile : result.recordingProfiles) {
        if (!status.cameraRecordingProfiles.empty()) {
            status.cameraRecordingProfiles += ",";
        }
        status.cameraRecordingProfiles += std::to_string(profile);
    }

    if (result.configured) {
        status.integrationStatus = result.thumbnailGenerated && result.recordingClipGenerated
            ? "linux_camera_capture_ready"
            : "linux_camera_capture_unavailable";
    } else {
        status.integrationStatus = "linux_rtsp_camera_waiting_for_config";
    }
}

#if PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE
class LinuxAgentCorePathProvider final : public perceptrum::core::IAgentCorePathProvider {
public:
    explicit LinuxAgentCorePathProvider(perceptrum::linux_runtime::RuntimePaths paths)
        : paths_(std::move(paths))
    {
    }

    perceptrum::core::AgentCorePortableRoots roots() const override
    {
        return {
            paths_.dataRoot,
            paths_.configRoot,
            paths_.cacheRoot,
            paths_.stateRoot,
            paths_.logRoot,
        };
    }

    std::string configSource() const override
    {
        return "runtime_paths:agent_config.json";
    }

private:
    perceptrum::linux_runtime::RuntimePaths paths_;
};

class LinuxAgentCoreHttpClient final : public perceptrum::core::IAgentCoreHttpClient {
public:
    chatv2::HttpResponse get(
        std::string_view url,
        std::string_view bearerToken,
        const std::vector<std::string>& extraHeaders,
        std::chrono::milliseconds timeout) override
    {
        return chatv2::getUrl(
            std::string(url),
            std::string(bearerToken),
            extraHeaders,
            static_cast<long>(timeout.count()));
    }
};

class LinuxAgentCoreClock final : public perceptrum::core::IAgentCoreClock {
public:
    std::string utcNowIso() const override
    {
        return perceptrum::linux_runtime::UtcTimestampNow();
    }

    long long unixTimeMilliseconds() const override
    {
        return perceptrum::linux_runtime::UnixTimeMillisecondsNow();
    }

    std::string timezone() const override
    {
        return perceptrum::linux_runtime::RuntimeTimezone();
    }

    int processId() const override
    {
        return perceptrum::linux_runtime::CurrentProcessId();
    }
};

class LinuxAgentCoreLifecycle final : public perceptrum::core::IAgentCoreLifecycle {
public:
    bool shutdownRequested() const override
    {
        return false;
    }
};

class LinuxPortableAgentRuntime final : public perceptrum::runtime::IAgentRuntime {
public:
    LinuxPortableAgentRuntime(
        perceptrum::linux_runtime::RuntimePaths paths,
        perceptrum::runtime::IRuntimeLogger* logger)
        : paths_(std::move(paths))
        , tokenStore_(paths_)
        , pairingConfigStore_(paths_)
        , pathProvider_(paths_)
        , runtime_({
              &pathProvider_,
              logger,
              &tokenStore_,
              &pairingConfigStore_,
              &httpClient_,
              &clock_,
              &lifecycle_,
          })
    {
    }

    bool start() override
    {
        return runtime_.start();
    }

    void stop() noexcept override
    {
        runtime_.stop();
    }

    perceptrum::runtime::AgentRuntimeStatus status() const override
    {
        return runtime_.status();
    }

private:
    perceptrum::linux_runtime::RuntimePaths paths_;
    perceptrum::linux_runtime::LinuxTokenStore tokenStore_;
    perceptrum::linux_runtime::LinuxPairingConfigStore pairingConfigStore_;
    LinuxAgentCorePathProvider pathProvider_;
    LinuxAgentCoreHttpClient httpClient_;
    LinuxAgentCoreClock clock_;
    LinuxAgentCoreLifecycle lifecycle_;
    perceptrum::core::AgentCorePortableRuntime runtime_;
};
#endif

} // namespace

namespace perceptrum::linux_runtime {

std::string RedactSensitiveRuntimeText(std::string_view text)
{
    std::string output(text);

    for (const std::string_view scheme : {
             "rtsp://",
             "rtsps://",
             "http://",
             "https://",
             "ws://",
             "wss://",
         }) {
        RedactUrlUserInfoForScheme(output, scheme);
    }

    for (const std::string_view header : {
             "authorization",
             "cookie",
             "set-cookie",
             "x-api-key",
         }) {
        MaskHeaderValue(output, header);
    }

    for (const std::string_view key : {
             "api_key",
             "apikey",
             "apiKey",
             "openai_api_key",
             "z_ai_api_key",
             "zai_api_key",
             "model_api_key",
             "description_model_api_key",
             "validator_model_api_key",
             "router_api_key",
             "secret",
             "client_secret",
             "oauth_secret",
             "password",
             "passwd",
             "pwd",
             "cookie",
             "session_token",
             "access_token",
             "refresh_token",
             "token",
             "exe_token",
             "exe-token",
             "grant_token",
             "central_grant_token",
             "central_device_session_token",
             "workspace_token",
             "relay_token",
             "rtsp_url",
             "rtspUrl",
             "stream_url",
             "streamUrl",
             "code",
         }) {
        MaskDelimitedKeyValue(output, key);
    }

    return output;
}

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
               << RedactSensitiveRuntimeText(message) << '\n';
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
    , tokenStore_(paths_)
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
    status_.agentCorePathAdapter = "linux_runtime_paths_adapter";
    status_.agentCoreHttpClient = "not_loaded";
    status_.agentCoreClock = "linux_runtime_clock_adapter";
    status_.agentCoreLifecycle = "linux_process_lifecycle_adapter";
}

LinuxMinimalAgentRuntime::~LinuxMinimalAgentRuntime()
{
    stop();
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
    status_.cameraRecordingClipGenerated = false;
    status_.rtspCameraId.clear();
    status_.rtspCameraName.clear();
    status_.rtspThumbnailPath.clear();
    status_.rtspEventPath.clear();
    status_.rtspLastError.clear();
    status_.cameraThumbnailRoot.clear();
    status_.cameraRecordingsRoot.clear();
    status_.cameraRecordingClipPaths.clear();
    status_.cameraRecordingProfiles.clear();
    status_.inferenceTempRoot.clear();
    status_.jobsInferenceTempRoot.clear();
    status_.jobRuntimeLastCommandType.clear();
    status_.jobRuntimeLastError.clear();
    status_.jobRuntimeLlmProvider.clear();
    status_.jobRuntimeCommandsPolled = 0;
    status_.jobRuntimeCommandsCompleted = 0;
    status_.jobRuntimeCommandsFailed = 0;
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
    const bool linuxJobRuntimeEnabled = LinuxJobRuntimeGateSet(gates_);
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
    if (linuxJobRuntimeEnabled) {
        status_.jobRuntimeEnabled = true;
        status_.inferenceTempRoot = LinuxInferenceTempRoot(paths_).string();
        status_.jobsInferenceTempRoot = LinuxJobsInferenceTempRoot(paths_).string();
        status_.integrationStatus = "linux_job_runtime_ready";
        MarkCapabilityAvailable(status_, "job_runtime");
    }

    if (gates_.agentCore && !PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_AGENT_CORE");
    }
    if (gates_.cameraCapture && PERCEPTRUM_ENABLE_CAMERA_CAPTURE == 0) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_CAMERA_CAPTURE");
    }
    if (gates_.rtspCapture && PERCEPTRUM_ENABLE_RTSP_CAPTURE == 0) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_RTSP_CAPTURE");
    }
    if (gates_.jobRuntime && PERCEPTRUM_ENABLE_JOB_RUNTIME == 0) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_JOB_RUNTIME");
    }
    if (gates_.frameWriter && PERCEPTRUM_ENABLE_FRAME_WRITER == 0) {
        SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_FRAME_WRITER");
    }
    if ((gates_.cameraCapture || gates_.rtspCapture || gates_.frameWriter) && !rtspThumbnailEnabled) {
        if (gates_.cameraCapture && (!gates_.rtspCapture || !gates_.frameWriter)) {
            SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_CAMERA_CAPTURE");
        } else if (gates_.rtspCapture && !gates_.cameraCapture) {
            SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_RTSP_CAPTURE");
        } else if (gates_.rtspCapture && !gates_.frameWriter) {
            SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_RTSP_CAPTURE");
        } else if (gates_.frameWriter && !gates_.cameraCapture) {
            SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_FRAME_WRITER");
        } else if (gates_.frameWriter && !gates_.rtspCapture) {
            SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_FRAME_WRITER");
        }
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
                    logger_->info("agent", "Linux camera thumbnail generated at " + result.thumbnailPath);
                } else {
                    logger_->warn("agent", "Linux camera thumbnail unavailable: " + result.error);
                }
                if (result.recordingClipGenerated) {
                    logger_->info("agent", "Linux camera recording clip generated under " + result.recordingsRoot);
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

    if (linuxJobRuntimeEnabled) {
        jobRuntime_ = std::make_unique<LinuxJobRuntime>(paths_, logger_, &tokenStore_);
        if (!jobRuntime_->start()) {
            SetUnsupportedGate(status_, "PERCEPTRUM_ENABLE_JOB_RUNTIME");
        } else {
            jobRuntime_->applyStatus(status_);
            status_.integrationStatus = rtspThumbnailEnabled
                ? "linux_camera_jobs_runtime_running"
                : "linux_job_runtime_running";
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
    if (jobRuntime_) {
        jobRuntime_->stop();
        jobRuntime_.reset();
    }
    status_.running = false;
    if (status_.integrationStatus == "linux_minimal_runtime_running") {
        status_.integrationStatus = "linux_minimal_runtime_stopped";
    }
}

perceptrum::runtime::AgentRuntimeStatus LinuxMinimalAgentRuntime::status() const
{
    auto status = status_;
    if (jobRuntime_) {
        jobRuntime_->applyStatus(status);
    }
    return status;
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
#if PERCEPTRUM_AGENT_CORE_PORTABLE_AVAILABLE
    const auto gates = ResolveLinuxFeatureGates();
    const bool heavyGateRequested = gates.cameraCapture || gates.rtspCapture || gates.jobRuntime || gates.frameWriter;
    if (gates.agentCore && !heavyGateRequested) {
        return std::make_unique<LinuxPortableAgentRuntime>(paths_, logger_);
    }
#endif
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

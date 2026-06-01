#include "../Perceptrum/runtime/BrandingRuntime.h"
#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/platform/platform_process.h"
#include "../Perceptrum/platform/platform_secure_store.h"
#include "../linux/RuntimePaths.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#ifndef PERCEPTRUM_ENABLE_WEBKITGTK
#define PERCEPTRUM_ENABLE_WEBKITGTK 0
#endif

#if PERCEPTRUM_ENABLE_WEBKITGTK
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#endif

#ifndef PERCEPTRUM_DEFAULT_WEB_ROOT
#define PERCEPTRUM_DEFAULT_WEB_ROOT ""
#endif

#ifndef PERCEPTRUM_DEFAULT_BACKEND_COMMAND
#define PERCEPTRUM_DEFAULT_BACKEND_COMMAND ""
#endif

namespace {

struct Options {
    bool help = false;
    bool noOpen = false;
    bool printWebRoot = false;
    bool checkBackend = false;
    bool forceBrowser = false;
    bool forceWebKit = false;
};

enum class WindowMode {
    Auto,
    Browser,
    WebKit,
};

struct LaunchPlan {
    std::string backendBaseUrl;
    std::string launchUrl;
    bool explicitDesktopUrl = false;
};

struct BackendSession {
    std::string baseUrl;
    bool discovered = false;
    bool started = false;
    perceptrum::platform::ProcessHandle processHandle;
};

struct AgentSession {
    bool started = false;
    perceptrum::platform::ProcessHandle processHandle;
};

struct AgentStatusSummary {
    bool available = false;
    bool stale = false;
    int exitCode = 0;
    long long heartbeatAgeMs = -1;
    std::string status;
    std::string runtimeMode;
    std::string agentRuntime;
};

struct CurlGlobalScope {
    bool initialized = false;

    CurlGlobalScope()
        : initialized(curl_global_init(CURL_GLOBAL_DEFAULT) == CURLE_OK)
    {
    }

    ~CurlGlobalScope()
    {
        if (initialized) {
            curl_global_cleanup();
        }
    }
};

void PrintHelp()
{
    std::cout
        << "perceptrum-desktop - Linux browser host for the shared Perceptrum web build\n\n"
        << "Usage:\n"
        << "  perceptrum-desktop [--no-open] [--print-web-root] [--check-backend] [--browser|--webkit]\n"
        << "  perceptrum-desktop --help\n";
}

Options ParseOptions(int argc, char** argv)
{
    Options options;
    for (int index = 1; index < argc; ++index) {
        const std::string_view arg(argv[index]);
        if (arg == "--help" || arg == "-h") {
            options.help = true;
        } else if (arg == "--no-open") {
            options.noOpen = true;
        } else if (arg == "--print-web-root") {
            options.printWebRoot = true;
        } else if (arg == "--check-backend") {
            options.checkBackend = true;
        } else if (arg == "--browser") {
            options.forceBrowser = true;
        } else if (arg == "--webkit") {
            options.forceWebKit = true;
        } else {
            std::cerr << "Unknown option: " << arg << '\n';
            options.help = true;
        }
    }
    return options;
}

std::filesystem::path ReadPathEnv(const char* name)
{
    const auto value = perceptrum::platform::TrimAscii(perceptrum::platform::ReadEnvVar(name));
    if (value.empty()) {
        return {};
    }
    return perceptrum::platform::ExpandUserPath(value);
}

std::string ReadTextEnv(const char* name)
{
    return perceptrum::platform::TrimAscii(perceptrum::platform::ReadEnvVar(name));
}

bool IsWebRoot(const std::filesystem::path& path)
{
    std::error_code errorCode;
    return !path.empty() &&
        std::filesystem::is_regular_file(path / "index.html", errorCode) &&
        !errorCode;
}

std::filesystem::path NormalizePath(const std::filesystem::path& path)
{
    std::error_code errorCode;
    const auto canonical = std::filesystem::weakly_canonical(path, errorCode);
    return errorCode ? path : canonical;
}

std::filesystem::path AbsolutePathFrom(
    const std::filesystem::path& base,
    const std::filesystem::path& path)
{
    if (path.empty()) {
        return {};
    }
    if (path.is_absolute()) {
        return NormalizePath(path);
    }
    return NormalizePath(base / path);
}

std::filesystem::path ResolveWebRoot()
{
    const auto exeDir = perceptrum::platform::GetExecutableDirectory();
    const auto cwd = std::filesystem::current_path();

    const std::vector<std::filesystem::path> candidates = {
        ReadPathEnv("APP_STATIC_ROOT"),
        ReadPathEnv("PERCEPTRUM_WEB_ROOT"),
        std::filesystem::path(PERCEPTRUM_DEFAULT_WEB_ROOT),
        exeDir / "web",
        exeDir / "ui",
        exeDir.parent_path() / "ui",
        exeDir / ".." / "share" / "perceptrum-desktop" / "web",
        cwd / "dist",
        cwd / ".." / "DrakonSite" / "dist",
        exeDir / ".." / ".." / ".." / ".." / "DrakonSite" / "dist",
    };

    for (const auto& candidate : candidates) {
        const auto normalized = NormalizePath(candidate);
        if (IsWebRoot(normalized)) {
            return normalized;
        }
    }

    return {};
}

bool StartsWithCaseInsensitive(std::string_view value, std::string_view prefix)
{
    if (value.size() < prefix.size()) {
        return false;
    }

    for (size_t index = 0; index < prefix.size(); ++index) {
        if (std::tolower(static_cast<unsigned char>(value[index])) !=
            std::tolower(static_cast<unsigned char>(prefix[index]))) {
            return false;
        }
    }
    return true;
}

bool IsHttpUrl(std::string_view value)
{
    return StartsWithCaseInsensitive(value, "http://") ||
        StartsWithCaseInsensitive(value, "https://");
}

bool IsFileUrl(std::string_view value)
{
    return StartsWithCaseInsensitive(value, "file:");
}

WindowMode ResolveWindowMode(const Options& options)
{
    if (options.forceBrowser) {
        return WindowMode::Browser;
    }
    if (options.forceWebKit) {
        return WindowMode::WebKit;
    }

    const std::string mode = ReadTextEnv("PERCEPTRUM_LINUX_WINDOW_MODE");
    if (StartsWithCaseInsensitive(mode, "browser")) {
        return WindowMode::Browser;
    }
    if (StartsWithCaseInsensitive(mode, "webkit")) {
        return WindowMode::WebKit;
    }

    return WindowMode::Auto;
}

std::string WindowModeLabel(WindowMode mode)
{
    switch (mode) {
    case WindowMode::Browser:
        return "browser";
    case WindowMode::WebKit:
        return "webkitgtk";
    case WindowMode::Auto:
    default:
        return "auto";
    }
}

std::string StripTrailingSlash(std::string value)
{
    while (value.size() > std::string_view("http://x").size() && value.back() == '/') {
        value.pop_back();
    }
    return value;
}

std::string RemoveQueryAndFragment(std::string value)
{
    const auto pos = value.find_first_of("?#");
    if (pos != std::string::npos) {
        value.erase(pos);
    }
    return value;
}

std::string UrlWithPath(std::string baseUrl, std::string_view path)
{
    return StripTrailingSlash(RemoveQueryAndFragment(std::move(baseUrl))) + std::string(path);
}

int ParsePositiveInt(std::string_view value, int fallback)
{
    if (value.empty()) {
        return fallback;
    }

    int result = 0;
    for (const unsigned char ch : value) {
        if (std::isdigit(ch) == 0) {
            return fallback;
        }
        result = result * 10 + static_cast<int>(ch - '0');
        if (result > 65535) {
            return fallback;
        }
    }

    return result > 0 ? result : fallback;
}

std::optional<int> ExtractPortFromHttpUrl(const std::string& url)
{
    const auto schemeEnd = url.find("://");
    if (schemeEnd == std::string::npos) {
        return std::nullopt;
    }

    const auto authorityStart = schemeEnd + 3;
    const auto authorityEnd = url.find_first_of("/?#", authorityStart);
    const auto authority = url.substr(
        authorityStart,
        authorityEnd == std::string::npos ? std::string::npos : authorityEnd - authorityStart);
    const auto colon = authority.rfind(':');
    if (colon == std::string::npos || colon + 1 >= authority.size()) {
        return std::nullopt;
    }

    return ParsePositiveInt(std::string_view(authority).substr(colon + 1), 0);
}

int ResolveBackendPort(const std::string& baseUrl)
{
    if (const auto port = ExtractPortFromHttpUrl(baseUrl); port.has_value()) {
        return *port;
    }

    if (const int envPort = ParsePositiveInt(ReadTextEnv("PERCEPTRUM_BACKEND_PORT"), 0);
        envPort > 0) {
        return envPort;
    }

    if (const int port = ParsePositiveInt(ReadTextEnv("PORT"), 0); port > 0) {
        return port;
    }

    return 4000;
}

std::string ResolveBackendBaseUrl()
{
    const std::string appBaseUrl = ReadTextEnv("APP_BASE_URL");
    if (!appBaseUrl.empty()) {
        return StripTrailingSlash(RemoveQueryAndFragment(appBaseUrl));
    }

    const int port = ParsePositiveInt(ReadTextEnv("PERCEPTRUM_BACKEND_PORT"), 4000);
    return "http://127.0.0.1:" + std::to_string(port);
}

bool ResolveLaunchPlan(LaunchPlan& plan, std::string& errorMessage)
{
    errorMessage.clear();

    const std::string explicitUrl = ReadTextEnv("PERCEPTRUM_DESKTOP_URL");
    if (!explicitUrl.empty()) {
        if (!IsHttpUrl(explicitUrl) || IsFileUrl(explicitUrl)) {
            errorMessage = "PERCEPTRUM_DESKTOP_URL must be an http:// or https:// URL. file:// is not supported by the Linux host.";
            return false;
        }

        plan.backendBaseUrl = StripTrailingSlash(RemoveQueryAndFragment(explicitUrl));
        plan.launchUrl = explicitUrl;
        plan.explicitDesktopUrl = true;
        return true;
    }

    plan.backendBaseUrl = ResolveBackendBaseUrl();
    if (!IsHttpUrl(plan.backendBaseUrl) || IsFileUrl(plan.backendBaseUrl)) {
        errorMessage = "The Linux desktop host requires an http:// or https:// APP_BASE_URL. file:// is not supported.";
        return false;
    }

    plan.launchUrl = UrlWithPath(plan.backendBaseUrl, "/dashboard");
    return true;
}

size_t DiscardCurlWrite(char* ptr, size_t size, size_t nmemb, void*)
{
    return size * nmemb;
}

long HttpStatusCode(const std::string& url, long timeoutMs)
{
    CURL* curl = curl_easy_init();
    if (curl == nullptr) {
        return 0;
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, timeoutMs);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, DiscardCurlWrite);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    const CURLcode code = curl_easy_perform(curl);
    long status = 0;
    if (code == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    }

    curl_easy_cleanup(curl);
    return status;
}

bool BackendIsHealthy(const std::string& baseUrl)
{
    const long legacyStatus = HttpStatusCode(UrlWithPath(baseUrl, "/__perceptrum/health"), 1200);
    if (legacyStatus == 200) {
        return true;
    }

    const long runtimeStatus = HttpStatusCode(UrlWithPath(baseUrl, "/api/runtime/health"), 1200);
    return runtimeStatus == 200;
}

std::filesystem::path ResolveWebSourceDir(const std::filesystem::path& webRoot)
{
    const auto exeDir = perceptrum::platform::GetExecutableDirectory();
    const auto cwd = std::filesystem::current_path();
    const std::vector<std::filesystem::path> candidates = {
        ReadPathEnv("PERCEPTRUM_WEB_SOURCE_DIR"),
        webRoot.filename() == "dist" ? webRoot.parent_path() : std::filesystem::path{},
        cwd,
        cwd / "DrakonSite",
        cwd / ".." / "DrakonSite",
        exeDir / ".." / ".." / ".." / "DrakonSite",
        exeDir / ".." / ".." / ".." / ".." / "DrakonSite",
    };

    for (const auto& candidate : candidates) {
        const auto normalized = NormalizePath(candidate);
        std::error_code errorCode;
        if (!normalized.empty() &&
            std::filesystem::is_regular_file(normalized / "server" / "index.ts", errorCode) &&
            !errorCode &&
            std::filesystem::is_regular_file(normalized / "package.json", errorCode) &&
            !errorCode) {
            return normalized;
        }
    }

    return {};
}

std::string ResolveBackendCommand()
{
    const auto configured = ReadTextEnv("PERCEPTRUM_BACKEND_COMMAND");
    if (!configured.empty()) {
        return configured;
    }
    return perceptrum::platform::TrimAscii(std::string(PERCEPTRUM_DEFAULT_BACKEND_COMMAND));
}

std::filesystem::path ResolveTsxCli(const std::filesystem::path& webSourceDir)
{
    const std::vector<std::filesystem::path> candidates = {
        webSourceDir / "node_modules" / "tsx" / "dist" / "cli.mjs",
        webSourceDir / "node_modules" / ".bin" / "tsx",
    };

    for (const auto& candidate : candidates) {
        std::error_code errorCode;
        if (std::filesystem::is_regular_file(candidate, errorCode) && !errorCode) {
            return candidate;
        }
    }

    return {};
}

std::string EnvAssignment(std::string_view name, std::string value)
{
    return std::string(name) + "=" + value;
}

std::string ShellQuote(std::string_view value)
{
    std::string quoted = "'";
    for (const char ch : value) {
        if (ch == '\'') {
            quoted += "'\\''";
        } else {
            quoted.push_back(ch);
        }
    }
    quoted += "'";
    return quoted;
}

std::string RedactDiagnosticText(std::string_view text)
{
    std::istringstream input{std::string(text)};
    std::ostringstream output;
    std::string line;
    while (std::getline(input, line)) {
        std::string lowered = line;
        std::transform(lowered.begin(), lowered.end(), lowered.begin(), [](unsigned char ch) {
            return static_cast<char>(std::tolower(ch));
        });
        if (lowered.find("token") != std::string::npos ||
            lowered.find("password") != std::string::npos ||
            lowered.find("secret") != std::string::npos ||
            lowered.find("authorization") != std::string::npos ||
            lowered.find("cookie") != std::string::npos) {
            output << "[redacted sensitive log line]\n";
        } else {
            output << line << '\n';
        }
    }
    return output.str();
}

std::string TailTextFile(const std::filesystem::path& path, std::size_t maxBytes)
{
    std::ifstream stream(path, std::ios::binary);
    if (!stream.is_open()) {
        return {};
    }
    stream.seekg(0, std::ios::end);
    const auto size = stream.tellg();
    if (size > static_cast<std::streamoff>(maxBytes)) {
        stream.seekg(-static_cast<std::streamoff>(maxBytes), std::ios::end);
    } else {
        stream.seekg(0, std::ios::beg);
    }
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    return RedactDiagnosticText(buffer.str());
}

std::vector<std::string> RuntimePathEnvironmentAssignments(
    const perceptrum::linux_runtime::RuntimePaths& paths)
{
    return {
        EnvAssignment("APP_RUNTIME_DATA_ROOT", paths.dataRoot.string()),
        EnvAssignment("APP_RUNTIME_CONFIG_ROOT", paths.configRoot.string()),
        EnvAssignment("APP_RUNTIME_CACHE_ROOT", paths.cacheRoot.string()),
        EnvAssignment("APP_RUNTIME_STATE_ROOT", paths.stateRoot.string()),
        EnvAssignment("APP_RUNTIME_LOG_ROOT", paths.logRoot.string()),
    };
}

std::vector<std::string> AgentFeatureGateEnvironmentAssignments()
{
    return {
        EnvAssignment("PERCEPTRUM_ENABLE_AGENT_CORE", "1"),
        EnvAssignment("PERCEPTRUM_ENABLE_CAMERA_CAPTURE", "1"),
        EnvAssignment("PERCEPTRUM_ENABLE_RTSP_CAPTURE", "1"),
        EnvAssignment("PERCEPTRUM_ENABLE_FRAME_WRITER", "1"),
        EnvAssignment("PERCEPTRUM_ENABLE_JOB_RUNTIME", "1"),
    };
}

std::filesystem::path ResolveSqlitePath(
    const std::filesystem::path& storageRoot)
{
    const auto configured = ReadPathEnv("SQLITE_DB_PATH");
    if (!configured.empty()) {
        return AbsolutePathFrom(storageRoot, configured);
    }

    return NormalizePath(storageRoot / "storage" / "sqlite" / "local-site" / "perceptrum_site.sqlite");
}

std::vector<std::string> BackendEnvironmentAssignments(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::filesystem::path& webRoot,
    const std::string& backendBaseUrl)
{
    const int port = ResolveBackendPort(backendBaseUrl);
    const auto storageRoot = ReadPathEnv("STORAGE_ROOT").empty()
        ? paths.dataRoot
        : ReadPathEnv("STORAGE_ROOT");
    const auto absoluteStorageRoot = NormalizePath(storageRoot);
    const auto sqlitePath = ResolveSqlitePath(absoluteStorageRoot);

    std::vector<std::string> assignments = {
        EnvAssignment("APP_RUNTIME_ENV", ReadTextEnv("APP_RUNTIME_ENV").empty() ? "local" : ReadTextEnv("APP_RUNTIME_ENV")),
        EnvAssignment("APP_DB_BACKEND", ReadTextEnv("APP_DB_BACKEND").empty() ? "sqlite" : ReadTextEnv("APP_DB_BACKEND")),
        EnvAssignment("APP_STATIC_ROOT", webRoot.string()),
        EnvAssignment("APP_BASE_URL", backendBaseUrl),
        EnvAssignment("PORT", std::to_string(port)),
        EnvAssignment("STORAGE_ROOT", absoluteStorageRoot.string()),
        EnvAssignment("SQLITE_DB_PATH", sqlitePath.string()),
    };
    auto runtimeAssignments = RuntimePathEnvironmentAssignments(paths);
    assignments.insert(assignments.end(), runtimeAssignments.begin(), runtimeAssignments.end());
    assignments.push_back(EnvAssignment("PERCEPTRUM_LINUX_HOST", "1"));
    if (const auto config = perceptrum::linux_runtime::ReadAgentConfig(paths);
        config.has_value() && !config->exeId.empty()) {
        assignments.push_back(EnvAssignment("APP_PROVISIONED_EXE_ID", config->exeId));
    }

    return assignments;
}

std::filesystem::path ResolveAgentExecutablePath()
{
    const auto configured = ReadPathEnv("PERCEPTRUM_AGENT_PATH");
    if (!configured.empty()) {
        return configured;
    }

    const auto exeDir = perceptrum::platform::GetExecutableDirectory();
    const std::vector<std::filesystem::path> candidates = {
        exeDir / "perceptrum-agent",
        exeDir.parent_path() / "bin" / "perceptrum-agent",
        perceptrum::platform::SearchExecutableInPath("perceptrum-agent"),
    };

    for (const auto& candidate : candidates) {
        std::error_code errorCode;
        if (!candidate.empty() &&
            std::filesystem::is_regular_file(candidate, errorCode) &&
            !errorCode) {
            return candidate;
        }
    }

    return {};
}

std::string RedactSensitiveValue(std::string text, std::string_view secret)
{
    if (secret.empty()) {
        return text;
    }

    const std::string replacement = "[redacted]";
    std::size_t pos = 0;
    while ((pos = text.find(secret, pos)) != std::string::npos) {
        text.replace(pos, secret.size(), replacement);
        pos += replacement.size();
    }
    return text;
}

bool RunAgentCommand(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::vector<std::string>& agentArguments,
    perceptrum::platform::ProcessRunResult& result,
    std::string& errorMessage)
{
    errorMessage.clear();

    const auto agentPath = ResolveAgentExecutablePath();
    if (agentPath.empty()) {
        errorMessage = "Unable to locate perceptrum-agent. Set PERCEPTRUM_AGENT_PATH or install it next to perceptrum-desktop.";
        return false;
    }

    auto arguments = RuntimePathEnvironmentAssignments(paths);
    arguments.push_back(agentPath.string());
    arguments.insert(arguments.end(), agentArguments.begin(), agentArguments.end());

    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = "env";
    options.workingDirectory = paths.dataRoot;
    options.hideWindow = true;
    options.arguments = std::move(arguments);

    return perceptrum::platform::RunProcessAndCaptureOutput(options, result, errorMessage);
}

bool ParseAgentStatusJson(const std::string& text, AgentStatusSummary& summary)
{
    const auto objectStart = text.find('{');
    if (objectStart == std::string::npos) {
        return false;
    }

    const auto payload = nlohmann::json::parse(text.substr(objectStart), nullptr, false);
    if (!payload.is_object()) {
        return false;
    }

    summary.available = true;
    summary.status = payload.value("status", std::string{});
    summary.runtimeMode = payload.value("runtime_mode", std::string{});
    summary.agentRuntime = payload.value("agent_runtime", std::string{});
    const long long heartbeat = payload.value("heartbeat_unix_ms", 0LL);
    if (heartbeat > 0) {
        summary.heartbeatAgeMs = perceptrum::linux_runtime::UnixTimeMillisecondsNow() - heartbeat;
        const long long staleAfterMs =
            static_cast<long long>(ParsePositiveInt(ReadTextEnv("PERCEPTRUM_AGENT_HEALTH_STALE_SECONDS"), 30)) * 1000LL;
        if (summary.heartbeatAgeMs < 0 || summary.heartbeatAgeMs > staleAfterMs) {
            summary.stale = true;
            summary.available = false;
            summary.status = "stale";
        }
    }
    return true;
}

bool ReadAgentHealthSnapshot(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    AgentStatusSummary& summary)
{
    std::ifstream stream(perceptrum::linux_runtime::HealthSnapshotPath(paths), std::ios::binary);
    if (!stream.is_open()) {
        return false;
    }

    std::ostringstream buffer;
    buffer << stream.rdbuf();
    return ParseAgentStatusJson(buffer.str(), summary);
}

AgentStatusSummary QueryAgentStatus(const perceptrum::linux_runtime::RuntimePaths& paths)
{
    AgentStatusSummary summary;
    perceptrum::platform::ProcessRunResult result;
    std::string errorMessage;
    if (RunAgentCommand(paths, { "status" }, result, errorMessage)) {
        summary.exitCode = result.exitCode;
        if (ParseAgentStatusJson(result.combinedOutput, summary)) {
            return summary;
        }
    }

    (void)ReadAgentHealthSnapshot(paths, summary);
    return summary;
}

bool AgentAutostartDisabled()
{
    const std::string value = ReadTextEnv("PERCEPTRUM_DISABLE_AGENT_AUTOSTART");
    return value == "1" || value == "true" || value == "TRUE";
}

bool LaunchResidentAgentProcess(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    AgentSession& session,
    std::string& errorMessage)
{
    errorMessage.clear();
    if (AgentAutostartDisabled()) {
        return true;
    }
    if (session.started && perceptrum::platform::IsProcessRunning(session.processHandle)) {
        return true;
    }

    const auto agentPath = ResolveAgentExecutablePath();
    if (agentPath.empty()) {
        errorMessage = "Unable to locate perceptrum-agent. Set PERCEPTRUM_AGENT_PATH or install it next to perceptrum-desktop.";
        return false;
    }

    auto arguments = RuntimePathEnvironmentAssignments(paths);
    auto gateAssignments = AgentFeatureGateEnvironmentAssignments();
    arguments.insert(arguments.end(), gateAssignments.begin(), gateAssignments.end());
    arguments.push_back(EnvAssignment("PERCEPTRUM_LINUX_DESKTOP_AGENT", "1"));

    const auto agentOutputLog = paths.logRoot / "perceptrum-agent.resident.stderr.log";
    std::ostringstream command;
    command << "exec env";
    for (const auto& assignment : arguments) {
        command << ' ' << ShellQuote(assignment);
    }
    command << ' ' << ShellQuote(agentPath.string())
            << " run >> " << ShellQuote(agentOutputLog.string()) << " 2>&1";

    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = "sh";
    options.workingDirectory = paths.dataRoot;
    options.hideWindow = false;
    options.arguments = { "-c", command.str() };

    if (!perceptrum::platform::LaunchProcess(options, session.processHandle, errorMessage)) {
        return false;
    }

    session.started = true;
    std::this_thread::sleep_for(std::chrono::milliseconds(350));
    int exitCode = 0;
    if (perceptrum::platform::TryGetProcessExitCode(session.processHandle, exitCode)) {
        session.started = false;
        errorMessage = "perceptrum-agent run exited immediately with code " + std::to_string(exitCode) + ".";
        const auto stderrTail = TailTextFile(agentOutputLog, 4096);
        if (!stderrTail.empty()) {
            errorMessage += " Recent agent stderr/log: " + stderrTail;
        }
        return false;
    }
    return true;
}

void StopOwnedAgent(AgentSession& session)
{
    if (session.started) {
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(
            session.processHandle,
            0,
            3000,
            &terminateError);
    }
    perceptrum::platform::CloseProcess(session.processHandle);
    session.started = false;
}

bool ProvisionAgentFromLocalSession(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    std::string_view backendBaseUrl,
    std::string_view clientId,
    std::string_view exeId,
    std::string_view exeToken,
    std::string_view timezone,
    std::string& errorMessage)
{
    perceptrum::platform::ProcessRunResult result;
    if (!RunAgentCommand(
            paths,
            {
                "provision",
                "--base-url",
                std::string(backendBaseUrl),
                "--exe-token",
                std::string(exeToken),
                "--client-id",
                std::string(clientId),
                "--exe-id",
                std::string(exeId),
                "--timezone",
                std::string(timezone),
            },
            result,
            errorMessage)) {
        return false;
    }

    if (result.exitCode != 0) {
        errorMessage = "perceptrum-agent provision failed with code " +
            std::to_string(result.exitCode) + ": " +
            RedactSensitiveValue(result.combinedOutput, exeToken);
        return false;
    }

    return true;
}

bool LaunchBackendProcess(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::filesystem::path& webRoot,
    const std::string& backendBaseUrl,
    perceptrum::platform::ProcessHandle& processHandle,
    std::string& errorMessage)
{
    const std::string backendCommand = ResolveBackendCommand();
    const bool useBackendCommand = !backendCommand.empty();
    const auto webSourceDir = useBackendCommand ? std::filesystem::path{} : ResolveWebSourceDir(webRoot);
    if (!useBackendCommand && webSourceDir.empty()) {
        errorMessage = "Unable to locate DrakonSite source for the local backend. Set PERCEPTRUM_WEB_SOURCE_DIR or PERCEPTRUM_BACKEND_COMMAND.";
        return false;
    }

    const auto workingDirectory = ReadPathEnv("PERCEPTRUM_BACKEND_WORKDIR").empty()
        ? (useBackendCommand ? paths.dataRoot : webSourceDir)
        : ReadPathEnv("PERCEPTRUM_BACKEND_WORKDIR");
    auto assignments = BackendEnvironmentAssignments(paths, webRoot, backendBaseUrl);

    perceptrum::platform::ProcessLaunchOptions launchOptions;
    launchOptions.executablePath = "env";
    launchOptions.workingDirectory = workingDirectory;
    launchOptions.hideWindow = false;
    launchOptions.arguments = std::move(assignments);

    if (useBackendCommand) {
        launchOptions.arguments.push_back("sh");
        launchOptions.arguments.push_back("-c");
        launchOptions.arguments.push_back(backendCommand);
    } else {
        const auto tsxCli = ResolveTsxCli(webSourceDir);
        if (tsxCli.empty()) {
            errorMessage = "Unable to locate tsx under DrakonSite/node_modules. Run npm install or set PERCEPTRUM_BACKEND_COMMAND.";
            return false;
        }

        launchOptions.arguments.push_back(ReadTextEnv("PERCEPTRUM_BACKEND_NODE").empty()
            ? "node"
            : ReadTextEnv("PERCEPTRUM_BACKEND_NODE"));
        launchOptions.arguments.push_back(tsxCli.string());
        launchOptions.arguments.push_back("--tsconfig");
        launchOptions.arguments.push_back("tsconfig.worker.json");
        launchOptions.arguments.push_back("server/index.ts");
    }

    return perceptrum::platform::LaunchProcess(launchOptions, processHandle, errorMessage);
}

bool EnsureBackendSession(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::filesystem::path& webRoot,
    const std::string& backendBaseUrl,
    BackendSession& session,
    std::string& errorMessage)
{
    session.baseUrl = backendBaseUrl;
    errorMessage.clear();

    if (BackendIsHealthy(backendBaseUrl)) {
        session.discovered = true;
        return true;
    }

    if (!LaunchBackendProcess(paths, webRoot, backendBaseUrl, session.processHandle, errorMessage)) {
        return false;
    }

    session.started = true;
    const int timeoutMs = ParsePositiveInt(ReadTextEnv("PERCEPTRUM_BACKEND_READY_TIMEOUT_MS"), 15000);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);
    while (std::chrono::steady_clock::now() < deadline) {
        if (BackendIsHealthy(backendBaseUrl)) {
            return true;
        }

        int exitCode = 0;
        if (perceptrum::platform::TryGetProcessExitCode(session.processHandle, exitCode)) {
            errorMessage = "Local backend exited before becoming ready with code " + std::to_string(exitCode) + ".";
            return false;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }

    errorMessage = "Timed out waiting for local backend at " + backendBaseUrl + ".";
    return false;
}

void StopOwnedBackend(BackendSession& session)
{
    if (session.started) {
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(
            session.processHandle,
            0,
            3000,
            &terminateError);
    }
    perceptrum::platform::CloseProcess(session.processHandle);
}

#if PERCEPTRUM_ENABLE_WEBKITGTK
constexpr char kLinuxWebKitBridgeScript[] = R"JS(
(() => {
  if (window.__perceptrumLinuxWebKitBridgeInstalled) {
    return;
  }

  window.__perceptrumLinuxWebKitBridgeInstalled = true;
  window.__drakonDesktopShell = true;
  window.__perceptrumLinuxHost = true;

  function cleanSessionValue(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || /[\u0000-\u001f\u007f]/.test(text)) {
      return "";
    }
    return text;
  }

  function postNativeMessage(message) {
    try {
      const bridge =
        window.webkit &&
        window.webkit.messageHandlers &&
        window.webkit.messageHandlers.perceptrumBridge;
      if (bridge && typeof bridge.postMessage === "function") {
        bridge.postMessage(JSON.stringify(message || {}));
      }
    } catch {
    }
  }

  window.chrome = window.chrome || {};
  window.chrome.webview = window.chrome.webview || {};
  window.chrome.webview.postMessage = postNativeMessage;

  function getTheme() {
    const root = document.documentElement;
    if (root && root.classList.contains("light")) {
      return "light";
    }
    if (root && root.classList.contains("dark")) {
      return "dark";
    }
    return "dark";
  }

  let lastTheme = "";
  function reportTheme() {
    const theme = getTheme();
    if (!theme || theme === lastTheme) {
      return;
    }
    lastTheme = theme;
    postNativeMessage({
      type: "theme-changed",
      theme
    });
  }

  function watchTheme() {
    reportTheme();
    if (document.documentElement && typeof MutationObserver === "function") {
      const observer = new MutationObserver(reportTheme);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme"]
      });
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["class", "data-theme"]
        });
      }
    }
    window.addEventListener("load", reportTheme);
    window.addEventListener("pageshow", reportTheme);
    document.addEventListener("readystatechange", reportTheme);
  }

  let busy = false;
  let completed = Boolean(window.__drakonDesktopPairRuntimeCompleted);
  async function tryProvisionResidentRuntime() {
    completed = Boolean(window.__drakonDesktopPairRuntimeCompleted);
    if (busy || completed) {
      return;
    }

    busy = true;
    try {
      const response = await fetch("/api/runtime/local-session", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timezone_iana:
            (Intl.DateTimeFormat().resolvedOptions &&
              Intl.DateTimeFormat().resolvedOptions().timeZone) || ""
        })
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const clientId = cleanSessionValue(payload && payload.client_id);
      const exeId = cleanSessionValue(payload && payload.exe_id);
      const exeToken = cleanSessionValue(payload && payload.exe_token);
      if (clientId && exeId && exeToken) {
        completed = true;
        window.__drakonDesktopPairRuntimeCompleted = true;
        postNativeMessage({
          type: "resident-runtime-session",
          client_id: clientId,
          exe_id: exeId,
          exe_token: exeToken,
          timezone_iana: cleanSessionValue(payload && payload.timezone_iana)
        });
      }
    } catch {
    } finally {
      busy = false;
    }
  }

  window.__drakonDesktopTryResidentRuntime = tryProvisionResidentRuntime;
  window.__drakonDesktopTryPairRuntime = tryProvisionResidentRuntime;
  window.__drakonDesktopReportTheme = reportTheme;
  watchTheme();
  setInterval(tryProvisionResidentRuntime, 10000);
  setTimeout(tryProvisionResidentRuntime, 1200);
  setTimeout(reportTheme, 400);
})();
)JS";

struct WebKitHostContext {
    std::string url;
    std::string backendBaseUrl;
    perceptrum::linux_runtime::RuntimePaths paths;
    AgentSession* agentSession = nullptr;
    bool pairingRequested = false;
    bool pairingCompleted = false;
    std::string lastTheme = "dark";
};

std::string CleanBridgeSessionValue(std::string value)
{
    value = perceptrum::platform::TrimAscii(std::move(value));
    if (value.empty()) {
        return {};
    }
    return std::any_of(value.begin(), value.end(), [](unsigned char ch) {
        return ch < 0x20 || ch == 0x7f;
    }) ? std::string{} : value;
}

void AppendDesktopHostLog(const WebKitHostContext& context, std::string_view message) noexcept
{
    try {
        std::ofstream stream(context.paths.logRoot / "perceptrum-desktop.log", std::ios::app);
        if (stream.is_open()) {
            stream << perceptrum::linux_runtime::UtcTimestampNow()
                   << " [linux-desktop] " << message << '\n';
        }
    } catch (...) {
    }
}

bool PersistResidentRuntimeSession(
    WebKitHostContext& context,
    const nlohmann::json& payload,
    std::string& errorMessage)
{
    errorMessage.clear();

    const std::string clientId = CleanBridgeSessionValue(payload.value("client_id", std::string{}));
    const std::string exeId = CleanBridgeSessionValue(payload.value("exe_id", std::string{}));
    const std::string exeToken = CleanBridgeSessionValue(payload.value("exe_token", std::string{}));
    std::string timezone = CleanBridgeSessionValue(payload.value("timezone_iana", std::string{}));
    if (timezone.empty()) {
        timezone = perceptrum::linux_runtime::RuntimeTimezone();
    }

    if (clientId.empty() || exeId.empty() || exeToken.empty()) {
        errorMessage = "invalid resident runtime session payload";
        return false;
    }

    if (!ProvisionAgentFromLocalSession(
            context.paths,
            context.backendBaseUrl,
            clientId,
            exeId,
            exeToken,
            timezone,
            errorMessage)) {
        return false;
    }

    const auto status = QueryAgentStatus(context.paths);
    if (status.available) {
        AppendDesktopHostLog(
            context,
            "perceptrum-agent status after local session: " + status.status +
                " runtime=" + status.agentRuntime);
    }
    return true;
}

void ClearResidentRuntimeSession(WebKitHostContext& context, bool clearStorageRoot)
{
    perceptrum::platform::RemoveProtectedLocalText(
        perceptrum::linux_runtime::ExeTokenSecretPath(context.paths));

    const std::filesystem::path configFiles[] = {
        perceptrum::linux_runtime::AgentConfigPath(context.paths),
        context.paths.configRoot / "client_id.txt",
        context.paths.configRoot / "exe_id.txt",
        context.paths.configRoot / "paired_timezone.txt",
        context.paths.configRoot / static_cast<const char*>(AppBrand::kBaseUrlFileName),
    };
    for (const auto& file : configFiles) {
        std::error_code errorCode;
        std::filesystem::remove(file, errorCode);
    }

    if (clearStorageRoot) {
        AppendDesktopHostLog(
            context,
            "account-delete-cleanup requested storage cleanup; Linux host cleared session files only");
    } else {
        AppendDesktopHostLog(context, "account-delete-cleanup cleared Linux resident runtime session");
    }
}

void EvaluateScript(WebKitWebView* webView, const char* script)
{
    webkit_web_view_run_javascript(webView, script, nullptr, nullptr, nullptr);
}

std::optional<std::string> ExtractJavascriptResultString(WebKitJavascriptResult* result)
{
    if (result == nullptr) {
        return std::nullopt;
    }

    JSCValue* value = webkit_javascript_result_get_js_value(result);
    if (value == nullptr) {
        return std::nullopt;
    }

    gchar* raw = jsc_value_to_string(value);
    if (raw == nullptr) {
        return std::nullopt;
    }

    std::string text(raw);
    g_free(raw);
    return text;
}

void OnWebKitScriptMessage(
    WebKitUserContentManager*,
    WebKitJavascriptResult* result,
    gpointer userData)
{
    auto* context = static_cast<WebKitHostContext*>(userData);
    if (context == nullptr) {
        return;
    }

    const auto messageText = ExtractJavascriptResultString(result);
    if (!messageText.has_value() || messageText->empty()) {
        return;
    }

    const auto payload = nlohmann::json::parse(*messageText, nullptr, false);
    if (!payload.is_object()) {
        return;
    }

    const std::string messageType = payload.value("type", std::string{});
    if (messageType == "theme-changed") {
        const std::string theme = payload.value("theme", std::string{});
        if (theme == "light" || theme == "dark") {
            context->lastTheme = theme;
        }
        return;
    }

    if (messageType == "account-delete-cleanup") {
        ClearResidentRuntimeSession(*context, payload.value("clear_storage_root", false));
        context->pairingCompleted = false;
        context->pairingRequested = false;
        return;
    }

    if (messageType != "resident-runtime-session" ||
        context->pairingRequested ||
        context->pairingCompleted) {
        return;
    }

    context->pairingRequested = true;
    std::string errorMessage;
    if (PersistResidentRuntimeSession(*context, payload, errorMessage)) {
        if (context->agentSession != nullptr) {
            std::string launchError;
            if (context->agentSession->started) {
                StopOwnedAgent(*context->agentSession);
            }
            if (LaunchResidentAgentProcess(context->paths, *context->agentSession, launchError)) {
                AppendDesktopHostLog(*context, "resident perceptrum-agent restarted after local session provisioning");
            } else {
                AppendDesktopHostLog(*context, "resident perceptrum-agent start failed: " + launchError);
            }
        }
        context->pairingCompleted = true;
        AppendDesktopHostLog(*context, "resident runtime session persisted via WebKit bridge");
    } else {
        context->pairingCompleted = false;
        AppendDesktopHostLog(*context, "resident runtime session rejected: " + errorMessage);
    }
    context->pairingRequested = false;
}

std::optional<std::string> RewriteOAuthCallbackToLocalOrigin(
    std::string requestUri,
    const std::string& backendBaseUrl)
{
    const auto callbackPath = requestUri.find("/auth/callback");
    if (callbackPath == std::string::npos) {
        return std::nullopt;
    }

    const std::string localBase = StripTrailingSlash(RemoveQueryAndFragment(backendBaseUrl));
    const std::string callbackAndQuery = requestUri.substr(callbackPath);
    const std::string rewritten = localBase + callbackAndQuery;
    return rewritten == requestUri ? std::nullopt : std::optional<std::string>(rewritten);
}

gboolean OnWebKitDecidePolicy(
    WebKitWebView* webView,
    WebKitPolicyDecision* decision,
    WebKitPolicyDecisionType decisionType,
    gpointer userData)
{
    if (decisionType != WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION) {
        return FALSE;
    }

    auto* context = static_cast<WebKitHostContext*>(userData);
    if (context == nullptr) {
        return FALSE;
    }

    auto* navigationDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
    WebKitNavigationAction* action =
        webkit_navigation_policy_decision_get_navigation_action(navigationDecision);
    WebKitURIRequest* request = action == nullptr ? nullptr : webkit_navigation_action_get_request(action);
    const char* uri = request == nullptr ? nullptr : webkit_uri_request_get_uri(request);
    if (uri == nullptr) {
        return FALSE;
    }

    const auto rewritten = RewriteOAuthCallbackToLocalOrigin(uri, context->backendBaseUrl);
    if (!rewritten.has_value()) {
        return FALSE;
    }

    webkit_policy_decision_ignore(decision);
    webkit_web_view_load_uri(webView, rewritten->c_str());
    AppendDesktopHostLog(*context, "rewrote OAuth callback to Linux local origin");
    return TRUE;
}

void OnWebKitApplicationActivate(GtkApplication* application, gpointer userData)
{
    auto* context = static_cast<WebKitHostContext*>(userData);

    GtkWidget* window = gtk_application_window_new(application);
    gtk_window_set_title(GTK_WINDOW(window), static_cast<const char*>(AppBrand::kDisplayName));
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 820);
    gtk_window_set_position(GTK_WINDOW(window), GTK_WIN_POS_CENTER);
    gtk_window_set_icon_name(GTK_WINDOW(window), "perceptrum");

    WebKitUserContentManager* contentManager = webkit_user_content_manager_new();
    webkit_user_content_manager_register_script_message_handler(
        contentManager,
        "perceptrumBridge");
    g_signal_connect(
        contentManager,
        "script-message-received::perceptrumBridge",
        G_CALLBACK(OnWebKitScriptMessage),
        context);

    WebKitUserScript* bridgeScript = webkit_user_script_new(
        kLinuxWebKitBridgeScript,
        WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES,
        WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START,
        nullptr,
        nullptr);
    webkit_user_content_manager_add_script(contentManager, bridgeScript);
    webkit_user_script_unref(bridgeScript);

    WebKitWebView* webView = WEBKIT_WEB_VIEW(
        webkit_web_view_new_with_user_content_manager(contentManager));
    g_object_unref(contentManager);

    g_signal_connect(
        webView,
        "decide-policy",
        G_CALLBACK(OnWebKitDecidePolicy),
        context);

    WebKitSettings* settings = webkit_web_view_get_settings(webView);
    webkit_settings_set_enable_developer_extras(
        settings,
        !ReadTextEnv("PERCEPTRUM_WEBKIT_DEVTOOLS").empty());
    webkit_settings_set_enable_write_console_messages_to_stdout(settings, TRUE);

    gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(webView));
    webkit_web_view_load_uri(webView, context->url.c_str());
    EvaluateScript(webView, "window.__drakonDesktopPairRuntimeCompleted = false;");
    gtk_widget_show_all(window);
}

bool LaunchNativeWebKitWindow(
    const std::string& url,
    const std::string& backendBaseUrl,
    const perceptrum::linux_runtime::RuntimePaths& paths,
    AgentSession* agentSession,
    std::string& errorMessage)
{
    errorMessage.clear();

    int argc = 0;
    char** argv = nullptr;
    if (!gtk_init_check(&argc, &argv)) {
        errorMessage = "GTK could not initialize a display session.";
        return false;
    }

    WebKitHostContext context{ url, backendBaseUrl, paths, agentSession };
    GtkApplication* application = gtk_application_new(
        "ai.perceptrum.desktop",
        G_APPLICATION_DEFAULT_FLAGS);
    if (application == nullptr) {
        errorMessage = "Failed to create GtkApplication.";
        return false;
    }

    g_signal_connect(application, "activate", G_CALLBACK(OnWebKitApplicationActivate), &context);
    const int status = g_application_run(G_APPLICATION(application), 0, nullptr);
    g_object_unref(application);

    if (status != 0) {
        errorMessage = "WebKitGTK application exited with status=" + std::to_string(status) + ".";
        return false;
    }

    return true;
}
#else
bool LaunchNativeWebKitWindow(
    const std::string&,
    const std::string&,
    const perceptrum::linux_runtime::RuntimePaths&,
    AgentSession*,
    std::string& errorMessage)
{
    errorMessage = "WebKitGTK support was not compiled into this Linux desktop host.";
    return false;
}
#endif

bool LaunchBrowser(std::string_view url, std::string& errorMessage)
{
    perceptrum::platform::ProcessLaunchOptions launchOptions;
    launchOptions.executablePath = "xdg-open";
    launchOptions.arguments = { std::string(url) };
    launchOptions.hideWindow = false;

    perceptrum::platform::ProcessHandle processHandle;
    const bool launched = perceptrum::platform::LaunchProcess(launchOptions, processHandle, errorMessage);
    perceptrum::platform::CloseProcess(processHandle);
    return launched;
}

} // namespace

int main(int argc, char** argv) {
    const auto options = ParseOptions(argc, argv);
    if (options.help) {
        PrintHelp();
        return 0;
    }

    const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
    std::string errorMessage;
    if (!perceptrum::linux_runtime::EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    const auto webRoot = ResolveWebRoot();
    if (webRoot.empty()) {
        std::cerr
            << "Shared web build was not found. Build DrakonSite first or set APP_STATIC_ROOT.\n";
        return 2;
    }

    std::cout << static_cast<const char*>(AppBrand::kDisplayName)
              << " Linux desktop host\n";
    std::cout << "dataRoot=" << paths.dataRoot.string() << '\n';
    std::cout << "configRoot=" << paths.configRoot.string() << '\n';
    std::cout << "cacheRoot=" << paths.cacheRoot.string() << '\n';
    std::cout << "stateRoot=" << paths.stateRoot.string() << '\n';
    std::cout << "logRoot=" << paths.logRoot.string() << '\n';
    std::cout << "webRoot=" << webRoot.string() << '\n';

    const auto config = perceptrum::linux_runtime::ReadAgentConfig(paths);
    std::cout << "paired=" << (config.has_value() && config->paired ? "true" : "false") << '\n';
    std::cout << "provisioned=" << (config.has_value() && config->provisioned ? "true" : "false") << '\n';
    std::cout << "clientId=" << (config.has_value() ? config->clientId : "") << '\n';
    const auto agentStatus = QueryAgentStatus(paths);
    std::cout << "agentStatus=" << (agentStatus.available ? agentStatus.status : "unavailable") << '\n';
    std::cout << "agentRuntime=" << agentStatus.agentRuntime << '\n';

    LaunchPlan launchPlan;
    if (!ResolveLaunchPlan(launchPlan, errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 3;
    }

    std::cout << "backendBaseUrl=" << launchPlan.backendBaseUrl << '\n';
    std::cout << "launchUrl=" << launchPlan.launchUrl << '\n';
    const auto windowMode = ResolveWindowMode(options);
    std::cout << "windowMode=" << WindowModeLabel(windowMode) << '\n';
    std::cout << "webkitgtkCompiled="
              << (PERCEPTRUM_ENABLE_WEBKITGTK ? "true" : "false")
              << '\n';

    if ((options.printWebRoot || options.noOpen) && !options.checkBackend) {
        return 0;
    }

    CurlGlobalScope curlGlobal;
    if (!curlGlobal.initialized) {
        std::cerr << "Failed to initialize libcurl for local backend discovery.\n";
        return 4;
    }

    BackendSession backendSession;
    if (launchPlan.explicitDesktopUrl) {
        std::cout << "backendStatus=explicit-url\n";
    } else if (!EnsureBackendSession(paths, webRoot, launchPlan.backendBaseUrl, backendSession, errorMessage)) {
        std::cerr << "Failed to prepare local backend: " << errorMessage << '\n';
        return 5;
    } else {
        std::cout << "backendStatus="
                  << (backendSession.started ? "started" : "discovered")
                  << '\n';
    }

    if (options.checkBackend) {
        StopOwnedBackend(backendSession);
        return 0;
    }

    AgentSession agentSession;
    const auto residentAgentConfig = perceptrum::linux_runtime::ReadAgentConfig(paths);
    if (residentAgentConfig.has_value() && residentAgentConfig->provisioned) {
        std::string agentError;
        if (LaunchResidentAgentProcess(paths, agentSession, agentError)) {
            if (agentSession.started) {
                std::cout << "agentStatus=started\n";
            }
        } else {
            std::cerr << "Failed to start resident agent: " << agentError << '\n';
        }
    }

    if (windowMode != WindowMode::Browser) {
        std::string nativeError;
        if (LaunchNativeWebKitWindow(launchPlan.launchUrl, launchPlan.backendBaseUrl, paths, &agentSession, nativeError)) {
            StopOwnedAgent(agentSession);
            StopOwnedBackend(backendSession);
            return 0;
        }

        if (windowMode == WindowMode::WebKit) {
            StopOwnedAgent(agentSession);
            StopOwnedBackend(backendSession);
            std::cerr << "Failed to launch WebKitGTK window: " << nativeError << '\n';
            return 6;
        }

        std::cerr << "WebKitGTK window unavailable, falling back to xdg-open: "
                  << nativeError << '\n';
    }

    if (!LaunchBrowser(launchPlan.launchUrl, errorMessage)) {
        std::cerr << "Failed to launch browser through xdg-open: " << errorMessage << '\n';
        StopOwnedAgent(agentSession);
        StopOwnedBackend(backendSession);
        return 7;
    }

    perceptrum::platform::CloseProcess(agentSession.processHandle);
    perceptrum::platform::CloseProcess(backendSession.processHandle);

    return 0;
}

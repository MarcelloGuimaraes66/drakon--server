#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/comm/PairingClient.h"
#include "../Perceptrum/runtime/BrandingRuntime.h"
#include "LinuxHeadlessRuntime.h"
#include "LinuxRuntimeAdapters.h"
#include "RuntimePaths.h"

#include <chrono>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#ifndef PERCEPTRUM_VERSION
#define PERCEPTRUM_VERSION "1.0.0"
#endif

namespace {

struct ParsedOptions {
    std::optional<std::string> baseUrl;
    std::optional<std::string> pairCode;
    std::optional<std::string> exeToken;
    std::optional<std::string> clientId;
    std::optional<std::string> exeId;
    std::optional<std::string> timezone;
    std::optional<long long> maxHeartbeatAgeSeconds;
};

struct HttpResponse {
    CURLcode curlCode = CURLE_OK;
    long httpCode = 0;
    std::string body;
    std::string error;
};

void PrintHelp() {
    std::cout
        << "perceptrum-agent - Linux entrypoint for the Perceptrum runtime\n\n"
        << "Usage:\n"
        << "  perceptrum-agent --help\n"
        << "  perceptrum-agent version\n"
        << "  perceptrum-agent validate-config [--base-url <url>]\n"
        << "  perceptrum-agent check-deps\n"
        << "  perceptrum-agent status\n"
        << "  perceptrum-agent healthcheck [--max-heartbeat-age-seconds <seconds>]\n"
        << "  perceptrum-agent run\n"
        << "  perceptrum-agent pair --pair-code <code> [--base-url <url>]\n"
        << "  perceptrum-agent provision --base-url <url> --exe-token <token> --client-id <id> [--exe-id <id>] [--timezone <iana>]\n";
}

std::string Trim(std::string value) {
    return perceptrum::platform::TrimAscii(std::move(value));
}

std::string NormalizeBaseUrl(std::string value) {
    value = Trim(std::move(value));
    while (value.size() > 1 && value.back() == '/') {
        value.pop_back();
    }
    return value;
}

bool ValidateBaseUrl(std::string_view value, std::string& errorMessage) {
    errorMessage.clear();
    const std::string url = NormalizeBaseUrl(std::string(value));
    const bool hasScheme = url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
    if (!hasScheme) {
        errorMessage = "base_url must start with http:// or https://";
        return false;
    }

    const auto schemeEnd = url.find("://");
    if (schemeEnd == std::string::npos || schemeEnd + 3 >= url.size()) {
        errorMessage = "base_url must include a host";
        return false;
    }

    if (url.find_first_of(" \t\r\n") != std::string::npos) {
        errorMessage = "base_url must not contain whitespace";
        return false;
    }

    return true;
}

bool ValidateTimezone(std::string_view value, std::string& errorMessage) {
    errorMessage.clear();
    if (value.empty()) {
        return true;
    }
    if (value.size() > 128 || value.front() == '/' || value.back() == '/') {
        errorMessage = "timezone must be an IANA timezone such as America/Manaus";
        return false;
    }

    bool hasSeparator = false;
    for (const char ch : value) {
        const unsigned char unsignedCh = static_cast<unsigned char>(ch);
        const bool allowed =
            std::isalnum(unsignedCh) != 0 ||
            ch == '/' ||
            ch == '_' ||
            ch == '-' ||
            ch == '+';
        if (!allowed) {
            errorMessage = "timezone contains invalid characters";
            return false;
        }
        hasSeparator = hasSeparator || ch == '/';
    }

    if (!hasSeparator && value != "UTC") {
        errorMessage = "timezone must be an IANA timezone such as America/Manaus";
        return false;
    }

    return true;
}

std::optional<std::string> NextValue(int& index, int argc, char** argv, std::string_view optionName) {
    if (index + 1 >= argc) {
        std::cerr << "Missing value for " << optionName << '\n';
        return std::nullopt;
    }
    ++index;
    return Trim(argv[index]);
}

std::optional<ParsedOptions> ParseOptions(int argc, char** argv, int firstIndex) {
    ParsedOptions options;
    for (int index = firstIndex; index < argc; ++index) {
        const std::string_view arg(argv[index]);
        if (arg == "--base-url") {
            if (auto value = NextValue(index, argc, argv, arg); value.has_value()) {
                options.baseUrl = *value;
            } else {
                return std::nullopt;
            }
        } else if (arg == "--pair-code") {
            if (auto value = NextValue(index, argc, argv, arg); value.has_value()) {
                options.pairCode = *value;
            } else {
                return std::nullopt;
            }
        } else if (arg == "--exe-token") {
            if (auto value = NextValue(index, argc, argv, arg); value.has_value()) {
                options.exeToken = *value;
            } else {
                return std::nullopt;
            }
        } else if (arg == "--client-id") {
            if (auto value = NextValue(index, argc, argv, arg); value.has_value()) {
                options.clientId = *value;
            } else {
                return std::nullopt;
            }
        } else if (arg == "--exe-id") {
            if (auto value = NextValue(index, argc, argv, arg); value.has_value()) {
                options.exeId = *value;
            } else {
                return std::nullopt;
            }
        } else if (arg == "--timezone") {
            if (auto value = NextValue(index, argc, argv, arg); value.has_value()) {
                options.timezone = *value;
            } else {
                return std::nullopt;
            }
        } else if (arg == "--max-heartbeat-age-seconds") {
            const auto value = NextValue(index, argc, argv, arg);
            if (!value.has_value()) {
                return std::nullopt;
            }
            try {
                options.maxHeartbeatAgeSeconds = std::stoll(*value);
            } catch (...) {
                std::cerr << "Invalid --max-heartbeat-age-seconds value\n";
                return std::nullopt;
            }
        } else {
            std::cerr << "Unknown option: " << arg << '\n';
            return std::nullopt;
        }
    }

    return options;
}

bool ReportExecutable(const char* name) {
    const auto resolved = perceptrum::platform::SearchExecutableInPath(name);
    if (resolved.empty() || resolved == name) {
        std::cout << name << "=missing\n";
        return false;
    }

    std::cout << name << '=' << resolved.string() << '\n';
    return true;
}

std::string ResolveConfiguredBaseUrl(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    const std::optional<std::string>& overrideValue = std::nullopt) {
    if (overrideValue.has_value() && !overrideValue->empty()) {
        return NormalizeBaseUrl(*overrideValue);
    }
    if (const auto config = perceptrum::linux_runtime::ReadAgentConfig(paths); config.has_value() && !config->baseUrl.empty()) {
        return NormalizeBaseUrl(config->baseUrl);
    }
    return NormalizeBaseUrl(perceptrum::linux_runtime::ResolveBaseUrl());
}

std::string GenerateExeId() {
    return "exe-" + std::to_string(perceptrum::linux_runtime::UnixTimeMillisecondsNow());
}

std::string ResolveExeId(const perceptrum::linux_runtime::RuntimePaths& paths) {
    if (const auto config = perceptrum::linux_runtime::ReadAgentConfig(paths); config.has_value() && !config->exeId.empty()) {
        return config->exeId;
    }
    return GenerateExeId();
}

size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    auto* output = static_cast<std::string*>(userp);
    output->append(static_cast<const char*>(contents), size * nmemb);
    return size * nmemb;
}

HttpResponse PostJson(std::string_view url, const nlohmann::json& body) {
    HttpResponse response;
    CURL* curl = curl_easy_init();
    if (curl == nullptr) {
        response.curlCode = CURLE_FAILED_INIT;
        response.error = "curl_easy_init failed";
        return response;
    }

    const std::string bodyText = body.dump();
    const std::string urlText(url);
    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, urlText.c_str());
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, bodyText.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(bodyText.size()));
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response.body);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT_MS, 2000L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT_MS, 5000L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    response.curlCode = curl_easy_perform(curl);
    if (response.curlCode != CURLE_OK) {
        response.error = curl_easy_strerror(response.curlCode);
    }
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &response.httpCode);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return response;
}

bool StoreExeToken(
    const perceptrum::linux_runtime::RuntimePaths& paths,
    std::string_view token,
    std::string& errorMessage) {
    errorMessage.clear();
    perceptrum::linux_runtime::LinuxTokenStore tokenStore(paths);
    if (tokenStore.writeToken(token)) {
        return true;
    }

    errorMessage =
        "secure_store_unavailable: cannot store exe-token securely. "
        "Install Secret Service/secret-tool or set APP_ALLOW_PLAINTEXT_SECRET_RECOVERY=1 "
        "for the explicit plaintext recovery fallback.";
    return false;
}

int ValidateConfig(const ParsedOptions& options) {
    const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
    std::string errorMessage;
    if (!perceptrum::linux_runtime::EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    const std::string baseUrl = ResolveConfiguredBaseUrl(paths, options.baseUrl);
    if (!ValidateBaseUrl(baseUrl, errorMessage)) {
        std::cerr << "config_invalid: " << errorMessage << '\n';
        return 1;
    }

    std::string configError;
    const auto config = perceptrum::linux_runtime::ReadAgentConfig(paths, &configError);
    if (!configError.empty()) {
        std::cerr << "config_invalid: " << configError << '\n';
        return 1;
    }

    const auto executable = perceptrum::platform::GetExecutablePath();

    std::cout << "brand=" << static_cast<const char*>(AppBrand::kBrandId) << '\n';
    std::cout << "displayName=" << static_cast<const char*>(AppBrand::kDisplayName) << '\n';
    std::cout << "dataRoot=" << paths.dataRoot.string() << '\n';
    std::cout << "configRoot=" << paths.configRoot.string() << '\n';
    std::cout << "cacheRoot=" << paths.cacheRoot.string() << '\n';
    std::cout << "stateRoot=" << paths.stateRoot.string() << '\n';
    std::cout << "logRoot=" << paths.logRoot.string() << '\n';
    std::cout << "baseUrl=" << baseUrl << '\n';
    std::cout << "clientId=" << (config.has_value() ? config->clientId : "") << '\n';
    std::cout << "paired=" << (config.has_value() && config->paired ? "true" : "false") << '\n';
    std::cout << "provisioned=" << (config.has_value() && config->provisioned ? "true" : "false") << '\n';
    std::cout << "executable=" << executable.string() << '\n';

    if (static_cast<std::string_view>(AppBrand::kBrandId).empty()) {
        std::cerr << "config_invalid: brand id is empty\n";
        return 1;
    }

    return 0;
}

int CheckDeps() {
    bool ok = true;
    ok = ReportExecutable("ffmpeg") && ok;
    ok = ReportExecutable("ffprobe") && ok;
    ok = ReportExecutable("node") && ok;
    return ok ? 0 : 2;
}

int Version() {
    std::cout << PERCEPTRUM_VERSION << '\n';
    return 0;
}

int Status() {
    const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
    std::string errorMessage;
    if (!perceptrum::linux_runtime::EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    const auto snapshot = perceptrum::linux_runtime::ReadHeadlessHealthSnapshot(paths, errorMessage);
    if (!snapshot.has_value()) {
        auto missingSnapshot = perceptrum::linux_runtime::BuildHeadlessHealthSnapshot(
            paths,
            "missing_snapshot",
            false,
            nullptr);
        missingSnapshot["message"] = errorMessage;
        std::cout << missingSnapshot.dump(2) << '\n';
        return 3;
    }

    std::cout << snapshot->dump(2) << '\n';
    return 0;
}

int Healthcheck(const ParsedOptions& options) {
    const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
    std::string errorMessage;
    if (!perceptrum::linux_runtime::EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    const auto snapshot = perceptrum::linux_runtime::ReadHeadlessHealthSnapshot(paths, errorMessage);
    if (!snapshot.has_value()) {
        std::cerr << "healthcheck missing_snapshot: " << errorMessage << '\n';
        return 3;
    }

    const long long heartbeat = snapshot->value("heartbeat_unix_ms", 0LL);
    const long long maxAgeMs = options.maxHeartbeatAgeSeconds.value_or(30LL) * 1000LL;
    const long long ageMs = perceptrum::linux_runtime::UnixTimeMillisecondsNow() - heartbeat;
    if (heartbeat <= 0 || ageMs > maxAgeMs) {
        std::cerr << "healthcheck stale_heartbeat: heartbeat age exceeded "
                  << (maxAgeMs / 1000LL) << " seconds\n";
        return 4;
    }

    const std::string status = snapshot->value("status", "");
    if (status == "alive" || status == "healthy") {
        std::cout << "alive\n";
        return 0;
    }

    if (status == "running" || status == "provisioned" || status == "headless_ready") {
        const std::string runtimeMode = snapshot->value("runtime_mode", "");
        const bool headlessReady = snapshot->value("headless_ready", false);
        if (runtimeMode == "linux_minimal") {
            std::cout << "linux_minimal_runtime\n";
            return 0;
        }
        if (headlessReady || status == "headless_ready") {
            std::cout << "headless_ready\n";
            return 0;
        }
        if (runtimeMode == "runtime_stub") {
            std::cerr << "healthcheck runtime_stub: real HeadlessService is "
                      << snapshot->value("headless_integration_status", "headless_blocked_by_platform_coupling")
                      << '\n';
            return 9;
        }
    }

    if (status == "not_paired") {
        std::cerr << "healthcheck not_paired: local runtime is alive but no client pairing is configured\n";
        return 2;
    }
    if (status == "config_invalid") {
        std::cerr << "healthcheck config_invalid: " << snapshot->value("config_error", "") << '\n';
        return 1;
    }
    if (status == "secure_store_unavailable") {
        std::cerr << "healthcheck secure_store_unavailable: paired config exists but exe-token cannot be read\n";
        return 5;
    }
    if (status == "backend_unreachable") {
        std::cerr << "healthcheck backend_unreachable\n";
        return 6;
    }
    if (status == "stopped") {
        std::cerr << "healthcheck stopped: linux runtime adapter is not running\n";
        return 8;
    }
    if (status == "runtime_stub") {
        std::cerr << "healthcheck runtime_stub: real HeadlessService is not active\n";
        return 9;
    }
    if (status == "feature_gate_unsupported") {
        std::cerr << "healthcheck feature_gate_unsupported: "
                  << snapshot->value("unsupported_feature_gate", "unknown_feature_gate")
                  << '\n';
        return 10;
    }
    if (status == "runtime_error") {
        std::cerr << "healthcheck runtime_error: " << snapshot->value("runtime_error", "") << '\n';
        return 1;
    }

    std::cerr << "healthcheck unhealthy: status=" << status << '\n';
    return 1;
}

int Run() {
    return perceptrum::linux_runtime::RunLinuxHeadlessRuntime();
}

int Provision(const ParsedOptions& options) {
    const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
    std::string errorMessage;
    if (!perceptrum::linux_runtime::EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    if (!options.baseUrl.has_value() || options.baseUrl->empty()) {
        std::cerr << "Missing required option: --base-url\n";
        return 64;
    }
    if (!options.exeToken.has_value() || options.exeToken->empty()) {
        std::cerr << "Missing required option: --exe-token\n";
        return 64;
    }
    if (!options.clientId.has_value() || options.clientId->empty()) {
        std::cerr << "Missing required option: --client-id\n";
        return 64;
    }

    const std::string baseUrl = NormalizeBaseUrl(*options.baseUrl);
    if (!ValidateBaseUrl(baseUrl, errorMessage)) {
        std::cerr << "config_invalid: " << errorMessage << '\n';
        return 1;
    }

    const std::string timezone = options.timezone.has_value() && !options.timezone->empty()
        ? Trim(*options.timezone)
        : perceptrum::linux_runtime::RuntimeTimezone();
    if (!ValidateTimezone(timezone, errorMessage)) {
        std::cerr << "config_invalid: " << errorMessage << '\n';
        return 1;
    }

    if (!StoreExeToken(paths, *options.exeToken, errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 5;
    }

    const std::string now = perceptrum::linux_runtime::UtcTimestampNow();
    const auto previousConfig = perceptrum::linux_runtime::ReadAgentConfig(paths);

    perceptrum::linux_runtime::AgentConfig config;
    config.baseUrl = baseUrl;
    config.clientId = Trim(*options.clientId);
    config.exeId = options.exeId.has_value() && !options.exeId->empty()
        ? Trim(*options.exeId)
        : (previousConfig.has_value() && !previousConfig->exeId.empty() ? previousConfig->exeId : GenerateExeId());
    config.timezone = timezone;
    config.state = "provisioned";
    config.paired = true;
    config.provisioned = true;
    config.createdUtc = previousConfig.has_value() && !previousConfig->createdUtc.empty()
        ? previousConfig->createdUtc
        : now;
    config.updatedUtc = now;

    if (!perceptrum::linux_runtime::WriteAgentConfig(paths, config, &errorMessage) ||
        !perceptrum::linux_runtime::PersistNonSensitiveCompatibilityFiles(paths, config, &errorMessage)) {
        perceptrum::linux_runtime::LinuxTokenStore(paths).clearToken();
        std::cerr << errorMessage << '\n';
        return 1;
    }

    if (!perceptrum::linux_runtime::WriteHeadlessHealthSnapshot(paths, errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    std::cout << "provisioned client_id=" << config.clientId
              << " base_url=" << config.baseUrl
              << " timezone=" << config.timezone << '\n';
    return 0;
}

int Pair(const ParsedOptions& options) {
    const auto paths = perceptrum::linux_runtime::ResolveRuntimePaths();
    std::string errorMessage;
    if (!perceptrum::linux_runtime::EnsureRuntimeDirectories(paths, &errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    if (!options.pairCode.has_value() || options.pairCode->empty()) {
        std::cerr << "Missing required option: --pair-code\n";
        return 64;
    }

    const std::string baseUrl = ResolveConfiguredBaseUrl(paths, options.baseUrl);
    if (!ValidateBaseUrl(baseUrl, errorMessage)) {
        std::cerr << "config_invalid: " << errorMessage << '\n';
        return 1;
    }

    perceptrum::linux_runtime::LinuxRuntimeLogger logger(paths);
    perceptrum::linux_runtime::LinuxTokenStore tokenStore(paths);
    perceptrum::linux_runtime::LinuxPairingConfigStore configStore(paths);

    PairingClientOptions pairingOptions;
    pairingOptions.tokenStore = &tokenStore;
    pairingOptions.configStore = &configStore;
    pairingOptions.logger = &logger;
    pairingOptions.timezoneProvider = [] {
        return perceptrum::linux_runtime::RuntimeTimezone();
    };
    pairingOptions.nowUtcProvider = [] {
        return perceptrum::linux_runtime::UtcTimestampNow();
    };
    pairingOptions.exeIdProvider = [] {
        return GenerateExeId();
    };

    PairingClient pairing(baseUrl, std::move(pairingOptions));
    const auto result = pairing.pairWithCode(*options.pairCode, errorMessage);
    if (!result.has_value()) {
        const std::string pairError = errorMessage;
        if (pairError.rfind("backend_unreachable:", 0) == 0) {
            std::string snapshotError;
            (void)perceptrum::linux_runtime::WriteHeadlessHealthSnapshot(paths, snapshotError, "backend_unreachable");
            std::cerr << pairError << '\n';
            return 6;
        }
        if (pairError.rfind("secure_store_unavailable:", 0) == 0) {
            std::cerr << pairError << '\n';
            return 5;
        }
        if (pairError.rfind("pairing_failed:", 0) == 0 ||
            pairError == "pairing backend contract not available yet") {
            std::cerr << pairError << '\n';
            return 7;
        }
        std::string snapshotError;
        (void)perceptrum::linux_runtime::WriteHeadlessHealthSnapshot(paths, snapshotError, "backend_unreachable");
        std::cerr << pairError << '\n';
        return 1;
    }

    if (!perceptrum::linux_runtime::WriteHeadlessHealthSnapshot(paths, errorMessage)) {
        std::cerr << errorMessage << '\n';
        return 1;
    }

    const auto config = perceptrum::linux_runtime::ReadAgentConfig(paths);
    std::cout << "paired client_id=" << (config.has_value() ? config->clientId : result->clientId)
              << " base_url=" << (config.has_value() ? config->baseUrl : baseUrl)
              << " timezone=" << (config.has_value() ? config->timezone : perceptrum::linux_runtime::RuntimeTimezone())
              << '\n';
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    if (argc <= 1 || std::string_view(argv[1]) == "--help" || std::string_view(argv[1]) == "-h") {
        PrintHelp();
        return 0;
    }

    const std::string command = argv[1];
    const auto options = ParseOptions(argc, argv, 2);
    if (!options.has_value()) {
        return 64;
    }

    curl_global_init(CURL_GLOBAL_DEFAULT);

    int exitCode = 64;
    if (command == "version") {
        exitCode = Version();
    } else if (command == "validate-config") {
        exitCode = ValidateConfig(*options);
    } else if (command == "check-deps") {
        exitCode = CheckDeps();
    } else if (command == "status") {
        exitCode = Status();
    } else if (command == "healthcheck") {
        exitCode = Healthcheck(*options);
    } else if (command == "run") {
        exitCode = Run();
    } else if (command == "pair") {
        exitCode = Pair(*options);
    } else if (command == "provision") {
        exitCode = Provision(*options);
    } else {
        std::cerr << "Unknown command: " << command << "\n\n";
        PrintHelp();
        exitCode = 64;
    }

    curl_global_cleanup();
    return exitCode;
}

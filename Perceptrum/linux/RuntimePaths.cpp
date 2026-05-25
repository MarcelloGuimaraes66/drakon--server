#include "RuntimePaths.h"

#include "../Perceptrum/platform/platform_common.h"
#include "../Perceptrum/runtime/BrandingRuntime.h"

#include <chrono>
#include <fstream>
#include <iomanip>
#include <sstream>

#include <nlohmann/json.hpp>

#ifndef _WIN32
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace {

std::filesystem::path ReadPathEnv(const char* name) {
    const auto value = perceptrum::platform::TrimAscii(perceptrum::platform::ReadEnvVar(name));
    if (value.empty()) {
        return {};
    }

    return perceptrum::platform::ExpandUserPath(std::filesystem::path(value));
}

std::filesystem::path XdgHome(const char* envName, const char* homeSuffix) {
    auto root = ReadPathEnv(envName);
    if (!root.empty()) {
        return root;
    }

    const auto home = perceptrum::platform::GetHomeDirectory();
    return home.empty() ? std::filesystem::path{} : (home / homeSuffix);
}

std::filesystem::path AppRootFromXdg(const char* envName, const char* homeSuffix) {
    return XdgHome(envName, homeSuffix) / static_cast<const char*>(AppBrand::kDisplayName);
}

std::string ReadFirstLine(const std::filesystem::path& path) {
    std::ifstream stream(path);
    if (!stream.is_open()) {
        return {};
    }

    std::string line;
    std::getline(stream, line);
    return perceptrum::platform::TrimAscii(std::move(line));
}

bool WriteTextFile(const std::filesystem::path& path, std::string_view value, std::string* errorMessage) {
    if (path.has_parent_path()) {
        std::error_code errorCode;
        std::filesystem::create_directories(path.parent_path(), errorCode);
        if (errorCode) {
            if (errorMessage != nullptr) {
                *errorMessage = "Failed to create config directory " + path.parent_path().string() +
                    ": " + errorCode.message();
            }
            return false;
        }
    }

    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    if (!stream.is_open()) {
        if (errorMessage != nullptr) {
            *errorMessage = "Failed to open " + path.string() + " for writing.";
        }
        return false;
    }

    stream << value;
    if (!stream.good()) {
        if (errorMessage != nullptr) {
            *errorMessage = "Failed to write " + path.string() + ".";
        }
        return false;
    }

#ifndef _WIN32
    (void)::chmod(path.string().c_str(), S_IRUSR | S_IWUSR);
#endif
    return true;
}

} // namespace

namespace perceptrum::linux_runtime {

RuntimePaths ResolveRuntimePaths() {
    RuntimePaths paths;

    paths.dataRoot = ReadPathEnv("APP_RUNTIME_DATA_ROOT");
    if (paths.dataRoot.empty()) {
        paths.dataRoot = AppBrand::dataRoot();
    }

    paths.configRoot = ReadPathEnv("APP_RUNTIME_CONFIG_ROOT");
    if (paths.configRoot.empty()) {
        paths.configRoot = AppRootFromXdg("XDG_CONFIG_HOME", ".config");
    }

    paths.cacheRoot = ReadPathEnv("APP_RUNTIME_CACHE_ROOT");
    if (paths.cacheRoot.empty()) {
        paths.cacheRoot = AppRootFromXdg("XDG_CACHE_HOME", ".cache");
    }

    paths.stateRoot = ReadPathEnv("APP_RUNTIME_STATE_ROOT");
    if (paths.stateRoot.empty()) {
        paths.stateRoot = AppRootFromXdg("XDG_STATE_HOME", ".local/state");
    }

    paths.logRoot = ReadPathEnv("APP_RUNTIME_LOG_ROOT");
    if (paths.logRoot.empty()) {
        paths.logRoot = paths.stateRoot / "logs";
    }

    return paths;
}

bool EnsureRuntimeDirectories(const RuntimePaths& paths, std::string* errorMessage) {
    if (errorMessage != nullptr) {
        errorMessage->clear();
    }

    const std::filesystem::path roots[] = {
        paths.dataRoot,
        paths.configRoot,
        paths.cacheRoot,
        paths.stateRoot,
        paths.logRoot,
    };

    for (const auto& root : roots) {
        if (root.empty()) {
            if (errorMessage != nullptr) {
                *errorMessage = "Runtime root resolved to an empty path.";
            }
            return false;
        }

        std::error_code errorCode;
        std::filesystem::create_directories(root, errorCode);
        if (errorCode) {
            if (errorMessage != nullptr) {
                *errorMessage = "Failed to create runtime directory " + root.string() +
                    ": " + errorCode.message();
            }
            return false;
        }
    }

    return true;
}

std::filesystem::path HealthSnapshotPath(const RuntimePaths& paths) {
    return paths.dataRoot / "agent_health.json";
}

std::filesystem::path AgentLogPath(const RuntimePaths& paths) {
    return paths.logRoot / "perceptrum-agent.log";
}

std::filesystem::path AgentConfigPath(const RuntimePaths& paths) {
    return paths.configRoot / "agent_config.json";
}

std::filesystem::path ExeTokenSecretPath(const RuntimePaths& paths) {
    return paths.configRoot / "secrets" / "exe_token.txt";
}

std::optional<AgentConfig> ReadAgentConfig(const RuntimePaths& paths, std::string* errorMessage) {
    if (errorMessage != nullptr) {
        errorMessage->clear();
    }

    std::ifstream stream(AgentConfigPath(paths), std::ios::binary);
    if (!stream.is_open()) {
        return std::nullopt;
    }

    nlohmann::json document = nlohmann::json::parse(stream, nullptr, false);
    if (document.is_discarded() || !document.is_object()) {
        if (errorMessage != nullptr) {
            *errorMessage = "agent_config.json is not valid JSON.";
        }
        return std::nullopt;
    }

    auto readOptionalString = [&](const char* key) {
        const auto it = document.find(key);
        if (it == document.end() || it->is_null() || !it->is_string()) {
            return std::string{};
        }
        return perceptrum::platform::TrimAscii(it->get<std::string>());
    };

    AgentConfig config;
    config.baseUrl = readOptionalString("base_url");
    config.clientId = readOptionalString("client_id");
    config.exeId = readOptionalString("exe_id");
    config.timezone = readOptionalString("timezone");
    config.state = readOptionalString("state");
    config.createdUtc = readOptionalString("created_utc");
    config.updatedUtc = readOptionalString("updated_utc");
    config.lastBackendStatus = readOptionalString("last_backend_status");
    config.paired = document.value("paired", false);
    config.provisioned = document.value("provisioned", false);

    return config;
}

bool WriteAgentConfig(const RuntimePaths& paths, const AgentConfig& config, std::string* errorMessage) {
    nlohmann::json document = {
        { "schema_version", 1 },
        { "base_url", config.baseUrl },
        { "client_id", config.clientId },
        { "exe_id", config.exeId.empty() ? nlohmann::json(nullptr) : nlohmann::json(config.exeId) },
        { "timezone", config.timezone },
        { "state", config.state },
        { "paired", config.paired },
        { "provisioned", config.provisioned },
        { "created_utc", config.createdUtc },
        { "updated_utc", config.updatedUtc },
        { "last_backend_status", config.lastBackendStatus.empty() ? nlohmann::json(nullptr) : nlohmann::json(config.lastBackendStatus) },
    };

    return WriteTextFile(AgentConfigPath(paths), document.dump(2) + '\n', errorMessage);
}

bool PersistNonSensitiveCompatibilityFiles(
    const RuntimePaths& paths,
    const AgentConfig& config,
    std::string* errorMessage) {
    if (!config.baseUrl.empty()) {
        if (!WriteTextFile(paths.configRoot / static_cast<const char*>(AppBrand::kBaseUrlFileName),
                config.baseUrl + '\n',
                errorMessage)) {
            return false;
        }
    }
    if (!config.clientId.empty() &&
        !WriteTextFile(paths.configRoot / "client_id.txt", config.clientId + '\n', errorMessage)) {
        return false;
    }
    if (!config.exeId.empty() &&
        !WriteTextFile(paths.configRoot / "exe_id.txt", config.exeId + '\n', errorMessage)) {
        return false;
    }
    if (!config.timezone.empty() &&
        !WriteTextFile(paths.configRoot / "paired_timezone.txt", config.timezone + '\n', errorMessage)) {
        return false;
    }

    return true;
}

std::string ResolveBaseUrl() {
    std::string value = perceptrum::platform::ReadEnvVar(static_cast<const char*>(AppBrand::kBaseUrlEnvVarName));
    if (value.empty()) {
        value = perceptrum::platform::ReadEnvVar(static_cast<const char*>(AppBrand::kLegacyBaseUrlEnvVarName));
    }
    if (!value.empty()) {
        return value;
    }

    const RuntimePaths paths = ResolveRuntimePaths();
    value = ReadFirstLine(paths.configRoot / static_cast<const char*>(AppBrand::kBaseUrlFileName));
    if (value.empty()) {
        value = ReadFirstLine(paths.configRoot / static_cast<const char*>(AppBrand::kLegacyBaseUrlFileName));
    }

    return value.empty() ? "http://127.0.0.1:4000" : value;
}

std::string ReadClientId(const RuntimePaths& paths) {
    if (const auto config = ReadAgentConfig(paths); config.has_value()) {
        return config->clientId;
    }
    return ReadFirstLine(paths.configRoot / "client_id.txt");
}

std::string ReadConfiguredTimezone(const RuntimePaths& paths) {
    if (const auto config = ReadAgentConfig(paths); config.has_value() && !config->timezone.empty()) {
        return config->timezone;
    }
    return ReadFirstLine(paths.configRoot / "paired_timezone.txt");
}

std::string RuntimeTimezone() {
    return perceptrum::platform::DetectLocalTimezoneIana();
}

std::string UtcTimestampNow() {
    const auto now = std::chrono::system_clock::now();
    const std::time_t nowTime = std::chrono::system_clock::to_time_t(now);
    const std::tm utc = perceptrum::platform::UtcTime(nowTime);

    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
}

long long UnixTimeMillisecondsNow() {
    const auto now = std::chrono::system_clock::now();
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        now.time_since_epoch()).count();
}

int CurrentProcessId() {
#ifdef _WIN32
    return 0;
#else
    return static_cast<int>(::getpid());
#endif
}

} // namespace perceptrum::linux_runtime

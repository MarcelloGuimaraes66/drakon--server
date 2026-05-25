#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <string_view>

namespace perceptrum::linux_runtime {

struct RuntimePaths {
    std::filesystem::path dataRoot;
    std::filesystem::path configRoot;
    std::filesystem::path cacheRoot;
    std::filesystem::path stateRoot;
    std::filesystem::path logRoot;
};

struct AgentConfig {
    std::string baseUrl;
    std::string clientId;
    std::string exeId;
    std::string timezone;
    std::string state;
    std::string createdUtc;
    std::string updatedUtc;
    std::string lastBackendStatus;
    bool paired = false;
    bool provisioned = false;
};

RuntimePaths ResolveRuntimePaths();
bool EnsureRuntimeDirectories(const RuntimePaths& paths, std::string* errorMessage = nullptr);

std::filesystem::path HealthSnapshotPath(const RuntimePaths& paths);
std::filesystem::path AgentLogPath(const RuntimePaths& paths);
std::filesystem::path AgentConfigPath(const RuntimePaths& paths);
std::filesystem::path ExeTokenSecretPath(const RuntimePaths& paths);

std::optional<AgentConfig> ReadAgentConfig(const RuntimePaths& paths, std::string* errorMessage = nullptr);
bool WriteAgentConfig(const RuntimePaths& paths, const AgentConfig& config, std::string* errorMessage = nullptr);
bool PersistNonSensitiveCompatibilityFiles(const RuntimePaths& paths, const AgentConfig& config, std::string* errorMessage = nullptr);
std::string ResolveBaseUrl();
std::string ReadClientId(const RuntimePaths& paths);
std::string ReadConfiguredTimezone(const RuntimePaths& paths);
std::string RuntimeTimezone();
std::string UtcTimestampNow();
long long UnixTimeMillisecondsNow();
int CurrentProcessId();

} // namespace perceptrum::linux_runtime

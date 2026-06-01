#pragma once

#include "RuntimePaths.h"

#include "../Perceptrum/runtime/interfaces/IAgentRuntime.h"
#include "../Perceptrum/runtime/interfaces/IHeadlessRuntime.h"
#include "../Perceptrum/runtime/interfaces/IPairingConfigStore.h"
#include "../Perceptrum/runtime/interfaces/IRuntimeLogger.h"
#include "../Perceptrum/runtime/interfaces/ITokenStore.h"

#include <string_view>
#include <string>
#include <memory>
#include <optional>

namespace perceptrum::linux_runtime {

class LinuxJobRuntime;

struct LinuxFeatureGates {
    bool agentCore = false;
    bool cameraCapture = false;
    bool rtspCapture = false;
    bool jobRuntime = false;
    bool frameWriter = false;
};

class LinuxRuntimeLogger final : public perceptrum::runtime::IRuntimeLogger {
public:
    explicit LinuxRuntimeLogger(RuntimePaths paths);

    void debug(std::string_view component, std::string_view message) noexcept override;
    void info(std::string_view component, std::string_view message) noexcept override;
    void warn(std::string_view component, std::string_view message) noexcept override;
    void error(std::string_view component, std::string_view message) noexcept override;

private:
    void write(std::string_view level, std::string_view component, std::string_view message) noexcept;

    RuntimePaths paths_;
};

class LinuxTokenStore final : public perceptrum::runtime::ITokenStore {
public:
    explicit LinuxTokenStore(RuntimePaths paths);

    std::optional<std::string> readToken() const override;
    bool writeToken(std::string_view token) override;
    bool hasToken() const override;
    void clearToken() noexcept override;

private:
    RuntimePaths paths_;
};

class LinuxPairingConfigStore final : public perceptrum::runtime::IPairingConfigStore {
public:
    explicit LinuxPairingConfigStore(RuntimePaths paths);

    std::optional<perceptrum::runtime::PairingConfig> readPairingConfig(
        std::string* errorMessage = nullptr) const override;
    bool writePairingConfig(
        const perceptrum::runtime::PairingConfig& config,
        std::string* errorMessage = nullptr) override;

private:
    RuntimePaths paths_;
};

class LinuxMinimalAgentRuntime final : public perceptrum::runtime::IAgentRuntime {
public:
    LinuxMinimalAgentRuntime(RuntimePaths paths, perceptrum::runtime::IRuntimeLogger* logger);
    ~LinuxMinimalAgentRuntime() override;

    bool start() override;
    void stop() noexcept override;
    perceptrum::runtime::AgentRuntimeStatus status() const override;

private:
    bool validateLightweightDependency(std::string_view executableName);

    RuntimePaths paths_;
    perceptrum::runtime::IRuntimeLogger* logger_ = nullptr;
    LinuxTokenStore tokenStore_;
    LinuxFeatureGates gates_;
    perceptrum::runtime::AgentRuntimeStatus status_;
    std::unique_ptr<LinuxJobRuntime> jobRuntime_;
};

class LinuxMinimalAgentCoreFactory final : public perceptrum::runtime::IAgentCoreFactory {
public:
    LinuxMinimalAgentCoreFactory(RuntimePaths paths, perceptrum::runtime::IRuntimeLogger* logger);

    std::unique_ptr<perceptrum::runtime::IAgentRuntime> create(
        std::string_view baseUrl,
        std::string_view exeToken,
        std::string_view clientId) override;

private:
    RuntimePaths paths_;
    perceptrum::runtime::IRuntimeLogger* logger_ = nullptr;
};

LinuxFeatureGates ResolveLinuxFeatureGates();
perceptrum::runtime::RuntimeRoots ToRuntimeRoots(const RuntimePaths& paths);
std::string RedactSensitiveRuntimeText(std::string_view text);

} // namespace perceptrum::linux_runtime

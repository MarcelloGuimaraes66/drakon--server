#pragma once

#include "../orchestrator/HttpUtils.h"
#include "../runtime/interfaces/IAgentRuntime.h"
#include "../runtime/interfaces/IPairingConfigStore.h"
#include "../runtime/interfaces/IRuntimeLogger.h"
#include "../runtime/interfaces/ITokenStore.h"

#include <chrono>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace perceptrum::core {

struct AgentCorePortableRoots {
    std::filesystem::path dataRoot;
    std::filesystem::path configRoot;
    std::filesystem::path cacheRoot;
    std::filesystem::path stateRoot;
    std::filesystem::path logRoot;
};

class IAgentCorePathProvider {
public:
    virtual ~IAgentCorePathProvider() = default;

    virtual AgentCorePortableRoots roots() const = 0;
    virtual std::string configSource() const = 0;
};

class IAgentCoreHttpClient {
public:
    virtual ~IAgentCoreHttpClient() = default;

    virtual chatv2::HttpResponse get(
        std::string_view url,
        std::string_view bearerToken,
        const std::vector<std::string>& extraHeaders,
        std::chrono::milliseconds timeout) = 0;
};

class IAgentCoreClock {
public:
    virtual ~IAgentCoreClock() = default;

    virtual std::string utcNowIso() const = 0;
    virtual long long unixTimeMilliseconds() const = 0;
    virtual std::string timezone() const = 0;
    virtual int processId() const = 0;
};

class IAgentCoreLifecycle {
public:
    virtual ~IAgentCoreLifecycle() = default;

    virtual bool shutdownRequested() const = 0;
};

struct AgentCorePortableDependencies {
    IAgentCorePathProvider* paths = nullptr;
    perceptrum::runtime::IRuntimeLogger* logger = nullptr;
    perceptrum::runtime::ITokenStore* tokenStore = nullptr;
    perceptrum::runtime::IPairingConfigStore* pairingConfigStore = nullptr;
    IAgentCoreHttpClient* httpClient = nullptr;
    IAgentCoreClock* clock = nullptr;
    IAgentCoreLifecycle* lifecycle = nullptr;
};

class AgentCorePortableRuntime final : public perceptrum::runtime::IAgentRuntime {
public:
    explicit AgentCorePortableRuntime(AgentCorePortableDependencies dependencies);

    bool start() override;
    void stop() noexcept override;
    perceptrum::runtime::AgentRuntimeStatus status() const override;

private:
    bool validateDependencies();

    AgentCorePortableDependencies dependencies_;
    perceptrum::runtime::AgentRuntimeStatus status_;
};

perceptrum::runtime::AgentCoreStatusContract BuildPortableAgentCoreStatus(
    std::string configSource,
    bool configLoaded,
    bool configValid,
    std::string blockedReason = {});

} // namespace perceptrum::core

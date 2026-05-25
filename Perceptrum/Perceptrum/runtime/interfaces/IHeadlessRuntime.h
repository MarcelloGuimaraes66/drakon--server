#pragma once

#include "IAgentRuntime.h"
#include "IRuntimeLogger.h"
#include "ITokenStore.h"

#include <chrono>
#include <filesystem>
#include <functional>
#include <string>

namespace perceptrum::runtime {

struct RuntimeRoots {
    std::filesystem::path dataRoot;
    std::filesystem::path configRoot;
    std::filesystem::path cacheRoot;
    std::filesystem::path stateRoot;
    std::filesystem::path logRoot;
};

struct HeadlessRuntimeContext {
    RuntimeRoots roots;
    IRuntimeLogger* logger = nullptr;
    ITokenStore* tokenStore = nullptr;
    IAgentCoreFactory* agentFactory = nullptr;

    std::function<bool(std::chrono::milliseconds)> waitForShutdown;
    std::function<std::string()> baseUrlProvider;
    std::function<std::string()> clientIdProvider;
    std::function<void(const AgentRuntimeStatus&)> statusCallback;
};

} // namespace perceptrum::runtime

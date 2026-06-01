#pragma once

#include "RuntimePaths.h"

#include "../Perceptrum/runtime/interfaces/IAgentRuntime.h"
#include "../Perceptrum/runtime/interfaces/AgentCoreStatusContract.h"

#include <optional>
#include <string>
#include <string_view>

#include <nlohmann/json.hpp>

namespace perceptrum::linux_runtime {

std::string HeadlessIntegrationStatus();
bool IsHeadlessServiceHeaderAvailable();

void AppendAgentLog(const RuntimePaths& paths, std::string_view message);

nlohmann::json BuildAgentCoreCapabilitiesSnapshot(
    const perceptrum::runtime::AgentCoreStatusContract& status);

nlohmann::json BuildHeadlessHealthSnapshot(
    const RuntimePaths& paths,
    std::string_view overrideStatus = {},
    bool loopActive = false,
    const perceptrum::runtime::AgentRuntimeStatus* runtimeStatus = nullptr);

bool WriteHeadlessHealthSnapshot(
    const RuntimePaths& paths,
    std::string& errorMessage,
    std::string_view overrideStatus = {},
    bool loopActive = false,
    const perceptrum::runtime::AgentRuntimeStatus* runtimeStatus = nullptr);

std::optional<nlohmann::json> ReadHeadlessHealthSnapshot(
    const RuntimePaths& paths,
    std::string& errorMessage);

int RunLinuxHeadlessRuntime();

} // namespace perceptrum::linux_runtime

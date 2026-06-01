#pragma once

#include "../runtime/interfaces/AgentCoreStatusContract.h"

#include <string>

namespace perceptrum::core {

struct AgentCoreLightweightConfigStatus {
    std::string configSource = "runtime_paths:agent_config.json";
    bool configLoaded = false;
    bool configValid = true;
    std::string blockedReason;
};

perceptrum::runtime::AgentCoreStatusContract BuildLinuxMinimalAgentCoreStatus(
    const AgentCoreLightweightConfigStatus& configStatus = {});

} // namespace perceptrum::core

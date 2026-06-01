#pragma once

#include <string>
#include <vector>

namespace perceptrum::runtime {

struct AgentCoreCapabilityStatus {
    std::string name;
    bool available = false;
    bool blockedByGate = false;
    std::string gateName;
    std::string blockedReason;
};

struct AgentCoreStatusContract {
    std::string providerName;
    std::string contractVersion;
    bool fullAgentCoreActive = false;
    bool partialModeAvailable = false;
    std::vector<AgentCoreCapabilityStatus> capabilities;
    std::string blockedReason;
    std::string configSource;
    bool configLoaded = false;
    bool configValid = true;
};

} // namespace perceptrum::runtime

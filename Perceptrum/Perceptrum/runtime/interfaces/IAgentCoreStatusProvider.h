#pragma once

#include "AgentCoreStatusContract.h"

namespace perceptrum::runtime {

class IAgentCoreStatusProvider {
public:
    virtual ~IAgentCoreStatusProvider() = default;

    virtual AgentCoreStatusContract agentCoreStatus() const = 0;
};

} // namespace perceptrum::runtime

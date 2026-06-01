#pragma once

#include <string>

#include <nlohmann/json.hpp>

namespace chatv2 {

struct RoutingLexiconSignals {
    bool mentionsCamera = false;
    bool mentionsJob = false;
    bool mentionsCameraAgent = false;
    bool mentionsStep = false;
    bool wantsCreate = false;
    bool wantsEdit = false;
    bool wantsStart = false;
    bool wantsStop = false;
    bool wantsRead = false;
};

const nlohmann::json& routingLexicon();
RoutingLexiconSignals detectRoutingLexiconSignals(const std::string& userMessage);
std::string runtimeActionFromRoutingSignals(const RoutingLexiconSignals& signals);

} // namespace chatv2

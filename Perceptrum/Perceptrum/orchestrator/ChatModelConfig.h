#pragma once

#include <string>

#include <nlohmann/json.hpp>

#include "LocalLlmClient.h"

namespace chatv2 {

std::string normalizeChatModelTierName(std::string tier);
std::string chatModelNameForTier(const std::string& tier);
std::string chatCompletionsBaseUrlForTier(const std::string& tier);
LocalLlmClient::Config buildChatModelClientConfigFromPayload(
    const nlohmann::json& payload,
    bool useRouterModel);

} // namespace chatv2

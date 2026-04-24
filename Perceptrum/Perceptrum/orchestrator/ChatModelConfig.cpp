#include "ChatModelConfig.h"

#include <algorithm>
#include <cctype>

namespace chatv2 {

namespace {

std::string trimCopy_(std::string value)
{
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

} // namespace

std::string normalizeChatModelTierName(std::string tier)
{
    tier = trimCopy_(std::move(tier));
    std::transform(tier.begin(), tier.end(), tier.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });

    if (tier == "ultra+" || tier == "ultra-plus" || tier == "ultra_plus") {
        return "ultra_plus";
    }
    if (tier == "plus") {
        return "pro";
    }
    if (tier == "legacy" ||
        tier == "pro" ||
        tier == "ultra" ||
        tier == "ultra_plus" ||
        tier == "light" ||
        tier == "core") {
        return tier;
    }
    return "ultra";
}

std::string chatModelNameForTier(const std::string& tier)
{
    const std::string normalized = normalizeChatModelTierName(tier);
    if (normalized == "core") return "GLM-4.7-Flash";
    if (normalized == "ultra") return "gpt-5.1";
    if (normalized == "ultra_plus") return "gpt-5.4";
    if (normalized == "light") return "gpt-5.4-mini";
    return "gpt-5-mini";
}

std::string chatCompletionsBaseUrlForTier(const std::string& tier)
{
    return normalizeChatModelTierName(tier) == "core"
        ? "https://api.z.ai/api/paas/v4/chat/completions"
        : "https://api.openai.com/v1/chat/completions";
}

LocalLlmClient::Config buildChatModelClientConfigFromPayload(
    const nlohmann::json& payload,
    bool useRouterModel)
{
    LocalLlmClient::Config config;

    const std::string tierKey = useRouterModel ? "router_model_tier" : "model_tier";
    const std::string apiKeyKey = useRouterModel ? "router_api_key" : "model_api_key";
    const std::string fallbackTier = payload.is_object()
        ? payload.value("model_tier", std::string("ultra"))
        : std::string("ultra");
    const std::string tier = payload.is_object()
        ? payload.value(tierKey, fallbackTier)
        : fallbackTier;
    std::string apiKey = payload.is_object()
        ? payload.value(apiKeyKey, std::string())
        : std::string();

    if (apiKey.empty() && payload.is_object()) {
        apiKey = payload.value("model_api_key", std::string());
    }

    config.baseUrl = chatCompletionsBaseUrlForTier(tier);
    config.model = chatModelNameForTier(tier);
    config.apiKey = trimCopy_(std::move(apiKey));
    config.enabled =
        !config.baseUrl.empty() &&
        !config.model.empty() &&
        !config.apiKey.empty();
    return config;
}

} // namespace chatv2

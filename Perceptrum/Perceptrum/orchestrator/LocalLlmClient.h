#pragma once

#include <mutex>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "SkillTypes.h"

namespace chatv2 {

class LocalLlmClient {
public:
    struct Config {
        std::string baseUrl;
        std::string apiKey;
        std::string model = "Qwen3-4B-Instruct-2507";
        long timeoutMs = 12000;
        long routingTimeoutMs = 18000;
        long languageTimeoutMs = 8000;
        long answerTimeoutMs = 30000;
        int routingRetries = 1;
        int languageRetries = 1;
        int answerRetries = 1;
        bool enabled = false;
    };

    struct CompletionOutcome {
        bool ok = false;
        std::string content;
        std::string reasoningContent;
        std::string finishReason;
        std::string error;
        long elapsedMs = 0;
        long timeoutMs = 0;
        int attemptCount = 0;
        int statusCode = 0;
    };

    LocalLlmClient();

    bool isConfigured() const;
    const Config& config() const { return config_; }
    bool hasStoredConfiguration() const;
    void setEndpointOverride(const std::string& baseUrl);
    void clearEndpointOverride();

    std::string detectReplyLanguage(
        const std::string& userMessage,
        const std::string& appLanguage) const;
    SkillSelection chooseSkill(
        const std::string& userMessage,
        const nlohmann::json& requestContext,
        const std::vector<SkillDefinition>& skills) const;
    std::string polishAnswer(
        const std::string& userMessage,
        const std::string& draftAnswer,
        const std::string& replyLanguage,
        const std::string& knowledgeLanguage,
        const std::string& appLanguage,
        const std::string& selectedSkill) const;
    std::string answerDirectly(
        const std::string& userMessage,
        const std::string& replyLanguage,
        const std::string& knowledgeLanguage,
        const std::string& appLanguage,
        const std::string& selectedSkill) const;

private:
    std::string effectiveBaseUrl_() const;
    CompletionOutcome requestCompletion_(
        const std::string& operation,
        const nlohmann::json& body,
        long timeoutMs,
        int retries) const;

    mutable std::mutex mutex_;
    Config config_;
    std::string endpointOverride_;
};

} // namespace chatv2

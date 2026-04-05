#pragma once

#include <string>

#include <nlohmann/json.hpp>

#include "ChatModelConfig.h"
#include "LocalLlmClient.h"
#include "SkillRegistry.h"

class AgentCore;

namespace chatv2 {

class ChatV2Orchestrator {
public:
    ChatV2Orchestrator();

    void start();
    void stop();
    void handleQuery(AgentCore& agent, const nlohmann::json& payload);
    void handleShadowQuery(
        AgentCore& agent,
        const nlohmann::json& payload,
        const std::string& actualCommandType);

private:
    void configureLlmForPayload_(
        LocalLlmClient& llm,
        const nlohmann::json& payload,
        bool useRouterModel) const;
    SkillSelection chooseSkill_(
        const LocalLlmClient& llm,
        const nlohmann::json& payload,
        const std::string& userMessage,
        bool allowHeuristicFallback,
        const nlohmann::json& conversationContext) const;
    SkillSelection chooseHeuristicSkill_(
        const nlohmann::json& payload,
        const std::string& userMessage,
        const nlohmann::json& conversationContext) const;
    nlohmann::json loadConversationContext_(
        AgentCore& agent,
        const nlohmann::json& payload) const;
    nlohmann::json compactConversationContextIfNeeded_(
        const LocalLlmClient& llm,
        AgentCore& agent,
        const nlohmann::json& payload,
        nlohmann::json conversationContext) const;
    bool persistConversationContext_(
        AgentCore& agent,
        const nlohmann::json& payload,
        const nlohmann::json& conversationContext) const;
    bool finalizeAsChatMessage_(
        AgentCore& agent,
        const nlohmann::json& payload,
        const SkillSelection& selection,
        const SkillRunResult& result) const;
    void recordRoutingTelemetry_(
        AgentCore& agent,
        const nlohmann::json& payload,
        const SkillSelection& selection,
        const std::string& routingMode,
        const std::string& actualCommandType) const;
    std::string buildRouterFailureAnswer_(const std::string& languageHint) const;
    std::string buildCapabilityUnavailableAnswer_(const std::string& languageHint) const;
    std::string buildComingSoonAnswer_(
        const std::string& languageHint,
        const std::string& capabilityLabel) const;
    std::string buildGeneralAnswer_(
        const LocalLlmClient& llm,
        const nlohmann::json& payload,
        const SkillSelection& selection,
        const std::string& userMessage,
        const nlohmann::json& conversationContext) const;
    std::string polishAndSanitizeAnswer_(
        const LocalLlmClient& llm,
        const nlohmann::json& payload,
        const SkillSelection& selection,
        const std::string& draftAnswer,
        const nlohmann::json& conversationContext) const;
    std::string sanitizeUserFacingAnswer_(const std::string& answer) const;
    std::string buildLlmUnavailableAnswer_() const;

    SkillRegistry registry_;
    bool shadowModeEnabled_ = true;
};

} // namespace chatv2

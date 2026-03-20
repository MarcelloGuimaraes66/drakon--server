#pragma once

#include <string>

#include <nlohmann/json.hpp>

#include "LocalLlmClient.h"
#include "LocalLlmRuntimeManager.h"
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
    SkillSelection chooseSkill_(
        const nlohmann::json& payload,
        const std::string& userMessage,
        bool allowHeuristicFallback) const;
    SkillSelection chooseHeuristicSkill_(
        const nlohmann::json& payload,
        const std::string& userMessage) const;
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
    std::string buildCapabilityUnavailableAnswer_(const std::string& languageHint) const;
    std::string buildComingSoonAnswer_(
        const std::string& languageHint,
        const std::string& capabilityLabel) const;
    std::string buildGeneralAnswer_(
        const nlohmann::json& payload,
        const SkillSelection& selection,
        const std::string& userMessage) const;
    std::string polishAndSanitizeAnswer_(
        const nlohmann::json& payload,
        const SkillSelection& selection,
        const std::string& draftAnswer) const;
    std::string sanitizeUserFacingAnswer_(const std::string& answer) const;
    std::string buildLlmUnavailableAnswer_() const;

    LocalLlmRuntimeManager runtimeManager_;
    LocalLlmClient llm_;
    SkillRegistry registry_;
    bool shadowModeEnabled_ = true;
};

} // namespace chatv2

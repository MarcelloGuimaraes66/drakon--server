#pragma once

#include <memory>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

class AgentCore;

namespace chatv2 {

enum class SkillExecutionStatus {
    Completed,
    Delegated,
    Failed,
};

struct SkillDefinition {
    std::string name;
    std::string description;
    bool implemented = false;
};

struct SkillSelection {
    std::string selectedSkill;
    double confidence = 0.0;
    std::string reason;
    std::string replyPreview;
    std::string replyLanguage;
    double replyLanguageConfidence = 0.0;
    std::string knowledgeLanguage = "en";
    bool knowledgeLanguageFallback = true;
    std::string mode;
    std::string entity;
    std::string intent;
    std::string intentFamily;
    std::string plannerMode;
    std::string routeVersion = "v2";
    nlohmann::json routeHints = nlohmann::json::object();
    bool continueActiveTask = false;
    bool groundingRequired = false;
    std::string operationType;
    std::string operationPhase;
    std::string taskGoal;
    nlohmann::json draftPatch = nlohmann::json::object();
    std::vector<std::string> missingFieldsGuess;
    std::vector<std::string> supportingTopics;
    nlohmann::json arguments = nlohmann::json::object();
    bool fromModel = false;
};

struct SkillRunResult {
    SkillExecutionStatus status = SkillExecutionStatus::Failed;
    std::string skillName;
    std::string answer;
    std::string error;
    nlohmann::json metadata = nlohmann::json::object();
};

class IChatV2Skill {
public:
    virtual ~IChatV2Skill() = default;
    virtual SkillDefinition definition() const = 0;
    virtual SkillRunResult execute(
        AgentCore& agent,
        const nlohmann::json& payload,
        const SkillSelection& selection) = 0;
};

} // namespace chatv2

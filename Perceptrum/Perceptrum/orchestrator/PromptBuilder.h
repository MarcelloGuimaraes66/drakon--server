#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "SkillTypes.h"

namespace chatv2 {

std::string buildRoutingSystemPrompt(const std::vector<SkillDefinition>& skills);
std::string buildRoutingUserPrompt(
    const std::string& userMessage,
    const nlohmann::json& requestContext);
std::string buildLanguageDetectionSystemPrompt();
std::string buildLanguageDetectionUserPrompt(
    const std::string& userMessage,
    const std::string& appLanguage);
std::string normalizeAssistantLanguageTag(const std::string& languageHint);
std::string normalizeReplyLanguageTag(
    const std::string& languageHint,
    const std::string& fallback = std::string());
std::string buildUserFacingAnswerSystemPrompt();
std::string buildUserFacingAnswerUserPrompt(
    const std::string& userMessage,
    const std::string& draftAnswer,
    const std::string& replyLanguage,
    const std::string& knowledgeLanguage,
    const std::string& appLanguage,
    const std::string& selectedSkill);
std::string buildDirectAnswerSystemPrompt();
std::string buildDirectAnswerUserPrompt(
    const std::string& userMessage,
    const std::string& replyLanguage,
    const std::string& knowledgeLanguage,
    const std::string& appLanguage,
    const std::string& selectedSkill);

} // namespace chatv2

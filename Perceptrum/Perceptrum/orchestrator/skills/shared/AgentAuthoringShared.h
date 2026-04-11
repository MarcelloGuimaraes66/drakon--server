#pragma once

#include <cstddef>
#include <string>

#include <nlohmann/json.hpp>

#include "../../HttpUtils.h"
#include "../../SkillTypes.h"

class AgentCore;

namespace chatv2 {

class LocalLlmClient;

namespace shared {

std::string trimText(std::string value);
std::string lowerAscii(std::string value);
std::string normalizeInlineWhitespace(std::string value);
std::string slugifyKey(std::string value, const std::string& fallback);
std::string jsonStringField(const nlohmann::json& value, const char* key);
bool tryJsonIntField(const nlohmann::json& value, const char* key, int& outValue);
bool readBoolLoose(const nlohmann::json& value, bool& outValue);

std::string clientIdFromPayload(const nlohmann::json& payload);
nlohmann::json loadConversationContext(AgentCore& agent, const nlohmann::json& payload);
std::string effectiveReplyLanguage(
    const SkillSelection& selection,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext);
void configureActionModelClient(LocalLlmClient& llm, const nlohmann::json& payload);
std::string parseErrorMessage(const HttpResponse& response);

nlohmann::json fetchCameraInventory(AgentCore& agent, const nlohmann::json& payload);
nlohmann::json fetchJobInventory(AgentCore& agent, const nlohmann::json& payload);
nlohmann::json fetchAuthoringContext(AgentCore& agent, const nlohmann::json& payload);
nlohmann::json fetchJobSnapshot(AgentCore& agent, const nlohmann::json& payload, int jobId);
nlohmann::json compactAuthoringContextForPrompt(
    const nlohmann::json& authoringContext,
    std::size_t cameraLimit = 40,
    std::size_t jobLimit = 30,
    std::size_t stepLimit = 40,
    std::size_t agentLimit = 60);
nlohmann::json fetchReferenceTargets(AgentCore& agent, const nlohmann::json& payload);
nlohmann::json resolveCamera(
    const nlohmann::json& inventory,
    const nlohmann::json& selector,
    const nlohmann::json& activeResolved = nlohmann::json::object());
nlohmann::json resolveJob(
    const nlohmann::json& inventory,
    const nlohmann::json& selector,
    const nlohmann::json& activeResolved = nlohmann::json::object());
nlohmann::json resolveNamedReference(
    const nlohmann::json& inventory,
    const nlohmann::json& requestedRefs,
    bool allowTraits);

nlohmann::json designAgentSnapshot(
    AgentCore& agent,
    const nlohmann::json& payload,
    const std::string& language,
    int cameraId,
    const std::string& goalSummary,
    const nlohmann::json& agentPatch,
    const nlohmann::json& faceTargets,
    const nlohmann::json& drakonFindTargets,
    const nlohmann::json& designContext,
    bool requireSnapshot,
    std::string& outError);

} // namespace shared
} // namespace chatv2

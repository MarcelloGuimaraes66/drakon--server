#include "LocalLlmClient.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <sstream>
#include <utility>

#include "ConfigUtils.h"
#include "HttpUtils.h"
#include "PromptBuilder.h"
#include "../logging/Logging.h"

namespace chatv2 {

namespace {

std::string normalizeChatCompletionsUrl_(std::string baseUrl)
{
    baseUrl = trimCopy(std::move(baseUrl));
    while (!baseUrl.empty() && baseUrl.back() == '/') {
        baseUrl.pop_back();
    }

    const std::string suffix = "/v1/chat/completions";
    if (baseUrl.size() >= suffix.size() &&
        baseUrl.compare(baseUrl.size() - suffix.size(), suffix.size(), suffix) == 0) {
        return baseUrl;
    }
    return baseUrl + suffix;
}

std::string extractJsonObject_(const std::string& content)
{
    const std::size_t firstBrace = content.find('{');
    const std::size_t lastBrace = content.rfind('}');
    if (firstBrace == std::string::npos || lastBrace == std::string::npos || lastBrace < firstBrace) {
        return "";
    }
    return content.substr(firstBrace, lastBrace - firstBrace + 1);
}

double clampConfidence_(double value)
{
    if (value < 0.0) return 0.0;
    if (value > 1.0) return 1.0;
    return value;
}

std::string truncateForLog_(std::string value, std::size_t maxLength = 240)
{
    value = trimCopy(std::move(value));
    if (value.size() <= maxLength) {
        return value;
    }
    if (maxLength <= 3) {
        return value.substr(0, maxLength);
    }
    return value.substr(0, maxLength - 3) + "...";
}

void appendTextContent_(const nlohmann::json& node, std::string& out)
{
    if (node.is_string()) {
        if (!out.empty()) {
            out.push_back('\n');
        }
        out += node.get<std::string>();
        return;
    }

    if (node.is_array()) {
        for (const auto& item : node) {
            appendTextContent_(item, out);
        }
        return;
    }

    if (!node.is_object()) {
        return;
    }

    if (node.contains("text") && node["text"].is_string()) {
        if (!out.empty()) {
            out.push_back('\n');
        }
        out += node["text"].get<std::string>();
        return;
    }

    if (node.contains("content")) {
        appendTextContent_(node["content"], out);
    }
}

const nlohmann::json* firstChoice_(const nlohmann::json& parsed)
{
    if (!parsed.is_object() ||
        !parsed.contains("choices") ||
        !parsed["choices"].is_array() ||
        parsed["choices"].empty() ||
        !parsed["choices"][0].is_object()) {
        return nullptr;
    }

    return &parsed["choices"][0];
}

std::string extractMessageContent_(const nlohmann::json& parsed)
{
    const nlohmann::json* choice = firstChoice_(parsed);
    if (!choice ||
        !choice->contains("message") ||
        !(*choice)["message"].is_object() ||
        !(*choice)["message"].contains("content")) {
        return "";
    }

    std::string content;
    appendTextContent_((*choice)["message"]["content"], content);
    return trimCopy(content);
}

std::string extractReasoningContent_(const nlohmann::json& parsed)
{
    const nlohmann::json* choice = firstChoice_(parsed);
    if (!choice ||
        !choice->contains("message") ||
        !(*choice)["message"].is_object() ||
        !(*choice)["message"].contains("reasoning_content")) {
        return "";
    }

    std::string content;
    appendTextContent_((*choice)["message"]["reasoning_content"], content);
    return trimCopy(content);
}

std::string extractFinishReason_(const nlohmann::json& parsed)
{
    const nlohmann::json* choice = firstChoice_(parsed);
    if (!choice || !choice->contains("finish_reason") || !(*choice)["finish_reason"].is_string()) {
        return "";
    }
    return (*choice)["finish_reason"].get<std::string>();
}

int parsePositiveInt_(
    const char* envName,
    const std::vector<std::string>& fileNames,
    int defaultValue,
    int minValue,
    int maxValue)
{
    return parseIntValue(loadConfigValue(envName, fileNames), defaultValue, minValue, maxValue);
}

void logCompletionAttempt_(
    const std::string& operation,
    int attempt,
    long timeoutMs,
    long elapsedMs,
    const HttpResponse& response,
    const std::string& content,
    const std::string& reasoningContent,
    const std::string& finishReason,
    const std::string& parseError)
{
    std::ostringstream out;
    out
        << "LocalLlmClient::" << operation
        << " attempt=" << attempt
        << " timeout_ms=" << timeoutMs
        << " elapsed_ms=" << elapsedMs
        << " http=" << response.statusCode;

    if (!response.error.empty()) {
        out << " error=" << truncateForLog_(response.error, 120);
    }
    if (!parseError.empty()) {
        out << " parse_error=" << parseError;
    }
    if (!finishReason.empty()) {
        out << " finish_reason=" << finishReason;
    }
    if (!content.empty()) {
        out << " content_preview=" << truncateForLog_(content);
    }
    if (content.empty() && !reasoningContent.empty()) {
        out << " reasoning_only_preview=" << truncateForLog_(reasoningContent);
    }
    if (content.empty() && response.ok()) {
        out << " raw_preview=" << truncateForLog_(response.body);
    }

    Logger::instance().logDebugNoEscalation("agent", out.str());
}

std::string structuredJsonFromOutcome_(
    const LocalLlmClient::CompletionOutcome& outcome,
    const std::string& operation)
{
    if (outcome.ok) {
        return outcome.content;
    }

    if (outcome.error != "reasoning_without_message_content") {
        return "";
    }

    const std::string reasoning = trimCopy(outcome.reasoningContent);
    const std::string jsonObject = extractJsonObject_(reasoning);
    if (jsonObject.empty() || reasoning != jsonObject) {
        return "";
    }

    Logger::instance().logDebugNoEscalation(
        "agent",
        "LocalLlmClient::" + operation +
            " using_reasoning_json_fallback content_preview=" +
            truncateForLog_(jsonObject));
    return jsonObject;
}

std::string trimLowerCopy_(std::string value)
{
    value = trimCopy(std::move(value));
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

void parseStringArrayField_(
    const nlohmann::json& source,
    const char* key,
    std::vector<std::string>& destination)
{
    if (!source.contains(key) || !source[key].is_array()) {
        return;
    }

    for (const auto& item : source[key]) {
        if (!item.is_string()) {
            continue;
        }
        const std::string value = trimCopy(item.get<std::string>());
        if (!value.empty()) {
            destination.push_back(value);
        }
        if (destination.size() >= 16) {
            break;
        }
    }
}

bool parseBoolField_(const nlohmann::json& source, const char* key, bool fallbackValue)
{
    if (!source.contains(key)) {
        return fallbackValue;
    }
    try {
        if (source[key].is_boolean()) {
            return source[key].get<bool>();
        }
        if (source[key].is_number_integer()) {
            return source[key].get<int>() != 0;
        }
        if (source[key].is_string()) {
            const std::string normalized = trimLowerCopy_(source[key].get<std::string>());
            if (normalized == "true" || normalized == "1" || normalized == "yes") {
                return true;
            }
            if (normalized == "false" || normalized == "0" || normalized == "no") {
                return false;
            }
        }
    }
    catch (...) {
    }
    return fallbackValue;
}

bool populateSkillSelectionFromStructured_(
    const nlohmann::json& structured,
    SkillSelection& selection,
    const std::string& logPreview,
    const std::string& parseErrorSource)
{
    if (!structured.is_object() ||
        !structured.contains("selected_skill") ||
        !structured["selected_skill"].is_string()) {
        Logger::instance().logDebugNoEscalation(
            "agent",
            "LocalLlmClient::chooseSkill parse_error=missing_selected_skill " +
                parseErrorSource + "=" + truncateForLog_(logPreview));
        return false;
    }

    selection.selectedSkill = trimCopy(structured["selected_skill"].get<std::string>());
    if (selection.selectedSkill.empty()) {
        Logger::instance().logDebugNoEscalation(
            "agent",
            "LocalLlmClient::chooseSkill parse_error=empty_selected_skill " +
                parseErrorSource + "=" + truncateForLog_(logPreview));
        return false;
    }

    if (structured.contains("confidence")) {
        try {
            selection.confidence = clampConfidence_(structured["confidence"].get<double>());
        }
        catch (...) {
            selection.confidence = 0.0;
        }
    }

    if (structured.contains("reason") && structured["reason"].is_string()) {
        selection.reason = structured["reason"].get<std::string>();
    }
    if (structured.contains("reply_preview") && structured["reply_preview"].is_string()) {
        selection.replyPreview = structured["reply_preview"].get<std::string>();
    }
    if (structured.contains("reply_language") && structured["reply_language"].is_string()) {
        selection.replyLanguage =
            normalizeReplyLanguageTag(structured["reply_language"].get<std::string>());
    }
    if (structured.contains("reply_language_confidence")) {
        try {
            selection.replyLanguageConfidence =
                clampConfidence_(structured["reply_language_confidence"].get<double>());
        }
        catch (...) {
            selection.replyLanguageConfidence = 0.0;
        }
    }
    if (structured.contains("knowledge_language") && structured["knowledge_language"].is_string()) {
        selection.knowledgeLanguage =
            normalizeAssistantLanguageTag(structured["knowledge_language"].get<std::string>());
    }
    if (structured.contains("knowledge_fallback")) {
        selection.knowledgeLanguageFallback =
            parseBoolField_(structured, "knowledge_fallback", true);
    }

    if (structured.contains("mode") && structured["mode"].is_string()) {
        selection.mode = trimLowerCopy_(structured["mode"].get<std::string>());
    }
    if (structured.contains("entity") && structured["entity"].is_string()) {
        selection.entity = trimLowerCopy_(structured["entity"].get<std::string>());
    }
    if (structured.contains("intent") && structured["intent"].is_string()) {
        selection.intent = trimLowerCopy_(structured["intent"].get<std::string>());
    }
    selection.continueActiveTask =
        parseBoolField_(structured, "continue_active_task", false);
    selection.groundingRequired =
        parseBoolField_(structured, "grounding_required", false);
    if (structured.contains("operation_type") && structured["operation_type"].is_string()) {
        selection.operationType = trimCopy(structured["operation_type"].get<std::string>());
    }
    if (structured.contains("operation_phase") && structured["operation_phase"].is_string()) {
        selection.operationPhase = trimCopy(structured["operation_phase"].get<std::string>());
    }

    if (structured.contains("arguments") && structured["arguments"].is_object()) {
        selection.arguments = structured["arguments"];

        if (selection.arguments.contains("draft_patch") &&
            selection.arguments["draft_patch"].is_object()) {
            selection.draftPatch = selection.arguments["draft_patch"];
        }
        if (selection.arguments.contains("task_goal") &&
            selection.arguments["task_goal"].is_string()) {
            selection.taskGoal = selection.arguments["task_goal"].get<std::string>();
        }
        if (selection.operationType.empty() &&
            selection.arguments.contains("operation_type") &&
            selection.arguments["operation_type"].is_string()) {
            selection.operationType = selection.arguments["operation_type"].get<std::string>();
        }
        if (selection.operationPhase.empty() &&
            selection.arguments.contains("operation_phase") &&
            selection.arguments["operation_phase"].is_string()) {
            selection.operationPhase = selection.arguments["operation_phase"].get<std::string>();
        }

        parseStringArrayField_(
            selection.arguments,
            "missing_fields_guess",
            selection.missingFieldsGuess);
        parseStringArrayField_(
            selection.arguments,
            "supporting_topics",
            selection.supportingTopics);
    }

    if (structured.contains("draft_patch") && structured["draft_patch"].is_object()) {
        selection.draftPatch = structured["draft_patch"];
    }
    if (selection.taskGoal.empty() &&
        structured.contains("task_goal") &&
        structured["task_goal"].is_string()) {
        selection.taskGoal = structured["task_goal"].get<std::string>();
    }
    if (selection.operationType.empty() &&
        structured.contains("operation_type") &&
        structured["operation_type"].is_string()) {
        selection.operationType = structured["operation_type"].get<std::string>();
    }
    if (selection.operationPhase.empty() &&
        structured.contains("operation_phase") &&
        structured["operation_phase"].is_string()) {
        selection.operationPhase = structured["operation_phase"].get<std::string>();
    }

    parseStringArrayField_(structured, "missing_fields_guess", selection.missingFieldsGuess);
    parseStringArrayField_(structured, "supporting_topics", selection.supportingTopics);

    selection.fromModel = true;
    return true;
}

} // namespace

LocalLlmClient::LocalLlmClient()
{
    config_.baseUrl = normalizeChatCompletionsUrl_(
        loadConfigValue("CHATV2_LLM_BASE_URL", { "chatv2_llm_base_url.txt" }));
    config_.apiKey = loadConfigValue("CHATV2_LLM_API_KEY", { "chatv2_llm_api_key.txt" });

    const std::string configuredModel =
        loadConfigValue("CHATV2_LLM_MODEL", { "chatv2_llm_model.txt" });
    if (!configuredModel.empty()) {
        config_.model = configuredModel;
    }

    config_.timeoutMs = parsePositiveInt_(
        "CHATV2_LLM_TIMEOUT_MS",
        { "chatv2_llm_timeout_ms.txt" },
        static_cast<int>(config_.timeoutMs),
        1000,
        300000);
    config_.routingTimeoutMs = parsePositiveInt_(
        "CHATV2_LLM_ROUTING_TIMEOUT_MS",
        { "chatv2_llm_routing_timeout_ms.txt" },
        (std::max)(static_cast<int>(config_.timeoutMs), 18000),
        1000,
        300000);
    config_.languageTimeoutMs = parsePositiveInt_(
        "CHATV2_LLM_LANGUAGE_TIMEOUT_MS",
        { "chatv2_llm_language_timeout_ms.txt" },
        8000,
        1000,
        120000);
    config_.answerTimeoutMs = parsePositiveInt_(
        "CHATV2_LLM_ANSWER_TIMEOUT_MS",
        { "chatv2_llm_answer_timeout_ms.txt" },
        (std::max)(30000, static_cast<int>(config_.timeoutMs)),
        1000,
        300000);
    config_.routingRetries = parsePositiveInt_(
        "CHATV2_LLM_ROUTING_RETRIES",
        { "chatv2_llm_routing_retries.txt" },
        config_.routingRetries,
        0,
        3);
    config_.languageRetries = parsePositiveInt_(
        "CHATV2_LLM_LANGUAGE_RETRIES",
        { "chatv2_llm_language_retries.txt" },
        config_.languageRetries,
        0,
        3);
    config_.answerRetries = parsePositiveInt_(
        "CHATV2_LLM_ANSWER_RETRIES",
        { "chatv2_llm_answer_retries.txt" },
        config_.answerRetries,
        0,
        3);

    config_.enabled = !config_.baseUrl.empty();
}

bool LocalLlmClient::isConfigured() const
{
    const Config configSnapshot = effectiveConfigSnapshot_();
    return configSnapshot.enabled && !trimCopy(configSnapshot.baseUrl).empty();
}

bool LocalLlmClient::hasStoredConfiguration() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.enabled;
}

void LocalLlmClient::setRequestOverride(const Config& config)
{
    std::lock_guard<std::mutex> lock(mutex_);
    requestOverride_ = config;
    requestOverride_.baseUrl = normalizeChatCompletionsUrl_(trimCopy(requestOverride_.baseUrl));
    requestOverride_.apiKey = trimCopy(requestOverride_.apiKey);
    requestOverride_.model = trimCopy(requestOverride_.model);
    requestOverride_.enabled =
        !requestOverride_.baseUrl.empty() &&
        !requestOverride_.apiKey.empty() &&
        !requestOverride_.model.empty();
    requestOverrideActive_ = true;
}

void LocalLlmClient::clearRequestOverride()
{
    std::lock_guard<std::mutex> lock(mutex_);
    requestOverride_ = Config{};
    requestOverrideActive_ = false;
}

void LocalLlmClient::setEndpointOverride(const std::string& baseUrl)
{
    std::lock_guard<std::mutex> lock(mutex_);
    endpointOverride_ = normalizeChatCompletionsUrl_(baseUrl);
    config_.enabled = !endpointOverride_.empty() || !config_.baseUrl.empty();
}

void LocalLlmClient::clearEndpointOverride()
{
    std::lock_guard<std::mutex> lock(mutex_);
    endpointOverride_.clear();
    config_.enabled = !config_.baseUrl.empty();
}

LocalLlmClient::Config LocalLlmClient::effectiveConfigSnapshot_() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    Config configSnapshot = config_;
    if (requestOverrideActive_) {
        configSnapshot.baseUrl = requestOverride_.baseUrl;
        configSnapshot.apiKey = requestOverride_.apiKey;
        configSnapshot.model = requestOverride_.model;
        configSnapshot.enabled = requestOverride_.enabled;
    }
    else if (!endpointOverride_.empty()) {
        configSnapshot.baseUrl = endpointOverride_;
        configSnapshot.enabled = !configSnapshot.baseUrl.empty();
    }
    return configSnapshot;
}

std::string LocalLlmClient::effectiveBaseUrl_() const
{
    return effectiveConfigSnapshot_().baseUrl;
}

LocalLlmClient::CompletionOutcome LocalLlmClient::requestCompletion_(
    const std::string& operation,
    const nlohmann::json& body,
    long timeoutMs,
    int retries) const
{
    CompletionOutcome outcome;

    const Config configSnapshot = effectiveConfigSnapshot_();
    const std::string baseUrl = configSnapshot.baseUrl;
    if (baseUrl.empty()) {
        outcome.error = "missing_base_url";
        return outcome;
    }

    const int attemptLimit = (std::max)(0, retries) + 1;
    for (int attempt = 1; attempt <= attemptLimit; ++attempt) {
        outcome.ok = false;
        outcome.content.clear();
        outcome.reasoningContent.clear();
        outcome.finishReason.clear();
        outcome.error.clear();
        const auto startedAt = std::chrono::steady_clock::now();
        const HttpResponse response = postJson(
            baseUrl,
            body.dump(),
            configSnapshot.apiKey,
            {},
            timeoutMs);
        const long elapsedMs = static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - startedAt).count());

        outcome.attemptCount = attempt;
        outcome.timeoutMs = timeoutMs;
        outcome.elapsedMs = elapsedMs;
        outcome.statusCode = static_cast<int>(response.statusCode);

        if (!response.ok()) {
            outcome.error = response.error.empty()
                ? ("http_status_" + std::to_string(response.statusCode))
                : response.error;
            logCompletionAttempt_(
                operation,
                attempt,
                timeoutMs,
                elapsedMs,
                response,
                "",
                "",
                "",
                "");
            continue;
        }

        const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
        if (!parsed.is_object()) {
            outcome.error = "invalid_json_response";
            logCompletionAttempt_(
                operation,
                attempt,
                timeoutMs,
                elapsedMs,
                response,
                "",
                "",
                "",
                "invalid_json_response");
            continue;
        }

        outcome.content = extractMessageContent_(parsed);
        outcome.reasoningContent = extractReasoningContent_(parsed);
        outcome.finishReason = extractFinishReason_(parsed);
        if (outcome.content.empty()) {
            outcome.error = outcome.reasoningContent.empty()
                ? "empty_message_content"
                : "reasoning_without_message_content";
            logCompletionAttempt_(
                operation,
                attempt,
                timeoutMs,
                elapsedMs,
                response,
                outcome.content,
                outcome.reasoningContent,
                outcome.finishReason,
                outcome.error);
            continue;
        }

        outcome.ok = true;
        outcome.error.clear();
        logCompletionAttempt_(
            operation,
            attempt,
            timeoutMs,
            elapsedMs,
            response,
            outcome.content,
            outcome.reasoningContent,
            outcome.finishReason,
            "");
        return outcome;
    }

    return outcome;
}

std::string LocalLlmClient::detectReplyLanguage(
    const std::string& userMessage,
    const std::string& appLanguage) const
{
    if (userMessage.empty()) {
        return "";
    }

    const Config configSnapshot = effectiveConfigSnapshot_();

    nlohmann::json body = {
        { "model", configSnapshot.model },
        { "messages", nlohmann::json::array({
            {
                { "role", "system" },
                { "content", buildLanguageDetectionSystemPrompt() },
            },
            {
                { "role", "user" },
                { "content", buildLanguageDetectionUserPrompt(userMessage, appLanguage) },
            },
        }) },
        { "temperature", 0.0 },
        { "max_tokens", 32 },
        { "response_format", {
            { "type", "json_object" }
        } },
    };

    const CompletionOutcome outcome = requestCompletion_(
        "detectReplyLanguage",
        body,
        configSnapshot.languageTimeoutMs,
        configSnapshot.languageRetries);
    if (!outcome.ok) {
        const std::string fallbackContent = structuredJsonFromOutcome_(
            outcome,
            "detectReplyLanguage");
        if (fallbackContent.empty()) {
            return "";
        }

        const nlohmann::json structured = nlohmann::json::parse(fallbackContent, nullptr, false);
        if (!structured.is_object() ||
            !structured.contains("reply_language") ||
            !structured["reply_language"].is_string()) {
            Logger::instance().logDebugNoEscalation(
                "agent",
                "LocalLlmClient::detectReplyLanguage parse_error=missing_reply_language reasoning_preview=" +
                truncateForLog_(fallbackContent));
            return "";
        }

        double confidence = 0.0;
        if (structured.contains("confidence")) {
            try {
                confidence = clampConfidence_(structured["confidence"].get<double>());
            }
            catch (...) {
                confidence = 0.0;
            }
        }

        const std::string language =
            normalizeAssistantLanguageTag(structured["reply_language"].get<std::string>());
        if (!language.empty() && confidence < 0.35) {
            Logger::instance().logDebugNoEscalation(
                "agent",
                "LocalLlmClient::detectReplyLanguage low_confidence_keep language=" +
                    language + " confidence=" + std::to_string(confidence));
        }

        return language;
    }

    const std::string jsonObject = extractJsonObject_(outcome.content);
    if (jsonObject.empty()) {
        Logger::instance().logDebugNoEscalation(
            "agent",
            "LocalLlmClient::detectReplyLanguage parse_error=missing_json_object content_preview=" +
            truncateForLog_(outcome.content));
        return "";
    }

    const nlohmann::json structured = nlohmann::json::parse(jsonObject, nullptr, false);
    if (!structured.is_object() ||
        !structured.contains("reply_language") ||
        !structured["reply_language"].is_string()) {
        Logger::instance().logDebugNoEscalation(
            "agent",
            "LocalLlmClient::detectReplyLanguage parse_error=missing_reply_language content_preview=" +
            truncateForLog_(outcome.content));
        return "";
    }

    double confidence = 0.0;
    if (structured.contains("confidence")) {
        try {
            confidence = clampConfidence_(structured["confidence"].get<double>());
        }
        catch (...) {
            confidence = 0.0;
        }
    }

    const std::string language =
        normalizeAssistantLanguageTag(structured["reply_language"].get<std::string>());
    if (!language.empty() && confidence < 0.35) {
        Logger::instance().logDebugNoEscalation(
            "agent",
            "LocalLlmClient::detectReplyLanguage low_confidence_keep language=" +
                language + " confidence=" + std::to_string(confidence));
    }

    return language;
}

SkillSelection LocalLlmClient::chooseSkill(
    const std::string& userMessage,
    const nlohmann::json& requestContext,
    const std::vector<SkillDefinition>& skills) const
{
    SkillSelection selection;
    if (userMessage.empty()) {
        return selection;
    }

    const Config configSnapshot = effectiveConfigSnapshot_();

    nlohmann::json body = {
        { "model", configSnapshot.model },
        { "messages", nlohmann::json::array({
            {
                { "role", "system" },
                { "content", buildRoutingSystemPrompt(skills) },
            },
            {
                { "role", "user" },
                { "content", buildRoutingUserPrompt(userMessage, requestContext) },
            },
        }) },
        { "temperature", 0.1 },
        { "max_tokens", 340 },
        { "response_format", {
            { "type", "json_object" }
        } },
    };

    const CompletionOutcome outcome = requestCompletion_(
        "chooseSkill",
        body,
        configSnapshot.routingTimeoutMs,
        configSnapshot.routingRetries);
    if (!outcome.ok) {
        const std::string fallbackContent = structuredJsonFromOutcome_(outcome, "chooseSkill");
        if (fallbackContent.empty()) {
            return selection;
        }

        const nlohmann::json structured = nlohmann::json::parse(fallbackContent, nullptr, false);
        if (!populateSkillSelectionFromStructured_(
                structured,
                selection,
                fallbackContent,
                "reasoning_preview")) {
            return SkillSelection{};
        }
        return selection;
    }

    const std::string jsonObject = extractJsonObject_(outcome.content);
    if (jsonObject.empty()) {
        Logger::instance().logDebugNoEscalation(
            "agent",
            "LocalLlmClient::chooseSkill parse_error=missing_json_object content_preview=" +
            truncateForLog_(outcome.content));
        return selection;
    }

    const nlohmann::json structured = nlohmann::json::parse(jsonObject, nullptr, false);
    if (!populateSkillSelectionFromStructured_(
            structured,
            selection,
            outcome.content,
            "content_preview")) {
        return SkillSelection{};
    }
    return selection;
}

std::string LocalLlmClient::polishAnswer(
    const std::string& userMessage,
    const std::string& draftAnswer,
    const nlohmann::json& conversationContext,
    const std::string& replyLanguage,
    const std::string& knowledgeLanguage,
    const std::string& appLanguage,
    const std::string& selectedSkill) const
{
    if (draftAnswer.empty()) {
        return "";
    }

    const Config configSnapshot = effectiveConfigSnapshot_();

    nlohmann::json body = {
        { "model", configSnapshot.model },
        { "messages", nlohmann::json::array({
            {
                { "role", "system" },
                { "content", buildUserFacingAnswerSystemPrompt() },
            },
            {
                { "role", "user" },
                { "content", buildUserFacingAnswerUserPrompt(
                    userMessage,
                    draftAnswer,
                    conversationContext,
                    replyLanguage,
                    knowledgeLanguage,
                    appLanguage,
                    selectedSkill) },
            },
        }) },
        { "temperature", 0.15 },
        { "max_tokens", 480 },
    };

    const CompletionOutcome outcome = requestCompletion_(
        "polishAnswer",
        body,
        configSnapshot.answerTimeoutMs,
        configSnapshot.answerRetries);
    if (!outcome.ok) {
        return "";
    }

    return trimCopy(outcome.content);
}

std::string LocalLlmClient::answerDirectly(
    const std::string& userMessage,
    const nlohmann::json& conversationContext,
    const std::string& replyLanguage,
    const std::string& knowledgeLanguage,
    const std::string& appLanguage,
    const std::string& selectedSkill) const
{
    if (userMessage.empty()) {
        return "";
    }

    const Config configSnapshot = effectiveConfigSnapshot_();

    nlohmann::json body = {
        { "model", configSnapshot.model },
        { "messages", nlohmann::json::array({
            {
                { "role", "system" },
                { "content", buildDirectAnswerSystemPrompt() },
            },
            {
                { "role", "user" },
                { "content", buildDirectAnswerUserPrompt(
                    userMessage,
                    conversationContext,
                    replyLanguage,
                    knowledgeLanguage,
                    appLanguage,
                    selectedSkill) },
            },
        }) },
        { "temperature", 0.2 },
        { "max_tokens", 480 },
    };

    const CompletionOutcome outcome = requestCompletion_(
        "answerDirectly",
        body,
        configSnapshot.answerTimeoutMs,
        configSnapshot.answerRetries);
    if (!outcome.ok) {
        return "";
    }

    return trimCopy(outcome.content);
}

nlohmann::json LocalLlmClient::compactConversationContext(
    const nlohmann::json& existingCompactContext,
    const nlohmann::json& messagesToCompact,
    const std::string& appLanguage) const
{
    if (!messagesToCompact.is_array() || messagesToCompact.empty()) {
        return nlohmann::json::object();
    }

    CompletionOutcome outcome = completeText(
        "compactConversationContext",
        buildConversationCompactionSystemPrompt(),
        buildConversationCompactionUserPrompt(
            existingCompactContext,
            messagesToCompact,
            appLanguage),
        0.1,
        700,
        0,
        -1,
        true);

    if (!outcome.ok) {
        const std::string fallbackContent = structuredJsonFromOutcome_(
            outcome,
            "compactConversationContext");
        if (fallbackContent.empty()) {
            return nlohmann::json::object();
        }
        const nlohmann::json parsed = nlohmann::json::parse(fallbackContent, nullptr, false);
        return parsed.is_object() ? parsed : nlohmann::json::object();
    }

    const std::string jsonObject = extractJsonObject_(outcome.content);
    if (jsonObject.empty()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(jsonObject, nullptr, false);
    return parsed.is_object() ? parsed : nlohmann::json::object();
}

LocalLlmClient::CompletionOutcome LocalLlmClient::completeText(
    const std::string& operation,
    const std::string& systemPrompt,
    const std::string& userPrompt,
    double temperature,
    int maxTokens,
    long timeoutMs,
    int retries,
    bool responseJsonObject,
    const std::string& modelName) const
{
    CompletionOutcome outcome;
    if (trimCopy(userPrompt).empty()) {
        outcome.error = "empty_user_prompt";
        return outcome;
    }

    const Config configSnapshot = effectiveConfigSnapshot_();

    const std::string effectiveModel = trimCopy(modelName).empty()
        ? configSnapshot.model
        : trimCopy(modelName);
    const long effectiveTimeout = timeoutMs > 0 ? timeoutMs : configSnapshot.answerTimeoutMs;
    const int effectiveRetries = retries >= 0 ? retries : configSnapshot.answerRetries;

    nlohmann::json body = {
        { "model", effectiveModel },
        { "messages", nlohmann::json::array({
            {
                { "role", "system" },
                { "content", systemPrompt },
            },
            {
                { "role", "user" },
                { "content", userPrompt },
            },
        }) },
        { "temperature", temperature },
        { "max_tokens", maxTokens },
    };

    if (responseJsonObject) {
        body["response_format"] = {
            { "type", "json_object" }
        };
    }

    outcome = requestCompletion_(
        operation,
        body,
        effectiveTimeout,
        effectiveRetries);
    if (!outcome.ok && responseJsonObject) {
        const std::string fallbackContent = structuredJsonFromOutcome_(outcome, operation);
        if (!fallbackContent.empty()) {
            outcome.ok = true;
            outcome.content = fallbackContent;
            outcome.error.clear();
        }
    }

    return outcome;
}

} // namespace chatv2

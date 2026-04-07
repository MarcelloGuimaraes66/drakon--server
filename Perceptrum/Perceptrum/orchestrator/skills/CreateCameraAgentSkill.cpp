#include "CreateCameraAgentSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "../../core/AgentCore.h"
#include "../ChatModelConfig.h"
#include "../HttpUtils.h"
#include "../LocalLlmClient.h"
#include "../OperationTaskState.h"
#include "../ProgressUtils.h"
#include "../PromptBuilder.h"

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

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string upperAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::toupper(ch));
    });
    return value;
}

std::string compactToken_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    std::string token;
    token.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            token.push_back(static_cast<char>(ch));
        }
    }
    return token;
}

std::string normalizeInlineWhitespace_(std::string value)
{
    std::string normalized;
    normalized.reserve(value.size());

    bool lastWasSpace = false;
    for (unsigned char ch : value) {
        if (std::isspace(ch) != 0) {
            if (!normalized.empty() && !lastWasSpace) {
                normalized.push_back(' ');
            }
            lastWasSpace = true;
            continue;
        }

        normalized.push_back(static_cast<char>(ch));
        lastWasSpace = false;
    }

    return trimCopy_(std::move(normalized));
}

std::string shortenForDisplay_(std::string value, std::size_t maxLength)
{
    value = normalizeInlineWhitespace_(std::move(value));
    if (value.size() <= maxLength) {
        return value;
    }
    if (maxLength <= 3) {
        return value.substr(0, maxLength);
    }
    return trimCopy_(value.substr(0, maxLength - 3)) + "...";
}

std::string jsonStringField_(
    const nlohmann::json& value,
    const char* key)
{
    if (!value.is_object() || !value.contains(key) || !value[key].is_string()) {
        return "";
    }
    return trimCopy_(value[key].get<std::string>());
}

bool tryJsonIntField_(
    const nlohmann::json& value,
    const char* key,
    int& outValue)
{
    if (!value.is_object() || !value.contains(key)) {
        return false;
    }

    const auto& field = value[key];
    try {
        if (field.is_number_integer()) {
            outValue = field.get<int>();
            return true;
        }
        if (field.is_number()) {
            outValue = static_cast<int>(field.get<double>());
            return true;
        }
        if (field.is_string()) {
            const std::string text = trimCopy_(field.get<std::string>());
            if (text.empty()) {
                return false;
            }
            outValue = std::stoi(text);
            return true;
        }
    }
    catch (...) {
    }
    return false;
}

bool readBoolLoose_(const nlohmann::json& value, bool& outValue)
{
    if (value.is_boolean()) {
        outValue = value.get<bool>();
        return true;
    }
    if (value.is_number_integer()) {
        outValue = value.get<int>() != 0;
        return true;
    }
    if (!value.is_string()) {
        return false;
    }

    const std::string normalized = lowerAsciiCopy_(trimCopy_(value.get<std::string>()));
    if (normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "sim") {
        outValue = true;
        return true;
    }
    if (normalized == "false" || normalized == "0" || normalized == "no" || normalized == "nao") {
        outValue = false;
        return true;
    }
    return false;
}

std::string structuredDescriptionLabel_(std::string value)
{
    value = normalizeInlineWhitespace_(std::move(value));
    if (value.empty()) {
        return "";
    }

    const std::string upper = upperAsciiCopy_(value);
    const std::string labelTag = "LABEL:";
    const std::string descriptionTag = "DESCRIPTION:";

    const std::size_t labelPos = upper.find(labelTag);
    if (labelPos == std::string::npos) {
        return "";
    }

    const std::size_t labelStart = labelPos + labelTag.size();
    const std::size_t descriptionPos = upper.find(descriptionTag, labelStart);
    return trimCopy_(
        descriptionPos == std::string::npos
            ? value.substr(labelStart)
            : value.substr(labelStart, descriptionPos - labelStart));
}

std::string structuredDescriptionBody_(std::string value)
{
    value = normalizeInlineWhitespace_(std::move(value));
    if (value.empty()) {
        return "";
    }

    const std::string upper = upperAsciiCopy_(value);
    const std::string descriptionTag = "DESCRIPTION:";
    const std::size_t descriptionPos = upper.find(descriptionTag);
    if (descriptionPos == std::string::npos) {
        return "";
    }

    return trimCopy_(value.substr(descriptionPos + descriptionTag.size()));
}

std::string entitySceneLabel_(const nlohmann::json& value)
{
    const std::string explicitLabel = jsonStringField_(value, "scene_label");
    if (!explicitLabel.empty()) {
        return explicitLabel;
    }
    return structuredDescriptionLabel_(jsonStringField_(value, "description"));
}

std::string entitySceneDescription_(const nlohmann::json& value)
{
    const std::string explicitDescription = jsonStringField_(value, "scene_description");
    if (!explicitDescription.empty()) {
        return explicitDescription;
    }

    const std::string body = structuredDescriptionBody_(jsonStringField_(value, "description"));
    if (!body.empty()) {
        return body;
    }
    return jsonStringField_(value, "description");
}

std::string humanizeSceneLabel_(std::string value)
{
    for (char& ch : value) {
        if (ch == '_' || ch == '-') {
            ch = ' ';
        }
    }
    return normalizeInlineWhitespace_(trimCopy_(std::move(value)));
}

std::string sceneSearchText_(const nlohmann::json& value)
{
    const std::string sceneLabel = entitySceneLabel_(value);
    const std::string sceneDescription = entitySceneDescription_(value);

    std::string combined;
    if (!sceneLabel.empty()) {
        combined += sceneLabel;
        const std::string humanized = humanizeSceneLabel_(sceneLabel);
        if (!humanized.empty()) {
            combined += " " + humanized;
        }
    }

    if (!sceneDescription.empty()) {
        if (!combined.empty()) {
            combined += " ";
        }
        combined += sceneDescription;
    }

    if (combined.empty()) {
        combined = jsonStringField_(value, "description");
    }

    return normalizeInlineWhitespace_(combined);
}

std::vector<std::string> semanticTokens_(std::string value)
{
    value = lowerAsciiCopy_(normalizeInlineWhitespace_(std::move(value)));
    std::vector<std::string> tokens;
    std::string current;

    auto flush = [&]() {
        if (current.size() > 1 &&
            std::find(tokens.begin(), tokens.end(), current) == tokens.end()) {
            tokens.push_back(current);
        }
        current.clear();
    };

    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            current.push_back(static_cast<char>(ch));
            continue;
        }
        flush();
    }
    flush();
    return tokens;
}

bool containsAllSemanticTokens_(
    const std::vector<std::string>& candidateTokens,
    const std::vector<std::string>& queryTokens)
{
    if (candidateTokens.empty() || queryTokens.empty()) {
        return false;
    }

    for (const auto& token : queryTokens) {
        if (std::find(candidateTokens.begin(), candidateTokens.end(), token) == candidateTokens.end()) {
            return false;
        }
    }
    return true;
}

bool weakTokenMatch_(
    const std::string& candidate,
    const std::string& selector)
{
    if (candidate.empty() || selector.empty()) {
        return false;
    }
    if (candidate.size() < 4 || selector.size() < 4) {
        return candidate == selector;
    }
    return candidate.find(selector) != std::string::npos ||
        selector.find(candidate) != std::string::npos;
}

void appendUniqueCandidateById_(
    nlohmann::json& list,
    const nlohmann::json& candidate)
{
    if (!list.is_array() || !candidate.is_object()) {
        return;
    }

    int candidateId = 0;
    if (!tryJsonIntField_(candidate, "id", candidateId) || candidateId <= 0) {
        return;
    }

    for (const auto& existing : list) {
        int existingId = 0;
        if (tryJsonIntField_(existing, "id", existingId) && existingId == candidateId) {
            return;
        }
    }

    list.push_back(candidate);
}

nlohmann::json mergeUniqueCandidates_(
    const nlohmann::json& first,
    const nlohmann::json& second)
{
    nlohmann::json merged = nlohmann::json::array();
    if (first.is_array()) {
        for (const auto& candidate : first) {
            appendUniqueCandidateById_(merged, candidate);
        }
    }
    if (second.is_array()) {
        for (const auto& candidate : second) {
            appendUniqueCandidateById_(merged, candidate);
        }
    }
    return merged;
}

std::vector<std::string> selectorSceneQueries_(const nlohmann::json& selector)
{
    std::vector<std::string> queries;
    const std::vector<const char*> keys = {
        "scene_label",
        "scene_description",
        "description",
    };

    for (const auto* key : keys) {
        const std::string value = trimCopy_(jsonStringField_(selector, key));
        if (value.empty()) {
            continue;
        }
        if (std::find(queries.begin(), queries.end(), value) == queries.end()) {
            queries.push_back(value);
        }
    }

    return queries;
}

std::string entityDescriptionPreview_(const nlohmann::json& value)
{
    const std::string label = entitySceneLabel_(value);
    if (!label.empty()) {
        return shortenForDisplay_(humanizeSceneLabel_(label), 60);
    }

    const std::string body = entitySceneDescription_(value);
    if (!body.empty()) {
        return shortenForDisplay_(body, 80);
    }

    const std::string rawDescription = jsonStringField_(value, "description");
    if (rawDescription.empty()) {
        return "";
    }

    return shortenForDisplay_(rawDescription, 80);
}

std::string normalizedDescriptionLabel_(const nlohmann::json& value)
{
    return compactToken_(entitySceneLabel_(value));
}

std::string normalizedDescriptionText_(const nlohmann::json& value)
{
    return compactToken_(sceneSearchText_(value));
}

std::vector<std::string> descriptionSemanticTokens_(const nlohmann::json& value)
{
    const std::string searchable = sceneSearchText_(value);
    if (searchable.empty()) {
        return semanticTokens_(jsonStringField_(value, "description"));
    }
    return semanticTokens_(searchable);
}

std::string normalizeConnectionMethod_(std::string value)
{
    value = upperAsciiCopy_(trimCopy_(std::move(value)));
    if (value == "HTTP" || value == "ONVIF" || value == "RTSP") {
        return value;
    }
    return value;
}

std::string clientIdFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() || !payload.contains("client_id") || !payload["client_id"].is_string()) {
        return "";
    }
    return trimCopy_(payload["client_id"].get<std::string>());
}

nlohmann::json loadConversationContext_(
    AgentCore& agent,
    const nlohmann::json& payload)
{
    nlohmann::json fallback = {
        { "compact_context", nlohmann::json::object() },
        { "task_state", defaultOperationTaskState() },
        { "recent_turns", nlohmann::json::array() },
    };

    if (!payload.is_object()) {
        return fallback;
    }

    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) {
        return fallback;
    }

    const int beforeMessageId = payload.value("context_before_message_id", 0);
    std::ostringstream url;
    url
        << agent.getBackendBaseUrl()
        << "/api/agent/chat-context?client_id=" << agent.getClientId()
        << "&chat_session_id=" << chatSessionId;
    if (beforeMessageId > 0) {
        url << "&before_message_id=" << beforeMessageId;
    }

    const HttpResponse response = getUrl(
        url.str(),
        agent.getExeToken(),
        {},
        3500);
    if (!response.ok()) {
        return fallback;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        return fallback;
    }
    return parsed;
}

std::string effectiveReplyLanguage_(
    const SkillSelection& selection,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext)
{
    if (!selection.replyLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.replyLanguage);
    }
    if (payload.is_object() && payload.contains("query_language") && payload["query_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["query_language"].get<std::string>());
    }
    if (payload.is_object() && payload.contains("app_language") && payload["app_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["app_language"].get<std::string>());
    }
    const std::string activeTaskLanguage = activeOperationTaskLanguage(conversationContext);
    if (!activeTaskLanguage.empty()) {
        return normalizeAssistantLanguageTag(activeTaskLanguage);
    }
    return "en";
}

void configureActionModelClient_(LocalLlmClient& llm, const nlohmann::json& payload)
{
    const LocalLlmClient::Config config = buildChatModelClientConfigFromPayload(payload, false);
    if (config.enabled) {
        llm.setRequestOverride(config);
    }
}

std::string parseErrorMessage_(const HttpResponse& response)
{
    if (!response.body.empty()) {
        const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
        if (parsed.is_object()) {
            const std::string error = jsonStringField_(parsed, "error");
            if (!error.empty()) {
                return error;
            }
            const std::string message = jsonStringField_(parsed, "message");
            if (!message.empty()) {
                return message;
            }
        }
    }
    if (!response.error.empty()) {
        return response.error;
    }
    if (response.statusCode > 0) {
        return "HTTP " + std::to_string(response.statusCode);
    }
    return "unknown_error";
}

ChatProgressUpdate buildAgentProgress_(
    const std::string& language,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate progress;
    progress.skill = "create_camera_agent";
    progress.phase = phase;
    progress.sequence = sequence;
    progress.stepIndex = stepIndex;
    progress.stepCount = stepCount;

    if (normalizeAssistantLanguageTag(language) == "pt") {
        if (phase == "resolving_context") {
            progress.headline = "Entendendo o agente";
            progress.detail = "Resolvendo camera, step, destinos e referencias antes de criar qualquer agente.";
        }
        else if (phase == "designing_agent") {
            progress.headline = "Desenhando o agente";
            progress.detail = "Gerando prompt, alerta, condicoes negativas e area de analise quando necessario.";
        }
        else if (phase == "applying_agent") {
            progress.headline = "Criando o agente";
            progress.detail = "Aplicando o agente no local escolhido.";
        }
        else {
            progress.headline = "Organizando o agente";
            progress.detail = "Preparando a criacao do agente para o chat.";
        }
        return progress;
    }

    if (phase == "resolving_context") {
        progress.headline = "Resolving the agent context";
        progress.detail = "Checking the camera, step, destinations, and targets before creating anything.";
    }
    else if (phase == "designing_agent") {
        progress.headline = "Designing the agent";
        progress.detail = "Generating the prompt, alert condition, negative condition, and region when needed.";
    }
    else if (phase == "applying_agent") {
        progress.headline = "Creating the agent";
        progress.detail = "Applying the new agent to the selected destination.";
    }
    else {
        progress.headline = "Preparing the agent";
        progress.detail = "Structuring the requested agent creation for the chat.";
    }
    return progress;
}

const std::vector<std::string>& agentDestinationTypes_()
{
    static const std::vector<std::string> values = {
        "camera",
        "step_default",
        "step_camera",
    };
    return values;
}

bool isAgentDestinationType_(const std::string& value)
{
    const auto& values = agentDestinationTypes_();
    return std::find(values.begin(), values.end(), value) != values.end();
}

nlohmann::json normalizeReferenceRef_(const nlohmann::json& value, bool allowTraits)
{
    nlohmann::json normalized = nlohmann::json::object();

    if (value.is_string()) {
        const std::string text = normalizeInlineWhitespace_(value.get<std::string>());
        if (!text.empty()) {
            normalized["name"] = text;
        }
        return normalized;
    }

    if (!value.is_object()) {
        return normalized;
    }

    int id = 0;
    if (tryJsonIntField_(value, "id", id) && id > 0) {
        normalized["id"] = id;
    }

    const std::vector<const char*> stringFields = {
        "name",
        "description",
        "entity_type",
    };
    for (const auto* field : stringFields) {
        const std::string text = jsonStringField_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    if (allowTraits && value.contains("traits") && value["traits"].is_array()) {
        nlohmann::json traits = nlohmann::json::array();
        for (const auto& entry : value["traits"]) {
            if (!entry.is_string()) {
                continue;
            }
            const std::string text = normalizeInlineWhitespace_(entry.get<std::string>());
            if (!text.empty()) {
                traits.push_back(text);
            }
        }
        if (!traits.empty()) {
            normalized["traits"] = traits;
        }
    }

    return normalized;
}

nlohmann::json normalizeReferenceList_(const nlohmann::json& value, bool allowTraits)
{
    nlohmann::json normalized = nlohmann::json::array();
    if (!value.is_array()) {
        return normalized;
    }

    for (const auto& entry : value) {
        const nlohmann::json normalizedEntry = normalizeReferenceRef_(entry, allowTraits);
        if (!normalizedEntry.empty()) {
            normalized.push_back(normalizedEntry);
        }
    }
    return normalized;
}

nlohmann::json normalizeSelectorObject_(
    const nlohmann::json& value,
    const std::vector<const char*>& stringFields,
    const std::vector<const char*>& intFields)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) {
        return normalized;
    }

    for (const auto* field : stringFields) {
        const std::string text = jsonStringField_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    for (const auto* field : intFields) {
        int intValue = 0;
        if (tryJsonIntField_(value, field, intValue) && intValue > 0) {
            normalized[field] = intValue;
        }
    }
    return normalized;
}

nlohmann::json normalizeCameraSelector_(const nlohmann::json& value)
{
    nlohmann::json normalized = normalizeSelectorObject_(
        value,
        { "name", "description", "scene_label", "scene_description", "ip_address", "manufacturer", "channel", "subtype", "connection_method" },
        { "id" });
    if (normalized.contains("connection_method") && normalized["connection_method"].is_string()) {
        normalized["connection_method"] = normalizeConnectionMethod_(normalized["connection_method"].get<std::string>());
    }
    return normalized;
}

nlohmann::json normalizeStepSelector_(const nlohmann::json& value)
{
    return normalizeSelectorObject_(
        value,
        { "title", "job_name", "prompt", "description" },
        { "id", "job_id" });
}

nlohmann::json normalizeStepCameraSelector_(const nlohmann::json& value)
{
    return normalizeSelectorObject_(
        value,
        { "camera_name", "slot_key", "slot_label", "description", "scene_label", "scene_description" },
        { "target_id", "camera_id" });
}

nlohmann::json normalizeDestinationTypes_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::array();
    if (value.is_string()) {
        const std::string text = lowerAsciiCopy_(trimCopy_(value.get<std::string>()));
        if (isAgentDestinationType_(text)) {
            normalized.push_back(text);
        }
        return normalized;
    }
    if (!value.is_array()) {
        return normalized;
    }

    for (const auto& entry : value) {
        if (!entry.is_string()) {
            continue;
        }
        const std::string text = lowerAsciiCopy_(trimCopy_(entry.get<std::string>()));
        if (isAgentDestinationType_(text) &&
            std::find(normalized.begin(), normalized.end(), text) == normalized.end()) {
            normalized.push_back(text);
        }
    }
    return normalized;
}

nlohmann::json normalizeFieldSources_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) {
        return normalized;
    }

    for (auto it = value.begin(); it != value.end(); ++it) {
        if (!it.value().is_string()) {
            continue;
        }
        const std::string source = lowerAsciiCopy_(trimCopy_(it.value().get<std::string>()));
        if (source == "explicit_user" || source == "implied_user" || source == "system_default") {
            normalized[it.key()] = source;
        }
    }
    return normalized;
}

nlohmann::json normalizeAgentPatch_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::vector<const char*> stringFields = {
        "display_name",
        "summary",
        "prompt_template",
        "alert_condition",
        "negative_condition",
        "input_type",
        "video_packaging_mode",
        "inference_model",
    };
    for (const auto* field : stringFields) {
        const std::string text = normalizeInlineWhitespace_(jsonStringField_(value, field));
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    const std::vector<const char*> intFields = {
        "model_fps",
        "run_every",
        "running_resolution",
    };
    for (const auto* field : intFields) {
        int intValue = 0;
        if (tryJsonIntField_(value, field, intValue) && intValue >= 0) {
            normalized[field] = intValue;
        }
    }

    const std::vector<const char*> boolFields = {
        "only_capture_on_motion",
        "use_temporal_context",
        "is_enabled",
    };
    for (const auto* field : boolFields) {
        bool boolValue = false;
        if (value.contains(field) && readBoolLoose_(value[field], boolValue)) {
            normalized[field] = boolValue;
        }
    }

    if (value.contains("analysis_regions") && value["analysis_regions"].is_array()) {
        normalized["analysis_regions"] = value["analysis_regions"];
    }

    return normalized;
}

nlohmann::json normalizeAgentExtractionResult_(const nlohmann::json& parsed)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!parsed.is_object()) {
        return normalized;
    }

    const std::string goalSummary = normalizeInlineWhitespace_(jsonStringField_(parsed, "goal_summary"));
    if (!goalSummary.empty()) {
        normalized["goal_summary"] = goalSummary;
    }

    const nlohmann::json cameraSelector = normalizeCameraSelector_(parsed.value("camera_selector", nlohmann::json::object()));
    if (!cameraSelector.empty()) {
        normalized["camera_selector"] = cameraSelector;
    }

    const nlohmann::json stepSelector = normalizeStepSelector_(parsed.value("step_selector", nlohmann::json::object()));
    if (!stepSelector.empty()) {
        normalized["step_selector"] = stepSelector;
    }

    const nlohmann::json stepCameraSelector = normalizeStepCameraSelector_(parsed.value("step_camera_selector", nlohmann::json::object()));
    if (!stepCameraSelector.empty()) {
        normalized["step_camera_selector"] = stepCameraSelector;
    }

    const nlohmann::json destinations = normalizeDestinationTypes_(parsed.value("destination_types", nlohmann::json::array()));
    if (!destinations.empty()) {
        normalized["destination_types"] = destinations;
    }

    const nlohmann::json patch = normalizeAgentPatch_(parsed.value("agent_patch", nlohmann::json::object()));
    if (!patch.empty()) {
        normalized["agent_patch"] = patch;
    }

    const nlohmann::json fieldSources = normalizeFieldSources_(parsed.value("field_sources", nlohmann::json::object()));
    if (!fieldSources.empty()) {
        normalized["field_sources"] = fieldSources;
    }

    const nlohmann::json faceTargetRefs = normalizeReferenceList_(parsed.value("face_target_refs", nlohmann::json::array()), false);
    if (!faceTargetRefs.empty()) {
        normalized["face_target_refs"] = faceTargetRefs;
    }

    const nlohmann::json drakonFindRefs = normalizeReferenceList_(parsed.value("drakon_find_target_refs", nlohmann::json::array()), true);
    if (!drakonFindRefs.empty()) {
        normalized["drakon_find_target_refs"] = drakonFindRefs;
    }

    if (parsed.contains("open_form")) {
        bool openForm = false;
        if (readBoolLoose_(parsed["open_form"], openForm)) {
            normalized["open_form"] = openForm;
        }
    }

    if (parsed.contains("needs_visual_context")) {
        bool needsVisual = false;
        if (readBoolLoose_(parsed["needs_visual_context"], needsVisual)) {
            normalized["needs_visual_context"] = needsVisual;
        }
    }

    return normalized;
}

nlohmann::json normalizeRouterCreateAgentDraft_(const SkillSelection& selection)
{
    nlohmann::json normalized = nlohmann::json::object();
    const nlohmann::json args =
        selection.arguments.is_object() ? selection.arguments : nlohmann::json::object();

    const std::string goalSummary =
        normalizeInlineWhitespace_(jsonStringField_(args, "goal_summary"));
    if (!goalSummary.empty()) {
        normalized["goal_summary"] = goalSummary;
    }

    const nlohmann::json cameraSelector =
        normalizeCameraSelector_(args.value("camera_selector", nlohmann::json::object()));
    if (!cameraSelector.empty()) {
        normalized["camera_selector"] = cameraSelector;
    }

    const nlohmann::json stepSelector =
        normalizeStepSelector_(args.value("step_selector", nlohmann::json::object()));
    if (!stepSelector.empty()) {
        normalized["step_selector"] = stepSelector;
    }

    const nlohmann::json stepCameraSelector =
        normalizeStepCameraSelector_(args.value("step_camera_selector", nlohmann::json::object()));
    if (!stepCameraSelector.empty()) {
        normalized["step_camera_selector"] = stepCameraSelector;
    }

    const nlohmann::json destinations =
        normalizeDestinationTypes_(args.value("destination_types", nlohmann::json::array()));
    if (!destinations.empty()) {
        normalized["destination_types"] = destinations;
    }

    nlohmann::json patch = normalizeAgentPatch_(args.value("draft_patch", nlohmann::json::object()));
    if (patch.empty() && selection.draftPatch.is_object()) {
        patch = normalizeAgentPatch_(selection.draftPatch);
    }
    if (!patch.empty()) {
        normalized["agent_patch"] = patch;
    }

    if (args.contains("open_form")) {
        bool openForm = false;
        if (readBoolLoose_(args["open_form"], openForm)) {
            normalized["open_form"] = openForm;
        }
    }

    if (args.contains("needs_visual_context")) {
        bool needsVisual = false;
        if (readBoolLoose_(args["needs_visual_context"], needsVisual)) {
            normalized["needs_visual_context"] = needsVisual;
        }
    }

    return normalized;
}

nlohmann::json activeCreateAgentDraft_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return nlohmann::json::object();
    }

    const auto& activeTask = taskState["active_task"];
    if (jsonStringField_(activeTask, "type") != "create_camera_agent" ||
        !activeTask.contains("draft") ||
        !activeTask["draft"].is_object()) {
        return nlohmann::json::object();
    }

    return activeTask["draft"];
}

nlohmann::json mergeObjectFields_(
    const nlohmann::json& baseValue,
    const nlohmann::json& incomingValue)
{
    nlohmann::json merged = baseValue.is_object() ? baseValue : nlohmann::json::object();
    if (!incomingValue.is_object()) {
        return merged;
    }
    for (auto it = incomingValue.begin(); it != incomingValue.end(); ++it) {
        merged[it.key()] = it.value();
    }
    return merged;
}

nlohmann::json mergeCreateAgentDrafts_(
    const nlohmann::json& baseDraft,
    const nlohmann::json& incomingDraft)
{
    nlohmann::json merged = baseDraft.is_object() ? baseDraft : nlohmann::json::object();
    if (!incomingDraft.is_object()) {
        return merged;
    }

    const std::vector<const char*> objectFields = {
        "camera_selector",
        "step_selector",
        "step_camera_selector",
        "agent_patch",
        "field_sources",
        "resolved_camera",
        "resolved_step",
        "resolved_step_camera",
    };
    for (const auto* field : objectFields) {
        if (incomingDraft.contains(field) && incomingDraft[field].is_object()) {
            merged[field] = mergeObjectFields_(merged.value(field, nlohmann::json::object()), incomingDraft[field]);
        }
    }

    const std::vector<const char*> arrayFields = {
        "destination_types",
        "face_target_refs",
        "drakon_find_target_refs",
        "resolved_face_targets",
        "resolved_drakon_find_targets",
    };
    for (const auto* field : arrayFields) {
        if (incomingDraft.contains(field) && incomingDraft[field].is_array() && !incomingDraft[field].empty()) {
            merged[field] = incomingDraft[field];
        }
    }

    if (incomingDraft.contains("goal_summary") && incomingDraft["goal_summary"].is_string()) {
        const std::string goalSummary = normalizeInlineWhitespace_(incomingDraft["goal_summary"].get<std::string>());
        if (!goalSummary.empty()) {
            merged["goal_summary"] = goalSummary;
        }
    }

    const std::vector<const char*> boolFields = {
        "open_form",
        "needs_visual_context",
    };
    for (const auto* field : boolFields) {
        if (incomingDraft.contains(field) && incomingDraft[field].is_boolean()) {
            merged[field] = incomingDraft[field];
        }
    }

    return merged;
}

nlohmann::json extractCreateAgentDraft_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection);

nlohmann::json fetchCameraInventory_(
    AgentCore& agent,
    const nlohmann::json& payload);

nlohmann::json fetchStepInventory_(
    AgentCore& agent,
    const nlohmann::json& payload);

nlohmann::json fetchStepTargetInventory_(
    AgentCore& agent,
    const nlohmann::json& payload,
    int stepId);

nlohmann::json fetchReferenceTargets_(
    AgentCore& agent,
    const nlohmann::json& payload);

nlohmann::json extractCreateAgentDraft_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection)
{
    if (!llm.isConfigured()) {
        return nlohmann::json::object();
    }

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string replyLanguage = effectiveReplyLanguage_(selection, payload, conversationContext);

    const std::string systemPrompt =
        "/no_think\n"
        "You extract structured data for creating a camera agent directly from chat.\n"
        "Use the latest user_message plus the active create_camera_agent task in conversation_task_state when present.\n"
        "This is a semantic extraction task, not a delimiter-only parser.\n"
        "Understand natural requests about detecting, recognizing, watching for, tracking, alerting on, creating an AI agent, using an existing face target, using Drakon Find targets, applying the agent on a camera, applying it on a job step, or opening the form for review.\n"
        "Never invent camera names, step names, target ids, target names, destinations, polygons, or installation scope that the user did not provide or clearly imply.\n"
        "goal_summary is the user's high-level detection goal in one sentence.\n"
        "If the user only says they want to create or add an agent on a camera or step, but does not say what the agent should analyze, detect, recognize, compare, count, or alert on, goal_summary must stay empty.\n"
        "When the analytical goal is missing, do not invent generic monitoring, security, person-detection, office-monitoring, or any other default agent.\n"
        "camera_selector identifies a direct camera target when the user wants the agent on a specific camera or references a specific camera snapshot.\n"
        "When the user identifies the camera by room, environment, scene label, or location description instead of the exact camera name, prefer camera_selector.scene_label for a short structured scene hint and camera_selector.scene_description for the natural-language scene/location hint.\n"
        "step_selector identifies a job step when the user wants the agent on a task/step.\n"
        "step_camera_selector identifies a specific camera target inside that step when the user wants the agent inside one camera target of the step.\n"
        "When the user identifies a step camera by room, environment, scene label, or location description instead of the exact camera name, prefer step_camera_selector.scene_label for a short structured scene hint and step_camera_selector.scene_description for the natural-language scene/location hint.\n"
        "destination_types must use only these values: camera, step_default, step_camera.\n"
        "Use step_default when the user wants the agent as the default agent of the step.\n"
        "Use step_camera when the user wants the agent on one camera target inside the step.\n"
        "agent_patch contains only explicit or strongly implied agent settings, such as display_name, prompt_template, alert_condition, negative_condition, input_type, run_every, inference_model, or analysis_regions if the user explicitly gave one.\n"
        "When the analytical goal is missing, leave agent_patch empty unless the user explicitly asked to open the form or explicitly gave a non-goal configuration like run_every.\n"
        "Do not fill display_name, summary, prompt_template, alert_condition, or negative_condition with invented generic text when the user did not describe the agent's job.\n"
        "Do not invent analysis_regions. Leave it empty and set needs_visual_context=true when the design will need a snapshot to suggest a polygon or a region.\n"
        "Use face_target_refs only when the user clearly references one or more existing face targets.\n"
        "Use drakon_find_target_refs only when the user clearly references one or more existing Drakon Find targets.\n"
        "Set open_form=true only when the user explicitly asks to open, review, inspect, or edit through the form/modal instead of applying directly.\n"
        "If the user says pronouns like 'essa camera', 'essa tarefa', 'o mesmo agente', or 'ali', only rely on the active create_camera_agent task when it already has resolved entities.\n"
        "Return JSON only with this shape:\n"
        "{"
        "\"goal_summary\":\"detect people entering the gate\","
        "\"camera_selector\":{\"id\":123,\"name\":\"portao\",\"scene_label\":\"front_door\",\"scene_description\":\"front gate\",\"description\":\"front gate\",\"ip_address\":\"192.168.0.21\",\"manufacturer\":\"Intelbras\",\"channel\":\"1\",\"subtype\":\"0\",\"connection_method\":\"RTSP\"},"
        "\"step_selector\":{\"id\":44,\"title\":\"portao\",\"job_name\":\"perimetro\",\"prompt\":\"watch entrances\"},"
        "\"step_camera_selector\":{\"target_id\":9,\"camera_id\":123,\"camera_name\":\"Portao\",\"slot_key\":\"entrada_principal\",\"slot_label\":\"Entrada principal\",\"scene_label\":\"front_door\",\"scene_description\":\"front gate\",\"description\":\"front gate\"},"
        "\"destination_types\":[\"camera\"],"
        "\"agent_patch\":{\"display_name\":\"Pessoa no portao\",\"prompt_template\":\"Observe o portao frontal.\",\"alert_condition\":\"Acione quando houver uma pessoa dentro da area do portao.\",\"negative_condition\":\"Ignore a rua ao fundo.\",\"input_type\":\"video\",\"run_every\":10},"
        "\"field_sources\":{\"display_name\":\"explicit_user\",\"run_every\":\"implied_user\"},"
        "\"face_target_refs\":[{\"name\":\"joao da recepcao\"}],"
        "\"drakon_find_target_refs\":[{\"name\":\"joao silva\",\"entity_type\":\"person\"}],"
        "\"open_form\":false,"
        "\"needs_visual_context\":true"
        "}\n"
        "Valid agent_patch fields are: display_name, summary, prompt_template, alert_condition, negative_condition, input_type, video_packaging_mode, inference_model, model_fps, run_every, running_resolution, only_capture_on_motion, use_temporal_context, is_enabled, analysis_regions.\n"
        "Valid field_sources values are explicit_user or implied_user.\n"
        "Examples:\n"
        "user_message='crie um agente na camera do portao para avisar quando uma pessoa entrar na garagem' => "
        "{\"goal_summary\":\"avisar quando uma pessoa entrar na garagem vista pela camera do portao\",\"camera_selector\":{\"name\":\"portao\"},\"destination_types\":[\"camera\"],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":true}\n"
        "user_message='crie um agente na camera do ambiente interno para detectar invasao' => "
        "{\"goal_summary\":\"detectar invasao\",\"camera_selector\":{\"scene_description\":\"ambiente interno\"},\"destination_types\":[\"camera\"],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":true}\n"
        "user_message='quero adicionar um agente na camera mibo' => "
        "{\"goal_summary\":\"\",\"camera_selector\":{\"name\":\"mibo\"},\"destination_types\":[\"camera\"],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":false}\n"
        "user_message='abra o formulario de agente da camera mibo para eu revisar' => "
        "{\"goal_summary\":\"\",\"camera_selector\":{\"name\":\"mibo\"},\"destination_types\":[\"camera\"],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":true,\"needs_visual_context\":false}\n"
        "user_message='quero criar um agente' => "
        "{\"goal_summary\":\"\",\"destination_types\":[],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":false}\n"
        "user_message='crie um agente no step portao para detectar carro parado' => "
        "{\"goal_summary\":\"detectar carro parado\",\"step_selector\":{\"title\":\"portao\"},\"destination_types\":[\"step_default\"],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":false}\n"
        "user_message='use no step entrada, mas so na camera garagem' => "
        "{\"goal_summary\":\"\",\"step_selector\":{\"title\":\"entrada\"},\"step_camera_selector\":{\"camera_name\":\"garagem\"},\"destination_types\":[\"step_camera\"],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":false}\n"
        "user_message='quero um agente para reconhecer o joao da recepcao e ignorar outras pessoas' => "
        "{\"goal_summary\":\"reconhecer joao da recepcao e ignorar outras pessoas\",\"destination_types\":[],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[{\"name\":\"joao da recepcao\"}],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":false}\n"
        "user_message='detecte invasao apenas dentro do patio, desenhando a area no chao' => "
        "{\"goal_summary\":\"detectar invasao dentro do patio\",\"destination_types\":[],\"agent_patch\":{},\"field_sources\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[],\"open_form\":false,\"needs_visual_context\":true}\n";

    nlohmann::json promptPayload = {
        { "reply_language", replyLanguage },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultOperationTaskState()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "user_message", userMessage },
    };

    const auto outcome = llm.completeText(
        "extractCreateCameraAgentDraft",
        systemPrompt,
        promptPayload.dump(2),
        0.0,
        1600,
        20000,
        1,
        true);

    if (!outcome.ok || trimCopy_(outcome.content).empty()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(outcome.content, nullptr, false);
    return normalizeAgentExtractionResult_(parsed);
}

nlohmann::json fetchCameraInventory_(
    AgentCore& agent,
    const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/cameras?client_id=" + clientId;
    const HttpResponse response = getUrl(
        url,
        agent.getExeToken(),
        {},
        7000);
    if (!response.ok()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", parseErrorMessage_(response) },
            { "cameras", nlohmann::json::array() },
        });
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_array()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", "invalid_camera_inventory" },
            { "cameras", nlohmann::json::array() },
        });
    }

    nlohmann::json cameras = nlohmann::json::array();
    for (const auto& item : parsed) {
        if (!item.is_object()) {
            continue;
        }
        int id = 0;
        if (!tryJsonIntField_(item, "id", id) || id <= 0) {
            continue;
        }

        cameras.push_back(nlohmann::json::object({
            { "id", id },
            { "name", jsonStringField_(item, "name") },
            { "description", jsonStringField_(item, "description") },
            { "scene_label", jsonStringField_(item, "scene_label") },
            { "scene_description", jsonStringField_(item, "scene_description") },
            { "ip_address", jsonStringField_(item, "ip_address") },
            { "manufacturer", jsonStringField_(item, "manufacturer") },
            { "connection_method", normalizeConnectionMethod_(jsonStringField_(item, "connection_method")) },
            { "channel", jsonStringField_(item, "channel") },
            { "subtype", jsonStringField_(item, "subtype") },
        }));
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "cameras", cameras },
    });
}

nlohmann::json fetchStepInventory_(
    AgentCore& agent,
    const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/job-steps?client_id=" + clientId;
    const HttpResponse response = getUrl(
        url,
        agent.getExeToken(),
        {},
        7000);
    if (!response.ok()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", parseErrorMessage_(response) },
            { "steps", nlohmann::json::array() },
        });
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object() || !parsed.contains("steps") || !parsed["steps"].is_array()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", "invalid_step_inventory" },
            { "steps", nlohmann::json::array() },
        });
    }

    nlohmann::json steps = nlohmann::json::array();
    for (const auto& item : parsed["steps"]) {
        if (!item.is_object()) {
            continue;
        }
        int id = 0;
        if (!tryJsonIntField_(item, "id", id) || id <= 0) {
            continue;
        }

        int jobId = 0;
        tryJsonIntField_(item, "job_id", jobId);
        int stepOrder = 0;
        tryJsonIntField_(item, "step_order", stepOrder);
        int targetCount = 0;
        tryJsonIntField_(item, "target_count", targetCount);

        steps.push_back(nlohmann::json::object({
            { "id", id },
            { "job_id", jobId },
            { "job_name", jsonStringField_(item, "job_name") },
            { "title", jsonStringField_(item, "title") },
            { "prompt", jsonStringField_(item, "prompt") },
            { "step_order", stepOrder },
            { "target_count", targetCount },
        }));
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "steps", steps },
    });
}

nlohmann::json fetchStepTargetInventory_(
    AgentCore& agent,
    const nlohmann::json& payload,
    int stepId)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    std::ostringstream url;
    url << agent.getBackendBaseUrl()
        << "/api/agent/job-steps/" << stepId
        << "/targets?client_id=" << clientId;

    const HttpResponse response = getUrl(
        url.str(),
        agent.getExeToken(),
        {},
        7000);
    if (!response.ok()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", parseErrorMessage_(response) },
            { "step", nlohmann::json::object() },
            { "targets", nlohmann::json::array() },
        });
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object() || !parsed.contains("targets") || !parsed["targets"].is_array()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", "invalid_step_target_inventory" },
            { "step", nlohmann::json::object() },
            { "targets", nlohmann::json::array() },
        });
    }

    nlohmann::json targets = nlohmann::json::array();
    for (const auto& item : parsed["targets"]) {
        if (!item.is_object()) {
            continue;
        }
        int id = 0;
        if (!tryJsonIntField_(item, "id", id) || id <= 0) {
            continue;
        }
        int cameraId = 0;
        tryJsonIntField_(item, "camera_id", cameraId);

        targets.push_back(nlohmann::json::object({
            { "id", id },
            { "camera_id", cameraId },
            { "camera_name", jsonStringField_(item, "camera_name") },
            { "slot_key", jsonStringField_(item, "slot_key") },
            { "slot_label", jsonStringField_(item, "slot_label") },
            { "description", jsonStringField_(item, "description") },
            { "scene_label", jsonStringField_(item, "scene_label") },
            { "scene_description", jsonStringField_(item, "scene_description") },
            { "input_type", jsonStringField_(item, "input_type") },
        }));
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "step", parsed.value("step", nlohmann::json::object()) },
        { "targets", targets },
    });
}

nlohmann::json fetchReferenceTargets_(
    AgentCore& agent,
    const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/reference-targets?client_id=" + clientId;
    const HttpResponse response = getUrl(
        url,
        agent.getExeToken(),
        {},
        7000);
    if (!response.ok()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", parseErrorMessage_(response) },
            { "face_targets", nlohmann::json::array() },
            { "drakon_find_targets", nlohmann::json::array() },
        });
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", "invalid_reference_target_payload" },
            { "face_targets", nlohmann::json::array() },
            { "drakon_find_targets", nlohmann::json::array() },
        });
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "face_targets", parsed.value("face_targets", nlohmann::json::array()) },
        { "drakon_find_targets", parsed.value("drakon_find_targets", nlohmann::json::array()) },
    });
}

bool hasSelectorFields_(const nlohmann::json& selector)
{
    return selector.is_object() && !selector.empty();
}

std::string normalizedJsonField_(const nlohmann::json& value, const char* key)
{
    return compactToken_(jsonStringField_(value, key));
}

nlohmann::json resolvedCameraFromDraft_(const nlohmann::json& draft)
{
    if (!draft.is_object() || !draft.contains("resolved_camera") || !draft["resolved_camera"].is_object()) {
        return nlohmann::json::object();
    }
    return draft["resolved_camera"];
}

nlohmann::json resolvedStepFromDraft_(const nlohmann::json& draft)
{
    if (!draft.is_object() || !draft.contains("resolved_step") || !draft["resolved_step"].is_object()) {
        return nlohmann::json::object();
    }
    return draft["resolved_step"];
}

nlohmann::json resolvedStepCameraFromDraft_(const nlohmann::json& draft)
{
    if (!draft.is_object() || !draft.contains("resolved_step_camera") || !draft["resolved_step_camera"].is_object()) {
        return nlohmann::json::object();
    }
    return draft["resolved_step_camera"];
}

nlohmann::json buildResolvedCameraDraft_(const nlohmann::json& camera)
{
    nlohmann::json resolved = nlohmann::json::object();
    if (!camera.is_object()) {
        return resolved;
    }

    int id = 0;
    if (tryJsonIntField_(camera, "id", id) && id > 0) {
        resolved["id"] = id;
    }

    const std::vector<const char*> fields = {
        "name",
        "description",
        "scene_label",
        "scene_description",
        "ip_address",
        "manufacturer",
        "connection_method",
        "channel",
        "subtype",
    };
    for (const auto* field : fields) {
        const std::string text = jsonStringField_(camera, field);
        if (!text.empty()) {
            resolved[field] = text;
        }
    }
    return resolved;
}

nlohmann::json buildResolvedStepDraft_(const nlohmann::json& step)
{
    nlohmann::json resolved = nlohmann::json::object();
    if (!step.is_object()) {
        return resolved;
    }

    const std::vector<const char*> intFields = {
        "id",
        "job_id",
        "step_order",
        "target_count",
    };
    for (const auto* field : intFields) {
        int intValue = 0;
        if (tryJsonIntField_(step, field, intValue) && intValue >= 0) {
            resolved[field] = intValue;
        }
    }

    const std::vector<const char*> stringFields = {
        "job_name",
        "title",
        "prompt",
        "description",
    };
    for (const auto* field : stringFields) {
        const std::string text = jsonStringField_(step, field);
        if (!text.empty()) {
            resolved[field] = text;
        }
    }
    return resolved;
}

nlohmann::json buildResolvedStepCameraDraft_(const nlohmann::json& target)
{
    nlohmann::json resolved = nlohmann::json::object();
    if (!target.is_object()) {
        return resolved;
    }

    const std::vector<const char*> intFields = {
        "id",
        "camera_id",
    };
    for (const auto* field : intFields) {
        int intValue = 0;
        if (tryJsonIntField_(target, field, intValue) && intValue >= 0) {
            resolved[field == std::string("id") ? "target_id" : field] = intValue;
        }
    }

    const std::vector<const char*> stringFields = {
        "camera_name",
        "slot_key",
        "slot_label",
        "description",
        "scene_label",
        "scene_description",
        "ip_address",
        "manufacturer",
    };
    for (const auto* field : stringFields) {
        const std::string text = jsonStringField_(target, field);
        if (!text.empty()) {
            resolved[field] = text;
        }
    }
    return resolved;
}

void enrichStepTargetsWithCameraInventory_(
    nlohmann::json& targets,
    const nlohmann::json& inventory)
{
    if (!targets.is_array() ||
        !inventory.is_object() ||
        !inventory.contains("cameras") ||
        !inventory["cameras"].is_array()) {
        return;
    }

    for (auto& target : targets) {
        if (!target.is_object()) {
            continue;
        }

        int cameraId = 0;
        if (!tryJsonIntField_(target, "camera_id", cameraId) || cameraId <= 0) {
            continue;
        }

        for (const auto& camera : inventory["cameras"]) {
            int candidateId = 0;
            if (!tryJsonIntField_(camera, "id", candidateId) || candidateId != cameraId) {
                continue;
            }
            if (!target.contains("description") || jsonStringField_(target, "description").empty()) {
                const std::string description = jsonStringField_(camera, "description");
                if (!description.empty()) {
                    target["description"] = description;
                }
            }
            if (!target.contains("scene_label") || jsonStringField_(target, "scene_label").empty()) {
                const std::string sceneLabel = jsonStringField_(camera, "scene_label");
                if (!sceneLabel.empty()) {
                    target["scene_label"] = sceneLabel;
                }
            }
            if (!target.contains("scene_description") || jsonStringField_(target, "scene_description").empty()) {
                const std::string sceneDescription = jsonStringField_(camera, "scene_description");
                if (!sceneDescription.empty()) {
                    target["scene_description"] = sceneDescription;
                }
            }
            if (!target.contains("ip_address") || jsonStringField_(target, "ip_address").empty()) {
                const std::string ip = jsonStringField_(camera, "ip_address");
                if (!ip.empty()) {
                    target["ip_address"] = ip;
                }
            }
            if (!target.contains("manufacturer") || jsonStringField_(target, "manufacturer").empty()) {
                const std::string manufacturer = jsonStringField_(camera, "manufacturer");
                if (!manufacturer.empty()) {
                    target["manufacturer"] = manufacturer;
                }
            }
            break;
        }
    }
}

bool matchesExactFilter_(
    const nlohmann::json& candidate,
    const nlohmann::json& selector,
    const char* key)
{
    const std::string selectorValue = normalizedJsonField_(selector, key);
    if (selectorValue.empty()) {
        return true;
    }
    return normalizedJsonField_(candidate, key) == selectorValue;
}

nlohmann::json resolveCamera_(
    const nlohmann::json& inventory,
    const nlohmann::json& selector,
    const nlohmann::json& activeResolved)
{
    nlohmann::json result = {
        { "status", "missing_target" },
        { "item", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    };

    const nlohmann::json cameras =
        inventory.is_object() && inventory.contains("cameras") && inventory["cameras"].is_array()
            ? inventory["cameras"]
            : nlohmann::json::array();
    if (cameras.empty()) {
        result["status"] = "not_found";
        return result;
    }

    if ((!selector.is_object() || selector.empty()) && activeResolved.is_object() && !activeResolved.empty()) {
        result["status"] = "resolved";
        result["item"] = activeResolved;
        return result;
    }
    if (!selector.is_object() || selector.empty()) {
        return result;
    }

    int selectorId = 0;
    if (tryJsonIntField_(selector, "id", selectorId) && selectorId > 0) {
        for (const auto& camera : cameras) {
            int candidateId = 0;
            if (tryJsonIntField_(camera, "id", candidateId) && candidateId == selectorId) {
                result["status"] = "resolved";
                result["item"] = camera;
                return result;
            }
        }
        result["status"] = "not_found";
        return result;
    }

    const std::string selectorIp = lowerAsciiCopy_(jsonStringField_(selector, "ip_address"));
    if (!selectorIp.empty()) {
        nlohmann::json matches = nlohmann::json::array();
        for (const auto& camera : cameras) {
            if (lowerAsciiCopy_(jsonStringField_(camera, "ip_address")) == selectorIp &&
                matchesExactFilter_(camera, selector, "manufacturer")) {
                matches.push_back(camera);
            }
        }
        if (matches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = matches[0];
            return result;
        }
        if (matches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = matches;
            return result;
        }
        result["status"] = "not_found";
        return result;
    }

    const std::string selectorName = normalizedJsonField_(selector, "name");
    nlohmann::json exactNameMatches = nlohmann::json::array();
    nlohmann::json weakNameMatches = nlohmann::json::array();
    if (!selectorName.empty()) {
        for (const auto& camera : cameras) {
            if (!matchesExactFilter_(camera, selector, "manufacturer")) {
                continue;
            }
            const std::string candidateName = normalizedJsonField_(camera, "name");
            if (candidateName.empty()) {
                continue;
            }
            if (candidateName == selectorName) {
                appendUniqueCandidateById_(exactNameMatches, camera);
            }
            else if (candidateName.find(selectorName) != std::string::npos ||
                     selectorName.find(candidateName) != std::string::npos) {
                appendUniqueCandidateById_(weakNameMatches, camera);
            }
        }
        if (exactNameMatches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = exactNameMatches[0];
            return result;
        }
        if (exactNameMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exactNameMatches;
            return result;
        }
    }

    std::vector<std::string> sceneQueries = selectorSceneQueries_(selector);
    bool usedNameAsSceneFallback = false;
    if (sceneQueries.empty()) {
        const std::string rawNameQuery = trimCopy_(jsonStringField_(selector, "name"));
        if (!rawNameQuery.empty()) {
            sceneQueries.push_back(rawNameQuery);
            usedNameAsSceneFallback = true;
        }
    }

    if (!sceneQueries.empty()) {
        nlohmann::json exactSceneMatches = nlohmann::json::array();
        nlohmann::json semanticSceneMatches = nlohmann::json::array();

        for (const auto& rawSceneQuery : sceneQueries) {
            const std::string normalizedSceneQuery = compactToken_(rawSceneQuery);
            const std::vector<std::string> sceneQueryTokens = semanticTokens_(rawSceneQuery);
            if (normalizedSceneQuery.empty() && sceneQueryTokens.empty()) {
                continue;
            }

            for (const auto& camera : cameras) {
                if (!matchesExactFilter_(camera, selector, "manufacturer")) {
                    continue;
                }

                const std::string candidateLabel = normalizedDescriptionLabel_(camera);
                const std::string candidateDescription = normalizedDescriptionText_(camera);
                if (!normalizedSceneQuery.empty() &&
                    ((!candidateLabel.empty() && candidateLabel == normalizedSceneQuery) ||
                     (!candidateDescription.empty() && candidateDescription == normalizedSceneQuery))) {
                    appendUniqueCandidateById_(exactSceneMatches, camera);
                    continue;
                }

                const std::vector<std::string> candidateTokens = descriptionSemanticTokens_(camera);
                if (!sceneQueryTokens.empty() &&
                    containsAllSemanticTokens_(candidateTokens, sceneQueryTokens)) {
                    appendUniqueCandidateById_(semanticSceneMatches, camera);
                    continue;
                }

                if (!normalizedSceneQuery.empty() &&
                    weakTokenMatch_(candidateDescription, normalizedSceneQuery)) {
                    appendUniqueCandidateById_(semanticSceneMatches, camera);
                }
            }
        }

        if (exactSceneMatches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = exactSceneMatches[0];
            return result;
        }
        if (exactSceneMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exactSceneMatches;
            return result;
        }

        if (semanticSceneMatches.size() == 1 && weakNameMatches.empty()) {
            result["status"] = "resolved";
            result["item"] = semanticSceneMatches[0];
            return result;
        }

        const nlohmann::json uncertainMatches =
            mergeUniqueCandidates_(semanticSceneMatches, weakNameMatches);
        if (!uncertainMatches.empty()) {
            result["status"] = "ambiguous";
            result["candidates"] = uncertainMatches;
            return result;
        }

        if (selectorName.empty() || !usedNameAsSceneFallback) {
            result["status"] = "not_found";
            return result;
        }
    }

    if (!selectorName.empty()) {
        if (weakNameMatches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = weakNameMatches[0];
            return result;
        }
        if (weakNameMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = weakNameMatches;
            return result;
        }
    }

    result["status"] = "not_found";
    return result;
}

nlohmann::json resolveStep_(
    const nlohmann::json& inventory,
    const nlohmann::json& selector,
    const nlohmann::json& activeResolved)
{
    nlohmann::json result = {
        { "status", "missing_target" },
        { "item", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    };

    const nlohmann::json steps =
        inventory.is_object() && inventory.contains("steps") && inventory["steps"].is_array()
            ? inventory["steps"]
            : nlohmann::json::array();
    if ((!selector.is_object() || selector.empty()) && activeResolved.is_object() && !activeResolved.empty()) {
        result["status"] = "resolved";
        result["item"] = activeResolved;
        return result;
    }
    if (!selector.is_object() || selector.empty()) {
        return result;
    }
    if (steps.empty()) {
        result["status"] = "not_found";
        return result;
    }

    int selectorId = 0;
    if (tryJsonIntField_(selector, "id", selectorId) && selectorId > 0) {
        for (const auto& step : steps) {
            int candidateId = 0;
            if (tryJsonIntField_(step, "id", candidateId) && candidateId == selectorId) {
                result["status"] = "resolved";
                result["item"] = step;
                return result;
            }
        }
        result["status"] = "not_found";
        return result;
    }

    const std::string selectorTitle = normalizedJsonField_(selector, "title");
    const std::string selectorJob = normalizedJsonField_(selector, "job_name");
    if (!selectorTitle.empty()) {
        nlohmann::json exact = nlohmann::json::array();
        nlohmann::json weak = nlohmann::json::array();
        for (const auto& step : steps) {
            const std::string stepTitle = normalizedJsonField_(step, "title");
            const std::string stepJob = normalizedJsonField_(step, "job_name");
            if (!selectorJob.empty() && stepJob != selectorJob) {
                continue;
            }
            if (stepTitle == selectorTitle) {
                exact.push_back(step);
            }
            else if (stepTitle.find(selectorTitle) != std::string::npos ||
                     selectorTitle.find(stepTitle) != std::string::npos) {
                weak.push_back(step);
            }
        }
        if (exact.size() == 1) {
            result["status"] = "resolved";
            result["item"] = exact[0];
            return result;
        }
        if (exact.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exact;
            return result;
        }
        if (weak.size() == 1) {
            result["status"] = "resolved";
            result["item"] = weak[0];
            return result;
        }
        if (weak.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = weak;
            return result;
        }
    }

    const std::string descriptionQuery =
        !jsonStringField_(selector, "description").empty()
            ? jsonStringField_(selector, "description")
            : jsonStringField_(selector, "prompt");
    const std::vector<std::string> descriptionTokens = semanticTokens_(descriptionQuery);
    if (!descriptionTokens.empty()) {
        nlohmann::json semanticMatches = nlohmann::json::array();
        for (const auto& step : steps) {
            std::string text = jsonStringField_(step, "title");
            text += " " + jsonStringField_(step, "job_name");
            text += " " + jsonStringField_(step, "prompt");
            if (containsAllSemanticTokens_(semanticTokens_(text), descriptionTokens)) {
                semanticMatches.push_back(step);
            }
        }
        if (semanticMatches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = semanticMatches[0];
            return result;
        }
        if (semanticMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = semanticMatches;
            return result;
        }
    }

    result["status"] = "not_found";
    return result;
}

nlohmann::json resolveStepCamera_(
    const nlohmann::json& targetInventory,
    const nlohmann::json& selector,
    const nlohmann::json& activeResolved)
{
    nlohmann::json result = {
        { "status", "missing_target" },
        { "item", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    };

    const nlohmann::json targets =
        targetInventory.is_object() && targetInventory.contains("targets") && targetInventory["targets"].is_array()
            ? targetInventory["targets"]
            : nlohmann::json::array();

    if ((!selector.is_object() || selector.empty()) && activeResolved.is_object() && !activeResolved.empty()) {
        result["status"] = "resolved";
        result["item"] = activeResolved;
        return result;
    }
    if (targets.empty()) {
        result["status"] = "not_found";
        return result;
    }
    if ((!selector.is_object() || selector.empty()) && targets.size() == 1) {
        result["status"] = "resolved";
        result["item"] = targets[0];
        return result;
    }
    if (!selector.is_object() || selector.empty()) {
        return result;
    }

    int targetId = 0;
    if (tryJsonIntField_(selector, "target_id", targetId) && targetId > 0) {
        for (const auto& target : targets) {
            int candidateId = 0;
            if (tryJsonIntField_(target, "id", candidateId) && candidateId == targetId) {
                result["status"] = "resolved";
                result["item"] = target;
                return result;
            }
        }
        result["status"] = "not_found";
        return result;
    }

    int cameraId = 0;
    if (tryJsonIntField_(selector, "camera_id", cameraId) && cameraId > 0) {
        nlohmann::json matches = nlohmann::json::array();
        for (const auto& target : targets) {
            int candidateCameraId = 0;
            if (tryJsonIntField_(target, "camera_id", candidateCameraId) && candidateCameraId == cameraId) {
                matches.push_back(target);
            }
        }
        if (matches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = matches[0];
            return result;
        }
        if (matches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = matches;
            return result;
        }
        result["status"] = "not_found";
        return result;
    }

    const std::vector<std::pair<const char*, const char*>> stringFields = {
        { "slot_key", "slot_key" },
        { "slot_label", "slot_label" },
        { "camera_name", "camera_name" },
    };
    for (const auto& field : stringFields) {
        const std::string selectorValue = normalizedJsonField_(selector, field.first);
        if (selectorValue.empty()) {
            continue;
        }

        nlohmann::json exact = nlohmann::json::array();
        nlohmann::json weak = nlohmann::json::array();
        for (const auto& target : targets) {
            const std::string candidateValue = normalizedJsonField_(target, field.second);
            if (candidateValue.empty()) {
                continue;
            }
            if (candidateValue == selectorValue) {
                exact.push_back(target);
            }
            else if (candidateValue.find(selectorValue) != std::string::npos ||
                     selectorValue.find(candidateValue) != std::string::npos) {
                weak.push_back(target);
            }
        }
        if (exact.size() == 1) {
            result["status"] = "resolved";
            result["item"] = exact[0];
            return result;
        }
        if (exact.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exact;
            return result;
        }
        if (weak.size() == 1) {
            result["status"] = "resolved";
            result["item"] = weak[0];
            return result;
        }
        if (weak.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = weak;
            return result;
        }
    }

    const std::vector<std::string> sceneQueries = selectorSceneQueries_(selector);
    if (!sceneQueries.empty()) {
        nlohmann::json exactSceneMatches = nlohmann::json::array();
        nlohmann::json semanticSceneMatches = nlohmann::json::array();
        for (const auto& rawSceneQuery : sceneQueries) {
            const std::string normalizedSceneQuery = compactToken_(rawSceneQuery);
            const std::vector<std::string> sceneQueryTokens = semanticTokens_(rawSceneQuery);
            if (normalizedSceneQuery.empty() && sceneQueryTokens.empty()) {
                continue;
            }

            for (const auto& target : targets) {
                const std::string candidateLabel = normalizedDescriptionLabel_(target);
                const std::string candidateDescription = normalizedDescriptionText_(target);
                if (!normalizedSceneQuery.empty() &&
                    ((!candidateLabel.empty() && candidateLabel == normalizedSceneQuery) ||
                     (!candidateDescription.empty() && candidateDescription == normalizedSceneQuery))) {
                    appendUniqueCandidateById_(exactSceneMatches, target);
                    continue;
                }

                std::string text = sceneSearchText_(target);
                text += " " + jsonStringField_(target, "camera_name");
                text += " " + jsonStringField_(target, "slot_label");
                text += " " + jsonStringField_(target, "slot_key");
                if (!sceneQueryTokens.empty() &&
                    containsAllSemanticTokens_(semanticTokens_(text), sceneQueryTokens)) {
                    appendUniqueCandidateById_(semanticSceneMatches, target);
                    continue;
                }

                if (!normalizedSceneQuery.empty() &&
                    weakTokenMatch_(compactToken_(text), normalizedSceneQuery)) {
                    appendUniqueCandidateById_(semanticSceneMatches, target);
                }
            }
        }
        if (exactSceneMatches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = exactSceneMatches[0];
            return result;
        }
        if (exactSceneMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exactSceneMatches;
            return result;
        }
        if (semanticSceneMatches.size() == 1) {
            result["status"] = "resolved";
            result["item"] = semanticSceneMatches[0];
            return result;
        }
        if (semanticSceneMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = semanticSceneMatches;
            return result;
        }
    }

    result["status"] = "not_found";
    return result;
}

std::string referenceDisplayName_(const nlohmann::json& ref)
{
    std::string name = jsonStringField_(ref, "name");
    if (name.empty()) {
        name = jsonStringField_(ref, "description");
    }
    if (name.empty()) {
        int id = 0;
        if (tryJsonIntField_(ref, "id", id) && id > 0) {
            name = "#" + std::to_string(id);
        }
    }
    return name;
}

nlohmann::json resolveNamedReference_(
    const nlohmann::json& inventory,
    const nlohmann::json& requestedRefs,
    bool allowTraits)
{
    nlohmann::json result = {
        { "status", "resolved" },
        { "items", nlohmann::json::array() },
        { "problem_ref", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    };

    if (!requestedRefs.is_array() || requestedRefs.empty()) {
        return result;
    }
    if (!inventory.is_array()) {
        result["status"] = "not_found";
        return result;
    }

    nlohmann::json resolved = nlohmann::json::array();
    for (const auto& ref : requestedRefs) {
        if (!ref.is_object()) {
            continue;
        }

        int requestedId = 0;
        if (tryJsonIntField_(ref, "id", requestedId) && requestedId > 0) {
            bool foundById = false;
            for (const auto& item : inventory) {
                int itemId = 0;
                if (tryJsonIntField_(item, "id", itemId) && itemId == requestedId) {
                    resolved.push_back(item);
                    foundById = true;
                    break;
                }
            }
            if (!foundById) {
                result["status"] = "not_found";
                result["problem_ref"] = ref;
                return result;
            }
            continue;
        }

        const std::string requestedName = normalizedJsonField_(ref, "name");
        const std::vector<std::string> requestedDescriptionTokens =
            semanticTokens_(jsonStringField_(ref, "description"));
        const std::string requestedEntityType = normalizedJsonField_(ref, "entity_type");

        nlohmann::json exact = nlohmann::json::array();
        nlohmann::json weak = nlohmann::json::array();
        nlohmann::json semantic = nlohmann::json::array();

        for (const auto& item : inventory) {
            if (!requestedEntityType.empty() && normalizedJsonField_(item, "entity_type") != requestedEntityType) {
                continue;
            }

            const std::string itemName = normalizedJsonField_(item, "name");
            if (!requestedName.empty()) {
                if (itemName == requestedName) {
                    exact.push_back(item);
                    continue;
                }
                if (!itemName.empty() &&
                    (itemName.find(requestedName) != std::string::npos ||
                     requestedName.find(itemName) != std::string::npos)) {
                    weak.push_back(item);
                    continue;
                }
            }

            if (!requestedDescriptionTokens.empty()) {
                std::string text = jsonStringField_(item, "name");
                text += " " + jsonStringField_(item, "description");
                if (allowTraits && item.contains("traits") && item["traits"].is_array()) {
                    for (const auto& trait : item["traits"]) {
                        if (trait.is_string()) {
                            text += " " + trait.get<std::string>();
                        }
                    }
                }
                if (containsAllSemanticTokens_(semanticTokens_(text), requestedDescriptionTokens)) {
                    semantic.push_back(item);
                }
            }
        }

        const nlohmann::json* chosen = nullptr;
        if (exact.size() == 1) {
            chosen = &exact[0];
        }
        else if (exact.size() > 1) {
            result["status"] = "ambiguous";
            result["problem_ref"] = ref;
            result["candidates"] = exact;
            return result;
        }
        else if (weak.size() == 1) {
            chosen = &weak[0];
        }
        else if (weak.size() > 1) {
            result["status"] = "ambiguous";
            result["problem_ref"] = ref;
            result["candidates"] = weak;
            return result;
        }
        else if (semantic.size() == 1) {
            chosen = &semantic[0];
        }
        else if (semantic.size() > 1) {
            result["status"] = "ambiguous";
            result["problem_ref"] = ref;
            result["candidates"] = semantic;
            return result;
        }
        else {
            result["status"] = "not_found";
            result["problem_ref"] = ref;
            return result;
        }

        resolved.push_back(*chosen);
    }

    result["items"] = resolved;
    return result;
}

std::string cameraReferenceLine_(const nlohmann::json& camera, std::size_t index, const std::string& language)
{
    const std::string name = jsonStringField_(camera, "name");
    const std::string ip = jsonStringField_(camera, "ip_address");
    const int id = camera.value("id", 0);
    const std::string descriptionPreview = entityDescriptionPreview_(camera);
    std::ostringstream out;
    out << (index + 1) << ". " << (name.empty() ? (language == "pt" ? "Camera sem nome" : "Unnamed camera") : name);
    if (id > 0) {
        out << " [ID " << id << "]";
    }
    if (!ip.empty()) {
        out << " - " << ip;
    }
    if (!descriptionPreview.empty()) {
        out << " - " << descriptionPreview;
    }
    return out.str();
}

std::string stepReferenceLine_(const nlohmann::json& step, std::size_t index, const std::string& language)
{
    const std::string title = jsonStringField_(step, "title");
    const std::string jobName = jsonStringField_(step, "job_name");
    const int id = step.value("id", 0);
    std::ostringstream out;
    out << (index + 1) << ". " << (title.empty() ? (language == "pt" ? "Step sem titulo" : "Untitled step") : title);
    if (!jobName.empty()) {
        out << " (" << jobName << ")";
    }
    if (id > 0) {
        out << " [ID " << id << "]";
    }
    return out.str();
}

std::string stepCameraReferenceLine_(const nlohmann::json& target, std::size_t index, const std::string& language)
{
    const std::string cameraName = jsonStringField_(target, "camera_name");
    const std::string slotLabel = jsonStringField_(target, "slot_label");
    const std::string slotKey = jsonStringField_(target, "slot_key");
    const int targetId = target.value("id", 0);
    const std::string descriptionPreview = entityDescriptionPreview_(target);
    std::ostringstream out;
    out << (index + 1) << ". " << (cameraName.empty() ? (language == "pt" ? "Camera alvo" : "Target camera") : cameraName);
    if (!slotLabel.empty()) {
        out << " - " << slotLabel;
    }
    else if (!slotKey.empty()) {
        out << " - " << slotKey;
    }
    if (targetId > 0) {
        out << " [target " << targetId << "]";
    }
    if (!descriptionPreview.empty()) {
        out << " - " << descriptionPreview;
    }
    return out.str();
}

std::string buildFailureAnswer_(const std::string& language, const std::string& detail)
{
    if (language == "pt") {
        return detail.empty()
            ? "Nao consegui criar o agente agora. Tente novamente em instantes."
            : "Nao consegui criar o agente agora. Detalhe: " + detail;
    }
    return detail.empty()
        ? "I could not create the agent right now. Please try again in a moment."
        : "I could not create the agent right now. Detail: " + detail;
}

std::string buildNeedGoalAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Antes de criar o agente, preciso que voce me diga o que ele deve analisar, reconhecer ou alertar. Por exemplo: pessoa entrando na garagem, cachorro no quintal ou carro parado na vaga.";
    }
    return "Before I create the agent, I need you to tell me what it should analyze, recognize, or alert on. For example: a person entering the garage, a dog in the yard, or a car stopped in the driveway.";
}

bool hasMeaningfulAgentGoal_(const nlohmann::json& draft, std::string& goalSummaryOut)
{
    goalSummaryOut = normalizeInlineWhitespace_(jsonStringField_(draft, "goal_summary"));
    if (!goalSummaryOut.empty()) {
        return true;
    }

    const nlohmann::json fieldSources = draft.value("field_sources", nlohmann::json::object());
    const nlohmann::json agentPatch = draft.value("agent_patch", nlohmann::json::object());
    const std::vector<const char*> fallbackFields = {
        "alert_condition",
        "prompt_template",
    };

    for (const auto* field : fallbackFields) {
        const std::string text = normalizeInlineWhitespace_(jsonStringField_(agentPatch, field));
        if (text.empty()) {
            continue;
        }
        const std::string source = lowerAsciiCopy_(trimCopy_(jsonStringField_(fieldSources, field)));
        if (source == "explicit_user" || source == "implied_user") {
            goalSummaryOut = text;
            return true;
        }
    }

    goalSummaryOut.clear();
    return false;
}

nlohmann::json sanitizeDraftForMissingGoal_(const nlohmann::json& draft)
{
    nlohmann::json sanitized = draft.is_object() ? draft : nlohmann::json::object();
    sanitized.erase("goal_summary");

    if (sanitized.contains("agent_patch") && sanitized["agent_patch"].is_object()) {
        static const std::vector<const char*> volatileFields = {
            "summary",
            "prompt_template",
            "alert_condition",
            "negative_condition",
            "analysis_regions",
        };

        for (const auto* field : volatileFields) {
            sanitized["agent_patch"].erase(field);
        }

        const nlohmann::json fieldSources = sanitized.value("field_sources", nlohmann::json::object());
        const std::string displayNameSource = lowerAsciiCopy_(trimCopy_(jsonStringField_(fieldSources, "display_name")));
        if (displayNameSource != "explicit_user") {
            sanitized["agent_patch"].erase("display_name");
        }

        if (sanitized["agent_patch"].empty()) {
            sanitized.erase("agent_patch");
        }
    }

    if (sanitized.contains("field_sources") && sanitized["field_sources"].is_object()) {
        static const std::vector<const char*> volatileSources = {
            "goal_summary",
            "summary",
            "prompt_template",
            "alert_condition",
            "negative_condition",
            "analysis_regions",
        };
        for (const auto* field : volatileSources) {
            sanitized["field_sources"].erase(field);
        }

        const std::string displayNameSource = lowerAsciiCopy_(trimCopy_(jsonStringField_(sanitized["field_sources"], "display_name")));
        if (displayNameSource != "explicit_user") {
            sanitized["field_sources"].erase("display_name");
        }

        if (sanitized["field_sources"].empty()) {
            sanitized.erase("field_sources");
        }
    }

    return sanitized;
}

std::string buildNeedDestinationAnswer_(
    const std::string& language,
    const nlohmann::json& resolvedCamera,
    const nlohmann::json& resolvedStep)
{
    if (language == "pt") {
        std::ostringstream out;
        out << "Entendi o agente que voce quer criar";
        if (resolvedCamera.is_object() && !resolvedCamera.empty()) {
            out << " e ja localizei a camera " << jsonStringField_(resolvedCamera, "name");
        }
        if (resolvedStep.is_object() && !resolvedStep.empty()) {
            out << " e ja localizei o step " << jsonStringField_(resolvedStep, "title");
        }
        out << ", mas antes de modificar qualquer coisa preciso confirmar onde ele deve ser usado: direto em uma camera, como agente padrao de um step/tarefa, ou em uma camera especifica dentro de um step.";
        return out.str();
    }

    return "I understand the agent you want, but before I change anything I need you to confirm where it should be used: directly on a camera, as the default agent of a step, or on a specific camera target inside a step.";
}

std::string buildNeedCameraAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Antes de criar o agente, preciso confirmar qual camera deve receber esse agente. Pode me responder com o nome exato, o ID, o IP ou uma descricao mais especifica da cena/local.";
    }
    return "Before I create the agent, I need to confirm which camera should receive it. Reply with the exact name, ID, IP, or a more specific scene/location description.";
}

std::string buildAmbiguousCameraAnswer_(const std::string& language, const nlohmann::json& candidates)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Encontrei mais de uma camera possivel. Antes de criar qualquer agente, confirme qual delas devo usar:\n";
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            out << "\n" << cameraReferenceLine_(candidates[index], index, language);
        }
        out << "\n\nPode me responder com o nome exato, o ID, o IP ou uma descricao mais especifica da cena/local.";
        return out.str();
    }

    out << "I found more than one possible camera. Before creating anything, confirm which one I should use:\n";
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        out << "\n" << cameraReferenceLine_(candidates[index], index, language);
    }
    out << "\n\nReply with the exact name, ID, IP, or a more specific scene/location description.";
    return out.str();
}

std::string buildCameraNotFoundAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Nao encontrei uma camera cadastrada que combine com esse pedido. Me confirme o nome exato, o ID, o IP ou uma descricao mais especifica da cena/local.";
    }
    return "I could not find a registered camera matching that request. Please confirm the exact name, ID, IP, or a more specific scene/location description.";
}

std::string buildNeedStepAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Antes de criar o agente nesse fluxo, preciso confirmar em qual step/tarefa ele deve ser usado.";
    }
    return "Before I create the agent in that flow, I need to confirm which step/task should receive it.";
}

std::string buildAmbiguousStepAnswer_(const std::string& language, const nlohmann::json& candidates)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Encontrei mais de um step/tarefa possivel. Antes de criar qualquer agente, confirme qual deles devo usar:\n";
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            out << "\n" << stepReferenceLine_(candidates[index], index, language);
        }
        out << "\n\nPode me responder com o titulo exato do step, o ID ou o nome do job.";
        return out.str();
    }

    out << "I found more than one possible step. Before creating anything, confirm which one I should use:\n";
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        out << "\n" << stepReferenceLine_(candidates[index], index, language);
    }
    out << "\n\nReply with the exact step title, the ID, or the job name.";
    return out.str();
}

std::string buildStepNotFoundAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Nao encontrei um step/tarefa cadastrado que combine com esse pedido. Me confirme o titulo do step, o ID ou o nome do job.";
    }
    return "I could not find a registered step matching that request. Please confirm the step title, ID, or job name.";
}

std::string buildNeedStepCameraAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Antes de criar o agente dentro desse step, preciso confirmar qual camera alvo do step deve receber o agente. Pode me responder com o nome da camera, o target id, o slot key, o slot label ou uma descricao mais especifica da cena/local.";
    }
    return "Before I create the agent inside that step, I need to confirm which target camera in the step should receive it. Reply with the camera name, target id, slot key, slot label, or a more specific scene/location description.";
}

std::string buildAmbiguousStepCameraAnswer_(const std::string& language, const nlohmann::json& candidates)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Encontrei mais de uma camera alvo possivel dentro do step. Antes de criar qualquer agente, confirme qual delas devo usar:\n";
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            out << "\n" << stepCameraReferenceLine_(candidates[index], index, language);
        }
        out << "\n\nPode me responder com o nome da camera, o target id, o slot key, o slot label ou uma descricao mais especifica da cena/local.";
        return out.str();
    }

    out << "I found more than one possible target camera inside the step. Before creating anything, confirm which one I should use:\n";
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        out << "\n" << stepCameraReferenceLine_(candidates[index], index, language);
    }
    out << "\n\nReply with the camera name, target id, slot key, slot label, or a more specific scene/location description.";
    return out.str();
}

std::string buildStepCameraNotFoundAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Nao encontrei uma camera alvo desse step que combine com esse pedido. Me confirme o nome da camera, o target id, o slot key, o slot label ou uma descricao mais especifica da cena/local.";
    }
    return "I could not find a target camera in that step matching this request. Please confirm the camera name, target id, slot key, slot label, or a more specific scene/location description.";
}

std::string buildNeedVisualCameraAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Para sugerir a area/poligono com seguranca, preciso saber qual camera deve fornecer o snapshot visual desse agente.";
    }
    return "To suggest the area/polygon safely, I need to know which camera should provide the visual snapshot for this agent.";
}

std::string buildReferenceAmbiguousAnswer_(
    const std::string& language,
    const nlohmann::json& problemRef,
    const nlohmann::json& candidates,
    const std::string& labelSingular)
{
    std::ostringstream out;
    const std::string refName = referenceDisplayName_(problemRef);
    if (language == "pt") {
        out << "Encontrei mais de um " << labelSingular << " possivel para ";
        out << (refName.empty() ? "esse pedido" : refName) << ". Antes de criar qualquer agente, confirme qual deles devo usar:";
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            out << "\n" << (index + 1) << ". " << referenceDisplayName_(candidates[index]);
        }
        return out.str();
    }

    out << "I found more than one possible " << labelSingular << " for "
        << (refName.empty() ? "this request" : refName)
        << ". Before creating anything, confirm which one I should use:";
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        out << "\n" << (index + 1) << ". " << referenceDisplayName_(candidates[index]);
    }
    return out.str();
}

std::string buildReferenceNotFoundAnswer_(
    const std::string& language,
    const nlohmann::json& problemRef,
    const std::string& labelSingular)
{
    const std::string refName = referenceDisplayName_(problemRef);
    if (language == "pt") {
        return "Nao encontrei um " + labelSingular + " cadastrado que combine com " +
            (refName.empty() ? "esse pedido." : refName + ".");
    }
    return "I could not find a registered " + labelSingular + " matching " +
        (refName.empty() ? "this request." : refName + ".");
}

std::string buildFormAnswer_(const std::string& language, const nlohmann::json& camera)
{
    const std::string name = jsonStringField_(camera, "name");
    if (language == "pt") {
        if (!name.empty()) {
            return "Preparei o formulario do agente para a camera " + name + " no card abaixo.";
        }
        return "Preparei o formulario do agente no card abaixo.";
    }
    if (!name.empty()) {
        return "I prepared the agent form for camera " + name + " in the card below.";
    }
    return "I prepared the agent form in the card below.";
}

std::string buildSuccessAnswer_(
    const std::string& language,
    const nlohmann::json& createdDestinations)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Agente criado com sucesso.";
        if (createdDestinations.is_array() && !createdDestinations.empty()) {
            out << "\nLocais atualizados:";
            for (const auto& destination : createdDestinations) {
                out << "\n- " << jsonStringField_(destination, "label");
            }
        }
        return out.str();
    }

    out << "Agent created successfully.";
    if (createdDestinations.is_array() && !createdDestinations.empty()) {
        out << "\nUpdated destinations:";
        for (const auto& destination : createdDestinations) {
            out << "\n- " << jsonStringField_(destination, "label");
        }
    }
    return out.str();
}

nlohmann::json buildTaskDraft_(const nlohmann::json& mergedDraft)
{
    nlohmann::json draft = nlohmann::json::object();
    const std::vector<const char*> fields = {
        "goal_summary",
        "camera_selector",
        "step_selector",
        "step_camera_selector",
        "destination_types",
        "agent_patch",
        "field_sources",
        "face_target_refs",
        "drakon_find_target_refs",
        "open_form",
        "needs_visual_context",
        "resolved_camera",
        "resolved_step",
        "resolved_step_camera",
        "resolved_face_targets",
        "resolved_drakon_find_targets",
    };
    for (const auto* field : fields) {
        if (mergedDraft.contains(field)) {
            draft[field] = mergedDraft[field];
        }
    }
    return draft;
}

std::vector<std::string> collectedFieldsForAgent_(const nlohmann::json& mergedDraft)
{
    std::vector<std::string> fields;
    if (!jsonStringField_(mergedDraft, "goal_summary").empty()) {
        fields.push_back("goal_summary");
    }
    if (mergedDraft.contains("destination_types") && mergedDraft["destination_types"].is_array() && !mergedDraft["destination_types"].empty()) {
        fields.push_back("destination_types");
    }
    if (mergedDraft.contains("resolved_camera") && mergedDraft["resolved_camera"].is_object() && !mergedDraft["resolved_camera"].empty()) {
        fields.push_back("camera");
    }
    if (mergedDraft.contains("resolved_step") && mergedDraft["resolved_step"].is_object() && !mergedDraft["resolved_step"].empty()) {
        fields.push_back("step");
    }
    if (mergedDraft.contains("resolved_step_camera") && mergedDraft["resolved_step_camera"].is_object() && !mergedDraft["resolved_step_camera"].empty()) {
        fields.push_back("step_camera");
    }
    if (mergedDraft.contains("resolved_face_targets") && mergedDraft["resolved_face_targets"].is_array() && !mergedDraft["resolved_face_targets"].empty()) {
        fields.push_back("face_targets");
    }
    if (mergedDraft.contains("resolved_drakon_find_targets") && mergedDraft["resolved_drakon_find_targets"].is_array() && !mergedDraft["resolved_drakon_find_targets"].empty()) {
        fields.push_back("drakon_find_targets");
    }
    if (mergedDraft.contains("agent_patch") && mergedDraft["agent_patch"].is_object() && !mergedDraft["agent_patch"].empty()) {
        fields.push_back("agent_patch");
    }
    return fields;
}

nlohmann::json buildTaskState_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const std::string& status,
    const std::string& phase,
    const std::string& summary,
    const std::string& answer,
    const std::string& language,
    const std::vector<std::string>& missingFields,
    const nlohmann::json& uiContract)
{
    return status == "completed"
        ? completeOperationTask(
            conversationContext,
            OperationTaskDescriptor{
                "create_camera_agent",
                "camera_agent",
                "create",
                status,
                phase,
                normalizeAssistantLanguageTag(language),
                language == "pt" ? "criar um agente" : "create an agent",
                summary,
                trimCopy_(answer),
                missingFields,
                collectedFieldsForAgent_(mergedDraft),
                buildTaskDraft_(mergedDraft),
                mergedDraft.value("field_sources", nlohmann::json::object()),
                uiContract,
            })
        : upsertActiveOperationTask(
            conversationContext,
            OperationTaskDescriptor{
                "create_camera_agent",
                "camera_agent",
                "create",
                status,
                phase,
                normalizeAssistantLanguageTag(language),
                language == "pt" ? "criar um agente" : "create an agent",
                summary,
                trimCopy_(answer),
                missingFields,
                collectedFieldsForAgent_(mergedDraft),
                buildTaskDraft_(mergedDraft),
                mergedDraft.value("field_sources", nlohmann::json::object()),
                uiContract,
            });
}

std::string agentDesignUrl_(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    return agent.getBackendBaseUrl() + "/api/agent/agent-design?client_id=" + clientId;
}

std::string agentCameraCreateUrl_(AgentCore& agent, const nlohmann::json& payload, int cameraId)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    std::ostringstream url;
    url << agent.getBackendBaseUrl()
        << "/api/agent/cameras/" << cameraId
        << "/custom-agents?client_id=" << clientId;
    return url.str();
}

std::string stepAgentCreateUrl_(AgentCore& agent, const nlohmann::json& payload, int stepId)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    std::ostringstream url;
    url << agent.getBackendBaseUrl()
        << "/api/agent/job-steps/" << stepId
        << "/agents?client_id=" << clientId;
    return url.str();
}

int parseCreatedAgentId_(const HttpResponse& response)
{
    if (response.body.empty()) {
        return 0;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        return 0;
    }

    int agentId = 0;
    if (tryJsonIntField_(parsed, "agent_id", agentId) && agentId > 0) {
        return agentId;
    }
    if (parsed.contains("agent") &&
        parsed["agent"].is_object() &&
        tryJsonIntField_(parsed["agent"], "id", agentId) &&
        agentId > 0) {
        return agentId;
    }
    return 0;
}

nlohmann::json buildCreatedAgentMessageMetadata_(
    const std::string& language,
    const std::string& status,
    const std::string& agentName,
    const nlohmann::json& createdDestinations)
{
    nlohmann::json metadata = nlohmann::json::object({
        { "type", "camera_agent_creation_result" },
        { "status", status == "partially_created" ? "partially_created" : "created" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "created_destinations", createdDestinations.is_array() ? createdDestinations : nlohmann::json::array() },
    });
    if (!agentName.empty()) {
        metadata["agent_name"] = agentName;
    }
    return metadata;
}

} // namespace

SkillDefinition CreateCameraAgentSkill::definition() const
{
    return {
        "create_camera_agent",
        "Creates a camera agent directly from chat, but always asks for confirmation when there is any uncertainty about the target or destination.",
        true,
    };
}

SkillRunResult CreateCameraAgentSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "create_camera_agent";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string language = effectiveReplyLanguage_(selection, payload, conversationContext);

    nlohmann::json mergedDraft = mergeCreateAgentDrafts_(
        activeCreateAgentDraft_(conversationContext),
        normalizeRouterCreateAgentDraft_(selection));

    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);
    mergedDraft = mergeCreateAgentDrafts_(
        mergedDraft,
        extractCreateAgentDraft_(llm, payload, conversationContext, selection));

    auto hasDestination = [&](const std::string& destinationType) -> bool {
        if (!mergedDraft.contains("destination_types") || !mergedDraft["destination_types"].is_array()) {
            return false;
        }
        for (const auto& entry : mergedDraft["destination_types"]) {
            if (entry.is_string() && lowerAsciiCopy_(trimCopy_(entry.get<std::string>())) == destinationType) {
                return true;
            }
        }
        return false;
    };

    const bool needsCameraDestination = hasDestination("camera");
    const bool needsStepDefaultDestination = hasDestination("step_default");
    const bool needsStepCameraDestination = hasDestination("step_camera");
    const bool needsAnyStepDestination = needsStepDefaultDestination || needsStepCameraDestination;
    const nlohmann::json stepSelectorDraft =
        mergedDraft.value("step_selector", nlohmann::json::object());
    const nlohmann::json stepCameraSelectorDraft =
        mergedDraft.value("step_camera_selector", nlohmann::json::object());
    const bool hasStepSelector = hasSelectorFields_(stepSelectorDraft);
    const bool hasStepCameraSelector = hasSelectorFields_(stepCameraSelectorDraft);
    const bool needsStepResolution = needsAnyStepDestination || hasStepSelector || hasStepCameraSelector;
    const bool openForm = mergedDraft.value("open_form", false);
    const bool needsVisualContext = mergedDraft.value("needs_visual_context", false);

    postChatProgress(
        agent,
        payload,
        buildAgentProgress_(language, "resolving_context", 2, 2, 4),
        2500);

    if (!needsCameraDestination && !needsStepDefaultDestination && !needsStepCameraDestination) {
        result.answer = buildNeedDestinationAnswer_(
            language,
            resolvedCameraFromDraft_(mergedDraft),
            resolvedStepFromDraft_(mergedDraft));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_destination",
            language == "pt" ? "Aguardando destino do agente" : "Waiting for the agent destination",
            result.answer,
            language,
            { "destination_types" },
            nlohmann::json::object());
        return result;
    }

    const nlohmann::json cameraInventory = fetchCameraInventory_(agent, payload);
    if (!cameraInventory.value("ok", false)) {
        result.answer = buildFailureAnswer_(language, jsonStringField_(cameraInventory, "error"));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_context",
            language == "pt" ? "Falha ao consultar cameras" : "Failed to load cameras",
            result.answer,
            language,
            {},
            nlohmann::json::object());
        return result;
    }

    nlohmann::json stepInventory = nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "steps", nlohmann::json::array() },
    });
    if (needsStepResolution) {
        stepInventory = fetchStepInventory_(agent, payload);
        if (!stepInventory.value("ok", false)) {
            result.answer = buildFailureAnswer_(language, jsonStringField_(stepInventory, "error"));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_context",
                language == "pt" ? "Falha ao consultar steps" : "Failed to load steps",
                result.answer,
                language,
                {},
                nlohmann::json::object());
            return result;
        }
    }

    if (needsCameraDestination || openForm || hasSelectorFields_(mergedDraft.value("camera_selector", nlohmann::json::object()))) {
        const nlohmann::json cameraResolution = resolveCamera_(
            cameraInventory,
            mergedDraft.value("camera_selector", nlohmann::json::object()),
            resolvedCameraFromDraft_(mergedDraft));
        const std::string cameraStatus = jsonStringField_(cameraResolution, "status");

        if (cameraStatus == "missing_target" && (needsCameraDestination || openForm)) {
            result.answer = buildNeedCameraAnswer_(language);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_camera",
                language == "pt" ? "Aguardando camera alvo" : "Waiting for the target camera",
                result.answer,
                language,
                { "camera" },
                nlohmann::json::object());
            return result;
        }
        if (cameraStatus == "ambiguous") {
            result.answer = buildAmbiguousCameraAnswer_(language, cameraResolution.value("candidates", nlohmann::json::array()));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_camera_confirmation",
                language == "pt" ? "Aguardando confirmacao da camera" : "Waiting for camera confirmation",
                result.answer,
                language,
                { "camera" },
                nlohmann::json::object());
            return result;
        }
        if (cameraStatus == "not_found" && (needsCameraDestination || hasSelectorFields_(mergedDraft.value("camera_selector", nlohmann::json::object())))) {
            result.answer = buildCameraNotFoundAnswer_(language);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_camera",
                language == "pt" ? "Aguardando camera valida" : "Waiting for a valid camera",
                result.answer,
                language,
                { "camera" },
                nlohmann::json::object());
            return result;
        }
        if (cameraStatus == "resolved" && cameraResolution.contains("item") && cameraResolution["item"].is_object()) {
            mergedDraft["resolved_camera"] = buildResolvedCameraDraft_(cameraResolution["item"]);
        }
    }

    if (needsStepResolution) {
        const nlohmann::json stepResolution = resolveStep_(
            stepInventory,
            stepSelectorDraft,
            resolvedStepFromDraft_(mergedDraft));
        const std::string stepStatus = jsonStringField_(stepResolution, "status");

        if (stepStatus == "missing_target" && needsAnyStepDestination) {
            result.answer = buildNeedStepAnswer_(language);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_step",
                language == "pt" ? "Aguardando step alvo" : "Waiting for the target step",
                result.answer,
                language,
                { "step" },
                nlohmann::json::object());
            return result;
        }
        if (stepStatus == "ambiguous") {
            result.answer = buildAmbiguousStepAnswer_(language, stepResolution.value("candidates", nlohmann::json::array()));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_step_confirmation",
                language == "pt" ? "Aguardando confirmacao do step" : "Waiting for step confirmation",
                result.answer,
                language,
                { "step" },
                nlohmann::json::object());
            return result;
        }
        if (stepStatus == "not_found" && needsStepResolution) {
            result.answer = buildStepNotFoundAnswer_(language);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_step",
                language == "pt" ? "Aguardando step valido" : "Waiting for a valid step",
                result.answer,
                language,
                { "step" },
                nlohmann::json::object());
            return result;
        }
        if (stepStatus == "resolved" && stepResolution.contains("item") && stepResolution["item"].is_object()) {
            mergedDraft["resolved_step"] = buildResolvedStepDraft_(stepResolution["item"]);
        }
    }

    nlohmann::json stepTargetInventory = nlohmann::json::object();
    if ((needsAnyStepDestination || needsVisualContext) &&
        mergedDraft.contains("resolved_step") &&
        mergedDraft["resolved_step"].is_object()) {
        const int stepId = mergedDraft["resolved_step"].value("id", 0);
        if (stepId > 0) {
            stepTargetInventory = fetchStepTargetInventory_(agent, payload, stepId);
            if (!stepTargetInventory.value("ok", false)) {
                result.answer = buildFailureAnswer_(language, jsonStringField_(stepTargetInventory, "error"));
                result.metadata["task_state"] = buildTaskState_(
                    conversationContext,
                    mergedDraft,
                    "collecting_input",
                    "awaiting_step_camera",
                    language == "pt" ? "Falha ao consultar cameras do step" : "Failed to load step cameras",
                    result.answer,
                    language,
                    {},
                    nlohmann::json::object());
                return result;
            }
            if (stepTargetInventory.contains("targets") && stepTargetInventory["targets"].is_array()) {
                enrichStepTargetsWithCameraInventory_(stepTargetInventory["targets"], cameraInventory);
            }
        }
    }

    if (needsStepCameraDestination || (needsVisualContext && !needsCameraDestination)) {
        const nlohmann::json stepCameraResolution = resolveStepCamera_(
            stepTargetInventory,
            mergedDraft.value("step_camera_selector", nlohmann::json::object()),
            resolvedStepCameraFromDraft_(mergedDraft));
        const std::string stepCameraStatus = jsonStringField_(stepCameraResolution, "status");

        if (stepCameraStatus == "missing_target") {
            result.answer = needsStepCameraDestination
                ? buildNeedStepCameraAnswer_(language)
                : buildNeedVisualCameraAnswer_(language);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                needsStepCameraDestination ? "awaiting_step_camera" : "awaiting_visual_camera",
                needsStepCameraDestination
                    ? (language == "pt" ? "Aguardando camera alvo do step" : "Waiting for the step target camera")
                    : (language == "pt" ? "Aguardando camera para o poligono" : "Waiting for the camera that defines the polygon"),
                result.answer,
                language,
                { needsStepCameraDestination ? "step_camera" : "visual_camera" },
                nlohmann::json::object());
            return result;
        }
        if (stepCameraStatus == "ambiguous") {
            result.answer = buildAmbiguousStepCameraAnswer_(language, stepCameraResolution.value("candidates", nlohmann::json::array()));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_step_camera_confirmation",
                language == "pt" ? "Aguardando confirmacao da camera do step" : "Waiting for step camera confirmation",
                result.answer,
                language,
                { needsStepCameraDestination ? "step_camera" : "visual_camera" },
                nlohmann::json::object());
            return result;
        }
        if (stepCameraStatus == "not_found") {
            result.answer = needsStepCameraDestination
                ? buildStepCameraNotFoundAnswer_(language)
                : buildNeedVisualCameraAnswer_(language);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                needsStepCameraDestination ? "awaiting_step_camera" : "awaiting_visual_camera",
                needsStepCameraDestination
                    ? (language == "pt" ? "Aguardando camera valida do step" : "Waiting for a valid step camera")
                    : (language == "pt" ? "Aguardando camera para o poligono" : "Waiting for the camera that defines the polygon"),
                result.answer,
                language,
                { needsStepCameraDestination ? "step_camera" : "visual_camera" },
                nlohmann::json::object());
            return result;
        }
        if (stepCameraStatus == "resolved" && stepCameraResolution.contains("item") && stepCameraResolution["item"].is_object()) {
            mergedDraft["resolved_step_camera"] = buildResolvedStepCameraDraft_(stepCameraResolution["item"]);
        }
    }

    if ((mergedDraft.contains("face_target_refs") && mergedDraft["face_target_refs"].is_array() && !mergedDraft["face_target_refs"].empty()) ||
        (mergedDraft.contains("drakon_find_target_refs") && mergedDraft["drakon_find_target_refs"].is_array() && !mergedDraft["drakon_find_target_refs"].empty())) {
        const nlohmann::json referenceTargets = fetchReferenceTargets_(agent, payload);
        if (!referenceTargets.value("ok", false)) {
            result.answer = buildFailureAnswer_(language, jsonStringField_(referenceTargets, "error"));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_reference_targets",
                language == "pt" ? "Falha ao consultar referencias" : "Failed to load reference targets",
                result.answer,
                language,
                {},
                nlohmann::json::object());
            return result;
        }

        const nlohmann::json faceResolution = resolveNamedReference_(
            referenceTargets.value("face_targets", nlohmann::json::array()),
            mergedDraft.value("face_target_refs", nlohmann::json::array()),
            false);
        if (jsonStringField_(faceResolution, "status") == "ambiguous") {
            result.answer = buildReferenceAmbiguousAnswer_(language, faceResolution["problem_ref"], faceResolution["candidates"], language == "pt" ? "alvo facial" : "face target");
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_face_target_confirmation",
                language == "pt" ? "Aguardando confirmacao do alvo facial" : "Waiting for face target confirmation",
                result.answer,
                language,
                { "face_targets" },
                nlohmann::json::object());
            return result;
        }
        if (jsonStringField_(faceResolution, "status") == "not_found") {
            result.answer = buildReferenceNotFoundAnswer_(language, faceResolution["problem_ref"], language == "pt" ? "alvo facial" : "face target");
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_face_target_confirmation",
                language == "pt" ? "Aguardando alvo facial valido" : "Waiting for a valid face target",
                result.answer,
                language,
                { "face_targets" },
                nlohmann::json::object());
            return result;
        }
        if (faceResolution.contains("items") && faceResolution["items"].is_array() && !faceResolution["items"].empty()) {
            mergedDraft["resolved_face_targets"] = faceResolution["items"];
        }

        const nlohmann::json drakonFindResolution = resolveNamedReference_(
            referenceTargets.value("drakon_find_targets", nlohmann::json::array()),
            mergedDraft.value("drakon_find_target_refs", nlohmann::json::array()),
            true);
        if (jsonStringField_(drakonFindResolution, "status") == "ambiguous") {
            result.answer = buildReferenceAmbiguousAnswer_(language, drakonFindResolution["problem_ref"], drakonFindResolution["candidates"], language == "pt" ? "alvo do Drakon Find" : "Drakon Find target");
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_drakon_find_target_confirmation",
                language == "pt" ? "Aguardando confirmacao do alvo do Drakon Find" : "Waiting for Drakon Find target confirmation",
                result.answer,
                language,
                { "drakon_find_targets" },
                nlohmann::json::object());
            return result;
        }
        if (jsonStringField_(drakonFindResolution, "status") == "not_found") {
            result.answer = buildReferenceNotFoundAnswer_(language, drakonFindResolution["problem_ref"], language == "pt" ? "alvo do Drakon Find" : "Drakon Find target");
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_drakon_find_target_confirmation",
                language == "pt" ? "Aguardando alvo valido do Drakon Find" : "Waiting for a valid Drakon Find target",
                result.answer,
                language,
                { "drakon_find_targets" },
                nlohmann::json::object());
            return result;
        }
        if (drakonFindResolution.contains("items") && drakonFindResolution["items"].is_array() && !drakonFindResolution["items"].empty()) {
            mergedDraft["resolved_drakon_find_targets"] = drakonFindResolution["items"];
        }
    }

    nlohmann::json agentPatch = mergedDraft.value("agent_patch", nlohmann::json::object());
    std::string goalSummary;
    if (!hasMeaningfulAgentGoal_(mergedDraft, goalSummary)) {
        mergedDraft = sanitizeDraftForMissingGoal_(mergedDraft);
        agentPatch = mergedDraft.value("agent_patch", nlohmann::json::object());
        result.answer = buildNeedGoalAnswer_(language);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_goal",
            language == "pt" ? "Aguardando objetivo do agente" : "Waiting for the agent goal",
            result.answer,
            language,
            { "goal_summary" },
            nlohmann::json::object());
        return result;
    }
    mergedDraft["goal_summary"] = goalSummary;

    if (openForm && (!needsCameraDestination || needsAnyStepDestination)) {
        result.answer = language == "pt"
            ? "Consigo abrir o formulario apenas para um agente direto em uma camera especifica. Me confirme uma camera unica para eu preparar esse formulario."
            : "I can only open the form for an agent that will be created directly on one specific camera. Please confirm a single camera for that form.";
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_form_destination",
            language == "pt" ? "Aguardando destino compativel com formulario" : "Waiting for a form-compatible destination",
            result.answer,
            language,
            { "camera" },
            nlohmann::json::object());
        return result;
    }

    int designCameraId = 0;
    if (mergedDraft.contains("resolved_camera") && mergedDraft["resolved_camera"].is_object()) {
        designCameraId = mergedDraft["resolved_camera"].value("id", 0);
    }
    else if (mergedDraft.contains("resolved_step_camera") && mergedDraft["resolved_step_camera"].is_object()) {
        designCameraId = mergedDraft["resolved_step_camera"].value("camera_id", 0);
    }
    if (needsVisualContext && designCameraId <= 0) {
        result.answer = buildNeedVisualCameraAnswer_(language);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_visual_camera",
            language == "pt" ? "Aguardando camera para o poligono" : "Waiting for the camera that defines the polygon",
            result.answer,
            language,
            { "visual_camera" },
            nlohmann::json::object());
        return result;
    }

    postChatProgress(
        agent,
        payload,
        buildAgentProgress_(language, "designing_agent", 3, 3, 4),
        2500);

    nlohmann::json designRequest = {
        { "goal_summary", goalSummary },
        { "language", normalizeAssistantLanguageTag(language) },
        { "require_snapshot", designCameraId > 0 || needsVisualContext },
        { "agent_patch", agentPatch },
        { "face_targets", mergedDraft.value("resolved_face_targets", nlohmann::json::array()) },
        { "drakon_find_targets", mergedDraft.value("resolved_drakon_find_targets", nlohmann::json::array()) },
    };
    if (designCameraId > 0) {
        designRequest["camera_id"] = designCameraId;
    }

    const HttpResponse designResponse = postJson(
        agentDesignUrl_(agent, payload),
        designRequest.dump(),
        agent.getExeToken(),
        {},
        30000);
    if (!designResponse.ok()) {
        result.answer = buildFailureAnswer_(language, parseErrorMessage_(designResponse));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_design_retry",
            language == "pt" ? "Falha ao desenhar o agente" : "Failed to design the agent",
            result.answer,
            language,
            {},
            nlohmann::json::object());
        return result;
    }

    const nlohmann::json parsedDesignResponse = nlohmann::json::parse(designResponse.body, nullptr, false);
    const nlohmann::json design =
        parsedDesignResponse.is_object() && parsedDesignResponse.contains("design") && parsedDesignResponse["design"].is_object()
            ? parsedDesignResponse["design"]
            : nlohmann::json::object();
    if (design.empty()) {
        result.answer = buildFailureAnswer_(language, "invalid_agent_design_payload");
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_design_retry",
            language == "pt" ? "Falha ao desenhar o agente" : "Failed to design the agent",
            result.answer,
            language,
            {},
            nlohmann::json::object());
        return result;
    }

    const std::string finalDisplayName = !jsonStringField_(agentPatch, "display_name").empty()
        ? jsonStringField_(agentPatch, "display_name")
        : (!jsonStringField_(design, "display_name").empty() ? jsonStringField_(design, "display_name") : goalSummary);
    const std::string finalSummary = !jsonStringField_(agentPatch, "summary").empty()
        ? jsonStringField_(agentPatch, "summary")
        : (!jsonStringField_(design, "summary").empty() ? jsonStringField_(design, "summary") : goalSummary);
    const std::string finalInputType = !jsonStringField_(agentPatch, "input_type").empty()
        ? jsonStringField_(agentPatch, "input_type")
        : jsonStringField_(design, "input_type");
    const std::string finalVideoPackagingMode = !jsonStringField_(agentPatch, "video_packaging_mode").empty()
        ? jsonStringField_(agentPatch, "video_packaging_mode")
        : jsonStringField_(design, "video_packaging_mode");
    const std::string finalInferenceModel = !jsonStringField_(agentPatch, "inference_model").empty()
        ? jsonStringField_(agentPatch, "inference_model")
        : jsonStringField_(design, "inference_model");
    const std::string finalPromptTemplate = !jsonStringField_(agentPatch, "prompt_template").empty()
        ? jsonStringField_(agentPatch, "prompt_template")
        : jsonStringField_(design, "prompt_template");
    const std::string finalAlertCondition = !jsonStringField_(agentPatch, "alert_condition").empty()
        ? jsonStringField_(agentPatch, "alert_condition")
        : jsonStringField_(design, "alert_condition");
    const std::string finalNegativeCondition = !jsonStringField_(agentPatch, "negative_condition").empty()
        ? jsonStringField_(agentPatch, "negative_condition")
        : jsonStringField_(design, "negative_condition");
    const nlohmann::json finalIsEnabled = agentPatch.contains("is_enabled")
        ? agentPatch["is_enabled"]
        : nlohmann::json(true);
    const nlohmann::json finalModelFps = agentPatch.contains("model_fps")
        ? agentPatch["model_fps"]
        : nlohmann::json(design.value("model_fps", 1));
    const nlohmann::json finalRunEvery = agentPatch.contains("run_every")
        ? agentPatch["run_every"]
        : nlohmann::json(design.value("run_every", 60));
    const nlohmann::json finalRunningResolution = agentPatch.contains("running_resolution")
        ? agentPatch["running_resolution"]
        : nlohmann::json(design.value("running_resolution", 640));
    const nlohmann::json finalOnlyCaptureOnMotion = agentPatch.contains("only_capture_on_motion")
        ? agentPatch["only_capture_on_motion"]
        : nlohmann::json(design.value("only_capture_on_motion", true));
    const nlohmann::json finalUseTemporalContext = agentPatch.contains("use_temporal_context")
        ? agentPatch["use_temporal_context"]
        : nlohmann::json(design.value("use_temporal_context", true));
    const nlohmann::json finalAnalysisRegions = agentPatch.contains("analysis_regions")
        ? agentPatch["analysis_regions"]
        : nlohmann::json(design.value("analysis_regions", nlohmann::json::array()));

    nlohmann::json finalSnapshot = {
        { "type", "agent" },
        { "display_name", finalDisplayName },
        { "summary", finalSummary },
        { "agent_key", "custom_template" },
        { "is_enabled", finalIsEnabled },
        { "input_type", finalInputType },
        { "video_packaging_mode", finalVideoPackagingMode },
        { "inference_model", finalInferenceModel },
        { "model_fps", finalModelFps },
        { "run_every", finalRunEvery },
        { "running_resolution", finalRunningResolution },
        { "only_capture_on_motion", finalOnlyCaptureOnMotion },
        { "use_temporal_context", finalUseTemporalContext },
        { "prompt_template", finalPromptTemplate },
        { "alert_condition", finalAlertCondition },
        { "negative_condition", finalNegativeCondition },
        { "face_target_ids", nlohmann::json::array() },
        { "analysis_regions", finalAnalysisRegions },
    };

    if (mergedDraft.contains("resolved_face_targets") && mergedDraft["resolved_face_targets"].is_array()) {
        for (const auto& target : mergedDraft["resolved_face_targets"]) {
            int id = 0;
            if (tryJsonIntField_(target, "id", id) && id > 0) {
                finalSnapshot["face_target_ids"].push_back(id);
            }
        }
    }

    if (jsonStringField_(finalSnapshot, "prompt_template").empty() ||
        jsonStringField_(finalSnapshot, "alert_condition").empty()) {
        result.answer = buildFailureAnswer_(language, "agent_design_missing_required_fields");
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_design_retry",
            language == "pt" ? "Falha ao desenhar o agente" : "Failed to design the agent",
            result.answer,
            language,
            {},
            nlohmann::json::object());
        return result;
    }

    if (openForm) {
        const nlohmann::json resolvedCamera = mergedDraft.value("resolved_camera", nlohmann::json::object());
        result.answer = buildFormAnswer_(language, resolvedCamera);
        result.metadata["message_metadata"] = {
            { "type", "camera_agent_form_request" },
            { "status", "awaiting_form_open" },
            { "language", normalizeAssistantLanguageTag(language) },
            { "camera_id", resolvedCamera.value("id", 0) },
            { "camera_name", jsonStringField_(resolvedCamera, "name") },
            { "draft_agent", finalSnapshot },
        };
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "awaiting_confirmation",
            "awaiting_form_open",
            language == "pt" ? "Formulario do agente preparado" : "Agent form prepared",
            result.answer,
            language,
            {},
            nlohmann::json::object({
                { "type", "camera_agent_form_request" },
                { "status", "awaiting_form_open" },
            }));
        return result;
    }

    postChatProgress(
        agent,
        payload,
        buildAgentProgress_(language, "applying_agent", 4, 4, 4),
        2500);

    nlohmann::json createdDestinations = nlohmann::json::array();
    auto applyFailure = [&](const std::string& detail) {
        result.answer = !createdDestinations.empty()
            ? (language == "pt"
                ? buildSuccessAnswer_(language, createdDestinations) + "\n\nMas nao consegui aplicar o restante. Detalhe: " + detail
                : buildSuccessAnswer_(language, createdDestinations) + "\n\nBut I could not apply the remaining destinations. Detail: " + detail)
            : buildFailureAnswer_(language, detail);
        if (createdDestinations.is_array() && !createdDestinations.empty()) {
            result.metadata["created_destinations"] = createdDestinations;
            result.metadata["message_metadata"] = buildCreatedAgentMessageMetadata_(
                language,
                "partially_created",
                jsonStringField_(finalSnapshot, "display_name"),
                createdDestinations);
        }
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "completed",
            "agent_partially_created",
            language == "pt" ? "Criacao do agente encerrada" : "Agent creation finished",
            result.answer,
            language,
            {},
            nlohmann::json::object());
    };

    if (needsCameraDestination) {
        const nlohmann::json resolvedCamera = mergedDraft.value("resolved_camera", nlohmann::json::object());
        const int cameraId = resolvedCamera.value("id", 0);
        const HttpResponse createResponse = postJson(
            agentCameraCreateUrl_(agent, payload, cameraId),
            nlohmann::json::object({ { "snapshot", finalSnapshot } }).dump(),
            agent.getExeToken(),
            {},
            25000);
        if (!createResponse.ok()) {
            applyFailure(parseErrorMessage_(createResponse));
            return result;
        }
        nlohmann::json createdDestination = {
            { "destination_type", "camera" },
            { "camera_id", cameraId },
            { "camera_name", jsonStringField_(resolvedCamera, "name") },
            { "label", "Camera " + jsonStringField_(resolvedCamera, "name") },
        };
        const int createdAgentId = parseCreatedAgentId_(createResponse);
        if (createdAgentId > 0) {
            createdDestination["agent_id"] = createdAgentId;
        }
        createdDestinations.push_back(std::move(createdDestination));
    }

    if (needsStepDefaultDestination) {
        const nlohmann::json resolvedStep = mergedDraft.value("resolved_step", nlohmann::json::object());
        const int stepId = resolvedStep.value("id", 0);
        const HttpResponse createResponse = postJson(
            stepAgentCreateUrl_(agent, payload, stepId),
            nlohmann::json::object({ { "camera_id", nullptr }, { "snapshot", finalSnapshot } }).dump(),
            agent.getExeToken(),
            {},
            25000);
        if (!createResponse.ok()) {
            applyFailure(parseErrorMessage_(createResponse));
            return result;
        }
        nlohmann::json createdDestination = {
            { "destination_type", "step_default" },
            { "step_id", stepId },
            { "step_title", jsonStringField_(resolvedStep, "title") },
            { "job_id", resolvedStep.value("job_id", 0) },
            { "job_name", jsonStringField_(resolvedStep, "job_name") },
            { "label", "Step " + jsonStringField_(resolvedStep, "title") + " (" + jsonStringField_(resolvedStep, "job_name") + ")" },
        };
        const int createdAgentId = parseCreatedAgentId_(createResponse);
        if (createdAgentId > 0) {
            createdDestination["agent_id"] = createdAgentId;
        }
        createdDestinations.push_back(std::move(createdDestination));
    }

    if (needsStepCameraDestination) {
        const nlohmann::json resolvedStep = mergedDraft.value("resolved_step", nlohmann::json::object());
        const nlohmann::json resolvedStepCamera = mergedDraft.value("resolved_step_camera", nlohmann::json::object());
        const int stepId = resolvedStep.value("id", 0);
        const int cameraId = resolvedStepCamera.value("camera_id", 0);
        const HttpResponse createResponse = postJson(
            stepAgentCreateUrl_(agent, payload, stepId),
            nlohmann::json::object({ { "camera_id", cameraId }, { "snapshot", finalSnapshot } }).dump(),
            agent.getExeToken(),
            {},
            25000);
        if (!createResponse.ok()) {
            applyFailure(parseErrorMessage_(createResponse));
            return result;
        }
        nlohmann::json createdDestination = {
            { "destination_type", "step_camera" },
            { "step_id", stepId },
            { "step_title", jsonStringField_(resolvedStep, "title") },
            { "job_id", resolvedStep.value("job_id", 0) },
            { "job_name", jsonStringField_(resolvedStep, "job_name") },
            { "camera_id", cameraId },
            { "camera_name", jsonStringField_(resolvedStepCamera, "camera_name") },
            { "label", "Camera " + jsonStringField_(resolvedStepCamera, "camera_name") + " in step " + jsonStringField_(resolvedStep, "title") },
        };
        const int createdAgentId = parseCreatedAgentId_(createResponse);
        if (createdAgentId > 0) {
            createdDestination["agent_id"] = createdAgentId;
        }
        createdDestinations.push_back(std::move(createdDestination));
    }

    result.answer = buildSuccessAnswer_(language, createdDestinations);
    result.metadata["created_destinations"] = createdDestinations;
    result.metadata["message_metadata"] = buildCreatedAgentMessageMetadata_(
        language,
        "created",
        jsonStringField_(finalSnapshot, "display_name"),
        createdDestinations);
    result.metadata["task_state"] = buildTaskState_(
        conversationContext,
        mergedDraft,
        "completed",
        "agent_created",
        language == "pt" ? "Agente criado" : "Agent created",
        result.answer,
        language,
        {},
        nlohmann::json::object());
    return result;
}

} // namespace chatv2

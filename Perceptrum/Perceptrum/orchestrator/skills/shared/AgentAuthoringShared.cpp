#include "AgentAuthoringShared.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <utility>
#include <vector>

#include "../../../core/AgentCore.h"
#include "../../ChatModelConfig.h"
#include "../../LocalLlmClient.h"
#include "../../OperationTaskState.h"
#include "../../PromptBuilder.h"

namespace chatv2 {
namespace shared {
namespace {

std::string compactToken_(std::string value)
{
    value = lowerAscii(trimText(std::move(value)));
    std::string token;
    token.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            token.push_back(static_cast<char>(ch));
        }
    }
    return token;
}

std::string sceneSearchText_(const nlohmann::json& value)
{
    std::string combined;
    if (value.is_object()) {
        const std::vector<const char*> fields = {
            "scene_label",
            "scene_description",
            "description",
            "name",
            "slot_label",
            "slot_key",
            "camera_name",
        };
        for (const auto* field : fields) {
            const std::string text = jsonStringField(value, field);
            if (text.empty()) {
                continue;
            }
            if (!combined.empty()) {
                combined.push_back(' ');
            }
            combined += text;
        }
    }
    return normalizeInlineWhitespace(std::move(combined));
}

std::vector<std::string> semanticTokens_(std::string value)
{
    value = lowerAscii(normalizeInlineWhitespace(std::move(value)));
    std::string current;
    std::vector<std::string> tokens;
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            current.push_back(static_cast<char>(ch));
            continue;
        }
        if (!current.empty()) {
            tokens.push_back(current);
            current.clear();
        }
    }
    if (!current.empty()) {
        tokens.push_back(current);
    }
    return tokens;
}

bool containsAllSemanticTokens_(
    const std::vector<std::string>& haystack,
    const std::vector<std::string>& needle)
{
    if (needle.empty()) {
        return true;
    }
    for (const auto& token : needle) {
        if (std::find(haystack.begin(), haystack.end(), token) == haystack.end()) {
            return false;
        }
    }
    return true;
}

bool weakTokenMatch_(const std::string& candidate, const std::string& query)
{
    if (candidate.empty() || query.empty()) {
        return false;
    }
    return candidate.find(query) != std::string::npos ||
        query.find(candidate) != std::string::npos;
}

void appendUniqueCandidateById_(
    nlohmann::json& array,
    const nlohmann::json& candidate)
{
    if (!candidate.is_object()) {
        return;
    }
    int candidateId = 0;
    if (!tryJsonIntField(candidate, "id", candidateId) || candidateId <= 0) {
        return;
    }
    for (const auto& existing : array) {
        int existingId = 0;
        if (tryJsonIntField(existing, "id", existingId) && existingId == candidateId) {
            return;
        }
    }
    array.push_back(candidate);
}

std::vector<std::string> selectorSceneQueries_(const nlohmann::json& selector)
{
    std::vector<std::string> queries;
    if (!selector.is_object()) {
        return queries;
    }
    const std::vector<const char*> fields = {
        "scene_label",
        "scene_description",
        "description",
    };
    for (const auto* field : fields) {
        const std::string text = trimText(jsonStringField(selector, field));
        if (!text.empty() && std::find(queries.begin(), queries.end(), text) == queries.end()) {
            queries.push_back(text);
        }
    }
    return queries;
}

std::string normalizedJsonField_(const nlohmann::json& value, const char* key)
{
    return compactToken_(jsonStringField(value, key));
}

std::string normalizedDescriptionLabel_(const nlohmann::json& value)
{
    return compactToken_(jsonStringField(value, "scene_label"));
}

std::string normalizedDescriptionText_(const nlohmann::json& value)
{
    return compactToken_(sceneSearchText_(value));
}

std::vector<std::string> descriptionSemanticTokens_(const nlohmann::json& value)
{
    return semanticTokens_(sceneSearchText_(value));
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

std::string normalizeConnectionMethod_(std::string value)
{
    value = lowerAscii(trimText(std::move(value)));
    if (value == "http") {
        return "HTTP";
    }
    if (value == "onvif") {
        return "ONVIF";
    }
    if (value == "webcam") {
        return "WEBCAM";
    }
    return "RTSP";
}

} // namespace

std::string trimText(std::string value)
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

std::string lowerAscii(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string normalizeInlineWhitespace(std::string value)
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

    return trimText(std::move(normalized));
}

std::string slugifyKey(std::string value, const std::string& fallback)
{
    value = lowerAscii(normalizeInlineWhitespace(std::move(value)));
    std::string out;
    out.reserve(value.size());
    bool lastDash = false;
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            out.push_back(static_cast<char>(ch));
            lastDash = false;
            continue;
        }
        if (!out.empty() && !lastDash) {
            out.push_back('_');
            lastDash = true;
        }
    }
    while (!out.empty() && out.back() == '_') {
        out.pop_back();
    }
    return out.empty() ? fallback : out;
}

std::string jsonStringField(const nlohmann::json& value, const char* key)
{
    if (!value.is_object() || !value.contains(key) || !value[key].is_string()) {
        return "";
    }
    return trimText(value[key].get<std::string>());
}

bool tryJsonIntField(const nlohmann::json& value, const char* key, int& outValue)
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
            const std::string text = trimText(field.get<std::string>());
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

bool readBoolLoose(const nlohmann::json& value, bool& outValue)
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

    const std::string normalized = lowerAscii(trimText(value.get<std::string>()));
    if (normalized == "true" ||
        normalized == "1" ||
        normalized == "yes" ||
        normalized == "y" ||
        normalized == "sim" ||
        normalized == "s") {
        outValue = true;
        return true;
    }
    if (normalized == "false" ||
        normalized == "0" ||
        normalized == "no" ||
        normalized == "n" ||
        normalized == "nao") {
        outValue = false;
        return true;
    }
    return false;
}

std::string clientIdFromPayload(const nlohmann::json& payload)
{
    if (!payload.is_object() || !payload.contains("client_id") || !payload["client_id"].is_string()) {
        return "";
    }
    return trimText(payload["client_id"].get<std::string>());
}

nlohmann::json loadConversationContext(AgentCore& agent, const nlohmann::json& payload)
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

std::string effectiveReplyLanguage(
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

void configureActionModelClient(LocalLlmClient& llm, const nlohmann::json& payload)
{
    const LocalLlmClient::Config config = buildChatModelClientConfigFromPayload(payload, false);
    if (config.enabled) {
        llm.setRequestOverride(config);
    }
}

std::string parseErrorMessage(const HttpResponse& response)
{
    if (!response.body.empty()) {
        const std::string bodyText = trimText(response.body);
        const nlohmann::json parsed = nlohmann::json::parse(bodyText, nullptr, false);
        if (parsed.is_object()) {
            const std::string error = jsonStringField(parsed, "error");
            if (!error.empty()) {
                return error;
            }
            const std::string message = jsonStringField(parsed, "message");
            if (!message.empty()) {
                return message;
            }
        }
        if (!bodyText.empty() && bodyText.front() != '<') {
            const std::string singleLine = normalizeInlineWhitespace(bodyText);
            constexpr std::size_t kMaxErrorLen = 240;
            if (singleLine.size() > kMaxErrorLen) {
                return singleLine.substr(0, kMaxErrorLen - 3) + "...";
            }
            if (!singleLine.empty()) {
                return singleLine;
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

nlohmann::json fetchCameraInventory(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload(payload);
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
            { "error", parseErrorMessage(response) },
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
        if (!tryJsonIntField(item, "id", id) || id <= 0) {
            continue;
        }

        cameras.push_back(nlohmann::json::object({
            { "id", id },
            { "name", jsonStringField(item, "name") },
            { "description", jsonStringField(item, "description") },
            { "scene_label", jsonStringField(item, "scene_label") },
            { "scene_description", jsonStringField(item, "scene_description") },
            { "ip_address", jsonStringField(item, "ip_address") },
            { "manufacturer", jsonStringField(item, "manufacturer") },
            { "connection_method", normalizeConnectionMethod_(jsonStringField(item, "connection_method")) },
            { "channel", jsonStringField(item, "channel") },
            { "subtype", jsonStringField(item, "subtype") },
            { "is_service_running", item.value("is_service_running", false) },
        }));
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "cameras", cameras },
    });
}

nlohmann::json fetchJobInventory(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/jobs?client_id=" + clientId;
    const HttpResponse response = getUrl(
        url,
        agent.getExeToken(),
        {},
        7000);
    if (!response.ok()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", parseErrorMessage(response) },
            { "jobs", nlohmann::json::array() },
        });
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_array()) {
        return nlohmann::json::object({
            { "ok", false },
            { "error", "invalid_job_inventory" },
            { "jobs", nlohmann::json::array() },
        });
    }

    nlohmann::json jobs = nlohmann::json::array();
    for (const auto& item : parsed) {
        if (!item.is_object()) {
            continue;
        }
        int id = 0;
        if (!tryJsonIntField(item, "id", id) || id <= 0) {
            continue;
        }

        jobs.push_back(nlohmann::json::object({
            { "id", id },
            { "name", jsonStringField(item, "name") },
            { "description", jsonStringField(item, "description") },
            { "status", jsonStringField(item, "status") },
            { "schedule_mode", jsonStringField(item, "schedule_mode") },
            { "timezone", jsonStringField(item, "timezone") },
            { "runtime_status", lowerAscii(jsonStringField(item, "runtime_status")) },
            { "is_active", item.value("is_active", false) },
        }));
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "jobs", jobs },
    });
}

nlohmann::json fetchReferenceTargets(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload(payload);
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
            { "error", parseErrorMessage(response) },
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

nlohmann::json resolveCamera(
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
    if (tryJsonIntField(selector, "id", selectorId) && selectorId > 0) {
        for (const auto& camera : cameras) {
            int candidateId = 0;
            if (tryJsonIntField(camera, "id", candidateId) && candidateId == selectorId) {
                result["status"] = "resolved";
                result["item"] = camera;
                return result;
            }
        }
        result["status"] = "not_found";
        return result;
    }

    const std::string selectorIp = lowerAscii(jsonStringField(selector, "ip_address"));
    if (!selectorIp.empty()) {
        nlohmann::json matches = nlohmann::json::array();
        for (const auto& camera : cameras) {
            if (lowerAscii(jsonStringField(camera, "ip_address")) == selectorIp &&
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
        const std::string rawNameQuery = trimText(jsonStringField(selector, "name"));
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
        if (!semanticSceneMatches.empty() || !weakNameMatches.empty()) {
            nlohmann::json merged = semanticSceneMatches;
            for (const auto& candidate : weakNameMatches) {
                appendUniqueCandidateById_(merged, candidate);
            }
            result["status"] = "ambiguous";
            result["candidates"] = merged;
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

nlohmann::json resolveJob(
    const nlohmann::json& inventory,
    const nlohmann::json& selector,
    const nlohmann::json& activeResolved)
{
    nlohmann::json result = {
        { "status", "missing_target" },
        { "item", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    };

    const nlohmann::json jobs =
        inventory.is_object() && inventory.contains("jobs") && inventory["jobs"].is_array()
            ? inventory["jobs"]
            : nlohmann::json::array();
    if (jobs.empty()) {
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
    if (tryJsonIntField(selector, "id", selectorId) && selectorId > 0) {
        for (const auto& job : jobs) {
            int candidateId = 0;
            if (tryJsonIntField(job, "id", candidateId) && candidateId == selectorId) {
                result["status"] = "resolved";
                result["item"] = job;
                return result;
            }
        }
        result["status"] = "not_found";
        return result;
    }

    const std::string selectorName = normalizedJsonField_(selector, "name");
    nlohmann::json exactNameMatches = nlohmann::json::array();
    nlohmann::json weakNameMatches = nlohmann::json::array();
    if (!selectorName.empty()) {
        for (const auto& job : jobs) {
            const std::string candidateName = normalizedJsonField_(job, "name");
            if (candidateName.empty()) {
                continue;
            }
            if (candidateName == selectorName) {
                appendUniqueCandidateById_(exactNameMatches, job);
            }
            else if (candidateName.find(selectorName) != std::string::npos ||
                     selectorName.find(candidateName) != std::string::npos) {
                appendUniqueCandidateById_(weakNameMatches, job);
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

    const std::string descriptionQuery =
        normalizeInlineWhitespace(jsonStringField(selector, "description"));
    if (!descriptionQuery.empty()) {
        const std::string normalizedDescriptionQuery = compactToken_(descriptionQuery);
        const std::vector<std::string> descriptionQueryTokens = semanticTokens_(descriptionQuery);
        nlohmann::json exactDescriptionMatches = nlohmann::json::array();
        nlohmann::json semanticDescriptionMatches = nlohmann::json::array();

        for (const auto& job : jobs) {
            const std::string candidateDescription = compactToken_(jsonStringField(job, "description"));
            if (!normalizedDescriptionQuery.empty() &&
                candidateDescription == normalizedDescriptionQuery) {
                appendUniqueCandidateById_(exactDescriptionMatches, job);
                continue;
            }

            std::string searchableText = jsonStringField(job, "name");
            const std::string description = jsonStringField(job, "description");
            if (!description.empty()) {
                if (!searchableText.empty()) {
                    searchableText.push_back(' ');
                }
                searchableText += description;
            }
            const std::vector<std::string> searchableTokens = semanticTokens_(searchableText);
            if (!descriptionQueryTokens.empty() &&
                containsAllSemanticTokens_(searchableTokens, descriptionQueryTokens)) {
                appendUniqueCandidateById_(semanticDescriptionMatches, job);
                continue;
            }

            if (!normalizedDescriptionQuery.empty() &&
                weakTokenMatch_(compactToken_(searchableText), normalizedDescriptionQuery)) {
                appendUniqueCandidateById_(semanticDescriptionMatches, job);
            }
        }

        if (exactDescriptionMatches.size() == 1 && weakNameMatches.empty()) {
            result["status"] = "resolved";
            result["item"] = exactDescriptionMatches[0];
            return result;
        }
        if (exactDescriptionMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exactDescriptionMatches;
            return result;
        }
        if (semanticDescriptionMatches.size() == 1 && weakNameMatches.empty()) {
            result["status"] = "resolved";
            result["item"] = semanticDescriptionMatches[0];
            return result;
        }
        if (!semanticDescriptionMatches.empty() || !weakNameMatches.empty()) {
            nlohmann::json merged = semanticDescriptionMatches;
            for (const auto& candidate : weakNameMatches) {
                appendUniqueCandidateById_(merged, candidate);
            }
            result["status"] = "ambiguous";
            result["candidates"] = merged;
            return result;
        }
        result["status"] = "not_found";
        return result;
    }

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

    result["status"] = "not_found";
    return result;
}

nlohmann::json resolveNamedReference(
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
        if (tryJsonIntField(ref, "id", requestedId) && requestedId > 0) {
            bool foundById = false;
            for (const auto& item : inventory) {
                int itemId = 0;
                if (tryJsonIntField(item, "id", itemId) && itemId == requestedId) {
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
            semanticTokens_(jsonStringField(ref, "description"));
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
                std::string text = jsonStringField(item, "name");
                text += " " + jsonStringField(item, "description");
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
    std::string& outError)
{
    outError.clear();
    const std::string clientId = clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/agent-design?client_id=" + clientId;

    nlohmann::json designRequest = {
        { "goal_summary", goalSummary },
        { "language", normalizeAssistantLanguageTag(language) },
        { "require_snapshot", requireSnapshot && cameraId > 0 },
        { "agent_patch", agentPatch.is_object() ? agentPatch : nlohmann::json::object() },
        { "face_targets", faceTargets.is_array() ? faceTargets : nlohmann::json::array() },
        { "drakon_find_targets", drakonFindTargets.is_array() ? drakonFindTargets : nlohmann::json::array() },
        { "design_context", designContext.is_object() ? designContext : nlohmann::json::object() },
    };
    if (cameraId > 0) {
        designRequest["camera_id"] = cameraId;
    }

    const HttpResponse response = postJson(
        url,
        designRequest.dump(),
        agent.getExeToken(),
        {},
        30000);
    if (!response.ok()) {
        outError = parseErrorMessage(response);
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    const nlohmann::json design =
        parsed.is_object() && parsed.contains("design") && parsed["design"].is_object()
            ? parsed["design"]
            : nlohmann::json::object();
    if (design.empty()) {
        outError = "invalid_agent_design_payload";
        return nlohmann::json::object();
    }

    const auto patchValue = [&](const char* key, const nlohmann::json& fallback) -> nlohmann::json {
        if (agentPatch.is_object() && agentPatch.contains(key) && !agentPatch[key].is_null()) {
            return agentPatch[key];
        }
        if (design.contains(key) && !design[key].is_null()) {
            return design[key];
        }
        return fallback;
    };

    nlohmann::json snapshot = {
        { "type", "agent" },
        { "display_name", patchValue("display_name", goalSummary.empty() ? nlohmann::json("Job Agent") : nlohmann::json(goalSummary)) },
        { "summary", patchValue("summary", nlohmann::json(goalSummary)) },
        { "agent_key", "custom_template" },
        { "is_enabled", patchValue("is_enabled", nlohmann::json(true)) },
        { "input_type", patchValue("input_type", nlohmann::json("video")) },
        { "video_packaging_mode", patchValue("video_packaging_mode", nlohmann::json("mosaic_3x3")) },
        { "inference_model", patchValue("inference_model", nlohmann::json("ultra")) },
        { "model_fps", patchValue("model_fps", nlohmann::json(1)) },
        { "run_every", patchValue("run_every", nlohmann::json(60)) },
        { "running_resolution", patchValue("running_resolution", nlohmann::json(640)) },
        { "only_capture_on_motion", patchValue("only_capture_on_motion", nlohmann::json(true)) },
        { "use_temporal_context", patchValue("use_temporal_context", nlohmann::json(true)) },
        { "prompt_template", patchValue("prompt_template", nlohmann::json("")) },
        { "alert_condition", patchValue("alert_condition", nlohmann::json("")) },
        { "negative_condition", patchValue("negative_condition", nlohmann::json("")) },
        { "face_target_ids", nlohmann::json::array() },
        { "analysis_regions", patchValue("analysis_regions", nlohmann::json::array()) },
    };

    if (faceTargets.is_array()) {
        for (const auto& target : faceTargets) {
            int id = 0;
            if (tryJsonIntField(target, "id", id) && id > 0) {
                snapshot["face_target_ids"].push_back(id);
            }
        }
    }

    if (jsonStringField(snapshot, "prompt_template").empty() ||
        jsonStringField(snapshot, "alert_condition").empty()) {
        outError = "agent_design_missing_required_fields";
        return nlohmann::json::object();
    }

    return snapshot;
}

} // namespace shared
} // namespace chatv2

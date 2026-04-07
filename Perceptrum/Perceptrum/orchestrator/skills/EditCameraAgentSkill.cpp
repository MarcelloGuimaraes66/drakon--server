#include "EditCameraAgentSkill.h"

#include <algorithm>
#include <cctype>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#include "../../core/AgentCore.h"
#include "../HttpUtils.h"
#include "../OperationTaskState.h"
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

std::string compactToken_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    std::string out;
    out.reserve(value.size());
    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            out.push_back(static_cast<char>(ch));
        }
    }
    return out;
}

std::string normalizeInlineWhitespace_(std::string value)
{
    std::string out;
    out.reserve(value.size());
    bool lastWasSpace = false;
    for (unsigned char ch : value) {
        if (std::isspace(ch) != 0) {
            if (!out.empty() && !lastWasSpace) {
                out.push_back(' ');
            }
            lastWasSpace = true;
            continue;
        }
        out.push_back(static_cast<char>(ch));
        lastWasSpace = false;
    }
    return trimCopy_(std::move(out));
}

bool normalizedStringsEqual_(const std::string& left, const std::string& right)
{
    return normalizeInlineWhitespace_(left) == normalizeInlineWhitespace_(right);
}

std::string jsonStringField_(const nlohmann::json& value, const char* key)
{
    if (!value.is_object() || !value.contains(key) || !value[key].is_string()) {
        return "";
    }
    return trimCopy_(value[key].get<std::string>());
}

bool tryJsonIntField_(const nlohmann::json& value, const char* key, int& outValue)
{
    if (!value.is_object() || !value.contains(key)) {
        return false;
    }
    try {
        const auto& field = value[key];
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
    const std::string text = lowerAsciiCopy_(trimCopy_(value.get<std::string>()));
    if (text == "true" || text == "1" || text == "yes" || text == "sim") {
        outValue = true;
        return true;
    }
    if (text == "false" || text == "0" || text == "no" || text == "nao") {
        outValue = false;
        return true;
    }
    return false;
}

std::vector<std::string> semanticTokens_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    std::vector<std::string> tokens;
    std::string current;
    const std::set<std::string> stopwords = {
        "a", "agent", "agente", "camera", "cameras", "da", "de", "do", "dos",
        "e", "em", "na", "no", "o", "para", "step", "steps", "the", "um", "uma"
    };

    const auto flush = [&]() {
        if (current.size() <= 1 || stopwords.find(current) != stopwords.end()) {
            current.clear();
            return;
        }
        if (std::find(tokens.begin(), tokens.end(), current) == tokens.end()) {
            tokens.push_back(current);
        }
        current.clear();
    };

    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) current.push_back(static_cast<char>(ch));
        else flush();
    }
    flush();
    return tokens;
}

bool containsAllSemanticTokens_(
    const std::vector<std::string>& candidateTokens,
    const std::vector<std::string>& queryTokens)
{
    if (queryTokens.empty()) return true;
    if (candidateTokens.empty()) return false;
    for (const auto& token : queryTokens) {
        bool matched = false;
        for (const auto& candidate : candidateTokens) {
            if (candidate == token ||
                candidate.find(token) != std::string::npos ||
                token.find(candidate) != std::string::npos) {
                matched = true;
                break;
            }
        }
        if (!matched) return false;
    }
    return true;
}

bool stringMatchesLoose_(const std::string& candidate, const std::string& query)
{
    const std::string left = compactToken_(candidate);
    const std::string right = compactToken_(query);
    if (right.empty()) return true;
    if (left.empty()) return false;
    return left == right || left.find(right) != std::string::npos || right.find(left) != std::string::npos;
}

std::string clientIdFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() || !payload.contains("client_id") || !payload["client_id"].is_string()) {
        return "";
    }
    return trimCopy_(payload["client_id"].get<std::string>());
}

nlohmann::json loadConversationContext_(AgentCore& agent, const nlohmann::json& payload)
{
    const nlohmann::json fallback = {
        { "compact_context", nlohmann::json::object() },
        { "task_state", defaultOperationTaskState() },
        { "recent_turns", nlohmann::json::array() },
    };

    if (!payload.is_object()) return fallback;
    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) return fallback;

    std::ostringstream url;
    url << agent.getBackendBaseUrl()
        << "/api/agent/chat-context?client_id=" << agent.getClientId()
        << "&chat_session_id=" << chatSessionId;
    const int beforeMessageId = payload.value("context_before_message_id", 0);
    if (beforeMessageId > 0) {
        url << "&before_message_id=" << beforeMessageId;
    }

    const HttpResponse response = getUrl(url.str(), agent.getExeToken(), {}, 3500);
    if (!response.ok()) return fallback;
    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    return parsed.is_object() ? parsed : fallback;
}

std::string latestUserMessageFromConversationContext_(const nlohmann::json& conversationContext)
{
    if (!conversationContext.is_object() ||
        !conversationContext.contains("recent_turns") ||
        !conversationContext["recent_turns"].is_array()) {
        return "";
    }
    const auto& recentTurns = conversationContext["recent_turns"];
    for (auto it = recentTurns.rbegin(); it != recentTurns.rend(); ++it) {
        if (!it->is_object()) continue;
        if (lowerAsciiCopy_(jsonStringField_(*it, "role")) != "user") continue;
        const std::string content = normalizeInlineWhitespace_(jsonStringField_(*it, "content"));
        if (!content.empty()) return content;
    }
    return "";
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
    return activeTaskLanguage.empty() ? "en" : activeTaskLanguage;
}

std::string parseErrorMessage_(const HttpResponse& response)
{
    if (!response.body.empty()) {
        const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
        if (parsed.is_object()) {
            const std::string error = jsonStringField_(parsed, "error");
            if (!error.empty()) return error;
            const std::string message = jsonStringField_(parsed, "message");
            if (!message.empty()) return message;
        }
    }
    if (!response.error.empty()) return response.error;
    if (response.statusCode > 0) return "HTTP " + std::to_string(response.statusCode);
    return "unknown_error";
}

nlohmann::json normalizeSelectorObject_(
    const nlohmann::json& value,
    const std::vector<const char*>& stringFields,
    const std::vector<const char*>& intFields)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) return normalized;

    for (const auto* field : stringFields) {
        const std::string text = normalizeInlineWhitespace_(jsonStringField_(value, field));
        if (!text.empty()) normalized[field] = text;
    }
    for (const auto* field : intFields) {
        int outValue = 0;
        if (tryJsonIntField_(value, field, outValue) && outValue > 0) {
            normalized[field] = outValue;
        }
    }
    return normalized;
}

nlohmann::json normalizeTargetSelector_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) return normalized;

    const std::string hint = lowerAsciiCopy_(jsonStringField_(value, "destination_type_hint"));
    if (hint == "camera" || hint == "step_default" || hint == "step_camera" || hint == "unknown") {
        normalized["destination_type_hint"] = hint;
    }

    const nlohmann::json cameraSelector = normalizeSelectorObject_(
        value.value("camera_selector", nlohmann::json::object()),
        { "name", "scene_label", "scene_description" },
        { "id" });
    if (!cameraSelector.empty()) normalized["camera_selector"] = cameraSelector;

    const nlohmann::json stepSelector = normalizeSelectorObject_(
        value.value("step_selector", nlohmann::json::object()),
        { "title", "job_name" },
        { "id", "job_id" });
    if (!stepSelector.empty()) normalized["step_selector"] = stepSelector;

    const nlohmann::json stepCameraSelector = normalizeSelectorObject_(
        value.value("step_camera_selector", nlohmann::json::object()),
        { "camera_name", "slot_key", "slot_label", "scene_label", "scene_description" },
        { "target_id", "camera_id" });
    if (!stepCameraSelector.empty()) normalized["step_camera_selector"] = stepCameraSelector;

    const nlohmann::json agentSelector = normalizeSelectorObject_(
        value.value("agent_selector", nlohmann::json::object()),
        { "display_name", "summary", "prompt_excerpt", "alert_condition_excerpt", "semantic_hint" },
        { "id" });
    if (!agentSelector.empty()) normalized["agent_selector"] = agentSelector;

    return normalized;
}

 nlohmann::json normalizeAgentPatch_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) return normalized;

    for (const auto* field : {
            "display_name", "summary", "input_type", "video_packaging_mode",
            "inference_model", "prompt_template", "alert_condition", "negative_condition"
        }) {
        const std::string text = normalizeInlineWhitespace_(jsonStringField_(value, field));
        if (!text.empty()) normalized[field] = text;
    }

    for (const auto* field : { "model_fps", "run_every", "running_resolution" }) {
        int outValue = 0;
        if (tryJsonIntField_(value, field, outValue) && outValue >= 0) {
            normalized[field] = outValue;
        }
    }

    for (const auto* field : { "only_capture_on_motion", "use_temporal_context", "is_enabled" }) {
        bool outValue = false;
        if (value.contains(field) && readBoolLoose_(value[field], outValue)) {
            normalized[field] = outValue;
        }
    }

    if (value.contains("analysis_regions") && value["analysis_regions"].is_array()) {
        normalized["analysis_regions"] = value["analysis_regions"];
    }
    return normalized;
}

nlohmann::json normalizeStringArray_(const nlohmann::json& value)
{
    nlohmann::json out = nlohmann::json::array();
    std::set<std::string> seen;
    if (!value.is_array()) return out;
    for (const auto& entry : value) {
        if (!entry.is_string()) continue;
        const std::string text = lowerAsciiCopy_(trimCopy_(entry.get<std::string>()));
        if (text.empty() || seen.find(text) != seen.end()) continue;
        seen.insert(text);
        out.push_back(text);
    }
    return out;
}

nlohmann::json normalizeReferenceList_(const nlohmann::json& value)
{
    nlohmann::json out = nlohmann::json::array();
    if (!value.is_array()) return out;
    for (const auto& entry : value) {
        if (!entry.is_object()) continue;
        nlohmann::json normalized = nlohmann::json::object();
        int id = 0;
        if (tryJsonIntField_(entry, "id", id) && id > 0) normalized["id"] = id;
        const std::string name = normalizeInlineWhitespace_(jsonStringField_(entry, "name"));
        if (!name.empty()) normalized["name"] = name;
        if (!normalized.empty()) out.push_back(normalized);
    }
    return out;
}

nlohmann::json normalizeRouterEditAgentDraft_(const SkillSelection& selection)
{
    nlohmann::json out = nlohmann::json::object();
    const nlohmann::json args = selection.arguments.is_object() ? selection.arguments : nlohmann::json::object();

    const nlohmann::json targetSelector = normalizeTargetSelector_(args.value("target_selector", nlohmann::json::object()));
    if (!targetSelector.empty()) out["target_selector"] = targetSelector;

    const nlohmann::json agentPatch = normalizeAgentPatch_(args.value("agent_patch", nlohmann::json::object()));
    if (!agentPatch.empty()) out["agent_patch"] = agentPatch;

    const nlohmann::json clearFields = normalizeStringArray_(args.value("clear_fields", nlohmann::json::array()));
    if (!clearFields.empty()) out["clear_fields"] = clearFields;

    if (args.contains("face_target_ops") && args["face_target_ops"].is_object()) {
        const auto& ops = args["face_target_ops"];
        nlohmann::json normalizedOps = nlohmann::json::object({
            { "replace_refs", normalizeReferenceList_(ops.value("replace_refs", nlohmann::json::array())) },
            { "add_refs", normalizeReferenceList_(ops.value("add_refs", nlohmann::json::array())) },
            { "remove_refs", normalizeReferenceList_(ops.value("remove_refs", nlohmann::json::array())) },
        });
        bool clearAll = false;
        if (ops.contains("clear_all") && readBoolLoose_(ops["clear_all"], clearAll)) {
            normalizedOps["clear_all"] = clearAll;
        }
        if (!normalizedOps["replace_refs"].empty() || !normalizedOps["add_refs"].empty() ||
            !normalizedOps["remove_refs"].empty() || normalizedOps.contains("clear_all")) {
            out["face_target_ops"] = normalizedOps;
        }
    }

    if (args.contains("analysis_region_ops") && args["analysis_region_ops"].is_object()) {
        const auto& ops = args["analysis_region_ops"];
        nlohmann::json normalizedOps = nlohmann::json::object();
        const std::string mode = lowerAsciiCopy_(jsonStringField_(ops, "mode"));
        if (mode == "preserve" || mode == "replace" || mode == "clear" || mode == "needs_form") {
            normalizedOps["mode"] = mode;
        }
        if (ops.contains("regions") && ops["regions"].is_array()) {
            normalizedOps["regions"] = ops["regions"];
        }
        const std::string semanticHint = normalizeInlineWhitespace_(jsonStringField_(ops, "semantic_hint"));
        if (!semanticHint.empty()) {
            normalizedOps["semantic_hint"] = semanticHint;
        }
        bool requiresVisual = false;
        if (ops.contains("requires_visual_context") && readBoolLoose_(ops["requires_visual_context"], requiresVisual)) {
            normalizedOps["requires_visual_context"] = requiresVisual;
        }
        if (!normalizedOps.empty()) out["analysis_region_ops"] = normalizedOps;
    }

    bool openForm = false;
    if (args.contains("open_form") && readBoolLoose_(args["open_form"], openForm)) {
        out["open_form"] = openForm;
    }
    return out;
}

nlohmann::json activeEditAgentDraft_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return nlohmann::json::object();
    }
    const auto& activeTask = taskState["active_task"];
    return (jsonStringField_(activeTask, "type") == "edit_camera_agent" &&
            activeTask.contains("draft") &&
            activeTask["draft"].is_object())
        ? activeTask["draft"]
        : nlohmann::json::object();
}

nlohmann::json mergeDrafts_(const nlohmann::json& base, const nlohmann::json& incoming)
{
    nlohmann::json merged = base.is_object() ? base : nlohmann::json::object();
    if (!incoming.is_object()) return merged;

    for (const auto* field : { "target_selector", "agent_patch", "face_target_ops", "analysis_region_ops", "resolved_agent" }) {
        if (!incoming.contains(field) || !incoming[field].is_object()) continue;
        nlohmann::json value = merged.value(field, nlohmann::json::object());
        for (auto it = incoming[field].begin(); it != incoming[field].end(); ++it) {
            value[it.key()] = it.value();
        }
        merged[field] = value;
    }

    if (incoming.contains("clear_fields") && incoming["clear_fields"].is_array()) {
        merged["clear_fields"] = normalizeStringArray_(incoming["clear_fields"]);
    }
    if (incoming.contains("open_form")) {
        merged["open_form"] = incoming["open_form"];
    }
    return merged;
}

nlohmann::json fetchAgentInventory_(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty() ? agent.getClientId() : clientIdFromPayload_(payload);
    const std::string url = agent.getBackendBaseUrl() + "/api/agent/agents?client_id=" + clientId;
    const HttpResponse response = getUrl(url, agent.getExeToken(), {}, 9000);
    if (!response.ok()) {
        return { { "ok", false }, { "error", parseErrorMessage_(response) }, { "agents", nlohmann::json::array() } };
    }
    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object() || !parsed.contains("agents") || !parsed["agents"].is_array()) {
        return { { "ok", false }, { "error", "invalid_agent_inventory" }, { "agents", nlohmann::json::array() } };
    }
    return { { "ok", true }, { "error", "" }, { "agents", parsed["agents"] } };
}

nlohmann::json fetchReferenceTargets_(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty() ? agent.getClientId() : clientIdFromPayload_(payload);
    const std::string url = agent.getBackendBaseUrl() + "/api/agent/reference-targets?client_id=" + clientId;
    const HttpResponse response = getUrl(url, agent.getExeToken(), {}, 7000);
    if (!response.ok()) {
        return { { "ok", false }, { "error", parseErrorMessage_(response) }, { "face_targets", nlohmann::json::array() } };
    }
    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    return parsed.is_object()
        ? nlohmann::json({ { "ok", true }, { "error", "" }, { "face_targets", parsed.value("face_targets", nlohmann::json::array()) } })
        : nlohmann::json({ { "ok", false }, { "error", "invalid_reference_target_payload" }, { "face_targets", nlohmann::json::array() } });
}

std::string locationTypeOf_(const nlohmann::json& value)
{
    return lowerAsciiCopy_(jsonStringField_(value, "location_type"));
}

bool entryMatchesTargetSelector_(const nlohmann::json& item, const nlohmann::json& targetSelector)
{
    const std::string hint = lowerAsciiCopy_(jsonStringField_(targetSelector, "destination_type_hint"));
    if (!hint.empty() && hint != "unknown" && locationTypeOf_(item) != hint) return false;

    const auto cameraSelector = targetSelector.value("camera_selector", nlohmann::json::object());
    if (!cameraSelector.empty()) {
        int id = 0;
        if (tryJsonIntField_(cameraSelector, "id", id) && id > 0) {
            int cameraId = 0;
            if (!tryJsonIntField_(item, "camera_id", cameraId) || cameraId != id) return false;
        }
        if (!stringMatchesLoose_(jsonStringField_(item, "camera_name"), jsonStringField_(cameraSelector, "name"))) return false;
        const std::string sceneText = jsonStringField_(item, "scene_label") + " " + jsonStringField_(item, "scene_description");
        if (!containsAllSemanticTokens_(semanticTokens_(sceneText), semanticTokens_(jsonStringField_(cameraSelector, "scene_label")))) return false;
        if (!containsAllSemanticTokens_(semanticTokens_(sceneText), semanticTokens_(jsonStringField_(cameraSelector, "scene_description")))) return false;
    }

    const auto stepSelector = targetSelector.value("step_selector", nlohmann::json::object());
    if (!stepSelector.empty()) {
        int id = 0;
        if (tryJsonIntField_(stepSelector, "id", id) && id > 0) {
            int stepId = 0;
            if (!tryJsonIntField_(item, "step_id", stepId) || stepId != id) return false;
        }
        int jobId = 0;
        if (tryJsonIntField_(stepSelector, "job_id", jobId) && jobId > 0) {
            int candidateJobId = 0;
            if (!tryJsonIntField_(item, "job_id", candidateJobId) || candidateJobId != jobId) return false;
        }
        if (!stringMatchesLoose_(jsonStringField_(item, "step_title"), jsonStringField_(stepSelector, "title"))) return false;
        if (!stringMatchesLoose_(jsonStringField_(item, "job_name"), jsonStringField_(stepSelector, "job_name"))) return false;
    }

    const auto stepCameraSelector = targetSelector.value("step_camera_selector", nlohmann::json::object());
    if (!stepCameraSelector.empty()) {
        if (locationTypeOf_(item) != "step_camera") return false;
        int targetId = 0;
        if (tryJsonIntField_(stepCameraSelector, "target_id", targetId) && targetId > 0) {
            int candidateTargetId = 0;
            if (!tryJsonIntField_(item, "target_id", candidateTargetId) || candidateTargetId != targetId) return false;
        }
        int cameraId = 0;
        if (tryJsonIntField_(stepCameraSelector, "camera_id", cameraId) && cameraId > 0) {
            int candidateCameraId = 0;
            if (!tryJsonIntField_(item, "camera_id", candidateCameraId) || candidateCameraId != cameraId) return false;
        }
        if (!stringMatchesLoose_(jsonStringField_(item, "camera_name"), jsonStringField_(stepCameraSelector, "camera_name"))) return false;
        if (!stringMatchesLoose_(jsonStringField_(item, "slot_key"), jsonStringField_(stepCameraSelector, "slot_key"))) return false;
        if (!stringMatchesLoose_(jsonStringField_(item, "slot_label"), jsonStringField_(stepCameraSelector, "slot_label"))) return false;
    }

    return true;
}

int scoreAgentSelector_(const nlohmann::json& item, const nlohmann::json& targetSelector)
{
    const auto agentSelector = targetSelector.value("agent_selector", nlohmann::json::object());
    if (agentSelector.empty()) return 1;

    int id = 0;
    if (tryJsonIntField_(agentSelector, "id", id) && id > 0) {
        int agentId = 0;
        return tryJsonIntField_(item, "agent_id", agentId) && agentId == id ? 1000 : -1;
    }

    int score = 0;
    const std::string displayName = jsonStringField_(agentSelector, "display_name");
    if (!displayName.empty()) {
        if (!stringMatchesLoose_(jsonStringField_(item, "display_name"), displayName)) return -1;
        score += compactToken_(jsonStringField_(item, "display_name")) == compactToken_(displayName) ? 300 : 180;
    }
    const std::string summary = jsonStringField_(agentSelector, "summary");
    if (!summary.empty() && !containsAllSemanticTokens_(semanticTokens_(jsonStringField_(item, "summary")), semanticTokens_(summary))) return -1;
    if (!summary.empty()) score += 90;
    const std::string promptExcerpt = jsonStringField_(agentSelector, "prompt_excerpt");
    if (!promptExcerpt.empty() && !containsAllSemanticTokens_(semanticTokens_(jsonStringField_(item, "prompt_template")), semanticTokens_(promptExcerpt))) return -1;
    if (!promptExcerpt.empty()) score += 80;
    const std::string alertExcerpt = jsonStringField_(agentSelector, "alert_condition_excerpt");
    if (!alertExcerpt.empty() && !containsAllSemanticTokens_(semanticTokens_(jsonStringField_(item, "alert_condition")), semanticTokens_(alertExcerpt))) return -1;
    if (!alertExcerpt.empty()) score += 80;
    const std::string semanticHint = jsonStringField_(agentSelector, "semantic_hint");
    const std::string searchText =
        jsonStringField_(item, "display_name") + " " + jsonStringField_(item, "summary") + " " +
        jsonStringField_(item, "prompt_template") + " " + jsonStringField_(item, "alert_condition") + " " +
        jsonStringField_(item, "camera_name") + " " + jsonStringField_(item, "step_title") + " " +
        jsonStringField_(item, "job_name");
    if (!semanticHint.empty() && !containsAllSemanticTokens_(semanticTokens_(searchText), semanticTokens_(semanticHint))) return -1;
    if (!semanticHint.empty()) score += 120;
    return score;
}

nlohmann::json buildResolvedAgent_(const nlohmann::json& item)
{
    nlohmann::json resolved = nlohmann::json::object();
    if (!item.is_object()) return resolved;
    for (const auto* field : { "location_type", "agent_key", "display_name", "camera_name", "step_title", "job_name", "slot_key", "slot_label" }) {
        const std::string text = jsonStringField_(item, field);
        if (!text.empty()) resolved[field] = text;
    }
    for (const auto* field : { "agent_id", "camera_id", "step_id", "job_id", "target_id" }) {
        int outValue = 0;
        if (tryJsonIntField_(item, field, outValue) && outValue > 0) resolved[field] = outValue;
    }
    if (item.contains("snapshot") && item["snapshot"].is_object()) resolved["snapshot"] = item["snapshot"];
    return resolved;
}

nlohmann::json resolveAgent_(
    const nlohmann::json& inventory,
    const nlohmann::json& targetSelector,
    const nlohmann::json& activeResolved)
{
    const nlohmann::json agents =
        inventory.is_object() && inventory.contains("agents") && inventory["agents"].is_array()
            ? inventory["agents"]
            : nlohmann::json::array();
    nlohmann::json result = {
        { "status", "missing_target" },
        { "item", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    };

    if (agents.empty()) {
        result["status"] = "not_found";
        return result;
    }
    if ((!targetSelector.is_object() || targetSelector.empty()) && activeResolved.is_object() && !activeResolved.empty()) {
        result["status"] = "resolved";
        result["item"] = activeResolved;
        return result;
    }
    if (!targetSelector.is_object() || targetSelector.empty()) {
        return result;
    }

    nlohmann::json filtered = nlohmann::json::array();
    int bestScore = -1;
    int secondScore = -1;
    nlohmann::json bestItem = nlohmann::json::object();
    for (const auto& item : agents) {
        if (!item.is_object() || !entryMatchesTargetSelector_(item, targetSelector)) continue;
        filtered.push_back(item);
        const int score = scoreAgentSelector_(item, targetSelector);
        if (score > bestScore) {
            secondScore = bestScore;
            bestScore = score;
            bestItem = item;
        }
        else if (score > secondScore) {
            secondScore = score;
        }
    }

    if (filtered.empty() || bestScore < 0) {
        result["status"] = "not_found";
        return result;
    }
    if (bestScore > 1 && bestScore > secondScore) {
        result["status"] = "resolved";
        result["item"] = buildResolvedAgent_(bestItem);
        return result;
    }
    if (filtered.size() == 1) {
        result["status"] = "resolved";
        result["item"] = buildResolvedAgent_(filtered[0]);
        return result;
    }
    result["status"] = "ambiguous";
    result["candidates"] = filtered;
    return result;
}

std::string agentLabel_(const nlohmann::json& agent)
{
    const std::string name = jsonStringField_(agent, "display_name");
    const std::string locationType = locationTypeOf_(agent);
    std::string location;
    if (locationType == "camera") location = jsonStringField_(agent, "camera_name");
    else if (locationType == "step_default") location = jsonStringField_(agent, "step_title");
    else location = jsonStringField_(agent, "camera_name") + " / " + jsonStringField_(agent, "step_title");
    return name.empty() ? location : (location.empty() ? name : name + " [" + location + "]");
}

nlohmann::json buildEditorTarget_(const nlohmann::json& resolvedAgent)
{
    nlohmann::json target = nlohmann::json::object({ { "type", locationTypeOf_(resolvedAgent) } });
    for (const auto* field : { "camera_id", "step_id", "job_id" }) {
        int outValue = 0;
        if (tryJsonIntField_(resolvedAgent, field, outValue) && outValue > 0) target[field] = outValue;
    }
    for (const auto* field : { "camera_name", "step_title", "job_name" }) {
        const std::string text = jsonStringField_(resolvedAgent, field);
        if (!text.empty()) target[field] = text;
    }
    return target;
}

std::string agentDesignUrl_(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload).empty() ? agent.getClientId() : clientIdFromPayload_(payload);
    return agent.getBackendBaseUrl() + "/api/agent/agent-design?client_id=" + clientId;
}

bool hasPolygonRequestCue_(std::string text)
{
    text = lowerAsciiCopy_(trimCopy_(std::move(text)));
    if (text.empty()) return false;
    const bool hasShapeCue =
        text.find("polygon") != std::string::npos ||
        text.find("polig") != std::string::npos ||
        text.find("roi") != std::string::npos ||
        text.find("regiao") != std::string::npos ||
        text.find("region") != std::string::npos ||
        text.find("area") != std::string::npos ||
        text.find("zona") != std::string::npos ||
        text.find("zone") != std::string::npos;
    const bool hasActionCue =
        text.find("draw") != std::string::npos ||
        text.find("desenh") != std::string::npos ||
        text.find("mark") != std::string::npos ||
        text.find("marc") != std::string::npos ||
        text.find("outline") != std::string::npos ||
        text.find("around") != std::string::npos ||
        text.find("volta") != std::string::npos;
    return hasShapeCue || (hasActionCue && (text.find("porta") != std::string::npos || text.find("door") != std::string::npos));
}

std::string resolveVisualGoal_(
    const SkillSelection& selection,
    const nlohmann::json& analysisRegionOps,
    const nlohmann::json& conversationContext)
{
    const std::string semanticHint = normalizeInlineWhitespace_(jsonStringField_(analysisRegionOps, "semantic_hint"));
    if (!semanticHint.empty()) return semanticHint;

    const std::string latestUserMessage = latestUserMessageFromConversationContext_(conversationContext);
    if (!latestUserMessage.empty()) return latestUserMessage;

    return normalizeInlineWhitespace_(selection.taskGoal);
}

std::string buildNeedVisualEditCameraAnswer_(const std::string& language, const nlohmann::json& resolvedAgent)
{
    if (locationTypeOf_(resolvedAgent) == "step_default") {
        if (language == "pt") {
            return "Para sugerir o poligono com seguranca nesse agente da etapa, preciso saber qual camera alvo do step deve fornecer o snapshot.";
        }
        return "To suggest the polygon safely for this step agent, I need to know which target camera in the step should provide the snapshot.";
    }
    if (language == "pt") {
        return "Para sugerir o poligono com seguranca, preciso de uma camera valida para analisar o snapshot desse agente.";
    }
    return "To suggest the polygon safely, I need a valid camera to analyze the snapshot for this agent.";
}

bool isGeneratedCustomAgentName_(const std::string& value)
{
    std::string normalized = lowerAsciiCopy_(trimCopy_(value));
    if (normalized.rfind("custom_", 0) != 0) return false;
    normalized = normalized.substr(7);
    if (normalized.rfind("hub_", 0) == 0) normalized = normalized.substr(4);
    if (normalized.empty() || std::isdigit(static_cast<unsigned char>(normalized.front())) == 0) return false;
    for (unsigned char ch : normalized) {
        if (std::isalnum(ch) == 0 && ch != '_' && ch != '-') return false;
    }
    return true;
}

std::string truncateForCard_(std::string value, std::size_t maxLen = 160)
{
    value = normalizeInlineWhitespace_(std::move(value));
    if (value.size() <= maxLen) return value;
    if (maxLen <= 3) return value.substr(0, maxLen);
    return value.substr(0, maxLen - 3) + "...";
}

std::vector<int> normalizeIntList_(const nlohmann::json& value)
{
    std::vector<int> ids;
    if (!value.is_array()) return ids;
    for (const auto& entry : value) {
        try {
            if (entry.is_number_integer()) ids.push_back(entry.get<int>());
            else if (entry.is_number()) ids.push_back(static_cast<int>(entry.get<double>()));
            else if (entry.is_string()) ids.push_back(std::stoi(trimCopy_(entry.get<std::string>())));
        }
        catch (...) {
        }
    }
    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
    return ids;
}

std::string joinIntList_(const std::vector<int>& values)
{
    std::ostringstream out;
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index > 0) out << ", ";
        out << values[index];
    }
    return out.str();
}

std::string bestAgentName_(const nlohmann::json& resolvedAgent, const nlohmann::json& snapshot, const std::string& language)
{
    const bool isPt = normalizeAssistantLanguageTag(language) == "pt";
    const std::string snapshotName = jsonStringField_(snapshot, "display_name");
    if (!snapshotName.empty() && !isGeneratedCustomAgentName_(snapshotName)) return snapshotName;

    const std::string resolvedName = jsonStringField_(resolvedAgent, "display_name");
    if (!resolvedName.empty() && !isGeneratedCustomAgentName_(resolvedName)) return resolvedName;

    const std::string summary = jsonStringField_(snapshot, "summary");
    if (!summary.empty()) return truncateForCard_(summary, 96);

    int agentId = 0;
    if (tryJsonIntField_(resolvedAgent, "agent_id", agentId) && agentId > 0) {
        return (isPt ? "Agente " : "Agent ") + std::to_string(agentId);
    }
    return isPt ? "Agente existente" : "Existing agent";
}

bool hasSyntheticSummary_(const nlohmann::json& snapshot)
{
    const std::string summary = jsonStringField_(snapshot, "summary");
    if (summary.empty()) return false;

    const std::string promptTemplate = jsonStringField_(snapshot, "prompt_template");
    if (!promptTemplate.empty() && normalizedStringsEqual_(summary, promptTemplate)) {
        return true;
    }

    const std::string alertCondition = jsonStringField_(snapshot, "alert_condition");
    if (!alertCondition.empty() && normalizedStringsEqual_(summary, alertCondition)) {
        return true;
    }

    return false;
}

std::string bestAgentSummary_(const nlohmann::json& snapshot)
{
    const std::string summary = jsonStringField_(snapshot, "summary");
    if (!summary.empty() && !hasSyntheticSummary_(snapshot)) {
        return truncateForCard_(summary, 180);
    }

    for (const auto* field : { "prompt_template", "alert_condition" }) {
        const std::string text = jsonStringField_(snapshot, field);
        if (!text.empty()) return truncateForCard_(text, 180);
    }
    return "";
}

std::string fieldLabel_(const std::string& field, const std::string& language)
{
    const bool isPt = normalizeAssistantLanguageTag(language) == "pt";
    if (field == "display_name") return isPt ? "Nome do agente" : "Agent Name";
    if (field == "summary") return isPt ? "Resumo" : "Summary";
    if (field == "prompt_template") return "Prompt Core";
    if (field == "alert_condition") return "Alert Condition";
    if (field == "negative_condition") return "Negative Condition";
    if (field == "input_type") return isPt ? "Tipo de entrada" : "Input Type";
    if (field == "video_packaging_mode") return isPt ? "Empacotamento de video" : "Video Packaging";
    if (field == "inference_model") return isPt ? "Modelo" : "Model";
    if (field == "model_fps") return "Model FPS";
    if (field == "run_every") return isPt ? "Executa a cada" : "Run Every";
    if (field == "running_resolution") return isPt ? "Resolucao" : "Resolution";
    if (field == "only_capture_on_motion") return isPt ? "Captura so com movimento" : "Only Capture On Motion";
    if (field == "use_temporal_context") return isPt ? "Contexto temporal" : "Temporal Context";
    if (field == "is_enabled") return isPt ? "Status" : "Status";
    if (field == "face_target_ids") return "Face IDs";
    if (field == "analysis_regions") return isPt ? "Poligonos" : "Polygons";
    return field;
}

std::string emptyFieldValueLabel_(const std::string& language)
{
    return normalizeAssistantLanguageTag(language) == "pt" ? "vazio" : "empty";
}

std::string formatFieldValue_(const std::string& field, const nlohmann::json& value, const std::string& language)
{
    const bool isPt = normalizeAssistantLanguageTag(language) == "pt";
    const std::string emptyLabel = emptyFieldValueLabel_(language);

    if (field == "face_target_ids") {
        const auto ids = normalizeIntList_(value);
        if (ids.empty()) return isPt ? "nenhum" : "none";
        if (ids.size() <= 4) {
            return std::to_string(ids.size()) + (ids.size() == 1 ? " face ID: " : " face IDs: ") + joinIntList_(ids);
        }
        return std::to_string(ids.size()) + (isPt ? " face IDs" : " face IDs");
    }

    if (field == "analysis_regions") {
        const std::size_t count = value.is_array() ? value.size() : 0;
        if (count == 0) return isPt ? "nenhum poligono" : "no polygons";
        return std::to_string(count) + (count == 1 ? (isPt ? " poligono" : " polygon") : (isPt ? " poligonos" : " polygons"));
    }

    if (field == "model_fps") {
        int outValue = 0;
        if (tryJsonIntField_(nlohmann::json::object({ { "value", value } }), "value", outValue)) {
            return std::to_string(outValue) + " fps";
        }
    }

    if (field == "run_every") {
        int outValue = 0;
        if (tryJsonIntField_(nlohmann::json::object({ { "value", value } }), "value", outValue)) {
            return std::to_string(outValue) + " s";
        }
    }

    if (field == "running_resolution") {
        int outValue = 0;
        if (tryJsonIntField_(nlohmann::json::object({ { "value", value } }), "value", outValue)) {
            return std::to_string(outValue) + " px";
        }
    }

    if (field == "is_enabled" || field == "only_capture_on_motion" || field == "use_temporal_context") {
        bool outValue = false;
        if (readBoolLoose_(value, outValue)) {
            if (field == "is_enabled") return outValue ? (isPt ? "ativado" : "enabled") : (isPt ? "desativado" : "disabled");
            return outValue ? (isPt ? "sim" : "yes") : (isPt ? "nao" : "no");
        }
    }

    if (value.is_null()) return emptyLabel;
    if (value.is_string()) {
        const std::string text = truncateForCard_(value.get<std::string>());
        return text.empty() ? emptyLabel : text;
    }
    if (value.is_boolean()) {
        return value.get<bool>() ? (isPt ? "sim" : "yes") : (isPt ? "nao" : "no");
    }
    if (value.is_number_integer()) return std::to_string(value.get<int>());
    if (value.is_number()) {
        std::ostringstream out;
        out << value.get<double>();
        return out.str();
    }
    if (value.is_array()) {
        return std::to_string(value.size()) + (isPt ? " itens" : " items");
    }
    if (value.is_object()) {
        return truncateForCard_(value.dump(), 120);
    }
    return emptyLabel;
}

bool fieldChanged_(const std::string& field, const nlohmann::json& beforeValue, const nlohmann::json& afterValue)
{
    if (field == "face_target_ids") {
        return normalizeIntList_(beforeValue) != normalizeIntList_(afterValue);
    }
    return beforeValue != afterValue;
}

nlohmann::json buildEditContextMetadata_(
    const nlohmann::json& resolvedAgent,
    const nlohmann::json& snapshot,
    const std::string& language)
{
    const nlohmann::json editorTarget = buildEditorTarget_(resolvedAgent);
    nlohmann::json metadata = {
        { "type", "camera_agent_edit_context" },
        { "status", "awaiting_changes" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "editor_target", editorTarget },
        { "agent_name", bestAgentName_(resolvedAgent, snapshot, language) },
    };

    int agentId = 0;
    if (tryJsonIntField_(resolvedAgent, "agent_id", agentId) && agentId > 0) metadata["agent_id"] = agentId;

    const std::string summary = bestAgentSummary_(snapshot);
    if (!summary.empty()) metadata["agent_summary"] = summary;

    if (editorTarget.contains("camera_id")) metadata["camera_id"] = editorTarget["camera_id"];
    if (editorTarget.contains("camera_name")) metadata["camera_name"] = editorTarget["camera_name"];
    return metadata;
}

nlohmann::json buildUpdatedFieldsMetadata_(
    const nlohmann::json& beforeSnapshot,
    const nlohmann::json& afterSnapshot,
    const std::string& language)
{
    const std::vector<std::string> fields = {
        "display_name",
        "summary",
        "prompt_template",
        "alert_condition",
        "negative_condition",
        "face_target_ids",
        "analysis_regions",
        "inference_model",
        "input_type",
        "video_packaging_mode",
        "model_fps",
        "run_every",
        "running_resolution",
        "only_capture_on_motion",
        "use_temporal_context",
        "is_enabled",
    };

    nlohmann::json rows = nlohmann::json::array();
    for (const auto& field : fields) {
        if (field == "summary") {
            const bool beforeSynthetic = hasSyntheticSummary_(beforeSnapshot);
            const bool afterSynthetic = hasSyntheticSummary_(afterSnapshot);
            if (beforeSynthetic && afterSynthetic) {
                continue;
            }
        }
        const nlohmann::json beforeValue = beforeSnapshot.contains(field) ? beforeSnapshot[field] : nlohmann::json();
        const nlohmann::json afterValue = afterSnapshot.contains(field) ? afterSnapshot[field] : nlohmann::json();
        if (!fieldChanged_(field, beforeValue, afterValue)) continue;
        rows.push_back({
            { "field", field },
            { "label", fieldLabel_(field, language) },
            { "before", formatFieldValue_(field, beforeValue, language) },
            { "after", formatFieldValue_(field, afterValue, language) },
        });
    }
    return rows;
}

nlohmann::json buildUpdateResultMetadata_(
    const nlohmann::json& resolvedAgent,
    const nlohmann::json& beforeSnapshot,
    const nlohmann::json& afterSnapshot,
    const std::string& language)
{
    const nlohmann::json editorTarget = buildEditorTarget_(resolvedAgent);
    nlohmann::json metadata = {
        { "type", "camera_agent_update_result" },
        { "status", "updated" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "editor_target", editorTarget },
        { "agent_name", bestAgentName_(resolvedAgent, afterSnapshot, language) },
        { "updated_fields", buildUpdatedFieldsMetadata_(beforeSnapshot, afterSnapshot, language) },
    };

    int agentId = 0;
    if (tryJsonIntField_(resolvedAgent, "agent_id", agentId) && agentId > 0) metadata["agent_id"] = agentId;

    const std::string summary = bestAgentSummary_(afterSnapshot);
    if (!summary.empty()) metadata["agent_summary"] = summary;

    return metadata;
}

nlohmann::json buildAgentFormRequestMetadata_(
    const std::string& language,
    const int agentId,
    const nlohmann::json& editorTarget,
    const nlohmann::json& draftAgent)
{
    nlohmann::json metadata = {
        { "type", "camera_agent_form_request" },
        { "status", "awaiting_form_open" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "agent_id", agentId },
        { "editor_target", editorTarget },
        { "draft_agent", draftAgent },
    };
    if (editorTarget.contains("camera_id")) metadata["camera_id"] = editorTarget["camera_id"];
    if (editorTarget.contains("camera_name")) metadata["camera_name"] = editorTarget["camera_name"];
    return metadata;
}

std::string buildVisualPolygonNotFoundAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Analisei o snapshot da camera, mas nao consegui localizar com seguranca a area pedida para desenhar o poligono. Preparei o formulario de edicao do agente no card abaixo para voce revisar e marcar manualmente.";
    }
    return "I analyzed the camera snapshot, but I could not safely locate the requested area to draw the polygon. I prepared the agent edit form in the card below so you can review it and mark it manually.";
}

void applyClearFields_(nlohmann::json& snapshot, const nlohmann::json& clearFields)
{
    for (const auto& entry : clearFields) {
        if (!entry.is_string()) continue;
        const std::string field = entry.get<std::string>();
        if (field == "analysis_regions" || field == "face_target_ids") snapshot[field] = nlohmann::json::array();
        else if (field == "display_name" || field == "summary" || field == "prompt_template" || field == "alert_condition" || field == "negative_condition") snapshot[field] = "";
        else snapshot[field] = nullptr;
    }
}

std::vector<int> resolvedReferenceIds_(const nlohmann::json& inventory, const nlohmann::json& refs)
{
    std::vector<int> ids;
    for (const auto& ref : refs) {
        int requestedId = 0;
        if (tryJsonIntField_(ref, "id", requestedId) && requestedId > 0) {
            ids.push_back(requestedId);
            continue;
        }
        const std::string requestedName = jsonStringField_(ref, "name");
        for (const auto& item : inventory) {
            int id = 0;
            if (!tryJsonIntField_(item, "id", id) || id <= 0) continue;
            if (stringMatchesLoose_(jsonStringField_(item, "name"), requestedName)) {
                ids.push_back(id);
                break;
            }
        }
    }
    std::sort(ids.begin(), ids.end());
    ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
    return ids;
}

nlohmann::json buildTaskDraft_(const nlohmann::json& mergedDraft)
{
    nlohmann::json draft = nlohmann::json::object();
    for (const auto* field : { "target_selector", "resolved_agent", "agent_patch", "clear_fields", "face_target_ops", "analysis_region_ops", "open_form" }) {
        if (mergedDraft.contains(field)) draft[field] = mergedDraft[field];
    }
    return draft;
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
    const OperationTaskDescriptor descriptor{
        "edit_camera_agent",
        "camera_agent",
        "update",
        status,
        phase,
        normalizeAssistantLanguageTag(language),
        language == "pt" ? "editar um agente" : "edit an agent",
        summary,
        trimCopy_(answer),
        missingFields,
        {},
        buildTaskDraft_(mergedDraft),
        nlohmann::json::object(),
        uiContract,
    };
    return status == "completed"
        ? completeOperationTask(conversationContext, descriptor)
        : upsertActiveOperationTask(conversationContext, descriptor);
}

std::string cameraPatchUrl_(AgentCore& agent, const nlohmann::json& payload, int cameraId, int agentId)
{
    const std::string clientId = clientIdFromPayload_(payload).empty() ? agent.getClientId() : clientIdFromPayload_(payload);
    std::ostringstream url;
    url << agent.getBackendBaseUrl() << "/api/agent/cameras/" << cameraId << "/custom-agents/" << agentId << "?client_id=" << clientId;
    return url.str();
}

std::string stepPatchUrl_(AgentCore& agent, const nlohmann::json& payload, int stepId, int agentId)
{
    const std::string clientId = clientIdFromPayload_(payload).empty() ? agent.getClientId() : clientIdFromPayload_(payload);
    std::ostringstream url;
    url << agent.getBackendBaseUrl() << "/api/agent/job-steps/" << stepId << "/agents/" << agentId << "?client_id=" << clientId;
    return url.str();
}

} // namespace

SkillDefinition EditCameraAgentSkill::definition() const
{
    return {
        "edit_camera_agent",
        "Edits an existing camera agent or step agent using structured JSON from the semantic router.",
        true,
    };
}

SkillRunResult EditCameraAgentSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "edit_camera_agent";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string language = effectiveReplyLanguage_(selection, payload, conversationContext);
    nlohmann::json mergedDraft = mergeDrafts_(activeEditAgentDraft_(conversationContext), normalizeRouterEditAgentDraft_(selection));
    const std::string latestUserMessage = latestUserMessageFromConversationContext_(conversationContext);

    const nlohmann::json inventory = fetchAgentInventory_(agent, payload);
    if (!inventory.value("ok", false)) {
        result.answer = language == "pt" ? "Nao consegui consultar os agentes existentes." : "I could not load the existing agents.";
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "collecting_input", "awaiting_context", result.answer, result.answer, language, {}, nlohmann::json::object());
        return result;
    }

    const nlohmann::json resolution = resolveAgent_(inventory, mergedDraft.value("target_selector", nlohmann::json::object()), mergedDraft.value("resolved_agent", nlohmann::json::object()));
    const std::string resolutionStatus = jsonStringField_(resolution, "status");
    if (resolutionStatus == "missing_target") {
        result.answer = language == "pt" ? "Me diga qual agente existente voce quer editar." : "Tell me which existing agent you want me to edit.";
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "collecting_input", "awaiting_target", result.answer, result.answer, language, { "agent" }, nlohmann::json::object());
        return result;
    }
    if (resolutionStatus == "not_found") {
        result.answer = language == "pt" ? "Nao encontrei um agente existente que combine com esse pedido." : "I could not find an existing agent matching that request.";
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "collecting_input", "awaiting_target", result.answer, result.answer, language, { "agent" }, nlohmann::json::object());
        return result;
    }
    if (resolutionStatus == "ambiguous") {
        std::ostringstream out;
        out << (language == "pt" ? "Encontrei mais de um agente possivel. Me confirme qual voce quer editar:" : "I found more than one possible agent. Please confirm which one you want to edit:");
        int count = 0;
        for (const auto& item : resolution["candidates"]) {
            out << "\n- " << agentLabel_(item);
            if (++count >= 5) break;
        }
        result.answer = out.str();
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "collecting_input", "awaiting_target_confirmation", result.answer, result.answer, language, { "agent" }, nlohmann::json::object());
        return result;
    }

    mergedDraft["resolved_agent"] = resolution["item"];
    nlohmann::json snapshot = resolution["item"].contains("snapshot") && resolution["item"]["snapshot"].is_object() ? resolution["item"]["snapshot"] : nlohmann::json::object();
    snapshot["type"] = "agent";
    if (!snapshot.contains("agent_key") || !snapshot["agent_key"].is_string()) {
        const std::string agentKey = jsonStringField_(resolution["item"], "agent_key");
        if (!agentKey.empty()) snapshot["agent_key"] = agentKey;
    }
    const nlohmann::json originalSnapshot = snapshot;

    const nlohmann::json analysisRegionOps = mergedDraft.value("analysis_region_ops", nlohmann::json::object());
    const std::string analysisMode = lowerAsciiCopy_(jsonStringField_(analysisRegionOps, "mode"));
    const bool explicitOpenForm = mergedDraft.value("open_form", false);
    const bool requiresVisualContext =
        analysisRegionOps.contains("requires_visual_context") &&
        analysisRegionOps["requires_visual_context"].is_boolean() &&
        analysisRegionOps["requires_visual_context"].get<bool>();
    const bool inferredVisualRequest =
        analysisRegionOps.empty() &&
        hasPolygonRequestCue_(latestUserMessage);
    const bool visualDesignRequested =
        analysisMode == "needs_form" ||
        !jsonStringField_(analysisRegionOps, "semantic_hint").empty() ||
        requiresVisualContext ||
        inferredVisualRequest;

    const bool hasPatch = mergedDraft.contains("agent_patch") && mergedDraft["agent_patch"].is_object() && !mergedDraft["agent_patch"].empty();
    const bool hasClear = mergedDraft.contains("clear_fields") && mergedDraft["clear_fields"].is_array() && !mergedDraft["clear_fields"].empty();
    const bool hasFaceOps = mergedDraft.contains("face_target_ops") && mergedDraft["face_target_ops"].is_object() && !mergedDraft["face_target_ops"].empty();
    const bool hasRegionOps = analysisMode == "clear" || analysisMode == "replace";
    if (!explicitOpenForm && !hasPatch && !hasClear && !hasFaceOps && !hasRegionOps && !visualDesignRequested) {
        result.answer = language == "pt"
            ? "Encontrei o agente. Veja o card abaixo e me diga o que voce quer mudar nele."
            : "I found the agent. Check the card below and tell me what you want to change.";
        result.metadata["message_metadata"] = buildEditContextMetadata_(resolution["item"], snapshot, language);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            mergedDraft,
            "collecting_input",
            "awaiting_changes",
            result.answer,
            result.answer,
            language,
            { "changes" },
            nlohmann::json::object({ { "type", "camera_agent_edit_context" }, { "status", "awaiting_changes" } }));
        return result;
    }

    applyClearFields_(snapshot, mergedDraft.value("clear_fields", nlohmann::json::array()));
    if (hasPatch) for (auto it = mergedDraft["agent_patch"].begin(); it != mergedDraft["agent_patch"].end(); ++it) snapshot[it.key()] = it.value();
    if (analysisMode == "clear") snapshot["analysis_regions"] = nlohmann::json::array();
    if (analysisMode == "replace" && analysisRegionOps.contains("regions") && analysisRegionOps["regions"].is_array()) snapshot["analysis_regions"] = analysisRegionOps["regions"];

    if (hasFaceOps) {
        const nlohmann::json targets = fetchReferenceTargets_(agent, payload);
        if (!targets.value("ok", false)) {
            result.answer = language == "pt" ? "Nao consegui consultar os alvos faciais." : "I could not load the face targets.";
            result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "collecting_input", "awaiting_face_targets", result.answer, result.answer, language, {}, nlohmann::json::object());
            return result;
        }
        std::set<int> ids;
        if (snapshot.contains("face_target_ids") && snapshot["face_target_ids"].is_array()) {
            for (const auto& entry : snapshot["face_target_ids"]) if (entry.is_number_integer()) ids.insert(entry.get<int>());
        }
        const auto& ops = mergedDraft["face_target_ops"];
        const bool clearAll = ops.contains("clear_all") && ops["clear_all"].is_boolean() && ops["clear_all"].get<bool>();
        const auto replaceIds = resolvedReferenceIds_(targets["face_targets"], ops.value("replace_refs", nlohmann::json::array()));
        const auto addIds = resolvedReferenceIds_(targets["face_targets"], ops.value("add_refs", nlohmann::json::array()));
        const auto removeIds = resolvedReferenceIds_(targets["face_targets"], ops.value("remove_refs", nlohmann::json::array()));
        if (clearAll) ids.clear();
        if (!replaceIds.empty()) { ids.clear(); ids.insert(replaceIds.begin(), replaceIds.end()); }
        ids.insert(addIds.begin(), addIds.end());
        for (int id : removeIds) ids.erase(id);
        snapshot["face_target_ids"] = nlohmann::json::array();
        for (int id : ids) snapshot["face_target_ids"].push_back(id);
    }

    if (visualDesignRequested && !hasRegionOps) {
        const int designCameraId = resolution["item"].value("camera_id", 0);
        if (designCameraId <= 0) {
            result.answer = buildNeedVisualEditCameraAnswer_(language, resolution["item"]);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_visual_camera",
                result.answer,
                result.answer,
                language,
                { "visual_camera" },
                nlohmann::json::object());
            return result;
        }

        nlohmann::json designAgentPatch = nlohmann::json::object();
        for (const auto* field : {
                "display_name", "summary", "prompt_template", "alert_condition", "negative_condition",
                "input_type", "video_packaging_mode", "inference_model", "model_fps", "run_every",
                "running_resolution", "only_capture_on_motion", "use_temporal_context"
            }) {
            if (snapshot.contains(field)) {
                designAgentPatch[field] = snapshot[field];
            }
        }

        const std::string visualGoal = resolveVisualGoal_(selection, analysisRegionOps, conversationContext);
        if (visualGoal.empty()) {
            result.answer = language == "pt"
                ? "Me diga qual area visivel da imagem voce quer marcar com o poligono."
                : "Tell me which visible area in the image you want me to mark with the polygon.";
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_visual_goal",
                result.answer,
                result.answer,
                language,
                { "visual_goal" },
                nlohmann::json::object());
            return result;
        }

        nlohmann::json designRequest = {
            { "goal_summary", visualGoal },
            { "language", normalizeAssistantLanguageTag(language) },
            { "require_snapshot", true },
            { "camera_id", designCameraId },
            { "agent_patch", designAgentPatch },
            { "face_targets", nlohmann::json::array() },
            { "drakon_find_targets", nlohmann::json::array() },
        };
        const HttpResponse designResponse = postJson(
            agentDesignUrl_(agent, payload),
            designRequest.dump(),
            agent.getExeToken(),
            {},
            30000);
        if (!designResponse.ok()) {
            result.answer = language == "pt"
                ? "Nao consegui analisar o snapshot da camera para sugerir o poligono. Detalhe: " + parseErrorMessage_(designResponse)
                : "I could not analyze the camera snapshot to suggest the polygon. Detail: " + parseErrorMessage_(designResponse);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "collecting_input",
                "awaiting_design_retry",
                result.answer,
                result.answer,
                language,
                {},
                nlohmann::json::object());
            return result;
        }

        const nlohmann::json parsedDesignResponse = nlohmann::json::parse(designResponse.body, nullptr, false);
        const nlohmann::json design =
            parsedDesignResponse.is_object() &&
            parsedDesignResponse.contains("design") &&
            parsedDesignResponse["design"].is_object()
                ? parsedDesignResponse["design"]
                : nlohmann::json::object();
        const nlohmann::json suggestedRegions = design.value("analysis_regions", nlohmann::json::array());
        if (!suggestedRegions.is_array() || suggestedRegions.empty()) {
            const int agentId = resolution["item"].value("agent_id", 0);
            const nlohmann::json editorTarget = buildEditorTarget_(resolution["item"]);
            snapshot["id"] = agentId;
            result.answer = buildVisualPolygonNotFoundAnswer_(language);
            result.metadata["message_metadata"] = buildAgentFormRequestMetadata_(language, agentId, editorTarget, snapshot);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                mergedDraft,
                "awaiting_confirmation",
                "awaiting_form_open",
                result.answer,
                result.answer,
                language,
                {},
                nlohmann::json::object({ { "type", "camera_agent_form_request" }, { "status", "awaiting_form_open" } }));
            return result;
        }

        snapshot["analysis_regions"] = suggestedRegions;
    }

    if (explicitOpenForm) {
        const int agentId = resolution["item"].value("agent_id", 0);
        snapshot["id"] = agentId;
        const nlohmann::json editorTarget = buildEditorTarget_(resolution["item"]);
        result.answer = language == "pt" ? "Preparei o formulario de edicao do agente no card abaixo." : "I prepared the agent edit form in the card below.";
        result.metadata["message_metadata"] = buildAgentFormRequestMetadata_(language, agentId, editorTarget, snapshot);
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "awaiting_confirmation", "awaiting_form_open", result.answer, result.answer, language, {}, nlohmann::json::object({ { "type", "camera_agent_form_request" }, { "status", "awaiting_form_open" } }));
        return result;
    }

    if (jsonStringField_(snapshot, "prompt_template").empty() || jsonStringField_(snapshot, "alert_condition").empty()) {
        result.answer = language == "pt"
            ? "Para aplicar a edicao direto eu preciso manter Prompt Core e Alert Condition preenchidos. Me diga os novos valores ou peca para abrir o formulario."
            : "To apply the edit directly I need Prompt Core and Alert Condition to stay filled. Tell me the new values or ask me to open the form.";
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "collecting_input", "awaiting_required_fields", result.answer, result.answer, language, { "prompt_template", "alert_condition" }, nlohmann::json::object());
        return result;
    }

    HttpResponse response;
    const int agentId = resolution["item"].value("agent_id", 0);
    if (locationTypeOf_(resolution["item"]) == "camera") {
        response = patchJson(cameraPatchUrl_(agent, payload, resolution["item"].value("camera_id", 0), agentId), nlohmann::json::object({ { "snapshot", snapshot } }).dump(), agent.getExeToken(), {}, 25000);
    }
    else {
        response = patchJson(stepPatchUrl_(agent, payload, resolution["item"].value("step_id", 0), agentId), nlohmann::json::object({ { "snapshot", snapshot } }).dump(), agent.getExeToken(), {}, 25000);
    }

    if (!response.ok()) {
        result.answer = (language == "pt" ? "Nao consegui editar o agente. Detalhe: " : "I could not edit the agent. Detail: ") + parseErrorMessage_(response);
        result.metadata["task_state"] = buildTaskState_(conversationContext, mergedDraft, "completed", "edit_failed", result.answer, result.answer, language, {}, nlohmann::json::object());
        return result;
    }

    result.answer = language == "pt"
        ? "Agente atualizado com sucesso. Veja no card abaixo o que mudou."
        : "Agent updated successfully. Check the card below to see what changed.";
    result.metadata["message_metadata"] = buildUpdateResultMetadata_(resolution["item"], originalSnapshot, snapshot, language);
    result.metadata["task_state"] = buildTaskState_(
        conversationContext,
        mergedDraft,
        "completed",
        "agent_updated",
        result.answer,
        result.answer,
        language,
        {},
        nlohmann::json::object({ { "type", "camera_agent_update_result" }, { "status", "updated" } }));
    return result;
}

} // namespace chatv2

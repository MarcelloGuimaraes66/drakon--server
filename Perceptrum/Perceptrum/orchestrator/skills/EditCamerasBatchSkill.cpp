#include "EditCamerasBatchSkill.h"

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

std::string normalizeConnectionMethod_(std::string value)
{
    value = upperAsciiCopy_(trimCopy_(std::move(value)));
    if (value == "RTSP" ||
        value == "HTTP" ||
        value == "ONVIF" ||
        value == "WEBCAM") {
        return value;
    }
    return "";
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

const std::vector<const char*>& batchEditStringPatchFields_()
{
    static const std::vector<const char*> fields = {
        "name",
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "channel",
        "subtype",
        "description",
        "street",
        "number",
        "city",
        "state",
        "zip_code",
        "country",
    };
    return fields;
}

const std::vector<const char*>& batchEditClearableFields_()
{
    static const std::vector<const char*> fields = {
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "channel",
        "subtype",
        "description",
        "street",
        "number",
        "city",
        "state",
        "zip_code",
        "country",
        "webcam_index",
    };
    return fields;
}

bool containsAllowedField_(
    const std::vector<const char*>& fields,
    const std::string& value)
{
    return std::find(fields.begin(), fields.end(), value) != fields.end();
}

nlohmann::json normalizePatchFieldValue_(
    const std::string& key,
    const nlohmann::json& value)
{
    for (const auto* field : batchEditStringPatchFields_()) {
        if (key == field) {
            if (!value.is_string()) {
                return nullptr;
            }
            const std::string text = trimCopy_(value.get<std::string>());
            return text.empty() ? nlohmann::json(nullptr) : nlohmann::json(text);
        }
    }

    if (key == "connection_method") {
        if (!value.is_string()) {
            return nullptr;
        }
        const std::string method = normalizeConnectionMethod_(value.get<std::string>());
        return method.empty() ? nlohmann::json(nullptr) : nlohmann::json(method);
    }

    if (key == "retention_days" || key == "webcam_index") {
        if (value.is_number_integer()) {
            return value.get<int>();
        }
        if (value.is_number()) {
            return static_cast<int>(value.get<double>());
        }
        if (value.is_string()) {
            try {
                return std::stoi(trimCopy_(value.get<std::string>()));
            }
            catch (...) {
                return nullptr;
            }
        }
        return nullptr;
    }

    if (key == "allowpublicaccess" || key == "is_service_running") {
        if (value.is_boolean()) {
            return value.get<bool>();
        }
        if (value.is_number_integer()) {
            return value.get<int>() != 0;
        }
        if (value.is_string()) {
            const std::string normalized = lowerAsciiCopy_(trimCopy_(value.get<std::string>()));
            if (normalized == "true" || normalized == "1" || normalized == "yes" || normalized == "sim") {
                return true;
            }
            if (normalized == "false" || normalized == "0" || normalized == "no" || normalized == "nao") {
                return false;
            }
        }
        return nullptr;
    }

    return nullptr;
}

nlohmann::json normalizeBatchEditPatch_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) {
        return normalized;
    }

    for (auto it = value.begin(); it != value.end(); ++it) {
        const nlohmann::json normalizedValue = normalizePatchFieldValue_(it.key(), it.value());
        if (normalizedValue.is_null()) {
            continue;
        }
        normalized[it.key()] = normalizedValue;
    }

    return normalized;
}

nlohmann::json normalizeFieldSources_(
    const nlohmann::json& value,
    const nlohmann::json& patch)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object() || !patch.is_object()) {
        return normalized;
    }

    for (auto it = value.begin(); it != value.end(); ++it) {
        if (!it.value().is_string() || !patch.contains(it.key())) {
            continue;
        }
        const std::string source = trimCopy_(it.value().get<std::string>());
        if (!source.empty()) {
            normalized[it.key()] = source;
        }
    }
    return normalized;
}

nlohmann::json normalizeClearFields_(const nlohmann::json& value)
{
    nlohmann::json fields = nlohmann::json::array();
    if (!value.is_array()) {
        return fields;
    }

    for (const auto& entry : value) {
        if (!entry.is_string()) {
            continue;
        }
        const std::string field = trimCopy_(entry.get<std::string>());
        if (!containsAllowedField_(batchEditClearableFields_(), field)) {
            continue;
        }

        bool alreadyPresent = false;
        for (const auto& existing : fields) {
            if (existing.is_string() && existing.get<std::string>() == field) {
                alreadyPresent = true;
                break;
            }
        }
        if (!alreadyPresent) {
            fields.push_back(field);
        }
    }

    return fields;
}

nlohmann::json normalizeCameraIdArrayLoose_(const nlohmann::json& value)
{
    nlohmann::json ids = nlohmann::json::array();

    auto appendId = [&](int candidateId) {
        if (candidateId <= 0) {
            return;
        }
        for (const auto& existing : ids) {
            if (existing.is_number_integer() && existing.get<int>() == candidateId) {
                return;
            }
        }
        ids.push_back(candidateId);
    };

    if (value.is_number_integer()) {
        appendId(value.get<int>());
        return ids;
    }
    if (value.is_string()) {
        try {
            appendId(std::stoi(trimCopy_(value.get<std::string>())));
        }
        catch (...) {
        }
        return ids;
    }
    if (!value.is_array()) {
        return ids;
    }

    for (const auto& entry : value) {
        if (entry.is_number_integer()) {
            appendId(entry.get<int>());
        }
        else if (entry.is_number()) {
            appendId(static_cast<int>(entry.get<double>()));
        }
        else if (entry.is_string()) {
            try {
                appendId(std::stoi(trimCopy_(entry.get<std::string>())));
            }
            catch (...) {
            }
        }
    }

    return ids;
}

nlohmann::json compactCameraReference_(const nlohmann::json& camera)
{
    nlohmann::json compact = nlohmann::json::object();
    if (!camera.is_object()) {
        return compact;
    }

    int id = 0;
    if (tryJsonIntField_(camera, "id", id) && id > 0) {
        compact["id"] = id;
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
            compact[field] = text;
        }
    }

    return compact;
}

const nlohmann::json& cameraInventoryArray_(const nlohmann::json& inventory)
{
    static const nlohmann::json emptyArray = nlohmann::json::array();
    if (!inventory.is_object() ||
        !inventory.contains("cameras") ||
        !inventory["cameras"].is_array()) {
        return emptyArray;
    }
    return inventory["cameras"];
}

nlohmann::json revalidateCameraIdsForInventory_(
    const nlohmann::json& ids,
    const nlohmann::json& inventory)
{
    const auto& cameras = cameraInventoryArray_(inventory);
    nlohmann::json normalized = nlohmann::json::array();
    if (!ids.is_array() || cameras.empty()) {
        return normalized;
    }

    for (const auto& entry : ids) {
        if (!entry.is_number_integer()) {
            continue;
        }

        const int targetId = entry.get<int>();
        if (targetId <= 0) {
            continue;
        }

        bool exists = false;
        for (const auto& camera : cameras) {
            int cameraId = 0;
            if (tryJsonIntField_(camera, "id", cameraId) && cameraId == targetId) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            continue;
        }

        bool duplicate = false;
        for (const auto& existing : normalized) {
            if (existing.is_number_integer() && existing.get<int>() == targetId) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) {
            normalized.push_back(targetId);
        }
    }

    return normalized;
}

nlohmann::json selectedCamerasFromIds_(
    const nlohmann::json& inventory,
    const nlohmann::json& ids)
{
    const auto& cameras = cameraInventoryArray_(inventory);
    nlohmann::json selected = nlohmann::json::array();
    if (cameras.empty() || !ids.is_array()) {
        return selected;
    }

    for (const auto& idValue : ids) {
        if (!idValue.is_number_integer()) {
            continue;
        }
        const int targetId = idValue.get<int>();
        for (const auto& camera : cameras) {
            int cameraId = 0;
            if (tryJsonIntField_(camera, "id", cameraId) && cameraId == targetId) {
                selected.push_back(compactCameraReference_(camera));
                break;
            }
        }
    }

    return selected;
}

nlohmann::json allCameraIds_(const nlohmann::json& inventory)
{
    const auto& cameras = cameraInventoryArray_(inventory);
    nlohmann::json ids = nlohmann::json::array();
    for (const auto& camera : cameras) {
        int id = 0;
        if (tryJsonIntField_(camera, "id", id) && id > 0) {
            ids.push_back(id);
        }
    }
    return ids;
}

nlohmann::json adoptStructuredScopeHint_(
    const nlohmann::json& scopeHint,
    const nlohmann::json& inventory)
{
    nlohmann::json adopted = nlohmann::json::object();

    if (scopeHint.is_object() &&
        scopeHint.contains("mode") &&
        scopeHint["mode"].is_string()) {
        const std::string mode = lowerAsciiCopy_(trimCopy_(scopeHint["mode"].get<std::string>()));
        if (mode == "all") {
            const nlohmann::json ids = allCameraIds_(inventory);
            if (!ids.empty()) {
                adopted["camera_ids"] = ids;
                adopted["selection_status"] = "resolved";
            }
            return adopted;
        }
    }

    if (scopeHint.is_object()) {
        int selectorId = 0;
        if (tryJsonIntField_(scopeHint, "id", selectorId) && selectorId > 0) {
            nlohmann::json ids = nlohmann::json::array({ selectorId });
            ids = revalidateCameraIdsForInventory_(ids, inventory);
            if (!ids.empty()) {
                adopted["camera_ids"] = ids;
                adopted["selection_status"] = "resolved";
            }
        }
    }

    return adopted;
}

nlohmann::json normalizeBatchEditDraft_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const nlohmann::json cameraIds =
        normalizeCameraIdArrayLoose_(value.value("camera_ids", nlohmann::json::array()));
    if (!cameraIds.empty()) {
        normalized["camera_ids"] = cameraIds;
    }

    const nlohmann::json candidateIds =
        normalizeCameraIdArrayLoose_(value.value("candidate_camera_ids", nlohmann::json::array()));
    if (!candidateIds.empty()) {
        normalized["candidate_camera_ids"] = candidateIds;
    }

    const nlohmann::json patch =
        normalizeBatchEditPatch_(value.value("camera_patch", nlohmann::json::object()));
    if (!patch.empty()) {
        normalized["camera_patch"] = patch;
    }

    const nlohmann::json fieldSources =
        normalizeFieldSources_(value.value("field_sources", nlohmann::json::object()), patch);
    if (!fieldSources.empty()) {
        normalized["field_sources"] = fieldSources;
    }

    nlohmann::json clearFields =
        normalizeClearFields_(value.value("clear_fields", nlohmann::json::array()));
    if (patch.is_object()) {
        nlohmann::json filtered = nlohmann::json::array();
        for (const auto& entry : clearFields) {
            if (!entry.is_string()) {
                continue;
            }
            if (patch.contains(entry.get<std::string>())) {
                continue;
            }
            filtered.push_back(entry);
        }
        clearFields = filtered;
    }
    if (!clearFields.empty()) {
        normalized["clear_fields"] = clearFields;
    }

    if (value.contains("selection_status") && value["selection_status"].is_string()) {
        const std::string status = lowerAsciiCopy_(trimCopy_(value["selection_status"].get<std::string>()));
        if (status == "resolved" ||
            status == "missing_scope" ||
            status == "needs_clarification" ||
            status == "not_found") {
            normalized["selection_status"] = status;
        }
    }

    if (value.contains("scope_hint") &&
        (value["scope_hint"].is_object() || value["scope_hint"].is_array()) &&
        !value["scope_hint"].empty()) {
        normalized["scope_hint"] = value["scope_hint"];
    }

    if (value.contains("selected_cameras") && value["selected_cameras"].is_array()) {
        nlohmann::json selected = nlohmann::json::array();
        for (const auto& entry : value["selected_cameras"]) {
            const nlohmann::json compact = compactCameraReference_(entry);
            if (!compact.empty()) {
                selected.push_back(compact);
            }
        }
        if (!selected.empty()) {
            normalized["selected_cameras"] = selected;
        }
    }

    return normalized;
}

nlohmann::json mergeBatchEditDrafts_(
    const nlohmann::json& baseDraft,
    const nlohmann::json& incomingDraft)
{
    nlohmann::json merged = normalizeBatchEditDraft_(baseDraft);
    const nlohmann::json incoming = normalizeBatchEditDraft_(incomingDraft);

    if (incoming.contains("camera_ids") && incoming["camera_ids"].is_array() && !incoming["camera_ids"].empty()) {
        merged["camera_ids"] = incoming["camera_ids"];
        merged.erase("candidate_camera_ids");
        merged.erase("selected_cameras");
        merged["selection_status"] = "resolved";
    }
    else if (!merged.contains("camera_ids") &&
             incoming.contains("candidate_camera_ids") &&
             incoming["candidate_camera_ids"].is_array() &&
             !incoming["candidate_camera_ids"].empty()) {
        merged["candidate_camera_ids"] = incoming["candidate_camera_ids"];
    }

    if (incoming.contains("scope_hint") && !incoming["scope_hint"].empty()) {
        merged["scope_hint"] = incoming["scope_hint"];
    }

    nlohmann::json patch = merged.value("camera_patch", nlohmann::json::object());
    const nlohmann::json incomingPatch = incoming.value("camera_patch", nlohmann::json::object());
    if (incomingPatch.is_object()) {
        for (auto it = incomingPatch.begin(); it != incomingPatch.end(); ++it) {
            patch[it.key()] = it.value();
        }
    }
    if (!patch.empty()) {
        merged["camera_patch"] = patch;
    }

    nlohmann::json fieldSources = merged.value("field_sources", nlohmann::json::object());
    const nlohmann::json incomingFieldSources = incoming.value("field_sources", nlohmann::json::object());
    if (incomingFieldSources.is_object()) {
        for (auto it = incomingFieldSources.begin(); it != incomingFieldSources.end(); ++it) {
            fieldSources[it.key()] = it.value();
        }
    }
    if (!fieldSources.empty()) {
        merged["field_sources"] = fieldSources;
    }

    nlohmann::json clearFields = merged.value("clear_fields", nlohmann::json::array());
    const nlohmann::json incomingClearFields = incoming.value("clear_fields", nlohmann::json::array());
    if (incomingClearFields.is_array()) {
        for (const auto& entry : incomingClearFields) {
            if (!entry.is_string()) {
                continue;
            }
            bool exists = false;
            for (const auto& existing : clearFields) {
                if (existing.is_string() && existing.get<std::string>() == entry.get<std::string>()) {
                    exists = true;
                    break;
                }
            }
            if (!exists) {
                clearFields.push_back(entry);
            }
        }
    }
    if (patch.is_object()) {
        nlohmann::json filtered = nlohmann::json::array();
        for (const auto& entry : clearFields) {
            if (!entry.is_string()) {
                continue;
            }
            if (patch.contains(entry.get<std::string>())) {
                continue;
            }
            filtered.push_back(entry);
        }
        clearFields = filtered;
    }
    if (!clearFields.empty()) {
        merged["clear_fields"] = clearFields;
    }
    else {
        merged.erase("clear_fields");
    }

    if (incoming.contains("selection_status") && incoming["selection_status"].is_string()) {
        merged["selection_status"] = incoming["selection_status"];
    }

    if (incoming.contains("selected_cameras") && incoming["selected_cameras"].is_array()) {
        merged["selected_cameras"] = incoming["selected_cameras"];
    }

    return merged;
}

nlohmann::json activeBatchEditDraft_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return nlohmann::json::object();
    }

    const auto& activeTask = taskState["active_task"];
    if (jsonStringField_(activeTask, "type") != "edit_cameras_batch") {
        return nlohmann::json::object();
    }

    if (!activeTask.contains("draft") || !activeTask["draft"].is_object()) {
        return nlohmann::json::object();
    }

    return normalizeBatchEditDraft_(activeTask["draft"]);
}

nlohmann::json normalizeRouterBatchEditDraft_(const SkillSelection& selection)
{
    nlohmann::json draft = nlohmann::json::object();
    if (!selection.draftPatch.is_null() && selection.draftPatch.is_object() && !selection.draftPatch.empty()) {
        draft["camera_patch"] = selection.draftPatch;
    }

    if (selection.arguments.is_object()) {
        if (selection.arguments.contains("clear_fields")) {
            draft["clear_fields"] = selection.arguments["clear_fields"];
        }
        if (selection.arguments.contains("camera_ids")) {
            draft["camera_ids"] = selection.arguments["camera_ids"];
        }
        if (selection.arguments.contains("target_scope") && selection.arguments["target_scope"].is_object()) {
            draft["scope_hint"] = selection.arguments["target_scope"];
        }
        else if (selection.arguments.contains("target_selector") && selection.arguments["target_selector"].is_object()) {
            draft["scope_hint"] = selection.arguments["target_selector"];
        }
    }

    return normalizeBatchEditDraft_(draft);
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

    nlohmann::json normalized = nlohmann::json::array();
    for (const auto& item : parsed) {
        if (!item.is_object()) {
            continue;
        }
        int id = 0;
        if (!tryJsonIntField_(item, "id", id) || id <= 0) {
            continue;
        }

        nlohmann::json camera = {
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
        };
        normalized.push_back(camera);
    }

    return nlohmann::json::object({
        { "ok", true },
        { "error", "" },
        { "cameras", normalized },
    });
}

nlohmann::json extractBatchEditDraft_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection,
    const nlohmann::json& inventory,
    const nlohmann::json& currentDraft)
{
    if (!llm.isConfigured()) {
        return nlohmann::json::object();
    }

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string replyLanguage = effectiveReplyLanguage_(selection, payload, conversationContext);

    const std::string systemPrompt =
        "/no_think\n"
        "You extract structured data for editing multiple existing cameras in the app.\n"
        "Use the latest user_message plus the active edit_cameras_batch task in conversation_task_state when present.\n"
        "Ground target selection using camera_inventory only.\n"
        "This is semantic extraction, not a keyword matcher.\n"
        "The user may mean all registered cameras, a subset, or several specific cameras.\n"
        "Only emit camera_ids that exist in camera_inventory.\n"
        "Use candidate_camera_ids only when you found plausible matches but still need clarification.\n"
        "If scope is still missing, set selection_status=\"missing_scope\".\n"
        "If the request does not match any camera in camera_inventory, set selection_status=\"not_found\".\n"
        "If the scope is grounded, set selection_status=\"resolved\".\n"
        "camera_patch contains only the new values the user wants to apply.\n"
        "Use clear_fields for intentional removals only.\n"
        "Never invent camera IDs, credentials, IPs, addresses, or settings.\n"
        "Return JSON only with this shape:\n"
        "{"
        "\"selection_status\":\"resolved\","
        "\"camera_ids\":[11,12],"
        "\"candidate_camera_ids\":[11,12,18],"
        "\"camera_patch\":{\"street\":\"Rua Nova\",\"number\":\"100\",\"password\":\"123456\"},"
        "\"field_sources\":{\"street\":\"explicit_user\",\"number\":\"explicit_user\",\"password\":\"explicit_user\"},"
        "\"clear_fields\":[\"subtype\"]"
        "}\n"
        "Valid selection_status values are: resolved, missing_scope, needs_clarification, not_found.\n"
        "Valid camera_patch fields are: name, ip_address, rtsp_port, manufacturer, username, password, channel, subtype, connection_method, description, street, number, city, state, zip_code, country, retention_days, webcam_index, allowpublicaccess, is_service_running.\n"
        "Valid clear_fields values are: ip_address, rtsp_port, manufacturer, username, password, channel, subtype, description, street, number, city, state, zip_code, country, webcam_index.\n"
        "Do not emit empty strings, nulls, placeholders, or unsupported fields.\n";

    nlohmann::json promptPayload = {
        { "reply_language", replyLanguage },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultOperationTaskState()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "router_arguments", selection.arguments.is_object() ? selection.arguments : nlohmann::json::object() },
        { "current_draft", currentDraft },
        { "camera_inventory", cameraInventoryArray_(inventory) },
        { "user_message", userMessage },
    };

    const auto outcome = llm.completeText(
        "extractEditCamerasBatchDraft",
        systemPrompt,
        promptPayload.dump(2),
        0.0,
        1400,
        18000,
        1,
        true);

    if (!outcome.ok || trimCopy_(outcome.content).empty()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(outcome.content, nullptr, false);
    return normalizeBatchEditDraft_(parsed);
}

bool hasBatchEditChanges_(
    const nlohmann::json& patch,
    const nlohmann::json& clearFields)
{
    return (patch.is_object() && !patch.empty()) ||
        (clearFields.is_array() && !clearFields.empty());
}

ChatProgressUpdate buildBatchEditProgress_(
    const std::string& language,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate progress;
    progress.skill = "edit_cameras_batch";
    progress.phase = phase;
    progress.sequence = sequence;
    progress.stepIndex = stepIndex;
    progress.stepCount = stepCount;

    if (normalizeAssistantLanguageTag(language) == "pt") {
        if (phase == "resolving_scope") {
            progress.headline = "Localizando o lote de cameras";
            progress.detail = "Conferindo quais cameras entram nessa edicao em lote.";
        }
        else {
            progress.headline = "Preparando o preview";
            progress.detail = "Validando as alteracoes e montando a revisao final antes da confirmacao.";
        }
        return progress;
    }

    if (phase == "resolving_scope") {
        progress.headline = "Resolving the camera batch";
        progress.detail = "Checking which cameras belong in this batch edit.";
    }
    else {
        progress.headline = "Preparing the preview";
        progress.detail = "Validating the requested changes and preparing the final review before confirmation.";
    }
    return progress;
}

std::string cameraReferenceLine_(
    const nlohmann::json& camera,
    std::size_t index,
    const std::string& language)
{
    const int id = camera.value("id", 0);
    const std::string name = jsonStringField_(camera, "name");
    const std::string ip = jsonStringField_(camera, "ip_address");
    const std::string manufacturer = jsonStringField_(camera, "manufacturer");
    const std::string description =
        !jsonStringField_(camera, "scene_description").empty()
            ? jsonStringField_(camera, "scene_description")
            : jsonStringField_(camera, "description");

    std::ostringstream out;
    if (language == "pt") {
        out << (index + 1) << ". " << (name.empty() ? "Camera sem nome" : name);
        if (id > 0) {
            out << " (ID " << id << ")";
        }
        if (!ip.empty()) {
            out << ", IP " << ip;
        }
        if (!manufacturer.empty()) {
            out << ", fabricante " << manufacturer;
        }
        if (!description.empty()) {
            out << ", cena " << description;
        }
        return out.str();
    }

    out << (index + 1) << ". " << (name.empty() ? "Unnamed camera" : name);
    if (id > 0) {
        out << " (ID " << id << ")";
    }
    if (!ip.empty()) {
        out << ", IP " << ip;
    }
    if (!manufacturer.empty()) {
        out << ", manufacturer " << manufacturer;
    }
    if (!description.empty()) {
        out << ", scene " << description;
    }
    return out.str();
}

std::string buildNeedScopeAnswer_(
    const std::string& language,
    const nlohmann::json& inventory)
{
    const auto& cameras = cameraInventoryArray_(inventory);
    if (language == "pt") {
        if (cameras.empty()) {
            return "Nao encontrei cameras cadastradas para editar em lote neste momento.";
        }
        return "Antes de montar a edicao em lote, preciso que voce me diga quais cameras entram nela. Voce pode responder com os nomes, IDs, IPs, uma descricao do local/cena, ou dizer que devo usar todas as cameras.";
    }

    if (cameras.empty()) {
        return "I could not find any registered cameras to edit in batch right now.";
    }
    return "Before I prepare the batch edit, I need you to tell me which cameras belong in it. You can reply with names, IDs, IPs, a scene/location description, or say that I should use all cameras.";
}

std::string buildScopeNotFoundAnswer_(const std::string& language)
{
    if (language == "pt") {
        return "Nao consegui relacionar esse escopo a cameras cadastradas agora. Me confirme os nomes, IDs, IPs ou uma descricao mais especifica do local/cena das cameras.";
    }
    return "I could not map that scope to registered cameras right now. Please confirm the camera names, IDs, IPs, or a more specific scene/location description.";
}

std::string buildAmbiguousScopeAnswer_(
    const std::string& language,
    const nlohmann::json& candidates)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Encontrei algumas cameras possiveis para essa edicao em lote, mas ainda preciso que voce confirme o escopo exato:\n";
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            out << "\n" << cameraReferenceLine_(candidates[index], index, language);
        }
        out << "\n\nMe diga se devo usar todas as cameras listadas acima ou quais delas entram no lote.";
        return out.str();
    }

    out << "I found some possible cameras for this batch edit, but I still need you to confirm the exact scope:\n";
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        out << "\n" << cameraReferenceLine_(candidates[index], index, language);
    }
    out << "\n\nTell me whether I should use all cameras above or which ones belong in the batch.";
    return out.str();
}

std::string buildNeedPatchAnswer_(
    const std::string& language,
    const nlohmann::json& selectedCameras)
{
    const int count = selectedCameras.is_array() ? static_cast<int>(selectedCameras.size()) : 0;
    if (language == "pt") {
        if (count > 0) {
            return "Encontrei " + std::to_string(count) + " camera(s) para o lote. Agora me diga o que voce quer alterar nelas.";
        }
        return "Encontrei o lote de cameras, mas ainda preciso que voce diga o que quer alterar.";
    }

    if (count > 0) {
        return "I found " + std::to_string(count) + " camera(s) for this batch. Now tell me what should be changed.";
    }
    return "I found the camera batch, but I still need you to say what should be changed.";
}

std::string buildFailureAnswer_(
    const std::string& language,
    const std::string& detail)
{
    if (language == "pt") {
        return detail.empty()
            ? "Nao consegui preparar a edicao em lote agora. Tente novamente em instantes."
            : "Nao consegui preparar a edicao em lote agora. Detalhe: " + detail;
    }
    return detail.empty()
        ? "I could not prepare the batch edit right now. Please try again in a moment."
        : "I could not prepare the batch edit right now. Detail: " + detail;
}

std::string buildBatchEditPreviewAnswer_(
    const nlohmann::json& preview,
    const std::string& language)
{
    const int matchedCount = preview.value("total_matched", 0);
    const int readyCount = preview.value("ready_count", 0);
    const int blockedCount = preview.value("blocked_count", 0);
    const int unchangedCount = preview.value("unchanged_count", 0);

    std::ostringstream out;
    if (language == "pt") {
        out << "Montei um preview para " << matchedCount << " camera(s).";
        if (readyCount > 0) {
            out << "\nProntas para atualizar agora: " << readyCount << ".";
        }
        if (blockedCount > 0) {
            out << "\nAinda precisam de ajuste: " << blockedCount
                << ". O card abaixo mostra o que precisa ser revisado antes da confirmacao.";
        }
        else if (readyCount > 0) {
            out << "\nO card abaixo ja esta pronto para confirmar a edicao em lote.";
        }
        if (readyCount == 0 && blockedCount == 0) {
            out << "\nNenhuma camera precisa de mudanca com os valores atuais.";
        }
        if (unchangedCount > 0 && readyCount == 0) {
            out << "\nSem mudanca detectada: " << unchangedCount << ".";
        }
        return out.str();
    }

    out << "I prepared a preview for " << matchedCount << " camera(s).";
    if (readyCount > 0) {
        out << "\nReady to update now: " << readyCount << ".";
    }
    if (blockedCount > 0) {
        out << "\nStill need adjustment: " << blockedCount
            << ". The card below shows what needs review before confirmation.";
    }
    else if (readyCount > 0) {
        out << "\nThe card below is ready for batch edit confirmation.";
    }
    if (readyCount == 0 && blockedCount == 0) {
        out << "\nNo camera needs to change with the current values.";
    }
    if (unchangedCount > 0 && readyCount == 0) {
        out << "\nNo-change targets: " << unchangedCount << ".";
    }
    return out.str();
}

HttpResponse previewBatchEditViaAgentEndpoint_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const nlohmann::json& cameraIds,
    const nlohmann::json& patch,
    const nlohmann::json& clearFields,
    const std::string& language)
{
    nlohmann::json requestBody = {
        { "camera_ids", cameraIds },
        { "patch", patch },
        { "clear_fields", clearFields },
        { "language", normalizeAssistantLanguageTag(language) },
    };

    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/cameras/batch-edit/preview?client_id=" + clientId;
    return postJson(
        url,
        requestBody.dump(),
        agent.getExeToken(),
        {},
        15000);
}

nlohmann::json buildBatchEditWidgetMetadata_(
    const nlohmann::json& preview,
    const nlohmann::json& patchBody,
    const std::string& language,
    const std::string& targetClientId)
{
    return {
        { "type", "camera_batch_edit_draft" },
        { "status", "awaiting_confirmation" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "preview", preview },
        { "patch_body", patchBody },
        { "target_client_id", targetClientId.empty() ? nlohmann::json(nullptr) : nlohmann::json(targetClientId) },
    };
}

std::vector<std::string> batchEditCollectedFields_(const nlohmann::json& draft)
{
    std::vector<std::string> collected;
    if (draft.contains("camera_ids") && draft["camera_ids"].is_array() && !draft["camera_ids"].empty()) {
        collected.push_back("camera_ids");
    }

    const nlohmann::json patch = draft.value("camera_patch", nlohmann::json::object());
    if (patch.is_object()) {
        for (auto it = patch.begin(); it != patch.end(); ++it) {
            collected.push_back(it.key());
        }
    }

    if (draft.contains("clear_fields") && draft["clear_fields"].is_array() && !draft["clear_fields"].empty()) {
        collected.push_back("clear_fields");
    }

    return collected;
}

std::string batchEditTaskGoal_(
    const nlohmann::json& draft,
    const std::string& language)
{
    const int count =
        draft.contains("camera_ids") && draft["camera_ids"].is_array()
            ? static_cast<int>(draft["camera_ids"].size())
            : 0;
    if (language == "pt") {
        if (count > 0) {
            return "editar " + std::to_string(count) + " cameras";
        }
        return "editar varias cameras";
    }

    if (count > 0) {
        return "edit " + std::to_string(count) + " cameras";
    }
    return "edit multiple cameras";
}

nlohmann::json buildTaskDraft_(
    const nlohmann::json& mergedDraft,
    const nlohmann::json& selectedCameras = nlohmann::json::array(),
    const nlohmann::json& candidateIds = nlohmann::json::array())
{
    nlohmann::json draft = nlohmann::json::object();
    if (mergedDraft.contains("camera_ids")) {
        draft["camera_ids"] = mergedDraft["camera_ids"];
    }
    if (mergedDraft.contains("camera_patch")) {
        draft["camera_patch"] = mergedDraft["camera_patch"];
    }
    if (mergedDraft.contains("field_sources")) {
        draft["field_sources"] = mergedDraft["field_sources"];
    }
    if (mergedDraft.contains("clear_fields")) {
        draft["clear_fields"] = mergedDraft["clear_fields"];
    }
    if (mergedDraft.contains("scope_hint")) {
        draft["scope_hint"] = mergedDraft["scope_hint"];
    }
    if (candidateIds.is_array() && !candidateIds.empty()) {
        draft["candidate_camera_ids"] = candidateIds;
    }
    if (selectedCameras.is_array() && !selectedCameras.empty()) {
        draft["selected_cameras"] = selectedCameras;
    }
    return draft;
}

nlohmann::json buildTaskStateAwaitingScope_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& candidateIds,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_cameras_batch",
            "camera",
            "update",
            "collecting_input",
            "awaiting_scope",
            normalizeAssistantLanguageTag(language),
            batchEditTaskGoal_(mergedDraft, language),
            language == "pt" ? "Aguardando o escopo do lote" : "Waiting for the batch scope",
            trimCopy_(answer),
            { "camera_ids" },
            batchEditCollectedFields_(mergedDraft),
            buildTaskDraft_(mergedDraft, nlohmann::json::array(), candidateIds),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object(),
        });
}

nlohmann::json buildTaskStateAwaitingPatch_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& selectedCameras,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_cameras_batch",
            "camera",
            "update",
            "collecting_input",
            "awaiting_patch_details",
            normalizeAssistantLanguageTag(language),
            batchEditTaskGoal_(mergedDraft, language),
            language == "pt" ? "Aguardando os campos da edicao em lote" : "Waiting for batch edit details",
            trimCopy_(answer),
            { "camera_patch" },
            batchEditCollectedFields_(mergedDraft),
            buildTaskDraft_(mergedDraft, selectedCameras),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object(),
        });
}

nlohmann::json buildTaskStateAwaitingBatchFixes_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& selectedCameras,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_cameras_batch",
            "camera",
            "update",
            "collecting_input",
            "awaiting_missing_fields",
            normalizeAssistantLanguageTag(language),
            batchEditTaskGoal_(mergedDraft, language),
            language == "pt" ? "Preview do lote precisa de ajuste" : "Batch preview needs review",
            trimCopy_(answer),
            {},
            batchEditCollectedFields_(mergedDraft),
            buildTaskDraft_(mergedDraft, selectedCameras),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object({
                { "type", "camera_batch_edit_draft" },
                { "status", "awaiting_confirmation" },
                { "editable", false },
            }),
        });
}

nlohmann::json buildTaskStateAwaitingConfirmation_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& selectedCameras,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_cameras_batch",
            "camera",
            "update",
            "awaiting_confirmation",
            "awaiting_user_confirmation",
            normalizeAssistantLanguageTag(language),
            batchEditTaskGoal_(mergedDraft, language),
            language == "pt" ? "Preview do lote pronto para confirmacao" : "Batch preview ready for confirmation",
            trimCopy_(answer),
            {},
            batchEditCollectedFields_(mergedDraft),
            buildTaskDraft_(mergedDraft, selectedCameras),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object({
                { "type", "camera_batch_edit_draft" },
                { "status", "awaiting_confirmation" },
                { "editable", false },
            }),
        });
}

} // namespace

SkillDefinition EditCamerasBatchSkill::definition() const
{
    return {
        "edit_cameras_batch",
        "Prepares a batch edit preview for multiple existing cameras and lets chat confirm the whole update at once.",
        true,
    };
}

SkillRunResult EditCamerasBatchSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "edit_cameras_batch";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string language = effectiveReplyLanguage_(selection, payload, conversationContext);

    nlohmann::json mergedDraft = mergeBatchEditDrafts_(
        activeBatchEditDraft_(conversationContext),
        normalizeRouterBatchEditDraft_(selection));

    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);

    postChatProgress(
        agent,
        payload,
        buildBatchEditProgress_(language, "resolving_scope", 2, 2, 3),
        2500);

    const nlohmann::json inventory = fetchCameraInventory_(agent, payload);
    if (!inventory.value("ok", false)) {
        result.answer = buildFailureAnswer_(language, jsonStringField_(inventory, "error"));
        result.metadata["task_state"] = buildTaskStateAwaitingScope_(
            conversationContext,
            mergedDraft,
            nlohmann::json::array(),
            result.answer,
            language);
        return result;
    }

    if ((!mergedDraft.contains("camera_ids") || mergedDraft["camera_ids"].empty()) &&
        mergedDraft.contains("scope_hint")) {
        mergedDraft = mergeBatchEditDrafts_(
            mergedDraft,
            adoptStructuredScopeHint_(mergedDraft["scope_hint"], inventory));
    }

    const nlohmann::json extractedDraft =
        extractBatchEditDraft_(llm, payload, conversationContext, selection, inventory, mergedDraft);
    mergedDraft = mergeBatchEditDrafts_(mergedDraft, extractedDraft);

    const nlohmann::json validCameraIds =
        revalidateCameraIdsForInventory_(mergedDraft.value("camera_ids", nlohmann::json::array()), inventory);
    if (!validCameraIds.empty()) {
        mergedDraft["camera_ids"] = validCameraIds;
        mergedDraft["selection_status"] = "resolved";
    }
    else {
        mergedDraft.erase("camera_ids");
    }

    const nlohmann::json candidateIds = revalidateCameraIdsForInventory_(
        mergedDraft.value("candidate_camera_ids", nlohmann::json::array()),
        inventory);
    if (!candidateIds.empty()) {
        mergedDraft["candidate_camera_ids"] = candidateIds;
    }
    else {
        mergedDraft.erase("candidate_camera_ids");
    }

    const nlohmann::json selectedCameras =
        selectedCamerasFromIds_(inventory, mergedDraft.value("camera_ids", nlohmann::json::array()));
    if (!selectedCameras.empty()) {
        mergedDraft["selected_cameras"] = selectedCameras;
    }
    else {
        mergedDraft.erase("selected_cameras");
    }

    const std::string selectionStatus = jsonStringField_(mergedDraft, "selection_status");
    if (!mergedDraft.contains("camera_ids") || !mergedDraft["camera_ids"].is_array() || mergedDraft["camera_ids"].empty()) {
        if (!candidateIds.empty()) {
            const nlohmann::json candidateCameras = selectedCamerasFromIds_(inventory, candidateIds);
            result.answer = buildAmbiguousScopeAnswer_(language, candidateCameras);
            result.metadata["task_state"] = buildTaskStateAwaitingScope_(
                conversationContext,
                mergedDraft,
                candidateIds,
                result.answer,
                language);
            return result;
        }

        result.answer =
            selectionStatus == "not_found"
                ? buildScopeNotFoundAnswer_(language)
                : buildNeedScopeAnswer_(language, inventory);
        result.metadata["task_state"] = buildTaskStateAwaitingScope_(
            conversationContext,
            mergedDraft,
            nlohmann::json::array(),
            result.answer,
            language);
        return result;
    }

    const nlohmann::json patch = mergedDraft.value("camera_patch", nlohmann::json::object());
    const nlohmann::json clearFields = mergedDraft.value("clear_fields", nlohmann::json::array());
    if (!hasBatchEditChanges_(patch, clearFields)) {
        result.answer = buildNeedPatchAnswer_(language, selectedCameras);
        result.metadata["task_state"] = buildTaskStateAwaitingPatch_(
            conversationContext,
            mergedDraft,
            selectedCameras,
            result.answer,
            language);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        buildBatchEditProgress_(language, "finalizing", 3, 3, 3),
        2500);

    const HttpResponse previewResponse = previewBatchEditViaAgentEndpoint_(
        agent,
        payload,
        mergedDraft["camera_ids"],
        patch,
        clearFields,
        language);
    if (!previewResponse.ok()) {
        result.answer = buildFailureAnswer_(language, parseErrorMessage_(previewResponse));
        result.metadata["task_state"] = buildTaskStateAwaitingPatch_(
            conversationContext,
            mergedDraft,
            selectedCameras,
            result.answer,
            language);
        return result;
    }

    const nlohmann::json parsedPreview = nlohmann::json::parse(previewResponse.body, nullptr, false);
    if (!parsedPreview.is_object() ||
        !parsedPreview.contains("preview") ||
        !parsedPreview["preview"].is_object() ||
        !parsedPreview.contains("patch_body") ||
        !parsedPreview["patch_body"].is_object()) {
        result.answer = language == "pt"
            ? "Consegui identificar o lote, mas o preview voltou em um formato invalido."
            : "I identified the batch, but the preview came back in an invalid format.";
        result.metadata["task_state"] = buildTaskStateAwaitingPatch_(
            conversationContext,
            mergedDraft,
            selectedCameras,
            result.answer,
            language);
        return result;
    }

    const nlohmann::json preview = parsedPreview["preview"];
    const nlohmann::json patchBody = parsedPreview["patch_body"];
    mergedDraft["camera_patch"] = patchBody;

    result.answer = buildBatchEditPreviewAnswer_(preview, language);
    const std::string targetClientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    result.metadata["message_metadata"] = buildBatchEditWidgetMetadata_(
        preview,
        patchBody,
        language,
        targetClientId);

    const int blockedCount = preview.value("blocked_count", 0);
    const int readyCount = preview.value("ready_count", 0);
    if (blockedCount > 0 || readyCount <= 0) {
        result.metadata["task_state"] = buildTaskStateAwaitingBatchFixes_(
            conversationContext,
            mergedDraft,
            selectedCameras,
            result.answer,
            language);
        return result;
    }

    result.metadata["task_state"] = buildTaskStateAwaitingConfirmation_(
        conversationContext,
        mergedDraft,
        selectedCameras,
        result.answer,
        language);
    return result;
}

} // namespace chatv2

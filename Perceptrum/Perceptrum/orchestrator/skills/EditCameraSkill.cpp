#include "EditCameraSkill.h"

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

std::string jsonStringField_(
    const nlohmann::json& value,
    const char* key);

bool tryJsonIntField_(
    const nlohmann::json& value,
    const char* key,
    int& outValue);

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

std::string normalizedSceneLabelKey_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    for (char& ch : value) {
        if (ch == ' ' || ch == '-') {
            ch = '_';
        }
    }
    return value;
}

std::string cameraSceneLabel_(const nlohmann::json& camera)
{
    const std::string explicitLabel = jsonStringField_(camera, "scene_label");
    if (!explicitLabel.empty()) {
        return explicitLabel;
    }
    return structuredDescriptionLabel_(jsonStringField_(camera, "description"));
}

std::string cameraSceneDescription_(const nlohmann::json& camera)
{
    const std::string explicitDescription = jsonStringField_(camera, "scene_description");
    if (!explicitDescription.empty()) {
        return explicitDescription;
    }

    const std::string body = structuredDescriptionBody_(jsonStringField_(camera, "description"));
    if (!body.empty()) {
        return body;
    }
    return jsonStringField_(camera, "description");
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

std::string sceneAliasTextForLabel_(const std::string& rawLabel)
{
    const std::string label = normalizedSceneLabelKey_(rawLabel);
    if (label.empty()) {
        return "";
    }

    if (label == "office_room") return "office room escritorio escritorio sala ambiente interno indoor interior interno";
    if (label == "reception") return "reception recepcao recepcao lobby entrada ambiente interno indoor interior interno";
    if (label == "other_indoor") return "other indoor ambiente interno indoor interior interno sala interna";
    if (label == "living_room") return "living room sala estar ambiente interno indoor interior interno";
    if (label == "bedroom") return "bedroom quarto ambiente interno indoor interior interno";
    if (label == "childrens_room") return "childrens room quarto infantil ambiente interno indoor interior interno";
    if (label == "kitchen") return "kitchen cozinha ambiente interno indoor interior interno";
    if (label == "corridor") return "corridor corredor ambiente interno indoor interior interno";
    if (label == "elevator") return "elevator elevador ambiente interno indoor interior interno";
    if (label == "classroom") return "classroom sala aula ambiente interno indoor interior interno";
    if (label == "store") return "store loja ambiente interno indoor interior interno";
    if (label == "supermarket") return "supermarket mercado ambiente interno indoor interior interno";
    if (label == "warehouse") return "warehouse deposito galpao ambiente interno indoor interior interno";
    if (label == "staircase") return "staircase escada ambiente interno indoor interior interno";
    if (label == "lobby") return "lobby saguão saguao hall ambiente interno indoor interior interno";
    if (label == "restaurant") return "restaurant restaurante ambiente interno indoor interior interno";
    if (label == "bar") return "bar ambiente interno indoor interior interno";
    if (label == "cafe") return "cafe cafeteria ambiente interno indoor interior interno";
    if (label == "gym") return "gym academia ambiente interno indoor interior interno";

    if (label == "street") return "street rua ambiente externo outdoor exterior externo";
    if (label == "intersection") return "intersection cruzamento ambiente externo outdoor exterior externo";
    if (label == "park") return "park parque ambiente externo outdoor exterior externo";
    if (label == "yard") return "yard quintal ambiente externo outdoor exterior externo";
    if (label == "frontyard") return "frontyard quintal frente jardim frente ambiente externo outdoor exterior externo";
    if (label == "backyard") return "backyard quintal fundos ambiente externo outdoor exterior externo";
    if (label == "parking_lot") return "parking lot estacionamento ambiente externo outdoor exterior externo";
    if (label == "other_outdoor") return "other outdoor ambiente externo outdoor exterior externo";
    if (label == "front_door") return "front door porta frente entrada ambiente externo outdoor exterior externo";
    if (label == "back_door") return "back door porta fundos saida ambiente externo outdoor exterior externo";
    if (label == "garage") return "garage garagem entrada veiculo";

    return "";
}

std::string sceneSearchText_(const nlohmann::json& camera)
{
    const std::string sceneLabel = cameraSceneLabel_(camera);
    const std::string sceneDescription = cameraSceneDescription_(camera);

    std::string combined;
    if (!sceneLabel.empty()) {
        combined += sceneLabel;

        const std::string humanized = humanizeSceneLabel_(sceneLabel);
        combined += " " + humanized;

        const std::string aliases = sceneAliasTextForLabel_(sceneLabel);
        if (!aliases.empty()) {
            combined += " " + aliases;
        }
    }

    if (!sceneDescription.empty()) {
        if (!combined.empty()) {
            combined += " ";
        }
        combined += sceneDescription;
    }

    if (combined.empty()) {
        combined = jsonStringField_(camera, "description");
    }

    return normalizeInlineWhitespace_(combined);
}

const std::vector<std::string>& semanticStopwords_()
{
    static const std::vector<std::string> stopwords = {
        "a", "an", "as", "at", "ambiente", "area", "cam", "camera", "cameras", "com", "da",
        "das", "de", "del", "description", "do", "dos", "e", "el", "em", "environment",
        "filma", "film", "filming", "in", "la", "label", "le", "les", "local", "location",
        "my", "na", "no", "o", "of", "on", "para", "parece", "por", "que", "scene", "space",
        "the", "to", "uma", "um", "view",
    };
    return stopwords;
}

std::vector<std::string> semanticTokens_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    std::vector<std::string> tokens;
    std::string current;

    const auto flushCurrent = [&]() {
        if (current.empty()) {
            return;
        }
        if (current.size() <= 1) {
            current.clear();
            return;
        }
        const auto& stopwords = semanticStopwords_();
        if (std::find(stopwords.begin(), stopwords.end(), current) != stopwords.end()) {
            current.clear();
            return;
        }
        if (std::find(tokens.begin(), tokens.end(), current) == tokens.end()) {
            tokens.push_back(current);
        }
        current.clear();
    };

    for (unsigned char ch : value) {
        if (std::isalnum(ch) != 0) {
            current.push_back(static_cast<char>(ch));
            continue;
        }
        flushCurrent();
    }
    flushCurrent();

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

void appendUniqueCameraCandidate_(
    nlohmann::json& list,
    const nlohmann::json& camera)
{
    if (!list.is_array() || !camera.is_object()) {
        return;
    }

    int candidateId = 0;
    if (!tryJsonIntField_(camera, "id", candidateId) || candidateId <= 0) {
        return;
    }

    for (const auto& existing : list) {
        int existingId = 0;
        if (tryJsonIntField_(existing, "id", existingId) && existingId == candidateId) {
            return;
        }
    }

    list.push_back(camera);
}

nlohmann::json mergeUniqueCameraCandidates_(
    const nlohmann::json& first,
    const nlohmann::json& second)
{
    nlohmann::json merged = nlohmann::json::array();
    if (first.is_array()) {
        for (const auto& camera : first) {
            appendUniqueCameraCandidate_(merged, camera);
        }
    }
    if (second.is_array()) {
        for (const auto& camera : second) {
            appendUniqueCameraCandidate_(merged, camera);
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

std::string cameraDescriptionPreview_(const nlohmann::json& camera)
{
    const std::string label = cameraSceneLabel_(camera);
    if (!label.empty()) {
        return shortenForDisplay_(humanizeSceneLabel_(label), 60);
    }

    const std::string body = cameraSceneDescription_(camera);
    if (!body.empty()) {
        return shortenForDisplay_(body, 80);
    }

    const std::string rawDescription = jsonStringField_(camera, "description");
    if (rawDescription.empty()) {
        return "";
    }

    return shortenForDisplay_(rawDescription, 80);
}

std::string normalizedDescriptionLabel_(const nlohmann::json& camera)
{
    return compactToken_(cameraSceneLabel_(camera));
}

std::string normalizedDescriptionText_(const nlohmann::json& camera)
{
    return compactToken_(sceneSearchText_(camera));
}

std::vector<std::string> descriptionSemanticTokens_(const nlohmann::json& camera)
{
    const std::string searchable = sceneSearchText_(camera);
    if (searchable.empty()) {
        return {};
    }
    return semanticTokens_(searchable);
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

bool parseBoolLoose_(const nlohmann::json& value, bool& outValue)
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

const std::vector<std::string>& editableCameraFieldNames_()
{
    static const std::vector<std::string> fields = {
        "name",
        "ip_address",
        "rtsp_port",
        "manufacturer",
        "username",
        "password",
        "channel",
        "subtype",
        "connection_method",
        "description",
        "street",
        "number",
        "city",
        "state",
        "zip_code",
        "country",
        "retention_days",
        "webcam_index",
        "allowpublicaccess",
    };
    return fields;
}

const std::vector<std::string>& clearableCameraFieldNames_()
{
    static const std::vector<std::string> fields = {
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

bool isEditableCameraField_(const std::string& field)
{
    const auto& fields = editableCameraFieldNames_();
    return std::find(fields.begin(), fields.end(), field) != fields.end();
}

bool isClearableCameraField_(const std::string& field)
{
    const auto& fields = clearableCameraFieldNames_();
    return std::find(fields.begin(), fields.end(), field) != fields.end();
}

std::string normalizeFieldSource_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    if (value == "explicit_user" ||
        value == "implied_user" ||
        value == "address_lookup") {
        return value;
    }
    return "";
}

nlohmann::json normalizeFieldSources_(const nlohmann::json& fieldSources)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!fieldSources.is_object()) {
        return normalized;
    }

    for (auto it = fieldSources.begin(); it != fieldSources.end(); ++it) {
        if (!it.value().is_string() || !isEditableCameraField_(it.key())) {
            continue;
        }
        const std::string source = normalizeFieldSource_(it.value().get<std::string>());
        if (!source.empty()) {
            normalized[it.key()] = source;
        }
    }
    return normalized;
}

std::string fieldSource_(
    const nlohmann::json& fieldSources,
    const std::string& field)
{
    if (!fieldSources.is_object() ||
        !fieldSources.contains(field) ||
        !fieldSources[field].is_string()) {
        return "";
    }
    return normalizeFieldSource_(fieldSources[field].get<std::string>());
}

void setFieldSource_(
    nlohmann::json& fieldSources,
    const std::string& field,
    const std::string& source)
{
    const std::string normalizedSource = normalizeFieldSource_(source);
    if (!isEditableCameraField_(field) || normalizedSource.empty()) {
        return;
    }
    if (!fieldSources.is_object()) {
        fieldSources = nlohmann::json::object();
    }
    fieldSources[field] = normalizedSource;
}

void eraseFieldSource_(
    nlohmann::json& fieldSources,
    const std::string& field)
{
    if (fieldSources.is_object()) {
        fieldSources.erase(field);
    }
}

std::string normalizeConnectionMethod_(std::string method)
{
    method = upperAsciiCopy_(trimCopy_(std::move(method)));
    if (method == "WEBCAM" || method == "HTTP" || method == "ONVIF" || method == "RTSP") {
        return method;
    }
    return "";
}

bool isValidRetentionDays_(int value)
{
    switch (value) {
        case 1:
        case 3:
        case 7:
        case 15:
        case 30:
        case 90:
        case 180:
            return true;
        default:
            return false;
    }
}

nlohmann::json normalizeCameraPatch_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::vector<const char*> stringFields = {
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
    for (const auto* field : stringFields) {
        const std::string text = jsonStringField_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    const std::string connectionMethod = normalizeConnectionMethod_(jsonStringField_(value, "connection_method"));
    if (!connectionMethod.empty()) {
        normalized["connection_method"] = connectionMethod;
    }

    int retentionDays = 0;
    if (tryJsonIntField_(value, "retention_days", retentionDays) && isValidRetentionDays_(retentionDays)) {
        normalized["retention_days"] = retentionDays;
    }

    if (value.contains("webcam_index")) {
        if (value["webcam_index"].is_null()) {
            normalized["webcam_index"] = nullptr;
        }
        else {
            int webcamIndex = 0;
            if (tryJsonIntField_(value, "webcam_index", webcamIndex) && webcamIndex >= 0) {
                normalized["webcam_index"] = webcamIndex;
            }
        }
    }

    bool allowPublicAccess = false;
    if (value.contains("allowpublicaccess") &&
        parseBoolLoose_(value["allowpublicaccess"], allowPublicAccess)) {
        normalized["allowpublicaccess"] = allowPublicAccess;
    }

    return normalized;
}

nlohmann::json normalizeTargetSelector_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::object();
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
        "scene_label",
        "scene_description",
        "ip_address",
        "manufacturer",
        "channel",
        "subtype",
    };
    for (const auto* field : stringFields) {
        const std::string text = jsonStringField_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    const std::string connectionMethod = normalizeConnectionMethod_(jsonStringField_(value, "connection_method"));
    if (!connectionMethod.empty()) {
        normalized["connection_method"] = connectionMethod;
    }

    return normalized;
}

nlohmann::json normalizeClearFields_(const nlohmann::json& value)
{
    nlohmann::json normalized = nlohmann::json::array();
    if (!value.is_array()) {
        return normalized;
    }

    for (const auto& entry : value) {
        if (!entry.is_string()) {
            continue;
        }
        const std::string field = trimCopy_(entry.get<std::string>());
        if (!isClearableCameraField_(field)) {
            continue;
        }
        if (std::find(normalized.begin(), normalized.end(), field) == normalized.end()) {
            normalized.push_back(field);
        }
    }
    return normalized;
}

bool hasPatchChanges_(const nlohmann::json& patch, const nlohmann::json& clearFields)
{
    return (patch.is_object() && !patch.empty()) || (clearFields.is_array() && !clearFields.empty());
}

bool hasTargetSelector_(const nlohmann::json& selector)
{
    return selector.is_object() && !selector.empty();
}

bool parseOpenFormField_(const nlohmann::json& value, bool& outValue)
{
    return parseBoolLoose_(value, outValue);
}

nlohmann::json normalizeEditExtractionResult_(const nlohmann::json& extracted)
{
    nlohmann::json normalized = nlohmann::json::object();
    if (!extracted.is_object()) {
        return normalized;
    }

    const nlohmann::json targetSelector =
        normalizeTargetSelector_(extracted.value("target_selector", nlohmann::json::object()));
    if (!targetSelector.empty()) {
        normalized["target_selector"] = targetSelector;
    }

    nlohmann::json cameraPatch = normalizeCameraPatch_(
        extracted.contains("camera_patch")
            ? extracted["camera_patch"]
            : extracted.value("draft_patch", nlohmann::json::object()));
    nlohmann::json fieldSources =
        normalizeFieldSources_(extracted.value("field_sources", nlohmann::json::object()));
    for (auto it = fieldSources.begin(); it != fieldSources.end();) {
        if (!cameraPatch.contains(it.key())) {
            it = fieldSources.erase(it);
            continue;
        }
        ++it;
    }
    for (auto it = cameraPatch.begin(); it != cameraPatch.end(); ++it) {
        if (fieldSource_(fieldSources, it.key()).empty()) {
            setFieldSource_(fieldSources, it.key(), "implied_user");
        }
    }
    if (!cameraPatch.empty()) {
        normalized["camera_patch"] = cameraPatch;
    }
    if (!fieldSources.empty()) {
        normalized["field_sources"] = fieldSources;
    }

    const nlohmann::json clearFields =
        normalizeClearFields_(extracted.value("clear_fields", nlohmann::json::array()));
    if (!clearFields.empty()) {
        normalized["clear_fields"] = clearFields;
    }

    if (extracted.contains("open_form")) {
        bool openForm = false;
        if (parseOpenFormField_(extracted["open_form"], openForm)) {
            normalized["open_form"] = openForm;
        }
    }

    return normalized;
}

nlohmann::json normalizeRouterEditDraft_(const SkillSelection& selection)
{
    nlohmann::json raw = nlohmann::json::object();
    if (selection.arguments.is_object()) {
        raw = selection.arguments;
    }

    nlohmann::json normalized = nlohmann::json::object();

    if (raw.contains("target_selector")) {
        const nlohmann::json targetSelector = normalizeTargetSelector_(raw["target_selector"]);
        if (!targetSelector.empty()) {
            normalized["target_selector"] = targetSelector;
        }
    }

    nlohmann::json patchSource = nlohmann::json::object();
    if (raw.contains("draft_patch")) {
        patchSource = raw["draft_patch"];
    }
    else if (selection.draftPatch.is_object()) {
        patchSource = selection.draftPatch;
    }
    const nlohmann::json cameraPatch = normalizeCameraPatch_(patchSource);
    if (!cameraPatch.empty()) {
        normalized["camera_patch"] = cameraPatch;
        nlohmann::json fieldSources = nlohmann::json::object();
        for (auto it = cameraPatch.begin(); it != cameraPatch.end(); ++it) {
            setFieldSource_(fieldSources, it.key(), "implied_user");
        }
        if (!fieldSources.empty()) {
            normalized["field_sources"] = fieldSources;
        }
    }

    if (raw.contains("clear_fields")) {
        const nlohmann::json clearFields = normalizeClearFields_(raw["clear_fields"]);
        if (!clearFields.empty()) {
            normalized["clear_fields"] = clearFields;
        }
    }

    if (raw.contains("open_form")) {
        bool openForm = false;
        if (parseOpenFormField_(raw["open_form"], openForm)) {
            normalized["open_form"] = openForm;
        }
    }

    return normalized;
}

nlohmann::json activeEditDraft_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return nlohmann::json::object();
    }

    const auto& activeTask = taskState["active_task"];
    if (jsonStringField_(activeTask, "type") != "edit_camera" ||
        !activeTask.contains("draft") ||
        !activeTask["draft"].is_object()) {
        return nlohmann::json::object();
    }

    const auto& draft = activeTask["draft"];
    nlohmann::json normalized = nlohmann::json::object();

    if (draft.contains("target_selector")) {
        const nlohmann::json targetSelector = normalizeTargetSelector_(draft["target_selector"]);
        if (!targetSelector.empty()) {
            normalized["target_selector"] = targetSelector;
        }
    }

    if (draft.contains("camera_patch")) {
        const nlohmann::json patch = normalizeCameraPatch_(draft["camera_patch"]);
        if (!patch.empty()) {
            normalized["camera_patch"] = patch;
        }
    }

    if (draft.contains("field_sources")) {
        const nlohmann::json fieldSources = normalizeFieldSources_(draft["field_sources"]);
        if (!fieldSources.empty()) {
            normalized["field_sources"] = fieldSources;
        }
    }

    if (draft.contains("clear_fields")) {
        const nlohmann::json clearFields = normalizeClearFields_(draft["clear_fields"]);
        if (!clearFields.empty()) {
            normalized["clear_fields"] = clearFields;
        }
    }

    if (draft.contains("resolved_camera") && draft["resolved_camera"].is_object()) {
        normalized["resolved_camera"] = draft["resolved_camera"];
    }

    if (draft.contains("candidate_cameras") && draft["candidate_cameras"].is_array()) {
        normalized["candidate_cameras"] = draft["candidate_cameras"];
    }

    if (draft.contains("open_form")) {
        bool openForm = false;
        if (parseOpenFormField_(draft["open_form"], openForm)) {
            normalized["open_form"] = openForm;
        }
    }

    return normalized;
}

void removeClearedFieldsFromPatch_(
    nlohmann::json& patch,
    nlohmann::json& fieldSources,
    const nlohmann::json& clearFields)
{
    if (!patch.is_object() || !clearFields.is_array()) {
        return;
    }

    for (const auto& entry : clearFields) {
        if (!entry.is_string()) {
            continue;
        }
        const std::string field = entry.get<std::string>();
        patch.erase(field);
        eraseFieldSource_(fieldSources, field);
    }
}

nlohmann::json mergeEditDrafts_(
    const nlohmann::json& baseDraft,
    const nlohmann::json& incomingDraft)
{
    nlohmann::json merged = nlohmann::json::object();

    nlohmann::json targetSelector =
        normalizeTargetSelector_(baseDraft.value("target_selector", nlohmann::json::object()));
    const nlohmann::json incomingTargetSelector =
        normalizeTargetSelector_(incomingDraft.value("target_selector", nlohmann::json::object()));
    const bool incomingHasTargetSelector = hasTargetSelector_(incomingTargetSelector);
    if (incomingHasTargetSelector) {
        for (auto it = incomingTargetSelector.begin(); it != incomingTargetSelector.end(); ++it) {
            targetSelector[it.key()] = it.value();
        }
    }
    if (!targetSelector.empty()) {
        merged["target_selector"] = targetSelector;
    }

    nlohmann::json patch = normalizeCameraPatch_(baseDraft.value("camera_patch", nlohmann::json::object()));
    nlohmann::json fieldSources =
        normalizeFieldSources_(baseDraft.value("field_sources", nlohmann::json::object()));
    const nlohmann::json incomingPatch =
        normalizeCameraPatch_(incomingDraft.value("camera_patch", nlohmann::json::object()));
    const nlohmann::json incomingFieldSources =
        normalizeFieldSources_(incomingDraft.value("field_sources", nlohmann::json::object()));
    for (auto it = incomingPatch.begin(); it != incomingPatch.end(); ++it) {
        patch[it.key()] = it.value();
        const std::string source = fieldSource_(incomingFieldSources, it.key());
        setFieldSource_(fieldSources, it.key(), source.empty() ? "implied_user" : source);
    }

    nlohmann::json clearFields =
        normalizeClearFields_(baseDraft.value("clear_fields", nlohmann::json::array()));
    const nlohmann::json incomingClearFields =
        normalizeClearFields_(incomingDraft.value("clear_fields", nlohmann::json::array()));
    for (const auto& entry : incomingClearFields) {
        if (std::find(clearFields.begin(), clearFields.end(), entry) == clearFields.end()) {
            clearFields.push_back(entry);
        }
    }

    removeClearedFieldsFromPatch_(patch, fieldSources, clearFields);

    if (!patch.empty()) {
        merged["camera_patch"] = patch;
    }
    if (!fieldSources.empty()) {
        merged["field_sources"] = fieldSources;
    }
    if (!clearFields.empty()) {
        merged["clear_fields"] = clearFields;
    }

    if (incomingDraft.contains("open_form")) {
        bool openForm = false;
        if (parseOpenFormField_(incomingDraft["open_form"], openForm)) {
            merged["open_form"] = openForm;
        }
    }
    else if (baseDraft.contains("open_form")) {
        bool openForm = false;
        if (parseOpenFormField_(baseDraft["open_form"], openForm)) {
            merged["open_form"] = openForm;
        }
    }

    if (incomingHasTargetSelector) {
        if (incomingDraft.contains("resolved_camera") && incomingDraft["resolved_camera"].is_object()) {
            merged["resolved_camera"] = incomingDraft["resolved_camera"];
        }
        if (incomingDraft.contains("candidate_cameras") && incomingDraft["candidate_cameras"].is_array()) {
            merged["candidate_cameras"] = incomingDraft["candidate_cameras"];
        }
    }
    else {
        if (incomingDraft.contains("resolved_camera") && incomingDraft["resolved_camera"].is_object()) {
            merged["resolved_camera"] = incomingDraft["resolved_camera"];
        }
        else if (baseDraft.contains("resolved_camera") && baseDraft["resolved_camera"].is_object()) {
            merged["resolved_camera"] = baseDraft["resolved_camera"];
        }

        if (incomingDraft.contains("candidate_cameras") && incomingDraft["candidate_cameras"].is_array()) {
            merged["candidate_cameras"] = incomingDraft["candidate_cameras"];
        }
        else if (baseDraft.contains("candidate_cameras") && baseDraft["candidate_cameras"].is_array()) {
            merged["candidate_cameras"] = baseDraft["candidate_cameras"];
        }
    }

    return merged;
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

nlohmann::json extractEditDraft_(
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
        "You extract structured data for editing an existing camera in the app.\n"
        "Use the latest user_message plus the active edit_camera task in conversation_task_state when present.\n"
        "This is a semantic extraction task, not a delimiter-only parser.\n"
        "Understand natural phrasing like edit, update, change, rename, fix, remove, clear, open the form, or review in the form.\n"
        "Never invent a camera target, new value, current value, credential, IP, address, or setting that the user did not provide.\n"
        "target_selector identifies WHICH EXISTING camera the user means right now.\n"
        "camera_patch contains only the NEW values the user wants to apply.\n"
        "If the user says 'change the IP of camera mibo to 192.168.0.22', then target_selector.name='mibo' and camera_patch.ip_address='192.168.0.22'.\n"
        "Do not put the new value inside target_selector unless the user explicitly uses the current value to identify the existing camera.\n"
        "If the user identifies the camera by what it sees, by the location, or by scene cues like pool, garage, front gate, reception, backyard, or sidewalk, prefer target_selector.description for that clue.\n"
        "Use clear_fields for intentional removals like remove channel, clear subtype, clear description, or blank the street.\n"
        "Set open_form=true only when the user explicitly asks to open, review, inspect, or edit through the form/modal instead of applying directly.\n"
        "If the user says pronouns like 'ela', 'essa camera', or 'a mesma', only rely on the active edit_camera task when it already has a resolved target.\n"
        "Return JSON only with this shape:\n"
        "{"
        "\"target_selector\":{\"id\":123,\"name\":\"mibo\",\"description\":\"pool area\",\"ip_address\":\"192.168.0.21\",\"manufacturer\":\"Intelbras\",\"channel\":\"1\",\"subtype\":\"0\",\"connection_method\":\"RTSP\"},"
        "\"camera_patch\":{\"ip_address\":\"192.168.0.22\",\"password\":\"nova_senha\",\"description\":\"Recepcao\"},"
        "\"field_sources\":{\"ip_address\":\"explicit_user\",\"password\":\"explicit_user\"},"
        "\"clear_fields\":[\"subtype\"],"
        "\"open_form\":false"
        "}\n"
        "Valid target_selector fields are: id, name, description, ip_address, manufacturer, channel, subtype, connection_method.\n"
        "Valid camera_patch fields are: name, ip_address, rtsp_port, manufacturer, username, password, channel, subtype, connection_method, description, street, number, city, state, zip_code, country, retention_days, webcam_index, allowpublicaccess.\n"
        "Valid field_sources values are explicit_user or implied_user.\n"
        "Valid clear_fields values are: ip_address, rtsp_port, manufacturer, username, password, channel, subtype, description, street, number, city, state, zip_code, country, webcam_index.\n"
        "Do not emit empty strings, placeholder values, unknown fields, or nulls except webcam_index when the user clearly wants to clear it.\n"
        "Examples:\n"
        "user_message='edite o ip da camera mibo para 192.168.0.22' => "
        "{\"target_selector\":{\"name\":\"mibo\"},\"camera_patch\":{\"ip_address\":\"192.168.0.22\"},\"field_sources\":{\"ip_address\":\"explicit_user\"},\"clear_fields\":[],\"open_form\":false}\n"
        "user_message='mude a senha da camera do portao para 123456' => "
        "{\"target_selector\":{\"name\":\"portao\"},\"camera_patch\":{\"password\":\"123456\"},\"field_sources\":{\"password\":\"explicit_user\"},\"clear_fields\":[],\"open_form\":false}\n"
        "user_message='remove o subtype da camera mibo' => "
        "{\"target_selector\":{\"name\":\"mibo\"},\"camera_patch\":{},\"field_sources\":{},\"clear_fields\":[\"subtype\"],\"open_form\":false}\n"
        "user_message='abre o formulario da camera mibo para eu revisar' => "
        "{\"target_selector\":{\"name\":\"mibo\"},\"camera_patch\":{},\"field_sources\":{},\"clear_fields\":[],\"open_form\":true}\n"
        "user_message='edite a camera da piscina e mude o nome para Piscina Principal' => "
        "{\"target_selector\":{\"description\":\"piscina\"},\"camera_patch\":{\"name\":\"Piscina Principal\"},\"field_sources\":{\"name\":\"explicit_user\"},\"clear_fields\":[],\"open_form\":false}\n";

    nlohmann::json promptPayload = {
        { "reply_language", replyLanguage },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultOperationTaskState()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "user_message", userMessage },
    };

    const auto outcome = llm.completeText(
        "extractEditCameraDraft",
        systemPrompt,
        promptPayload.dump(2),
        0.0,
        1000,
        18000,
        1,
        true);

    if (!outcome.ok || trimCopy_(outcome.content).empty()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(outcome.content, nullptr, false);
    return normalizeEditExtractionResult_(parsed);
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

ChatProgressUpdate buildEditProgress_(
    const std::string& language,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate progress;
    progress.skill = "edit_camera";
    progress.phase = phase;
    progress.sequence = sequence;
    progress.stepIndex = stepIndex;
    progress.stepCount = stepCount;

    if (normalizeAssistantLanguageTag(language) == "pt") {
        if (phase == "resolving_target") {
            progress.headline = "Localizando a camera";
            progress.detail = "Conferindo qual camera existente voce quer editar antes de aplicar qualquer mudanca.";
        }
        else if (phase == "applying_edit") {
            progress.headline = "Aplicando a edicao";
            progress.detail = "Enviando as alteracoes para a camera selecionada.";
        }
        else {
            progress.headline = "Organizando a edicao";
            progress.detail = "Montando a alteracao pedida e preparando a resposta no chat.";
        }
        return progress;
    }

    if (phase == "resolving_target") {
        progress.headline = "Resolving the camera";
        progress.detail = "Checking which existing camera should be edited before applying any change.";
    }
    else if (phase == "applying_edit") {
        progress.headline = "Applying the edit";
        progress.detail = "Sending the requested changes to the selected camera.";
    }
    else {
        progress.headline = "Preparing the edit";
        progress.detail = "Structuring the requested change and preparing the chat response.";
    }
    return progress;
}

nlohmann::json lookupAddressPatchViaAgentEndpoint_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const nlohmann::json& cameraPatch)
{
    const std::string zipCode = jsonStringField_(cameraPatch, "zip_code");
    if (zipCode.empty()) {
        return nlohmann::json::object();
    }

    const bool needsLookup =
        !cameraPatch.contains("street") ||
        !cameraPatch.contains("city") ||
        !cameraPatch.contains("state") ||
        !cameraPatch.contains("country");
    if (!needsLookup) {
        return nlohmann::json::object();
    }

    nlohmann::json requestBody = {
        { "postal_code", zipCode },
    };
    const std::string country = jsonStringField_(cameraPatch, "country");
    if (!country.empty()) {
        requestBody["country"] = country;
    }

    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/address-lookup?client_id=" + clientId;
    const HttpResponse response = postJson(
        url,
        requestBody.dump(),
        agent.getExeToken(),
        {},
        4500);
    if (!response.ok()) {
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object() || !parsed.value("found", false)) {
        return nlohmann::json::object();
    }

    nlohmann::json normalized = nlohmann::json::object();
    const std::vector<std::pair<const char*, const char*>> fields = {
        { "postal_code", "zip_code" },
        { "street", "street" },
        { "city", "city" },
        { "state", "state" },
        { "country", "country" },
    };
    for (const auto& field : fields) {
        const std::string text = jsonStringField_(parsed, field.first);
        if (!text.empty() && !cameraPatch.contains(field.second)) {
            normalized[field.second] = text;
        }
    }
    return normalized;
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

std::string normalizedCameraField_(const nlohmann::json& camera, const char* key)
{
    return compactToken_(jsonStringField_(camera, key));
}

std::string normalizedSelectorField_(const nlohmann::json& selector, const char* key)
{
    return compactToken_(jsonStringField_(selector, key));
}

bool matchesExactStringField_(
    const nlohmann::json& candidate,
    const nlohmann::json& selector,
    const char* key)
{
    const std::string selectorValue = normalizedSelectorField_(selector, key);
    if (selectorValue.empty()) {
        return true;
    }
    return normalizedCameraField_(candidate, key) == selectorValue;
}

bool matchesSelectorFilters_(
    const nlohmann::json& candidate,
    const nlohmann::json& selector)
{
    if (!matchesExactStringField_(candidate, selector, "manufacturer")) {
        return false;
    }
    if (!matchesExactStringField_(candidate, selector, "channel")) {
        return false;
    }
    if (!matchesExactStringField_(candidate, selector, "subtype")) {
        return false;
    }

    const std::string selectorMethod =
        normalizeConnectionMethod_(jsonStringField_(selector, "connection_method"));
    if (!selectorMethod.empty() &&
        selectorMethod != normalizeConnectionMethod_(jsonStringField_(candidate, "connection_method"))) {
        return false;
    }

    return true;
}

std::string sessionEntityString_(
    const nlohmann::json& conversationContext,
    const char* key)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("session_entities") || !taskState["session_entities"].is_object()) {
        return "";
    }
    return jsonStringField_(taskState["session_entities"], key);
}

nlohmann::json resolvedCameraFromDraft_(const nlohmann::json& draft)
{
    if (!draft.is_object() || !draft.contains("resolved_camera") || !draft["resolved_camera"].is_object()) {
        return nlohmann::json::object();
    }
    return draft["resolved_camera"];
}

nlohmann::json fallbackTargetSelectorFromSession_(
    const nlohmann::json& conversationContext,
    const SkillSelection& selection)
{
    if (!selection.continueActiveTask) {
        return nlohmann::json::object();
    }

    const std::string lastCameraId = sessionEntityString_(conversationContext, "last_camera_id");
    const std::string lastCameraName = sessionEntityString_(conversationContext, "last_camera_name");
    nlohmann::json selector = nlohmann::json::object();
    if (!lastCameraId.empty()) {
        try {
            selector["id"] = std::stoi(lastCameraId);
        }
        catch (...) {
        }
    }
    if (!lastCameraName.empty()) {
        selector["name"] = lastCameraName;
    }
    return normalizeTargetSelector_(selector);
}

nlohmann::json buildResolvedCameraDraft_(
    const nlohmann::json& camera)
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

nlohmann::json resolveTargetCamera_(
    const nlohmann::json& inventory,
    const nlohmann::json& targetSelector,
    const nlohmann::json& activeResolvedCamera)
{
    nlohmann::json result = nlohmann::json::object({
        { "status", "missing_target" },
        { "camera", nlohmann::json::object() },
        { "candidates", nlohmann::json::array() },
    });

    const nlohmann::json cameras =
        inventory.is_object() && inventory.contains("cameras") && inventory["cameras"].is_array()
            ? inventory["cameras"]
            : nlohmann::json::array();

    if (cameras.empty()) {
        result["status"] = "not_found";
        return result;
    }

    int selectorId = 0;
    if (tryJsonIntField_(targetSelector, "id", selectorId) && selectorId > 0) {
        nlohmann::json matches = nlohmann::json::array();
        for (const auto& camera : cameras) {
            int candidateId = 0;
            if (tryJsonIntField_(camera, "id", candidateId) && candidateId == selectorId) {
                matches.push_back(camera);
            }
        }
        if (matches.size() == 1) {
            result["status"] = "resolved";
            result["camera"] = matches[0];
            return result;
        }
        result["status"] = "not_found";
        return result;
    }

    const std::string selectorIp = lowerAsciiCopy_(jsonStringField_(targetSelector, "ip_address"));
    if (!selectorIp.empty()) {
        nlohmann::json matches = nlohmann::json::array();
        for (const auto& camera : cameras) {
            if (lowerAsciiCopy_(jsonStringField_(camera, "ip_address")) == selectorIp &&
                matchesSelectorFilters_(camera, targetSelector)) {
                matches.push_back(camera);
            }
        }
        if (matches.size() == 1) {
            result["status"] = "resolved";
            result["camera"] = matches[0];
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

    const std::string selectorName = normalizedSelectorField_(targetSelector, "name");
    nlohmann::json exactNameMatches = nlohmann::json::array();
    nlohmann::json weakNameMatches = nlohmann::json::array();
    if (!selectorName.empty()) {
        for (const auto& camera : cameras) {
            if (!matchesSelectorFilters_(camera, targetSelector)) {
                continue;
            }
            const std::string candidateName = normalizedCameraField_(camera, "name");
            if (candidateName.empty()) {
                continue;
            }
            if (candidateName == selectorName) {
                appendUniqueCameraCandidate_(exactNameMatches, camera);
            }
            else if (candidateName.find(selectorName) != std::string::npos ||
                     selectorName.find(candidateName) != std::string::npos) {
                appendUniqueCameraCandidate_(weakNameMatches, camera);
            }
        }
        if (exactNameMatches.size() == 1) {
            result["status"] = "resolved";
            result["camera"] = exactNameMatches[0];
            return result;
        }
        if (exactNameMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exactNameMatches;
            return result;
        }
    }

    std::vector<std::string> sceneQueries = selectorSceneQueries_(targetSelector);
    bool usedNameAsSceneFallback = false;
    if (sceneQueries.empty()) {
        const std::string rawNameQuery = trimCopy_(jsonStringField_(targetSelector, "name"));
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
                if (!matchesSelectorFilters_(camera, targetSelector)) {
                    continue;
                }

                const std::string candidateLabel = normalizedDescriptionLabel_(camera);
                const std::string candidateDescription = normalizedDescriptionText_(camera);
                if (!normalizedSceneQuery.empty() &&
                    ((!candidateLabel.empty() && candidateLabel == normalizedSceneQuery) ||
                     (!candidateDescription.empty() && candidateDescription == normalizedSceneQuery))) {
                    appendUniqueCameraCandidate_(exactSceneMatches, camera);
                    continue;
                }

                const std::vector<std::string> candidateTokens = descriptionSemanticTokens_(camera);
                if (!sceneQueryTokens.empty() &&
                    containsAllSemanticTokens_(candidateTokens, sceneQueryTokens)) {
                    appendUniqueCameraCandidate_(semanticSceneMatches, camera);
                    continue;
                }

                if (!normalizedSceneQuery.empty() &&
                    weakTokenMatch_(candidateDescription, normalizedSceneQuery)) {
                    appendUniqueCameraCandidate_(semanticSceneMatches, camera);
                }
            }
        }

        if (exactSceneMatches.size() == 1) {
            result["status"] = "resolved";
            result["camera"] = exactSceneMatches[0];
            return result;
        }
        if (exactSceneMatches.size() > 1) {
            result["status"] = "ambiguous";
            result["candidates"] = exactSceneMatches;
            return result;
        }

        if (semanticSceneMatches.size() == 1 && weakNameMatches.empty()) {
            result["status"] = "resolved";
            result["camera"] = semanticSceneMatches[0];
            return result;
        }

        const nlohmann::json uncertainMatches =
            mergeUniqueCameraCandidates_(semanticSceneMatches, weakNameMatches);
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
            result["status"] = "ambiguous";
            result["candidates"] = weakNameMatches;
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

    int activeResolvedId = 0;
    if (tryJsonIntField_(activeResolvedCamera, "id", activeResolvedId) && activeResolvedId > 0) {
        for (const auto& camera : cameras) {
            int candidateId = 0;
            if (tryJsonIntField_(camera, "id", candidateId) && candidateId == activeResolvedId) {
                result["status"] = "resolved";
                result["camera"] = camera;
                return result;
            }
        }
    }

    result["status"] = "missing_target";
    return result;
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
    const std::string descriptionPreview = cameraDescriptionPreview_(camera);

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
        if (!descriptionPreview.empty()) {
            out << ", cena " << descriptionPreview;
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
    if (!descriptionPreview.empty()) {
        out << ", scene " << descriptionPreview;
    }
    return out.str();
}

std::string buildNeedTargetAnswer_(
    const std::string& language,
    const nlohmann::json& inventory)
{
    const nlohmann::json cameras =
        inventory.is_object() && inventory.contains("cameras") && inventory["cameras"].is_array()
            ? inventory["cameras"]
            : nlohmann::json::array();

    if (language == "pt") {
        if (cameras.empty()) {
            return "Nao encontrei cameras cadastradas para editar neste momento.";
        }
        return "Antes de editar qualquer coisa, preciso que voce me diga qual camera devo alterar. Pode me responder com o nome exato, o ID, o IP ou uma descricao do local/cena da camera.";
    }

    if (cameras.empty()) {
        return "I could not find any registered cameras to edit right now.";
    }
    return "Before I edit anything, I need you to tell me which camera should be changed. Reply with the exact name, ID, IP, or a description of the camera scene/location.";
}

std::string buildAmbiguousTargetAnswer_(
    const std::string& language,
    const nlohmann::json& candidates)
{
    std::ostringstream out;
    if (language == "pt") {
        out << "Encontrei mais de uma camera possivel para essa edicao. Antes de modificar qualquer coisa, confirme qual delas devo alterar:\n";
        for (std::size_t index = 0; index < candidates.size(); ++index) {
            out << "\n" << cameraReferenceLine_(candidates[index], index, language);
        }
        out << "\n\nPode me responder com o nome exato, o ID, o IP ou uma descricao mais especifica da cena/local.";
        return out.str();
    }

    out << "I found more than one possible camera for this edit. Before changing anything, confirm which one I should update:\n";
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        out << "\n" << cameraReferenceLine_(candidates[index], index, language);
    }
    out << "\n\nReply with the exact name, ID, IP, or a more specific scene/location description.";
    return out.str();
}

std::string buildCameraNotFoundAnswer_(
    const std::string& language,
    const nlohmann::json& targetSelector)
{
    const std::string name = jsonStringField_(targetSelector, "name");
    std::string description = jsonStringField_(targetSelector, "description");
    if (description.empty()) {
        description = jsonStringField_(targetSelector, "scene_description");
    }
    if (description.empty()) {
        description = jsonStringField_(targetSelector, "scene_label");
    }
    const std::string ip = jsonStringField_(targetSelector, "ip_address");
    const int id = targetSelector.value("id", 0);

    if (language == "pt") {
        if (!ip.empty()) {
            return "Nao encontrei uma camera cadastrada com esse IP agora. Me confirme o nome exato, o ID ou o IP atual da camera.";
        }
        if (id > 0) {
            return "Nao encontrei uma camera cadastrada com esse ID agora. Me confirme o nome exato, o ID ou o IP da camera.";
        }
        if (!description.empty()) {
            return "Nao encontrei uma camera cadastrada que combine com essa descricao agora. Me confirme o nome exato, o ID, o IP ou uma descricao mais especifica da cena/local.";
        }
        if (!name.empty()) {
            return "Nao encontrei uma camera cadastrada com esse nome agora. Me confirme o nome exato, o ID ou o IP da camera.";
        }
        return "Nao consegui localizar com seguranca a camera que deve ser editada. Me confirme o nome exato, o ID, o IP ou uma descricao da cena/local.";
    }

    if (!ip.empty()) {
        return "I could not find a registered camera with that IP right now. Please confirm the exact name, ID, or current IP of the camera.";
    }
    if (id > 0) {
        return "I could not find a registered camera with that ID right now. Please confirm the exact name, ID, or IP of the camera.";
    }
    if (!description.empty()) {
        return "I could not find a registered camera matching that description right now. Please confirm the exact name, ID, IP, or a more specific scene/location description.";
    }
    if (!name.empty()) {
        return "I could not find a registered camera with that name right now. Please confirm the exact name, ID, or IP of the camera.";
    }
    return "I could not safely locate the camera that should be edited. Please confirm the exact name, ID, IP, or a scene/location description.";
}

std::string buildNeedPatchAnswer_(
    const std::string& language,
    const nlohmann::json& camera)
{
    const std::string name = jsonStringField_(camera, "name");
    if (language == "pt") {
        if (!name.empty()) {
            return "Encontrei a camera " + name + ", mas ainda preciso que voce diga o que quer alterar nela.";
        }
        return "Encontrei a camera certa, mas ainda preciso que voce diga o que quer alterar.";
    }

    if (!name.empty()) {
        return "I found the camera " + name + ", but I still need you to say what should be changed.";
    }
    return "I found the right camera, but I still need you to say what should be changed.";
}

std::string buildFormAnswer_(
    const std::string& language,
    const nlohmann::json& camera)
{
    const std::string name = jsonStringField_(camera, "name");
    if (language == "pt") {
        if (!name.empty()) {
            return "Separei a camera " + name + " e deixei o formulario de edicao pronto no card abaixo.";
        }
        return "Deixei o formulario de edicao da camera pronto no card abaixo.";
    }

    if (!name.empty()) {
        return "I isolated the camera " + name + " and prepared the edit form in the card below.";
    }
    return "I prepared the camera edit form in the card below.";
}

std::string fieldLabel_(
    const std::string& field,
    const std::string& language)
{
    const bool isPt = language == "pt";
    if (field == "name") return isPt ? "nome" : "name";
    if (field == "ip_address") return isPt ? "IP ou host" : "IP or host";
    if (field == "rtsp_port") return isPt ? "porta RTSP" : "RTSP port";
    if (field == "manufacturer") return isPt ? "fabricante" : "manufacturer";
    if (field == "username") return isPt ? "usuario" : "username";
    if (field == "password") return isPt ? "senha" : "password";
    if (field == "channel") return isPt ? "canal" : "channel";
    if (field == "subtype") return "subtype";
    if (field == "connection_method") return isPt ? "metodo de conexao" : "connection method";
    if (field == "description") return isPt ? "descricao" : "description";
    if (field == "street") return isPt ? "rua" : "street";
    if (field == "number") return isPt ? "numero do endereco" : "address number";
    if (field == "city") return isPt ? "cidade" : "city";
    if (field == "state") return isPt ? "estado" : "state";
    if (field == "zip_code") return isPt ? "CEP ou zipcode" : "zip or postal code";
    if (field == "country") return isPt ? "pais" : "country";
    if (field == "retention_days") return isPt ? "retencao" : "retention";
    if (field == "webcam_index") return isPt ? "indice da webcam" : "webcam index";
    if (field == "allowpublicaccess") return isPt ? "compartilhar com colaboradores" : "share with collaborators";
    if (field == "is_service_running") return isPt ? "servico local" : "local service";
    return field;
}

std::string formatValueForAnswer_(const nlohmann::json& value)
{
    if (value.is_string()) {
        return trimCopy_(value.get<std::string>());
    }
    if (value.is_boolean()) {
        return value.get<bool>() ? "true" : "false";
    }
    if (value.is_number_integer()) {
        return std::to_string(value.get<int>());
    }
    if (value.is_number()) {
        std::ostringstream out;
        out << value.get<double>();
        return out.str();
    }
    if (value.is_null()) {
        return "";
    }
    return value.dump();
}

std::string buildSuccessAnswer_(
    const std::string& language,
    const nlohmann::json& updatedCamera,
    const nlohmann::json& patch,
    const nlohmann::json& clearFields)
{
    const std::string name = jsonStringField_(updatedCamera, "name");
    std::vector<std::string> changes;

    if (patch.is_object()) {
        for (auto it = patch.begin(); it != patch.end(); ++it) {
            const std::string value = formatValueForAnswer_(it.value());
            if (value.empty()) {
                continue;
            }
            changes.push_back(fieldLabel_(it.key(), language) + " -> " + value);
        }
    }

    if (clearFields.is_array()) {
        for (const auto& entry : clearFields) {
            if (!entry.is_string()) {
                continue;
            }
            changes.push_back(
                fieldLabel_(entry.get<std::string>(), language) +
                (language == "pt" ? " limpo" : " cleared"));
        }
    }

    std::ostringstream out;
    if (language == "pt") {
        out << "Atualizei a camera " << (name.empty() ? "selecionada" : name) << ".";
        if (!changes.empty()) {
            out << "\nAlteracoes aplicadas:";
            for (const auto& change : changes) {
                out << "\n- " << change;
            }
        }
        return out.str();
    }

    out << "I updated the camera " << (name.empty() ? "you selected" : name) << ".";
    if (!changes.empty()) {
        out << "\nApplied changes:";
        for (const auto& change : changes) {
            out << "\n- " << change;
        }
    }
    return out.str();
}

nlohmann::json buildTaskDraft_(
    const nlohmann::json& mergedDraft,
    const nlohmann::json& resolvedCamera = nlohmann::json::object(),
    const nlohmann::json& candidateCameras = nlohmann::json::array())
{
    nlohmann::json draft = nlohmann::json::object();
    if (mergedDraft.contains("target_selector")) {
        draft["target_selector"] = mergedDraft["target_selector"];
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
    if (mergedDraft.contains("open_form")) {
        draft["open_form"] = mergedDraft["open_form"];
    }
    if (resolvedCamera.is_object() && !resolvedCamera.empty()) {
        draft["resolved_camera"] = resolvedCamera;
        if (resolvedCamera.contains("name") && resolvedCamera["name"].is_string()) {
            draft["name"] = resolvedCamera["name"];
        }
        if (resolvedCamera.contains("id")) {
            if (resolvedCamera["id"].is_string()) {
                draft["id"] = resolvedCamera["id"];
            }
            else if (resolvedCamera["id"].is_number_integer()) {
                draft["id"] = std::to_string(resolvedCamera["id"].get<int>());
            }
        }
    }
    if (candidateCameras.is_array() && !candidateCameras.empty()) {
        draft["candidate_cameras"] = candidateCameras;
    }
    return draft;
}

std::vector<std::string> collectedFieldsForEdit_(
    const nlohmann::json& resolvedCamera,
    const nlohmann::json& patch,
    const nlohmann::json& clearFields)
{
    std::vector<std::string> fields;
    if (resolvedCamera.is_object() && !resolvedCamera.empty()) {
        fields.push_back("target_camera");
    }
    if (patch.is_object()) {
        for (auto it = patch.begin(); it != patch.end(); ++it) {
            fields.push_back(it.key());
        }
    }
    if (clearFields.is_array() && !clearFields.empty()) {
        fields.push_back("clear_fields");
    }
    return fields;
}

nlohmann::json buildTaskStateAwaitingTarget_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& candidates,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_camera",
            "camera",
            "update",
            "collecting_input",
            "awaiting_target_confirmation",
            normalizeAssistantLanguageTag(language),
            language == "pt" ? "editar uma camera existente" : "edit an existing camera",
            language == "pt" ? "Aguardando confirmacao da camera alvo" : "Waiting for target camera confirmation",
            trimCopy_(answer),
            { "target_camera" },
            collectedFieldsForEdit_(
                nlohmann::json::object(),
                mergedDraft.value("camera_patch", nlohmann::json::object()),
                mergedDraft.value("clear_fields", nlohmann::json::array())),
            buildTaskDraft_(mergedDraft, nlohmann::json::object(), candidates),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object(),
        });
}

nlohmann::json buildTaskStateAwaitingPatch_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& resolvedCamera,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_camera",
            "camera",
            "update",
            "collecting_input",
            "awaiting_patch_details",
            normalizeAssistantLanguageTag(language),
            language == "pt" ? "editar uma camera existente" : "edit an existing camera",
            language == "pt" ? "Aguardando campos para editar" : "Waiting for edit details",
            trimCopy_(answer),
            { "camera_patch" },
            collectedFieldsForEdit_(
                resolvedCamera,
                mergedDraft.value("camera_patch", nlohmann::json::object()),
                mergedDraft.value("clear_fields", nlohmann::json::array())),
            buildTaskDraft_(mergedDraft, resolvedCamera),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object(),
        });
}

nlohmann::json buildTaskStateAwaitingForm_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& resolvedCamera,
    const std::string& answer,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_camera",
            "camera",
            "update",
            "awaiting_confirmation",
            "awaiting_form_open",
            normalizeAssistantLanguageTag(language),
            language == "pt" ? "editar uma camera existente" : "edit an existing camera",
            language == "pt" ? "Formulario de edicao preparado" : "Edit form prepared",
            trimCopy_(answer),
            {},
            collectedFieldsForEdit_(
                resolvedCamera,
                mergedDraft.value("camera_patch", nlohmann::json::object()),
                mergedDraft.value("clear_fields", nlohmann::json::array())),
            buildTaskDraft_(mergedDraft, resolvedCamera),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object({
                { "type", "camera_edit_form_request" },
                { "status", "awaiting_form_open" },
                { "editable", true },
            }),
        });
}

nlohmann::json buildTaskStateCompleted_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& mergedDraft,
    const nlohmann::json& resolvedCamera,
    const std::string& answer,
    const std::string& language)
{
    return completeOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "edit_camera",
            "camera",
            "update",
            "completed",
            "edit_applied",
            normalizeAssistantLanguageTag(language),
            language == "pt" ? "editar uma camera existente" : "edit an existing camera",
            language == "pt" ? "Camera atualizada" : "Camera updated",
            trimCopy_(answer),
            {},
            collectedFieldsForEdit_(
                resolvedCamera,
                mergedDraft.value("camera_patch", nlohmann::json::object()),
                mergedDraft.value("clear_fields", nlohmann::json::array())),
            buildTaskDraft_(mergedDraft, resolvedCamera),
            mergedDraft.value("field_sources", nlohmann::json::object()),
            nlohmann::json::object(),
        });
}

nlohmann::json buildHttpPatchBody_(
    const nlohmann::json& patch,
    const nlohmann::json& clearFields)
{
    nlohmann::json body = patch.is_object() ? patch : nlohmann::json::object();
    if (clearFields.is_array()) {
        for (const auto& entry : clearFields) {
            if (!entry.is_string()) {
                continue;
            }
            const std::string field = entry.get<std::string>();
            if (field == "webcam_index") {
                body[field] = nullptr;
            }
            else if (isClearableCameraField_(field)) {
                body[field] = "";
            }
        }
    }
    return body;
}

std::string agentCameraUrl_(
    AgentCore& agent,
    const nlohmann::json& payload,
    int cameraId)
{
    const std::string clientId = clientIdFromPayload_(payload).empty()
        ? agent.getClientId()
        : clientIdFromPayload_(payload);
    std::ostringstream url;
    url << agent.getBackendBaseUrl() << "/api/agent/cameras/" << cameraId << "?client_id=" << clientId;
    return url.str();
}

HttpResponse applyCameraEditViaAgentEndpoint_(
    AgentCore& agent,
    const nlohmann::json& payload,
    int cameraId,
    const nlohmann::json& patchBody)
{
    return patchJson(
        agentCameraUrl_(agent, payload, cameraId),
        patchBody.dump(),
        agent.getExeToken(),
        {},
        15000);
}

std::string buildFailureAnswer_(
    const std::string& language,
    const std::string& detail)
{
    if (language == "pt") {
        return detail.empty()
            ? "Nao consegui editar a camera agora. Tente novamente em instantes."
            : "Nao consegui editar a camera agora. Detalhe: " + detail;
    }
    return detail.empty()
        ? "I could not edit the camera right now. Please try again in a moment."
        : "I could not edit the camera right now. Detail: " + detail;
}

std::string buildValidationFailureAnswer_(
    const std::string& language,
    const nlohmann::json& parsedError)
{
    std::string detail = jsonStringField_(parsedError, "error");
    if (detail.empty()) {
        detail = jsonStringField_(parsedError, "message");
    }

    std::vector<std::string> missing;
    if (parsedError.is_object() &&
        parsedError.contains("missing_fields") &&
        parsedError["missing_fields"].is_array()) {
        for (const auto& field : parsedError["missing_fields"]) {
            if (!field.is_string()) {
                continue;
            }
            missing.push_back(fieldLabel_(field.get<std::string>(), language));
        }
    }

    if (language == "pt") {
        if (!missing.empty()) {
            std::ostringstream out;
            out << "Ainda nao consegui aplicar essa edicao porque faltam campos obrigatorios para esse tipo de camera: ";
            for (std::size_t index = 0; index < missing.size(); ++index) {
                if (index > 0) {
                    out << ", ";
                }
                out << missing[index];
            }
            out << ".";
            return out.str();
        }
        if (!detail.empty()) {
            return "Ainda nao consegui aplicar essa edicao. Detalhe: " + detail;
        }
        return "Ainda nao consegui aplicar essa edicao por causa de uma validacao do servidor.";
    }

    if (!missing.empty()) {
        std::ostringstream out;
        out << "I still could not apply this edit because required fields are missing for this camera type: ";
        for (std::size_t index = 0; index < missing.size(); ++index) {
            if (index > 0) {
                out << ", ";
            }
            out << missing[index];
        }
        out << ".";
        return out.str();
    }
    if (!detail.empty()) {
        return "I still could not apply this edit. Detail: " + detail;
    }
    return "I still could not apply this edit because the server rejected the update.";
}

} // namespace

SkillDefinition EditCameraSkill::definition() const
{
    return {
        "edit_camera",
        "Edits an existing camera directly from chat, but always asks for confirmation when there is any target ambiguity.",
        true,
    };
}

SkillRunResult EditCameraSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "edit_camera";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string language = effectiveReplyLanguage_(selection, payload, conversationContext);

    nlohmann::json mergedDraft = mergeEditDrafts_(
        activeEditDraft_(conversationContext),
        normalizeRouterEditDraft_(selection));

    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);

    const nlohmann::json extractedDraft =
        extractEditDraft_(llm, payload, conversationContext, selection);
    if (extractedDraft.contains("target_selector") &&
        hasTargetSelector_(extractedDraft["target_selector"])) {
        mergedDraft.erase("target_selector");
        mergedDraft.erase("resolved_camera");
        mergedDraft.erase("candidate_cameras");
    }
    mergedDraft = mergeEditDrafts_(mergedDraft, extractedDraft);

    if (!mergedDraft.contains("target_selector") || !hasTargetSelector_(mergedDraft["target_selector"])) {
        const nlohmann::json sessionFallbackSelector =
            fallbackTargetSelectorFromSession_(conversationContext, selection);
        if (!sessionFallbackSelector.empty()) {
            mergedDraft = mergeEditDrafts_(
                mergedDraft,
                nlohmann::json::object({
                    { "target_selector", sessionFallbackSelector },
                }));
        }
    }

    nlohmann::json patch = mergedDraft.value("camera_patch", nlohmann::json::object());
    nlohmann::json fieldSources = mergedDraft.value("field_sources", nlohmann::json::object());
    const nlohmann::json addressLookupPatch =
        lookupAddressPatchViaAgentEndpoint_(agent, payload, patch);
    for (auto it = addressLookupPatch.begin(); it != addressLookupPatch.end(); ++it) {
        if (!patch.contains(it.key())) {
            patch[it.key()] = it.value();
            setFieldSource_(fieldSources, it.key(), "address_lookup");
        }
    }
    if (!patch.empty()) {
        mergedDraft["camera_patch"] = patch;
    }
    if (!fieldSources.empty()) {
        mergedDraft["field_sources"] = fieldSources;
    }

    postChatProgress(
        agent,
        payload,
        buildEditProgress_(language, "resolving_target", 2, 2, 3),
        2500);

    const nlohmann::json inventory = fetchCameraInventory_(agent, payload);
    if (!inventory.value("ok", false)) {
        result.answer = buildFailureAnswer_(language, jsonStringField_(inventory, "error"));
        result.metadata["task_state"] = buildTaskStateAwaitingTarget_(
            conversationContext,
            mergedDraft,
            nlohmann::json::array(),
            result.answer,
            language);
        return result;
    }

    const nlohmann::json targetSelector = mergedDraft.value("target_selector", nlohmann::json::object());
    const nlohmann::json resolution =
        resolveTargetCamera_(inventory, targetSelector, resolvedCameraFromDraft_(mergedDraft));
    const std::string resolutionStatus = jsonStringField_(resolution, "status");

    if (resolutionStatus == "missing_target") {
        result.answer = buildNeedTargetAnswer_(language, inventory);
        result.metadata["task_state"] = buildTaskStateAwaitingTarget_(
            conversationContext,
            mergedDraft,
            nlohmann::json::array(),
            result.answer,
            language);
        return result;
    }

    if (resolutionStatus == "ambiguous") {
        const nlohmann::json candidates = resolution.value("candidates", nlohmann::json::array());
        result.answer = buildAmbiguousTargetAnswer_(language, candidates);
        result.metadata["task_state"] = buildTaskStateAwaitingTarget_(
            conversationContext,
            mergedDraft,
            candidates,
            result.answer,
            language);
        return result;
    }

    if (resolutionStatus != "resolved" || !resolution.contains("camera") || !resolution["camera"].is_object()) {
        result.answer = buildCameraNotFoundAnswer_(language, targetSelector);
        result.metadata["task_state"] = buildTaskStateAwaitingTarget_(
            conversationContext,
            mergedDraft,
            nlohmann::json::array(),
            result.answer,
            language);
        return result;
    }

    const nlohmann::json resolvedCamera = buildResolvedCameraDraft_(resolution["camera"]);
    mergedDraft = mergeEditDrafts_(
        mergedDraft,
        nlohmann::json::object({
            { "resolved_camera", resolvedCamera },
        }));

    const nlohmann::json clearFields = mergedDraft.value("clear_fields", nlohmann::json::array());
    patch = mergedDraft.value("camera_patch", nlohmann::json::object());

    if (!hasPatchChanges_(patch, clearFields)) {
        if (mergedDraft.value("open_form", false)) {
            result.answer = buildFormAnswer_(language, resolvedCamera);
            result.metadata["message_metadata"] = {
                { "type", "camera_edit_form_request" },
                { "status", "awaiting_form_open" },
                { "language", normalizeAssistantLanguageTag(language) },
                { "camera_id", resolvedCamera.value("id", 0) },
                { "camera_name", jsonStringField_(resolvedCamera, "name") },
                { "draft_patch", nlohmann::json::object() },
                { "clear_fields", nlohmann::json::array() },
            };
            result.metadata["task_state"] = buildTaskStateAwaitingForm_(
                conversationContext,
                mergedDraft,
                resolvedCamera,
                result.answer,
                language);
            return result;
        }

        result.answer = buildNeedPatchAnswer_(language, resolvedCamera);
        result.metadata["task_state"] = buildTaskStateAwaitingPatch_(
            conversationContext,
            mergedDraft,
            resolvedCamera,
            result.answer,
            language);
        return result;
    }

    if (mergedDraft.value("open_form", false)) {
        result.answer = buildFormAnswer_(language, resolvedCamera);
        result.metadata["message_metadata"] = {
            { "type", "camera_edit_form_request" },
            { "status", "awaiting_form_open" },
            { "language", normalizeAssistantLanguageTag(language) },
            { "camera_id", resolvedCamera.value("id", 0) },
            { "camera_name", jsonStringField_(resolvedCamera, "name") },
            { "draft_patch", patch },
            { "clear_fields", clearFields },
        };
        result.metadata["task_state"] = buildTaskStateAwaitingForm_(
            conversationContext,
            mergedDraft,
            resolvedCamera,
            result.answer,
            language);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        buildEditProgress_(language, "applying_edit", 3, 3, 3),
        2500);

    const nlohmann::json patchBody = buildHttpPatchBody_(patch, clearFields);
    const int cameraId = resolvedCamera.value("id", 0);
    const HttpResponse applyResponse =
        applyCameraEditViaAgentEndpoint_(agent, payload, cameraId, patchBody);
    if (!applyResponse.ok()) {
        const nlohmann::json parsedError = nlohmann::json::parse(applyResponse.body, nullptr, false);
        if (applyResponse.statusCode == 400 && parsedError.is_object()) {
            result.answer = buildValidationFailureAnswer_(language, parsedError);
            result.metadata["task_state"] = buildTaskStateAwaitingPatch_(
                conversationContext,
                mergedDraft,
                resolvedCamera,
                result.answer,
                language);
            return result;
        }

        result.answer = buildFailureAnswer_(language, parseErrorMessage_(applyResponse));
        result.metadata["task_state"] = buildTaskStateAwaitingPatch_(
            conversationContext,
            mergedDraft,
            resolvedCamera,
            result.answer,
            language);
        return result;
    }

    const nlohmann::json parsedUpdatedCamera = nlohmann::json::parse(applyResponse.body, nullptr, false);
    const nlohmann::json updatedCamera =
        parsedUpdatedCamera.is_object() ? parsedUpdatedCamera : resolvedCamera;

    result.answer = buildSuccessAnswer_(language, updatedCamera, patch, clearFields);
    result.metadata["task_state"] = buildTaskStateCompleted_(
        conversationContext,
        mergedDraft,
        buildResolvedCameraDraft_(updatedCamera.is_object() ? updatedCamera : resolvedCamera),
        result.answer,
        language);

    return result;
}

} // namespace chatv2

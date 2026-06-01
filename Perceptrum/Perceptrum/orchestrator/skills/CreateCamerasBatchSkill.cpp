#include "CreateCamerasBatchSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <string>
#include <vector>

#include "../../core/AgentCore.h"
#include "../ChatModelConfig.h"
#include "../HttpUtils.h"
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

const std::vector<std::string>& batchCameraFieldNames_()
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
        "allowpublicaccess",
    };
    return fields;
}

bool itemHasAnyValue_(const nlohmann::json& value)
{
    if (!value.is_object()) {
        return false;
    }

    for (const auto& field : batchCameraFieldNames_()) {
        if (!value.contains(field)) {
            continue;
        }
        const auto& candidate = value[field];
        if (candidate.is_string() && !trimCopy_(candidate.get<std::string>()).empty()) {
            return true;
        }
        if (candidate.is_number() || candidate.is_boolean()) {
            return true;
        }
    }
    return false;
}

std::string normalizeConnectionMethod_(const nlohmann::json& value)
{
    std::string method = value.is_object()
        ? upperAsciiCopy_(jsonStringField_(value, "connection_method"))
        : "";
    if (method == "HTTP" || method == "ONVIF") {
        return method;
    }
    return "RTSP";
}

nlohmann::json normalizeBatchCameraItem_(
    const nlohmann::json& value,
    bool defaultConnectionMethod)
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

    int retentionDays = 0;
    if (tryJsonIntField_(value, "retention_days", retentionDays) &&
        (retentionDays == 1 ||
         retentionDays == 3 ||
         retentionDays == 7 ||
         retentionDays == 15 ||
         retentionDays == 30 ||
         retentionDays == 90 ||
         retentionDays == 180)) {
        normalized["retention_days"] = retentionDays;
    }

    bool allowPublicAccess = false;
    if (value.contains("allowpublicaccess") &&
        parseBoolLoose_(value["allowpublicaccess"], allowPublicAccess)) {
        normalized["allowpublicaccess"] = allowPublicAccess;
    }

    if ((value.contains("connection_method") && !jsonStringField_(value, "connection_method").empty()) ||
        (defaultConnectionMethod && itemHasAnyValue_(normalized))) {
        normalized["connection_method"] = normalizeConnectionMethod_(value);
    }

    int sourceIndex = 0;
    if (tryJsonIntField_(value, "source_index", sourceIndex) && sourceIndex >= 0) {
        normalized["source_index"] = sourceIndex;
    }
    const std::string sourceReference = jsonStringField_(value, "source_reference");
    if (!sourceReference.empty()) {
        normalized["source_reference"] = sourceReference;
    }

    return normalized;
}

int normalizeExpectedCount_(const nlohmann::json& value)
{
    int expectedCount = 0;
    if (value.is_number_integer()) {
        expectedCount = value.get<int>();
    }
    else if (value.is_number()) {
        expectedCount = static_cast<int>(value.get<double>());
    }
    else if (value.is_string()) {
        try {
            expectedCount = std::stoi(trimCopy_(value.get<std::string>()));
        }
        catch (...) {
            expectedCount = 0;
        }
    }
    if (expectedCount < 0) expectedCount = 0;
    if (expectedCount > 100) expectedCount = 100;
    return expectedCount;
}

nlohmann::json defaultBatchDraft_()
{
    return nlohmann::json::object({
        { "expected_count", 0 },
        { "shared_defaults", nlohmann::json::object() },
        { "items", nlohmann::json::array() },
    });
}

nlohmann::json normalizeBatchDraft_(const nlohmann::json& value)
{
    nlohmann::json normalized = defaultBatchDraft_();
    if (!value.is_object()) {
        return normalized;
    }

    normalized["expected_count"] = normalizeExpectedCount_(value.value("expected_count", 0));
    normalized["shared_defaults"] = normalizeBatchCameraItem_(
        value.value("shared_defaults", nlohmann::json::object()),
        true);

    nlohmann::json items = nlohmann::json::array();
    if (value.contains("items") && value["items"].is_array()) {
        int nextFallbackIndex = 0;
        for (const auto& item : value["items"]) {
            nlohmann::json normalizedItem = normalizeBatchCameraItem_(item, true);
            if (!itemHasAnyValue_(normalizedItem)) {
                continue;
            }
            if (!normalizedItem.contains("source_index")) {
                normalizedItem["source_index"] = nextFallbackIndex;
            }
            if (!normalizedItem.contains("source_reference")) {
                normalizedItem["source_reference"] =
                    "Camera " + std::to_string(nextFallbackIndex + 1);
            }
            items.push_back(normalizedItem);
            ++nextFallbackIndex;
        }
    }
    normalized["items"] = items;

    if (normalized.value("expected_count", 0) <= 0) {
        normalized["expected_count"] = static_cast<int>(items.size());
    }

    return normalized;
}

std::string batchItemIdentityKey_(const nlohmann::json& item)
{
    const std::string ip = lowerAsciiCopy_(jsonStringField_(item, "ip_address"));
    if (!ip.empty()) {
        return "ip:" + ip;
    }
    const std::string name = lowerAsciiCopy_(jsonStringField_(item, "name"));
    if (!name.empty()) {
        return "name:" + name;
    }
    return "";
}

nlohmann::json mergeBatchItems_(
    const nlohmann::json& existingItems,
    const nlohmann::json& newItems)
{
    nlohmann::json merged = existingItems.is_array()
        ? existingItems
        : nlohmann::json::array();

    if (!newItems.is_array()) {
        return merged;
    }

    for (const auto& newItemRaw : newItems) {
        const nlohmann::json newItem = normalizeBatchCameraItem_(newItemRaw, true);
        if (!itemHasAnyValue_(newItem)) {
            continue;
        }

        const std::string newKey = batchItemIdentityKey_(newItem);
        bool mergedIntoExisting = false;
        if (!newKey.empty()) {
            for (auto& existingItem : merged) {
                if (!existingItem.is_object()) {
                    continue;
                }
                if (batchItemIdentityKey_(existingItem) != newKey) {
                    continue;
                }
                for (auto it = newItem.begin(); it != newItem.end(); ++it) {
                    existingItem[it.key()] = it.value();
                }
                mergedIntoExisting = true;
                break;
            }
        }

        if (!mergedIntoExisting) {
            merged.push_back(newItem);
        }
    }

    for (std::size_t index = 0; index < merged.size(); ++index) {
        auto& item = merged[index];
        if (!item.is_object()) {
            continue;
        }
        if (!item.contains("source_index")) {
            item["source_index"] = static_cast<int>(index);
        }
        if (!item.contains("source_reference")) {
            item["source_reference"] = "Camera " + std::to_string(index + 1);
        }
    }
    return merged;
}

nlohmann::json mergeBatchDrafts_(
    const nlohmann::json& existingDraft,
    const nlohmann::json& patchDraft)
{
    nlohmann::json merged = normalizeBatchDraft_(existingDraft);
    const nlohmann::json patch = normalizeBatchDraft_(patchDraft);

    const int patchExpectedCount = patch.value("expected_count", 0);
    if (patchExpectedCount > 0) {
        merged["expected_count"] = patchExpectedCount;
    }

    nlohmann::json mergedSharedDefaults =
        merged.value("shared_defaults", nlohmann::json::object());
    const nlohmann::json patchSharedDefaults =
        patch.value("shared_defaults", nlohmann::json::object());
    if (patchSharedDefaults.is_object()) {
        for (auto it = patchSharedDefaults.begin(); it != patchSharedDefaults.end(); ++it) {
            mergedSharedDefaults[it.key()] = it.value();
        }
    }
    merged["shared_defaults"] = normalizeBatchCameraItem_(mergedSharedDefaults, true);
    merged["items"] = mergeBatchItems_(
        merged.value("items", nlohmann::json::array()),
        patch.value("items", nlohmann::json::array()));

    if (merged.value("expected_count", 0) <= 0) {
        merged["expected_count"] = static_cast<int>(merged.value("items", nlohmann::json::array()).size());
    }

    return normalizeBatchDraft_(merged);
}

std::size_t batchItemCount_(const nlohmann::json& batchDraft)
{
    const auto& items = batchDraft.value("items", nlohmann::json::array());
    return items.is_array() ? items.size() : 0;
}

nlohmann::json taskStateFromConversation_(const nlohmann::json& conversationContext)
{
    return taskStateFromConversationContext(conversationContext);
}

nlohmann::json activeBatchDraft_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversation_(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return defaultBatchDraft_();
    }

    const auto& activeTask = taskState["active_task"];
    if (jsonStringField_(activeTask, "type") != "create_cameras_batch") {
        return defaultBatchDraft_();
    }

    if (!activeTask.contains("draft") || !activeTask["draft"].is_object()) {
        return defaultBatchDraft_();
    }

    return normalizeBatchDraft_(activeTask["draft"]);
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

nlohmann::json extractBatchDraft_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection)
{
    if (!llm.isConfigured()) {
        return defaultBatchDraft_();
    }

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string replyLanguage = effectiveReplyLanguage_(selection, payload, conversationContext);

    const std::string systemPrompt =
        "/no_think\n"
        "You extract structured data for multi-camera registration in the app.\n"
        "Use the latest user_message plus the active create_cameras_batch task in conversation_task_state when present.\n"
        "This is a semantic extraction task, not a delimiter-only parser.\n"
        "Understand rows, repeated tuples, shared defaults, and follow-up corrections even when commas, semicolons, or keywords are inconsistent.\n"
        "The user may say values apply to all cameras. Put those in shared_defaults.\n"
        "The user may provide per-camera values inline, in loose rows, or in free text. Put those in items.\n"
        "Never invent cameras, credentials, addresses, or IPs that the user did not provide.\n"
        "Never copy assistant examples as real values.\n"
        "Use expected_count when the user clearly states a total such as 5 cameras.\n"
        "items should contain only the per-camera fields you can support from the user's message or active task context.\n"
        "shared_defaults should contain only values the user wants to reuse across the batch.\n"
        "Prefer shared_defaults when the same manufacturer, username, password, address, or RTSP port should apply to many items.\n"
        "Return JSON only with this shape:\n"
        "{"
        "\"expected_count\":5,"
        "\"shared_defaults\":{"
        "\"manufacturer\":\"Hikvision\","
        "\"username\":\"admin\","
        "\"password\":\"12345678\","
        "\"rtsp_port\":\"554\","
        "\"zip_code\":\"22793071\","
        "\"number\":\"100\","
        "\"connection_method\":\"RTSP\""
        "},"
        "\"items\":["
        "{\"name\":\"cam_1\",\"ip_address\":\"192.168.1.10\"},"
        "{\"name\":\"cam_2\",\"ip_address\":\"192.168.1.11\"}"
        "]"
        "}\n"
        "Valid shared_defaults and item fields are: name, ip_address, rtsp_port, manufacturer, username, password, channel, subtype, connection_method, description, street, number, city, state, zip_code, country, retention_days, allowpublicaccess.\n"
        "Do not emit empty strings, nulls, placeholder values, webcam fields, or fake defaults.\n"
        "If the user only states the batch count and asks for help, expected_count may be present with empty items.\n"
        "Example: user_message=\"quero cadastrar 5 cameras de uma vez; use fabricante hikvision, usuario admin, senha 12345678, cep 22793071 e numero do endereco 100 em todas; cam_1 192.168.1.10; cam_2 192.168.1.11\" => "
        "{\"expected_count\":5,\"shared_defaults\":{\"manufacturer\":\"Hikvision\",\"username\":\"admin\",\"password\":\"12345678\",\"zip_code\":\"22793071\",\"number\":\"100\",\"connection_method\":\"RTSP\"},\"items\":[{\"name\":\"cam_1\",\"ip_address\":\"192.168.1.10\"},{\"name\":\"cam_2\",\"ip_address\":\"192.168.1.11\"}]}\n"
        "Example: user_message=\"use admin e senha 123456 em todas\" while active task already contains items => "
        "{\"shared_defaults\":{\"username\":\"admin\",\"password\":\"123456\"},\"items\":[]}\n";

    nlohmann::json promptPayload = {
        { "reply_language", replyLanguage },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultOperationTaskState()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "user_message", userMessage },
    };

    const auto outcome = llm.completeText(
        "extractCameraBatchDraft",
        systemPrompt,
        promptPayload.dump(2),
        0.0,
        1400,
        18000,
        1,
        true);

    if (!outcome.ok || trimCopy_(outcome.content).empty()) {
        return defaultBatchDraft_();
    }

    const nlohmann::json parsed = nlohmann::json::parse(outcome.content, nullptr, false);
    return normalizeBatchDraft_(parsed);
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

ChatProgressUpdate buildBatchProgress_(
    const std::string& language,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate progress;
    progress.skill = "create_cameras_batch";
    progress.phase = phase;
    progress.sequence = sequence;
    progress.stepIndex = stepIndex;
    progress.stepCount = stepCount;

    if (normalizeAssistantLanguageTag(language) == "pt") {
        if (phase == "extracting_batch") {
            progress.headline = "Organizando o lote de cameras";
            progress.detail = "Lendo os dados das cameras e os valores que podem ser reaproveitados em todas.";
        }
        else {
            progress.headline = "Montando o preview";
            progress.detail = "Validando o lote e preparando a revisao final antes do cadastro.";
        }
        return progress;
    }

    if (phase == "extracting_batch") {
        progress.headline = "Structuring the camera batch";
        progress.detail = "Reading the camera rows and the shared values that can be reused.";
    }
    else {
        progress.headline = "Preparing the preview";
        progress.detail = "Validating the batch and preparing the final review before registration.";
    }
    return progress;
}

std::string batchExampleBlock_(const std::string& language)
{
    if (language == "pt") {
        return
            "cam_1 192.168.1.10\n"
            "cam_2 192.168.1.11\n"
            "cam_3 192.168.1.12\n"
            "e use fabricante Hikvision, usuario admin, senha 12345678, cep 22793071 e numero do endereco 100 em todas";
    }
    return
        "cam_1 192.168.1.10\n"
        "cam_2 192.168.1.11\n"
        "cam_3 192.168.1.12\n"
        "and use manufacturer Hikvision, username admin, password 12345678, zip code 22793071, and address number 100 for all of them";
}

std::string buildNeedBatchDetailsAnswer_(
    const nlohmann::json& batchDraft,
    const std::string& language)
{
    const int expectedCount = batchDraft.value("expected_count", 0);
    std::ostringstream out;
    if (language == "pt") {
        out << "Consigo cadastrar varias cameras de uma vez, mas ainda preciso dos itens do lote.";
        if (expectedCount > 0) {
            out << "\nVoce me falou de " << expectedCount << " camera(s), entao pode mandar uma linha por camera.";
        }
        out << "\n\nSe varios campos forem iguais para todas, diga isso uma vez so e eu reaproveito no lote."
            << "\nExemplo:\n"
            << batchExampleBlock_(language);
        return out.str();
    }

    out << "I can register multiple cameras at once, but I still need the actual camera rows."
        << "\n\nIf several fields are the same for all cameras, say that once and I will reuse them across the batch."
        << "\nExample:\n"
        << batchExampleBlock_(language);
    return out.str();
}

std::string buildBatchPreviewAnswer_(
    const nlohmann::json& preview,
    const nlohmann::json& batchDraft,
    const std::string& language)
{
    const int expectedCount = batchDraft.value("expected_count", 0);
    const int parsedCount = static_cast<int>(batchItemCount_(batchDraft));
    const int readyCount = preview.value("ready_count", 0);
    const int incompleteCount = preview.value("incomplete_count", 0);

    std::ostringstream out;
    if (language == "pt") {
        out << "Organizei um preview para " << parsedCount << " camera(s)";
        if (expectedCount > 0) {
            out << " de um total esperado de " << expectedCount;
        }
        out << ".";

        if (expectedCount > parsedCount) {
            out << "\nAinda faltam " << (expectedCount - parsedCount)
                << " camera(s) para completar o lote informado.";
        }

        out << "\nProntas para registrar agora: " << readyCount << ".";
        if (incompleteCount > 0) {
            out << "\nAinda precisam de revisao: " << incompleteCount
                << ". O card abaixo mostra o que falta antes de registrar tudo de uma vez.";
        }
        else if (readyCount > 0) {
            out << "\nO card abaixo ja esta pronto para registrar todas de uma vez.";
        }
        else {
            out << "\nAinda nao ha cameras prontas para registrar. O card abaixo mostra o que precisa ser completado.";
        }
        return out.str();
    }

    out << "I organized a preview for " << parsedCount << " camera(s)";
    if (expectedCount > 0) {
        out << " out of an expected total of " << expectedCount;
    }
    out << ".";
    out << "\nReady to register now: " << readyCount << ".";
    if (incompleteCount > 0) {
        out << "\nStill need review: " << incompleteCount
            << ". The card below shows what is missing before registering everything together.";
    }
    return out.str();
}

nlohmann::json buildBatchWidgetMetadata_(
    const nlohmann::json& preview,
    const std::string& language,
    const std::string& targetClientId,
    int expectedCount)
{
    nlohmann::json metadata = {
        { "type", "camera_batch_registration_draft" },
        { "status", "awaiting_confirmation" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "preview", preview },
        { "target_client_id", targetClientId },
    };
    if (expectedCount > 0) {
        metadata["expected_count"] = expectedCount;
    }
    return metadata;
}

std::vector<std::string> batchCollectedFields_(const nlohmann::json& batchDraft)
{
    std::vector<std::string> collected;
    if (batchDraft.value("expected_count", 0) > 0) {
        collected.push_back("expected_count");
    }
    if (batchItemCount_(batchDraft) > 0) {
        collected.push_back("items");
    }
    const nlohmann::json sharedDefaults =
        batchDraft.value("shared_defaults", nlohmann::json::object());
    if (sharedDefaults.is_object() && !sharedDefaults.empty()) {
        collected.push_back("shared_defaults");
    }
    return collected;
}

std::vector<std::string> batchMissingSummary_(const nlohmann::json& preview)
{
    std::vector<std::string> missing;
    if (!preview.is_object()) {
        return missing;
    }
    const auto summary = preview.value("missing_field_summary", nlohmann::json::object());
    if (!summary.is_object()) {
        return missing;
    }
    for (auto it = summary.begin(); it != summary.end(); ++it) {
        if (it.value().is_number() && it.value().get<int>() > 0) {
            missing.push_back(it.key());
        }
    }
    return missing;
}

std::string createBatchTaskGoal_(const nlohmann::json& batchDraft, const std::string& language)
{
    const int expectedCount = batchDraft.value("expected_count", 0);
    if (language == "pt") {
        if (expectedCount > 0) {
            return "registrar " + std::to_string(expectedCount) + " cameras";
        }
        return "registrar varias cameras";
    }
    if (expectedCount > 0) {
        return "register " + std::to_string(expectedCount) + " cameras";
    }
    return "register multiple cameras";
}

std::string createBatchTaskSummary_(
    const nlohmann::json& preview,
    const std::string& language,
    bool completed)
{
    const int readyCount = preview.value("ready_count", 0);
    const int incompleteCount = preview.value("incomplete_count", 0);
    if (language == "pt") {
        if (completed) {
            return "Lote de cameras registrado";
        }
        std::ostringstream out;
        out << "Preview de lote com " << readyCount << " pronta(s)";
        if (incompleteCount > 0) {
            out << " e " << incompleteCount << " em revisao";
        }
        return out.str();
    }
    if (completed) {
        return "Camera batch registered";
    }
    std::ostringstream out;
    out << "Batch preview with " << readyCount << " ready";
    if (incompleteCount > 0) {
        out << " and " << incompleteCount << " needing review";
    }
    return out.str();
}

nlohmann::json buildTaskStateForBatchCollection_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& batchDraft,
    const nlohmann::json& preview,
    const std::string& answerPreview,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "create_cameras_batch",
            "camera",
            "create",
            "collecting_input",
            "awaiting_missing_fields",
            normalizeAssistantLanguageTag(language),
            createBatchTaskGoal_(batchDraft, language),
            createBatchTaskSummary_(preview, language, false),
            trimCopy_(answerPreview),
            batchMissingSummary_(preview),
            batchCollectedFields_(batchDraft),
            batchDraft,
            nlohmann::json::object(),
            nlohmann::json::object(),
        });
}

nlohmann::json buildTaskStateForBatchAwaitingConfirmation_(
    const nlohmann::json& conversationContext,
    const nlohmann::json& batchDraft,
    const nlohmann::json& preview,
    const std::string& answerPreview,
    const std::string& language)
{
    return upsertActiveOperationTask(
        conversationContext,
        OperationTaskDescriptor{
            "create_cameras_batch",
            "camera",
            "create",
            "awaiting_confirmation",
            "awaiting_user_confirmation",
            normalizeAssistantLanguageTag(language),
            createBatchTaskGoal_(batchDraft, language),
            createBatchTaskSummary_(preview, language, false),
            trimCopy_(answerPreview),
            {},
            batchCollectedFields_(batchDraft),
            batchDraft,
            nlohmann::json::object(),
            nlohmann::json::object({
                { "type", "camera_batch_registration_draft" },
                { "status", "awaiting_confirmation" },
                { "editable", false },
            }),
        });
}

HttpResponse previewBatchViaAgentEndpoint_(
    AgentCore& agent,
    const nlohmann::json& batchDraft,
    const std::string& language)
{
    nlohmann::json requestBody = {
        { "expected_count", batchDraft.value("expected_count", 0) },
        { "shared_defaults", batchDraft.value("shared_defaults", nlohmann::json::object()) },
        { "items", batchDraft.value("items", nlohmann::json::array()) },
        { "language", normalizeAssistantLanguageTag(language) },
    };

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/camera-batches/preview?client_id=" + agent.getClientId();
    return postJson(
        url,
        requestBody.dump(),
        agent.getExeToken(),
        {},
        15000);
}

} // namespace

SkillDefinition CreateCamerasBatchSkill::definition() const
{
    return {
        "create_cameras_batch",
        "Prepares a batch registration preview for multiple cameras and lets chat confirm the whole set at once.",
        true,
    };
}

SkillRunResult CreateCamerasBatchSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "create_cameras_batch";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string language = effectiveReplyLanguage_(selection, payload, conversationContext);

    nlohmann::json batchDraft = activeBatchDraft_(conversationContext);

    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);

    postChatProgress(
        agent,
        payload,
        buildBatchProgress_(language, "extracting_batch", 2, 2, 3),
        2500);

    const nlohmann::json extractedDraft =
        extractBatchDraft_(llm, payload, conversationContext, selection);
    batchDraft = mergeBatchDrafts_(batchDraft, extractedDraft);

    if (batchItemCount_(batchDraft) == 0) {
        result.answer = buildNeedBatchDetailsAnswer_(batchDraft, language);
        result.metadata["task_state"] = buildTaskStateForBatchCollection_(
            conversationContext,
            batchDraft,
            nlohmann::json::object(),
            result.answer,
            language);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        buildBatchProgress_(language, "finalizing", 3, 3, 3),
        2500);

    const HttpResponse response = previewBatchViaAgentEndpoint_(agent, batchDraft, language);
    if (!response.ok()) {
        const std::string errorMessage = parseErrorMessage_(response);
        if (language == "pt") {
            result.answer =
                "Consegui estruturar o lote, mas nao consegui montar o preview agora. "
                "Detalhe: " + errorMessage + ".";
        }
        else {
            result.answer =
                "I was able to structure the batch, but I could not prepare the preview right now. "
                "Detail: " + errorMessage + ".";
        }
        result.metadata["task_state"] = buildTaskStateForBatchCollection_(
            conversationContext,
            batchDraft,
            nlohmann::json::object(),
            result.answer,
            language);
        return result;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object() || !parsed.contains("preview") || !parsed["preview"].is_object()) {
        result.answer = language == "pt"
            ? "Consegui ler o lote, mas o preview voltou em um formato invalido."
            : "I was able to read the batch, but the preview came back in an invalid format.";
        result.metadata["task_state"] = buildTaskStateForBatchCollection_(
            conversationContext,
            batchDraft,
            nlohmann::json::object(),
            result.answer,
            language);
        return result;
    }

    const nlohmann::json preview = parsed["preview"];
    const int incompleteCount = preview.value("incomplete_count", 0);
    result.answer = buildBatchPreviewAnswer_(preview, batchDraft, language);
    result.metadata["message_metadata"] = buildBatchWidgetMetadata_(
        preview,
        language,
        agent.getClientId(),
        batchDraft.value("expected_count", 0));

    if (incompleteCount > 0 ||
        batchDraft.value("expected_count", 0) > static_cast<int>(batchItemCount_(batchDraft))) {
        result.metadata["task_state"] = buildTaskStateForBatchCollection_(
            conversationContext,
            batchDraft,
            preview,
            result.answer,
            language);
    }
    else {
        result.metadata["task_state"] = buildTaskStateForBatchAwaitingConfirmation_(
            conversationContext,
            batchDraft,
            preview,
            result.answer,
            language);
    }

    return result;
}

} // namespace chatv2

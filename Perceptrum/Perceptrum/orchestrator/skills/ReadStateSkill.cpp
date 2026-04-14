#include "ReadStateSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "../ChatModelConfig.h"
#include "../HttpUtils.h"
#include "../LocalLlmClient.h"
#include "../ProgressUtils.h"
#include "../../core/AgentCore.h"

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

bool containsAny_(const std::string& haystack, const std::vector<std::string>& needles)
{
    for (const auto& needle : needles) {
        if (!needle.empty() && haystack.find(needle) != std::string::npos) {
            return true;
        }
    }
    return false;
}

std::string progressLanguage_(const SkillSelection& selection, const nlohmann::json& payload)
{
    if (!selection.replyLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.replyLanguage);
    }
    if (payload.is_object() && payload.contains("app_language") && payload["app_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["app_language"].get<std::string>());
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
            if (parsed.contains("error") && parsed["error"].is_string()) {
                const std::string error = trimCopy_(parsed["error"].get<std::string>());
                if (!error.empty()) {
                    return error;
                }
            }
            if (parsed.contains("message") && parsed["message"].is_string()) {
                const std::string message = trimCopy_(parsed["message"].get<std::string>());
                if (!message.empty()) {
                    return message;
                }
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

std::string jsonStringOr_(
    const nlohmann::json& value,
    const char* key,
    const std::string& fallback = std::string())
{
    if (!value.is_object() || !value.contains(key) || !value[key].is_string()) {
        return fallback;
    }
    return value[key].get<std::string>();
}

std::string firstStringAtPaths_(
    const nlohmann::json& object,
    const std::vector<std::string>& keys)
{
    if (!object.is_object()) {
        return "";
    }

    for (const auto& key : keys) {
        if (object.contains(key) && object[key].is_string()) {
            const std::string value = trimCopy_(object[key].get<std::string>());
            if (!value.empty()) {
                return value;
            }
        }
    }

    return "";
}

std::string detectFocus_(const std::string& query)
{
    const std::string normalized = lowerAsciiCopy_(query);
    if (containsAny_(normalized, {
            "identity card", "identity cards", "id card", "id cards",
            "card de identidade", "cards de identidade", "identidade", "identidades",
            "crop", "crops", "portrait", "portraits", "rosto", "face"
        })) {
        return "identity_cards";
    }
    if (containsAny_(normalized, {
            "history", "historico", "ledger", "audit", "auditoria",
            "timeline", "yesterday", "ontem", "recent", "recently",
            "job run", "job runs", "step run", "step runs", "agent run", "agent runs"
        })) {
        return "history";
    }
    if (containsAny_(normalized, {
            "billing", "payment", "payments", "subscription", "tokens",
            "saldo", "cartao", "assinatura"
        })) {
        return "billing";
    }
    if (containsAny_(normalized, {
            "pair", "pairing", "pareado", "parear", "exe"
        })) {
        return "pairing";
    }
    if (containsAny_(normalized, {
            "api key", "api keys", "openai", "z.ai", "glm", "chave", "chaves"
        })) {
        return "api_keys";
    }
    if (containsAny_(normalized, {
            "email", "e-mail", "account", "profile", "usuario", "conta", "perfil"
        })) {
        return "account";
    }
    if (containsAny_(normalized, {
            "agent", "agents", "agente", "agentes"
        })) {
        return "agents";
    }
    if (containsAny_(normalized, {
            "job", "jobs", "workflow", "task", "tasks", "tarefa", "tarefas", "agendamento"
        })) {
        return "jobs";
    }
    if (containsAny_(normalized, {
            "camera", "cameras", "camara", "camaras", "feed", "stream", "ip", "ips"
        })) {
        return "cameras";
    }
    return "overview";
}

std::string boolLabel_(bool value, const char* trueLabel, const char* falseLabel)
{
    return value ? trueLabel : falseLabel;
}

std::string joinNames_(const nlohmann::json& items, const char* fieldName, std::size_t limit)
{
    if (!items.is_array() || items.empty()) {
        return "";
    }

    std::ostringstream out;
    std::size_t count = 0;
    for (const auto& item : items) {
        if (!item.is_object() || !item.contains(fieldName) || !item[fieldName].is_string()) {
            continue;
        }

        const std::string value = trimCopy_(item[fieldName].get<std::string>());
        if (value.empty()) {
            continue;
        }

        if (count > 0) {
            out << ", ";
        }
        out << value;
        ++count;
        if (count >= limit) {
            break;
        }
    }

    return out.str();
}

std::string clientIdFromPayload_(const nlohmann::json& payload, const AgentCore& agent)
{
    if (payload.is_object() &&
        payload.contains("client_id") &&
        payload["client_id"].is_string()) {
        const std::string clientId = trimCopy_(payload["client_id"].get<std::string>());
        if (!clientId.empty()) {
            return clientId;
        }
    }
    return agent.getClientId();
}

bool queryNeedsOperationalContext_(const std::string& query)
{
    const std::string normalized = lowerAsciiCopy_(query);

    if (containsAny_(normalized, {
            "identity card", "identity cards", "id card", "id cards",
            "card de identidade", "cards de identidade",
            "crop", "crops", "portrait", "portraits",
            "identity", "identidade", "identidades"
        })) {
        return true;
    }

    if (containsAny_(normalized, {
            "history", "historico", "ledger", "audit", "auditoria",
            "timeline", "ontem", "yesterday", "recent", "recently",
            "job run", "job runs", "step run", "step runs",
            "agent run", "agent runs", "camera session", "camera sessions",
            "session", "sessions", "connectivity", "conectividade"
        })) {
        return true;
    }

    const bool mentionsOperationalEntity = containsAny_(normalized, {
        "job", "jobs", "workflow", "task", "tasks", "tarefa", "tarefas",
        "step", "steps", "etapa", "etapas", "agent", "agents", "agente", "agentes"
    });
    const bool asksForRead = containsAny_(normalized, {
        "show", "list", "listar", "mostrar", "mostre", "traga", "bring",
        "which", "quais", "how many", "quantos", "quantas",
        "count", "conte", "tell me", "me diga", "me traga"
    });
    const bool hasTimeWindow = containsAny_(normalized, {
        "today", "hoje", "yesterday", "ontem", "last", "ultimo", "ultimos",
        "recent", "recently", "between", "entre", "during", "durante",
        "hour", "hours", "hora", "horas", "minute", "minutes", "minuto", "minutos"
    });

    return mentionsOperationalEntity && (asksForRead || hasTimeWindow);
}

nlohmann::json fetchDetailedCameraInventory_(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string clientId = clientIdFromPayload_(payload, agent);
    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/cameras?client_id=" + clientId;
    const HttpResponse response = getUrl(url, agent.getExeToken(), {}, 6000);
    if (!response.ok()) {
        return nlohmann::json::array();
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    return parsed.is_array() ? parsed : nlohmann::json::array();
}

nlohmann::json fetchOperationalContext_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const std::string& replyLanguage,
    std::string* outError = nullptr)
{
    if (outError != nullptr) {
        outError->clear();
    }
    if (!payload.is_object()) {
        return nlohmann::json::object();
    }

    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) {
        if (outError != nullptr) {
            *outError = "missing_chat_session_id";
        }
        return nlohmann::json::object();
    }

    nlohmann::json request = {
        { "chat_session_id", chatSessionId },
        { "query", payload.value("query", std::string()) },
        { "reply_language", replyLanguage },
    };
    const int beforeMessageId = payload.value("context_before_message_id", 0);
    if (beforeMessageId > 0) {
        request["context_before_message_id"] = beforeMessageId;
    }
    if (payload.contains("timezone_iana") && payload["timezone_iana"].is_string()) {
        request["timezone"] = payload["timezone_iana"].get<std::string>();
    }
    else if (payload.contains("timezone") && payload["timezone"].is_string()) {
        request["timezone"] = payload["timezone"].get<std::string>();
    }

    const std::string url =
        agent.getBackendBaseUrl() +
        "/api/agent/reports/build-context?client_id=" + clientIdFromPayload_(payload, agent);
    const HttpResponse response = postJson(
        url,
        request.dump(),
        agent.getExeToken(),
        {},
        20000);

    if (!response.ok()) {
        if (outError != nullptr) {
            *outError = parseErrorMessage_(response);
        }
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        if (outError != nullptr) {
            *outError = "invalid_operational_context";
        }
        return nlohmann::json::object();
    }
    return parsed;
}

bool jsonBoolAt_(const nlohmann::json& object, const char* key, bool fallback = false)
{
    if (!object.is_object() || key == nullptr || !object.contains(key)) {
        return fallback;
    }
    const auto& value = object[key];
    if (value.is_boolean()) {
        return value.get<bool>();
    }
    if (value.is_number_integer()) {
        return value.get<int>() != 0;
    }
    if (value.is_string()) {
        const std::string normalized = lowerAsciiCopy_(trimCopy_(value.get<std::string>()));
        if (normalized == "true" || normalized == "1" || normalized == "yes") {
            return true;
        }
        if (normalized == "false" || normalized == "0" || normalized == "no") {
            return false;
        }
    }
    return fallback;
}

bool selectionRouteHintBool_(
    const SkillSelection& selection,
    const char* key,
    bool fallback = false)
{
    if (!selection.routeHints.is_object()) {
        return fallback;
    }
    return jsonBoolAt_(selection.routeHints, key, fallback);
}

bool shouldUseOperationalQueryPlanner_(
    const SkillSelection& selection,
    const nlohmann::json& payload,
    const std::string& query)
{
    if (jsonBoolAt_(payload, "disable_operational_query_planner", false)) {
        return false;
    }
    if (jsonBoolAt_(payload, "enable_operational_query_planner", false)) {
        return true;
    }
    if (selection.plannerMode == "operational_query") {
        return true;
    }
    if (selection.intentFamily == "read_operational" &&
        queryNeedsOperationalContext_(query)) {
        return true;
    }
    return selectionRouteHintBool_(selection, "use_operational_query_planner", false);
}

nlohmann::json fetchOperationalQueryExecution_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const std::string& replyLanguage,
    std::string* outError = nullptr)
{
    if (outError != nullptr) {
        outError->clear();
    }
    if (!payload.is_object()) {
        return nlohmann::json::object();
    }

    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) {
        if (outError != nullptr) {
            *outError = "missing_chat_session_id";
        }
        return nlohmann::json::object();
    }

    nlohmann::json request = {
        { "chat_session_id", chatSessionId },
        { "query", payload.value("query", std::string()) },
        { "reply_language", replyLanguage },
        { "intent_family", "read_operational" },
        { "preferred_skill", "read_state" },
    };
    const int beforeMessageId = payload.value("context_before_message_id", 0);
    if (beforeMessageId > 0) {
        request["context_before_message_id"] = beforeMessageId;
    }
    if (payload.contains("timezone_iana") && payload["timezone_iana"].is_string()) {
        request["timezone"] = payload["timezone_iana"].get<std::string>();
    }
    else if (payload.contains("timezone") && payload["timezone"].is_string()) {
        request["timezone"] = payload["timezone"].get<std::string>();
    }

    const std::string url =
        agent.getBackendBaseUrl() +
        "/api/agent/query/execute?client_id=" + clientIdFromPayload_(payload, agent);
    const HttpResponse response = postJson(
        url,
        request.dump(),
        agent.getExeToken(),
        {},
        20000);

    if (!response.ok()) {
        if (outError != nullptr) {
            *outError = parseErrorMessage_(response);
        }
        return nlohmann::json::object();
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        if (outError != nullptr) {
            *outError = "invalid_operational_query_execution";
        }
        return nlohmann::json::object();
    }
    return parsed;
}

nlohmann::json truncateArray_(const nlohmann::json& value, std::size_t maxItems)
{
    if (!value.is_array() || value.size() <= maxItems) {
        return value;
    }

    nlohmann::json truncated = nlohmann::json::array();
    for (std::size_t index = 0; index < value.size() && index < maxItems; ++index) {
        truncated.push_back(value[index]);
    }
    return truncated;
}

void truncateObjectArrayField_(
    nlohmann::json& object,
    const char* key,
    std::size_t maxItems)
{
    if (!object.is_object() || key == nullptr || !object.contains(key) || !object[key].is_array()) {
        return;
    }
    object[key] = truncateArray_(object[key], maxItems);
}

nlohmann::json buildStateForAnalysis_(
    nlohmann::json state,
    const nlohmann::json& cameraInventory)
{
    if (!state.is_object()) {
        state = nlohmann::json::object();
    }

    const auto truncateStateItems = [&](const char* containerKey, std::size_t maxItems) {
        if (!state.contains(containerKey) || !state[containerKey].is_object()) {
            return;
        }
        auto& container = state[containerKey];
        if (container.contains("items") && container["items"].is_array()) {
            const std::size_t originalSize = container["items"].size();
            container["items"] = truncateArray_(container["items"], maxItems);
            container["truncated"] = originalSize > maxItems;
        }
    };

    truncateStateItems("cameras", 120);
    truncateStateItems("camera_agents", 120);
    truncateStateItems("jobs", 120);
    truncateStateItems("job_agents", 120);

    state["camera_inventory"] = nlohmann::json::object({
        { "count", cameraInventory.is_array() ? static_cast<int>(cameraInventory.size()) : 0 },
        { "truncated", cameraInventory.is_array() && cameraInventory.size() > 180 },
        { "items", truncateArray_(cameraInventory, 180) },
    });

    return state;
}

nlohmann::json buildOperationalContextForAnalysis_(nlohmann::json context)
{
    if (!context.is_object()) {
        return nlohmann::json::object();
    }

    context.erase("report_id");
    context.erase("chat_discussion");
    context.erase("evidence_candidates");

    if (context.contains("top_findings_seed") && context["top_findings_seed"].is_array()) {
        context["top_findings_seed"] = truncateArray_(context["top_findings_seed"], 8);
    }
    if (context.contains("limitations") && context["limitations"].is_array()) {
        context["limitations"] = truncateArray_(context["limitations"], 8);
    }

    if (context.contains("current_state") && context["current_state"].is_object()) {
        auto& currentState = context["current_state"];
        truncateObjectArrayField_(currentState, "camera_snapshots", 12);
        truncateObjectArrayField_(currentState, "running_jobs", 12);
        truncateObjectArrayField_(currentState, "step_snapshots", 16);
        truncateObjectArrayField_(currentState, "active_camera_sessions", 8);
        truncateObjectArrayField_(currentState, "active_job_runs", 8);
    }

    if (context.contains("history") && context["history"].is_object()) {
        auto& history = context["history"];
        truncateObjectArrayField_(history, "recent_events", 20);
        truncateObjectArrayField_(history, "recent_commands", 20);
        truncateObjectArrayField_(history, "recent_detections", 16);
        truncateObjectArrayField_(history, "recent_alerts", 20);
        truncateObjectArrayField_(history, "error_logs", 16);
        truncateObjectArrayField_(history, "recent_job_runs", 20);
        truncateObjectArrayField_(history, "recent_step_runs", 20);
        truncateObjectArrayField_(history, "recent_agent_runs", 20);
        truncateObjectArrayField_(history, "recent_camera_sessions", 12);
        truncateObjectArrayField_(history, "recent_identity_cards", 20);
        truncateObjectArrayField_(history, "recent_connectivity_incidents", 12);
    }

    if (context.contains("comparisons") && context["comparisons"].is_object()) {
        auto& comparisons = context["comparisons"];
        truncateObjectArrayField_(comparisons, "cameras", 12);
        truncateObjectArrayField_(comparisons, "jobs", 12);
        truncateObjectArrayField_(comparisons, "agents", 12);
        truncateObjectArrayField_(comparisons, "steps", 12);
        truncateObjectArrayField_(comparisons, "alerts_by_camera", 12);
        truncateObjectArrayField_(comparisons, "alerts_by_job", 12);
        truncateObjectArrayField_(comparisons, "sessions_by_camera", 12);
        truncateObjectArrayField_(comparisons, "identity_cards_by_camera", 12);
    }

    if (context.contains("details") && context["details"].is_object()) {
        auto& details = context["details"];
        truncateObjectArrayField_(details, "job_runs", 20);
        truncateObjectArrayField_(details, "step_runs", 24);
        truncateObjectArrayField_(details, "agent_runs", 24);
        truncateObjectArrayField_(details, "camera_agent_runs", 24);
        truncateObjectArrayField_(details, "step_results", 20);
        truncateObjectArrayField_(details, "alerts", 20);
        truncateObjectArrayField_(details, "camera_sessions", 12);
        truncateObjectArrayField_(details, "connectivity_incidents", 12);
        truncateObjectArrayField_(details, "identity_cards", 24);
        truncateObjectArrayField_(details, "structured_errors", 16);
        truncateObjectArrayField_(details, "response_timeline", 16);
        truncateObjectArrayField_(details, "no_positive_detection_reasons", 8);
    }

    return context;
}

nlohmann::json extractLiveState_(const nlohmann::json& state)
{
    if (state.is_object() &&
        state.contains("live_state") &&
        state["live_state"].is_object()) {
        return state["live_state"];
    }
    return state;
}

bool isDigitsOnly_(const std::string& value)
{
    return !value.empty() &&
        std::all_of(value.begin(), value.end(), [](unsigned char ch) {
            return std::isdigit(ch) != 0;
        });
}

std::vector<std::string> splitIpv4Candidate_(const std::string& value)
{
    std::vector<std::string> octets;
    std::stringstream stream(trimCopy_(value));
    std::string octet;
    while (std::getline(stream, octet, '.')) {
        octets.push_back(octet);
    }
    return octets;
}

std::string normalizeIpv4Address_(const std::string& value)
{
    const std::string trimmed = trimCopy_(value);
    const std::vector<std::string> octets = splitIpv4Candidate_(trimmed);
    if (octets.size() != 4) {
        return trimmed;
    }

    std::vector<int> parsed;
    parsed.reserve(4);
    for (const auto& octet : octets) {
        if (!isDigitsOnly_(octet)) {
            return trimmed;
        }
        try {
            const int parsedOctet = std::stoi(octet);
            if (parsedOctet < 0 || parsedOctet > 255) {
                return trimmed;
            }
            parsed.push_back(parsedOctet);
        }
        catch (...) {
            return trimmed;
        }
    }

    std::ostringstream out;
    for (std::size_t index = 0; index < parsed.size(); ++index) {
        if (index > 0) {
            out << '.';
        }
        out << parsed[index];
    }
    return out.str();
}

bool hasLeadingZeroLastOctet_(const std::string& value)
{
    const std::vector<std::string> octets = splitIpv4Candidate_(value);
    if (octets.size() != 4) {
        return false;
    }

    const std::string& lastOctet = octets.back();
    if (lastOctet.size() < 2 || lastOctet.front() != '0' || !isDigitsOnly_(lastOctet)) {
        return false;
    }

    try {
        const int parsedLastOctet = std::stoi(lastOctet);
        return parsedLastOctet >= 1 && parsedLastOctet <= 9;
    }
    catch (...) {
        return false;
    }
}

bool queryRequestsLeadingZeroIpAudit_(const std::string& query)
{
    const std::string normalized = lowerAsciiCopy_(query);
    if (!containsAny_(normalized, { "ip", "ips" })) {
        return false;
    }

    if (containsAny_(normalized, {
            ".01", ".02", ".03", ".04", ".05", ".06", ".07", ".08", ".09"
        })) {
        return true;
    }

    return containsAny_(normalized, {
        "leading zero", "leading zeros", "zero a esquerda", "ip errado",
        "ip incorreto", "malformed ip", "incorrect ip", "wrong ip",
        "terminacao de ip", "final do ip", "ip ending", "ip suffix",
        "remove o zero", "remover o zero", "remove leading zero"
    });
}

std::string cameraDisplayName_(const nlohmann::json& camera)
{
    const std::string name = firstStringAtPaths_(camera, { "name", "camera_name" });
    if (!name.empty()) {
        return name;
    }

    if (camera.is_object() && camera.contains("id")) {
        try {
            return "Camera " + std::to_string(camera["id"].get<int>());
        }
        catch (...) {
        }
    }

    return "Unnamed camera";
}

std::string buildLeadingZeroIpAuditAnswer_(
    const nlohmann::json& cameraInventory,
    const std::string& language)
{
    const bool isPt = normalizeAssistantLanguageTag(language) == "pt";

    if (!cameraInventory.is_array()) {
        return isPt
            ? "Nao consegui inspecionar o inventario detalhado das cameras agora."
            : "I could not inspect the detailed camera inventory right now.";
    }

    nlohmann::json matches = nlohmann::json::array();
    for (const auto& camera : cameraInventory) {
        if (!camera.is_object()) {
            continue;
        }

        const std::string ipAddress = firstStringAtPaths_(camera, { "ip_address", "ip" });
        if (!hasLeadingZeroLastOctet_(ipAddress)) {
            continue;
        }

        nlohmann::json match = nlohmann::json::object({
            { "id", camera.value("id", 0) },
            { "name", cameraDisplayName_(camera) },
            { "ip_address", ipAddress },
            { "normalized_ip_address", normalizeIpv4Address_(ipAddress) },
            { "description", firstStringAtPaths_(camera, { "scene_description", "description" }) },
        });
        matches.push_back(match);
    }

    if (matches.empty()) {
        return isPt
            ? "Nao encontrei cameras cadastradas cujo ultimo octeto IPv4 ainda mantenha zero a esquerda entre 01 e 09."
            : "I did not find registered cameras whose last IPv4 octet still keeps a leading zero between 01 and 09.";
    }

    std::ostringstream out;
    if (isPt) {
        out << "## Cameras com IP fora do formato canonico\n\n";
        out << "Encontrei " << matches.size()
            << " camera(s) cujo ultimo octeto IPv4 ainda mantem zero a esquerda.\n";
    }
    else {
        out << "## Cameras with non-canonical IP endings\n\n";
        out << "I found " << matches.size()
            << " camera(s) whose last IPv4 octet still keeps a leading zero.\n";
    }

    const std::size_t maxLines = 40;
    const std::size_t lineCount = (std::min)(matches.size(), maxLines);
    for (std::size_t index = 0; index < lineCount; ++index) {
        const auto& match = matches[index];
        out << "\n- " << jsonStringOr_(match, "name");
        if (match.contains("id") && match["id"].is_number_integer() && match["id"].get<int>() > 0) {
            out << " (ID " << match["id"].get<int>() << ")";
        }
        out << ": `" << jsonStringOr_(match, "ip_address") << "`";
        const std::string normalizedIp = jsonStringOr_(match, "normalized_ip_address");
        if (!normalizedIp.empty() && normalizedIp != jsonStringOr_(match, "ip_address")) {
            out << " -> `" << normalizedIp << "`";
        }
        const std::string description = jsonStringOr_(match, "description");
        if (!description.empty()) {
            out << " | " << description;
        }
    }

    if (matches.size() > maxLines) {
        if (isPt) {
            out << "\n\nApenas os primeiros " << maxLines << " resultados foram listados aqui.";
        }
        else {
            out << "\n\nOnly the first " << maxLines << " matches are listed here.";
        }
    }

    return out.str();
}

std::string buildOverviewAnswer_(const nlohmann::json& state)
{
    const nlohmann::json liveState = extractLiveState_(state);
    const auto cameras = liveState.value("cameras", nlohmann::json::object());
    const auto jobs = liveState.value("jobs", nlohmann::json::object());
    const auto cameraAgents = liveState.value("camera_agents", nlohmann::json::object());
    const auto jobAgents = liveState.value("job_agents", nlohmann::json::object());
    const auto billing = liveState.value("billing", nlohmann::json::object());
    const auto pairing = liveState.value("pairing", nlohmann::json::object());
    const auto apiKeys = liveState.value("api_keys", nlohmann::json::object());

    const auto tokenBalance = billing.value("token_balance", nlohmann::json::object());
    const bool pairingConnected = lowerAsciiCopy_(jsonStringOr_(pairing, "status")) == "connected";

    std::ostringstream out;
    out
        << "## Current state\n\n"
        << "- **Cameras**: " << cameras.value("count", 0) << " registered, "
        << cameras.value("online_count", 0) << " online, "
        << cameras.value("service_running_count", 0) << " with service running.\n"
        << "- **Jobs**: " << jobs.value("count", 0) << " configured, "
        << jobs.value("running_count", 0) << " running right now.\n"
        << "- **Camera agents**: " << cameraAgents.value("count", 0) << " total, "
        << cameraAgents.value("enabled_count", 0) << " enabled.\n"
        << "- **Job agents**: " << jobAgents.value("count", 0) << " total, "
        << jobAgents.value("active_count", 0) << " active.\n"
        << "- **Pairing**: " << boolLabel_(pairingConnected, "connected", "disconnected") << ".\n"
        << "- **Billing**: subscription "
        << boolLabel_(billing.value("has_active_subscription", false), "active", "inactive")
        << ", token balance " << tokenBalance.value("balance", 0.0)
        << ", " << billing.value("active_cards_count", 0) << " saved card(s).\n"
        << "- **Keys**: OpenAI "
        << boolLabel_(apiKeys.value("openai_configured", false), "configured", "not configured")
        << ", Z.ai "
        << boolLabel_(apiKeys.value("zai_configured", false), "configured", "not configured")
        << ".";
    return out.str();
}

std::string buildAccountAnswer_(const nlohmann::json& state)
{
    const nlohmann::json liveState = extractLiveState_(state);
    const auto account = liveState.value("account", nlohmann::json::object());
    const auto profile = liveState.value("profile", nlohmann::json::object());

    const std::string email = firstStringAtPaths_(
        account,
        { "email", "user_email", "registered_email" }).empty()
        ? firstStringAtPaths_(profile, { "email", "user_email", "registered_email" })
        : firstStringAtPaths_(account, { "email", "user_email", "registered_email" });
    const std::string displayName = firstStringAtPaths_(
        profile,
        { "display_name", "name", "full_name" }).empty()
        ? firstStringAtPaths_(account, { "display_name", "name", "full_name" })
        : firstStringAtPaths_(profile, { "display_name", "name", "full_name" });

    std::ostringstream out;
    out << "## Account\n\n";
    if (!email.empty()) {
        out << "- Registered email: `" << email << "`.\n";
    }
    else {
        out << "- Registered email: not available in the current state payload.\n";
    }
    if (!displayName.empty()) {
        out << "- Display name: `" << displayName << "`.\n";
    }
    out << "- If you need more account details, I can inspect the broader state response next.";
    return out.str();
}

std::string buildFocusedAnswer_(
    const nlohmann::json& state,
    const std::string& focus,
    const nlohmann::json& cameraInventory)
{
    const nlohmann::json liveState = extractLiveState_(state);
    const auto operational =
        state.is_object() && state.contains("operational_context") && state["operational_context"].is_object()
            ? state["operational_context"]
            : nlohmann::json::object();
    const auto cameras = liveState.value("cameras", nlohmann::json::object());
    const auto jobs = liveState.value("jobs", nlohmann::json::object());
    const auto cameraAgents = liveState.value("camera_agents", nlohmann::json::object());
    const auto jobAgents = liveState.value("job_agents", nlohmann::json::object());
    const auto billing = liveState.value("billing", nlohmann::json::object());
    const auto pairing = liveState.value("pairing", nlohmann::json::object());
    const auto apiKeys = liveState.value("api_keys", nlohmann::json::object());

    std::ostringstream out;

    if (focus == "identity_cards") {
        const auto history = operational.value("history", nlohmann::json::object());
        const auto details = operational.value("details", nlohmann::json::object());
        const nlohmann::json cards =
            details.contains("identity_cards") && details["identity_cards"].is_array()
                ? details["identity_cards"]
                : history.value("recent_identity_cards", nlohmann::json::array());
        const std::string cardNames = joinNames_(cards, "display_name", 5);

        out << "## Identity cards\n\n"
            << "- Persisted cards in the current operational window: "
            << (cards.is_array() ? cards.size() : 0) << ".";
        if (!cardNames.empty()) {
            out << "\n- Sample cards: " << cardNames << ".";
        }
        if (cards.is_array() && !cards.empty()) {
            const auto& first = cards[0];
            if (first.is_object() && !firstStringAtPaths_(first, { "crop_url" }).empty()) {
                out << "\n- Crop evidence is available in the operational ledger.";
            }
        }
        return out.str();
    }

    if (focus == "history" && !operational.empty()) {
        const auto scope = operational.value("scope", nlohmann::json::object());
        const auto stats = operational.value("stats", nlohmann::json::object());
        out << "## Operational history\n\n"
            << "- Window: " << jsonStringOr_(scope, "label", "current operational window") << ".\n"
            << "- Job runs: " << stats.value("structured_job_runs_in_window", 0) << ".\n"
            << "- Step runs: " << stats.value("structured_step_runs_in_window", 0) << ".\n"
            << "- Agent runs: " << stats.value("structured_agent_runs_in_window", 0) << ".\n"
            << "- Camera sessions: " << stats.value("camera_sessions_in_window", 0) << ".\n"
            << "- Identity cards: " << stats.value("identity_cards_in_window", 0) << ".";
        return out.str();
    }

    if (focus == "cameras") {
        const std::string cameraNames = joinNames_(
            cameraInventory.is_array() && !cameraInventory.empty()
                ? cameraInventory
                : cameras.value("items", nlohmann::json::array()),
            "name",
            5);
        out << "## Cameras\n\n"
            << "- Registered: " << cameras.value("count", 0) << ".\n"
            << "- Online: " << cameras.value("online_count", 0) << ".\n"
            << "- With service running: " << cameras.value("service_running_count", 0) << ".";
        if (!cameraNames.empty()) {
            out << "\n- Sample names: " << cameraNames << ".";
        }
        return out.str();
    }

    if (focus == "jobs") {
        const std::string jobNames = joinNames_(jobs.value("items", nlohmann::json::array()), "name", 5);
        out << "## Jobs\n\n"
            << "- Configured: " << jobs.value("count", 0) << ".\n"
            << "- Running right now: " << jobs.value("running_count", 0) << ".";
        if (!jobNames.empty()) {
            out << "\n- Sample jobs: " << jobNames << ".";
        }
        return out.str();
    }

    if (focus == "agents") {
        out << "## Agents\n\n"
            << "- Camera agents: " << cameraAgents.value("count", 0) << " total, "
            << cameraAgents.value("enabled_count", 0) << " enabled.\n"
            << "- Job agents: " << jobAgents.value("count", 0) << " total, "
            << jobAgents.value("active_count", 0) << " active.";
        return out.str();
    }

    if (focus == "billing") {
        const auto tokenBalance = billing.value("token_balance", nlohmann::json::object());
        out << "## Billing right now\n\n"
            << "- Subscription: "
            << boolLabel_(billing.value("has_active_subscription", false), "active", "inactive")
            << ".\n"
            << "- Saved cards: " << billing.value("active_cards_count", 0) << ".\n"
            << "- Token balance: " << tokenBalance.value("balance", 0.0) << ".\n"
            << "- Chat access: "
            << boolLabel_(billing.value("chat_access", false), "available", "blocked")
            << ".";
        return out.str();
    }

    if (focus == "pairing") {
        out << "## Pairing right now\n\n"
            << "- Status: "
            << (lowerAsciiCopy_(jsonStringOr_(pairing, "status")) == "connected"
                ? "connected"
                : "not connected")
            << ".\n"
            << "- Client ID: `" << jsonStringOr_(pairing, "client_id") << "`.\n"
            << "- EXE ID: `" << jsonStringOr_(pairing, "exe_id") << "`.\n"
            << "- Timezone: `" << jsonStringOr_(pairing, "timezone_iana") << "`.";
        return out.str();
    }

    if (focus == "api_keys") {
        out << "## API keys\n\n"
            << "- OpenAI: "
            << boolLabel_(apiKeys.value("openai_configured", false), "configured", "not configured")
            << ".\n"
            << "- Z.ai: "
            << boolLabel_(apiKeys.value("zai_configured", false), "configured", "not configured")
            << ".";
        return out.str();
    }

    if (focus == "account") {
        return buildAccountAnswer_(state);
    }

    return buildOverviewAnswer_(state);
}

std::string buildStateAnalysisSystemPrompt_()
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You answer questions about the current app state and recent operational history for the desktop assistant.\n"
        << "Use only current_state from the user prompt.\n"
        << "When current_state.live_state is present, it contains the live app configuration and runtime summary.\n"
        << "live_state.camera_inventory.items contains detailed camera fields such as ip_address, manufacturer, connection_method, channel, subtype, scene_description, and service status.\n"
        << "live_state.jobs.items, live_state.camera_agents.items, and live_state.job_agents.items contain the live job and agent records available right now.\n"
        << "When current_state.operational_context is present, it contains time-windowed app/database history for the current request.\n"
        << "operational_context.scope describes the analyzed window, and operational_context.resolved_entities maps the user's words to cameras, jobs, steps, and agents.\n"
        << "operational_context.history contains recent job runs, step runs, agent runs, camera sessions, alerts, identity cards, and connectivity incidents.\n"
        << "operational_context.details.identity_cards contains the richest persisted identity-card rows, including crop_url, crop_storage_key, job_run_id, step_run_id, agent_run_id, resolved_identity, and card when those fields exist.\n"
        << "For questions about yesterday, historical activity, persisted runs, identity cards, crops, or operational linkage, prefer operational_context first.\n"
        << "For questions about current inventory, configuration, balances, or live enablement, prefer live_state first.\n"
        << "If the user asks which items match a condition, filter the arrays and list only the matching items.\n"
        << "If the user asks how many match, give the count first.\n"
        << "If nothing matches, say that explicitly.\n"
        << "If a requested field is missing from both live_state and operational_context, say that the current app state does not expose it.\n"
        << "Never invent cameras, jobs, agents, identity cards, runs, or settings.\n"
        << "Never mention JSON, payloads, routers, endpoints, or internal tools.\n"
        << "Keep the answer concise, factual, and user-facing.\n";
    return out.str();
}

std::string analyzeStateWithLlm_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const std::string& focus,
    const std::string& query,
    const nlohmann::json& stateForAnalysis)
{
    if (!llm.isConfigured() || !stateForAnalysis.is_object()) {
        return "";
    }

    nlohmann::json promptPayload = {
        { "reply_language", progressLanguage_(selection, payload) },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "focus", focus },
        { "user_query", query },
        { "current_state", stateForAnalysis },
    };

    const auto outcome = llm.completeText(
        "analyzeReadState",
        buildStateAnalysisSystemPrompt_(),
        promptPayload.dump(2),
        0.0,
        980,
        20000,
        1,
        false);

    return outcome.ok ? trimCopy_(outcome.content) : std::string();
}

std::string buildOperationalContextFailureAnswer_(
    const std::string& language,
    const std::string& error)
{
    const std::string normalizedLanguage = normalizeAssistantLanguageTag(language);
    if (normalizedLanguage == "pt") {
        if (!error.empty()) {
            return "Consegui ler o estado atual, mas nao consegui carregar o historico operacional completo agora. Detalhe: " + error + ".";
        }
        return "Consegui ler o estado atual, mas nao consegui carregar o historico operacional completo agora.";
    }

    if (!error.empty()) {
        return "I could read the live app state, but I could not load the full operational history right now. Detail: " + error + ".";
    }
    return "I could read the live app state, but I could not load the full operational history right now.";
}

} // namespace

SkillDefinition ReadStateSkill::definition() const
{
    return SkillDefinition{
        "read_state",
        "Reads live state plus recent operational history, runs, identity cards, balances, and configs.",
        true,
    };
}

SkillRunResult ReadStateSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.skillName = "read_state";

    const std::string query =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string focus = detectFocus_(query);
    const std::string progressLanguage = progressLanguage_(selection, payload);

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "read_state", "loading_state", 2, 2, 3));
    pauseForProgressVisibility();

    const nlohmann::json cameraInventory = fetchDetailedCameraInventory_(agent, payload);
    const bool wantsLeadingZeroIpAudit = queryRequestsLeadingZeroIpAudit_(query);
    const bool hasDetailedCameraInventory =
        cameraInventory.is_array() && !cameraInventory.empty();
    const bool wantsOperationalContext = queryNeedsOperationalContext_(query);
    const bool wantsOperationalPlanner =
        shouldUseOperationalQueryPlanner_(selection, payload, query);

    if (wantsLeadingZeroIpAudit && hasDetailedCameraInventory) {
        result.status = SkillExecutionStatus::Completed;
        result.answer = buildLeadingZeroIpAuditAnswer_(cameraInventory, progressLanguage);
        result.metadata["focus"] = focus;
        result.metadata["camera_inventory_count"] =
            static_cast<int>(cameraInventory.size());
        result.metadata["reply_language"] = selection.replyLanguage.empty()
            ? nlohmann::json(nullptr)
            : nlohmann::json(selection.replyLanguage);
        postChatProgress(
            agent,
            payload,
            makeProgressUpdate(progressLanguage, "read_state", "finalizing", 3, 3, 3));
        return result;
    }

    std::string operationalQueryError;
    nlohmann::json operationalQueryExecution = nlohmann::json::object();
    if (wantsOperationalPlanner) {
        operationalQueryExecution = fetchOperationalQueryExecution_(
            agent,
            payload,
            progressLanguage,
            &operationalQueryError);
    }
    const bool hasOperationalQueryExecution =
        operationalQueryExecution.is_object() &&
        operationalQueryExecution.value("ok", false) &&
        operationalQueryExecution.contains("execution") &&
        operationalQueryExecution["execution"].is_object();
    if (hasOperationalQueryExecution) {
        const nlohmann::json execution = operationalQueryExecution["execution"];
        const std::string draftAnswer = jsonStringOr_(execution, "draft_answer");
        if (!draftAnswer.empty()) {
            result.status = SkillExecutionStatus::Completed;
            result.answer = draftAnswer;
            result.metadata["focus"] = focus;
            result.metadata["planner_mode"] = "operational_query";
            result.metadata["planner_execution"] = execution;
            if (operationalQueryExecution.contains("plan") && operationalQueryExecution["plan"].is_object()) {
                result.metadata["query_plan"] = operationalQueryExecution["plan"];
            }
            if (operationalQueryExecution.contains("semantic_plan") &&
                operationalQueryExecution["semantic_plan"].is_object()) {
                result.metadata["semantic_plan"] = operationalQueryExecution["semantic_plan"];
            }
            if (operationalQueryExecution.contains("semantic_shadow") &&
                operationalQueryExecution["semantic_shadow"].is_object()) {
                result.metadata["semantic_shadow"] = operationalQueryExecution["semantic_shadow"];
            }
            result.metadata["camera_inventory_count"] =
                cameraInventory.is_array() ? static_cast<int>(cameraInventory.size()) : 0;
            result.metadata["reply_language"] = selection.replyLanguage.empty()
                ? nlohmann::json(nullptr)
                : nlohmann::json(selection.replyLanguage);
            postChatProgress(
                agent,
                payload,
                makeProgressUpdate(progressLanguage, "read_state", "finalizing", 3, 3, 3));
            return result;
        }
    }
    else if (wantsOperationalPlanner) {
        const std::string effectiveOperationalQueryError =
            operationalQueryError.empty()
                ? std::string("operational_query_unavailable")
                : operationalQueryError;
        result.status = SkillExecutionStatus::Completed;
        result.answer = buildOperationalContextFailureAnswer_(
            progressLanguage,
            effectiveOperationalQueryError);
        result.metadata["focus"] = focus;
        result.metadata["planner_mode"] = "operational_query";
        result.metadata["operational_query_failed"] = true;
        result.metadata["operational_query_error"] = effectiveOperationalQueryError;
        result.metadata["camera_inventory_count"] =
            cameraInventory.is_array() ? static_cast<int>(cameraInventory.size()) : 0;
        result.metadata["reply_language"] = selection.replyLanguage.empty()
            ? nlohmann::json(nullptr)
            : nlohmann::json(selection.replyLanguage);
        postChatProgress(
            agent,
            payload,
            makeProgressUpdate(progressLanguage, "read_state", "finalizing", 3, 3, 3));
        return result;
    }

    std::string operationalContextError;
    nlohmann::json operationalContext = nlohmann::json::object();
    if (wantsOperationalContext) {
        operationalContext = fetchOperationalContext_(
            agent,
            payload,
            progressLanguage,
            &operationalContextError);
    }

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/orchestrator/state?client_id=" + agent.getClientId();
    const HttpResponse response = getUrl(url, agent.getExeToken(), {}, 6000);
    const bool hasOperationalContext =
        operationalContext.is_object() && !operationalContext.empty();
    nlohmann::json state = nlohmann::json::object();
    if (response.ok()) {
        state = nlohmann::json::parse(response.body, nullptr, false);
        if (!state.is_object()) {
            if (!hasOperationalContext) {
                result.status = SkillExecutionStatus::Failed;
                result.error = "invalid_state_payload";
                result.answer = "I received an invalid payload while trying to read the current app state.";
                return result;
            }
            state = nlohmann::json::object();
            result.metadata["live_state_error"] = "invalid_state_payload";
        }
    }
    else if (!hasOperationalContext) {
        result.status = SkillExecutionStatus::Failed;
        result.error = response.error.empty()
            ? ("http_status_" + std::to_string(response.statusCode))
            : response.error;
        result.answer = "I could not check the live app state right now. Please try again in a moment.";
        return result;
    }
    else {
        result.metadata["live_state_error"] = response.error.empty()
            ? nlohmann::json("http_status_" + std::to_string(response.statusCode))
            : nlohmann::json(response.error);
    }

    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);

    result.status = SkillExecutionStatus::Completed;

    if (queryRequestsLeadingZeroIpAudit_(query) && cameraInventory.is_array()) {
        result.answer = buildLeadingZeroIpAuditAnswer_(cameraInventory, progressLanguage);
    }
    else {
        nlohmann::json stateForAnalysis = buildStateForAnalysis_(state, cameraInventory);
        if (hasOperationalContext) {
            stateForAnalysis = nlohmann::json::object({
                { "live_state", std::move(stateForAnalysis) },
                { "operational_context", buildOperationalContextForAnalysis_(operationalContext) },
            });
        }

        result.answer = analyzeStateWithLlm_(
            llm,
            payload,
            selection,
            focus,
            query,
            stateForAnalysis);

        if (result.answer.empty()) {
            if (wantsOperationalContext && !hasOperationalContext && !operationalContextError.empty()) {
                result.answer = buildOperationalContextFailureAnswer_(
                    progressLanguage,
                    operationalContextError);
            }
            else {
                result.answer = buildFocusedAnswer_(stateForAnalysis, focus, cameraInventory);
            }
        }

        result.metadata["has_operational_context"] = hasOperationalContext;
        if (!operationalContextError.empty()) {
            result.metadata["operational_context_error"] = operationalContextError;
        }
        if (!operationalQueryError.empty()) {
            result.metadata["operational_query_error"] = operationalQueryError;
        }
    }

    result.metadata["focus"] = focus;
    result.metadata["camera_inventory_count"] =
        cameraInventory.is_array() ? static_cast<int>(cameraInventory.size()) : 0;
    result.metadata["reply_language"] = selection.replyLanguage.empty()
        ? nlohmann::json(nullptr)
        : nlohmann::json(selection.replyLanguage);

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(progressLanguage, "read_state", "finalizing", 3, 3, 3));
    return result;
}

} // namespace chatv2

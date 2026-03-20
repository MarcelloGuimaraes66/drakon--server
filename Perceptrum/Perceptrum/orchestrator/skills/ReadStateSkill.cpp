#include "ReadStateSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <vector>

#include "../HttpUtils.h"
#include "../ProgressUtils.h"
#include "../../core/AgentCore.h"

namespace chatv2 {

namespace {

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
            const std::string value = object[key].get<std::string>();
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
            "email", "e-mail", "account", "profile", "usuario", "usuário", "conta", "perfil"
        })) {
        return "account";
    }
    if (containsAny_(normalized, {
            "agent", "agents", "agente", "agentes"
        })) {
        return "agents";
    }
    if (containsAny_(normalized, {
            "job", "jobs", "workflow", "agendamento"
        })) {
        return "jobs";
    }
    if (containsAny_(normalized, {
            "camera", "cameras", "feed", "stream"
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

        const std::string value = item[fieldName].get<std::string>();
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

std::string buildOverviewAnswer_(const nlohmann::json& state)
{
    const auto cameras = state.value("cameras", nlohmann::json::object());
    const auto jobs = state.value("jobs", nlohmann::json::object());
    const auto cameraAgents = state.value("camera_agents", nlohmann::json::object());
    const auto jobAgents = state.value("job_agents", nlohmann::json::object());
    const auto billing = state.value("billing", nlohmann::json::object());
    const auto pairing = state.value("pairing", nlohmann::json::object());
    const auto apiKeys = state.value("api_keys", nlohmann::json::object());

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
    const auto account = state.value("account", nlohmann::json::object());
    const auto profile = state.value("profile", nlohmann::json::object());

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
    const std::string& focus)
{
    const auto cameras = state.value("cameras", nlohmann::json::object());
    const auto jobs = state.value("jobs", nlohmann::json::object());
    const auto cameraAgents = state.value("camera_agents", nlohmann::json::object());
    const auto jobAgents = state.value("job_agents", nlohmann::json::object());
    const auto billing = state.value("billing", nlohmann::json::object());
    const auto pairing = state.value("pairing", nlohmann::json::object());
    const auto apiKeys = state.value("api_keys", nlohmann::json::object());

    std::ostringstream out;

    if (focus == "cameras") {
        const std::string cameraNames = joinNames_(cameras.value("items", nlohmann::json::array()), "name", 5);
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

} // namespace

SkillDefinition ReadStateSkill::definition() const
{
    return SkillDefinition{
        "read_state",
        "Reads cameras, jobs, agents, balances, and configs.",
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

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/orchestrator/state?client_id=" + agent.getClientId();
    const HttpResponse response = getUrl(url, agent.getExeToken(), {}, 6000);
    if (!response.ok()) {
        result.status = SkillExecutionStatus::Failed;
        result.error = response.error.empty()
            ? ("http_status_" + std::to_string(response.statusCode))
            : response.error;
        result.answer = "I could not check the live app state right now. Please try again in a moment.";
        return result;
    }

    const nlohmann::json state = nlohmann::json::parse(response.body, nullptr, false);
    if (!state.is_object()) {
        result.status = SkillExecutionStatus::Failed;
        result.error = "invalid_state_payload";
        result.answer = "I received an invalid payload while trying to read the current app state.";
        return result;
    }

    result.status = SkillExecutionStatus::Completed;
    result.answer = buildFocusedAnswer_(state, focus);
    result.metadata["focus"] = focus;
    result.metadata["state"] = state;
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

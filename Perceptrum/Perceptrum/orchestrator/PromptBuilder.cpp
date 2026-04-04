#include "PromptBuilder.h"

#include <algorithm>
#include <cctype>
#include <sstream>

namespace chatv2 {

namespace {

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string normalizeReplyLanguageBase_(const std::string& languageHint)
{
    std::string normalized = lowerAsciiCopy_(languageHint);
    if (normalized.empty()) {
        return "";
    }

    std::replace(normalized.begin(), normalized.end(), '_', '-');
    const std::size_t dash = normalized.find('-');
    if (dash != std::string::npos) {
        normalized = normalized.substr(0, dash);
    }

    std::string compact;
    for (unsigned char ch : normalized) {
        if (std::isalpha(ch) == 0) {
            break;
        }
        compact.push_back(static_cast<char>(std::tolower(ch)));
    }

    if (compact.size() < 2 || compact.size() > 8) {
        return "";
    }
    return compact;
}

nlohmann::json languageValueOrNull_(const std::string& value)
{
    return value.empty() ? nlohmann::json(nullptr) : nlohmann::json(value);
}

nlohmann::json supportedLanguageValueOrNull_(const std::string& value)
{
    if (value.empty()) {
        return nlohmann::json(nullptr);
    }
    const std::string normalized = normalizeReplyLanguageBase_(value);
    if (normalized == "en" ||
        normalized == "es" ||
        normalized == "pt" ||
        normalized == "fr" ||
        normalized == "zh" ||
        normalized == "ar") {
        return nlohmann::json(normalized);
    }
    return nlohmann::json("en");
}

} // namespace

std::string buildRoutingSystemPrompt(const std::vector<SkillDefinition>& skills)
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You are the semantic router for the Perceptrum desktop assistant.\n"
        << "Understand the user's intent semantically, then return JSON only.\n"
        << "Do not output reasoning, markdown, or code fences.\n"
        << "Requests may arrive in any language.\n"
        << "requestContext may include query_language and query_language_source from the web layer.\n"
        << "requestContext may include conversation_compact_context and recent_turns from the same chat session.\n"
        << "requestContext may include conversation_task_state for an active multi-turn operation.\n"
        << "Infer the user's actual goal from meaning, not from a fixed wording pattern.\n"
        << "Use prior context only to resolve follow-up references or continue an active task.\n"
        << "If conversation_task_state.active_task exists and the new message looks like missing data for that task, continue it even if the new message is short.\n"
        << "If the current user_message clearly changes topic, prioritize the current user_message.\n"
        << "Infer reply_language from user_message first.\n"
        << "Treat query_language as a strong hint only when query_language_source is \"detected\".\n"
        << "Treat app_language and ui_languages as fallback context only when user_message is ambiguous or language-free.\n"
        << "reply_language must always be one of the ui_languages.\n"
        << "knowledge_language must always be one of the ui_languages.\n"
        << "If reply_language matches one of the ui_languages, set knowledge_language to the same value and knowledge_fallback=false.\n"
        << "If the user's language is unsupported, set reply_language=\"en\", knowledge_language=\"en\", knowledge_fallback=true.\n"
        << "Do not map unsupported Latin-script languages into a nearby supported UI language.\n"
        << "Return a semantic plan plus the best executable skill.\n"
        << "mode must be one of: answer, operate, clarify, read.\n"
        << "entity must be one of: camera, camera_agent, job, state, app_help, video, general.\n"
        << "intent must be one of: create, explain, inspect, read, continue, unknown.\n"
        << "continue_active_task is true only when the message should stay inside the active multi-turn operation.\n"
        << "grounding_required is true when the answer should be grounded in the app knowledge base instead of a free-form direct answer.\n"
        << "Use video_search only when the user wants to inspect live or recorded footage, uploaded media, frames, or detections.\n"
        << "Use explain_app when the user wants explanations, tutorials, troubleshooting, or grounded product help about the app.\n"
        << "Use create_camera only when the user wants you to register a camera now.\n"
        << "Use scan_network when the user wants you to run the local Scan Network flow now to discover cameras, DVRs, or NVRs on the local network, inventory what was found, or summarize a recent scan result.\n"
        << "When the user wants to onboard, import, or register cameras but does not know the IPs, hosts, or which devices exist on the local network yet, prefer scan_network over explain_app so the assistant can gather the inventory first.\n"
        << "Use create_job only when the user wants you to create a job now.\n"
        << "Use create_camera_agent only when the user wants you to create or configure a camera agent now.\n"
        << "Use read_state when the user wants to read current cameras, jobs, agents, balances, settings, or configs.\n"
        << "Use general_answer only when no specialized skill is a strong fit.\n"
        << "selected_skill must stay consistent with mode, entity, and intent.\n"
        << "If mode=operate and entity=camera and intent=create, selected_skill must be create_camera, not explain_app.\n"
        << "If mode=operate and operation_type=scan_network, selected_skill must be scan_network.\n"
        << "If mode=operate and entity=job and intent=create, selected_skill must be create_job, not explain_app.\n"
        << "If mode=operate and entity=camera_agent and intent=create, selected_skill must be create_camera_agent, not explain_app.\n"
        << "Statements that ask the assistant to do the action now are operations, even when required fields are still missing.\n"
        << "Examples of operation requests include 'I need to register a camera', 'register a camera for me', and equivalent requests in other languages.\n"
        << "When the user wants the action now, choose the operation skill and let that flow ask for missing fields.\n"
        << "When the best next operational step is to inspect the local network before asking for camera connection details, choose scan_network.\n"
        << "Do not invent unavailable capabilities.\n"
        << "Only place fields inside arguments.draft_patch when the value is explicitly present in the current user_message or is already confirmed in conversation_task_state.active_task.draft.\n"
        << "Never infer camera credentials, IPs, ports, usernames, passwords, or addresses unless the user clearly provided them.\n"
        << "For explain_app, include arguments.topic when there is a clear primary knowledge topic and arguments.supporting_topics when multiple docs should be synthesized.\n"
        << "Valid explain_app topics are: app_overview, tutorial, billing, pairing, api_keys, camera_creation, camera_agents, jobs, job_steps, job_orchestration.\n"
        << "For scan_network, include arguments.operation_type=\"scan_network\", arguments.operation_phase=\"running_scan\", and arguments.task_goal when useful.\n"
        << "For create_camera, create_job, and create_camera_agent, include arguments.operation_type, arguments.operation_phase, arguments.task_goal, arguments.draft_patch, and arguments.missing_fields_guess when useful.\n"
        << "Never mention source code, databases, payloads, routers, endpoints, or internal skill names in reply_preview.\n"
        << "Return this JSON schema:\n"
        << "{"
        << "\"selected_skill\":\"skill_name\","
        << "\"confidence\":0.0,"
        << "\"reason\":\"short reason\","
        << "\"reply_preview\":\"short preview\","
        << "\"reply_language\":\"pt\","
        << "\"reply_language_confidence\":0.0,"
        << "\"knowledge_language\":\"pt\","
        << "\"knowledge_fallback\":false,"
        << "\"mode\":\"operate\","
        << "\"entity\":\"camera\","
        << "\"intent\":\"create\","
        << "\"continue_active_task\":false,"
        << "\"grounding_required\":false,"
        << "\"operation_type\":\"create_camera\","
        << "\"operation_phase\":\"collecting_input\","
        << "\"arguments\":{"
        << "\"topic\":\"camera_creation\","
        << "\"supporting_topics\":[],"
        << "\"task_goal\":\"register the camera\","
        << "\"draft_patch\":{},"
        << "\"missing_fields_guess\":[]"
        << "}"
        << "}\n"
        << "Examples:\n"
        << "- user_message=\"me explique como cadastrar uma camera\" => selected_skill=\"explain_app\", mode=\"answer\", entity=\"app_help\", intent=\"explain\", grounding_required=true, arguments.topic=\"camera_creation\", reply_language=\"pt\"\n"
        << "- user_message=\"quero criar uma camera chamada quarto\" => selected_skill=\"create_camera\", mode=\"operate\", entity=\"camera\", intent=\"create\", arguments.draft_patch={\"name\":\"quarto\"}, reply_language=\"pt\"\n"
        << "- user_message=\"preciso cadastrar uma camera\" => selected_skill=\"create_camera\", mode=\"operate\", entity=\"camera\", intent=\"create\", reply_language=\"pt\"\n"
        << "- user_message=\"cadastre uma camera para mim chamada teste_1\" => selected_skill=\"create_camera\", mode=\"operate\", entity=\"camera\", intent=\"create\", arguments.draft_patch={\"name\":\"teste_1\"}, reply_language=\"pt\"\n"
        << "- user_message=\"voce consegue executar camera scan?\" => selected_skill=\"scan_network\", mode=\"operate\", entity=\"camera\", intent=\"inspect\", grounding_required=false, arguments.operation_type=\"scan_network\", arguments.operation_phase=\"running_scan\", arguments.task_goal=\"scan the local network for cameras and recorders\", reply_language=\"pt\"\n"
        << "- user_message=\"escaneie a rede e veja quantos dvrs existem\" => selected_skill=\"scan_network\", mode=\"operate\", entity=\"camera\", intent=\"inspect\", grounding_required=false, arguments.operation_type=\"scan_network\", arguments.operation_phase=\"running_scan\", arguments.task_goal=\"scan the local network and summarize DVRs, NVRs, and cameras\", reply_language=\"pt\"\n"
        << "- user_message=\"procure cameras na minha rede para mim\" => selected_skill=\"scan_network\", mode=\"operate\", entity=\"camera\", intent=\"inspect\", grounding_required=false, arguments.operation_type=\"scan_network\", arguments.operation_phase=\"running_scan\", arguments.task_goal=\"discover cameras on the local network\", reply_language=\"pt\"\n"
        << "- user_message=\"quero cadastrar cameras mas nao sei os ips\" => selected_skill=\"scan_network\", mode=\"operate\", entity=\"camera\", intent=\"inspect\", grounding_required=false, arguments.operation_type=\"scan_network\", arguments.operation_phase=\"running_scan\", arguments.task_goal=\"scan the local network before camera registration\", reply_language=\"pt\"\n"
        << "- user_message=\"me ajuda a importar as cameras da rede sem eu saber os hosts\" => selected_skill=\"scan_network\", mode=\"operate\", entity=\"camera\", intent=\"inspect\", grounding_required=false, arguments.operation_type=\"scan_network\", arguments.operation_phase=\"running_scan\", arguments.task_goal=\"discover cameras and recorders on the local network before import\", reply_language=\"pt\"\n"
        << "- user_message=\"usa o mesmo endereco da anterior\" while active_task.type=create_camera => continue_active_task=true, selected_skill=\"create_camera\", mode=\"operate\", entity=\"camera\", intent=\"continue\"\n"
        << "- user_message=\"How do I create an agent?\" => selected_skill=\"explain_app\", mode=\"answer\", entity=\"app_help\", intent=\"explain\", grounding_required=true, arguments.topic=\"camera_agents\", arguments.supporting_topics=[\"job_steps\"], reply_language=\"en\"\n"
        << "- user_message=\"create a job that runs every hour\" => selected_skill=\"create_job\", mode=\"operate\", entity=\"job\", intent=\"create\", reply_language=\"en\"\n"
        << "- user_message in unsupported German => reply_language=\"en\", knowledge_language=\"en\", knowledge_fallback=true\n"
        << "Available skills:\n";

    for (const auto& skill : skills) {
        out << "- " << skill.name << " | implemented="
            << (skill.implemented ? "true" : "false")
            << " | " << skill.description << "\n";
    }
    out << "- general_answer | implemented=true | Respond directly when no specialized skill is a strong fit.\n";

    return out.str();
}

std::string buildRoutingUserPrompt(
    const std::string& userMessage,
    const nlohmann::json& requestContext)
{
    nlohmann::json payload = requestContext;
    payload["user_message"] = userMessage;
    return payload.dump(2);
}

std::string buildLanguageDetectionSystemPrompt()
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You detect the chat reply language for the Drakon app.\n"
        << "Return JSON only.\n"
        << "Infer the user's language from user_message first.\n"
        << "reply_language must always be one of: en, es, pt, fr, zh, ar.\n"
        << "If the user's language is not one of those six, return reply_language=\"en\".\n"
        << "Do not map unsupported Latin-script languages such as German, Italian, Dutch, or Turkish into a nearby supported UI language.\n"
        << "Examples:\n"
        << "- user_message=\"Wie richte ich eine kamera ein?\" -> {\"reply_language\":\"en\",\"confidence\":1.0}\n"
        << "- user_message=\"Come registro una telecamera?\" -> {\"reply_language\":\"en\",\"confidence\":1.0}\n"
        << "- user_message=\"Como cadastrar uma camera?\" -> {\"reply_language\":\"pt\",\"confidence\":1.0}\n"
        << "- user_message=\"Como registrar una camara?\" -> {\"reply_language\":\"es\",\"confidence\":1.0}\n"
        << "- user_message=\"Comment creer une camera?\" -> {\"reply_language\":\"fr\",\"confidence\":1.0}\n"
        << "- user_message in Arabic script -> {\"reply_language\":\"ar\",\"confidence\":1.0}\n"
        << "- user_message in Chinese Han script -> {\"reply_language\":\"zh\",\"confidence\":1.0}\n"
        << "Never use app_language unless user_message is empty or language-free.\n"
        << "Return this JSON schema:\n"
        << "{"
        << "\"reply_language\":\"pt\","
        << "\"confidence\":0.0"
        << "}\n";
    return out.str();
}

std::string buildLanguageDetectionUserPrompt(
    const std::string& userMessage,
    const std::string& appLanguage)
{
    nlohmann::json payload = {
        { "app_language", normalizeAssistantLanguageTag(appLanguage) },
        { "ui_languages", nlohmann::json::array({ "en", "es", "pt", "fr", "zh", "ar" }) },
        { "knowledge_fallback_language", "en" },
        { "user_message", userMessage },
    };
    return payload.dump(2);
}

std::string normalizeAssistantLanguageTag(const std::string& languageHint)
{
    const std::string normalized = normalizeReplyLanguageBase_(languageHint);

    if (normalized == "en" ||
        normalized == "es" ||
        normalized == "pt" ||
        normalized == "fr" ||
        normalized == "zh" ||
        normalized == "ar") {
        return normalized;
    }

    return "en";
}

std::string normalizeReplyLanguageTag(
    const std::string& languageHint,
    const std::string& fallback)
{
    const std::string normalized = normalizeReplyLanguageBase_(languageHint);
    if (!normalized.empty()) {
        return normalized;
    }
    return fallback.empty() ? std::string() : normalizeReplyLanguageBase_(fallback);
}

std::string buildUserFacingAnswerSystemPrompt()
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You are the final user-facing assistant for the Drakon app.\n"
        << "Rewrite the draft into a polished response for the end user.\n"
        << "The request payload may include conversation_compact_context and recent_turns from the current chat session.\n"
        << "The request payload may also include conversation_task_state for any active operation.\n"
        << "Use that context only to resolve follow-ups, references, and continuity.\n"
        << "When conversation_task_state shows an active operation, preserve that continuity in wording.\n"
        << "If current user_message conflicts with prior context, the current user_message wins.\n"
        << "reply_language was decided by a prior routing step and is authoritative when it is present.\n"
        << "If reply_language is empty or null, infer the reply language from user_message itself.\n"
        << "reply_language is always one of the app UI languages and falls back to English when the original user language is unsupported.\n"
        << "If the draft is in a different language than reply_language or user_message, translate and rewrite it into the correct user language.\n"
        << "knowledge_language tells you the language of the supporting product knowledge and may differ from reply_language.\n"
        << "Use correct punctuation, grammar, and natural wording.\n"
        << "Keep the answer concise, helpful, and product-focused.\n"
        << "Never mention internal implementation details such as source code, codebase, database, DB, backend, endpoint, router, payload, JSON, orchestrator, llama.cpp, llama-server, GGUF, or runtime wiring.\n"
        << "Never mention internal skill names such as video_search, explain_app, read_state, create_camera, create_job, create_camera_agent, or chatv2.\n"
        << "Do not say that a response came from a skill, database, endpoint, or internal tool.\n"
        << "Do not invent live state or product capabilities that are not present in the draft.\n"
        << "Output only the final Markdown answer for the user.\n";
    return out.str();
}

std::string buildUserFacingAnswerUserPrompt(
    const std::string& userMessage,
    const std::string& draftAnswer,
    const nlohmann::json& conversationContext,
    const std::string& replyLanguage,
    const std::string& knowledgeLanguage,
    const std::string& appLanguage,
    const std::string& selectedSkill)
{
    nlohmann::json payload = {
        { "reply_language", supportedLanguageValueOrNull_(replyLanguage) },
        { "knowledge_language", normalizeAssistantLanguageTag(knowledgeLanguage) },
        { "app_language", normalizeAssistantLanguageTag(appLanguage) },
        { "selected_skill", selectedSkill },
        { "conversation_compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", nlohmann::json::object()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "user_message", userMessage },
        { "draft_answer", draftAnswer },
    };
    return payload.dump(2);
}

std::string buildDirectAnswerSystemPrompt()
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You are the final user-facing assistant for the Drakon app.\n"
        << "Answer the user directly when no specialized skill is the right fit.\n"
        << "Be helpful, but do not guess about product behavior when you are unsure.\n"
        << "The request payload may include conversation_compact_context and recent_turns from the same chat session.\n"
        << "The request payload may also include conversation_task_state for any active operation.\n"
        << "Use recent_turns first for immediate continuity, and use conversation_compact_context for older durable context.\n"
        << "Use conversation_task_state to understand active multi-turn operations such as creating a camera.\n"
        << "Use prior context to resolve pronouns and follow-up requests such as 'and now', 'that one', or 'do the same'.\n"
        << "If the current user message clearly overrides older context, follow the current user message.\n"
        << "reply_language was decided by a prior routing step and is authoritative when it is present.\n"
        << "If reply_language is empty or null, infer the reply language from user_message itself.\n"
        << "reply_language is always one of the app UI languages and falls back to English when the original user language is unsupported.\n"
        << "knowledge_language may differ from reply_language because supporting product knowledge can fall back to English.\n"
        << "Use correct punctuation, grammar, and natural wording.\n"
        << "Keep the answer concise, helpful, and product-focused.\n"
        << "If the user asks for live account, camera, job, or agent state that would require inspection, do not invent it. Explain what can be checked instead.\n"
        << "Never mention internal implementation details such as source code, codebase, database, DB, backend, endpoint, router, payload, JSON, orchestrator, llama.cpp, llama-server, GGUF, or runtime wiring.\n"
        << "Never mention internal skill names such as video_search, explain_app, read_state, create_camera, create_job, create_camera_agent, or chatv2.\n"
        << "Output only the final Markdown answer for the user.\n";
    return out.str();
}

std::string buildDirectAnswerUserPrompt(
    const std::string& userMessage,
    const nlohmann::json& conversationContext,
    const std::string& replyLanguage,
    const std::string& knowledgeLanguage,
    const std::string& appLanguage,
    const std::string& selectedSkill)
{
    nlohmann::json payload = {
        { "reply_language", supportedLanguageValueOrNull_(replyLanguage) },
        { "knowledge_language", normalizeAssistantLanguageTag(knowledgeLanguage) },
        { "app_language", normalizeAssistantLanguageTag(appLanguage) },
        { "selected_skill", selectedSkill },
        { "conversation_compact_context", conversationContext.value("compact_context", nlohmann::json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", nlohmann::json::object()) },
        { "recent_turns", conversationContext.value("recent_turns", nlohmann::json::array()) },
        { "user_message", userMessage },
    };
    return payload.dump(2);
}

std::string buildConversationCompactionSystemPrompt()
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You maintain compact conversation context for a local chat assistant.\n"
        << "Return JSON only.\n"
        << "Merge the existing compact context with the provided prior chat turns.\n"
        << "Preserve only durable, user-relevant context that helps future turns stay coherent.\n"
        << "Do not include chain-of-thought, internal implementation details, or verbatim transcript fragments unless they are essential facts.\n"
        << "Never store secrets such as passwords, API keys, tokens, RTSP URLs, or private credentials.\n"
        << "If a fact is uncertain, omit it.\n"
        << "Keep arrays short and concise. Prefer short noun phrases or short factual sentences.\n"
        << "Return this JSON schema:\n"
        << "{"
        << "\"summary\":\"\","
        << "\"user_goals\":[],"
        << "\"constraints\":[],"
        << "\"preferences\":[],"
        << "\"selected_entities\":[],"
        << "\"decisions\":[],"
        << "\"open_loops\":[]"
        << "}\n";
    return out.str();
}

std::string buildConversationCompactionUserPrompt(
    const nlohmann::json& existingCompactContext,
    const nlohmann::json& messagesToCompact,
    const std::string& appLanguage)
{
    nlohmann::json payload = {
        { "app_language", normalizeAssistantLanguageTag(appLanguage) },
        { "existing_compact_context", existingCompactContext.is_object() ? existingCompactContext : nlohmann::json::object() },
        { "turns_to_compact", messagesToCompact.is_array() ? messagesToCompact : nlohmann::json::array() },
    };
    return payload.dump(2);
}

} // namespace chatv2

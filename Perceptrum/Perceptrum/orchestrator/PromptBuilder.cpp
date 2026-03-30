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
        << "You are the local chatv2 orchestrator running beside the Perceptrum EXE.\n"
        << "Select exactly one skill for the user request and return JSON only.\n"
        << "Do not output reasoning, markdown, or code fences.\n"
        << "Requests may arrive in any language.\n"
        << "requestContext may include conversation_compact_context and recent_turns from the same chat session.\n"
        << "Use that prior context only to resolve short follow-up requests or references to earlier turns.\n"
        << "If the current user_message clearly states a new intent, prioritize the current user_message.\n"
        << "Infer intent and reply_language from user_message first.\n"
        << "Treat app_language and ui_languages as fallback context only when user_message is ambiguous or language-free.\n"
        << "reply_language must always be one of the ui_languages.\n"
        << "knowledge_language must always be one of the ui_languages.\n"
        << "If reply_language matches one of the ui_languages, set knowledge_language to that same language and knowledge_fallback=false.\n"
        << "If the user's language does not match one of the ui_languages, set reply_language=\"en\", knowledge_language=\"en\", and knowledge_fallback=true.\n"
        << "Do not map unsupported Latin-script languages such as German, Italian, Dutch, or Turkish into a nearby supported UI language.\n"
        << "Do not let the app UI language change the skill choice when user_message clearly uses another language.\n"
        << "Use video_search only when the user wants to inspect what is happening or what happened in live or stored footage, uploaded media, frames, or detections from one or more cameras.\n"
        << "Do not choose video_search for camera setup, camera IP, RTSP, ports, usernames, passwords, connection details, pairing, settings, API keys, tutorial, or how the app works.\n"
        << "If the user is asking about billing, subscriptions, tokens, pairing, settings, API keys, tutorial, or how the app works, do not choose video_search unless they explicitly ask to inspect footage.\n"
        << "Use explain_app for tutorial, billing, pairing, API keys, or setup questions.\n"
        << "If the user asks how to create, configure, register, connect, troubleshoot, or use cameras, jobs, steps, or camera agents, choose explain_app.\n"
        << "Treat scan network, camera import from Excel/CSV/JSON/TSV/plain text, webcam registration, RTSP/IP registration, retention, CEP address autofill, and allow public access as camera setup topics under explain_app.\n"
        << "Treat tutorial-style questions such as 'how do I create an agent?', 'where do I create an agent?', or 'como eu crio um agente?' as explain_app, not as create_camera_agent.\n"
        << "When the user asks generically about creating an agent, explain both AI Agents and the step-level agent editor inside Jobs.\n"
        << "Use create_camera only when the user wants you to perform camera creation now, not when they want an explanation or tutorial.\n"
        << "Use create_job only when the user wants you to perform job creation now, not when they want an explanation or tutorial.\n"
        << "Use create_camera_agent only when the user wants you to perform camera-agent creation now, not when they want an explanation or tutorial.\n"
        << "Use read_state for reading current cameras, jobs, agents, balances, or configs.\n"
        << "If no specialized skill is a strong fit, select general_answer.\n"
        << "Do not invent unavailable capabilities. Some skills are templates only.\n"
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
        << "\"arguments\":{}"
        << "}\n"
        << "Examples:\n"
        << "- user_message=\"me explique como cadastrar uma camera\" => selected_skill=\"explain_app\", reply_language=\"pt\", knowledge_language=\"pt\", knowledge_fallback=false\n"
        << "- user_message=\"como importar cameras por csv?\" => selected_skill=\"explain_app\", reply_language=\"pt\", knowledge_language=\"pt\", knowledge_fallback=false\n"
        << "- user_message=\"como eu crio um agente?\" => selected_skill=\"explain_app\", reply_language=\"pt\", knowledge_language=\"pt\", knowledge_fallback=false\n"
        << "- user_message=\"How do I register a camera?\" => selected_skill=\"explain_app\", reply_language=\"en\", knowledge_language=\"en\", knowledge_fallback=false\n"
        << "- user_message=\"How do I import cameras from CSV?\" => selected_skill=\"explain_app\", reply_language=\"en\", knowledge_language=\"en\", knowledge_fallback=false\n"
        << "- user_message=\"How do I create an agent?\" => selected_skill=\"explain_app\", reply_language=\"en\", knowledge_language=\"en\", knowledge_fallback=false\n"
        << "- user_message=\"Wie richte ich eine kamera ein?\" => selected_skill=\"explain_app\", reply_language=\"en\", knowledge_language=\"en\", knowledge_fallback=true\n"
        << "Available skills:\n";

    for (const auto& skill : skills) {
        out << "- " << skill.name << " | implemented="
            << (skill.implemented ? "true" : "false")
            << " | " << skill.description << "\n";
    }
    out << "- general_answer | implemented=true | Respond directly with the local Qwen model when no specialized skill is a strong fit.\n";

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
        << "Use that context only to resolve follow-ups, references, and continuity.\n"
        << "If current user_message conflicts with prior context, the current user_message wins.\n"
        << "reply_language was decided by a prior routing step and is authoritative when it is present.\n"
        << "If reply_language is empty or null, infer the reply language from user_message itself.\n"
        << "reply_language is always one of the app UI languages and falls back to English when the original user language is unsupported.\n"
        << "If the draft is in a different language than reply_language or user_message, translate and rewrite it into the correct user language.\n"
        << "knowledge_language tells you the language of the supporting product knowledge and may differ from reply_language.\n"
        << "Use correct punctuation, grammar, and natural wording.\n"
        << "Keep the answer concise, helpful, and product-focused.\n"
        << "Never mention internal implementation details such as source code, codebase, database, DB, backend, endpoint, router, payload, JSON, orchestrator, llama.cpp, llama-server, GGUF, or local runtime.\n"
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
        << "You may use general knowledge and broad product knowledge to be helpful.\n"
        << "The request payload may include conversation_compact_context and recent_turns from the same chat session.\n"
        << "Use recent_turns first for immediate continuity, and use conversation_compact_context for older durable context.\n"
        << "Use prior context to resolve pronouns and follow-up requests such as 'and now', 'that one', or 'do the same'.\n"
        << "If the current user message clearly overrides older context, follow the current user message.\n"
        << "reply_language was decided by a prior routing step and is authoritative when it is present.\n"
        << "If reply_language is empty or null, infer the reply language from user_message itself.\n"
        << "reply_language is always one of the app UI languages and falls back to English when the original user language is unsupported.\n"
        << "knowledge_language may differ from reply_language because supporting product knowledge can fall back to English.\n"
        << "Use correct punctuation, grammar, and natural wording.\n"
        << "Keep the answer concise, helpful, and product-focused.\n"
        << "If the user asks for live account, camera, job, or agent state that would require inspection, do not invent it. Explain what can be checked instead.\n"
        << "Never mention internal implementation details such as source code, codebase, database, DB, backend, endpoint, router, payload, JSON, orchestrator, llama.cpp, llama-server, GGUF, or local runtime.\n"
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

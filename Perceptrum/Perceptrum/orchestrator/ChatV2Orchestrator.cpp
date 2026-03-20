#include "ChatV2Orchestrator.h"

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>
#include <utility>

#include "ConfigUtils.h"
#include "ProgressUtils.h"
#include "PromptBuilder.h"
#include "../core/AgentCore.h"
#include "../logging/Logging.h"
#include "HttpUtils.h"

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

bool isInstructionalIntent_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "how to", "how do i", "how can i", "how can we", "can you explain",
        "explain", "explain how", "me explique", "explique", "como criar",
        "como adicionar", "como cadastrar", "como configurar", "como faco",
        "como faço", "tutorial", "guia", "guide", "passo a passo", "step by step"
    });
}

bool hasCameraCreationVerb_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "create", "criar", "add", "adicionar", "register", "registrar",
        "cadastrar", "setup", "configurar", "new camera", "nova camera"
    });
}

bool hasCameraReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "camera", "cameras"
    });
}

bool hasConnectionConfigCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "ip", "rtsp", "port", "porta", "username", "usuario", "usuário", "password", "senha",
        "channel", "subtype", "connection", "conexao", "conexão", "stream url", "url do stream",
        "rede", "network", "endereco", "endereço", "host", "where can i find", "where do i find",
        "onde encontro", "aonde eu consigo", "onde consigo", "como conectar", "connect camera"
    });
}

bool hasObservationCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "what happened", "what is happening", "what's happening", "what do you see",
        "what did you see", "show me", "look for", "search", "find", "inspect", "analyze",
        "analyse", "detect", "happened", "happening", "is there", "was there",
        "o que aconteceu", "o que esta acontecendo", "o que está acontecendo", "o que houve",
        "o que vc ve", "o que você vê", "mostre", "procure", "buscar", "ache", "inspecione",
        "analise", "análise", "detectar", "viu", "vendo"
    });
}

bool hasVideoMediumCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "camera", "cameras", "video", "videos", "image", "images", "footage", "clip", "clips",
        "frames", "frame", "feed", "stream", "recording", "recordings", "camera feed",
        "camera stream", "camera footage", "imagem", "imagens", "gravacao", "gravação",
        "gravacoes", "gravações", "trecho", "trechos", "midia", "mídia"
    });
}

bool hasTimeWindowCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "now", "right now", "today", "yesterday", "last", "recent", "recently", "between", "during",
        "agora", "hoje", "ontem", "ultimo", "último", "ultimos", "últimos", "entre", "durante",
        "minuto", "minutos", "hora", "horas"
    });
}

bool isVideoObservationRequest_(const std::string& normalized)
{
    if (hasConnectionConfigCue_(normalized)) {
        return false;
    }

    if (!hasVideoMediumCue_(normalized)) {
        return false;
    }

    return hasObservationCue_(normalized) || hasTimeWindowCue_(normalized);
}

bool isCameraCreationHelpRequest_(const std::string& normalized)
{
    return isInstructionalIntent_(normalized) &&
        hasCameraCreationVerb_(normalized) &&
        hasCameraReference_(normalized);
}

bool isCameraSetupHelpRequest_(const std::string& normalized)
{
    return hasCameraReference_(normalized) && hasConnectionConfigCue_(normalized);
}

bool isJobCreationHelpRequest_(const std::string& normalized)
{
    return isInstructionalIntent_(normalized) && containsAny_(normalized, {
        "create job", "criar job", "novo job", "job creation", "schedule job",
        "agendar job", "montar job", "criar tarefa", "workflow", "agendamento"
    });
}

bool isCameraAgentCreationHelpRequest_(const std::string& normalized)
{
    return isInstructionalIntent_(normalized) && containsAny_(normalized, {
        "create agent", "criar agente", "camera agent", "agente na camera",
        "custom agent", "agente custom", "novo agente", "agent on camera"
    });
}

int progressStepCountForSkill_(const std::string& skillName)
{
    if (skillName == "video_search") return 5;
    if (skillName == "explain_app") return 4;
    if (skillName == "read_state") return 3;
    if (skillName == "general_answer") return 2;
    return 1;
}

SkillSelection rewriteInstructionalSelection_(SkillSelection selection, const std::string& userMessage)
{
    const std::string normalized = lowerAsciiCopy_(userMessage);
    if (selection.selectedSkill == "video_search" && !isVideoObservationRequest_(normalized)) {
        if (isCameraSetupHelpRequest_(normalized) || isCameraCreationHelpRequest_(normalized)) {
            selection.selectedSkill = "explain_app";
            selection.confidence = std::max(selection.confidence, 0.99);
            selection.reason = "camera_setup_help_request";
            selection.replyPreview = "Vou explicar como configurar a câmera.";
            selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
            return selection;
        }

        selection.selectedSkill = "general_answer";
        selection.confidence = std::max(selection.confidence, 0.55);
        selection.reason = "video_search_not_strong_match";
        selection.replyPreview = "Vou responder diretamente.";
        selection.arguments = nlohmann::json::object();
        return selection;
    }
    if (selection.selectedSkill == "create_camera" && isCameraCreationHelpRequest_(normalized)) {
        selection.selectedSkill = "explain_app";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "camera_creation_help_request";
        selection.replyPreview = "Vou explicar como cadastrar uma camera.";
        selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
        return selection;
    }
    if (selection.selectedSkill == "explain_app" && isCameraSetupHelpRequest_(normalized)) {
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "camera_setup_help_request";
        selection.replyPreview = "Vou explicar como configurar a câmera.";
        selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
        return selection;
    }
    if (selection.selectedSkill == "create_job" && isJobCreationHelpRequest_(normalized)) {
        selection.selectedSkill = "explain_app";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "job_creation_help_request";
        selection.replyPreview = "Vou explicar como criar um job.";
        selection.arguments = nlohmann::json::object({ { "topic", "jobs" } });
        return selection;
    }
    if (selection.selectedSkill == "create_camera_agent" && isCameraAgentCreationHelpRequest_(normalized)) {
        selection.selectedSkill = "explain_app";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "camera_agent_creation_help_request";
        selection.replyPreview = "Vou explicar como criar um agente na camera.";
        selection.arguments = nlohmann::json::object({ { "topic", "camera_agents" } });
        return selection;
    }
    return selection;
}

std::string buildStubAnswer_(const SkillRunResult& result, const SkillSelection& selection)
{
    if (!result.answer.empty()) return result.answer;

    std::ostringstream out;
    out
        << "This action is not available yet. No changes were applied.";
    return out.str();
}

std::string appLanguageFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object()) {
        return "en";
    }
    if (!payload.contains("app_language") || !payload["app_language"].is_string()) {
        return "en";
    }
    return normalizeAssistantLanguageTag(payload["app_language"].get<std::string>());
}

std::string defaultKnowledgeLanguageForReply_(const std::string& replyLanguage)
{
    const std::string normalizedReply = normalizeReplyLanguageTag(replyLanguage);
    if (normalizedReply.empty()) {
        return "en";
    }
    const std::string knowledgeLanguage = normalizeAssistantLanguageTag(normalizedReply);
    if (knowledgeLanguage == normalizedReply) {
        return knowledgeLanguage;
    }
    return "en";
}

SkillSelection finalizeSelectionLanguages_(SkillSelection selection)
{
    selection.replyLanguage = normalizeAssistantLanguageTag(selection.replyLanguage);

    if (selection.knowledgeLanguage.empty()) {
        selection.knowledgeLanguage = defaultKnowledgeLanguageForReply_(selection.replyLanguage);
    }
    else {
        selection.knowledgeLanguage = normalizeAssistantLanguageTag(selection.knowledgeLanguage);
    }

    if (selection.replyLanguage.empty()) {
        selection.knowledgeLanguageFallback = true;
    }
    else if (selection.knowledgeLanguage.empty()) {
        selection.knowledgeLanguage = "en";
        selection.knowledgeLanguageFallback = true;
    }
    else {
        selection.knowledgeLanguageFallback =
            selection.knowledgeLanguage != normalizeAssistantLanguageTag(selection.replyLanguage) ||
            selection.knowledgeLanguage != selection.replyLanguage;
    }

    if (selection.knowledgeLanguage.empty()) {
        selection.knowledgeLanguage = "en";
        selection.knowledgeLanguageFallback = true;
    }

    return selection;
}

std::string progressLanguageFromSelection_(
    const SkillSelection& selection,
    const nlohmann::json& payload)
{
    if (!selection.replyLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.replyLanguage);
    }
    return appLanguageFromPayload_(payload);
}

bool skipPolishForResult_(const SkillRunResult& result)
{
    return result.metadata.is_object() &&
        result.metadata.contains("skip_polish") &&
        result.metadata["skip_polish"].is_boolean() &&
        result.metadata["skip_polish"].get<bool>();
}

} // namespace

ChatV2Orchestrator::ChatV2Orchestrator()
{
    shadowModeEnabled_ = parseBoolValue(
        loadConfigValue("CHATV2_SHADOW_ENABLED", { "chatv2_shadow_enabled.txt" }),
        true);
}

void ChatV2Orchestrator::start()
{
    const bool ready = runtimeManager_.ensureReady();
    if (ready) {
        llm_.setEndpointOverride(runtimeManager_.baseUrl());
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::start: local LLM ready at " + runtimeManager_.baseUrl()
        );
        return;
    }

    llm_.clearEndpointOverride();
    const std::string lastError = runtimeManager_.lastError();
    if (!lastError.empty()) {
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::start: local LLM not ready, fallback may be used. reason=" + lastError
        );
    }
}

void ChatV2Orchestrator::stop()
{
    llm_.clearEndpointOverride();
    runtimeManager_.stop();
}

void ChatV2Orchestrator::handleQuery(AgentCore& agent, const nlohmann::json& payload)
{
    const std::string userMessage = trimCopy_(
        payload.is_object() ? payload.value("query", std::string()) : std::string());
    const int chatSessionId =
        payload.is_object() ? payload.value("chat_session_id", -1) : -1;

    if (userMessage.empty()) {
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::handleQuery: empty query, nothing to execute"
        );
        return;
    }

    const bool llmReady = runtimeManager_.ensureReady();
    if (llmReady) {
        llm_.setEndpointOverride(runtimeManager_.baseUrl());
    }
    else {
        llm_.clearEndpointOverride();
    }

    const bool allowHeuristicFallback = !runtimeManager_.requiresLlm();
    const SkillSelection selection = chooseSkill_(
        payload,
        userMessage,
        allowHeuristicFallback);

    if (selection.selectedSkill.empty()) {
        SkillSelection unavailableSelection;
        unavailableSelection.selectedSkill = "unavailable";
        unavailableSelection.confidence = 0.0;
        unavailableSelection.reason = runtimeManager_.lastError();
        unavailableSelection.replyPreview = "Local assistant unavailable.";
        recordRoutingTelemetry_(agent, payload, unavailableSelection, "actual", "orchestrator_query");

        SkillRunResult unavailable;
        unavailable.status = SkillExecutionStatus::Completed;
        unavailable.skillName = "orchestrator";
        unavailable.answer = buildCapabilityUnavailableAnswer_(appLanguageFromPayload_(payload));
        finalizeAsChatMessage_(agent, payload, SkillSelection{}, unavailable);
        return;
    }

    if (selection.selectedSkill == "general_answer") {
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::handleQuery: chat_session_id=" + std::to_string(chatSessionId) +
            " selected_skill=general_answer" +
            " confidence=" + std::to_string(selection.confidence) +
            " reply_language=" + (selection.replyLanguage.empty() ? std::string("auto") : selection.replyLanguage) +
            " knowledge_language=" + selection.knowledgeLanguage +
            " source=" + std::string(selection.fromModel ? "model" : "heuristic")
        );
        recordRoutingTelemetry_(agent, payload, selection, "actual", "orchestrator_query");

        postChatProgress(
            agent,
            payload,
            makeProgressUpdate(
                progressLanguageFromSelection_(selection, payload),
                "general_answer",
                "routing",
                1,
                1,
                2));

        pauseForProgressVisibility();

        postChatProgress(
            agent,
            payload,
            makeProgressUpdate(
                progressLanguageFromSelection_(selection, payload),
                "general_answer",
                "drafting",
                2,
                2,
                2));

        SkillRunResult result;
        result.status = SkillExecutionStatus::Completed;
        result.skillName = "general_answer";
        result.answer = buildGeneralAnswer_(payload, selection, userMessage);
        if (result.answer.empty()) {
            result.answer = buildCapabilityUnavailableAnswer_(appLanguageFromPayload_(payload));
        }
        result.answer = sanitizeUserFacingAnswer_(result.answer);
        finalizeAsChatMessage_(agent, payload, selection, result);
        return;
    }

    Logger::instance().logDebug(
        "agent",
        "ChatV2Orchestrator::handleQuery: chat_session_id=" + std::to_string(chatSessionId) +
        " selected_skill=" + selection.selectedSkill +
        " confidence=" + std::to_string(selection.confidence) +
        " reply_language=" + (selection.replyLanguage.empty() ? std::string("auto") : selection.replyLanguage) +
        " knowledge_language=" + selection.knowledgeLanguage +
        " source=" + std::string(selection.fromModel ? "model" : "heuristic")
    );
    recordRoutingTelemetry_(agent, payload, selection, "actual", "orchestrator_query");

    const int progressStepCount = progressStepCountForSkill_(selection.selectedSkill);
    if (progressStepCount > 0) {
        postChatProgress(
            agent,
            payload,
            makeProgressUpdate(
                progressLanguageFromSelection_(selection, payload),
                selection.selectedSkill,
                "routing",
                1,
                1,
                progressStepCount));

        if (selection.selectedSkill == "explain_app" ||
            selection.selectedSkill == "read_state")
        {
            pauseForProgressVisibility();
        }
    }

    SkillRunResult result = registry_.execute(selection.selectedSkill, agent, payload, selection);
    if (result.status == SkillExecutionStatus::Delegated) {
        return;
    }

    if (result.answer.empty()) {
        const std::string languageHint =
            selection.replyLanguage.empty() ? std::string("en") : selection.replyLanguage;
        if (selection.selectedSkill == "create_camera") {
            result.answer = buildComingSoonAnswer_(languageHint, "camera_creation");
        }
        else if (selection.selectedSkill == "create_job") {
            result.answer = buildComingSoonAnswer_(languageHint, "job_creation");
        }
        else if (selection.selectedSkill == "create_camera_agent") {
            result.answer = buildComingSoonAnswer_(languageHint, "camera_agent_creation");
        }
        else {
            result.answer = buildStubAnswer_(result, selection);
        }
    }

    if (skipPolishForResult_(result)) {
        result.answer = sanitizeUserFacingAnswer_(result.answer);
    }
    else {
        result.answer = polishAndSanitizeAnswer_(payload, selection, result.answer);
    }
    finalizeAsChatMessage_(agent, payload, selection, result);
}

void ChatV2Orchestrator::handleShadowQuery(
    AgentCore& agent,
    const nlohmann::json& payload,
    const std::string& actualCommandType)
{
    if (!shadowModeEnabled_) {
        return;
    }

    const std::string userMessage = trimCopy_(
        payload.is_object() ? payload.value("query", std::string()) : std::string());
    const int chatSessionId =
        payload.is_object() ? payload.value("chat_session_id", -1) : -1;
    if (userMessage.empty()) {
        return;
    }

    const bool llmReady = runtimeManager_.ensureReady();
    if (llmReady) {
        llm_.setEndpointOverride(runtimeManager_.baseUrl());
    }
    else {
        llm_.clearEndpointOverride();
    }

    const bool allowHeuristicFallback = !runtimeManager_.requiresLlm();
    SkillSelection selection = chooseSkill_(payload, userMessage, allowHeuristicFallback);
    if (selection.selectedSkill.empty()) {
        selection.selectedSkill = "unavailable";
        selection.confidence = 0.0;
        selection.reason = runtimeManager_.lastError();
        selection.replyPreview = buildLlmUnavailableAnswer_();
    }

    Logger::instance().logDebug(
        "agent",
        "ChatV2Orchestrator::handleShadowQuery: chat_session_id=" + std::to_string(chatSessionId) +
        " selected_skill=" + selection.selectedSkill +
        " confidence=" + std::to_string(selection.confidence) +
        " reply_language=" + (selection.replyLanguage.empty() ? std::string("auto") : selection.replyLanguage) +
        " knowledge_language=" + selection.knowledgeLanguage +
        " source=" + std::string(selection.fromModel ? "model" : "heuristic")
    );

    recordRoutingTelemetry_(agent, payload, selection, "shadow", actualCommandType);
}

SkillSelection ChatV2Orchestrator::chooseSkill_(
    const nlohmann::json& payload,
    const std::string& userMessage,
    bool allowHeuristicFallback) const
{
    const bool hasPayloadObject = payload.is_object();
    const std::string appLanguage = appLanguageFromPayload_(payload);
    const SkillSelection heuristic = chooseHeuristicSkill_(payload, userMessage);

    if (llm_.isConfigured()) {
        nlohmann::json requestContext = {
            { "chat_session_id", hasPayloadObject ? payload.value("chat_session_id", -1) : -1 },
            { "app_language", appLanguage },
            { "ui_languages", nlohmann::json::array({ "en", "es", "pt", "fr", "zh", "ar" }) },
            { "knowledge_fallback_language", "en" },
            {
                "uploaded_image_present",
                hasPayloadObject &&
                payload.contains("uploaded_image_base64") &&
                payload["uploaded_image_base64"].is_string() &&
                !payload["uploaded_image_base64"].get<std::string>().empty()
            },
            {
                "uploaded_video_present",
                hasPayloadObject &&
                payload.contains("uploaded_video_url") &&
                payload["uploaded_video_url"].is_string() &&
                !payload["uploaded_video_url"].get<std::string>().empty()
            },
            { "model_tier", hasPayloadObject ? payload.value("model_tier", std::string()) : std::string() },
            { "video_search_allowed", hasPayloadObject ? payload.value("video_search_allowed", true) : true },
        };

        SkillSelection selection = llm_.chooseSkill(
            userMessage,
            requestContext,
            registry_.definitions());
        selection = rewriteInstructionalSelection_(selection, userMessage);
        const std::string detectedReplyLanguage = llm_.detectReplyLanguage(
            userMessage,
            appLanguage);
        if (!detectedReplyLanguage.empty()) {
            selection.replyLanguage = detectedReplyLanguage;
        }
        selection = finalizeSelectionLanguages_(std::move(selection));
        if (selection.selectedSkill == "general_answer") {
            return selection;
        }
        if (!selection.selectedSkill.empty() && registry_.hasSkill(selection.selectedSkill)) {
            return selection;
        }
    }

    if (!allowHeuristicFallback) {
        return SkillSelection{};
    }

    if (!heuristic.selectedSkill.empty()) {
        SkillSelection rewritten = rewriteInstructionalSelection_(heuristic, userMessage);
        if (llm_.isConfigured()) {
            const std::string detectedReplyLanguage = llm_.detectReplyLanguage(
                userMessage,
                appLanguage);
            if (!detectedReplyLanguage.empty()) {
                rewritten.replyLanguage = detectedReplyLanguage;
            }
        }
        return finalizeSelectionLanguages_(std::move(rewritten));
    }

    SkillSelection fallback;
    fallback.selectedSkill = llm_.isConfigured() ? "general_answer" : "explain_app";
    fallback.confidence = 0.10;
    fallback.reason = "default_fallback";
    fallback.replyPreview = llm_.isConfigured()
        ? "Vou responder diretamente."
        : "Vou responder usando a skill de ajuda do aplicativo.";
    if (llm_.isConfigured()) {
        fallback.replyLanguage = llm_.detectReplyLanguage(
            userMessage,
            appLanguage);
    }
    return finalizeSelectionLanguages_(fallback);
}

SkillSelection ChatV2Orchestrator::chooseHeuristicSkill_(
    const nlohmann::json& payload,
    const std::string& userMessage) const
{
    SkillSelection selection;
    const std::string normalized = lowerAsciiCopy_(userMessage);
    const bool hasPayloadObject = payload.is_object();
    const bool hasUploadedImage =
        hasPayloadObject &&
        payload.contains("uploaded_image_base64") &&
        payload["uploaded_image_base64"].is_string() &&
        !payload["uploaded_image_base64"].get<std::string>().empty();
    const bool hasUploadedVideo =
        hasPayloadObject &&
        payload.contains("uploaded_video_url") &&
        payload["uploaded_video_url"].is_string() &&
        !payload["uploaded_video_url"].get<std::string>().empty();

    if (hasUploadedImage || hasUploadedVideo) {
        selection.selectedSkill = "video_search";
        selection.confidence = 1.0;
        selection.reason = "uploaded_media_requires_video_search";
        selection.replyPreview = "Vou analisar a midia enviada usando a pipeline atual de busca em video.";
        return selection;
    }

    if ((hasCameraCreationVerb_(normalized) && hasCameraReference_(normalized)) ||
        containsAny_(normalized, { "connect camera" })) {
        if (isCameraSetupHelpRequest_(normalized)) {
            selection.selectedSkill = "explain_app";
            selection.confidence = 0.99;
            selection.reason = "camera_setup_help_request";
            selection.replyPreview = "Vou explicar como configurar a camera.";
            selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
            return selection;
        }
        if (isCameraCreationHelpRequest_(normalized)) {
            selection.selectedSkill = "explain_app";
            selection.confidence = 0.99;
            selection.reason = "camera_creation_help_request";
            selection.replyPreview = "Vou explicar como cadastrar uma camera.";
            selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
            return selection;
        }
        selection.selectedSkill = "create_camera";
        selection.confidence = 0.98;
        selection.reason = "explicit_camera_creation_request";
        selection.replyPreview = "Vou preparar a criacao da camera.";
        return selection;
    }

    if (containsAny_(normalized, {
        "create job", "criar job", "novo job", "schedule job", "agendar job", "montar job",
        "job recorrente", "workflow", "agendamento", "cronograma"
    })) {
        if (isJobCreationHelpRequest_(normalized)) {
            selection.selectedSkill = "explain_app";
            selection.confidence = 0.99;
            selection.reason = "job_creation_help_request";
            selection.replyPreview = "Vou explicar como criar um job.";
            selection.arguments = nlohmann::json::object({ { "topic", "jobs" } });
            return selection;
        }
        selection.selectedSkill = "create_job";
        selection.confidence = 0.98;
        selection.reason = "explicit_job_creation_request";
        selection.replyPreview = "Vou preparar a criacao do job.";
        return selection;
    }

    if (containsAny_(normalized, {
        "create agent", "criar agente", "camera agent", "agente na camera", "algoritmo na camera",
        "custom agent", "agente custom", "novo agente"
    })) {
        if (isCameraAgentCreationHelpRequest_(normalized)) {
            selection.selectedSkill = "explain_app";
            selection.confidence = 0.99;
            selection.reason = "camera_agent_creation_help_request";
            selection.replyPreview = "Vou explicar como criar um agente na camera.";
            selection.arguments = nlohmann::json::object({ { "topic", "camera_agents" } });
            return selection;
        }
        selection.selectedSkill = "create_camera_agent";
        selection.confidence = 0.98;
        selection.reason = "explicit_camera_agent_creation_request";
        selection.replyPreview = "Vou preparar a criacao do agente na camera.";
        return selection;
    }

    if (containsAny_(normalized, {
        "list cameras", "listar cameras", "show cameras", "status das cameras", "read state",
        "estado atual", "listar jobs", "listar agentes", "current jobs", "saldo", "configs",
        "email", "e-mail", "account", "profile", "conta", "perfil"
    })) {
        selection.selectedSkill = "read_state";
        selection.confidence = 0.95;
        selection.reason = "explicit_state_read_request";
        selection.replyPreview = "Vou consultar o estado atual do aplicativo.";
        return selection;
    }

    if (containsAny_(normalized, {
        "billing", "tokens", "payment", "stripe", "pairing", "api key", "api keys",
        "openai key", "z.ai", "glm", "tutorial", "how do i", "how to", "como usar",
        "como funciona", "pair", "parear", "emparelhar", "chave api", "configurar",
        "site", "app", "painel", "dashboard", "settings", "configuracoes"
    })) {
        selection.selectedSkill = "explain_app";
        selection.confidence = 0.95;
        selection.reason = "explicit_help_request";
        selection.replyPreview = "Vou responder usando a skill de ajuda do aplicativo.";
        return selection;
    }

    if (isVideoObservationRequest_(normalized)) {
        selection.selectedSkill = "video_search";
        selection.confidence = 0.97;
        selection.reason = "camera_or_footage_search_intent";
        selection.replyPreview = "Vou acionar a skill de video_search.";
        return selection;
    }

    return selection;
}

std::string ChatV2Orchestrator::buildLlmUnavailableAnswer_() const
{
    return buildCapabilityUnavailableAnswer_("en");
}

std::string ChatV2Orchestrator::buildCapabilityUnavailableAnswer_(const std::string& languageHint) const
{
    const std::string language = normalizeAssistantLanguageTag(languageHint);
    if (language == "pt") {
        return "O assistente esta temporariamente indisponivel no momento. Tente novamente em alguns instantes.";
    }
    if (language == "es") {
        return "El asistente no esta disponible temporalmente en este momento. Vuelve a intentarlo en unos instantes.";
    }
    if (language == "fr") {
        return "L'assistant est temporairement indisponible pour le moment. Reessayez dans quelques instants.";
    }
    if (language == "zh") {
        return "助手当前暂时不可用。请稍后再试。";
    }
    if (language == "ar") {
        return "المساعد غير متاح مؤقتا حاليا. يرجى المحاولة مرة اخرى بعد قليل.";
    }
    return "The assistant is temporarily unavailable right now. Please try again in a moment.";
}

std::string ChatV2Orchestrator::buildComingSoonAnswer_(
    const std::string& languageHint,
    const std::string& capabilityLabel) const
{
    const std::string language = normalizeAssistantLanguageTag(languageHint);
    const bool cameraCreation = capabilityLabel == "camera_creation";
    const bool jobCreation = capabilityLabel == "job_creation";

    if (language == "pt") {
        if (cameraCreation) {
            return "Ainda nao consigo criar cameras diretamente pelo chat, mas essa capacidade esta a caminho. Nenhuma alteracao foi aplicada.";
        }
        return jobCreation
            ? "Ainda nao consigo criar tarefas diretamente pelo chat, mas essa capacidade esta a caminho. Nenhuma alteracao foi aplicada."
            : "Ainda nao consigo criar agentes diretamente pelo chat, mas essa capacidade esta a caminho. Nenhuma alteracao foi aplicada.";
    }
    if (language == "es") {
        if (cameraCreation) {
            return "Todavia no puedo crear camaras directamente desde el chat, pero esa capacidad ya viene en camino. No se aplico ningun cambio.";
        }
        return jobCreation
            ? "Todavia no puedo crear tareas directamente desde el chat, pero esa capacidad ya viene en camino. No se aplico ningun cambio."
            : "Todavia no puedo crear agentes directamente desde el chat, pero esa capacidad ya viene en camino. No se aplico ningun cambio.";
    }
    if (language == "fr") {
        if (cameraCreation) {
            return "Je ne peux pas encore creer des cameras directement depuis le chat, mais cette capacite arrive bientot. Aucun changement n'a ete applique.";
        }
        return jobCreation
            ? "Je ne peux pas encore creer des taches directement depuis le chat, mais cette capacite arrive bientot. Aucun changement n'a ete applique."
            : "Je ne peux pas encore creer des agents directement depuis le chat, mais cette capacite arrive bientot. Aucun changement n'a ete applique.";
    }
    if (language == "zh") {
        return jobCreation
            ? "我暂时还不能直接在聊天中创建任务，但这项能力很快就会推出。目前没有应用任何更改。"
            : "我暂时还不能直接在聊天中创建代理，但这项能力很快就会推出。目前没有应用任何更改。";
    }
    if (language == "ar") {
        return jobCreation
            ? "لا يمكنني بعد إنشاء المهام مباشرة من الدردشة، لكن هذه الإمكانية قادمة قريبا. لم يتم تطبيق أي تغيير."
            : "لا يمكنني بعد إنشاء الوكلاء مباشرة من الدردشة، لكن هذه الإمكانية قادمة قريبا. لم يتم تطبيق أي تغيير.";
    }
    if (cameraCreation) {
        return "I cannot create cameras directly from chat yet, but that capability is coming soon. No changes were applied.";
    }
    return jobCreation
        ? "I cannot create jobs directly from chat yet, but that capability is coming soon. No changes were applied."
        : "I cannot create agents directly from chat yet, but that capability is coming soon. No changes were applied.";
}

std::string ChatV2Orchestrator::buildGeneralAnswer_(
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const std::string& userMessage) const
{
    const std::string appLanguage = appLanguageFromPayload_(payload);
    const std::string fallbackLanguage =
        selection.replyLanguage.empty() ? appLanguage : selection.replyLanguage;

    if (!llm_.isConfigured()) {
        return buildCapabilityUnavailableAnswer_(fallbackLanguage);
    }

    const std::string answer = llm_.answerDirectly(
        userMessage,
        selection.replyLanguage,
        selection.knowledgeLanguage,
        appLanguage,
        selection.selectedSkill);
    if (!answer.empty()) {
        return answer;
    }

    return buildCapabilityUnavailableAnswer_(fallbackLanguage);
}

std::string ChatV2Orchestrator::polishAndSanitizeAnswer_(
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const std::string& draftAnswer) const
{
    const std::string appLanguage = appLanguageFromPayload_(payload);
    const std::string fallbackLanguage =
        selection.replyLanguage.empty() ? appLanguage : selection.replyLanguage;
    std::string finalAnswer = draftAnswer;

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    if (llm_.isConfigured()) {
        const std::string polished = llm_.polishAnswer(
            userMessage,
            draftAnswer,
            selection.replyLanguage,
            selection.knowledgeLanguage,
            appLanguage,
            selection.selectedSkill);
        if (!polished.empty()) {
            finalAnswer = polished;
        }
    }

    finalAnswer = sanitizeUserFacingAnswer_(finalAnswer);
    if (finalAnswer.empty()) {
        return buildCapabilityUnavailableAnswer_(fallbackLanguage);
    }
    return finalAnswer;
}

std::string ChatV2Orchestrator::sanitizeUserFacingAnswer_(const std::string& answer) const
{
    std::string sanitized = answer;
    sanitized.erase(
        std::remove(sanitized.begin(), sanitized.end(), '`'),
        sanitized.end());

    const std::vector<std::pair<std::regex, std::string>> replacements = {
        { std::regex("\\b(read_state|video_search|create_camera|create_job|create_camera_agent|explain_app|chatv2)\\b", std::regex::icase), "assistant" },
        { std::regex("\\bskills?\\b", std::regex::icase), "assistant" },
        { std::regex("\\b(database|db|backend|endpoint|payload|json|orchestrator|router|llama(?:\\.cpp|-server)?|gguf|codebase|source code|internal tool|internal tools|runtime manager)\\b", std::regex::icase), "" },
    };

    for (const auto& replacement : replacements) {
        sanitized = std::regex_replace(sanitized, replacement.first, replacement.second);
    }

    sanitized = std::regex_replace(sanitized, std::regex(" +"), " ");
    sanitized = std::regex_replace(sanitized, std::regex(" ?\\n ?"), "\n");
    sanitized = std::regex_replace(sanitized, std::regex("\\n{3,}"), "\n\n");

    return trimCopy_(sanitized);
}

void ChatV2Orchestrator::recordRoutingTelemetry_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const std::string& routingMode,
    const std::string& actualCommandType) const
{
    const int chatSessionId =
        payload.is_object() ? payload.value("chat_session_id", -1) : -1;
    const int commandId =
        payload.is_object() ? payload.value("command_id", -1) : -1;
    const std::string originalQuery =
        payload.is_object() ? payload.value("query", std::string()) : std::string();

    nlohmann::json metadata = {
        { "chat_mode", payload.is_object() ? payload.value("chat_mode", std::string()) : std::string() },
        { "model_tier", payload.is_object() ? payload.value("model_tier", std::string()) : std::string() },
        { "video_search_allowed", payload.is_object() ? payload.value("video_search_allowed", true) : true },
        {
            "uploaded_image_present",
            payload.is_object() &&
            payload.contains("uploaded_image_base64") &&
            payload["uploaded_image_base64"].is_string() &&
            !payload["uploaded_image_base64"].get<std::string>().empty()
        },
        {
            "uploaded_video_present",
            payload.is_object() &&
            payload.contains("uploaded_video_url") &&
            payload["uploaded_video_url"].is_string() &&
            !payload["uploaded_video_url"].get<std::string>().empty()
        },
        { "registered_skills", payload.is_object() ? payload.value("registered_skills", nlohmann::json::array()) : nlohmann::json::array() },
        { "shadow_enabled", shadowModeEnabled_ },
        { "llm_required", runtimeManager_.requiresLlm() },
        { "llm_endpoint_configured", llm_.isConfigured() },
        { "reply_language", selection.replyLanguage.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.replyLanguage) },
        { "reply_language_confidence", selection.replyLanguageConfidence },
        { "knowledge_language", selection.knowledgeLanguage },
        { "knowledge_language_fallback", selection.knowledgeLanguageFallback },
    };
    if (!selection.arguments.is_null() && !selection.arguments.empty()) {
        metadata["arguments"] = selection.arguments;
    }

    nlohmann::json telemetryPayload = {
        { "chat_session_id", chatSessionId > 0 ? nlohmann::json(chatSessionId) : nlohmann::json(nullptr) },
        { "routing_mode", routingMode },
        { "actual_command_type", actualCommandType },
        { "selected_skill", selection.selectedSkill.empty() ? "unavailable" : selection.selectedSkill },
        { "confidence", selection.confidence },
        { "selection_source", selection.fromModel ? "model" : "heuristic" },
        { "selection_reason", selection.reason },
        { "reply_preview", selection.replyPreview },
        { "user_query", originalQuery },
        { "metadata", metadata },
    };

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/orchestrator/telemetry?client_id=" + agent.getClientId();
    const HttpResponse response = postJson(
        url,
        telemetryPayload.dump(),
        agent.getExeToken(),
        {},
        2500);

    if (!response.ok()) {
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::recordRoutingTelemetry_: http=" +
            std::to_string(response.statusCode) +
            (response.error.empty() ? std::string() : " error=" + response.error)
        );
    }
}

bool ChatV2Orchestrator::finalizeAsChatMessage_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const SkillRunResult& result) const
{
    const int chatSessionId =
        payload.is_object() ? payload.value("chat_session_id", -1) : -1;
    const int commandId =
        payload.is_object() ? payload.value("command_id", -1) : -1;
    const std::string originalQuery =
        payload.is_object() ? payload.value("query", std::string()) : std::string();

    if (chatSessionId <= 0) {
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::finalizeAsChatMessage_: invalid chat_session_id"
        );
        return false;
    }

    nlohmann::json routerResult = {
        { "chat_session_id", chatSessionId },
        { "command_id", commandId },
        { "original_query", originalQuery },
        { "camera_ids", nlohmann::json::array() },
        { "camera_names", nlohmann::json::array() },
        { "all_cameras", false },
        { "time_window_minutes_before_now", 0 },
        { "answer", result.answer },
        { "model_prompt_tokens", 0 },
        { "model_output_tokens", 0 },
        { "model_total_tokens", 0 },
    };

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/chat-router-result?client_id=" + agent.getClientId();
    const HttpResponse response = postJson(
        url,
        routerResult.dump(),
        agent.getExeToken());

    Logger::instance().logDebug(
        "agent",
        "ChatV2Orchestrator::finalizeAsChatMessage_: skill=" + selection.selectedSkill +
        " http=" + std::to_string(response.statusCode) +
        (response.error.empty() ? std::string() : " error=" + response.error)
    );

    return response.ok();
}

} // namespace chatv2

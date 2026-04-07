#include "ChatV2Orchestrator.h"

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>
#include <utility>

#include "ConfigUtils.h"
#include "KnowledgeBase.h"
#include "OperationTaskState.h"
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
        "where do i", "where can i", "explain", "explain how", "me explique",
        "explique", "como eu", "onde eu", "como criar", "como adicionar",
        "como cadastrar", "como configurar", "como faco", "como faço",
        "como posso", "onde criar", "onde posso criar", "tutorial", "guia",
        "guide", "passo a passo", "step by step"
    });
}

bool hasCameraCreationVerb_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "create", "criar", "crio", "crie", "add", "adicionar", "adiciono", "adicione",
        "register", "registrar", "registre", "cadastrar", "cadastre", "setup", "configurar",
        "configuro", "configure", "new camera", "nova camera", "crea", "registra", "agrega",
        "configurez", "creez", "cree", "ajoute", "ajoutez", "enregistrez", "enregistre"
    });
}

bool hasCameraReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "camera", "cameras"
    });
}

bool hasCameraOnboardingCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "scan network", "nvr", "dvr", "webcam", "rtsp", "camera import",
        "import camera", "import cameras", "camera csv", "camera json",
        "camera tsv", "camera excel", "camera plain text", "import csv",
        "import json", "import tsv", "import excel", "import plain text",
        "manufacturer", "fabricante", "channel", "subtype", "retention",
        "retencao", "retenção", "collaborator", "collaborators",
        "share with collaborators", "collaborator sharing", "invite collaborator",
        "invite collaborators", "colaborador", "colaboradores", "collaborateurs",
        "compartilhar com colaboradores", "compartilhamento com colaboradores",
        "compartir con colaboradores", "uso compartido con colaboradores",
        "partage avec des collaborateurs", "partager avec des collaborateurs",
        "cep", "zip code", "postal code"
    });
}

bool hasAgentCreationVerb_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "create", "criar", "crio", "crie", "add", "adicionar", "adiciono", "adicione",
        "setup", "configurar", "configuro", "configure", "new agent", "novo agente",
        "new ai agent", "novo ai agent", "crea", "agrega", "configura",
        "configurez", "creez", "cree", "ajoute", "ajoutez"
    });
}

bool hasJobCreationVerb_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "create", "criar", "crio", "crie", "add", "adicionar", "adiciono", "adicione",
        "setup", "configurar", "configuro", "configure", "schedule", "agendar", "agende",
        "montar", "monte", "new job", "novo job", "new task", "nova tarefa",
        "crea", "agrega", "configura", "programa", "configurez", "creez", "cree", "ajoute", "ajoutez"
    });
}

bool hasAgentReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "agent", "agents", "agente", "agentes", "camera agent",
        "camera agents", "ai agent", "ai agents", "custom agent",
        "custom agents", "agente custom", "agent editor"
    });
}

bool hasJobStepReference_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "step", "steps", "job step", "workflow step", "step agent",
        "agent in step", "etapa", "etapas", "agente do step",
        "agente na etapa", "agente na tarefa"
    });
}

bool hasAgentConfigurationCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "prompt core", "alert condition", "video packaging", "input type",
        "snapshot", "snapshots", "polygon", "polygons", "poligono",
        "poligonos", "target", "targets", "face target", "face targets",
        "negative condition", "negative conditions", "negative reference",
        "negative image", "negative images"
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

bool isCameraOnboardingHelpRequest_(const std::string& normalized)
{
    return (hasCameraReference_(normalized) && hasCameraOnboardingCue_(normalized)) ||
        containsAny_(normalized, {
            "scan network", "camera import", "import cameras", "register webcam",
            "cadastrar webcam", "cadastro webcam", "registrar webcam"
        });
}

bool isExplicitCameraCreationActionRequest_(const std::string& normalized)
{
    return hasCameraCreationVerb_(normalized) &&
        hasCameraReference_(normalized) &&
        !isInstructionalIntent_(normalized) &&
        !isCameraSetupHelpRequest_(normalized) &&
        !isCameraOnboardingHelpRequest_(normalized);
}

bool isJobCreationHelpRequest_(const std::string& normalized)
{
    return isInstructionalIntent_(normalized) && containsAny_(normalized, {
        "create job", "criar job", "novo job", "job creation", "schedule job",
        "agendar job", "montar job", "criar tarefa", "workflow", "agendamento"
    });
}

bool isCameraAgentHelpRequest_(const std::string& normalized)
{
    return hasAgentReference_(normalized) &&
        (isInstructionalIntent_(normalized) || hasAgentConfigurationCue_(normalized));
}

bool isExplicitJobCreationActionRequest_(const std::string& normalized)
{
    return hasJobCreationVerb_(normalized) &&
        containsAny_(normalized, {
            "job", "jobs", "workflow", "workflows", "task", "tasks", "tarefa", "tarefas"
        }) &&
        !isInstructionalIntent_(normalized) &&
        !isCameraAgentHelpRequest_(normalized);
}

bool isCameraAgentCreationHelpRequest_(const std::string& normalized)
{
    return isCameraAgentHelpRequest_(normalized) &&
        (hasAgentCreationVerb_(normalized) || containsAny_(normalized, {
            "create agent", "criar agente", "camera agent", "agente na camera",
            "custom agent", "agente custom", "novo agente", "agent on camera"
        }));
}

bool isExplicitCameraAgentCreationActionRequest_(const std::string& normalized)
{
    return hasAgentCreationVerb_(normalized) &&
        hasAgentReference_(normalized) &&
        !isInstructionalIntent_(normalized) &&
        !hasAgentConfigurationCue_(normalized);
}

std::string agentHelpTopicForQuery_(const std::string& normalized)
{
    if (hasJobStepReference_(normalized)) {
        return "job_steps";
    }
    return "camera_agents";
}

int progressStepCountForSkill_(const std::string& skillName)
{
    if (skillName == "video_search") return 5;
    if (skillName == "explain_app") return 4;
    if (skillName == "create_cameras_batch") return 3;
    if (skillName == "edit_cameras_batch") return 3;
    if (skillName == "scan_network") return 3;
    if (skillName == "read_state") return 3;
    if (skillName == "general_answer") return 2;
    return 1;
}

SkillSelection rewriteInstructionalSelection_(SkillSelection selection, const std::string& userMessage)
{
    const std::string normalized = lowerAsciiCopy_(userMessage);
    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "explain_app" ||
         selection.selectedSkill == "read_state") &&
        isExplicitCameraCreationActionRequest_(normalized)) {
        selection.selectedSkill = "create_camera";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "explicit_camera_creation_action_request";
        selection.replyPreview = "Vou criar a camera.";
        selection.arguments = nlohmann::json::object();
        return selection;
    }

    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "explain_app" ||
         selection.selectedSkill == "read_state") &&
        isExplicitJobCreationActionRequest_(normalized)) {
        selection.selectedSkill = "create_job";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "explicit_job_creation_action_request";
        selection.replyPreview = "Vou criar o job.";
        selection.arguments = nlohmann::json::object();
        return selection;
    }

    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "explain_app" ||
         selection.selectedSkill == "read_state") &&
        isExplicitCameraAgentCreationActionRequest_(normalized)) {
        selection.selectedSkill = "create_camera_agent";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "explicit_camera_agent_creation_action_request";
        selection.replyPreview = "Vou criar o agente.";
        selection.arguments = nlohmann::json::object();
        return selection;
    }

    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "create_camera") &&
        (isCameraSetupHelpRequest_(normalized) ||
         isCameraCreationHelpRequest_(normalized) ||
         isCameraOnboardingHelpRequest_(normalized))) {
        selection.selectedSkill = "explain_app";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "camera_setup_help_request";
        selection.replyPreview = "Vou explicar como configurar a câmera.";
        selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
        return selection;
    }

    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "create_job") &&
        !isCameraAgentHelpRequest_(normalized) &&
        isJobCreationHelpRequest_(normalized)) {
        selection.selectedSkill = "explain_app";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "job_creation_help_request";
        selection.replyPreview = "Vou explicar como criar um job.";
        selection.arguments = nlohmann::json::object({ { "topic", "jobs" } });
        return selection;
    }

    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "create_camera_agent" ||
         selection.selectedSkill == "edit_camera_agent") &&
        isCameraAgentHelpRequest_(normalized)) {
        selection.selectedSkill = "explain_app";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = isCameraAgentCreationHelpRequest_(normalized)
            ? "camera_agent_creation_help_request"
            : "camera_agent_help_request";
        selection.replyPreview = "Vou explicar como configurar um agente.";
        selection.arguments = nlohmann::json::object({ { "topic", agentHelpTopicForQuery_(normalized) } });
        return selection;
    }

    if (selection.selectedSkill == "video_search" && !isVideoObservationRequest_(normalized)) {
        selection.selectedSkill = "general_answer";
        selection.confidence = std::max(selection.confidence, 0.55);
        selection.reason = "video_search_not_strong_match";
        selection.replyPreview = "Vou responder diretamente.";
        selection.arguments = nlohmann::json::object();
        return selection;
    }
    if (selection.selectedSkill == "explain_app" && isCameraSetupHelpRequest_(normalized)) {
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "camera_setup_help_request";
        selection.replyPreview = "Vou explicar como configurar a câmera.";
        selection.arguments = nlohmann::json::object({ { "topic", "camera_creation" } });
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

std::string queryLanguageFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() ||
        !payload.contains("query_language") ||
        !payload["query_language"].is_string()) {
        return "";
    }
    return normalizeReplyLanguageTag(payload["query_language"].get<std::string>());
}

std::string queryLanguageSourceFromPayload_(const nlohmann::json& payload)
{
    if (!payload.is_object() ||
        !payload.contains("query_language_source") ||
        !payload["query_language_source"].is_string()) {
        return "";
    }
    return lowerAsciiCopy_(trimCopy_(payload["query_language_source"].get<std::string>()));
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

std::string normalizeSemanticToken_(std::string value)
{
    value = lowerAsciiCopy_(trimCopy_(std::move(value)));
    std::replace(value.begin(), value.end(), ' ', '_');
    return value;
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

bool hasUploadedMedia_(const nlohmann::json& payload)
{
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
    return hasUploadedImage || hasUploadedVideo;
}

std::string activeTaskPhaseForContext_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return "";
    }

    const auto& activeTask = taskState["active_task"];
    if (!activeTask.contains("phase") || !activeTask["phase"].is_string()) {
        return "";
    }
    return trimCopy_(activeTask["phase"].get<std::string>());
}

std::string activeTaskGoalForContext_(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return "";
    }

    const auto& activeTask = taskState["active_task"];
    if (!activeTask.contains("goal") || !activeTask["goal"].is_string()) {
        return "";
    }
    return trimCopy_(activeTask["goal"].get<std::string>());
}

std::size_t countRegexMatches_(const std::string& text, const std::regex& pattern)
{
    if (text.empty()) {
        return 0;
    }

    return static_cast<std::size_t>(
        std::distance(
            std::sregex_iterator(text.begin(), text.end(), pattern),
            std::sregex_iterator()));
}

bool isLikelyStructuredBatchPayload_(const std::string& userMessage)
{
    const std::string trimmed = trimCopy_(userMessage);
    if (trimmed.size() < 24) {
        return false;
    }

    const std::size_t commaCount = static_cast<std::size_t>(std::count(trimmed.begin(), trimmed.end(), ','));
    const std::size_t semicolonCount = static_cast<std::size_t>(std::count(trimmed.begin(), trimmed.end(), ';'));
    const std::size_t newlineCount = static_cast<std::size_t>(std::count(trimmed.begin(), trimmed.end(), '\n'));
    const std::size_t separatorCount = commaCount + semicolonCount + newlineCount;
    const std::size_t digitCount = static_cast<std::size_t>(std::count_if(
        trimmed.begin(),
        trimmed.end(),
        [](unsigned char ch) { return std::isdigit(ch) != 0; }));

    static const std::regex ipv4Pattern(R"(\b(?:\d{1,3}\.){3}\d{1,3}\b)");
    const std::size_t ipv4Count = countRegexMatches_(trimmed, ipv4Pattern);

    if (trimmed.find('?') != std::string::npos &&
        ipv4Count == 0 &&
        separatorCount < 4) {
        return false;
    }

    if (ipv4Count >= 1 &&
        (separatorCount >= 2 || trimmed.size() >= 40)) {
        return true;
    }

    return separatorCount >= 6 && digitCount >= 6;
}

bool shouldBypassRouterForActiveBatchContinuation_(
    const nlohmann::json& payload,
    const std::string& userMessage,
    const nlohmann::json& conversationContext)
{
    if (hasUploadedMedia_(payload)) {
        return false;
    }

    if (activeOperationTaskType(conversationContext) != "create_cameras_batch") {
        return false;
    }

    const std::string activeTaskPhase = activeTaskPhaseForContext_(conversationContext);
    if (activeTaskPhase != "awaiting_missing_fields") {
        return false;
    }

    return isLikelyStructuredBatchPayload_(userMessage);
}

SkillSelection buildActiveBatchContinuationSelection_(
    const nlohmann::json& conversationContext)
{
    SkillSelection selection;
    selection.selectedSkill = "create_cameras_batch";
    selection.confidence = 0.98;
    selection.reason = "active_batch_data_continuation";
    selection.replyPreview = "Vou continuar o lote atual.";
    selection.continueActiveTask = true;
    selection.mode = "operate";
    selection.entity = "camera";
    selection.intent = "continue";
    selection.operationType = "create_cameras_batch";
    selection.operationPhase = "collecting_batch";
    selection.taskGoal = activeTaskGoalForContext_(conversationContext);
    return selection;
}

std::string skillFromSemanticSelection_(
    const SkillSelection& selection,
    const nlohmann::json& conversationContext)
{
    if (selection.selectedSkill == "create_cameras_batch") {
        return "create_cameras_batch";
    }
    if (selection.selectedSkill == "edit_cameras_batch") {
        return "edit_cameras_batch";
    }
    if (selection.selectedSkill == "edit_camera") {
        return "edit_camera";
    }
    if (selection.selectedSkill == "edit_camera_agent") {
        return "edit_camera_agent";
    }

    if (selection.continueActiveTask) {
        const std::string activeTask = activeOperationTaskType(conversationContext);
        if (!activeTask.empty()) {
            return activeTask;
        }
    }

    const std::string operationType = trimCopy_(selection.operationType);
    if (!operationType.empty()) {
        return operationType;
    }

    const std::string mode = normalizeSemanticToken_(selection.mode);
    const std::string entity = normalizeSemanticToken_(selection.entity);
    const std::string intent = normalizeSemanticToken_(selection.intent);

    if (entity == "video" || intent == "inspect") {
        return "video_search";
    }
    if (entity == "state" || mode == "read" || intent == "read") {
        return "read_state";
    }
    if (entity == "camera" && intent == "update") {
        return "edit_camera";
    }
    if (entity == "camera" && (mode == "operate" || intent == "create" || intent == "continue")) {
        return "create_camera";
    }
    if (entity == "camera_agent" && intent == "update") {
        return "edit_camera_agent";
    }
    if (entity == "camera_agent" && (mode == "operate" || intent == "create" || intent == "continue")) {
        return "create_camera_agent";
    }
    if (entity == "job" && (mode == "operate" || intent == "create" || intent == "continue")) {
        return "create_job";
    }
    if (entity == "app_help" || mode == "answer" || intent == "explain" || selection.groundingRequired) {
        return "explain_app";
    }
    return "";
}

bool shouldSemanticSkillOverrideSelected_(
    const SkillSelection& selection,
    const std::string& semanticSkill)
{
    if (semanticSkill.empty()) {
        return false;
    }

    if (selection.selectedSkill.empty() || selection.selectedSkill == "general_answer") {
        return true;
    }

    if (selection.selectedSkill == semanticSkill) {
        return false;
    }

    const bool semanticOperation =
        selection.continueActiveTask ||
        selection.mode == "operate" ||
        selection.mode == "read" ||
        selection.intent == "create" ||
        selection.intent == "update" ||
        selection.intent == "continue" ||
        selection.intent == "inspect" ||
        selection.intent == "read";

    if (!semanticOperation) {
        return false;
    }

    return semanticSkill == "create_camera" ||
        semanticSkill == "edit_camera" ||
        semanticSkill == "edit_camera_agent" ||
        semanticSkill == "edit_cameras_batch" ||
        semanticSkill == "create_cameras_batch" ||
        semanticSkill == "create_camera_agent" ||
        semanticSkill == "create_job" ||
        semanticSkill == "scan_network" ||
        semanticSkill == "read_state" ||
        semanticSkill == "video_search";
}

SkillSelection applySemanticSelectionPlan_(
    SkillSelection selection,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext)
{
    selection.mode = normalizeSemanticToken_(selection.mode);
    selection.entity = normalizeSemanticToken_(selection.entity);
    selection.intent = normalizeSemanticToken_(selection.intent);
    selection.operationType = normalizeSemanticToken_(selection.operationType);
    selection.operationPhase = normalizeSemanticToken_(selection.operationPhase);

    if (hasUploadedMedia_(payload)) {
        selection.selectedSkill = "video_search";
        selection.mode = "operate";
        selection.entity = "video";
        if (selection.intent.empty()) {
            selection.intent = "inspect";
        }
        selection.operationType.clear();
        selection.groundingRequired = false;
        if (selection.confidence < 1.0) {
            selection.confidence = 1.0;
        }
        if (selection.reason.empty()) {
            selection.reason = "uploaded_media_requires_video_search";
        }
        return selection;
    }

    std::string semanticSkill = skillFromSemanticSelection_(selection, conversationContext);
    const std::string originalSelectedSkill = selection.selectedSkill;
    if (shouldSemanticSkillOverrideSelected_(selection, semanticSkill)) {
        selection.selectedSkill = semanticSkill;
        if (selection.reason.empty() || originalSelectedSkill != semanticSkill) {
            selection.reason = "semantic_plan_override";
        }
    }

    if (selection.selectedSkill == "general_answer" &&
        selection.continueActiveTask) {
        const std::string activeTask = activeOperationTaskType(conversationContext);
        if (!activeTask.empty()) {
            selection.selectedSkill = activeTask;
        }
    }

    if (selection.selectedSkill == "general_answer" && selection.groundingRequired) {
        selection.selectedSkill = "explain_app";
    }

    if (selection.operationType.empty() &&
        (selection.selectedSkill == "create_camera" ||
         selection.selectedSkill == "edit_camera" ||
         selection.selectedSkill == "edit_camera_agent" ||
         selection.selectedSkill == "edit_cameras_batch" ||
         selection.selectedSkill == "create_cameras_batch" ||
         selection.selectedSkill == "create_camera_agent" ||
         selection.selectedSkill == "create_job" ||
         selection.selectedSkill == "scan_network")) {
        selection.operationType = selection.selectedSkill;
    }

    if (selection.intent.empty()) {
        if (selection.selectedSkill == "create_camera" ||
            selection.selectedSkill == "create_cameras_batch" ||
            selection.selectedSkill == "create_camera_agent" ||
            selection.selectedSkill == "create_job") {
            selection.intent = selection.continueActiveTask ? "continue" : "create";
        }
        else if (selection.selectedSkill == "edit_camera" ||
                 selection.selectedSkill == "edit_camera_agent" ||
                 selection.selectedSkill == "edit_cameras_batch") {
            selection.intent = selection.continueActiveTask ? "continue" : "update";
        }
        else if (selection.selectedSkill == "scan_network") {
            selection.intent = "inspect";
        }
        else if (selection.selectedSkill == "explain_app") {
            selection.intent = "explain";
        }
        else if (selection.selectedSkill == "read_state") {
            selection.intent = "read";
        }
        else if (selection.selectedSkill == "video_search") {
            selection.intent = "inspect";
        }
        else {
            selection.intent = "unknown";
        }
    }

    if (selection.mode.empty()) {
        if (selection.selectedSkill == "create_camera" ||
            selection.selectedSkill == "edit_camera" ||
            selection.selectedSkill == "edit_camera_agent" ||
            selection.selectedSkill == "edit_cameras_batch" ||
            selection.selectedSkill == "create_cameras_batch" ||
            selection.selectedSkill == "create_camera_agent" ||
            selection.selectedSkill == "create_job" ||
            selection.selectedSkill == "scan_network" ||
            selection.selectedSkill == "video_search") {
            selection.mode = "operate";
        }
        else if (selection.selectedSkill == "read_state") {
            selection.mode = "read";
        }
        else if (selection.selectedSkill == "explain_app") {
            selection.mode = "answer";
        }
    }

    return selection;
}

constexpr double kRouterReplyLanguageConfidenceFloor_ = 0.35;

bool isSupportedReplyLanguage_(const std::string& replyLanguage)
{
    const std::string normalized = normalizeReplyLanguageTag(replyLanguage);
    return normalized == "en" ||
        normalized == "es" ||
        normalized == "pt" ||
        normalized == "fr" ||
        normalized == "zh" ||
        normalized == "ar";
}

bool shouldDetectReplyLanguageForSelection_(const SkillSelection& selection)
{
    if (!selection.fromModel) {
        return true;
    }

    const std::string normalized = normalizeReplyLanguageTag(selection.replyLanguage);
    if (normalized.empty()) {
        return true;
    }

    if (!isSupportedReplyLanguage_(normalized)) {
        return true;
    }

    return selection.replyLanguageConfidence < kRouterReplyLanguageConfidenceFloor_;
}

std::string progressLanguageFromSelection_(
    const SkillSelection& selection,
    const nlohmann::json& payload)
{
    if (!selection.replyLanguage.empty()) {
        return normalizeAssistantLanguageTag(selection.replyLanguage);
    }
    const std::string queryLanguage = queryLanguageFromPayload_(payload);
    if (!queryLanguage.empty()) {
        return normalizeAssistantLanguageTag(queryLanguage);
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

constexpr int kConversationContextSoftTokenLimit_ = 1400;
constexpr std::size_t kConversationContextKeepTailMessages_ = 6;
constexpr std::size_t kConversationContextMaxRecentTurnsForPrompt_ = 8;
constexpr std::size_t kConversationContextMaxMessageChars_ = 700;

nlohmann::json defaultCompactConversationContext_()
{
    return nlohmann::json::object({
        { "summary", "" },
        { "user_goals", nlohmann::json::array() },
        { "constraints", nlohmann::json::array() },
        { "preferences", nlohmann::json::array() },
        { "selected_entities", nlohmann::json::array() },
        { "decisions", nlohmann::json::array() },
        { "open_loops", nlohmann::json::array() },
    });
}

std::string truncateForContext_(std::string value, std::size_t maxChars)
{
    value = trimCopy_(std::move(value));
    if (value.size() <= maxChars) {
        return value;
    }
    if (maxChars <= 3) {
        return value.substr(0, maxChars);
    }
    return value.substr(0, maxChars - 3) + "...";
}

nlohmann::json normalizeCompactConversationContext_(nlohmann::json compactContext)
{
    if (!compactContext.is_object()) {
        compactContext = nlohmann::json::object();
    }

    const nlohmann::json defaults = defaultCompactConversationContext_();
    for (auto it = defaults.begin(); it != defaults.end(); ++it) {
        if (!compactContext.contains(it.key())) {
            compactContext[it.key()] = it.value();
        }
    }

    if (!compactContext["summary"].is_string()) {
        compactContext["summary"] = "";
    }

    for (const auto& key : {
             "user_goals",
             "constraints",
             "preferences",
             "selected_entities",
             "decisions",
             "open_loops",
         }) {
        if (!compactContext[key].is_array()) {
            compactContext[key] = nlohmann::json::array();
        }
        if (compactContext[key].size() > 8) {
            compactContext[key].erase(compactContext[key].begin() + 8, compactContext[key].end());
        }
    }

    compactContext["summary"] = truncateForContext_(
        compactContext["summary"].get<std::string>(),
        900);
    return compactContext;
}

int estimateTextTokens_(const std::string& text)
{
    const std::string trimmed = trimCopy_(text);
    if (trimmed.empty()) {
        return 0;
    }
    return static_cast<int>((trimmed.size() + 3) / 4) + 8;
}

int estimateConversationTokens_(
    const nlohmann::json& compactContext,
    const nlohmann::json& recentTurns)
{
    int total = estimateTextTokens_(compactContext.dump());
    if (recentTurns.is_array()) {
        for (const auto& turn : recentTurns) {
            if (!turn.is_object()) continue;
            total += 12;
            if (turn.contains("content") && turn["content"].is_string()) {
                total += estimateTextTokens_(turn["content"].get<std::string>());
            }
        }
    }
    return total;
}

nlohmann::json normalizeRecentTurnsForPrompt_(nlohmann::json recentTurns)
{
    nlohmann::json normalized = nlohmann::json::array();
    if (!recentTurns.is_array()) {
        return normalized;
    }

    std::size_t startIndex = 0;
    if (recentTurns.size() > kConversationContextMaxRecentTurnsForPrompt_) {
        startIndex = recentTurns.size() - kConversationContextMaxRecentTurnsForPrompt_;
    }

    for (std::size_t i = startIndex; i < recentTurns.size(); ++i) {
        const auto& turn = recentTurns[i];
        if (!turn.is_object()) continue;
        nlohmann::json item = {
            { "role", turn.value("role", std::string()) },
            { "content", truncateForContext_(turn.value("content", std::string()), kConversationContextMaxMessageChars_) },
        };
        const std::string messageType = turn.value("message_type", std::string());
        if (!messageType.empty()) {
            item["message_type"] = messageType;
        }
        normalized.push_back(std::move(item));
    }

    return normalized;
}

nlohmann::json normalizeConversationContextForPrompt_(nlohmann::json conversationContext)
{
    if (!conversationContext.is_object()) {
        conversationContext = nlohmann::json::object();
    }

    conversationContext["compact_context"] = normalizeCompactConversationContext_(
        conversationContext.value("compact_context", nlohmann::json::object()));
    conversationContext["recent_turns"] = normalizeRecentTurnsForPrompt_(
        conversationContext.value("recent_turns", nlohmann::json::array()));
    if (!conversationContext.contains("task_state") || !conversationContext["task_state"].is_object()) {
        conversationContext["task_state"] = defaultOperationTaskState();
    }
    else {
        conversationContext["task_state"] = normalizeOperationTaskState(
            conversationContext["task_state"]);
    }
    return conversationContext;
}

std::string activeTaskTypeForContext_(const nlohmann::json& conversationContext)
{
    return activeOperationTaskType(conversationContext);
}

std::string activeTaskLanguageForContext_(const nlohmann::json& conversationContext)
{
    return activeOperationTaskLanguage(conversationContext);
}

bool isLikelyShortTaskContinuation_(const std::string& userMessage)
{
    const std::string trimmed = trimCopy_(userMessage);
    if (trimmed.empty() || trimmed.size() > 180) {
        return false;
    }

    if (trimmed.find('?') != std::string::npos) {
        return false;
    }

    const std::size_t tokenCount = static_cast<std::size_t>(std::count_if(
        trimmed.begin(),
        trimmed.end(),
        [](char ch) { return std::isspace(static_cast<unsigned char>(ch)) != 0; })) + 1;
    if (tokenCount > 24 &&
        trimmed.find(':') == std::string::npos &&
        trimmed.find(',') == std::string::npos &&
        trimmed.find(';') == std::string::npos) {
        return false;
    }

    return true;
}

SkillSelection applyReplyLanguageHints_(
    SkillSelection selection,
    const nlohmann::json& payload,
    const std::string& userMessage,
    const nlohmann::json& conversationContext)
{
    const std::string queryLanguage = queryLanguageFromPayload_(payload);
    const std::string queryLanguageSource = queryLanguageSourceFromPayload_(payload);
    if (!queryLanguage.empty() && queryLanguageSource == "detected") {
        selection.replyLanguage = queryLanguage;
        selection.replyLanguageConfidence = 1.0;
        if (selection.knowledgeLanguage.empty() ||
            selection.knowledgeLanguage == "en" ||
            selection.knowledgeLanguageFallback) {
            selection.knowledgeLanguage = queryLanguage;
            selection.knowledgeLanguageFallback = false;
        }
        return selection;
    }

    if (!activeTaskTypeForContext_(conversationContext).empty() &&
        isLikelyShortTaskContinuation_(userMessage)) {
        const std::string taskLanguage = activeTaskLanguageForContext_(conversationContext);
        if (!taskLanguage.empty()) {
            selection.replyLanguage = taskLanguage;
            selection.replyLanguageConfidence = 1.0;
            if (selection.knowledgeLanguage.empty()) {
                selection.knowledgeLanguage = taskLanguage;
                selection.knowledgeLanguageFallback = false;
            }
        }
    }

    return selection;
}

const KnowledgeBase& knowledgeBase_()
{
    static const KnowledgeBase base;
    return base;
}

bool shouldPreferGroundedExplainApp_(
    const std::string& userMessage,
    const nlohmann::json& payload)
{
    const std::string appLanguage = appLanguageFromPayload_(payload);
    return !knowledgeBase_().search(userMessage, appLanguage, 2).empty();
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
    Logger::instance().logDebug(
        "agent",
        "ChatV2Orchestrator::start: orchestrator model will follow the chat model selected in the frontend"
    );
}

void ChatV2Orchestrator::stop()
{
}

void ChatV2Orchestrator::configureLlmForPayload_(
    LocalLlmClient& llm,
    const nlohmann::json& payload,
    bool useRouterModel) const
{
    const LocalLlmClient::Config requestConfig =
        buildChatModelClientConfigFromPayload(payload, useRouterModel);
    if (requestConfig.enabled) {
        llm.setRequestOverride(requestConfig);
    }
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

    LocalLlmClient llm;
    configureLlmForPayload_(llm, payload, false);
    const bool llmReady = llm.isConfigured();

    nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    conversationContext = compactConversationContextIfNeeded_(llm, agent, payload, std::move(conversationContext));

    const bool allowHeuristicFallback = true;
    const SkillSelection selection = chooseSkill_(
        llm,
        payload,
        userMessage,
        allowHeuristicFallback,
        conversationContext);

    if (selection.selectedSkill.empty()) {
        SkillSelection unavailableSelection;
        unavailableSelection.selectedSkill = "unavailable";
        unavailableSelection.confidence = 0.0;
        unavailableSelection.reason = llmReady
            ? (selection.reason.empty() ? "router_failed" : selection.reason)
            : "missing_chat_model_credentials";
        unavailableSelection.replyPreview =
            unavailableSelection.reason == "router_failed"
                ? buildRouterFailureAnswer_(appLanguageFromPayload_(payload))
                : buildCapabilityUnavailableAnswer_(appLanguageFromPayload_(payload));
        recordRoutingTelemetry_(agent, payload, unavailableSelection, "actual", "orchestrator_query");

        SkillRunResult unavailable;
        unavailable.status = SkillExecutionStatus::Completed;
        unavailable.skillName = "orchestrator";
        unavailable.answer =
            unavailableSelection.reason == "router_failed"
                ? buildRouterFailureAnswer_(appLanguageFromPayload_(payload))
                : buildCapabilityUnavailableAnswer_(appLanguageFromPayload_(payload));
        unavailable.metadata = {
            { "error_type", unavailableSelection.reason == "router_failed" ? "router_failure" : "assistant_unavailable" },
            { "selection_reason", unavailableSelection.reason },
        };
        finalizeAsChatMessage_(agent, payload, unavailableSelection, unavailable);
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
        result.answer = buildGeneralAnswer_(llm, payload, selection, userMessage, conversationContext);
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
        else if (selection.selectedSkill == "create_cameras_batch") {
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
        result.answer = polishAndSanitizeAnswer_(llm, payload, selection, result.answer, conversationContext);
    }
    if (result.metadata.is_object() && result.metadata.contains("task_state")) {
        conversationContext["task_state"] = result.metadata["task_state"];
        persistConversationContext_(agent, payload, conversationContext);
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

    LocalLlmClient llm;
    configureLlmForPayload_(llm, payload, false);

    const bool allowHeuristicFallback = true;
    SkillSelection selection = chooseSkill_(
        llm,
        payload,
        userMessage,
        allowHeuristicFallback,
        nlohmann::json::object());
    if (selection.selectedSkill.empty()) {
        selection.selectedSkill = "unavailable";
        selection.confidence = 0.0;
        selection.reason = llm.isConfigured()
            ? (selection.reason.empty() ? "router_failed" : selection.reason)
            : "missing_chat_model_credentials";
        selection.replyPreview =
            selection.reason == "router_failed"
                ? buildRouterFailureAnswer_(appLanguageFromPayload_(payload))
                : buildCapabilityUnavailableAnswer_(appLanguageFromPayload_(payload));
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

nlohmann::json ChatV2Orchestrator::loadConversationContext_(
    AgentCore& agent,
    const nlohmann::json& payload) const
{
    nlohmann::json fallback = {
        { "compact_context", defaultCompactConversationContext_() },
        { "task_state", nlohmann::json::object({
            { "active_task", nullptr },
            { "recent_tasks", nlohmann::json::array() },
        }) },
        { "recent_turns", nlohmann::json::array() },
        { "last_compacted_message_id", 0 },
        { "recent_token_estimate", 0 },
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
        Logger::instance().logDebug(
            "agent",
            "ChatV2Orchestrator::loadConversationContext_: http=" +
            std::to_string(response.statusCode) +
            (response.error.empty() ? std::string() : " error=" + response.error));
        return fallback;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        return fallback;
    }

    fallback["compact_context"] = normalizeCompactConversationContext_(
        parsed.value("compact_context", nlohmann::json::object()));
    fallback["task_state"] = parsed.value(
        "task_state",
        nlohmann::json::object({
            { "active_task", nullptr },
            { "recent_tasks", nlohmann::json::array() },
        }));
    fallback["recent_turns"] = parsed.value("recent_turns", nlohmann::json::array());
    fallback["last_compacted_message_id"] = parsed.value("last_compacted_message_id", 0);
    fallback["recent_token_estimate"] = parsed.value("recent_token_estimate", 0);
    return fallback;
}

nlohmann::json ChatV2Orchestrator::compactConversationContextIfNeeded_(
    const LocalLlmClient& llm,
    AgentCore& agent,
    const nlohmann::json& payload,
    nlohmann::json conversationContext) const
{
    if (!conversationContext.is_object()) {
        conversationContext = nlohmann::json::object();
    }
    conversationContext["compact_context"] = normalizeCompactConversationContext_(
        conversationContext.value("compact_context", nlohmann::json::object()));
    if (!conversationContext.contains("recent_turns") || !conversationContext["recent_turns"].is_array()) {
        conversationContext["recent_turns"] = nlohmann::json::array();
    }

    const nlohmann::json recentTurns = conversationContext["recent_turns"];
    const nlohmann::json compactContext = conversationContext["compact_context"];
    if (!recentTurns.is_array() || recentTurns.size() <= kConversationContextKeepTailMessages_) {
        conversationContext["recent_token_estimate"] =
            estimateConversationTokens_(compactContext, recentTurns);
        return conversationContext;
    }

    const int estimatedTokens =
        estimateConversationTokens_(compactContext, recentTurns);
    conversationContext["recent_token_estimate"] = estimatedTokens;
    if (estimatedTokens <= kConversationContextSoftTokenLimit_) {
        return conversationContext;
    }

    if (!llm.isConfigured()) {
        return conversationContext;
    }

    nlohmann::json turnsToCompact = nlohmann::json::array();
    nlohmann::json turnsToKeep = nlohmann::json::array();
    const std::size_t splitIndex = recentTurns.size() > kConversationContextKeepTailMessages_
        ? recentTurns.size() - kConversationContextKeepTailMessages_
        : 0;

    for (std::size_t i = 0; i < recentTurns.size(); ++i) {
        if (i < splitIndex) {
            turnsToCompact.push_back(recentTurns[i]);
        }
        else {
            turnsToKeep.push_back(recentTurns[i]);
        }
    }

    if (turnsToCompact.empty()) {
        return conversationContext;
    }

    const std::string appLanguage = appLanguageFromPayload_(payload);
    nlohmann::json compactedContext = llm.compactConversationContext(
        compactContext,
        turnsToCompact,
        appLanguage);
    compactedContext = normalizeCompactConversationContext_(std::move(compactedContext));
    if (compactedContext == defaultCompactConversationContext_() &&
        compactContext.is_object() &&
        !compactContext.empty()) {
        compactedContext = normalizeCompactConversationContext_(compactContext);
    }

    int lastCompactedMessageId = 0;
    for (const auto& turn : turnsToCompact) {
        const int messageId = turn.is_object() ? turn.value("message_id", 0) : 0;
        if (messageId > lastCompactedMessageId) {
            lastCompactedMessageId = messageId;
        }
    }
    if (lastCompactedMessageId <= 0) {
        return conversationContext;
    }

    conversationContext["compact_context"] = compactedContext;
    conversationContext["recent_turns"] = normalizeRecentTurnsForPrompt_(turnsToKeep);
    conversationContext["last_compacted_message_id"] = lastCompactedMessageId;
    conversationContext["recent_token_estimate"] =
        estimateConversationTokens_(compactedContext, conversationContext["recent_turns"]);

    const bool persisted = persistConversationContext_(agent, payload, conversationContext);
    Logger::instance().logDebug(
        "agent",
        "ChatV2Orchestrator::compactConversationContextIfNeeded_: compacted_messages=" +
        std::to_string(turnsToCompact.size()) +
        " kept_messages=" + std::to_string(turnsToKeep.size()) +
        " persisted=" + std::string(persisted ? "true" : "false"));
    return conversationContext;
}

bool ChatV2Orchestrator::persistConversationContext_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext) const
{
    if (!payload.is_object()) {
        return false;
    }

    const int chatSessionId = payload.value("chat_session_id", -1);
    if (chatSessionId <= 0) {
        return false;
    }

    nlohmann::json body = {
        { "chat_session_id", chatSessionId },
        { "compact_context", normalizeCompactConversationContext_(
            conversationContext.value("compact_context", nlohmann::json::object())) },
        {
            "task_state",
            conversationContext.value(
                "task_state",
                nlohmann::json::object({
                    { "active_task", nullptr },
                    { "recent_tasks", nlohmann::json::array() },
                }))
        },
        { "last_compacted_message_id", conversationContext.value("last_compacted_message_id", 0) },
        { "token_estimate", conversationContext.value("recent_token_estimate", 0) },
    };

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/chat-context?client_id=" + agent.getClientId();
    const HttpResponse response = postJson(
        url,
        body.dump(),
        agent.getExeToken(),
        {},
        3500);
    return response.ok();
}

SkillSelection ChatV2Orchestrator::chooseSkill_(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const std::string& userMessage,
    bool allowHeuristicFallback,
    const nlohmann::json& conversationContext) const
{
    const bool hasPayloadObject = payload.is_object();
    const std::string appLanguage = appLanguageFromPayload_(payload);
    const std::string queryLanguageSource = queryLanguageSourceFromPayload_(payload);
    const SkillSelection heuristic = chooseHeuristicSkill_(payload, userMessage, conversationContext);
    const nlohmann::json promptConversationContext =
        normalizeConversationContextForPrompt_(conversationContext);

    auto finalizeForcedSelection = [&](SkillSelection forcedSelection) -> SkillSelection {
        forcedSelection = applySemanticSelectionPlan_(std::move(forcedSelection), payload, conversationContext);
        forcedSelection = applyReplyLanguageHints_(forcedSelection, payload, userMessage, conversationContext);
        if (llm.isConfigured() &&
            (queryLanguageSource != "detected" ||
             shouldDetectReplyLanguageForSelection_(forcedSelection))) {
            const std::string detectedReplyLanguage = llm.detectReplyLanguage(
                userMessage,
                appLanguage);
            if (!detectedReplyLanguage.empty()) {
                forcedSelection.replyLanguage = detectedReplyLanguage;
                forcedSelection.replyLanguageConfidence =
                    (std::max)(forcedSelection.replyLanguageConfidence, 0.95);
            }
        }
        forcedSelection = applyReplyLanguageHints_(forcedSelection, payload, userMessage, conversationContext);
        forcedSelection = finalizeSelectionLanguages_(std::move(forcedSelection));
        forcedSelection = applySemanticSelectionPlan_(std::move(forcedSelection), payload, conversationContext);
        return forcedSelection;
    };

    if (shouldBypassRouterForActiveBatchContinuation_(payload, userMessage, conversationContext)) {
        return finalizeForcedSelection(
            buildActiveBatchContinuationSelection_(conversationContext));
    }

    if (llm.isConfigured()) {
        nlohmann::json requestContext = {
            { "chat_session_id", hasPayloadObject ? payload.value("chat_session_id", -1) : -1 },
            { "app_language", appLanguage },
            { "query_language", queryLanguageFromPayload_(payload) },
            { "query_language_source", queryLanguageSourceFromPayload_(payload) },
            { "ui_languages", nlohmann::json::array({ "en", "es", "pt", "fr", "zh", "ar" }) },
            { "knowledge_fallback_language", "en" },
            { "registered_skills", payload.is_object() ? payload.value("registered_skills", nlohmann::json::array()) : nlohmann::json::array() },
            { "knowledge_topics", nlohmann::json::array({
                "app_overview",
                "tutorial",
                "billing",
                "pairing",
                "api_keys",
                "camera_creation",
                "camera_agents",
                "jobs",
                "job_steps",
                "job_orchestration"
            }) },
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
            { "conversation_compact_context", promptConversationContext.value("compact_context", nlohmann::json::object()) },
            { "conversation_task_state", promptConversationContext.value("task_state", nlohmann::json::object()) },
            { "recent_turns", promptConversationContext.value("recent_turns", nlohmann::json::array()) },
        };

        SkillSelection selection = llm.chooseSkill(
            userMessage,
            requestContext,
            registry_.definitions());
        selection = applySemanticSelectionPlan_(std::move(selection), payload, conversationContext);
        selection = applyReplyLanguageHints_(selection, payload, userMessage, conversationContext);
        if (queryLanguageSource != "detected" ||
            shouldDetectReplyLanguageForSelection_(selection)) {
            const std::string detectedReplyLanguage = llm.detectReplyLanguage(
                userMessage,
                appLanguage);
            if (!detectedReplyLanguage.empty()) {
                selection.replyLanguage = detectedReplyLanguage;
                selection.replyLanguageConfidence =
                    (std::max)(selection.replyLanguageConfidence, 0.95);
            }
        }
        selection = applyReplyLanguageHints_(selection, payload, userMessage, conversationContext);
        selection = finalizeSelectionLanguages_(std::move(selection));
        selection = applySemanticSelectionPlan_(std::move(selection), payload, conversationContext);
        if (!selection.selectedSkill.empty() &&
            selection.selectedSkill != "general_answer" &&
            !registry_.hasSkill(selection.selectedSkill)) {
            const std::string semanticSkill = skillFromSemanticSelection_(selection, conversationContext);
            if (!semanticSkill.empty() && registry_.hasSkill(semanticSkill)) {
                selection.selectedSkill = semanticSkill;
            }
        }
        if (selection.selectedSkill == "general_answer") {
            if (selection.groundingRequired || shouldPreferGroundedExplainApp_(userMessage, payload)) {
                selection.selectedSkill = "explain_app";
                selection.confidence = (std::max)(selection.confidence, 0.75);
                if (selection.reason.empty()) {
                    selection.reason = "prefer_grounded_app_help";
                }
            }
            return selection;
        }
        if (!selection.selectedSkill.empty() && registry_.hasSkill(selection.selectedSkill)) {
            return selection;
        }

        if (shouldBypassRouterForActiveBatchContinuation_(payload, userMessage, conversationContext)) {
            return finalizeForcedSelection(
                buildActiveBatchContinuationSelection_(conversationContext));
        }

        SkillSelection routerFailure;
        routerFailure.reason = "router_failed";
        routerFailure = applyReplyLanguageHints_(
            routerFailure,
            payload,
            userMessage,
            conversationContext);
        routerFailure = finalizeSelectionLanguages_(std::move(routerFailure));
        return routerFailure;
    }

    if (!allowHeuristicFallback) {
        return SkillSelection{};
    }

    if (!heuristic.selectedSkill.empty()) {
        SkillSelection rewritten = applySemanticSelectionPlan_(heuristic, payload, conversationContext);
        rewritten = applyReplyLanguageHints_(rewritten, payload, userMessage, conversationContext);
        if (llm.isConfigured() &&
            (queryLanguageSource != "detected" ||
             shouldDetectReplyLanguageForSelection_(rewritten))) {
            const std::string detectedReplyLanguage = llm.detectReplyLanguage(
                userMessage,
                appLanguage);
            if (!detectedReplyLanguage.empty()) {
                rewritten.replyLanguage = detectedReplyLanguage;
                rewritten.replyLanguageConfidence =
                    (std::max)(rewritten.replyLanguageConfidence, 0.95);
            }
        }
        rewritten = applyReplyLanguageHints_(rewritten, payload, userMessage, conversationContext);
        rewritten = finalizeSelectionLanguages_(std::move(rewritten));
        rewritten = applySemanticSelectionPlan_(std::move(rewritten), payload, conversationContext);
        return rewritten;
    }

    SkillSelection fallback;
    fallback.selectedSkill = llm.isConfigured() ? "general_answer" : "explain_app";
    fallback.confidence = 0.10;
    fallback.reason = "default_fallback";
    fallback.replyPreview = llm.isConfigured()
        ? "Vou responder diretamente."
        : "Vou responder usando a skill de ajuda do aplicativo.";
    fallback = applySemanticSelectionPlan_(std::move(fallback), payload, conversationContext);
    fallback = applyReplyLanguageHints_(fallback, payload, userMessage, conversationContext);
    if (llm.isConfigured() &&
        (queryLanguageSource != "detected" ||
         shouldDetectReplyLanguageForSelection_(fallback))) {
        fallback.replyLanguage = llm.detectReplyLanguage(
            userMessage,
            appLanguage);
        if (!fallback.replyLanguage.empty()) {
            fallback.replyLanguageConfidence =
                (std::max)(fallback.replyLanguageConfidence, 0.95);
        }
    }
    fallback = applyReplyLanguageHints_(fallback, payload, userMessage, conversationContext);
    fallback = applySemanticSelectionPlan_(std::move(fallback), payload, conversationContext);
    if (fallback.selectedSkill == "general_answer" &&
        shouldPreferGroundedExplainApp_(userMessage, payload)) {
        fallback.selectedSkill = "explain_app";
        fallback.confidence = 0.7;
        fallback.reason = "prefer_grounded_app_help";
        fallback.replyPreview = "Vou responder com base no conhecimento do aplicativo.";
    }
    return finalizeSelectionLanguages_(fallback);
}

SkillSelection ChatV2Orchestrator::chooseHeuristicSkill_(
    const nlohmann::json& payload,
    const std::string& userMessage,
    const nlohmann::json& conversationContext) const
{
    SkillSelection selection;
    if (hasUploadedMedia_(payload)) {
        selection.selectedSkill = "video_search";
        selection.confidence = 1.0;
        selection.reason = "uploaded_media_requires_video_search";
        selection.replyPreview = "Vou analisar a midia enviada usando a pipeline atual de busca em video.";
        selection.mode = "operate";
        selection.entity = "video";
        selection.intent = "inspect";
        return selection;
    }

    const std::string activeTaskType = activeTaskTypeForContext_(conversationContext);
    if (!activeTaskType.empty() && isLikelyShortTaskContinuation_(userMessage)) {
        selection.selectedSkill = activeTaskType;
        selection.confidence = 0.9;
        selection.reason = "active_task_continuation_fallback";
        selection.replyPreview = "Vou continuar a operacao atual.";
        selection.continueActiveTask = true;
        return selection;
    }

    return selection;
}

std::string ChatV2Orchestrator::buildLlmUnavailableAnswer_() const
{
    return buildCapabilityUnavailableAnswer_("en");
}

std::string ChatV2Orchestrator::buildRouterFailureAnswer_(const std::string& languageHint) const
{
    const std::string language = normalizeAssistantLanguageTag(languageHint);
    if (language == "pt") {
        return "Houve um erro temporario ao analisar sua solicitacao. Nao consegui decidir a acao correta no chat. Tente novamente em alguns instantes.";
    }
    if (language == "es") {
        return "Hubo un error temporal al analizar tu solicitud. No pude decidir la accion correcta en el chat. Intentalo de nuevo en unos instantes.";
    }
    if (language == "fr") {
        return "Une erreur temporaire est survenue lors de l'analyse de votre demande. Je n'ai pas pu choisir la bonne action dans le chat. Reessayez dans un instant.";
    }
    if (language == "zh") {
        return "Analyzing your request failed temporarily, so I could not choose the correct chat action. Please try again in a moment.";
    }
    if (language == "ar") {
        return "Analyzing your request failed temporarily, so I could not choose the correct chat action. Please try again in a moment.";
    }
    return "A temporary error happened while analyzing your request, so I could not choose the correct chat action. Please try again in a moment.";
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
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const std::string& userMessage,
    const nlohmann::json& conversationContext) const
{
    const std::string appLanguage = appLanguageFromPayload_(payload);
    const std::string fallbackLanguage =
        selection.replyLanguage.empty() ? appLanguage : selection.replyLanguage;

    if (!llm.isConfigured()) {
        return buildCapabilityUnavailableAnswer_(fallbackLanguage);
    }

    const std::string answer = llm.answerDirectly(
        userMessage,
        normalizeConversationContextForPrompt_(conversationContext),
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
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const SkillSelection& selection,
    const std::string& draftAnswer,
    const nlohmann::json& conversationContext) const
{
    const std::string appLanguage = appLanguageFromPayload_(payload);
    const std::string fallbackLanguage =
        selection.replyLanguage.empty() ? appLanguage : selection.replyLanguage;
    std::string finalAnswer = draftAnswer;

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    if (llm.isConfigured()) {
        const std::string polished = llm.polishAnswer(
            userMessage,
            draftAnswer,
            normalizeConversationContextForPrompt_(conversationContext),
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
        { std::regex("\\b(read_state|video_search|create_camera|create_job|create_camera_agent|edit_camera_agent|scan_network|explain_app|chatv2)\\b", std::regex::icase), "assistant" },
        { std::regex("\\b(create_cameras_batch|edit_cameras_batch)\\b", std::regex::icase), "assistant" },
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
        { "llm_required", true },
        {
            "llm_endpoint_configured",
            buildChatModelClientConfigFromPayload(payload, false).enabled
        },
        { "reply_language", selection.replyLanguage.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.replyLanguage) },
        { "reply_language_confidence", selection.replyLanguageConfidence },
        { "knowledge_language", selection.knowledgeLanguage },
        { "knowledge_language_fallback", selection.knowledgeLanguageFallback },
        { "semantic_mode", selection.mode.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.mode) },
        { "semantic_entity", selection.entity.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.entity) },
        { "semantic_intent", selection.intent.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.intent) },
        { "continue_active_task", selection.continueActiveTask },
        { "grounding_required", selection.groundingRequired },
        { "operation_type", selection.operationType.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.operationType) },
        { "operation_phase", selection.operationPhase.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.operationPhase) },
        { "task_goal", selection.taskGoal.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.taskGoal) },
    };
    if (!selection.draftPatch.is_null() && !selection.draftPatch.empty()) {
        metadata["draft_patch"] = selection.draftPatch;
    }
    if (!selection.missingFieldsGuess.empty()) {
        metadata["missing_fields_guess"] = selection.missingFieldsGuess;
    }
    if (!selection.supportingTopics.empty()) {
        metadata["supporting_topics"] = selection.supportingTopics;
    }
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
    if (result.metadata.is_object() &&
        result.metadata.contains("message_metadata") &&
        result.metadata["message_metadata"].is_object()) {
        routerResult["message_metadata"] = result.metadata["message_metadata"];
    }

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

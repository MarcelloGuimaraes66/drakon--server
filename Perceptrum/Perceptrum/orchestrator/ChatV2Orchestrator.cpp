#include "ChatV2Orchestrator.h"

#include <algorithm>
#include <cctype>
#include <optional>
#include <regex>
#include <sstream>
#include <utility>

#include "ConfigUtils.h"
#include "KnowledgeBase.h"
#include "OperationTaskState.h"
#include "ProgressUtils.h"
#include "PromptBuilder.h"
#include "RoutingLexicon.h"
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

bool isAuthoringSkill_(const std::string& skillName)
{
    return skillName == "create_camera" ||
        skillName == "edit_camera" ||
        skillName == "create_camera_agent" ||
        skillName == "edit_camera_agent" ||
        skillName == "create_job" ||
        skillName == "edit_job";
}

std::string appLanguageFromPayload_(const nlohmann::json& payload);
std::string truncateForContext_(std::string value, std::size_t maxChars);

std::string jsonStringFieldOrEmpty_(const nlohmann::json& source, const char* key)
{
    if (!source.is_object() || !key || !source.contains(key) || !source[key].is_string()) {
        return "";
    }
    return trimCopy_(source[key].get<std::string>());
}

std::string localizeChatApiErrorMessage_(
    const std::string& languageHint,
    int httpStatus,
    const std::string& apiCode,
    const std::string& apiMessage,
    const std::string& rawError)
{
    const std::string language = normalizeAssistantLanguageTag(languageHint);
    const std::string normalizedCode = lowerAsciiCopy_(trimCopy_(apiCode));

    auto messageForLanguage = [&](const char* en, const char* pt, const char* es, const char* fr) {
        if (language == "pt") return std::string(pt);
        if (language == "es") return std::string(es);
        if (language == "fr") return std::string(fr);
        return std::string(en);
    };

    if (normalizedCode == "insufficient_quota") {
        return messageForLanguage(
            "OpenAI API quota exceeded. Check plan and billing details.",
            "A quota da API da OpenAI foi excedida. Verifique o plano e os dados de cobranca.",
            "Se excedio la cuota de la API de OpenAI. Revisa el plan y los datos de facturacion.",
            "Le quota de l'API OpenAI est depasse. Verifiez le forfait et les informations de facturation.");
    }

    if (normalizedCode == "invalid_api_key" || httpStatus == 401) {
        return messageForLanguage(
            "OpenAI API key is invalid or unauthorized.",
            "A chave da API da OpenAI e invalida ou nao autorizada.",
            "La clave de la API de OpenAI es invalida o no esta autorizada.",
            "La cle API OpenAI est invalide ou non autorisee.");
    }

    if (httpStatus == 429) {
        return messageForLanguage(
            "OpenAI API rate limit or quota reached. Try again shortly.",
            "O limite ou a quota da API da OpenAI foi atingido. Tente novamente em instantes.",
            "Se alcanzo el limite o la cuota de la API de OpenAI. Intentalo de nuevo en breve.",
            "La limite ou le quota de l'API OpenAI a ete atteint. Reessayez dans un instant.");
    }

    const std::string truncatedMessage = truncateForContext_(apiMessage, 220);
    if (!truncatedMessage.empty()) {
        if (language == "pt") return "Erro da API da OpenAI: " + truncatedMessage;
        if (language == "es") return "Error de la API de OpenAI: " + truncatedMessage;
        if (language == "fr") return "Erreur de l'API OpenAI : " + truncatedMessage;
        return "OpenAI API error: " + truncatedMessage;
    }

    const std::string truncatedRawError = truncateForContext_(rawError, 220);
    if (!truncatedRawError.empty()) {
        if (language == "pt") return "Falha na requisicao da API da OpenAI: " + truncatedRawError;
        if (language == "es") return "Fallo en la solicitud a la API de OpenAI: " + truncatedRawError;
        if (language == "fr") return "Echec de la requete vers l'API OpenAI : " + truncatedRawError;
        return "OpenAI API request failed: " + truncatedRawError;
    }

    return messageForLanguage(
        "OpenAI API request failed.",
        "A requisicao para a API da OpenAI falhou.",
        "La solicitud a la API de OpenAI fallo.",
        "La requete vers l'API OpenAI a echoue.");
}

std::optional<nlohmann::json> buildChatRouterApiErrorDetails_(
    const LocalLlmClient::FailureInfo& failure,
    const std::string& languageHint,
    std::string& outMessage)
{
    if (!failure.hasFailure) {
        return std::nullopt;
    }

    const std::string rawBody = trimCopy_(failure.rawBody);
    std::string apiCode;
    std::string apiType;
    std::string apiMessage;

    if (!rawBody.empty()) {
        const nlohmann::json parsed = nlohmann::json::parse(rawBody, nullptr, false);
        if (parsed.is_object() && parsed.contains("error") && parsed["error"].is_object()) {
            const nlohmann::json& errorNode = parsed["error"];
            apiCode = jsonStringFieldOrEmpty_(errorNode, "code");
            apiType = jsonStringFieldOrEmpty_(errorNode, "type");
            apiMessage = jsonStringFieldOrEmpty_(errorNode, "message");
        }
    }

    const bool hasApiSignal =
        failure.statusCode == 401 ||
        failure.statusCode == 429 ||
        !apiCode.empty() ||
        !apiType.empty() ||
        !apiMessage.empty();
    if (!hasApiSignal) {
        return std::nullopt;
    }

    outMessage = localizeChatApiErrorMessage_(
        languageHint,
        failure.statusCode,
        apiCode,
        apiMessage,
        failure.error.empty() ? rawBody : failure.error);

    nlohmann::json details = nlohmann::json::object();
    details["provider"] = "openai";
    details["source"] = "chat_router";
    if (!failure.operation.empty()) details["stage"] = failure.operation;
    if (!failure.model.empty()) details["model"] = failure.model;
    if (failure.statusCode > 0) details["http_status"] = failure.statusCode;
    if (!apiCode.empty()) details["api_error_code"] = apiCode;
    if (!apiType.empty()) details["api_error_type"] = apiType;
    if (!apiMessage.empty()) details["api_error_message"] = truncateForContext_(apiMessage, 320);
    if (!rawBody.empty()) details["raw_error"] = truncateForContext_(rawBody, 420);

    return details;
}

void emitChatRouterApiErrorEvent_(
    AgentCore& agent,
    const nlohmann::json& payload,
    const LocalLlmClient& llm)
{
    std::string message;
    const auto details = buildChatRouterApiErrorDetails_(
        llm.lastFailureInfo(),
        appLanguageFromPayload_(payload),
        message);
    if (!details.has_value() || trimCopy_(message).empty()) {
        return;
    }

    agent.postAgentEvent(
        "agent_api_error",
        std::nullopt,
        "",
        message,
        *details);
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

bool hasQuickPresenceCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "tem alguem", "ha alguem", "existe alguem",
        "tem pessoa", "ha pessoa", "existe pessoa"
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

bool hasReportCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "report", "reports", "relatorio", "relatorios", "relatÃ³rio", "relatÃ³rios",
        "document", "documento", "doc", "docx", "download", "export", "exportar",
        "history", "historico", "histÃ³rico", "comparison", "comparativo", "compare",
        "ranking", "timeline", "logs", "log", "audit", "auditoria"
    });
}

bool isReportGenerationRequest_(const std::string& normalized)
{
    return hasReportCue_(normalized) &&
        !isInstructionalIntent_(normalized) &&
        containsAny_(normalized, {
            "generate", "gerar", "gera", "gere", "build", "prepare", "preparar",
            "create", "criar", "export", "exportar", "download", "document", "documento",
            "doc", "docx", "report", "relatorio", "relatÃ³rio", "history", "historico",
            "histÃ³rico", "comparison", "comparativo", "timeline", "logs", "audit", "auditoria"
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

bool hasCameraBatchScopeCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "all cameras", "all the cameras", "every camera", "every cameras",
        "multiple cameras", "many cameras", "several cameras", "those cameras",
        "these cameras", "cameras that", "cameras with", "cameras where",
        "cameras whose", "camera ids", "camera names", "batch", "in batch",
        "todas as cameras", "todas cameras", "todas as camaras", "todas camaras",
        "varias cameras", "varias camaras", "algumas cameras", "cameras que",
        "cameras com", "cameras onde", "cameras cujo", "cameras cujos",
        "em lote", "lote"
    });
}

bool hasCameraInventoryAnalysisCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "which cameras", "what cameras", "what camera", "how many cameras",
        "list cameras", "show cameras", "find cameras", "find camera",
        "camera list", "camera lists", "camera inventory", "camera inventories",
        "camera status", "camera statuses", "camera audit", "camera audits",
        "camera audits", "camera match", "camera matches", "camera filter",
        "camera filters", "ip wrong", "wrong ip", "malformed ip",
        "incorrect ip", "invalid ip", "leading zero", "leading zeros",
        "zero a esquerda", "ip errado", "ip incorreto", "ip invalido",
        "terminacao de ip", "termina em", "final do ip", "sufixo do ip",
        "ip ending", "ip ends", "ip suffix", "offline cameras", "online cameras",
        "cameras offline", "cameras online", "cameras sem agente",
        "cameras without agent", "cameras with no agent",
        "quais cameras", "que cameras", "quantas cameras", "listar cameras",
        "mostre as cameras", "mostrar cameras", "ache as cameras",
        "camera tem", "cameras tem", "camera com", "cameras com"
    });
}

bool hasCameraLiveStateCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "status", "online", "offline", "service", "running", "active",
        "estado", "rodando", "ativo", "ativa", "em execucao"
    });
}

bool shouldUseReadStateForCameraInventory_(
    const std::string& normalized,
    const RoutingLexiconSignals& signals)
{
    if (!signals.mentionsCamera || signals.mentionsJob || signals.mentionsCameraAgent) {
        return false;
    }

    if (signals.wantsCreate || signals.wantsEdit || signals.wantsStart || signals.wantsStop) {
        return false;
    }

    // Footage questions should stay on the video path even if they mention a
    // camera and end with a question mark.
    const bool looksLikeFootageObservation =
        hasVideoMediumCue_(normalized) &&
        (hasObservationCue_(normalized) ||
         hasQuickPresenceCue_(normalized) ||
         hasTimeWindowCue_(normalized)) &&
        !hasConnectionConfigCue_(normalized) &&
        !hasCameraInventoryAnalysisCue_(normalized) &&
        !hasCameraLiveStateCue_(normalized);
    if (looksLikeFootageObservation) {
        return false;
    }

    if (signals.wantsRead) {
        return true;
    }

    if (hasCameraInventoryAnalysisCue_(normalized)) {
        return true;
    }

    return normalized.find('?') != std::string::npos &&
        containsAny_(normalized, {
            "camera", "cameras", "camara", "camaras"
        });
}

bool hasIdentityCardCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "identity card", "identity cards", "id card", "id cards",
        "card de identidade", "cards de identidade",
        "identidade", "identidades", "crop", "crops"
    });
}

bool hasOperationalHistoryCue_(const std::string& normalized)
{
    return containsAny_(normalized, {
        "history", "historico", "ledger", "audit", "auditoria",
        "timeline", "recent", "recently", "yesterday", "ontem",
        "job run", "job runs", "step run", "step runs",
        "agent run", "agent runs", "camera session", "camera sessions",
        "session", "sessions"
    });
}

bool shouldUseReadStateForOperationalHistory_(
    const std::string& normalized,
    const RoutingLexiconSignals& signals)
{
    if (signals.wantsCreate || signals.wantsEdit || signals.wantsStart || signals.wantsStop) {
        return false;
    }

    if (isReportGenerationRequest_(normalized)) {
        return false;
    }

    const bool asksIdentityCards = hasIdentityCardCue_(normalized);
    const bool asksOperationalHistory = hasOperationalHistoryCue_(normalized);
    const bool looksLikeFootageObservation =
        hasVideoMediumCue_(normalized) &&
        (hasObservationCue_(normalized) || hasQuickPresenceCue_(normalized)) &&
        !asksIdentityCards &&
        !hasConnectionConfigCue_(normalized);

    if (looksLikeFootageObservation) {
        return false;
    }

    if (asksIdentityCards) {
        return true;
    }

    if ((signals.mentionsJob || signals.mentionsStep || signals.mentionsCameraAgent) &&
        (signals.wantsRead || asksOperationalHistory || normalized.find('?') != std::string::npos)) {
        return true;
    }

    return signals.mentionsCamera && asksOperationalHistory;
}

bool shouldUseEditCamerasBatch_(
    const SkillSelection& selection,
    const std::string& normalized,
    const RoutingLexiconSignals& signals)
{
    if (selection.selectedSkill == "edit_cameras_batch" ||
        selection.operationType == "edit_cameras_batch") {
        return true;
    }

    if (selection.arguments.is_object()) {
        if (selection.arguments.contains("camera_ids") &&
            selection.arguments["camera_ids"].is_array() &&
            selection.arguments["camera_ids"].size() > 1) {
            return true;
        }
        if (selection.arguments.contains("target_scope") &&
            selection.arguments["target_scope"].is_object() &&
            !selection.arguments["target_scope"].empty()) {
            return true;
        }
    }

    if (!signals.mentionsCamera || signals.mentionsJob || signals.mentionsCameraAgent) {
        return false;
    }

    if (!signals.wantsEdit) {
        return false;
    }

    return hasCameraBatchScopeCue_(normalized);
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
    if (skillName == "control_camera") return 3;
    if (skillName == "control_job") return 3;
    if (skillName == "edit_job") return 3;
    if (skillName == "create_cameras_batch") return 3;
    if (skillName == "edit_cameras_batch") return 3;
    if (skillName == "scan_network") return 3;
    if (skillName == "read_state") return 3;
    if (skillName == "generate_report") return 4;
    if (skillName == "general_answer") return 2;
    return 1;
}

SkillSelection rewriteInstructionalSelection_(SkillSelection selection, const std::string& userMessage)
{
    const std::string normalized = lowerAsciiCopy_(userMessage);
    if ((selection.selectedSkill == "video_search" ||
         selection.selectedSkill == "general_answer" ||
         selection.selectedSkill == "explain_app" ||
         selection.selectedSkill == "read_state" ||
         selection.selectedSkill == "scan_network") &&
        isReportGenerationRequest_(normalized)) {
        selection.selectedSkill = "generate_report";
        selection.confidence = std::max(selection.confidence, 0.99);
        selection.reason = "explicit_report_generation_request";
        selection.replyPreview = "Vou preparar o relatorio.";
        selection.mode = "operate";
        selection.entity = "report";
        selection.intent = "create";
        selection.operationType = "generate_report";
        selection.operationPhase = "collecting_context";
        if (selection.taskGoal.empty()) {
            selection.taskGoal = "generate a report";
        }
        selection.arguments = nlohmann::json::object();
        return selection;
    }

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

std::string defaultIntentFamilyForSelection_(const SkillSelection& selection)
{
    if (selection.selectedSkill == "read_state") {
        return "read_operational";
    }
    if (selection.selectedSkill == "video_search") {
        return "search_media";
    }
    if (selection.selectedSkill == "generate_report") {
        return "report";
    }
    if (selection.selectedSkill == "create_camera" ||
        selection.selectedSkill == "create_cameras_batch" ||
        selection.selectedSkill == "create_camera_agent" ||
        selection.selectedSkill == "create_job") {
        return "create_config";
    }
    if (selection.selectedSkill == "edit_camera" ||
        selection.selectedSkill == "edit_cameras_batch" ||
        selection.selectedSkill == "edit_camera_agent" ||
        selection.selectedSkill == "edit_job") {
        return "edit_config";
    }
    if (selection.selectedSkill == "control_camera" ||
        selection.selectedSkill == "control_job" ||
        selection.selectedSkill == "scan_network") {
        return "run_action";
    }
    return "answer";
}

std::string defaultPlannerModeForSelection_(const SkillSelection& selection)
{
    if (selection.selectedSkill == "read_state" ||
        selection.selectedSkill == "generate_report") {
        return "operational_query";
    }
    if (selection.selectedSkill == "create_camera" ||
        selection.selectedSkill == "create_cameras_batch" ||
        selection.selectedSkill == "create_camera_agent" ||
        selection.selectedSkill == "create_job" ||
        selection.selectedSkill == "edit_camera" ||
        selection.selectedSkill == "edit_cameras_batch" ||
        selection.selectedSkill == "edit_camera_agent" ||
        selection.selectedSkill == "edit_job" ||
        selection.selectedSkill == "control_camera" ||
        selection.selectedSkill == "control_job") {
        return "mutation_grounding";
    }
    return "none";
}

SkillSelection applyRoutingLexiconCorrections_(
    SkillSelection selection,
    const std::string& userMessage,
    const nlohmann::json& conversationContext)
{
    if (selection.continueActiveTask) {
        return selection;
    }

    const std::string normalizedMessage = lowerAsciiCopy_(userMessage);
    if (isInstructionalIntent_(normalizedMessage)) {
        return selection;
    }

    const bool routeHintsWantDocument =
        selection.routeHints.is_object() &&
        selection.routeHints.contains("wants_document") &&
        ((selection.routeHints["wants_document"].is_boolean() &&
          selection.routeHints["wants_document"].get<bool>()) ||
         (selection.routeHints["wants_document"].is_number_integer() &&
          selection.routeHints["wants_document"].get<int>() != 0) ||
         (selection.routeHints["wants_document"].is_string() &&
          lowerAsciiCopy_(trimCopy_(selection.routeHints["wants_document"].get<std::string>())) == "true"));
    const bool selectionLockedToReport =
        selection.selectedSkill == "generate_report" ||
        selection.operationType == "generate_report" ||
        selection.intentFamily == "report" ||
        selection.entity == "report" ||
        routeHintsWantDocument;
    if (selectionLockedToReport) {
        return selection;
    }

    const RoutingLexiconSignals signals = detectRoutingLexiconSignals(userMessage);
    const std::string runtimeAction = runtimeActionFromRoutingSignals(signals);
    const bool selectionPrefersCreateJob =
        selection.selectedSkill == "create_job" ||
        selection.operationType == "create_job" ||
        (selection.entity == "job" && selection.intent == "create");
    const bool selectionPrefersEditJob =
        selection.selectedSkill == "edit_job" ||
        selection.operationType == "edit_job" ||
        (selection.entity == "job" && selection.intent == "update");

    auto ensureArgumentsObject = [&]() -> nlohmann::json& {
        if (!selection.arguments.is_object()) {
            selection.arguments = nlohmann::json::object();
        }
        return selection.arguments;
    };

    auto clearRuntimeActionArgument = [&]() {
        if (selection.arguments.is_object()) {
            selection.arguments.erase("runtime_action");
        }
    };

    auto forceSelection = [&](const std::string& skillName,
                              const std::string& entity,
                              const std::string& intent) {
        selection.selectedSkill = skillName;
        selection.mode = "operate";
        selection.entity = entity;
        selection.intent = intent;
        selection.operationType = skillName;
        selection.groundingRequired = false;
        selection.confidence = (std::max)(selection.confidence, 0.88);
        selection.reason = "routing_lexicon_override";
        ensureArgumentsObject()["operation_type"] = skillName;
    };

    if (signals.mentionsCameraAgent &&
        (signals.wantsCreate || signals.wantsEdit || signals.mentionsStep)) {
        if (signals.wantsEdit) {
            forceSelection("edit_camera_agent", "camera_agent", "update");
        }
        else {
            forceSelection("create_camera_agent", "camera_agent", "create");
        }
        return selection;
    }

    if (signals.mentionsJob) {
        // Authoring requests often mention schedule cadence ("run every 10s")
        // while still asking to create or edit a job artifact. Keep those
        // requests in the job-authoring flow instead of treating them as a
        // runtime start/stop command for an existing job.
        if (signals.wantsEdit || selectionPrefersEditJob) {
            clearRuntimeActionArgument();
            forceSelection("edit_job", "job", "update");
            return selection;
        }
        if (signals.wantsCreate || selectionPrefersCreateJob) {
            clearRuntimeActionArgument();
            forceSelection("create_job", "job", "create");
            return selection;
        }
        if (!runtimeAction.empty()) {
            forceSelection("control_job", "job", "update");
            ensureArgumentsObject()["runtime_action"] = runtimeAction;
            return selection;
        }
    }

    if (signals.mentionsCamera && !signals.mentionsJob && !signals.mentionsCameraAgent) {
        if (!runtimeAction.empty()) {
            forceSelection("control_camera", "camera", "update");
            ensureArgumentsObject()["runtime_action"] = runtimeAction;
            return selection;
        }
        if (signals.wantsEdit) {
            if (shouldUseEditCamerasBatch_(selection, normalizedMessage, signals)) {
                forceSelection("edit_cameras_batch", "camera", "update");
            }
            else {
                forceSelection("edit_camera", "camera", "update");
            }
            return selection;
        }
        if (shouldUseReadStateForCameraInventory_(normalizedMessage, signals)) {
            selection.selectedSkill = "read_state";
            selection.mode = "read";
            selection.entity = "state";
            selection.intent = "read";
            selection.operationType.clear();
            selection.groundingRequired = false;
            selection.confidence = (std::max)(selection.confidence, 0.9);
            selection.reason = "camera_inventory_read_request";
            selection.replyPreview = "Vou analisar o estado atual das cameras.";
            clearRuntimeActionArgument();
            return selection;
        }
    }

    if (shouldUseReadStateForOperationalHistory_(normalizedMessage, signals)) {
        selection.selectedSkill = "read_state";
        selection.mode = "read";
        selection.entity = "state";
        selection.intent = "read";
        selection.operationType.clear();
        selection.groundingRequired = false;
        selection.confidence = (std::max)(selection.confidence, 0.94);
        selection.reason = "operational_history_read_request";
        selection.replyPreview = "Vou analisar o historico operacional.";
        clearRuntimeActionArgument();
        return selection;
    }

    return selection;
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
    if (selection.selectedSkill == "control_camera") {
        return "control_camera";
    }
    if (selection.selectedSkill == "edit_camera_agent") {
        return "edit_camera_agent";
    }
    if (selection.selectedSkill == "control_job") {
        return "control_job";
    }
    if (selection.selectedSkill == "edit_job") {
        return "edit_job";
    }

    if (selection.continueActiveTask) {
        const std::string activeTask = activeOperationTaskType(conversationContext);
        if (!activeTask.empty()) {
            return activeTask;
        }
    }

    const std::string operationType = trimCopy_(selection.operationType);
    if (!operationType.empty()) {
        if (operationType == "generate_report") {
            return "generate_report";
        }
        return operationType;
    }

    const std::string mode = normalizeSemanticToken_(selection.mode);
    const std::string entity = normalizeSemanticToken_(selection.entity);
    const std::string intent = normalizeSemanticToken_(selection.intent);
    const bool hasRuntimeAction =
        selection.arguments.is_object() &&
        selection.arguments.contains("runtime_action") &&
        selection.arguments["runtime_action"].is_string() &&
        !trimCopy_(selection.arguments["runtime_action"].get<std::string>()).empty();

    if (entity == "video" || intent == "inspect") {
        return "video_search";
    }
    if (entity == "report") {
        return "generate_report";
    }
    if (entity == "state" || mode == "read" || intent == "read") {
        return "read_state";
    }
    if (entity == "camera" && intent == "update") {
        return hasRuntimeAction ? "control_camera" : "edit_camera";
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
    if (entity == "job" && intent == "update" && hasRuntimeAction) {
        return "control_job";
    }
    if (entity == "job" && intent == "update") {
        return "edit_job";
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
        semanticSkill == "control_camera" ||
        semanticSkill == "edit_camera" ||
        semanticSkill == "edit_camera_agent" ||
        semanticSkill == "edit_cameras_batch" ||
        semanticSkill == "create_cameras_batch" ||
        semanticSkill == "create_camera_agent" ||
        semanticSkill == "create_job" ||
        semanticSkill == "control_job" ||
        semanticSkill == "edit_job" ||
        semanticSkill == "scan_network" ||
        semanticSkill == "generate_report" ||
        semanticSkill == "read_state" ||
        semanticSkill == "video_search";
}

SkillSelection applySemanticSelectionPlan_(
    SkillSelection selection,
    const std::string& userMessage,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext)
{
    selection.mode = normalizeSemanticToken_(selection.mode);
    selection.entity = normalizeSemanticToken_(selection.entity);
    selection.intent = normalizeSemanticToken_(selection.intent);
    selection.intentFamily = normalizeSemanticToken_(selection.intentFamily);
    selection.plannerMode = normalizeSemanticToken_(selection.plannerMode);
    selection.operationType = normalizeSemanticToken_(selection.operationType);
    selection.operationPhase = normalizeSemanticToken_(selection.operationPhase);
    selection = applyRoutingLexiconCorrections_(std::move(selection), userMessage, conversationContext);

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
         selection.selectedSkill == "control_camera" ||
         selection.selectedSkill == "edit_camera" ||
         selection.selectedSkill == "edit_camera_agent" ||
         selection.selectedSkill == "edit_cameras_batch" ||
         selection.selectedSkill == "create_cameras_batch" ||
         selection.selectedSkill == "create_camera_agent" ||
         selection.selectedSkill == "create_job" ||
         selection.selectedSkill == "control_job" ||
         selection.selectedSkill == "edit_job" ||
         selection.selectedSkill == "generate_report" ||
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
        else if (selection.selectedSkill == "control_camera" ||
                 selection.selectedSkill == "control_job") {
            selection.intent = selection.continueActiveTask ? "continue" : "update";
        }
        else if (selection.selectedSkill == "edit_camera" ||
                 selection.selectedSkill == "edit_camera_agent" ||
                 selection.selectedSkill == "edit_cameras_batch" ||
                 selection.selectedSkill == "edit_job") {
            selection.intent = selection.continueActiveTask ? "continue" : "update";
        }
        else if (selection.selectedSkill == "scan_network") {
            selection.intent = "inspect";
        }
        else if (selection.selectedSkill == "generate_report") {
            selection.intent = "create";
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
            selection.selectedSkill == "control_camera" ||
            selection.selectedSkill == "edit_camera" ||
            selection.selectedSkill == "edit_camera_agent" ||
            selection.selectedSkill == "edit_cameras_batch" ||
            selection.selectedSkill == "create_cameras_batch" ||
            selection.selectedSkill == "create_camera_agent" ||
            selection.selectedSkill == "create_job" ||
            selection.selectedSkill == "control_job" ||
            selection.selectedSkill == "edit_job" ||
            selection.selectedSkill == "generate_report" ||
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

    if (selection.intentFamily.empty()) {
        selection.intentFamily = defaultIntentFamilyForSelection_(selection);
    }
    if (selection.plannerMode.empty()) {
        selection.plannerMode = defaultPlannerModeForSelection_(selection);
    }
    if (selection.routeVersion.empty()) {
        selection.routeVersion = "v2";
    }
    if (!selection.routeHints.is_object()) {
        selection.routeHints = nlohmann::json::object();
    }
    if (!selection.routeHints.contains("needs_entity_grounding")) {
        const bool needsEntityGrounding =
            selection.plannerMode == "operational_query" ||
            selection.plannerMode == "mutation_grounding";
        selection.routeHints["needs_entity_grounding"] = needsEntityGrounding;
    }
    if (!selection.routeHints.contains("needs_time_grounding")) {
        selection.routeHints["needs_time_grounding"] =
            selection.selectedSkill == "read_state" ||
            selection.selectedSkill == "generate_report";
    }
    if (!selection.routeHints.contains("wants_document")) {
        selection.routeHints["wants_document"] = selection.selectedSkill == "generate_report";
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

nlohmann::json sanitizeVideoRoutingScope_(const nlohmann::json& source)
{
    nlohmann::json sanitized = nlohmann::json::object();
    if (!source.is_object()) {
        return sanitized;
    }

    if (source.contains("camera_ids") && source["camera_ids"].is_array()) {
        nlohmann::json cameraIds = nlohmann::json::array();
        for (const auto& item : source["camera_ids"]) {
            if (!item.is_number_integer()) {
                continue;
            }
            const int cameraId = item.get<int>();
            if (cameraId <= 0) {
                continue;
            }
            cameraIds.push_back(cameraId);
            if (cameraIds.size() >= 8) {
                break;
            }
        }
        if (!cameraIds.empty()) {
            sanitized["camera_ids"] = std::move(cameraIds);
        }
    }

    if (source.contains("camera_names") && source["camera_names"].is_array()) {
        nlohmann::json cameraNames = nlohmann::json::array();
        for (const auto& item : source["camera_names"]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string value = truncateForContext_(item.get<std::string>(), 120);
            if (value.empty()) {
                continue;
            }
            cameraNames.push_back(value);
            if (cameraNames.size() >= 8) {
                break;
            }
        }
        if (!cameraNames.empty()) {
            sanitized["camera_names"] = std::move(cameraNames);
        }
    }

    if (source.contains("all_cameras") && source["all_cameras"].is_boolean()) {
        sanitized["all_cameras"] = source["all_cameras"].get<bool>();
    }

    if (source.contains("time_window_minutes_before_now") &&
        source["time_window_minutes_before_now"].is_number_integer()) {
        sanitized["time_window_minutes_before_now"] = std::max(
            0,
            source["time_window_minutes_before_now"].get<int>());
    }

    if (source.contains("query") && source["query"].is_string()) {
        const std::string query = truncateForContext_(source["query"].get<std::string>(), 240);
        if (!query.empty()) {
            sanitized["query"] = query;
        }
    }

    if (source.contains("updated_at") && source["updated_at"].is_string()) {
        const std::string updatedAt = truncateForContext_(source["updated_at"].get<std::string>(), 64);
        if (!updatedAt.empty()) {
            sanitized["updated_at"] = updatedAt;
        }
    }

    return sanitized;
}

std::string sanitizeVideoRoutingImageUrl_(const std::string& raw)
{
    const std::string value = truncateForContext_(raw, 600);
    if (value.empty()) {
        return std::string();
    }
    const std::string lower = lowerAsciiCopy_(value);
    if (lower.rfind("data:", 0) == 0) {
        return std::string();
    }
    return value;
}

nlohmann::json sanitizeVideoRoutingIdentityCard_(const nlohmann::json& source)
{
    nlohmann::json sanitized = nlohmann::json::object();
    if (!source.is_object()) {
        return sanitized;
    }

    const auto copyStringField = [&](const char* key, std::size_t maxChars) {
        if (key == nullptr || !source.contains(key) || !source[key].is_string()) {
            return;
        }
        const std::string value = truncateForContext_(source[key].get<std::string>(), maxChars);
        if (!value.empty()) {
            sanitized[key] = value;
        }
    };
    const auto copyStringArrayField = [&](const char* key, std::size_t maxItems, std::size_t maxChars) {
        if (key == nullptr || !source.contains(key) || !source[key].is_array()) {
            return;
        }
        nlohmann::json values = nlohmann::json::array();
        std::vector<std::string> seen;
        for (const auto& item : source[key]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string value = truncateForContext_(item.get<std::string>(), maxChars);
            if (value.empty() ||
                std::find(seen.begin(), seen.end(), value) != seen.end())
            {
                continue;
            }
            seen.push_back(value);
            values.push_back(value);
            if (values.size() >= maxItems) {
                break;
            }
        }
        if (!values.empty()) {
            sanitized[key] = std::move(values);
        }
    };

    copyStringField("card_id", 160);
    copyStringField("entity_id", 120);
    copyStringField("entity_type", 64);
    copyStringField("display_name", 160);
    copyStringField("known_name", 160);
    copyStringField("description", 320);
    copyStringField("identity_signature_summary", 320);
    copyStringArrayField("aliases", 8, 120);
    copyStringArrayField("identity_signature_traits", 8, 120);
    copyStringArrayField("key_traits", 8, 120);
    copyStringArrayField("stable_attributes", 8, 120);

    if (source.contains("resolved_identity") && source["resolved_identity"].is_object()) {
        nlohmann::json resolvedIdentity = nlohmann::json::object();
        const auto& resolvedSource = source["resolved_identity"];
        if (resolvedSource.contains("target_name") && resolvedSource["target_name"].is_string()) {
            const std::string value = truncateForContext_(resolvedSource["target_name"].get<std::string>(), 160);
            if (!value.empty()) resolvedIdentity["target_name"] = value;
        }
        if (resolvedSource.contains("target_description") && resolvedSource["target_description"].is_string()) {
            const std::string value =
                truncateForContext_(resolvedSource["target_description"].get<std::string>(), 240);
            if (!value.empty()) resolvedIdentity["target_description"] = value;
        }
        if (resolvedSource.contains("source") && resolvedSource["source"].is_string()) {
            const std::string value = truncateForContext_(resolvedSource["source"].get<std::string>(), 64);
            if (!value.empty()) resolvedIdentity["source"] = value;
        }
        if (resolvedSource.contains("target_id") && resolvedSource["target_id"].is_number_integer()) {
            const int targetId = resolvedSource["target_id"].get<int>();
            if (targetId > 0) resolvedIdentity["target_id"] = targetId;
        }
        if (!resolvedIdentity.empty()) {
            sanitized["resolved_identity"] = std::move(resolvedIdentity);
        }
    }

    if (source.contains("primary_portrait") && source["primary_portrait"].is_object()) {
        const auto& portraitSource = source["primary_portrait"];
        nlohmann::json portrait = nlohmann::json::object();
        if (portraitSource.contains("asset_id") && portraitSource["asset_id"].is_string()) {
            const std::string value = truncateForContext_(portraitSource["asset_id"].get<std::string>(), 160);
            if (!value.empty()) portrait["asset_id"] = value;
        }
        if (portraitSource.contains("portrait_kind") && portraitSource["portrait_kind"].is_string()) {
            const std::string value =
                truncateForContext_(portraitSource["portrait_kind"].get<std::string>(), 64);
            if (!value.empty()) portrait["portrait_kind"] = value;
        }
        if (portraitSource.contains("timestamp_utc_iso") && portraitSource["timestamp_utc_iso"].is_string()) {
            const std::string value =
                truncateForContext_(portraitSource["timestamp_utc_iso"].get<std::string>(), 64);
            if (!value.empty()) portrait["timestamp_utc_iso"] = value;
        }
        if (portraitSource.contains("camera_name") && portraitSource["camera_name"].is_string()) {
            const std::string value =
                truncateForContext_(portraitSource["camera_name"].get<std::string>(), 120);
            if (!value.empty()) portrait["camera_name"] = value;
        }
        if (portraitSource.contains("camera_id") && portraitSource["camera_id"].is_number_integer()) {
            const int cameraId = portraitSource["camera_id"].get<int>();
            if (cameraId > 0) portrait["camera_id"] = cameraId;
        }
        if (portraitSource.contains("image_url") && portraitSource["image_url"].is_string()) {
            const std::string imageUrl =
                sanitizeVideoRoutingImageUrl_(portraitSource["image_url"].get<std::string>());
            if (!imageUrl.empty()) portrait["image_url"] = imageUrl;
        }
        if (!portrait.empty()) {
            sanitized["primary_portrait"] = std::move(portrait);
        }
    }

    if (source.contains("portrait_url") && source["portrait_url"].is_string()) {
        const std::string portraitUrl =
            sanitizeVideoRoutingImageUrl_(source["portrait_url"].get<std::string>());
        if (!portraitUrl.empty()) {
            sanitized["portrait_url"] = portraitUrl;
        }
    }

    return sanitized;
}

nlohmann::json sanitizeVideoRoutingLastPositiveHit_(const nlohmann::json& source)
{
    nlohmann::json sanitized = nlohmann::json::object();
    if (!source.is_object()) {
        return sanitized;
    }

    const auto copyStringField = [&](const char* key, std::size_t maxChars) {
        if (key == nullptr || !source.contains(key) || !source[key].is_string()) {
            return;
        }
        const std::string value = truncateForContext_(source[key].get<std::string>(), maxChars);
        if (!value.empty()) {
            sanitized[key] = value;
        }
    };
    const auto copyStringArrayField = [&](const char* key, std::size_t maxItems, std::size_t maxChars) {
        if (key == nullptr || !source.contains(key) || !source[key].is_array()) {
            return;
        }
        nlohmann::json values = nlohmann::json::array();
        std::vector<std::string> seen;
        for (const auto& item : source[key]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string value = truncateForContext_(item.get<std::string>(), maxChars);
            if (value.empty() ||
                std::find(seen.begin(), seen.end(), value) != seen.end())
            {
                continue;
            }
            seen.push_back(value);
            values.push_back(value);
            if (values.size() >= maxItems) {
                break;
            }
        }
        if (!values.empty()) {
            sanitized[key] = std::move(values);
        }
    };
    const auto copyIntegerArrayField = [&](const char* key, std::size_t maxItems) {
        if (key == nullptr || !source.contains(key) || !source[key].is_array()) {
            return;
        }
        nlohmann::json values = nlohmann::json::array();
        for (const auto& item : source[key]) {
            if (!item.is_number_integer()) {
                continue;
            }
            const int value = item.get<int>();
            if (value <= 0) {
                continue;
            }
            values.push_back(value);
            if (values.size() >= maxItems) {
                break;
            }
        }
        if (!values.empty()) {
            sanitized[key] = std::move(values);
        }
    };

    copyIntegerArrayField("camera_ids", 8);
    copyStringArrayField("camera_names", 8, 120);
    if (source.contains("all_cameras") && source["all_cameras"].is_boolean()) {
        sanitized["all_cameras"] = source["all_cameras"].get<bool>();
    }
    if (source.contains("time_window_minutes_before_now") &&
        source["time_window_minutes_before_now"].is_number_integer())
    {
        sanitized["time_window_minutes_before_now"] =
            (std::max)(0, source["time_window_minutes_before_now"].get<int>());
    }
    if (source.contains("camera_id") && source["camera_id"].is_number_integer()) {
        const int cameraId = source["camera_id"].get<int>();
        if (cameraId > 0) sanitized["camera_id"] = cameraId;
    }

    copyStringField("camera_name", 120);
    copyStringField("query", 240);
    copyStringField("segment_start_ts", 64);
    copyStringField("segment_end_ts", 64);
    copyStringField("event_timestamp_utc_iso", 64);
    copyStringField("event_timestamp_local_iso", 64);
    copyStringField("primary_identity_card_id", 160);
    copyStringField("display_name", 160);
    copyStringField("updated_at", 64);
    copyStringArrayField("detection_time_in_video", 4, 64);
    copyStringArrayField("matched_entity_ids", 8, 120);

    if (source.contains("identity_cards") && source["identity_cards"].is_array()) {
        nlohmann::json cards = nlohmann::json::array();
        for (const auto& item : source["identity_cards"]) {
            nlohmann::json card = sanitizeVideoRoutingIdentityCard_(item);
            if (card.empty()) {
                continue;
            }
            cards.push_back(std::move(card));
            if (cards.size() >= 3) {
                break;
            }
        }
        if (!cards.empty()) {
            sanitized["identity_cards"] = std::move(cards);
        }
    }

    if (source.contains("portrait_url") && source["portrait_url"].is_string()) {
        const std::string portraitUrl =
            sanitizeVideoRoutingImageUrl_(source["portrait_url"].get<std::string>());
        if (!portraitUrl.empty()) {
            sanitized["portrait_url"] = portraitUrl;
        }
    }

    return sanitized;
}

std::string videoRoutingScopeKey_(const nlohmann::json& scope)
{
    if (!scope.is_object()) {
        return "";
    }

    std::vector<std::string> parts;
    if (scope.contains("camera_ids") && scope["camera_ids"].is_array()) {
        std::ostringstream ids;
        bool first = true;
        for (const auto& item : scope["camera_ids"]) {
            if (!item.is_number_integer()) {
                continue;
            }
            if (!first) {
                ids << ",";
            }
            ids << item.get<int>();
            first = false;
        }
        if (!first) {
            parts.push_back("ids:" + ids.str());
        }
    }

    if (scope.contains("camera_names") && scope["camera_names"].is_array()) {
        std::ostringstream names;
        bool first = true;
        for (const auto& item : scope["camera_names"]) {
            if (!item.is_string()) {
                continue;
            }
            if (!first) {
                names << "|";
            }
            names << lowerAsciiCopy_(item.get<std::string>());
            first = false;
        }
        if (!first) {
            parts.push_back("names:" + names.str());
        }
    }

    if (scope.contains("all_cameras") && scope["all_cameras"].is_boolean()) {
        parts.push_back(std::string("all:") + (scope["all_cameras"].get<bool>() ? "1" : "0"));
    }

    if (parts.empty()) {
        return "";
    }

    std::ostringstream joined;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i > 0) {
            joined << ";";
        }
        joined << parts[i];
    }
    return joined.str();
}

nlohmann::json buildVideoRoutingContext_(const nlohmann::json& conversationContext)
{
    nlohmann::json routingContext = nlohmann::json::object();
    if (!conversationContext.is_object()) {
        return routingContext;
    }

    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (taskState.contains("session_entities") && taskState["session_entities"].is_object()) {
        const auto& sessionEntities = taskState["session_entities"];
        nlohmann::json lastScope = sanitizeVideoRoutingScope_(
            sessionEntities.value("last_video_scope", nlohmann::json::object()));
        if (lastScope.empty() &&
            sessionEntities.contains("last_camera_name") &&
            sessionEntities["last_camera_name"].is_string()) {
            const std::string lastCameraName = truncateForContext_(
                sessionEntities["last_camera_name"].get<std::string>(),
                120);
            if (!lastCameraName.empty()) {
                lastScope["camera_names"] = nlohmann::json::array({ lastCameraName });
            }
        }
        if (!lastScope.empty()) {
            routingContext["last_video_scope"] = lastScope;
        }
        nlohmann::json lastPositiveHit = sanitizeVideoRoutingLastPositiveHit_(
            sessionEntities.value("last_positive_hit", nlohmann::json::object()));
        if (!lastPositiveHit.empty()) {
            routingContext["last_positive_hit"] = std::move(lastPositiveHit);
        }
    }

    std::vector<std::string> seenScopeKeys;
    nlohmann::json recentScopes = nlohmann::json::array();
    if (conversationContext.contains("recent_turns") && conversationContext["recent_turns"].is_array()) {
        const auto& recentTurns = conversationContext["recent_turns"];
        nlohmann::json recentTurnsForRouter = nlohmann::json::array();
        const std::size_t excerptStart = recentTurns.size() > 6 ? recentTurns.size() - 6 : 0;
        for (std::size_t i = excerptStart; i < recentTurns.size(); ++i) {
            const auto& turn = recentTurns[i];
            if (!turn.is_object()) {
                continue;
            }
            const std::string content = truncateForContext_(
                turn.value("content", std::string()),
                240);
            if (content.empty()) {
                continue;
            }
            nlohmann::json item = {
                { "role", turn.value("role", std::string()) },
                { "content", content },
            };
            const std::string messageType = turn.value("message_type", std::string());
            if (!messageType.empty()) {
                item["message_type"] = messageType;
            }
            recentTurnsForRouter.push_back(std::move(item));
        }
        if (!recentTurnsForRouter.empty()) {
            routingContext["recent_turns"] = std::move(recentTurnsForRouter);
        }

        for (auto it = recentTurns.rbegin(); it != recentTurns.rend(); ++it) {
            if (!it->is_object() || !it->contains("camera_selection")) {
                continue;
            }
            nlohmann::json scope = sanitizeVideoRoutingScope_((*it)["camera_selection"]);
            if (scope.empty()) {
                continue;
            }
            const std::string scopeKey = videoRoutingScopeKey_(scope);
            if (scopeKey.empty() ||
                std::find(seenScopeKeys.begin(), seenScopeKeys.end(), scopeKey) != seenScopeKeys.end()) {
                continue;
            }
            seenScopeKeys.push_back(scopeKey);
            recentScopes.push_back(std::move(scope));
            if (recentScopes.size() >= 3) {
                break;
            }
        }
    }

    if (!recentScopes.empty()) {
        if (!routingContext.contains("last_video_scope")) {
            routingContext["last_video_scope"] = recentScopes[0];
        }
        routingContext["recent_camera_scopes"] = std::move(recentScopes);
    }

    const nlohmann::json compactContext = normalizeCompactConversationContext_(
        conversationContext.value("compact_context", nlohmann::json::object()));
    const std::string summary = compactContext.value("summary", std::string());
    if (!summary.empty()) {
        routingContext["compact_summary"] = summary;
    }
    if (compactContext.contains("selected_entities") &&
        compactContext["selected_entities"].is_array() &&
        !compactContext["selected_entities"].empty()) {
        routingContext["selected_entities"] = compactContext["selected_entities"];
    }

    return routingContext;
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

        if (unavailableSelection.reason == "router_failed") {
            emitChatRouterApiErrorEvent_(agent, payload, llm);
        }

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
            selection.selectedSkill == "read_state" ||
            selection.selectedSkill == "generate_report")
        {
            pauseForProgressVisibility();
        }
    }

    nlohmann::json effectivePayload = payload;
    if (!effectivePayload.is_object()) {
        effectivePayload = nlohmann::json::object();
    }
    if (!selection.replyLanguage.empty()) {
        effectivePayload["reply_language"] = selection.replyLanguage;
        effectivePayload["language"] = selection.replyLanguage;
    }
    else if (queryLanguageSourceFromPayload_(payload) != "detected") {
        if (effectivePayload.contains("reply_language")) {
            effectivePayload.erase("reply_language");
        }
        if (effectivePayload.contains("language")) {
            effectivePayload.erase("language");
        }
    }
    if (selection.selectedSkill == "video_search") {
        const nlohmann::json videoRoutingContext = buildVideoRoutingContext_(conversationContext);
        if (videoRoutingContext.is_object() && !videoRoutingContext.empty()) {
            effectivePayload["video_routing_context"] = videoRoutingContext;
        }
    }
    if (isAuthoringSkill_(selection.selectedSkill)) {
        effectivePayload["authoring_context_enabled"] = true;
    }

    SkillRunResult result = registry_.execute(selection.selectedSkill, agent, effectivePayload, selection);
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
        forcedSelection = applySemanticSelectionPlan_(std::move(forcedSelection), userMessage, payload, conversationContext);
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
        forcedSelection = applySemanticSelectionPlan_(std::move(forcedSelection), userMessage, payload, conversationContext);
        return forcedSelection;
    };

    if (shouldBypassRouterForActiveBatchContinuation_(payload, userMessage, conversationContext)) {
        return finalizeForcedSelection(
            buildActiveBatchContinuationSelection_(conversationContext));
    }

    if (!heuristic.selectedSkill.empty() &&
        (heuristic.reason == "uploaded_media_requires_video_search" ||
         heuristic.reason == "prefer_identity_recall"))
    {
        return finalizeForcedSelection(heuristic);
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
            { "routing_lexicon", routingLexicon() },
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
        selection = applySemanticSelectionPlan_(std::move(selection), userMessage, payload, conversationContext);
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
        selection = applySemanticSelectionPlan_(std::move(selection), userMessage, payload, conversationContext);
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
        SkillSelection rewritten = applySemanticSelectionPlan_(heuristic, userMessage, payload, conversationContext);
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
        rewritten = applySemanticSelectionPlan_(std::move(rewritten), userMessage, payload, conversationContext);
        return rewritten;
    }

    SkillSelection fallback;
    fallback.selectedSkill = llm.isConfigured() ? "general_answer" : "explain_app";
    fallback.confidence = 0.10;
    fallback.reason = "default_fallback";
    fallback.replyPreview = llm.isConfigured()
        ? "Vou responder diretamente."
        : "Vou responder usando a skill de ajuda do aplicativo.";
    fallback = applySemanticSelectionPlan_(std::move(fallback), userMessage, payload, conversationContext);
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
    fallback = applySemanticSelectionPlan_(std::move(fallback), userMessage, payload, conversationContext);
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

    if (payload.is_object() &&
        payload.value("prefer_identity_recall", false))
    {
        selection.selectedSkill = "video_search";
        selection.confidence = 0.98;
        selection.reason = "prefer_identity_recall";
        selection.replyPreview = "Vou recuperar a identidade mais relevante desta conversa.";
        selection.mode = "read";
        selection.entity = "identity";
        selection.intent = "recall";
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
        { std::regex("\\b(read_state|video_search|create_camera|control_camera|create_job|control_job|edit_job|create_camera_agent|edit_camera_agent|scan_network|generate_report|explain_app|chatv2)\\b", std::regex::icase), "assistant" },
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
    const auto compactText = [](const std::string& value, std::size_t maxLen) {
        std::string compact = std::regex_replace(value, std::regex("\\s+"), " ");
        compact = trimCopy_(compact);
        if (compact.size() > maxLen) {
            compact = compact.substr(0, maxLen - 3) + "...";
        }
        return compact;
    };

    Logger::instance().logDebug(
        "agent",
        "ChatV2Orchestrator::recordRoutingTelemetry_: session=" +
        std::to_string(chatSessionId) +
        " command=" + std::to_string(commandId) +
        " mode=" + routingMode +
        " skill=" + (selection.selectedSkill.empty() ? std::string("unavailable") : selection.selectedSkill) +
        " confidence=" + std::to_string(selection.confidence) +
        " reason=" + compactText(selection.reason, 160) +
        " query=\"" + compactText(originalQuery, 220) + "\""
    );

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
        { "intent_family", selection.intentFamily.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.intentFamily) },
        { "planner_mode", selection.plannerMode.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.plannerMode) },
        { "route_version", selection.routeVersion.empty() ? nlohmann::json(nullptr) : nlohmann::json(selection.routeVersion) },
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
    if (!selection.routeHints.is_null() && !selection.routeHints.empty()) {
        metadata["route_hints"] = selection.routeHints;
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

    nlohmann::json responseBody = {
        { "chat_session_id", chatSessionId },
        { "command_id", commandId },
        { "original_query", originalQuery },
        { "answer", result.answer },
        { "response_type", "final_answer" },
        { "model_prompt_tokens", 0 },
        { "model_output_tokens", 0 },
        { "model_total_tokens", 0 },
    };
    if (!selection.replyLanguage.empty()) {
        responseBody["reply_language"] = selection.replyLanguage;
    }
    if (result.metadata.is_object() &&
        result.metadata.contains("message_metadata") &&
        result.metadata["message_metadata"].is_object()) {
        responseBody["message_metadata"] = result.metadata["message_metadata"];
    }

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/chat-response?client_id=" + agent.getClientId();
    const HttpResponse response = postJson(
        url,
        responseBody.dump(),
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

#include "GenerateReportSkill.h"

#include <algorithm>
#include <cctype>
#include <sstream>
#include <string>
#include <vector>

#include "../ChatModelConfig.h"
#include "../HttpUtils.h"
#include "../LocalLlmClient.h"
#include "../OperationTaskState.h"
#include "../ProgressUtils.h"
#include "../PromptBuilder.h"
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

std::string effectiveReplyLanguage_(
    const SkillSelection& selection,
    const nlohmann::json& payload)
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
        << "/api/agent/chat-context?client_id=" << clientIdFromPayload_(payload, agent)
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

std::string stringField_(const nlohmann::json& value, const char* key)
{
    if (!value.is_object() || !value.contains(key) || !value[key].is_string()) {
        return "";
    }
    return trimCopy_(value[key].get<std::string>());
}

std::string reportKindLabel_(const std::string& reportKind, const std::string& language)
{
    const std::string normalized = lowerAsciiCopy_(reportKind);
    if (language == "pt") {
        if (normalized == "current_state") return "estado atual";
        if (normalized == "history") return "historico";
        if (normalized == "camera_health") return "saude de cameras";
        if (normalized == "job_activity") return "atividade de jobs";
        if (normalized == "agent_activity") return "atividade de agentes";
        if (normalized == "detections_alerts") return "deteccoes e alertas";
        if (normalized == "chat_discussion") return "discussao do chat";
        if (normalized == "system_activity") return "atividade do sistema";
        if (normalized == "comparison") return "comparativo";
        return "relatorio geral";
    }

    if (normalized == "current_state") return "current state";
    if (normalized == "history") return "history";
    if (normalized == "camera_health") return "camera health";
    if (normalized == "job_activity") return "job activity";
    if (normalized == "agent_activity") return "agent activity";
    if (normalized == "detections_alerts") return "detections and alerts";
    if (normalized == "chat_discussion") return "chat discussion";
    if (normalized == "system_activity") return "system activity";
    if (normalized == "comparison") return "comparison";
    return "general report";
}

std::string buildFallbackChatAnswer_(
    const nlohmann::json& context,
    const nlohmann::json& messageMetadata,
    const std::string& language)
{
    const std::string title = stringField_(messageMetadata, "title");
    const std::string summary =
        stringField_(messageMetadata, "summary").empty()
            ? stringField_(context, "summary_seed")
            : stringField_(messageMetadata, "summary");
    const bool hasEvidence =
        messageMetadata.is_object() &&
        messageMetadata.contains("evidence_download_path") &&
        messageMetadata["evidence_download_path"].is_string() &&
        !trimCopy_(messageMetadata["evidence_download_path"].get<std::string>()).empty();

    if (language == "pt") {
        std::ostringstream out;
        out << "Preparei o relatorio";
        if (!title.empty()) {
            out << " \"" << title << "\"";
        }
        out << ".";
        if (!summary.empty()) {
            out << "\n\n" << summary;
        }
        out << "\n\nUse o botao de download no chat para baixar o documento";
        if (hasEvidence) {
            out << " e o pacote de evidencias";
        }
        out << ".";
        return out.str();
    }

    std::ostringstream out;
    out << "I prepared the report";
    if (!title.empty()) {
        out << " \"" << title << "\"";
    }
    out << ".";
    if (!summary.empty()) {
        out << "\n\n" << summary;
    }
    out << "\n\nUse the download button in chat to get the document";
    if (hasEvidence) {
        out << " and the evidence package";
    }
    out << ".";
    return out.str();
}

nlohmann::json buildFallbackSections_(const nlohmann::json& context, const std::string& language)
{
    nlohmann::json sections = nlohmann::json::array();

    const std::string summary = stringField_(context, "summary_seed");
    const nlohmann::json topFindings =
        context.is_object() && context.contains("top_findings_seed") && context["top_findings_seed"].is_array()
            ? context["top_findings_seed"]
            : nlohmann::json::array();
    const nlohmann::json limitations =
        context.is_object() && context.contains("limitations") && context["limitations"].is_array()
            ? context["limitations"]
            : nlohmann::json::array();

    sections.push_back({
        { "heading", language == "pt" ? "Resumo executivo" : "Executive summary" },
        { "paragraphs", summary.empty() ? nlohmann::json::array() : nlohmann::json::array({ summary }) },
        { "bullets", topFindings },
    });

    if (!limitations.empty()) {
        sections.push_back({
            { "heading", language == "pt" ? "Limitacoes" : "Limitations" },
            { "paragraphs", nlohmann::json::array() },
            { "bullets", limitations },
        });
    }

    return sections;
}

std::string buildDraftSystemPrompt_()
{
    std::ostringstream out;
    out
        << "/no_think\n"
        << "You are drafting a structured report package for the user inside the app.\n"
        << "Return only one JSON object.\n"
        << "The JSON object must contain:\n"
        << "- chat_answer: short markdown shown in chat after the report is generated.\n"
        << "- report_title: concise user-facing report title.\n"
        << "- report_summary: 1 to 3 short paragraphs or sentences.\n"
        << "- sections: array of up to 6 objects with heading, paragraphs, and bullets.\n"
        << "- stats: array of up to 8 objects with label and value.\n"
        << "Use only facts present in report_context.\n"
        << "Do not invent live data, detections, timelines, or evidence.\n"
        << "If rollups are empty or evidence is limited, acknowledge that briefly.\n"
        << "Write in reply_language.\n"
        << "Never mention internal skills, endpoints, payloads, JSON, or implementation details.\n";
    return out.str();
}

std::string buildDraftUserPrompt_(
    const std::string& query,
    const std::string& language,
    const nlohmann::json& context)
{
    nlohmann::json promptPayload = {
        { "reply_language", language },
        { "user_query", query },
        { "report_context", context },
    };
    return promptPayload.dump(2);
}

} // namespace

SkillDefinition GenerateReportSkill::definition() const
{
    return {
        "generate_report",
        "Builds a report document from current state, history, detections, jobs, agents, and chat context.",
        true,
    };
}

SkillRunResult GenerateReportSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "generate_report";
    result.metadata["skip_polish"] = true;

    const std::string language = effectiveReplyLanguage_(selection, payload);
    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string query =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const int chatSessionId =
        payload.is_object() ? payload.value("chat_session_id", -1) : -1;
    const int beforeMessageId =
        payload.is_object() ? payload.value("context_before_message_id", 0) : 0;

    if (chatSessionId <= 0) {
        result.answer = language == "pt"
            ? "Consigo montar o relatorio, mas preciso que o pedido venha dentro de uma sessao de chat valida."
            : "I can build the report, but I need the request to come from a valid chat session.";
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "generate_report", "collecting_context", 2, 2, 4));
    pauseForProgressVisibility();

    nlohmann::json contextRequest = {
        { "chat_session_id", chatSessionId },
        { "query", query },
        { "reply_language", language },
    };
    if (beforeMessageId > 0) {
        contextRequest["context_before_message_id"] = beforeMessageId;
    }

    const std::string contextUrl =
        agent.getBackendBaseUrl() +
        "/api/agent/reports/build-context?client_id=" + clientIdFromPayload_(payload, agent);
    const HttpResponse contextResponse = postJson(
        contextUrl,
        contextRequest.dump(),
        agent.getExeToken(),
        {},
        20000);

    if (!contextResponse.ok()) {
        const std::string errorMessage = parseErrorMessage_(contextResponse);
        result.answer = language == "pt"
            ? "Tentei preparar o contexto do relatorio, mas nao consegui concluir agora. Detalhe: " + errorMessage + "."
            : "I tried to prepare the report context, but I could not complete it right now. Detail: " + errorMessage + ".";
        return result;
    }

    const nlohmann::json reportContext = nlohmann::json::parse(contextResponse.body, nullptr, false);
    if (!reportContext.is_object()) {
        result.answer = language == "pt"
            ? "Consegui iniciar a geracao do relatorio, mas o contexto voltou em um formato invalido."
            : "I was able to start the report generation, but the context came back in an invalid format.";
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "generate_report", "drafting_report", 3, 3, 4));
    pauseForProgressVisibility();

    LocalLlmClient llm;
    configureActionModelClient_(llm, payload);

    std::string reportTitle = stringField_(reportContext, "title");
    std::string reportSummary = stringField_(reportContext, "summary_seed");
    std::string chatAnswer;
    nlohmann::json sections = nlohmann::json::array();
    nlohmann::json stats = nlohmann::json::array();

    if (llm.isConfigured()) {
        const LocalLlmClient::CompletionOutcome draftOutcome = llm.completeText(
            "generate_report",
            buildDraftSystemPrompt_(),
            buildDraftUserPrompt_(query, language, reportContext),
            0.15,
            2200,
            45000,
            -1,
            true);

        if (draftOutcome.ok) {
            const nlohmann::json drafted = nlohmann::json::parse(draftOutcome.content, nullptr, false);
            if (drafted.is_object()) {
                const std::string draftedTitle = stringField_(drafted, "report_title");
                if (!draftedTitle.empty()) {
                    reportTitle = draftedTitle;
                }

                const std::string draftedSummary = stringField_(drafted, "report_summary");
                if (!draftedSummary.empty()) {
                    reportSummary = draftedSummary;
                }

                const std::string draftedChatAnswer = stringField_(drafted, "chat_answer");
                if (!draftedChatAnswer.empty()) {
                    chatAnswer = draftedChatAnswer;
                }

                if (drafted.contains("sections") && drafted["sections"].is_array()) {
                    sections = drafted["sections"];
                }
                if (drafted.contains("stats") && drafted["stats"].is_array()) {
                    stats = drafted["stats"];
                }
            }
        }
    }

    if (!sections.is_array() || sections.empty()) {
        sections = buildFallbackSections_(reportContext, language);
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "generate_report", "finalizing", 4, 4, 4));

    nlohmann::json createRequest = {
        { "chat_session_id", chatSessionId },
        { "query", query },
        { "reply_language", language },
        { "context", reportContext },
    };
    if (beforeMessageId > 0) {
        createRequest["context_before_message_id"] = beforeMessageId;
    }
    if (!reportTitle.empty()) {
        createRequest["title"] = reportTitle;
    }
    if (!reportSummary.empty()) {
        createRequest["summary"] = reportSummary;
    }
    if (sections.is_array() && !sections.empty()) {
        createRequest["sections"] = sections;
    }
    if (stats.is_array() && !stats.empty()) {
        createRequest["stats"] = stats;
    }

    const std::string createUrl =
        agent.getBackendBaseUrl() +
        "/api/agent/reports/create?client_id=" + clientIdFromPayload_(payload, agent);
    const HttpResponse createResponse = postJson(
        createUrl,
        createRequest.dump(),
        agent.getExeToken(),
        {},
        45000);

    if (!createResponse.ok()) {
        const std::string errorMessage = parseErrorMessage_(createResponse);
        result.answer = language == "pt"
            ? "Consegui montar a analise do relatorio, mas nao consegui finalizar o documento agora. Detalhe: " + errorMessage + "."
            : "I was able to prepare the report analysis, but I could not finalize the document right now. Detail: " + errorMessage + ".";
        return result;
    }

    const nlohmann::json created = nlohmann::json::parse(createResponse.body, nullptr, false);
    if (!created.is_object()) {
        result.answer = language == "pt"
            ? "A geracao do relatorio terminou, mas o retorno final veio em um formato invalido."
            : "The report generation finished, but the final response came back in an invalid format.";
        return result;
    }

    const nlohmann::json messageMetadata =
        created.contains("message_metadata") && created["message_metadata"].is_object()
            ? created["message_metadata"]
            : nlohmann::json::object();

    if (chatAnswer.empty()) {
        chatAnswer = buildFallbackChatAnswer_(reportContext, messageMetadata, language);
    }

    const std::string generatedTitle =
        stringField_(messageMetadata, "title").empty()
            ? reportTitle
            : stringField_(messageMetadata, "title");
    const std::string generatedSummary =
        stringField_(messageMetadata, "summary").empty()
            ? reportSummary
            : stringField_(messageMetadata, "summary");

    result.answer = chatAnswer;
    result.metadata["message_metadata"] = messageMetadata;

    OperationTaskDescriptor descriptor;
    descriptor.type = "generate_report";
    descriptor.entityType = "report";
    descriptor.intent = "create";
    descriptor.status = "completed";
    descriptor.phase = "report_generated";
    descriptor.language = language;
    descriptor.goal = !selection.taskGoal.empty()
        ? selection.taskGoal
        : (language == "pt"
            ? "gerar um relatorio do app"
            : "generate an app report");
    descriptor.summary = generatedSummary.empty()
        ? (language == "pt"
            ? "Relatorio gerado no chat."
            : "Report generated in chat.")
        : generatedSummary;
    descriptor.answerPreview = descriptor.summary;
    descriptor.draft = {
        { "report_id", stringField_(messageMetadata, "report_id") },
        { "report_kind", stringField_(messageMetadata, "report_kind").empty()
            ? reportKindLabel_(stringField_(reportContext, "report_kind"), language)
            : stringField_(messageMetadata, "report_kind") },
        { "title", generatedTitle },
        { "summary", generatedSummary },
        { "download_path", stringField_(messageMetadata, "download_path") },
        { "evidence_download_path", stringField_(messageMetadata, "evidence_download_path") },
    };
    descriptor.uiContract = {
        { "type", "report_document" },
        { "status", "generated" },
    };
    result.metadata["task_state"] = completeOperationTask(conversationContext, descriptor);

    return result;
}

} // namespace chatv2

#pragma once

#include <chrono>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include "HttpUtils.h"
#include "PromptBuilder.h"
#include "../core/AgentCore.h"
#include "../logging/Logging.h"

namespace chatv2 {

struct ChatProgressUpdate {
    std::string skill;
    std::string phase;
    int sequence = 0;
    int stepIndex = 0;
    int stepCount = 0;
    std::string headline;
    std::string detail;
};

inline std::string progressLanguageFromPayload(const nlohmann::json& payload)
{
    if (payload.is_object() && payload.contains("query_language") && payload["query_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["query_language"].get<std::string>());
    }
    if (payload.is_object() && payload.contains("language") && payload["language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["language"].get<std::string>());
    }
    if (payload.is_object() && payload.contains("app_language") && payload["app_language"].is_string()) {
        return normalizeAssistantLanguageTag(payload["app_language"].get<std::string>());
    }
    return "en";
}

inline ChatProgressUpdate makeProgressUpdate(
    const std::string& language,
    const std::string& skill,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate update;
    update.skill = skill;
    update.phase = phase;
    update.sequence = sequence;
    update.stepIndex = stepIndex;
    update.stepCount = stepCount;

    const std::string lang = normalizeAssistantLanguageTag(language);

    if (lang == "pt") {
        if (skill == "video_search") {
            if (phase == "routing") {
                update.headline = "Entendendo a solicitacao";
                update.detail = "Selecionando cameras e janela de tempo para a busca.";
            }
            else if (phase == "searching_footage") {
                update.headline = "Localizando gravacoes";
                update.detail = "Procurando trechos armazenados que combinam com a sua pergunta.";
            }
            else if (phase == "analyzing") {
                update.headline = "Analisando imagens e videos";
                update.detail = "Verificando frames e trechos relevantes nas cameras selecionadas.";
            }
            else if (phase == "uploading_media") {
                update.headline = "Preparando evidencias";
                update.detail = "Organizando imagens e clipes para montar a resposta.";
            }
            else if (phase == "finalizing") {
                update.headline = "Montando a resposta";
                update.detail = "Consolidando o que foi encontrado para responder no chat.";
            }
        }
        else if (skill == "explain_app") {
            if (phase == "routing") {
                update.headline = "Entendendo sua pergunta";
                update.detail = "Identificando a area do app relacionada ao que voce pediu.";
            }
            else if (phase == "loading_knowledge") {
                update.headline = "Consultando a base de ajuda";
                update.detail = "Buscando orientacoes, exemplos e explicacoes relevantes.";
            }
            else if (phase == "drafting") {
                update.headline = "Preparando a explicacao";
                update.detail = "Organizando uma resposta clara e objetiva para voce.";
            }
            else if (phase == "finalizing") {
                update.headline = "Finalizando a resposta";
                update.detail = "Revisando a explicacao antes de enviar no chat.";
            }
        }
        else if (skill == "read_state") {
            if (phase == "routing") {
                update.headline = "Entendendo o que verificar";
                update.detail = "Identificando quais dados do sistema sao mais relevantes para sua pergunta.";
            }
            else if (phase == "loading_state") {
                update.headline = "Consultando o estado atual";
                update.detail = "Lendo cameras, jobs, agentes, pairing, billing e configuracoes.";
            }
            else if (phase == "finalizing") {
                update.headline = "Organizando a resposta";
                update.detail = "Resumindo o estado atual de forma clara para o chat.";
            }
        }
        else if (skill == "scan_network") {
            if (phase == "routing") {
                update.headline = "Entendendo o scan solicitado";
                update.detail = "Preparando a descoberta local de cameras, DVRs e NVRs.";
            }
            else if (phase == "running_scan") {
                update.headline = "Escaneando a rede local";
                update.detail = "Procurando dispositivos acessiveis a partir deste runtime.";
            }
            else if (phase == "finalizing") {
                update.headline = "Resumindo o que foi encontrado";
                update.detail = "Organizando gravadores, canais detectados e cameras avulsas para o chat.";
            }
        }
        else if (skill == "general_answer") {
            if (phase == "routing") {
                update.headline = "Entendendo sua pergunta";
                update.detail = "Determinando a melhor forma de responder diretamente.";
            }
            else if (phase == "drafting") {
                update.headline = "Escrevendo a resposta";
                update.detail = "Preparando uma resposta direta e util para sua pergunta.";
            }
        }
    }
    else if (lang == "es") {
        if (phase == "routing") {
            update.headline = "Entendiendo tu solicitud";
            update.detail = "Preparando el siguiente paso para responder mejor.";
        }
        else if (phase == "finalizing") {
            update.headline = "Preparando la respuesta";
            update.detail = "Organizando el resultado final para el chat.";
        }
        else if (phase == "loading_knowledge") {
            update.headline = "Consultando la ayuda";
            update.detail = "Buscando orientaciones y ejemplos relevantes.";
        }
        else if (phase == "loading_state") {
            update.headline = "Consultando el estado actual";
            update.detail = "Leyendo el estado actual del sistema.";
        }
        else if (phase == "searching_footage") {
            update.headline = "Buscando grabaciones";
            update.detail = "Localizando videos y frames relevantes.";
        }
        else if (phase == "analyzing") {
            update.headline = "Analizando el contenido";
            update.detail = "Revisando frames y clips relevantes.";
        }
        else if (phase == "uploading_media") {
            update.headline = "Preparando evidencia visual";
            update.detail = "Organizando medios para la respuesta final.";
        }
        else if (phase == "drafting") {
            update.headline = "Redactando la respuesta";
            update.detail = "Preparando una respuesta clara para el chat.";
        }
    }
    else if (lang == "fr") {
        if (phase == "routing") {
            update.headline = "Analyse de votre demande";
            update.detail = "Preparation de la meilleure etape suivante.";
        }
        else if (phase == "finalizing") {
            update.headline = "Preparation de la reponse";
            update.detail = "Organisation du resultat final pour le chat.";
        }
        else if (phase == "loading_knowledge") {
            update.headline = "Consultation de l'aide";
            update.detail = "Recherche d'explications et d'exemples pertinents.";
        }
        else if (phase == "loading_state") {
            update.headline = "Consultation de l'etat actuel";
            update.detail = "Lecture de l'etat actuel du systeme.";
        }
        else if (phase == "searching_footage") {
            update.headline = "Recherche des enregistrements";
            update.detail = "Localisation des videos et frames pertinents.";
        }
        else if (phase == "analyzing") {
            update.headline = "Analyse du contenu";
            update.detail = "Verification des frames et extraits video.";
        }
        else if (phase == "uploading_media") {
            update.headline = "Preparation des preuves visuelles";
            update.detail = "Organisation des medias pour la reponse finale.";
        }
        else if (phase == "drafting") {
            update.headline = "Redaction de la reponse";
            update.detail = "Preparation d'une reponse claire pour le chat.";
        }
    }
    else {
        if (skill == "video_search") {
            if (phase == "routing") {
                update.headline = "Understanding your request";
                update.detail = "Selecting cameras and the time window for the search.";
            }
            else if (phase == "searching_footage") {
                update.headline = "Locating footage";
                update.detail = "Looking for stored clips that match your request.";
            }
            else if (phase == "analyzing") {
                update.headline = "Analyzing images and video";
                update.detail = "Reviewing frames and clips from the selected cameras.";
            }
            else if (phase == "uploading_media") {
                update.headline = "Preparing visual evidence";
                update.detail = "Organizing images and clips for the final answer.";
            }
            else if (phase == "finalizing") {
                update.headline = "Composing the answer";
                update.detail = "Summarizing what was found for the chat.";
            }
        }
        else if (skill == "explain_app") {
            if (phase == "routing") {
                update.headline = "Understanding your question";
                update.detail = "Identifying the app area related to what you asked.";
            }
            else if (phase == "loading_knowledge") {
                update.headline = "Consulting the help knowledge";
                update.detail = "Looking up guidance, examples, and product explanations.";
            }
            else if (phase == "drafting") {
                update.headline = "Drafting the explanation";
                update.detail = "Preparing a clear and direct answer.";
            }
            else if (phase == "finalizing") {
                update.headline = "Finalizing the response";
                update.detail = "Polishing the explanation before sending it.";
            }
        }
        else if (skill == "read_state") {
            if (phase == "routing") {
                update.headline = "Understanding what to check";
                update.detail = "Determining which live app data is relevant to your question.";
            }
            else if (phase == "loading_state") {
                update.headline = "Reading the current state";
                update.detail = "Checking cameras, jobs, agents, pairing, billing, and configuration.";
            }
            else if (phase == "finalizing") {
                update.headline = "Organizing the response";
                update.detail = "Summarizing the current state for the chat.";
            }
        }
        else if (skill == "scan_network") {
            if (phase == "routing") {
                update.headline = "Understanding the requested scan";
                update.detail = "Preparing a local discovery pass for cameras, DVRs, and NVRs.";
            }
            else if (phase == "running_scan") {
                update.headline = "Scanning the local network";
                update.detail = "Looking for reachable devices from this runtime.";
            }
            else if (phase == "finalizing") {
                update.headline = "Summarizing what was found";
                update.detail = "Organizing recorders, detected channels, and standalone cameras for chat.";
            }
        }
        else if (skill == "general_answer") {
            if (phase == "routing") {
                update.headline = "Understanding your question";
                update.detail = "Determining the best direct answer for your request.";
            }
            else if (phase == "drafting") {
                update.headline = "Writing the response";
                update.detail = "Preparing a direct and helpful answer.";
            }
        }
    }

    if (update.headline.empty()) {
        update.headline = (lang == "pt") ? "Processando sua solicitacao" : "Processing your request";
    }
    if (update.detail.empty()) {
        update.detail = (lang == "pt")
            ? "Executando a etapa atual para responder no chat."
            : "Running the current step to answer in chat.";
    }

    return update;
}

inline bool postChatProgress(
    AgentCore& agent,
    const nlohmann::json& payload,
    const ChatProgressUpdate& progress,
    long timeoutMs = 2500)
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
        { "progress", {
            { "skill", progress.skill },
            { "phase", progress.phase },
            { "sequence", progress.sequence },
            { "headline", progress.headline },
            { "detail", progress.detail },
            { "step_index", progress.stepIndex },
            { "step_count", progress.stepCount },
        } },
    };

    const int commandId = payload.value("command_id", -1);
    if (commandId > 0) {
        body["command_id"] = commandId;
    }

    const std::string url =
        agent.getBackendBaseUrl() + "/api/agent/chat-progress?client_id=" + agent.getClientId();
    const HttpResponse response = postJson(url, body.dump(), agent.getExeToken(), {}, timeoutMs);
    if (!response.ok()) {
        Logger::instance().logDebug(
            "agent",
            "postChatProgress: skill=" + progress.skill +
            " phase=" + progress.phase +
            " http=" + std::to_string(response.statusCode) +
            (response.error.empty() ? std::string() : " error=" + response.error)
        );
    }
    return response.ok();
}

inline void pauseForProgressVisibility(int milliseconds = 450)
{
    if (milliseconds <= 0) {
        return;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(milliseconds));
}

} // namespace chatv2

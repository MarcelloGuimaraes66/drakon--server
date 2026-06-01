#include "ScanNetworkSkill.h"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <sstream>
#include <vector>

#include "../HttpUtils.h"
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

std::string summaryStringField_(
    const nlohmann::json& value,
    const char* key,
    const std::string& fallback = std::string())
{
    if (!value.is_object() || !value.contains(key) || !value[key].is_string()) {
        return fallback;
    }
    return trimCopy_(value[key].get<std::string>());
}

int summaryIntField_(
    const nlohmann::json& value,
    const char* key,
    int fallback = 0)
{
    if (!value.is_object() || !value.contains(key)) {
        return fallback;
    }

    const auto& field = value[key];
    try {
        if (field.is_number_integer()) {
            return field.get<int>();
        }
        if (field.is_number()) {
            return static_cast<int>(field.get<double>());
        }
    }
    catch (...) {
    }

    return fallback;
}

std::string parseErrorMessage_(const HttpResponse& response)
{
    if (!response.body.empty()) {
        const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
        if (parsed.is_object()) {
            const std::string error = summaryStringField_(parsed, "error");
            if (!error.empty()) {
                return error;
            }
            const std::string message = summaryStringField_(parsed, "message");
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

std::string formatElapsedSeconds_(int elapsedMs)
{
    std::ostringstream out;
    out << std::fixed << std::setprecision(1)
        << (static_cast<double>(elapsedMs) / 1000.0);
    return out.str();
}

std::string joinLimited_(
    const nlohmann::json& values,
    std::size_t limit)
{
    if (!values.is_array() || values.empty()) {
        return "";
    }

    std::ostringstream out;
    std::size_t count = 0;
    for (const auto& value : values) {
        if (!value.is_string()) {
            continue;
        }
        const std::string text = trimCopy_(value.get<std::string>());
        if (text.empty()) {
            continue;
        }

        if (count > 0) {
            out << ", ";
        }
        out << text;
        ++count;
        if (count >= limit) {
            break;
        }
    }

    const std::size_t total = values.size();
    if (count > 0 && total > count) {
        out << ", +" << (total - count) << " more";
    }

    return out.str();
}

std::string joinLimitedPt_(
    const nlohmann::json& values,
    std::size_t limit)
{
    if (!values.is_array() || values.empty()) {
        return "";
    }

    std::ostringstream out;
    std::size_t count = 0;
    for (const auto& value : values) {
        if (!value.is_string()) {
            continue;
        }
        const std::string text = trimCopy_(value.get<std::string>());
        if (text.empty()) {
            continue;
        }

        if (count > 0) {
            out << ", ";
        }
        out << text;
        ++count;
        if (count >= limit) {
            break;
        }
    }

    const std::size_t total = values.size();
    if (count > 0 && total > count) {
        out << ", +" << (total - count) << " outros";
    }

    return out.str();
}

std::string buildNetworkSummaryLine_(
    const nlohmann::json& summary,
    const std::string& language,
    int elapsedMs)
{
    const nlohmann::json stats =
        summary.is_object() ? summary.value("stats", nlohmann::json::object()) : nlohmann::json::object();
    const int recorderCount = summaryIntField_(stats, "recorder_count");
    const int recorderChannelCameraCount = summaryIntField_(stats, "recorder_channel_camera_count");
    const int standaloneCameraCount = summaryIntField_(stats, "standalone_camera_count");
    const int standaloneRecorderCount = summaryIntField_(stats, "standalone_recorder_count");

    if (language == "pt") {
        std::ostringstream out;
        out << "Scan concluido em " << formatElapsedSeconds_(elapsedMs) << "s: "
            << recorderCount << " gravador(es), "
            << recorderChannelCameraCount << " camera(s) de canal detectada(s), "
            << standaloneCameraCount << " camera(s) avulsa(s)";
        if (standaloneRecorderCount > 0) {
            out << " e " << standaloneRecorderCount
                << " gravador(es) ainda sem canais confirmados";
        }
        out << ".";
        return out.str();
    }

    std::ostringstream out;
    out << "Scan completed in " << formatElapsedSeconds_(elapsedMs) << "s: "
        << recorderCount << " recorder(s), "
        << recorderChannelCameraCount << " channel camera(s) detected, "
        << standaloneCameraCount << " standalone camera(s)";
    if (standaloneRecorderCount > 0) {
        out << ", and " << standaloneRecorderCount
            << " recorder(s) without confirmed channels yet";
    }
    out << ".";
    return out.str();
}

std::string buildDiscoveryAnswer_(
    const nlohmann::json& summary,
    const std::string& language,
    int elapsedMs)
{
    const nlohmann::json stats =
        summary.is_object() ? summary.value("stats", nlohmann::json::object()) : nlohmann::json::object();
    const int totalDeviceCount = summaryIntField_(stats, "total_device_count");
    const nlohmann::json recorderGroups =
        summary.is_object() ? summary.value("recorder_groups", nlohmann::json::array()) : nlohmann::json::array();
    const nlohmann::json standaloneCameras =
        summary.is_object() ? summary.value("standalone_cameras", nlohmann::json::array()) : nlohmann::json::array();
    const nlohmann::json standaloneRecorders =
        summary.is_object() ? summary.value("standalone_recorders", nlohmann::json::array()) : nlohmann::json::array();

    if (totalDeviceCount <= 0) {
        if (language == "pt") {
            return "Conclui o scan da rede local, mas nao encontrei cameras, DVRs ou NVRs acessiveis agora. "
                "Vale conferir se o runtime local esta na mesma rede dos dispositivos e se eles estao ligados.";
        }
        return "I completed the local network scan, but I did not find any cameras, DVRs, or NVRs that were reachable right now. "
            "Please check whether the local runtime is on the same network and whether the devices are powered on.";
    }

    std::ostringstream out;
    out << buildNetworkSummaryLine_(summary, language, elapsedMs) << "\n\n";

    if (language == "pt") {
        if (recorderGroups.is_array() && !recorderGroups.empty()) {
            out << "**Gravadores detectados**\n";
            for (const auto& recorder : recorderGroups) {
                const std::string title = summaryStringField_(recorder, "title", "Recorder");
                const std::string ip = summaryStringField_(recorder, "ip");
                const int count = summaryIntField_(recorder, "detected_channel_camera_count");
                const std::string channels = joinLimitedPt_(
                    recorder.value("detected_channel_labels", nlohmann::json::array()),
                    6);
                out << "- " << title;
                if (!ip.empty()) {
                    out << " (`" << ip << "`)";
                }
                out << ": " << count << " canal(is) com camera detectada";
                if (!channels.empty()) {
                    out << " (" << channels << ")";
                }
                out << ".\n";
            }
            out << "\n";
        }

        if (standaloneCameras.is_array() && !standaloneCameras.empty()) {
            out << "**Cameras fora de gravadores**\n";
            for (const auto& camera : standaloneCameras) {
                const std::string title = summaryStringField_(camera, "title", "Camera");
                const std::string ip = summaryStringField_(camera, "ip");
                out << "- " << title;
                if (!ip.empty()) {
                    out << " (`" << ip << "`)";
                }
                out << ".\n";
            }
            out << "\n";
        }

        if (standaloneRecorders.is_array() && !standaloneRecorders.empty()) {
            out << "**Gravadores sem canais confirmados ainda**\n";
            for (const auto& recorder : standaloneRecorders) {
                const std::string title = summaryStringField_(recorder, "title", "Recorder");
                const std::string ip = summaryStringField_(recorder, "ip");
                out << "- " << title;
                if (!ip.empty()) {
                    out << " (`" << ip << "`)";
                }
                out << ".\n";
            }
            out << "\n";
        }

        out << "Consigo confirmar daqui os gravadores e os canais que responderam como camera. "
            << "A contagem exata de canais vazios ainda depende de uma etapa extra de capacidade do gravador.\n\n"
            << "Se quiser, no proximo passo eu posso te ajudar a decidir entre importar os canais detectados, revisar um gravador especifico ou cadastrar so as cameras avulsas.";
        return out.str();
    }

    if (recorderGroups.is_array() && !recorderGroups.empty()) {
        out << "**Detected recorders**\n";
        for (const auto& recorder : recorderGroups) {
            const std::string title = summaryStringField_(recorder, "title", "Recorder");
            const std::string ip = summaryStringField_(recorder, "ip");
            const int count = summaryIntField_(recorder, "detected_channel_camera_count");
            const std::string channels = joinLimited_(
                recorder.value("detected_channel_labels", nlohmann::json::array()),
                6);
            out << "- " << title;
            if (!ip.empty()) {
                out << " (`" << ip << "`)";
            }
            out << ": " << count << " detected channel camera(s)";
            if (!channels.empty()) {
                out << " (" << channels << ")";
            }
            out << ".\n";
        }
        out << "\n";
    }

    if (standaloneCameras.is_array() && !standaloneCameras.empty()) {
        out << "**Standalone cameras**\n";
        for (const auto& camera : standaloneCameras) {
            const std::string title = summaryStringField_(camera, "title", "Camera");
            const std::string ip = summaryStringField_(camera, "ip");
            out << "- " << title;
            if (!ip.empty()) {
                out << " (`" << ip << "`)";
            }
            out << ".\n";
        }
        out << "\n";
    }

    if (standaloneRecorders.is_array() && !standaloneRecorders.empty()) {
        out << "**Recorders without confirmed channels yet**\n";
        for (const auto& recorder : standaloneRecorders) {
            const std::string title = summaryStringField_(recorder, "title", "Recorder");
            const std::string ip = summaryStringField_(recorder, "ip");
            out << "- " << title;
            if (!ip.empty()) {
                out << " (`" << ip << "`)";
            }
            out << ".\n";
        }
        out << "\n";
    }

    out << "From this scan I can confirm the recorders and the channels that responded like cameras. "
        << "Precise empty-channel counts still require an extra recorder-capacity step.\n\n"
        << "If you want, I can help you decide whether to import the detected channels, review one recorder, or register only the standalone cameras next.";
    return out.str();
}

nlohmann::json truncateArray_(const nlohmann::json& array, std::size_t limit)
{
    if (!array.is_array() || array.size() <= limit) {
        return array;
    }

    nlohmann::json truncated = nlohmann::json::array();
    for (std::size_t index = 0; index < limit; ++index) {
        truncated.push_back(array[index]);
    }
    return truncated;
}

nlohmann::json compactSummaryForTaskState_(const nlohmann::json& summary)
{
    if (!summary.is_object()) {
        return nlohmann::json::object();
    }

    nlohmann::json compact = {
        { "stats", summary.value("stats", nlohmann::json::object()) },
        { "recorder_groups", truncateArray_(summary.value("recorder_groups", nlohmann::json::array()), 8) },
        { "standalone_cameras", truncateArray_(summary.value("standalone_cameras", nlohmann::json::array()), 8) },
        { "standalone_recorders", truncateArray_(summary.value("standalone_recorders", nlohmann::json::array()), 8) },
    };

    compact["truncated"] = {
        { "recorder_groups", summary.value("recorder_groups", nlohmann::json::array()).size() > 8 },
        { "standalone_cameras", summary.value("standalone_cameras", nlohmann::json::array()).size() > 8 },
        { "standalone_recorders", summary.value("standalone_recorders", nlohmann::json::array()).size() > 8 },
    };

    return compact;
}

ChatProgressUpdate buildScanProgress_(
    const std::string& language,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate progress;
    progress.skill = "scan_network";
    progress.phase = phase;
    progress.sequence = sequence;
    progress.stepIndex = stepIndex;
    progress.stepCount = stepCount;

    if (normalizeAssistantLanguageTag(language) == "pt") {
        if (phase == "running_scan") {
            progress.headline = "Escaneando a rede local";
            progress.detail = "Procurando cameras, DVRs e NVRs acessiveis a partir deste runtime.";
        }
        else {
            progress.headline = "Organizando o resultado";
            progress.detail = "Resumindo gravadores, canais detectados e cameras avulsas para o chat.";
        }
        return progress;
    }

    if (phase == "running_scan") {
        progress.headline = "Scanning the local network";
        progress.detail = "Looking for reachable cameras, DVRs, and NVRs from this runtime.";
    }
    else {
        progress.headline = "Preparing the result";
        progress.detail = "Summarizing recorders, detected channels, and standalone cameras for chat.";
    }
    return progress;
}

} // namespace

SkillDefinition ScanNetworkSkill::definition() const
{
    return {
        "scan_network",
        "Runs the local Scan Network flow to discover cameras, DVRs, and NVRs, then summarizes the result for chat.",
        true,
    };
}

SkillRunResult ScanNetworkSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "scan_network";
    result.metadata["skip_polish"] = true;

    const nlohmann::json conversationContext = loadConversationContext_(agent, payload);
    const std::string language = effectiveReplyLanguage_(selection, payload);

    postChatProgress(
        agent,
        payload,
        buildScanProgress_(language, "running_scan", 2, 2, 3),
        2500);

    nlohmann::json requestBody = nlohmann::json::object();
    if (selection.arguments.is_object()) {
        const auto& arguments = selection.arguments;
        if (arguments.contains("timeout_ms")) {
            requestBody["timeout_ms"] = arguments["timeout_ms"];
        }
    }
    if (!requestBody.contains("timeout_ms")) {
        requestBody["timeout_ms"] = 5000;
    }

    const HttpResponse response = postJson(
        agent.getBackendBaseUrl() + "/api/runtime/camera-discovery",
        requestBody.dump(),
        agent.getExeToken(),
        {},
        20000);

    if (!response.ok()) {
        const std::string errorMessage = parseErrorMessage_(response);
        if (language == "pt") {
            result.answer =
                "Tentei executar o Scan Network daqui, mas o scan local falhou neste momento. "
                "Detalhe: " + errorMessage + ".";
        }
        else {
            result.answer =
                "I tried to run Scan Network from chat, but the local scan failed right now. "
                "Detail: " + errorMessage + ".";
        }
        return result;
    }

    const nlohmann::json parsed = nlohmann::json::parse(response.body, nullptr, false);
    if (!parsed.is_object()) {
        result.answer = language == "pt"
            ? "Consegui chamar o Scan Network, mas o retorno veio em um formato invalido."
            : "I was able to call Scan Network, but the result came back in an invalid format.";
        return result;
    }

    const int elapsedMs = summaryIntField_(parsed, "elapsed_ms");
    const int timeoutMs = summaryIntField_(parsed, "timeout_ms", 5000);
    const nlohmann::json summary =
        parsed.contains("summary") && parsed["summary"].is_object()
            ? parsed["summary"]
            : nlohmann::json::object({
                  { "stats", {
                      { "total_device_count", 0 },
                      { "total_importable_camera_count", 0 },
                      { "recorder_count", 0 },
                      { "recorder_group_count", 0 },
                      { "recorder_channel_camera_count", 0 },
                      { "standalone_camera_count", 0 },
                      { "standalone_recorder_count", 0 },
                  } },
                  { "recorder_groups", nlohmann::json::array() },
                  { "standalone_cameras", nlohmann::json::array() },
                  { "standalone_recorders", nlohmann::json::array() },
              });

    postChatProgress(
        agent,
        payload,
        buildScanProgress_(language, "finalizing", 3, 3, 3),
        2500);

    result.answer = buildDiscoveryAnswer_(summary, language, elapsedMs);
    result.metadata["message_metadata"] = {
        { "type", "camera_network_scan" },
        { "status", "completed" },
        { "language", language },
        { "elapsed_ms", elapsedMs },
        { "timeout_ms", timeoutMs },
        { "summary", summary },
    };

    OperationTaskDescriptor descriptor;
    descriptor.type = "scan_network";
    descriptor.entityType = "camera";
    descriptor.intent = "inspect";
    descriptor.status = "completed";
    descriptor.phase = "scan_completed";
    descriptor.language = language;
    descriptor.goal = language == "pt"
        ? "escanear a rede local para descobrir cameras"
        : "scan the local network to discover cameras";
    descriptor.summary = buildNetworkSummaryLine_(summary, language, elapsedMs);
    descriptor.answerPreview = descriptor.summary;
    descriptor.draft = {
        { "summary", compactSummaryForTaskState_(summary) },
        { "elapsed_ms", elapsedMs },
        { "timeout_ms", timeoutMs },
    };
    descriptor.uiContract = {
        { "type", "camera_network_scan" },
        { "status", "completed" },
    };
    result.metadata["task_state"] = completeOperationTask(conversationContext, descriptor);

    return result;
}

} // namespace chatv2

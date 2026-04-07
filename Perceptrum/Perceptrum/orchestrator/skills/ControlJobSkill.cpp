#include "ControlJobSkill.h"

#include <algorithm>
#include <sstream>
#include <utility>
#include <vector>

#include "../../core/AgentCore.h"
#include "../HttpUtils.h"
#include "../OperationTaskState.h"
#include "../ProgressUtils.h"
#include "../PromptBuilder.h"
#include "shared/AgentAuthoringShared.h"

namespace chatv2 {

namespace {

using json = nlohmann::json;

std::string safeText_(const json& value, const char* key)
{
    return shared::normalizeInlineWhitespace(shared::jsonStringField(value, key));
}

std::string normalizedAction_(std::string value)
{
    value = shared::lowerAscii(shared::trimText(std::move(value)));
    if (value == "start" || value == "stop") {
        return value;
    }
    return "";
}

bool isPt_(const std::string& language)
{
    return normalizeAssistantLanguageTag(language) == "pt";
}

json normalizedTargetSelector_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    int id = 0;
    if (shared::tryJsonIntField(value, "id", id) && id > 0) {
        normalized["id"] = id;
    }

    const std::vector<const char*> stringFields = {
        "name",
        "description",
    };
    for (const auto* field : stringFields) {
        const std::string text = safeText_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    return normalized;
}

json mergeObjectValues_(json base, const json& overlay)
{
    if (!base.is_object()) {
        base = json::object();
    }
    if (!overlay.is_object()) {
        return base;
    }

    for (auto it = overlay.begin(); it != overlay.end(); ++it) {
        if (it.value().is_null()) {
            continue;
        }
        if (base.contains(it.key()) && base[it.key()].is_object() && it.value().is_object()) {
            base[it.key()] = mergeObjectValues_(base[it.key()], it.value());
            continue;
        }
        base[it.key()] = it.value();
    }
    return base;
}

json activeDraft_(const json& conversationContext)
{
    const json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return json::object();
    }

    const json activeTask = taskState["active_task"];
    if (safeText_(activeTask, "type") != "control_job") {
        return json::object();
    }
    return activeTask.value("draft", json::object());
}

json selectionDraft_(const SkillSelection& selection)
{
    json draft = json::object();
    if (!selection.arguments.is_object()) {
        return draft;
    }

    const std::string runtimeAction = normalizedAction_(safeText_(selection.arguments, "runtime_action"));
    if (!runtimeAction.empty()) {
        draft["runtime_action"] = runtimeAction;
    }

    if (selection.arguments.contains("target_selector")) {
        const json selector = normalizedTargetSelector_(selection.arguments["target_selector"]);
        if (!selector.empty()) {
            draft["target_selector"] = selector;
        }
    }

    if (selection.arguments.contains("resolved_job") && selection.arguments["resolved_job"].is_object()) {
        draft["resolved_job"] = selection.arguments["resolved_job"];
    }

    return draft;
}

bool boolField_(const json& value, const char* key)
{
    bool outValue = false;
    if (value.is_object() && value.contains(key)) {
        shared::readBoolLoose(value[key], outValue);
    }
    return outValue;
}

std::string runtimeStatus_(const json& job)
{
    return shared::lowerAscii(safeText_(job, "runtime_status"));
}

json buildResolvedJob_(const json& job)
{
    return json::object({
        { "id", job.value("id", 0) },
        { "name", safeText_(job, "name") },
        { "description", safeText_(job, "description") },
        { "status", safeText_(job, "status") },
        { "schedule_mode", safeText_(job, "schedule_mode") },
        { "timezone", safeText_(job, "timezone") },
        { "runtime_status", runtimeStatus_(job) },
        { "is_active", boolField_(job, "is_active") },
    });
}

std::string jobName_(const json& job)
{
    const std::string name = safeText_(job, "name");
    if (!name.empty()) {
        return name;
    }
    const int id = job.value("id", 0);
    if (id > 0) {
        return "job #" + std::to_string(id);
    }
    return "job";
}

std::string selectorLabel_(const json& selector)
{
    const std::vector<const char*> fields = {
        "name",
        "description",
    };
    for (const auto* field : fields) {
        const std::string value = safeText_(selector, field);
        if (!value.empty()) {
            return value;
        }
    }
    const int id = selector.value("id", 0);
    if (id > 0) {
        return "job #" + std::to_string(id);
    }
    return "";
}

std::string actionVerb_(bool pt, const std::string& action)
{
    if (action == "start") {
        return pt ? "iniciar" : "start";
    }
    if (action == "stop") {
        return pt ? "parar" : "stop";
    }
    return pt ? "controlar" : "control";
}

std::string actionPast_(bool pt, const std::string& action)
{
    if (action == "start") {
        return pt ? "iniciei" : "started";
    }
    if (action == "stop") {
        return pt ? "parei" : "stopped";
    }
    return pt ? "controlei" : "controlled";
}

std::string actionState_(bool pt, const std::string& action)
{
    if (action == "start") {
        return pt ? "rodando" : "running";
    }
    if (action == "stop") {
        return pt ? "parado" : "stopped";
    }
    return pt ? "controlado" : "updated";
}

std::string buildNeedActionAnswer_(const std::string& language, const json& resolvedJob)
{
    const bool pt = isPt_(language);
    if (resolvedJob.is_object() && resolvedJob.value("id", 0) > 0) {
        return pt
            ? "Voce quer iniciar ou parar o job \"" + jobName_(resolvedJob) + "\"?"
            : "Do you want me to start or stop the job \"" + jobName_(resolvedJob) + "\"?";
    }
    return pt
        ? "Voce quer iniciar ou parar qual job?"
        : "Do you want me to start or stop which job?";
}

std::string buildNeedTargetAnswer_(const std::string& language, const std::string& action)
{
    const bool pt = isPt_(language);
    return pt
        ? "Qual job voce quer que eu " + actionVerb_(pt, action) + "?"
        : "Which job do you want me to " + actionVerb_(pt, action) + "?";
}

std::string buildNotFoundAnswer_(const std::string& language, const std::string& action, const json& selector)
{
    const bool pt = isPt_(language);
    const std::string selectorName = selectorLabel_(selector);
    if (!selectorName.empty()) {
        return pt
            ? "Nao encontrei um job para " + actionVerb_(pt, action) + " que combine com \"" + selectorName + "\"."
            : "I could not find a job to " + actionVerb_(pt, action) + " that matches \"" + selectorName + "\".";
    }
    return pt
        ? "Nao encontrei o job que voce quer controlar."
        : "I could not find the job you want to control.";
}

std::string buildAmbiguousAnswer_(const std::string& language, const std::string& action, const json& candidates)
{
    const bool pt = isPt_(language);
    std::ostringstream out;
    out << (pt
        ? "Encontrei mais de um job para " + actionVerb_(pt, action) + ". Me diga qual destes voce quer:\n"
        : "I found more than one job to " + actionVerb_(pt, action) + ". Tell me which one you want:\n");

    const std::size_t limit = std::min<std::size_t>(5, candidates.is_array() ? candidates.size() : 0);
    for (std::size_t index = 0; index < limit; ++index) {
        const json item = candidates[index];
        out << "- " << jobName_(item);
        const std::string description = safeText_(item, "description");
        if (!description.empty()) {
            out << " (" << description << ")";
        }
        out << "\n";
    }

    return shared::trimText(out.str());
}

std::string buildAlreadyAnswer_(const std::string& language, const std::string& action, const json& job)
{
    const bool pt = isPt_(language);
    return pt
        ? "O job \"" + jobName_(job) + "\" ja esta " + actionState_(pt, action) + "."
        : "The job \"" + jobName_(job) + "\" is already " + actionState_(pt, action) + ".";
}

std::string buildStoppingAnswer_(const std::string& language, const json& job)
{
    const bool pt = isPt_(language);
    return pt
        ? "O job \"" + jobName_(job) + "\" ainda esta parando. Tente iniciar novamente em instantes."
        : "The job \"" + jobName_(job) + "\" is still stopping. Try starting it again in a moment.";
}

std::string buildAlreadyStoppingAnswer_(const std::string& language, const json& job)
{
    const bool pt = isPt_(language);
    return pt
        ? "O job \"" + jobName_(job) + "\" ja esta parando."
        : "The job \"" + jobName_(job) + "\" is already stopping.";
}

std::string buildSuccessAnswer_(const std::string& language, const std::string& action, const json& job)
{
    const bool pt = isPt_(language);
    return pt
        ? "Pronto, " + actionPast_(pt, action) + " o job \"" + jobName_(job) + "\"."
        : "Done, I " + actionPast_(pt, action) + " the job \"" + jobName_(job) + "\".";
}

std::string buildFailureAnswer_(const std::string& language, const std::string& action, const std::string& detail)
{
    const bool pt = isPt_(language);
    if (!detail.empty()) {
        return pt
            ? "Nao consegui " + actionVerb_(pt, action) + " o job agora. Detalhe: " + detail
            : "I could not " + actionVerb_(pt, action) + " the job right now. Detail: " + detail;
    }
    return pt
        ? "Nao consegui controlar o job agora."
        : "I could not control the job right now.";
}

json buildTaskState_(
    const json& conversationContext,
    const json& draft,
    const std::string& language,
    const std::string& taskStatus,
    const std::string& phase,
    const std::string& summary,
    const std::string& answer,
    const std::vector<std::string>& missingFields,
    bool complete)
{
    OperationTaskDescriptor descriptor;
    descriptor.type = "control_job";
    descriptor.entityType = "job";
    descriptor.intent = "update";
    descriptor.status = taskStatus;
    descriptor.phase = phase;
    descriptor.language = language;
    descriptor.goal = "control_job_runtime";
    descriptor.summary = summary;
    descriptor.answerPreview = answer;
    descriptor.missingFields = missingFields;
    descriptor.draft = draft.is_object() ? draft : json::object();
    if (descriptor.draft.contains("runtime_action")) {
        descriptor.collectedFields.push_back("runtime_action");
    }
    if (descriptor.draft.contains("resolved_job")) {
        descriptor.collectedFields.push_back("job");
    }
    return complete
        ? completeOperationTask(conversationContext, descriptor)
        : upsertActiveOperationTask(conversationContext, descriptor);
}

std::string actionUrl_(AgentCore& agent, const json& payload, int jobId, const std::string& action)
{
    const std::string clientId = shared::clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : shared::clientIdFromPayload(payload);
    return agent.getBackendBaseUrl() + "/api/agent/jobs/" +
        std::to_string(jobId) + "/" + action + "?client_id=" + clientId;
}

} // namespace

SkillDefinition ControlJobSkill::definition() const
{
    return SkillDefinition{
        "control_job",
        "Starts or stops one existing job runtime from chat.",
        true,
    };
}

SkillRunResult ControlJobSkill::execute(
    AgentCore& agent,
    const json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "control_job";
    result.metadata["skip_polish"] = true;

    const json conversationContext = shared::loadConversationContext(agent, payload);
    const std::string language = shared::effectiveReplyLanguage(selection, payload, conversationContext);

    json draft = mergeObjectValues_(activeDraft_(conversationContext), selectionDraft_(selection));
    const std::string action = normalizedAction_(safeText_(draft, "runtime_action"));
    if (action.empty()) {
        result.answer = buildNeedActionAnswer_(language, draft.value("resolved_job", json::object()));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_action",
            isPt_(language) ? "Aguardando acao do job" : "Waiting for the job action",
            result.answer,
            { "runtime_action" },
            false);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "control_job", "resolving_target", 2, 2, 3),
        2000);

    const json inventory = shared::fetchJobInventory(agent, payload);
    if (!inventory.value("ok", false)) {
        result.answer = buildFailureAnswer_(language, action, safeText_(inventory, "error"));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_inventory",
            isPt_(language) ? "Falha ao consultar jobs" : "Failed to load jobs",
            result.answer,
            {},
            false);
        return result;
    }

    const json resolution = shared::resolveJob(
        inventory,
        draft.value("target_selector", json::object()),
        draft.value("resolved_job", json::object()));
    const std::string resolutionStatus = safeText_(resolution, "status");
    if (resolutionStatus == "missing_target") {
        result.answer = buildNeedTargetAnswer_(language, action);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_target",
            isPt_(language) ? "Aguardando job" : "Waiting for the job",
            result.answer,
            { "target_selector" },
            false);
        return result;
    }

    if (resolutionStatus == "ambiguous") {
        draft["candidate_jobs"] = resolution.value("candidates", json::array());
        result.answer = buildAmbiguousAnswer_(language, action, draft["candidate_jobs"]);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_target_confirmation",
            isPt_(language) ? "Aguardando confirmacao do job" : "Waiting for job confirmation",
            result.answer,
            { "target_selector" },
            false);
        return result;
    }

    if (resolutionStatus != "resolved" || !resolution.contains("item") || !resolution["item"].is_object()) {
        result.answer = buildNotFoundAnswer_(language, action, draft.value("target_selector", json::object()));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_target",
            isPt_(language) ? "Job nao encontrado" : "Job not found",
            result.answer,
            { "target_selector" },
            false);
        return result;
    }

    const json resolvedJob = buildResolvedJob_(resolution["item"]);
    draft["resolved_job"] = resolvedJob;
    draft.erase("candidate_jobs");

    const std::string runtimeStatus = runtimeStatus_(resolvedJob);
    if (action == "start" && runtimeStatus == "running") {
        result.answer = buildAlreadyAnswer_(language, action, resolvedJob);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "completed",
            "already_applied",
            isPt_(language) ? "Job ja estava rodando" : "Job was already running",
            result.answer,
            {},
            true);
        return result;
    }
    if (action == "start" && runtimeStatus == "stopping") {
        result.answer = buildStoppingAnswer_(language, resolvedJob);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_retry",
            isPt_(language) ? "Job ainda esta parando" : "Job is still stopping",
            result.answer,
            {},
            false);
        return result;
    }
    if (action == "stop" && runtimeStatus == "stopping") {
        result.answer = buildAlreadyStoppingAnswer_(language, resolvedJob);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "completed",
            "already_applied",
            isPt_(language) ? "Job ja estava parando" : "Job was already stopping",
            result.answer,
            {},
            true);
        return result;
    }
    if (action == "stop" && runtimeStatus != "running") {
        result.answer = buildAlreadyAnswer_(language, action, resolvedJob);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "completed",
            "already_applied",
            isPt_(language) ? "Job ja estava parado" : "Job was already stopped",
            result.answer,
            {},
            true);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "control_job", "applying_action", 3, 3, 3),
        2500);

    const HttpResponse response = postJson(
        actionUrl_(agent, payload, resolvedJob.value("id", 0), action),
        json::object().dump(),
        agent.getExeToken(),
        {},
        action == "start" ? 15000 : 12000);
    if (!response.ok()) {
        result.answer = buildFailureAnswer_(language, action, shared::parseErrorMessage(response));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_retry",
            isPt_(language) ? "Falha ao controlar o job" : "Failed to control the job",
            result.answer,
            {},
            false);
        return result;
    }

    json responseBody = json::parse(response.body, nullptr, false);
    if (!responseBody.is_object()) {
        responseBody = json::object();
    }

    if ((action == "start" && responseBody.value("already_running", false)) ||
        (action == "stop" && responseBody.value("already_stopped", false))) {
        result.answer = buildAlreadyAnswer_(language, action, resolvedJob);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "completed",
            "already_applied",
            isPt_(language) ? "Job ja estava no estado pedido" : "Job was already in the requested state",
            result.answer,
            {},
            true);
        return result;
    }

    json updatedJob = resolvedJob;
    updatedJob["runtime_status"] = action == "start" ? "running" : "stopped";
    draft["resolved_job"] = updatedJob;

    result.answer = buildSuccessAnswer_(language, action, updatedJob);
    result.metadata["task_state"] = buildTaskState_(
        conversationContext,
        draft,
        language,
        "completed",
        action == "start" ? "job_started" : "job_stopped",
        action == "start"
            ? (isPt_(language) ? "Job iniciado" : "Job started")
            : (isPt_(language) ? "Job parado" : "Job stopped"),
        result.answer,
        {},
        true);
    return result;
}

} // namespace chatv2

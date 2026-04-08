#include "EditJobSkill.h"

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

bool isPt_(const std::string& language)
{
    return normalizeAssistantLanguageTag(language) == "pt";
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
            base[it.key()] = nullptr;
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

    for (const auto* field : { "name", "description" }) {
        const std::string text = safeText_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    return normalized;
}

std::string normalizeStatus_(std::string value)
{
    value = shared::lowerAscii(shared::trimText(std::move(value)));
    if (value == "draft" ||
        value == "scheduled" ||
        value == "disabled" ||
        value == "paused" ||
        value == "active") {
        return value;
    }
    return "";
}

std::string normalizeScheduleMode_(std::string value)
{
    value = shared::lowerAscii(shared::trimText(std::move(value)));
    if (value == "one_shot" ||
        value == "weekly" ||
        value == "monthly" ||
        value == "yearly") {
        return value;
    }
    return "";
}

json normalizeJobPatch_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    for (const auto* field : { "name", "description" }) {
        const std::string text = safeText_(value, field);
        if (!text.empty()) {
            normalized[field] = text;
        }
    }

    const std::string status = normalizeStatus_(safeText_(value, "status"));
    if (!status.empty()) {
        normalized["status"] = status;
    }

    const std::string scheduleMode = normalizeScheduleMode_(safeText_(value, "schedule_mode"));
    if (!scheduleMode.empty()) {
        normalized["schedule_mode"] = scheduleMode;
    }

    for (const auto* nullableField : { "start_at", "end_at", "active_from", "active_until" }) {
        if (!value.contains(nullableField)) {
            continue;
        }
        if (value[nullableField].is_null()) {
            normalized[nullableField] = nullptr;
            continue;
        }
        const std::string text = safeText_(value, nullableField);
        if (!text.empty()) {
            normalized[nullableField] = text;
        }
    }

    if (value.contains("schedule_days") && value["schedule_days"].is_array() && !value["schedule_days"].empty()) {
        normalized["schedule_days"] = value["schedule_days"];
    }
    if (value.contains("weekly_schedule") && value["weekly_schedule"].is_object() && !value["weekly_schedule"].empty()) {
        normalized["weekly_schedule"] = value["weekly_schedule"];
    }

    return normalized;
}

bool hasPatchChanges_(const json& patch)
{
    return patch.is_object() && !patch.empty();
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
        { "runtime_status", safeText_(job, "runtime_status") },
        { "is_active", job.value("is_active", false) },
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
    for (const auto* field : { "name", "description" }) {
        const std::string value = safeText_(selector, field);
        if (!value.empty()) {
            return value;
        }
    }
    const int id = selector.value("id", 0);
    return id > 0 ? "job #" + std::to_string(id) : "";
}

json activeDraft_(const json& conversationContext)
{
    const json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return json::object();
    }

    const json activeTask = taskState["active_task"];
    if (safeText_(activeTask, "type") != "edit_job") {
        return json::object();
    }
    return activeTask.value("draft", json::object());
}

json selectionDraft_(const SkillSelection& selection)
{
    json draft = json::object();

    if (selection.arguments.is_object()) {
        if (selection.arguments.contains("target_selector")) {
            const json selector = normalizedTargetSelector_(selection.arguments["target_selector"]);
            if (!selector.empty()) {
                draft["target_selector"] = selector;
            }
        }
        if (selection.arguments.contains("draft_patch")) {
            const json patch = normalizeJobPatch_(selection.arguments["draft_patch"]);
            if (!patch.empty()) {
                draft["job_patch"] = patch;
            }
        }
        if (selection.arguments.contains("resolved_job") && selection.arguments["resolved_job"].is_object()) {
            draft["resolved_job"] = selection.arguments["resolved_job"];
        }
    }

    if (selection.draftPatch.is_object() && !selection.draftPatch.empty()) {
        draft["job_patch"] = mergeObjectValues_(
            draft.value("job_patch", json::object()),
            normalizeJobPatch_(selection.draftPatch));
    }

    return draft;
}

std::string buildNeedTargetAnswer_(const std::string& language)
{
    return isPt_(language)
        ? "Qual job ou tarefa voce quer editar?"
        : "Which job do you want me to edit?";
}

std::string buildNeedChangesAnswer_(const std::string& language, const json& job)
{
    return isPt_(language)
        ? "Entendi o job \"" + jobName_(job) + "\", mas ainda preciso saber o que voce quer editar nele."
        : "I found the job \"" + jobName_(job) + "\", but I still need to know what you want to change in it.";
}

std::string buildNotFoundAnswer_(const std::string& language, const json& selector)
{
    const std::string label = selectorLabel_(selector);
    if (!label.empty()) {
        return isPt_(language)
            ? "Nao encontrei um job ou tarefa que combine com \"" + label + "\"."
            : "I could not find a job that matches \"" + label + "\".";
    }
    return isPt_(language)
        ? "Nao encontrei o job ou a tarefa que voce quer editar."
        : "I could not find the job you want to edit.";
}

std::string buildAmbiguousAnswer_(const std::string& language, const json& candidates)
{
    std::ostringstream out;
    out << (isPt_(language)
        ? "Encontrei mais de um job possivel. Me diga qual deles voce quer editar:\n"
        : "I found more than one matching job. Tell me which one you want to edit:\n");

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

std::string buildSuccessAnswer_(const std::string& language, const json& job)
{
    return isPt_(language)
        ? "Pronto, atualizei o job \"" + jobName_(job) + "\"."
        : "Done, I updated the job \"" + jobName_(job) + "\".";
}

std::string buildFailureAnswer_(const std::string& language, const std::string& detail)
{
    if (!detail.empty()) {
        return isPt_(language)
            ? "Nao consegui editar o job agora. Detalhe: " + detail
            : "I could not edit the job right now. Detail: " + detail;
    }
    return isPt_(language)
        ? "Nao consegui editar o job agora."
        : "I could not edit the job right now.";
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
    descriptor.type = "edit_job";
    descriptor.entityType = "job";
    descriptor.intent = "update";
    descriptor.status = taskStatus;
    descriptor.phase = phase;
    descriptor.language = language;
    descriptor.goal = isPt_(language) ? "editar um job existente" : "edit an existing job";
    descriptor.summary = summary;
    descriptor.answerPreview = answer;
    descriptor.missingFields = missingFields;
    descriptor.draft = draft.is_object() ? draft : json::object();
    if (descriptor.draft.contains("resolved_job")) {
        descriptor.collectedFields.push_back("job");
    }
    if (descriptor.draft.contains("job_patch") && descriptor.draft["job_patch"].is_object()) {
        for (auto it = descriptor.draft["job_patch"].begin(); it != descriptor.draft["job_patch"].end(); ++it) {
            descriptor.collectedFields.push_back(it.key());
        }
    }
    return complete
        ? completeOperationTask(conversationContext, descriptor)
        : upsertActiveOperationTask(conversationContext, descriptor);
}

std::string jobUrl_(AgentCore& agent, const json& payload, int jobId)
{
    const std::string clientId = shared::clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : shared::clientIdFromPayload(payload);
    return agent.getBackendBaseUrl() + "/api/agent/jobs/" +
        std::to_string(jobId) + "?client_id=" + clientId;
}

} // namespace

SkillDefinition EditJobSkill::definition() const
{
    return SkillDefinition{
        "edit_job",
        "Edits one existing job from chat.",
        true,
    };
}

SkillRunResult EditJobSkill::execute(
    AgentCore& agent,
    const json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "edit_job";
    result.metadata["skip_polish"] = true;

    const json conversationContext = shared::loadConversationContext(agent, payload);
    const std::string language = shared::effectiveReplyLanguage(selection, payload, conversationContext);

    json draft = mergeObjectValues_(activeDraft_(conversationContext), selectionDraft_(selection));

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "edit_job", "resolving_target", 2, 2, 3),
        2000);

    const json inventory = shared::fetchJobInventory(agent, payload);
    if (!inventory.value("ok", false)) {
        result.answer = buildFailureAnswer_(language, safeText_(inventory, "error"));
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
        result.answer = buildNeedTargetAnswer_(language);
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
        result.answer = buildAmbiguousAnswer_(language, draft["candidate_jobs"]);
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
        result.answer = buildNotFoundAnswer_(language, draft.value("target_selector", json::object()));
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

    const json jobPatch = normalizeJobPatch_(draft.value("job_patch", json::object()));
    if (!hasPatchChanges_(jobPatch)) {
        result.answer = buildNeedChangesAnswer_(language, resolvedJob);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_patch",
            isPt_(language) ? "Aguardando alteracoes do job" : "Waiting for job changes",
            result.answer,
            { "draft_patch" },
            false);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "edit_job", "applying_action", 3, 3, 3),
        2500);

    const HttpResponse response = putJson(
        jobUrl_(agent, payload, resolvedJob.value("id", 0)),
        jobPatch.dump(),
        agent.getExeToken(),
        {},
        20000);
    if (!response.ok()) {
        result.answer = buildFailureAnswer_(language, shared::parseErrorMessage(response));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_retry",
            isPt_(language) ? "Falha ao editar o job" : "Failed to edit the job",
            result.answer,
            {},
            false);
        return result;
    }

    json responseBody = json::parse(response.body, nullptr, false);
    if (!responseBody.is_object()) {
        responseBody = json::object();
    }

    json updatedJob = responseBody.value("job", json::object());
    if (!updatedJob.is_object() || updatedJob.empty()) {
        updatedJob = resolvedJob;
        for (auto it = jobPatch.begin(); it != jobPatch.end(); ++it) {
            updatedJob[it.key()] = it.value();
        }
    }

    draft["resolved_job"] = buildResolvedJob_(updatedJob);
    draft["job_patch"] = jobPatch;

    result.answer = buildSuccessAnswer_(language, draft["resolved_job"]);
    result.metadata["job"] = updatedJob;
    result.metadata["task_state"] = buildTaskState_(
        conversationContext,
        draft,
        language,
        "completed",
        "job_updated",
        isPt_(language) ? "Job atualizado" : "Job updated",
        result.answer,
        {},
        true);
    return result;
}

} // namespace chatv2

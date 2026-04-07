#include "CreateJobSkill.h"

#include <algorithm>
#include <sstream>
#include <string>
#include <vector>

#include "../../core/AgentCore.h"
#include "../LocalLlmClient.h"
#include "../OperationTaskState.h"
#include "../ProgressUtils.h"
#include "../PromptBuilder.h"
#include "CreateCameraAgentSkill.h"
#include "shared/AgentAuthoringShared.h"
#include "shared/JobBlueprintShared.h"

namespace chatv2 {

namespace {

using nlohmann::json;

std::string safeText_(const json& value, const char* key)
{
    return shared::normalizeInlineWhitespace(shared::jsonStringField(value, key));
}

ChatProgressUpdate buildJobProgress_(
    const std::string& language,
    const std::string& phase,
    int sequence,
    int stepIndex,
    int stepCount)
{
    ChatProgressUpdate progress;
    progress.skill = "create_job";
    progress.phase = phase;
    progress.sequence = sequence;
    progress.stepIndex = stepIndex;
    progress.stepCount = stepCount;

    if (normalizeAssistantLanguageTag(language) == "pt") {
        if (phase == "structuring_job") {
            progress.headline = "Organizando o workflow";
            progress.detail = "Estruturando o job, os steps e a topologia mais coerente para a necessidade.";
        }
        else if (phase == "resolving_cameras") {
            progress.headline = "Resolvendo cameras";
            progress.detail = "Confirmando as cameras sugeridas para cada etapa da tarefa.";
        }
        else if (phase == "designing_agents") {
            progress.headline = "Desenhando os agentes";
            progress.detail = "Montando os agentes com contexto de step, compartilhamento de conhecimento e politica de alerta.";
        }
        else {
            progress.headline = "Criando o job";
            progress.detail = "Instalando o snapshot estruturado do workflow no runtime.";
        }
        return progress;
    }

    if (phase == "structuring_job") {
        progress.headline = "Structuring the workflow";
        progress.detail = "Building the job, steps, and the topology that best fits the request.";
    }
    else if (phase == "resolving_cameras") {
        progress.headline = "Resolving cameras";
        progress.detail = "Confirming the proposed cameras for each step.";
    }
    else if (phase == "designing_agents") {
        progress.headline = "Designing the agents";
        progress.detail = "Aligning each agent with the step role, shared knowledge, and alert policy.";
    }
    else {
        progress.headline = "Creating the job";
        progress.detail = "Installing the structured workflow snapshot into the runtime.";
    }
    return progress;
}

std::vector<std::string> collectedJobFields_(const json& blueprint)
{
    std::vector<std::string> collected;
    if (!safeText_(blueprint.value("job", json::object()), "name").empty()) {
        collected.push_back("job_name");
    }
    if (blueprint.contains("steps") && blueprint["steps"].is_array() && !blueprint["steps"].empty()) {
        collected.push_back("steps");
    }
    const json schedule = blueprint.value("job", json::object()).value("schedule", json::object());
    if (schedule.contains("schedule_days") && schedule["schedule_days"].is_array() && !schedule["schedule_days"].empty()) {
        collected.push_back("schedule");
    }
    return collected;
}

std::string createJobGoal_(const json& blueprint, const std::string& language)
{
    const std::string jobName = safeText_(blueprint.value("job", json::object()), "name");
    if (!jobName.empty()) {
        return jobName;
    }
    return language == "pt" ? "criar um job" : "create a job";
}

json buildCreateJobTaskState_(
    const json& conversationContext,
    const json& blueprint,
    const std::string& status,
    const std::string& phase,
    const std::string& summary,
    const std::string& answer,
    const std::string& language,
    const std::vector<std::string>& missingFields)
{
    OperationTaskDescriptor descriptor{
        "create_job",
        "job",
        "create",
        status,
        phase,
        normalizeAssistantLanguageTag(language),
        createJobGoal_(blueprint, language),
        summary,
        shared::trimText(answer),
        missingFields,
        collectedJobFields_(blueprint),
        blueprint,
        json::object(),
        json::object(),
    };
    return status == "completed"
        ? completeOperationTask(conversationContext, descriptor)
        : upsertActiveOperationTask(conversationContext, descriptor);
}

std::string buildFailureAnswer_(const std::string& language, const std::string& detail)
{
    if (normalizeAssistantLanguageTag(language) == "pt") {
        return "Nao consegui criar o job agora. Detalhe: " + detail;
    }
    return "I could not create the job right now. Detail: " + detail;
}

std::string buildNeedMoreInputAnswer_(
    const std::string& language,
    const std::vector<std::string>& missingFields)
{
    const bool pt = normalizeAssistantLanguageTag(language) == "pt";
    if (std::find(missingFields.begin(), missingFields.end(), "schedule") != missingFields.end()) {
        return pt
            ? "Antes de criar esse job, eu preciso da agenda. Me diga em quais dias e horarios ele deve rodar."
            : "Before creating this job, I need the schedule. Tell me which days and time windows it should run.";
    }
    if (std::find(missingFields.begin(), missingFields.end(), "cameras") != missingFields.end()) {
        return pt
            ? "Ainda preciso confirmar as cameras desse workflow. Me diga quais cameras devo usar em cada step."
            : "I still need to confirm the cameras for this workflow. Tell me which cameras each step should use.";
    }
    if (std::find(missingFields.begin(), missingFields.end(), "analysis") != missingFields.end()) {
        return pt
            ? "Ainda falta definir o que cada step ou agente precisa analisar. Me descreva o objetivo de cada etapa que ainda esta aberta."
            : "I still need the analysis goal for one or more steps or agents. Describe what each open step should analyze.";
    }
    return pt
        ? "Ainda preciso de mais contexto para montar o job corretamente."
        : "I still need a bit more context to build this job correctly.";
}

std::string buildAmbiguousCameraAnswer_(
    const std::string& language,
    const json& step,
    const json& target,
    const json& candidates)
{
    std::ostringstream out;
    const std::string targetLabel = !safeText_(target, "slot_label").empty()
        ? safeText_(target, "slot_label")
        : safeText_(target, "slot_key");
    if (normalizeAssistantLanguageTag(language) == "pt") {
        out << "Encontrei mais de uma camera possivel para o alvo \"" << targetLabel
            << "\" no step \"" << safeText_(step, "name") << "\". Me diga qual delas devo usar:";
    }
    else {
        out << "I found more than one possible camera for target \"" << targetLabel
            << "\" in step \"" << safeText_(step, "name") << "\". Tell me which one I should use:";
    }
    for (std::size_t index = 0; index < candidates.size(); ++index) {
        const auto& camera = candidates[index];
        out << "\n" << (index + 1) << ". "
            << safeText_(camera, "name");
        if (!safeText_(camera, "scene_description").empty()) {
            out << " - " << safeText_(camera, "scene_description");
        }
    }
    return out.str();
}

std::string installTaskUrl_(AgentCore& agent, const json& payload)
{
    const std::string clientId = shared::clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : shared::clientIdFromPayload(payload);
    return agent.getBackendBaseUrl() + "/api/agent/tasks/install?client_id=" + clientId;
}

SkillSelection translateToCreateCameraAgentSelection_(
    const SkillSelection& selection,
    const json& blueprint)
{
    SkillSelection delegated = selection;
    delegated.selectedSkill = "create_camera_agent";
    delegated.mode = "operate";
    delegated.entity = "camera_agent";
    delegated.intent = "create";
    delegated.operationType = "create_camera_agent";
    delegated.operationPhase = "collecting_input";

    const json firstStep = blueprint.value("steps", json::array()).empty()
        ? json::object()
        : blueprint["steps"][0];
    const json firstTarget = firstStep.value("targets", json::array()).empty()
        ? json::object()
        : firstStep["targets"][0];
    const json firstAgent = firstStep.value("agents", json::array()).empty()
        ? json::object()
        : firstStep["agents"][0];

    delegated.arguments = json::object({
        { "operation_type", "create_camera_agent" },
        { "operation_phase", "collecting_input" },
        { "goal_summary", safeText_(firstAgent, "goal_summary") },
        { "camera_selector", firstTarget.value("camera_selector", json::object()) },
        { "destination_types", json::array({ "camera" }) },
        { "draft_patch", firstAgent.value("agent_patch", json::object()) },
        { "needs_visual_context", firstAgent.value("design_context", json::object()).value("needs_visual_context", false) },
    });
    delegated.draftPatch = firstAgent.value("agent_patch", json::object());
    return delegated;
}

json materializeSnapshotFromPatch_(
    const json& agentPatch,
    const std::string& goalSummary,
    const json& faceTargets)
{
    json snapshot = {
        { "type", "agent" },
        { "display_name", safeText_(agentPatch, "display_name").empty() ? goalSummary : safeText_(agentPatch, "display_name") },
        { "summary", safeText_(agentPatch, "summary").empty() ? goalSummary : safeText_(agentPatch, "summary") },
        { "agent_key", "custom_template" },
        { "is_enabled", agentPatch.contains("is_enabled") ? agentPatch["is_enabled"] : json(true) },
        { "input_type", safeText_(agentPatch, "input_type").empty() ? "video" : safeText_(agentPatch, "input_type") },
        { "video_packaging_mode", safeText_(agentPatch, "video_packaging_mode").empty() ? "mosaic_3x3" : safeText_(agentPatch, "video_packaging_mode") },
        { "inference_model", safeText_(agentPatch, "inference_model").empty() ? "ultra" : safeText_(agentPatch, "inference_model") },
        { "model_fps", agentPatch.contains("model_fps") ? agentPatch["model_fps"] : json(1) },
        { "run_every", agentPatch.contains("run_every") ? agentPatch["run_every"] : json(60) },
        { "running_resolution", agentPatch.contains("running_resolution") ? agentPatch["running_resolution"] : json(640) },
        { "only_capture_on_motion", agentPatch.contains("only_capture_on_motion") ? agentPatch["only_capture_on_motion"] : json(true) },
        { "use_temporal_context", agentPatch.contains("use_temporal_context") ? agentPatch["use_temporal_context"] : json(true) },
        { "prompt_template", safeText_(agentPatch, "prompt_template") },
        { "alert_condition", safeText_(agentPatch, "alert_condition") },
        { "negative_condition", safeText_(agentPatch, "negative_condition") },
        { "face_target_ids", json::array() },
        { "analysis_regions", agentPatch.value("analysis_regions", json::array()) },
    };
    for (const auto& target : faceTargets) {
        int id = 0;
        if (shared::tryJsonIntField(target, "id", id) && id > 0) {
            snapshot["face_target_ids"].push_back(id);
        }
    }
    return snapshot;
}

json buildDesignContext_(
    const json& step,
    const json& target,
    const json& agentSpec)
{
    json context = agentSpec.value("design_context", json::object());
    context["alert_policy"] = safeText_(agentSpec, "alert_policy");
    context["step"] = json::object({
        { "step_key", safeText_(step, "step_key") },
        { "name", safeText_(step, "name") },
        { "role", safeText_(step, "role") },
        { "knowledge_inputs", step.value("knowledge_inputs", json::array()) },
        { "start_condition", step.value("start_condition", json::object()) },
    });
    if (target.is_object() && !target.empty()) {
        context["target"] = json::object({
            { "slot_key", safeText_(target, "slot_key") },
            { "slot_label", safeText_(target, "slot_label") },
            { "input_type", safeText_(target, "input_type") },
            { "analysis_scope", target.value("analysis_scope", json::object()) },
            { "resolved_camera", target.value("resolved_camera", json::object()) },
        });
    }
    if (agentSpec.contains("output_contract")) {
        context["output_contract"] = agentSpec["output_contract"];
    }
    return context;
}

} // namespace

SkillDefinition CreateJobSkill::definition() const
{
    return SkillDefinition{
        "create_job",
        "Creates scheduled jobs and multi-step workflows from chat, and falls back to camera-agent creation when the request does not need a job.",
        true,
    };
}

SkillRunResult CreateJobSkill::execute(
    AgentCore& agent,
    const json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "create_job";
    result.metadata["skip_polish"] = true;

    const json conversationContext = shared::loadConversationContext(agent, payload);
    const std::string language = shared::effectiveReplyLanguage(selection, payload, conversationContext);

    postChatProgress(
        agent,
        payload,
        buildJobProgress_(language, "structuring_job", 1, 1, 4),
        2000);

    json blueprint = shared::mergeJobBlueprint(
        shared::activeCreateJobDraft(conversationContext),
        shared::normalizeRouterCreateJobDraft(selection));

    LocalLlmClient llm;
    shared::configureActionModelClient(llm, payload);
    blueprint = shared::mergeJobBlueprint(
        blueprint,
        shared::extractJobBlueprintDraft(llm, payload, conversationContext, selection));
    blueprint = shared::finalizeJobBlueprintValidation(blueprint);

    const std::string executionMode = safeText_(blueprint.value("decision", json::object()), "execution_mode");
    if (executionMode == "camera_agent") {
        CreateCameraAgentSkill delegatedSkill;
        return delegatedSkill.execute(agent, payload, translateToCreateCameraAgentSelection_(selection, blueprint));
    }

    const std::vector<std::string> missingBeforeResolution = shared::collectMissingJobFields(blueprint);
    if (!missingBeforeResolution.empty()) {
        result.answer = buildNeedMoreInputAnswer_(language, missingBeforeResolution);
        result.metadata["task_state"] = buildCreateJobTaskState_(
            conversationContext,
            blueprint,
            "collecting_input",
            "awaiting_missing_fields",
            language == "pt" ? "Aguardando dados do job" : "Waiting for job details",
            result.answer,
            language,
            missingBeforeResolution);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        buildJobProgress_(language, "resolving_cameras", 2, 2, 4),
        2000);

    const json cameraInventory = shared::fetchCameraInventory(agent, payload);
    if (!cameraInventory.value("ok", false)) {
        result.answer = buildFailureAnswer_(language, safeText_(cameraInventory, "error"));
        result.metadata["task_state"] = buildCreateJobTaskState_(
            conversationContext,
            blueprint,
            "collecting_input",
            "awaiting_context",
            language == "pt" ? "Falha ao consultar cameras" : "Failed to load cameras",
            result.answer,
            language,
            {});
        return result;
    }

    blueprint = shared::resolveJobBlueprintSelectors(blueprint, cameraInventory);
    for (const auto& step : blueprint.value("steps", json::array())) {
        for (const auto& target : step.value("targets", json::array())) {
            const json resolution = target.value("resolution", json::object());
            const std::string status = safeText_(resolution, "status");
            if (status == "ambiguous") {
                result.answer = buildAmbiguousCameraAnswer_(language, step, target, resolution.value("candidates", json::array()));
                result.metadata["task_state"] = buildCreateJobTaskState_(
                    conversationContext,
                    blueprint,
                    "collecting_input",
                    "awaiting_camera_confirmation",
                    language == "pt" ? "Aguardando confirmacao da camera" : "Waiting for camera confirmation",
                    result.answer,
                    language,
                    { "cameras" });
                return result;
            }
            if (status == "not_found" || status == "missing_target") {
                result.answer = buildNeedMoreInputAnswer_(language, { "cameras" });
                result.metadata["task_state"] = buildCreateJobTaskState_(
                    conversationContext,
                    blueprint,
                    "collecting_input",
                    "awaiting_camera",
                    language == "pt" ? "Aguardando camera valida" : "Waiting for a valid camera",
                    result.answer,
                    language,
                    { "cameras" });
                return result;
            }
        }
    }

    postChatProgress(
        agent,
        payload,
        buildJobProgress_(language, "designing_agents", 3, 3, 4),
        2000);

    json referenceInventory = json::object();
    bool needsReferenceTargets = false;
    for (const auto& step : blueprint.value("steps", json::array())) {
        for (const auto& agentSpec : step.value("agents", json::array())) {
            if ((agentSpec.contains("face_target_refs") && agentSpec["face_target_refs"].is_array() && !agentSpec["face_target_refs"].empty()) ||
                (agentSpec.contains("drakon_find_target_refs") && agentSpec["drakon_find_target_refs"].is_array() && !agentSpec["drakon_find_target_refs"].empty())) {
                needsReferenceTargets = true;
                break;
            }
        }
    }
    if (needsReferenceTargets) {
        referenceInventory = shared::fetchReferenceTargets(agent, payload);
        if (!referenceInventory.value("ok", false)) {
            result.answer = buildFailureAnswer_(language, safeText_(referenceInventory, "error"));
            result.metadata["task_state"] = buildCreateJobTaskState_(
                conversationContext,
                blueprint,
                "collecting_input",
                "awaiting_reference_targets",
                language == "pt" ? "Falha ao consultar referencias" : "Failed to load reference targets",
                result.answer,
                language,
                {});
            return result;
        }
    }

    for (auto& step : blueprint["steps"]) {
        const std::string execution = safeText_(step.value("execution", json::object()), "mode");
        const bool isGroupStep = execution == "inference_group_image";

        for (auto& agentSpec : step["agents"]) {
            json target = json::object();
            const std::string slotKey = safeText_(agentSpec, "camera_slot_key");
            for (const auto& targetCandidate : step.value("targets", json::array())) {
                if (safeText_(targetCandidate, "slot_key") == slotKey) {
                    target = targetCandidate;
                    break;
                }
            }

            json resolvedFaceTargets = json::array();
            json resolvedDrakonTargets = json::array();
            if (needsReferenceTargets) {
                const json faceResolution = shared::resolveNamedReference(
                    referenceInventory.value("face_targets", json::array()),
                    agentSpec.value("face_target_refs", json::array()),
                    false);
                const json drakonResolution = shared::resolveNamedReference(
                    referenceInventory.value("drakon_find_targets", json::array()),
                    agentSpec.value("drakon_find_target_refs", json::array()),
                    true);
                if (safeText_(faceResolution, "status") != "resolved" ||
                    safeText_(drakonResolution, "status") != "resolved") {
                    result.answer = buildFailureAnswer_(language, "reference_target_resolution_failed");
                    result.metadata["task_state"] = buildCreateJobTaskState_(
                        conversationContext,
                        blueprint,
                        "collecting_input",
                        "awaiting_reference_confirmation",
                        language == "pt" ? "Aguardando confirmacao das referencias" : "Waiting for reference confirmation",
                        result.answer,
                        language,
                        {});
                    return result;
                }
                resolvedFaceTargets = faceResolution.value("items", json::array());
                resolvedDrakonTargets = drakonResolution.value("items", json::array());
            }

            json agentPatch = agentSpec.value("agent_patch", json::object());
            if (agentPatch.is_object() && !agentPatch.contains("input_type") && target.is_object() && !target.empty()) {
                agentPatch["input_type"] = safeText_(target, "input_type");
            }

            const json designContext = buildDesignContext_(step, target, agentSpec);
            const json resolvedCamera = target.value("resolved_camera", json::object());
            const int designCameraId = resolvedCamera.value("id", 0);
            const bool hasInlineSnapshot =
                !safeText_(agentPatch, "prompt_template").empty() &&
                !safeText_(agentPatch, "alert_condition").empty();

            std::string designError;
            json compiledSnapshot = hasInlineSnapshot
                ? materializeSnapshotFromPatch_(agentPatch, safeText_(agentSpec, "goal_summary"), resolvedFaceTargets)
                : shared::designAgentSnapshot(
                    agent,
                    payload,
                    language,
                    designCameraId,
                    safeText_(agentSpec, "goal_summary"),
                    agentPatch,
                    resolvedFaceTargets,
                    resolvedDrakonTargets,
                    designContext,
                    designContext.value("needs_visual_context", false),
                    designError);

            if (compiledSnapshot.empty()) {
                result.answer = buildFailureAnswer_(language, designError.empty() ? "agent_design_failed" : designError);
                result.metadata["task_state"] = buildCreateJobTaskState_(
                    conversationContext,
                    blueprint,
                    "collecting_input",
                    "awaiting_design_retry",
                    language == "pt" ? "Falha ao desenhar os agentes" : "Failed to design the agents",
                    result.answer,
                    language,
                    {});
                return result;
            }

            if (isGroupStep && step.value("inference_group", json::object()).value("compiled_snapshot", json::object()).empty()) {
                step["inference_group"]["compiled_snapshot"] = compiledSnapshot;
            }
            agentSpec["compiled_snapshot"] = compiledSnapshot;
        }
    }

    postChatProgress(
        agent,
        payload,
        buildJobProgress_(language, "creating_job", 4, 4, 4),
        2000);

    const json installRequest = shared::compileBlueprintToInstallRequest(blueprint);
    const HttpResponse installResponse = postJson(
        installTaskUrl_(agent, payload),
        json::object({
            { "snapshot", installRequest.value("snapshot", json::object()) },
            { "camera_slot_mapping", installRequest.value("camera_slot_mapping", json::array()) },
        }).dump(),
        agent.getExeToken(),
        {},
        30000);
    if (!installResponse.ok()) {
        result.answer = buildFailureAnswer_(language, shared::parseErrorMessage(installResponse));
        result.metadata["task_state"] = buildCreateJobTaskState_(
            conversationContext,
            blueprint,
            "collecting_input",
            "awaiting_apply_retry",
            language == "pt" ? "Falha ao instalar o job" : "Failed to install the job",
            result.answer,
            language,
            {});
        return result;
    }

    const json installed = json::parse(installResponse.body, nullptr, false);
    const std::string requestedJobName = safeText_(blueprint.value("job", json::object()), "name");
    const std::string installedJobName = safeText_(installed.value("job", json::object()), "name");
    const std::string answerJobName = !installedJobName.empty() ? installedJobName : requestedJobName;
    if (normalizeAssistantLanguageTag(language) == "pt") {
        result.answer = answerJobName.empty()
            ? "Criei o job com o workflow estruturado em JSON."
            : "Criei o job \"" + answerJobName + "\" com o workflow estruturado em JSON.";
    }
    else {
        result.answer = answerJobName.empty()
            ? "I created the job with the workflow structured as JSON."
            : "I created the job \"" + answerJobName + "\" with the workflow structured as JSON.";
    }
    result.metadata["job"] = installed.value("job", json::object());
    result.metadata["task_state"] = buildCreateJobTaskState_(
        conversationContext,
        blueprint,
        "completed",
        "job_created",
        normalizeAssistantLanguageTag(language) == "pt" ? "Job criado" : "Job created",
        result.answer,
        language,
        {});
    return result;
}

} // namespace chatv2

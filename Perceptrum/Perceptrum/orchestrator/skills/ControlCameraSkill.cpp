#include "ControlCameraSkill.h"

#include <algorithm>
#include <sstream>
#include <utility>
#include <vector>

#include "../../core/AgentCore.h"
#include "../HttpUtils.h"
#include "../OperationTaskState.h"
#include "../ProgressUtils.h"
#include "../PromptBuilder.h"
#include "../RoutingLexicon.h"
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
    const RoutingLexiconSignals signals = detectRoutingLexiconSignals(value);
    const std::string runtimeAction = runtimeActionFromRoutingSignals(signals);
    if (!runtimeAction.empty()) {
        return runtimeAction;
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
        "scene_label",
        "scene_description",
        "ip_address",
        "manufacturer",
        "connection_method",
        "channel",
        "subtype",
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
    if (safeText_(activeTask, "type") != "control_camera") {
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

    if (selection.arguments.contains("resolved_camera") && selection.arguments["resolved_camera"].is_object()) {
        draft["resolved_camera"] = selection.arguments["resolved_camera"];
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

json buildResolvedCamera_(const json& camera)
{
    return json::object({
        { "id", camera.value("id", 0) },
        { "name", safeText_(camera, "name") },
        { "description", safeText_(camera, "description") },
        { "scene_label", safeText_(camera, "scene_label") },
        { "scene_description", safeText_(camera, "scene_description") },
        { "ip_address", safeText_(camera, "ip_address") },
        { "manufacturer", safeText_(camera, "manufacturer") },
        { "connection_method", safeText_(camera, "connection_method") },
        { "channel", safeText_(camera, "channel") },
        { "subtype", safeText_(camera, "subtype") },
        { "is_service_running", boolField_(camera, "is_service_running") },
    });
}

json fetchMutationGrounding_(
    AgentCore& agent,
    const json& payload,
    const std::string& language,
    const std::string& action,
    const json& draft)
{
    json request = {
        { "query", payload.is_object() ? payload.value("query", std::string()) : std::string() },
        { "reply_language", language },
        { "operation_type", "control_camera" },
        { "runtime_action", action },
        { "target_selector", draft.value("target_selector", json::object()) },
        { "resolved_camera", draft.value("resolved_camera", json::object()) },
    };
    return shared::resolveMutationGrounding(agent, payload, request);
}

std::string cameraName_(const json& camera)
{
    const std::string name = safeText_(camera, "name");
    if (!name.empty()) {
        return name;
    }
    const int id = camera.value("id", 0);
    if (id > 0) {
        return "camera #" + std::to_string(id);
    }
    return "camera";
}

std::string selectorLabel_(const json& selector)
{
    const std::vector<const char*> fields = {
        "name",
        "description",
        "scene_label",
        "scene_description",
        "ip_address",
    };
    for (const auto* field : fields) {
        const std::string value = safeText_(selector, field);
        if (!value.empty()) {
            return value;
        }
    }
    const int id = selector.value("id", 0);
    if (id > 0) {
        return "camera #" + std::to_string(id);
    }
    return "";
}

std::string actionVerb_(bool pt, const std::string& action)
{
    if (action == "start") {
        return pt ? "ligar" : "start";
    }
    if (action == "stop") {
        return pt ? "parar" : "stop";
    }
    return pt ? "controlar" : "control";
}

std::string actionPast_(bool pt, const std::string& action)
{
    if (action == "start") {
        return pt ? "liguei" : "started";
    }
    if (action == "stop") {
        return pt ? "parei" : "stopped";
    }
    return pt ? "controlei" : "controlled";
}

std::string actionState_(bool pt, const std::string& action)
{
    if (action == "start") {
        return pt ? "ligada" : "running";
    }
    if (action == "stop") {
        return pt ? "parada" : "stopped";
    }
    return pt ? "controlada" : "updated";
}

std::string buildNeedActionAnswer_(const std::string& language, const json& resolvedCamera)
{
    const bool pt = isPt_(language);
    const std::string cameraName = cameraName_(resolvedCamera);
    if (resolvedCamera.is_object() && resolvedCamera.value("id", 0) > 0) {
        return pt
            ? "Voce quer ligar ou parar a camera \"" + cameraName + "\"?"
            : "Do you want me to start or stop the camera \"" + cameraName + "\"?";
    }
    return pt
        ? "Voce quer ligar ou parar qual camera?"
        : "Do you want me to start or stop which camera?";
}

std::string buildNeedTargetAnswer_(const std::string& language, const std::string& action)
{
    const bool pt = isPt_(language);
    const std::string verb = actionVerb_(pt, action);
    return pt
        ? "Qual camera voce quer que eu " + verb + "?"
        : "Which camera do you want me to " + verb + "?";
}

std::string buildNotFoundAnswer_(const std::string& language, const std::string& action, const json& selector)
{
    const bool pt = isPt_(language);
    const std::string selectorName = selectorLabel_(selector);
    if (!selectorName.empty()) {
        return pt
            ? "Nao encontrei uma camera para " + actionVerb_(pt, action) + " que combine com \"" + selectorName + "\"."
            : "I could not find a camera to " + actionVerb_(pt, action) + " that matches \"" + selectorName + "\".";
    }
    return pt
        ? "Nao encontrei a camera que voce quer controlar."
        : "I could not find the camera you want to control.";
}

std::string buildAmbiguousAnswer_(const std::string& language, const std::string& action, const json& candidates)
{
    const bool pt = isPt_(language);
    std::ostringstream out;
    out << (pt
        ? "Encontrei mais de uma camera para " + actionVerb_(pt, action) + ". Me diga qual destas voce quer:\n"
        : "I found more than one camera to " + actionVerb_(pt, action) + ". Tell me which one you want:\n");

    const std::size_t limit = std::min<std::size_t>(5, candidates.is_array() ? candidates.size() : 0);
    for (std::size_t index = 0; index < limit; ++index) {
        const json item = candidates[index];
        out << "- " << cameraName_(item);
        const std::string description = safeText_(item, "description");
        if (!description.empty()) {
            out << " (" << description << ")";
        }
        out << "\n";
    }

    return shared::trimText(out.str());
}

std::string buildAlreadyAnswer_(const std::string& language, const std::string& action, const json& camera)
{
    const bool pt = isPt_(language);
    return pt
        ? "A camera \"" + cameraName_(camera) + "\" ja esta " + actionState_(pt, action) + "."
        : "The camera \"" + cameraName_(camera) + "\" is already " + actionState_(pt, action) + ".";
}

std::string buildSuccessAnswer_(const std::string& language, const std::string& action, const json& camera)
{
    const bool pt = isPt_(language);
    return pt
        ? "Pronto, " + actionPast_(pt, action) + " a camera \"" + cameraName_(camera) + "\"."
        : "Done, I " + actionPast_(pt, action) + " the camera \"" + cameraName_(camera) + "\".";
}

std::string buildFailureAnswer_(const std::string& language, const std::string& action, const std::string& detail)
{
    const bool pt = isPt_(language);
    if (!detail.empty()) {
        return pt
            ? "Nao consegui " + actionVerb_(pt, action) + " a camera agora. Detalhe: " + detail
            : "I could not " + actionVerb_(pt, action) + " the camera right now. Detail: " + detail;
    }
    return pt
        ? "Nao consegui controlar a camera agora."
        : "I could not control the camera right now.";
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
    descriptor.type = "control_camera";
    descriptor.entityType = "camera";
    descriptor.intent = "update";
    descriptor.status = taskStatus;
    descriptor.phase = phase;
    descriptor.language = language;
    descriptor.goal = "control_camera_runtime";
    descriptor.summary = summary;
    descriptor.answerPreview = answer;
    descriptor.missingFields = missingFields;
    descriptor.draft = draft.is_object() ? draft : json::object();
    if (descriptor.draft.contains("runtime_action")) {
        descriptor.collectedFields.push_back("runtime_action");
    }
    if (descriptor.draft.contains("resolved_camera")) {
        descriptor.collectedFields.push_back("camera");
    }
    return complete
        ? completeOperationTask(conversationContext, descriptor)
        : upsertActiveOperationTask(conversationContext, descriptor);
}

std::string actionUrl_(AgentCore& agent, const json& payload, int cameraId, const std::string& action)
{
    const std::string clientId = shared::clientIdFromPayload(payload).empty()
        ? agent.getClientId()
        : shared::clientIdFromPayload(payload);
    return agent.getBackendBaseUrl() + "/api/agent/cameras/" +
        std::to_string(cameraId) + "/" + action + "?client_id=" + clientId;
}

} // namespace

SkillDefinition ControlCameraSkill::definition() const
{
    return SkillDefinition{
        "control_camera",
        "Starts or stops one existing camera runtime from chat.",
        true,
    };
}

SkillRunResult ControlCameraSkill::execute(
    AgentCore& agent,
    const json& payload,
    const SkillSelection& selection)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "control_camera";
    result.metadata["skip_polish"] = true;

    const json conversationContext = shared::loadConversationContext(agent, payload);
    const std::string language = shared::effectiveReplyLanguage(selection, payload, conversationContext);

    json draft = mergeObjectValues_(activeDraft_(conversationContext), selectionDraft_(selection));
    const std::string action = normalizedAction_(safeText_(draft, "runtime_action"));
    if (action.empty()) {
        result.answer = buildNeedActionAnswer_(language, draft.value("resolved_camera", json::object()));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_action",
            isPt_(language) ? "Aguardando acao da camera" : "Waiting for the camera action",
            result.answer,
            { "runtime_action" },
            false);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "control_camera", "resolving_target", 2, 2, 3),
        2000);

    const json mutationGrounding = fetchMutationGrounding_(agent, payload, language, action, draft);
    const bool hasMutationGroundingPlan =
        mutationGrounding.is_object() &&
        mutationGrounding.value("ok", false) &&
        mutationGrounding.contains("plan") &&
        mutationGrounding["plan"].is_object();
    if (hasMutationGroundingPlan) {
        result.metadata["mutation_grounding"] = mutationGrounding;
        const json plan = mutationGrounding["plan"];
        const json canonicalArguments = plan.value("canonical_arguments", json::object());
        if (canonicalArguments.contains("target_selector") && canonicalArguments["target_selector"].is_object()) {
            draft["target_selector"] = canonicalArguments["target_selector"];
        }
        const std::string groundedAction = normalizedAction_(safeText_(canonicalArguments, "runtime_action"));
        if (!groundedAction.empty()) {
            draft["runtime_action"] = groundedAction;
        }

        const std::string groundingStatus = safeText_(plan, "status");
        if (groundingStatus == "missing_target") {
            result.answer = buildNeedTargetAnswer_(language, action);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                draft,
                language,
                "pending",
                "awaiting_target",
                isPt_(language) ? "Aguardando camera" : "Waiting for the camera",
                result.answer,
                { "target_selector" },
                false);
            return result;
        }

        if (groundingStatus == "ambiguous") {
            draft["candidate_cameras"] = plan.value("candidate_targets", json::array());
            result.answer = buildAmbiguousAnswer_(language, action, draft["candidate_cameras"]);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                draft,
                language,
                "pending",
                "awaiting_target_confirmation",
                isPt_(language) ? "Aguardando confirmacao da camera" : "Waiting for camera confirmation",
                result.answer,
                { "target_selector" },
                false);
            return result;
        }

        if (groundingStatus == "not_found") {
            result.answer = buildNotFoundAnswer_(language, action, draft.value("target_selector", json::object()));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                draft,
                language,
                "pending",
                "awaiting_target",
                isPt_(language) ? "Camera nao encontrada" : "Camera not found",
                result.answer,
                { "target_selector" },
                false);
            return result;
        }

        if (groundingStatus == "resolved" &&
            canonicalArguments.contains("resolved_camera") &&
            canonicalArguments["resolved_camera"].is_object()) {
            draft["resolved_camera"] = canonicalArguments["resolved_camera"];
            draft.erase("candidate_cameras");
        }
    }
    else {
        const std::string groundingError = safeText_(mutationGrounding, "error");
        if (!groundingError.empty()) {
            result.metadata["mutation_grounding_error"] = groundingError;
        }
    }

    json resolvedCamera = draft.value("resolved_camera", json::object());
    if (!resolvedCamera.is_object() || resolvedCamera.empty()) {
        const json inventory = shared::fetchCameraInventory(agent, payload);
        if (!inventory.value("ok", false)) {
            result.answer = buildFailureAnswer_(language, action, safeText_(inventory, "error"));
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                draft,
                language,
                "pending",
                "awaiting_inventory",
                isPt_(language) ? "Falha ao consultar cameras" : "Failed to load cameras",
                result.answer,
                {},
                false);
            return result;
        }

        const json resolution = shared::resolveCamera(
            inventory,
            draft.value("target_selector", json::object()),
            draft.value("resolved_camera", json::object()));
        const std::string resolutionStatus = safeText_(resolution, "status");
        if (resolutionStatus == "missing_target") {
            result.answer = buildNeedTargetAnswer_(language, action);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                draft,
                language,
                "pending",
                "awaiting_target",
                isPt_(language) ? "Aguardando camera" : "Waiting for the camera",
                result.answer,
                { "target_selector" },
                false);
            return result;
        }

        if (resolutionStatus == "ambiguous") {
            draft["candidate_cameras"] = resolution.value("candidates", json::array());
            result.answer = buildAmbiguousAnswer_(language, action, draft["candidate_cameras"]);
            result.metadata["task_state"] = buildTaskState_(
                conversationContext,
                draft,
                language,
                "pending",
                "awaiting_target_confirmation",
                isPt_(language) ? "Aguardando confirmacao da camera" : "Waiting for camera confirmation",
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
                isPt_(language) ? "Camera nao encontrada" : "Camera not found",
                result.answer,
                { "target_selector" },
                false);
            return result;
        }

        resolvedCamera = buildResolvedCamera_(resolution["item"]);
        draft["resolved_camera"] = resolvedCamera;
        draft.erase("candidate_cameras");
    }

    const bool isRunning = boolField_(resolvedCamera, "is_service_running");
    if ((action == "start" && isRunning) || (action == "stop" && !isRunning)) {
        result.answer = buildAlreadyAnswer_(language, action, resolvedCamera);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "completed",
            "already_applied",
            isPt_(language) ? "Camera ja estava no estado pedido" : "Camera was already in the requested state",
            result.answer,
            {},
            true);
        return result;
    }

    postChatProgress(
        agent,
        payload,
        makeProgressUpdate(language, "control_camera", "applying_action", 3, 3, 3),
        2500);

    const HttpResponse response = postJson(
        actionUrl_(agent, payload, resolvedCamera.value("id", 0), action),
        json::object().dump(),
        agent.getExeToken(),
        {},
        action == "start" ? 12000 : 9000);
    if (!response.ok()) {
        result.answer = buildFailureAnswer_(language, action, shared::parseErrorMessage(response));
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "pending",
            "awaiting_retry",
            isPt_(language) ? "Falha ao controlar a camera" : "Failed to control the camera",
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
        result.answer = buildAlreadyAnswer_(language, action, resolvedCamera);
        result.metadata["task_state"] = buildTaskState_(
            conversationContext,
            draft,
            language,
            "completed",
            "already_applied",
            isPt_(language) ? "Camera ja estava no estado pedido" : "Camera was already in the requested state",
            result.answer,
            {},
            true);
        return result;
    }

    json updatedCamera = resolvedCamera;
    updatedCamera["is_service_running"] = action == "start";
    draft["resolved_camera"] = updatedCamera;

    result.answer = buildSuccessAnswer_(language, action, updatedCamera);
    result.metadata["task_state"] = buildTaskState_(
        conversationContext,
        draft,
        language,
        "completed",
        action == "start" ? "camera_started" : "camera_stopped",
        action == "start"
            ? (isPt_(language) ? "Camera ligada" : "Camera started")
            : (isPt_(language) ? "Camera parada" : "Camera stopped"),
        result.answer,
        {},
        true);
    return result;
}

} // namespace chatv2

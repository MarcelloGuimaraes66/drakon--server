#include "JobBlueprintShared.h"

#include <algorithm>
#include <map>
#include <set>
#include <sstream>
#include <utility>
#include <vector>

#include "AgentAuthoringShared.h"
#include "../../LocalLlmClient.h"
#include "../../OperationTaskState.h"
#include "../../PromptBuilder.h"

namespace chatv2 {
namespace shared {
namespace {

using nlohmann::json;

std::string text_(const json& value, const char* key)
{
    return normalizeInlineWhitespace(jsonStringField(value, key));
}

bool boolField_(const json& value, const char* key, bool fallback)
{
    if (!value.is_object() || !value.contains(key)) {
        return fallback;
    }
    bool parsed = fallback;
    return readBoolLoose(value[key], parsed) ? parsed : fallback;
}

int intField_(const json& value, const char* key, int fallback)
{
    int out = fallback;
    return tryJsonIntField(value, key, out) ? out : fallback;
}

bool isValidScheduleMode_(const std::string& value)
{
    return value == "weekly" || value == "monthly" || value == "yearly";
}

bool isValidStartMode_(const std::string& value)
{
    return value == "none" ||
        value == "sequential" ||
        value == "positive" ||
        value == "negative" ||
        value == "time" ||
        value == "elapsed" ||
        value == "custom";
}

bool hasDecisionConstraint_(const json& value, const std::string& expected)
{
    const json constraints = value.value("decision", json::object()).value("constraints", json::array());
    if (!constraints.is_array()) {
        return false;
    }

    const std::string normalizedExpected = lowerAscii(normalizeInlineWhitespace(expected));
    for (const auto& item : constraints) {
        if (!item.is_string()) {
            continue;
        }
        if (lowerAscii(normalizeInlineWhitespace(item.get<std::string>())) == normalizedExpected) {
            return true;
        }
    }
    return false;
}

void ensureDecisionConstraint_(json& value, const std::string& constraint)
{
    if (hasDecisionConstraint_(value, constraint)) {
        return;
    }

    if (!value.contains("decision") || !value["decision"].is_object()) {
        value["decision"] = json::object();
    }
    if (!value["decision"].contains("constraints") || !value["decision"]["constraints"].is_array()) {
        value["decision"]["constraints"] = json::array();
    }
    value["decision"]["constraints"].push_back(normalizeInlineWhitespace(constraint));
}

bool isExplicitCreateJobSelection_(const SkillSelection& selection)
{
    if (lowerAscii(normalizeInlineWhitespace(selection.selectedSkill)) != "create_job") {
        return false;
    }

    const std::string reason = lowerAscii(normalizeInlineWhitespace(selection.reason));
    if (reason == "explicit_job_creation_action_request") {
        return true;
    }
    return reason == "routing_lexicon_override" &&
        lowerAscii(normalizeInlineWhitespace(selection.entity)) == "job" &&
        lowerAscii(normalizeInlineWhitespace(selection.intent)) == "create";
}

json normalizeReferenceRef_(const json& value, bool allowTraits)
{
    json normalized = json::object();
    if (value.is_string()) {
        const std::string name = normalizeInlineWhitespace(value.get<std::string>());
        if (!name.empty()) {
            normalized["name"] = name;
        }
        return normalized;
    }
    if (!value.is_object()) {
        return normalized;
    }

    int id = 0;
    if (tryJsonIntField(value, "id", id) && id > 0) {
        normalized["id"] = id;
    }

    const std::vector<const char*> stringFields = {
        "name",
        "description",
        "entity_type",
    };
    for (const auto* field : stringFields) {
        const std::string current = text_(value, field);
        if (!current.empty()) {
            normalized[field] = current;
        }
    }

    if (allowTraits && value.contains("traits") && value["traits"].is_array()) {
        json traits = json::array();
        for (const auto& trait : value["traits"]) {
            if (!trait.is_string()) {
                continue;
            }
            const std::string current = normalizeInlineWhitespace(trait.get<std::string>());
            if (!current.empty()) {
                traits.push_back(current);
            }
        }
        if (!traits.empty()) {
            normalized["traits"] = traits;
        }
    }

    return normalized;
}

json normalizeReferenceList_(const json& value, bool allowTraits)
{
    json normalized = json::array();
    if (!value.is_array()) {
        return normalized;
    }
    for (const auto& row : value) {
        const json current = normalizeReferenceRef_(row, allowTraits);
        if (!current.empty()) {
            normalized.push_back(current);
        }
    }
    return normalized;
}

json normalizeCameraSelector_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    int id = 0;
    if (tryJsonIntField(value, "id", id) && id > 0) {
        normalized["id"] = id;
    }

    const std::vector<const char*> stringFields = {
        "name",
        "description",
        "scene_label",
        "scene_description",
        "ip_address",
        "manufacturer",
        "channel",
        "subtype",
        "connection_method",
    };
    for (const auto* field : stringFields) {
        const std::string current = text_(value, field);
        if (!current.empty()) {
            normalized[field] = current;
        }
    }
    return normalized;
}

json normalizeOutputContract_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }
    const std::string format = lowerAscii(text_(value, "format"));
    if (format == "json_object" || format == "single_line_kv") {
        normalized["format"] = format;
    }
    if (value.contains("downstream_safe")) {
        normalized["downstream_safe"] = boolField_(value, "downstream_safe", true);
    }
    if (value.contains("schema") && value["schema"].is_object()) {
        normalized["schema"] = value["schema"];
    }
    if (value.contains("example") && value["example"].is_object()) {
        normalized["example"] = value["example"];
    }
    return normalized;
}

json normalizeAgentPatch_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::vector<const char*> stringFields = {
        "display_name",
        "summary",
        "prompt_template",
        "alert_condition",
        "negative_condition",
        "input_type",
        "video_packaging_mode",
        "inference_model",
    };
    for (const auto* field : stringFields) {
        const std::string current = text_(value, field);
        if (!current.empty()) {
            normalized[field] = current;
        }
    }

    const std::vector<const char*> intFields = {
        "model_fps",
        "run_every",
        "running_resolution",
    };
    for (const auto* field : intFields) {
        int current = 0;
        if (tryJsonIntField(value, field, current) && current >= 0) {
            normalized[field] = current;
        }
    }

    const std::vector<const char*> boolFields = {
        "only_capture_on_motion",
        "use_temporal_context",
        "is_enabled",
    };
    for (const auto* field : boolFields) {
        if (value.contains(field)) {
            normalized[field] = boolField_(value, field, true);
        }
    }

    if (value.contains("analysis_regions") && value["analysis_regions"].is_array()) {
        normalized["analysis_regions"] = value["analysis_regions"];
    }

    return normalized;
}

json normalizeScheduleWindow_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }
    const std::string start = text_(value, "start_time");
    const std::string end = text_(value, "end_time");
    if (!start.empty() && !end.empty()) {
        normalized["start_time"] = start;
        normalized["end_time"] = end;
    }
    return normalized;
}

json normalizeScheduleDay_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }
    const std::string dayName = text_(value, "day_name");
    if (!dayName.empty()) {
        normalized["day_name"] = dayName;
    }

    int fieldValue = 0;
    if (tryJsonIntField(value, "day_of_week", fieldValue)) {
        normalized["day_of_week"] = fieldValue;
    }
    if (tryJsonIntField(value, "day_of_month", fieldValue)) {
        normalized["day_of_month"] = fieldValue;
    }
    if (tryJsonIntField(value, "month_of_year", fieldValue)) {
        normalized["month_of_year"] = fieldValue;
    }

    json windows = json::array();
    if (value.contains("windows") && value["windows"].is_array()) {
        for (const auto& row : value["windows"]) {
            const json current = normalizeScheduleWindow_(row);
            if (!current.empty()) {
                windows.push_back(current);
            }
        }
    }
    if (!windows.empty()) {
        normalized["windows"] = windows;
    }
    return normalized;
}

json normalizeAnalysisScope_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }
    const std::vector<const char*> stringFields = {
        "goal",
        "entity_role",
    };
    for (const auto* field : stringFields) {
        const std::string current = text_(value, field);
        if (!current.empty()) {
            normalized[field] = current;
        }
    }
    const auto copyStringArray = [&](const char* key) {
        if (!value.contains(key) || !value[key].is_array()) {
            return;
        }
        json items = json::array();
        for (const auto& item : value[key]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string current = normalizeInlineWhitespace(item.get<std::string>());
            if (!current.empty()) {
                items.push_back(current);
            }
        }
        if (!items.empty()) {
            normalized[key] = items;
        }
    };
    copyStringArray("must_observe");
    copyStringArray("must_ignore");
    return normalized;
}

json normalizeTarget_(const json& value, int stepIndex, int targetIndex)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::string slotLabel = text_(value, "slot_label");
    const std::string fallbackKey = "camera_" + std::to_string(stepIndex + 1) + "_" + std::to_string(targetIndex + 1);
    const std::string slotKey =
        slugifyKey(text_(value, "slot_key").empty() ? slotLabel : text_(value, "slot_key"), fallbackKey);
    normalized["slot_key"] = slotKey;
    if (!slotLabel.empty()) {
        normalized["slot_label"] = slotLabel;
    }

    const json cameraSelector = normalizeCameraSelector_(value.value("camera_selector", json::object()));
    if (!cameraSelector.empty()) {
        normalized["camera_selector"] = cameraSelector;
    }

    const std::string inputType = lowerAscii(text_(value, "input_type"));
    normalized["input_type"] = inputType == "image" ? "image" : "video";

    const json analysisScope = normalizeAnalysisScope_(value.value("analysis_scope", json::object()));
    if (!analysisScope.empty()) {
        normalized["analysis_scope"] = analysisScope;
    }

    if (value.contains("camera_required")) {
        normalized["camera_required"] = boolField_(value, "camera_required", true);
    }

    if (value.contains("resolved_camera") && value["resolved_camera"].is_object()) {
        normalized["resolved_camera"] = value["resolved_camera"];
    }
    if (value.contains("resolution") && value["resolution"].is_object()) {
        normalized["resolution"] = value["resolution"];
    }

    return normalized;
}

json normalizeStartCondition_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::string mode = lowerAscii(text_(value, "mode"));
    if (isValidStartMode_(mode)) {
        normalized["mode"] = mode;
    }
    const std::string fromStepKey = slugifyKey(text_(value, "from_step_key"), "");
    if (!fromStepKey.empty()) {
        normalized["from_step_key"] = fromStepKey;
    }
    const std::string answerKey = text_(value, "answer_key");
    if (!answerKey.empty()) {
        normalized["answer_key"] = answerKey;
    }
    const std::string targetSlotKey = slugifyKey(text_(value, "target_slot_key"), "");
    if (!targetSlotKey.empty()) {
        normalized["target_slot_key"] = targetSlotKey;
    }
    const std::string timeHhmm = text_(value, "time_hhmm");
    if (!timeHhmm.empty()) {
        normalized["time_hhmm"] = timeHhmm;
    }
    int offsetSeconds = 0;
    if (tryJsonIntField(value, "time_offset_seconds", offsetSeconds)) {
        normalized["time_offset_seconds"] = (std::max)(0, offsetSeconds);
    }
    const std::string extractText = text_(value, "extract_text");
    if (!extractText.empty()) {
        normalized["extract_text"] = extractText;
    }
    return normalized;
}

json normalizeKnowledgeInput_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::string fromStepKey = slugifyKey(text_(value, "from_step_key"), "");
    if (!fromStepKey.empty()) {
        normalized["from_step_key"] = fromStepKey;
    }

    json fromSlots = json::array();
    if (value.contains("from_camera_slot_keys") && value["from_camera_slot_keys"].is_array()) {
        for (const auto& item : value["from_camera_slot_keys"]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string current = slugifyKey(item.get<std::string>(), "");
            if (!current.empty()) {
                fromSlots.push_back(current);
            }
        }
    }
    if (!fromSlots.empty()) {
        normalized["from_camera_slot_keys"] = fromSlots;
    }

    const std::string toCameraSlotKey = slugifyKey(text_(value, "to_camera_slot_key"), "");
    if (!toCameraSlotKey.empty()) {
        normalized["to_camera_slot_key"] = toCameraSlotKey;
    }

    const std::string contractKey = text_(value, "contract_key");
    if (!contractKey.empty()) {
        normalized["contract_key"] = contractKey;
    }

    normalized["required"] = boolField_(value, "required", true);

    const std::string summary = text_(value, "summary");
    if (!summary.empty()) {
        normalized["summary"] = summary;
    }

    return normalized;
}

json normalizeAgent_(const json& value, int stepIndex, int agentIndex)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::string destinationType = lowerAscii(text_(value, "destination_type"));
    if (destinationType == "step_default" || destinationType == "step_camera" || destinationType == "camera") {
        normalized["destination_type"] = destinationType;
    }
    else {
        normalized["destination_type"] = "step_camera";
    }

    const std::string cameraSlotKey = slugifyKey(text_(value, "camera_slot_key"), "");
    if (!cameraSlotKey.empty()) {
        normalized["camera_slot_key"] = cameraSlotKey;
    }

    const std::string goalSummary = text_(value, "goal_summary");
    if (!goalSummary.empty()) {
        normalized["goal_summary"] = goalSummary;
    }

    const std::string alertPolicy = lowerAscii(text_(value, "alert_policy"));
    if (alertPolicy == "never" || alertPolicy == "local" || alertPolicy == "final_decision_only") {
        normalized["alert_policy"] = alertPolicy;
    }
    else {
        normalized["alert_policy"] = "local";
    }

    const json outputContract = normalizeOutputContract_(value.value("output_contract", json::object()));
    if (!outputContract.empty()) {
        normalized["output_contract"] = outputContract;
    }

    if (value.contains("design_context") && value["design_context"].is_object()) {
        normalized["design_context"] = value["design_context"];
    }

    const json agentPatch = normalizeAgentPatch_(value.value("agent_patch", json::object()));
    if (!agentPatch.empty()) {
        normalized["agent_patch"] = agentPatch;
    }

    if (value.contains("field_sources") && value["field_sources"].is_object()) {
        normalized["field_sources"] = value["field_sources"];
    }

    const json faceTargetRefs = normalizeReferenceList_(value.value("face_target_refs", json::array()), false);
    if (!faceTargetRefs.empty()) {
        normalized["face_target_refs"] = faceTargetRefs;
    }
    const json drakonRefs = normalizeReferenceList_(value.value("drakon_find_target_refs", json::array()), true);
    if (!drakonRefs.empty()) {
        normalized["drakon_find_target_refs"] = drakonRefs;
    }

    if (value.contains("compiled_snapshot") && value["compiled_snapshot"].is_object()) {
        normalized["compiled_snapshot"] = value["compiled_snapshot"];
    }

    normalized["agent_key"] = "agent_" + std::to_string(stepIndex + 1) + "_" + std::to_string(agentIndex + 1);
    return normalized;
}

json normalizeInferenceGroup_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    normalized["enabled"] = boolField_(value, "enabled", false);
    normalized["allowed"] = boolField_(value, "allowed", false);

    const std::string reason = text_(value, "reason");
    if (!reason.empty()) {
        normalized["reason"] = reason;
    }

    json targetSlotKeys = json::array();
    if (value.contains("target_slot_keys") && value["target_slot_keys"].is_array()) {
        for (const auto& item : value["target_slot_keys"]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string current = slugifyKey(item.get<std::string>(), "");
            if (!current.empty()) {
                targetSlotKeys.push_back(current);
            }
        }
    }
    if (!targetSlotKeys.empty()) {
        normalized["target_slot_keys"] = targetSlotKeys;
    }

    const std::string sourceTargetSlotKey = slugifyKey(text_(value, "source_target_slot_key"), "");
    if (!sourceTargetSlotKey.empty()) {
        normalized["source_target_slot_key"] = sourceTargetSlotKey;
    }

    const std::string inputType = lowerAscii(text_(value, "input_type"));
    if (!inputType.empty()) {
        normalized["input_type"] = inputType == "image" ? "image" : "video";
    }

    const json sharedAgentPatch = normalizeAgentPatch_(value.value("shared_agent_patch", json::object()));
    if (!sharedAgentPatch.empty()) {
        normalized["shared_agent_patch"] = sharedAgentPatch;
    }

    if (value.contains("compiled_snapshot") && value["compiled_snapshot"].is_object()) {
        normalized["compiled_snapshot"] = value["compiled_snapshot"];
    }

    return normalized;
}

json normalizeStep_(const json& value, int index)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    const std::string name = text_(value, "name");
    const std::string stepKey = slugifyKey(
        text_(value, "step_key").empty() ? name : text_(value, "step_key"),
        "step_" + std::to_string(index + 1));
    normalized["step_key"] = stepKey;
    normalized["name"] = name.empty() ? stepKey : name;

    const std::string role = lowerAscii(text_(value, "role"));
    if (role == "collector" || role == "validator" || role == "decision") {
        normalized["role"] = role;
    }
    else {
        normalized["role"] = "collector";
    }

    int timeoutSeconds = 120;
    if (tryJsonIntField(value, "timeout_seconds", timeoutSeconds)) {
        timeoutSeconds = (std::max)(120, timeoutSeconds);
    }
    normalized["timeout_seconds"] = timeoutSeconds;

    json execution = json::object();
    const std::string executionMode = lowerAscii(text_(value.value("execution", json::object()), "mode"));
    if (executionMode == "per_target_agents" || executionMode == "inference_group_image") {
        execution["mode"] = executionMode;
    }
    const std::string executionReason = text_(value.value("execution", json::object()), "reason");
    if (!executionReason.empty()) {
        execution["reason"] = executionReason;
    }
    if (!execution.empty()) {
        normalized["execution"] = execution;
    }

    const json startCondition = normalizeStartCondition_(value.value("start_condition", json::object()));
    if (!startCondition.empty()) {
        normalized["start_condition"] = startCondition;
    }

    json knowledgeInputs = json::array();
    if (value.contains("knowledge_inputs") && value["knowledge_inputs"].is_array()) {
        for (const auto& row : value["knowledge_inputs"]) {
            const json current = normalizeKnowledgeInput_(row);
            if (!current.empty()) {
                knowledgeInputs.push_back(current);
            }
        }
    }
    if (!knowledgeInputs.empty()) {
        normalized["knowledge_inputs"] = knowledgeInputs;
    }

    json targets = json::array();
    if (value.contains("targets") && value["targets"].is_array()) {
        int targetIndex = 0;
        for (const auto& row : value["targets"]) {
            const json current = normalizeTarget_(row, index, targetIndex++);
            if (!current.empty()) {
                targets.push_back(current);
            }
        }
    }
    if (!targets.empty()) {
        normalized["targets"] = targets;
    }

    json agents = json::array();
    if (value.contains("agents") && value["agents"].is_array()) {
        int agentIndex = 0;
        for (const auto& row : value["agents"]) {
            const json current = normalizeAgent_(row, index, agentIndex++);
            if (!current.empty()) {
                agents.push_back(current);
            }
        }
    }
    if (!agents.empty()) {
        normalized["agents"] = agents;
    }

    const json inferenceGroup = normalizeInferenceGroup_(value.value("inference_group", json::object()));
    if (!inferenceGroup.empty()) {
        normalized["inference_group"] = inferenceGroup;
    }

    return normalized;
}

std::string stepIdentityKey_(const json& step)
{
    const std::string stepKey = text_(step, "step_key");
    if (!stepKey.empty()) {
        return slugifyKey(stepKey, "");
    }
    return slugifyKey(text_(step, "name"), "");
}

std::string targetIdentityKey_(const json& target)
{
    const std::string slotKey = text_(target, "slot_key");
    if (!slotKey.empty()) {
        return slugifyKey(slotKey, "");
    }
    return slugifyKey(text_(target, "slot_label"), "");
}

bool targetRequiresPhysicalCamera_(const json& step, const json& target)
{
    if (target.contains("camera_required")) {
        return boolField_(target, "camera_required", true);
    }

    const json selector = target.value("camera_selector", json::object());
    if (selector.is_object() && !selector.empty()) {
        return true;
    }

    const json resolvedCamera = target.value("resolved_camera", json::object());
    if (resolvedCamera.is_object() && !resolvedCamera.empty()) {
        return true;
    }

    const std::string slotKey = targetIdentityKey_(target);
    if (slotKey.empty()) {
        return true;
    }

    const std::string executionMode = lowerAscii(text_(step.value("execution", json::object()), "mode"));
    if (executionMode == "inference_group_image") {
        return true;
    }

    const json inferenceGroup = step.value("inference_group", json::object());
    if (boolField_(inferenceGroup, "enabled", false) || boolField_(inferenceGroup, "allowed", false)) {
        const json groupTargets = inferenceGroup.value("target_slot_keys", json::array());
        if (!groupTargets.is_array() || groupTargets.empty()) {
            return true;
        }
        for (const auto& slotValue : groupTargets) {
            if (!slotValue.is_string()) {
                continue;
            }
            if (slugifyKey(slotValue.get<std::string>(), "") == slotKey) {
                return true;
            }
        }
    }

    for (const auto& agent : step.value("agents", json::array())) {
        const std::string destinationType = lowerAscii(text_(agent, "destination_type"));
        if (destinationType != "step_camera" && destinationType != "camera") {
            continue;
        }
        if (slugifyKey(text_(agent, "camera_slot_key"), "") == slotKey) {
            return true;
        }
    }

    return lowerAscii(text_(target, "input_type")) != "image";
}

bool snapshotHasPromptContract_(const json& value)
{
    return !text_(value, "prompt_template").empty() &&
        !text_(value, "alert_condition").empty();
}

bool agentSpecHasAnalysis_(const json& agent)
{
    if (!text_(agent, "goal_summary").empty()) {
        return true;
    }
    if (snapshotHasPromptContract_(agent.value("agent_patch", json::object()))) {
        return true;
    }
    if (snapshotHasPromptContract_(agent.value("compiled_snapshot", json::object()))) {
        return true;
    }
    return false;
}

bool inferenceGroupHasAnalysis_(const json& step)
{
    const json inferenceGroup = step.value("inference_group", json::object());
    return snapshotHasPromptContract_(inferenceGroup.value("shared_agent_patch", json::object())) ||
        snapshotHasPromptContract_(inferenceGroup.value("compiled_snapshot", json::object()));
}

std::string resolveInferenceGroupSourceLocalSlotKey_(const json& step)
{
    const auto isKnownTargetSlot = [&](const std::string& candidate) -> bool {
        if (candidate.empty()) {
            return false;
        }
        for (const auto& target : step.value("targets", json::array())) {
            if (slugifyKey(text_(target, "slot_key"), "") == candidate) {
                return true;
            }
        }
        return false;
    };

    const json inferenceGroup = step.value("inference_group", json::object());
    const std::string explicitSource =
        slugifyKey(text_(inferenceGroup, "source_target_slot_key"), "");
    if (isKnownTargetSlot(explicitSource)) {
        return explicitSource;
    }

    for (const auto& slotValue : inferenceGroup.value("target_slot_keys", json::array())) {
        if (!slotValue.is_string()) {
            continue;
        }
        const std::string candidate = slugifyKey(slotValue.get<std::string>(), "");
        if (isKnownTargetSlot(candidate)) {
            return candidate;
        }
    }

    for (const auto& agent : step.value("agents", json::array())) {
        const std::string candidate = slugifyKey(text_(agent, "camera_slot_key"), "");
        if (isKnownTargetSlot(candidate)) {
            return candidate;
        }
    }

    for (const auto& target : step.value("targets", json::array())) {
        const std::string candidate = slugifyKey(text_(target, "slot_key"), "");
        if (isKnownTargetSlot(candidate)) {
            return candidate;
        }
    }

    return "";
}

json mergeObjectShallow_(const json& baseValue, const json& incomingValue)
{
    json merged = baseValue.is_object() ? baseValue : json::object();
    if (!incomingValue.is_object()) {
        return merged;
    }
    for (auto it = incomingValue.begin(); it != incomingValue.end(); ++it) {
        merged[it.key()] = it.value();
    }
    return merged;
}

json mergeArrayByIdentity_(
    const json& existingArray,
    const json& incomingArray,
    bool isTarget)
{
    json merged = existingArray.is_array() ? existingArray : json::array();
    if (!incomingArray.is_array()) {
        return merged;
    }

    std::map<std::string, std::size_t> indexByKey;
    for (std::size_t index = 0; index < merged.size(); ++index) {
        const json& item = merged[index];
        const std::string key = isTarget ? targetIdentityKey_(item) : stepIdentityKey_(item);
        if (!key.empty()) {
            indexByKey[key] = index;
        }
    }

    for (const auto& incoming : incomingArray) {
        const std::string key = isTarget ? targetIdentityKey_(incoming) : stepIdentityKey_(incoming);
        if (key.empty() || !indexByKey.count(key)) {
            merged.push_back(incoming);
            if (!key.empty()) {
                indexByKey[key] = merged.size() - 1;
            }
            continue;
        }

        json combined = merged[indexByKey[key]];
        if (incoming.is_object()) {
            for (auto it = incoming.begin(); it != incoming.end(); ++it) {
                if (it.value().is_array()) {
                    combined[it.key()] = it.value();
                }
                else if (it.value().is_object()) {
                    combined[it.key()] = mergeObjectShallow_(combined.value(it.key(), json::object()), it.value());
                }
                else {
                    combined[it.key()] = it.value();
                }
            }
        }
        merged[indexByKey[key]] = combined;
    }
    return merged;
}

json normalizeSourceJobRef_(const json& value)
{
    json normalized = json::object();
    if (!value.is_object()) {
        return normalized;
    }

    int id = 0;
    if (tryJsonIntField(value, "id", id) && id > 0) {
        normalized["id"] = id;
    }
    const std::string name = text_(value, "name");
    if (!name.empty()) {
        normalized["name"] = name;
    }
    const std::string description = text_(value, "description");
    if (!description.empty()) {
        normalized["description"] = description;
    }
    return normalized;
}

json normalizeCopyFromSource_(const json& value)
{
    json normalized = json::object({
        { "camera_targets", false },
        { "step_topology", false },
        { "agent_templates", false },
    });
    if (!value.is_object()) {
        return normalized;
    }

    for (const auto* field : { "camera_targets", "step_topology", "agent_templates" }) {
        if (value.contains(field)) {
            normalized[field] = boolField_(value, field, false);
        }
    }
    return normalized;
}

} // namespace

json defaultJobBlueprint()
{
    return json::object({
        { "blueprint_version", 1 },
        { "decision", json::object({
            { "execution_mode", "" },
            { "reason", "" },
            { "constraints", json::array() },
        }) },
        { "job", json::object({
            { "name", "" },
            { "description", "" },
            { "schedule", json::object({
                { "mode", "none" },
                { "timezone", "" },
                { "active_from", "" },
                { "active_until", nullptr },
                { "schedule_days", json::array() },
            }) },
        }) },
        { "source_job_ref", json::object() },
        { "copy_from_source", json::object({
            { "camera_targets", false },
            { "step_topology", false },
            { "agent_templates", false },
        }) },
        { "steps", json::array() },
        { "validation", json::object({
            { "missing_fields", json::array() },
            { "warnings", json::array() },
            { "ready_to_apply", false },
        }) },
    });
}

json normalizeJobBlueprint(const json& value)
{
    json normalized = defaultJobBlueprint();
    if (!value.is_object()) {
        return normalized;
    }

    const std::string executionMode = lowerAscii(text_(value.value("decision", json::object()), "execution_mode"));
    if (executionMode == "camera_agent" ||
        executionMode == "single_step_job" ||
        executionMode == "multi_step_job") {
        normalized["decision"]["execution_mode"] = executionMode;
    }
    const std::string reason = text_(value.value("decision", json::object()), "reason");
    if (!reason.empty()) {
        normalized["decision"]["reason"] = reason;
    }
    if (value.value("decision", json::object()).contains("constraints") &&
        value["decision"]["constraints"].is_array()) {
        json constraints = json::array();
        for (const auto& item : value["decision"]["constraints"]) {
            if (!item.is_string()) {
                continue;
            }
            const std::string current = normalizeInlineWhitespace(item.get<std::string>());
            if (!current.empty()) {
                constraints.push_back(current);
            }
        }
        normalized["decision"]["constraints"] = constraints;
    }

    normalized["job"]["name"] = text_(value.value("job", json::object()), "name");
    normalized["job"]["description"] = text_(value.value("job", json::object()), "description");

    json schedule = json::object();
    const json scheduleInput = value.value("job", json::object()).value("schedule", json::object());
    const std::string mode = lowerAscii(text_(scheduleInput, "mode"));
    schedule["mode"] = isValidScheduleMode_(mode) ? mode : "none";
    schedule["timezone"] = text_(scheduleInput, "timezone");
    schedule["active_from"] = text_(scheduleInput, "active_from");
    schedule["active_until"] = text_(scheduleInput, "active_until");
    json scheduleDays = json::array();
    if (scheduleInput.contains("schedule_days") && scheduleInput["schedule_days"].is_array()) {
        for (const auto& day : scheduleInput["schedule_days"]) {
            const json current = normalizeScheduleDay_(day);
            if (!current.empty()) {
                scheduleDays.push_back(current);
            }
        }
    }
    schedule["schedule_days"] = scheduleDays;
    normalized["job"]["schedule"] = schedule;

    normalized["source_job_ref"] = normalizeSourceJobRef_(value.value("source_job_ref", json::object()));
    normalized["copy_from_source"] =
        normalizeCopyFromSource_(value.value("copy_from_source", json::object()));

    json steps = json::array();
    if (value.contains("steps") && value["steps"].is_array()) {
        int index = 0;
        for (const auto& step : value["steps"]) {
            const json current = normalizeStep_(step, index++);
            if (!current.empty()) {
                steps.push_back(current);
            }
        }
    }
    normalized["steps"] = steps;

    return normalized;
}

json mergeJobBlueprint(
    const json& existingDraft,
    const json& patchDraft)
{
    json merged = normalizeJobBlueprint(existingDraft);
    const json patch = normalizeJobBlueprint(patchDraft);
    const json rawPatch = patchDraft.is_object() ? patchDraft : json::object();
    const json rawDecision = rawPatch.value("decision", json::object());
    const json rawJob = rawPatch.value("job", json::object());
    const json rawSchedule = rawJob.value("schedule", json::object());
    const json rawSourceJobRef = rawPatch.value("source_job_ref", json::object());
    const json rawCopyFromSource = rawPatch.value("copy_from_source", json::object());

    if (rawDecision.contains("execution_mode") && !text_(patch["decision"], "execution_mode").empty()) {
        merged["decision"]["execution_mode"] = patch["decision"]["execution_mode"];
    }
    if (rawDecision.contains("reason") && !text_(patch["decision"], "reason").empty()) {
        merged["decision"]["reason"] = patch["decision"]["reason"];
    }
    if (rawDecision.contains("constraints") &&
        patch["decision"].contains("constraints") &&
        patch["decision"]["constraints"].is_array() &&
        !patch["decision"]["constraints"].empty()) {
        merged["decision"]["constraints"] = patch["decision"]["constraints"];
    }

    if (rawJob.contains("name") && !text_(patch["job"], "name").empty()) {
        merged["job"]["name"] = patch["job"]["name"];
    }
    if (rawJob.contains("description") && !text_(patch["job"], "description").empty()) {
        merged["job"]["description"] = patch["job"]["description"];
    }

    const json patchSchedule = patch.value("job", json::object()).value("schedule", json::object());
    if (rawSchedule.is_object() && !rawSchedule.empty()) {
        json mergedSchedule = merged.value("job", json::object()).value("schedule", json::object());
        if (rawSchedule.contains("mode")) {
            mergedSchedule["mode"] = patchSchedule.value("mode", std::string("none"));
        }
        if (rawSchedule.contains("timezone")) {
            mergedSchedule["timezone"] = patchSchedule.value("timezone", std::string());
        }
        if (rawSchedule.contains("active_from")) {
            mergedSchedule["active_from"] = patchSchedule.value("active_from", std::string());
        }
        if (rawSchedule.contains("active_until")) {
            mergedSchedule["active_until"] = patchSchedule.value("active_until", std::string());
        }
        if (rawSchedule.contains("schedule_days") && patchSchedule.contains("schedule_days")) {
            mergedSchedule["schedule_days"] = patchSchedule["schedule_days"];
        }
        merged["job"]["schedule"] = mergedSchedule;
    }

    if (rawSourceJobRef.is_object()) {
        if (rawSourceJobRef.empty()) {
            merged["source_job_ref"] = json::object();
        }
        else {
            merged["source_job_ref"] = mergeObjectShallow_(
                merged.value("source_job_ref", json::object()),
                patch.value("source_job_ref", json::object()));
        }
    }
    if (rawCopyFromSource.is_object() && !rawCopyFromSource.empty()) {
        json mergedCopy = normalizeCopyFromSource_(merged.value("copy_from_source", json::object()));
        const json patchCopy = patch.value("copy_from_source", json::object());
        for (const auto* field : { "camera_targets", "step_topology", "agent_templates" }) {
            if (rawCopyFromSource.contains(field) && patchCopy.contains(field)) {
                mergedCopy[field] = patchCopy[field];
            }
        }
        merged["copy_from_source"] = mergedCopy;
    }

    if (patch.contains("steps") && patch["steps"].is_array() && !patch["steps"].empty()) {
        json currentSteps = merged.value("steps", json::array());
        currentSteps = mergeArrayByIdentity_(currentSteps, patch["steps"], false);
        std::map<std::string, json> patchStepsByKey;
        for (const auto& patchStep : patch["steps"]) {
            const std::string key = stepIdentityKey_(patchStep);
            if (!key.empty()) {
                patchStepsByKey[key] = patchStep;
            }
        }
        for (std::size_t index = 0; index < currentSteps.size(); ++index) {
            json step = currentSteps[index];
            const auto patchIt = patchStepsByKey.find(stepIdentityKey_(step));
            if (patchIt != patchStepsByKey.end() &&
                step.contains("targets") &&
                patchIt->second.contains("targets")) {
                step["targets"] = mergeArrayByIdentity_(
                    step.value("targets", json::array()),
                    patchIt->second.value("targets", json::array()),
                    true);
            }
            currentSteps[index] = step;
        }
        merged["steps"] = currentSteps;
    }

    return normalizeJobBlueprint(merged);
}

json activeCreateJobDraft(const json& conversationContext)
{
    const json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return defaultJobBlueprint();
    }

    const auto& activeTask = taskState["active_task"];
    if (text_(activeTask, "type") != "create_job" ||
        !activeTask.contains("draft") ||
        !activeTask["draft"].is_object()) {
        return defaultJobBlueprint();
    }

    return normalizeJobBlueprint(activeTask["draft"]);
}

json normalizeRouterCreateJobDraft(const SkillSelection& selection)
{
    json normalized = defaultJobBlueprint();
    bool touched = false;

    const json args = selection.arguments.is_object() ? selection.arguments : json::object();
    if (args.contains("draft_patch") && args["draft_patch"].is_object()) {
        normalized = mergeJobBlueprint(normalized, args["draft_patch"]);
        touched = true;
    }
    if (selection.draftPatch.is_object() && !selection.draftPatch.empty()) {
        normalized = mergeJobBlueprint(normalized, selection.draftPatch);
        touched = true;
    }
    if (isExplicitCreateJobSelection_(selection)) {
        ensureDecisionConstraint_(normalized, "force_job_artifact");
        touched = true;
    }
    return touched ? normalized : defaultJobBlueprint();
}

json extractJobBlueprintDraft(
    const LocalLlmClient& llm,
    const json& payload,
    const json& conversationContext,
    const SkillSelection& selection,
    const json& authoringContextForPrompt)
{
    if (!llm.isConfigured()) {
        return defaultJobBlueprint();
    }

    const std::string userMessage =
        payload.is_object() ? payload.value("query", std::string()) : std::string();
    const std::string replyLanguage = effectiveReplyLanguage(selection, payload, conversationContext);

    const std::string systemPrompt =
        "/no_think\n"
        "You extract structured blueprints for creating operational CCTV jobs, steps, and camera-agent fallbacks.\n"
        "Use the latest user_message plus the active create_job task in conversation_task_state when present.\n"
        "This is a semantic extraction task, not a delimiter-only parser.\n"
        "Never invent camera names, schedules, days, times, steps, or watchlists that the user did not provide or clearly imply.\n"
        "Return JSON only.\n"
        "Choose execution_mode based on the user's operational need.\n"
        "Use execution_mode=camera_agent only when one camera is enough and no recurring schedule or multi-step orchestration is required.\n"
        "Use execution_mode=single_step_job when the user needs a scheduled task but the workflow fits in one step.\n"
        "Use execution_mode=multi_step_job when there are dependencies, start conditions, knowledge sharing, validation, or a final decision step.\n"
        "If the user explicitly asks to create a job, task, tarefa, or workflow, keep a real job artifact and do not collapse it into execution_mode=camera_agent, even when the workflow is simple.\n"
        "When the user does not explicitly ask for a job/task/workflow, camera_agent is allowed only for a direct unscheduled analysis without start/stop windows, active time ranges, or cross-camera sequencing.\n"
        "Mentions of schedule, start time, stop time, active window, elapsed time, or sequence across different cameras require a real job artifact.\n"
        "Do not use inference groups unless the shared targets can run with input_type=image.\n"
        "If the workflow needs video analysis, keep execution.mode=per_target_agents.\n"
        "Collector or analysis-only agents that only feed knowledge into another step should use alert_policy=never.\n"
        "The final alert should normally live in the decision step.\n"
        "Use knowledge_inputs to describe structured information flowing from one step into another.\n"
        "Use output_contract.schema when the downstream step needs a structured JSON contract.\n"
        "Use camera selectors when the user names cameras directly or by scene.\n"
        "authoring_context may list existing cameras, jobs, steps, and agents already available in the workspace. Use it only to disambiguate references the user already made.\n"
        "If the user asks to reuse cameras, steps, workflow topology, or agents from an existing job, fill source_job_ref and copy_from_source instead of asking for cameras again.\n"
        "Set copy_from_source.camera_targets=true when the user asks for the same cameras, same targets, same placeholders, or same camera setup as an existing job.\n"
        "Set copy_from_source.step_topology=true when the user asks for the same workflow, same steps, same etapas, or to clone the source workflow structure.\n"
        "Set copy_from_source.agent_templates=true when the user asks to copy the agents, prompts, logic, or analysis behavior from the source job.\n"
        "Use step.start_condition to describe positive, negative, sequential, time, elapsed, or custom starts.\n"
        "Preserve explicit technical execution settings from the user. When the user gives input_type, run_every, inference_model, model_fps, video_packaging_mode, running_resolution, only_capture_on_motion, or use_temporal_context, copy them into agent_patch or inference_group.shared_agent_patch instead of dropping them.\n"
        "job.schedule.mode must be weekly, monthly, yearly, or none.\n"
        "If the user did not give any schedule for a real job, keep schedule.mode=none and leave schedule_days empty.\n"
        "Return this shape:\n"
        "{"
        "\"blueprint_version\":1,"
        "\"decision\":{\"execution_mode\":\"multi_step_job\",\"reason\":\"\",\"constraints\":[]},"
        "\"job\":{\"name\":\"\",\"description\":\"\",\"schedule\":{\"mode\":\"none\",\"timezone\":\"\",\"active_from\":\"\",\"active_until\":null,\"schedule_days\":[]}},"
        "\"source_job_ref\":{\"id\":0,\"name\":\"\",\"description\":\"\"},"
        "\"copy_from_source\":{\"camera_targets\":false,\"step_topology\":false,\"agent_templates\":false},"
        "\"steps\":["
        "{"
        "\"step_key\":\"collector_varanda\","
        "\"name\":\"Coleta varanda\","
        "\"role\":\"collector\","
        "\"timeout_seconds\":120,"
        "\"execution\":{\"mode\":\"per_target_agents\",\"reason\":\"video analysis\"},"
        "\"start_condition\":{\"mode\":\"none\"},"
        "\"knowledge_inputs\":[],"
        "\"targets\":[{\"slot_key\":\"varanda_saida\",\"slot_label\":\"Varanda\",\"camera_selector\":{\"name\":\"varanda\"},\"input_type\":\"video\",\"analysis_scope\":{\"goal\":\"detectar saida em direcao ao estacionamento\",\"entity_role\":\"source\",\"must_observe\":[\"saida da pessoa\"],\"must_ignore\":[]}}],"
        "\"agents\":[{\"destination_type\":\"step_camera\",\"camera_slot_key\":\"varanda_saida\",\"goal_summary\":\"identificar a saida da entidade da varanda em direcao ao estacionamento\",\"alert_policy\":\"never\",\"output_contract\":{\"format\":\"json_object\",\"downstream_safe\":true,\"schema\":{\"result\":\"boolean\",\"entity_summary\":\"string\",\"direction\":\"string\",\"timestamp_ref\":\"string\"}},\"design_context\":{\"needs_visual_context\":false},\"agent_patch\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[]}],"
        "\"inference_group\":{\"enabled\":false}"
        "}"
        "]"
        "}\n"
        "Example for a scheduled single-step task with shared image analysis:\n"
        "{\"decision\":{\"execution_mode\":\"single_step_job\"},\"job\":{\"name\":\"Patio noturno\",\"schedule\":{\"mode\":\"weekly\",\"schedule_days\":[{\"day_name\":\"Monday\",\"day_of_week\":1,\"windows\":[{\"start_time\":\"22:00\",\"end_time\":\"23:59\"}]}]}},\"steps\":[{\"step_key\":\"patio_monitor\",\"name\":\"Monitor patio\",\"role\":\"decision\",\"timeout_seconds\":120,\"execution\":{\"mode\":\"inference_group_image\",\"reason\":\"shared image analysis\"},\"targets\":[{\"slot_key\":\"patio_norte\",\"camera_selector\":{\"name\":\"patio norte\"},\"input_type\":\"image\"},{\"slot_key\":\"patio_sul\",\"camera_selector\":{\"name\":\"patio sul\"},\"input_type\":\"image\"}],\"agents\":[{\"destination_type\":\"step_default\",\"goal_summary\":\"alertar se houver pessoa no patio fora do horario\",\"alert_policy\":\"local\",\"output_contract\":{\"format\":\"json_object\",\"downstream_safe\":true,\"schema\":{\"result\":\"boolean\",\"reason\":\"string\"}},\"agent_patch\":{\"input_type\":\"image\",\"run_every\":10}}],\"inference_group\":{\"enabled\":true,\"shared_agent_patch\":{\"input_type\":\"image\",\"run_every\":10}}}]}\n"
        "Example for direct camera-agent fallback:\n"
        "{\"decision\":{\"execution_mode\":\"camera_agent\",\"reason\":\"single unscheduled camera request\"},\"steps\":[{\"step_key\":\"camera_direct\",\"name\":\"Camera Direct\",\"role\":\"decision\",\"timeout_seconds\":120,\"targets\":[{\"slot_key\":\"portao\",\"camera_selector\":{\"name\":\"portao\"},\"input_type\":\"video\"}],\"agents\":[{\"destination_type\":\"camera\",\"camera_slot_key\":\"portao\",\"goal_summary\":\"alertar quando uma pessoa entrar pela garagem\",\"alert_policy\":\"local\",\"output_contract\":{\"format\":\"json_object\",\"downstream_safe\":true,\"schema\":{\"result\":\"boolean\",\"answer\":\"string\"}},\"agent_patch\":{},\"face_target_refs\":[],\"drakon_find_target_refs\":[]}]}]}\n"
        "Example for the varanda to estacionamento flow in 2 minutes:\n"
        "{\"decision\":{\"execution_mode\":\"multi_step_job\",\"reason\":\"depends on sequence, start condition, and shared knowledge\"},\"job\":{\"name\":\"Fluxo varanda para estacionamento\",\"schedule\":{\"mode\":\"none\",\"schedule_days\":[]}},\"steps\":[{\"step_key\":\"collector_varanda\",\"name\":\"Coleta varanda\",\"role\":\"collector\",\"timeout_seconds\":120,\"execution\":{\"mode\":\"per_target_agents\"},\"start_condition\":{\"mode\":\"none\"},\"targets\":[{\"slot_key\":\"varanda_saida\",\"slot_label\":\"Varanda\",\"camera_selector\":{\"scene_description\":\"varanda\"},\"input_type\":\"video\"}],\"agents\":[{\"destination_type\":\"step_camera\",\"camera_slot_key\":\"varanda_saida\",\"goal_summary\":\"identificar quando uma entidade sai da varanda em direcao ao estacionamento\",\"alert_policy\":\"never\",\"output_contract\":{\"format\":\"json_object\",\"downstream_safe\":true,\"schema\":{\"result\":\"boolean\",\"entity_summary\":\"string\",\"direction\":\"string\",\"timestamp_ref\":\"string\"}},\"agent_patch\":{}}]},{\"step_key\":\"collector_estacionamento\",\"name\":\"Coleta estacionamento\",\"role\":\"collector\",\"timeout_seconds\":120,\"execution\":{\"mode\":\"per_target_agents\"},\"start_condition\":{\"mode\":\"positive\",\"from_step_key\":\"collector_varanda\",\"answer_key\":\"result\",\"target_slot_key\":\"varanda_saida\"},\"knowledge_inputs\":[{\"from_step_key\":\"collector_varanda\",\"from_camera_slot_keys\":[\"varanda_saida\"],\"to_camera_slot_key\":\"estacionamento_entrada\",\"contract_key\":\"tracking_context\",\"required\":true,\"summary\":\"usar a entidade descrita pela varanda como referencia principal\"}],\"targets\":[{\"slot_key\":\"estacionamento_entrada\",\"slot_label\":\"Estacionamento\",\"camera_selector\":{\"scene_description\":\"estacionamento\"},\"input_type\":\"video\"}],\"agents\":[{\"destination_type\":\"step_camera\",\"camera_slot_key\":\"estacionamento_entrada\",\"goal_summary\":\"procurar a mesma entidade no estacionamento em ate 2 minutos\",\"alert_policy\":\"never\",\"output_contract\":{\"format\":\"json_object\",\"downstream_safe\":true,\"schema\":{\"result\":\"boolean\",\"entity_summary\":\"string\",\"timestamp_ref\":\"string\"}},\"agent_patch\":{}}]},{\"step_key\":\"decision_flow\",\"name\":\"Decisao final\",\"role\":\"decision\",\"timeout_seconds\":120,\"execution\":{\"mode\":\"per_target_agents\"},\"start_condition\":{\"mode\":\"elapsed\",\"time_offset_seconds\":120},\"knowledge_inputs\":[{\"from_step_key\":\"collector_varanda\",\"from_camera_slot_keys\":[\"varanda_saida\"],\"to_camera_slot_key\":\"decision_context\",\"contract_key\":\"tracking_context\",\"required\":true},{\"from_step_key\":\"collector_estacionamento\",\"from_camera_slot_keys\":[\"estacionamento_entrada\"],\"to_camera_slot_key\":\"decision_context\",\"contract_key\":\"arrival_context\",\"required\":true}],\"targets\":[{\"slot_key\":\"decision_context\",\"slot_label\":\"Decision\",\"camera_selector\":{},\"input_type\":\"image\"}],\"agents\":[{\"destination_type\":\"step_default\",\"goal_summary\":\"decidir se o fluxo varanda para estacionamento foi confirmado em ate 2 minutos\",\"alert_policy\":\"local\",\"output_contract\":{\"format\":\"json_object\",\"downstream_safe\":true,\"schema\":{\"result\":\"boolean\",\"answer\":\"string\",\"evidence\":\"array\"}},\"agent_patch\":{\"input_type\":\"image\"}}]}]}\n";

    json promptPayload = {
        { "reply_language", replyLanguage },
        { "app_language", payload.is_object() ? payload.value("app_language", std::string("en")) : std::string("en") },
        { "compact_context", conversationContext.value("compact_context", json::object()) },
        { "conversation_task_state", conversationContext.value("task_state", defaultOperationTaskState()) },
        { "recent_turns", conversationContext.value("recent_turns", json::array()) },
        { "authoring_context", authoringContextForPrompt.is_object() ? authoringContextForPrompt : json::object() },
        { "user_message", userMessage },
    };

    const auto outcome = llm.completeText(
        "extractCreateJobBlueprint",
        systemPrompt,
        promptPayload.dump(2),
        0.0,
        2200,
        22000,
        1,
        true);

    if (!outcome.ok || trimText(outcome.content).empty()) {
        return defaultJobBlueprint();
    }

    const json parsed = json::parse(outcome.content, nullptr, false);
    return normalizeJobBlueprint(parsed);
}

json chooseJobTopology(const json& value)
{
    json blueprint = normalizeJobBlueprint(value);
    json warnings = json::array();

    const json steps = blueprint.value("steps", json::array());
    const bool hasSchedule =
        isValidScheduleMode_(lowerAscii(text_(blueprint.value("job", json::object()).value("schedule", json::object()), "mode"))) &&
        blueprint.value("job", json::object()).value("schedule", json::object()).value("schedule_days", json::array()).is_array() &&
        !blueprint.value("job", json::object()).value("schedule", json::object()).value("schedule_days", json::array()).empty();

    bool hasDependencies = false;
    bool hasKnowledgeSharing = false;

    for (std::size_t index = 0; index < steps.size(); ++index) {
        json step = steps[index];
        bool stepAllTargetsImage = true;
        bool stepAllTargetsBackedByCamera = true;
        if (step.value("knowledge_inputs", json::array()).is_array() &&
            !step.value("knowledge_inputs", json::array()).empty()) {
            hasKnowledgeSharing = true;
            hasDependencies = true;
        }

        const json startCondition = step.value("start_condition", json::object());
        const std::string startMode = lowerAscii(text_(startCondition, "mode"));
        if (!startMode.empty() && startMode != "none") {
            hasDependencies = true;
        }

        const json targets = step.value("targets", json::array());
        for (const auto& target : targets) {
            if (lowerAscii(text_(target, "input_type")) != "image") {
                stepAllTargetsImage = false;
            }
            if (!targetRequiresPhysicalCamera_(step, target)) {
                stepAllTargetsBackedByCamera = false;
            }
        }

        if (index > 0 && (startMode.empty() || startMode == "none")) {
            const std::string previousStepKey = text_(steps[index - 1], "step_key");
            if (!previousStepKey.empty()) {
                step["start_condition"] = json::object({
                    { "mode", "sequential" },
                    { "from_step_key", previousStepKey },
                    { "answer_key", "result" },
                });
            }
        }

        json execution = step.value("execution", json::object());
        const json inferenceGroup = step.value("inference_group", json::object());
        const bool requestedGroup =
            execution.value("mode", std::string()) == "inference_group_image" ||
            boolField_(inferenceGroup, "enabled", false);
        if (requestedGroup) {
            if (!stepAllTargetsImage) {
                execution["mode"] = "per_target_agents";
                execution["reason"] = "inference_group_requires_image_input";
                warnings.push_back("inference_group_requires_image_input");
                step["inference_group"]["allowed"] = false;
                step["inference_group"]["reason"] = "inference_group_requires_image_input";
            }
            else if (!stepAllTargetsBackedByCamera) {
                execution["mode"] = "per_target_agents";
                execution["reason"] = "inference_group_requires_camera_targets";
                warnings.push_back("inference_group_requires_camera_targets");
                step["inference_group"]["allowed"] = false;
                step["inference_group"]["reason"] = "inference_group_requires_camera_targets";
            }
            else {
                execution["mode"] = "inference_group_image";
                step["inference_group"]["allowed"] = true;
            }
        }
        else if (!execution.contains("mode")) {
            execution["mode"] = "per_target_agents";
        }
        step["execution"] = execution;
        blueprint["steps"][index] = step;
    }

    std::string executionMode = lowerAscii(text_(blueprint.value("decision", json::object()), "execution_mode"));
    const bool forceJobArtifact = hasDecisionConstraint_(blueprint, "force_job_artifact");
    bool upgradedFromCameraAgent = false;
    if (executionMode.empty()) {
        if (!hasSchedule && steps.size() == 1 && steps[0].value("targets", json::array()).size() == 1 && !hasDependencies && !hasKnowledgeSharing) {
            executionMode = forceJobArtifact ? "single_step_job" : "camera_agent";
            upgradedFromCameraAgent = forceJobArtifact;
        }
        else if (steps.size() <= 1) {
            executionMode = "single_step_job";
        }
        else {
            executionMode = "multi_step_job";
        }
    }
    else if (forceJobArtifact && executionMode == "camera_agent") {
        executionMode = steps.size() <= 1 ? "single_step_job" : "multi_step_job";
        upgradedFromCameraAgent = true;
    }

    blueprint["decision"]["execution_mode"] = executionMode;
    if (upgradedFromCameraAgent) {
        blueprint["decision"]["reason"] = "explicit job request preserved as job artifact";
    }
    else if (text_(blueprint.value("decision", json::object()), "reason").empty()) {
        if (executionMode == "camera_agent") {
            blueprint["decision"]["reason"] = "single unscheduled camera request";
        }
        else if (executionMode == "single_step_job") {
            blueprint["decision"]["reason"] = hasSchedule
                ? "scheduled workflow fits in one step"
                : "single-step orchestration requested";
        }
        else {
            blueprint["decision"]["reason"] = "workflow depends on multiple steps, dependencies, or shared knowledge";
        }
    }
    if (!warnings.empty()) {
        blueprint["validation"]["warnings"] = warnings;
    }
    return blueprint;
}

json resolveJobBlueprintSelectors(
    const json& value,
    const json& cameraInventory)
{
    json blueprint = normalizeJobBlueprint(value);
    json warnings = blueprint.value("validation", json::object()).value("warnings", json::array());

    for (auto& step : blueprint["steps"]) {
        if (!step.is_object() || !step.contains("targets") || !step["targets"].is_array()) {
            continue;
        }
        for (auto& target : step["targets"]) {
            const json selector = target.value("camera_selector", json::object());
            if (!targetRequiresPhysicalCamera_(step, target) &&
                selector.empty() &&
                target.value("resolved_camera", json::object()).empty()) {
                target["resolution"] = json::object({
                    { "status", "virtual" },
                    { "item", json::object() },
                    { "candidates", json::array() },
                });
                continue;
            }
            const json resolvedCamera = target.value("resolved_camera", json::object());
            const json resolution = resolveCamera(cameraInventory, selector, resolvedCamera);
            target["resolution"] = resolution;
            if (text_(resolution, "status") == "resolved" &&
                resolution.contains("item") &&
                resolution["item"].is_object()) {
                target["resolved_camera"] = resolution["item"];
            }
            else if (text_(resolution, "status") == "ambiguous") {
                warnings.push_back("ambiguous_camera:" + text_(target, "slot_key"));
            }
            else if (text_(resolution, "status") == "not_found") {
                warnings.push_back("missing_camera:" + text_(target, "slot_key"));
            }
        }
    }

    blueprint["validation"]["warnings"] = warnings;
    return blueprint;
}

std::vector<std::string> collectMissingJobFields(const json& blueprint)
{
    std::vector<std::string> missing;
    const std::string executionMode = lowerAscii(text_(blueprint.value("decision", json::object()), "execution_mode"));
    const json steps = blueprint.value("steps", json::array());

    if (steps.empty()) {
        missing.push_back("workflow");
    }
    if (executionMode != "camera_agent") {
        const json schedule = blueprint.value("job", json::object()).value("schedule", json::object());
        const std::string scheduleMode = lowerAscii(text_(schedule, "mode"));
        if (!scheduleMode.empty() &&
            scheduleMode != "none" &&
            (!isValidScheduleMode_(scheduleMode) ||
             !schedule.contains("schedule_days") ||
             !schedule["schedule_days"].is_array() ||
             schedule["schedule_days"].empty())) {
            missing.push_back("schedule");
        }
    }

    for (const auto& step : steps) {
        const json targets = step.value("targets", json::array());
        if (targets.empty()) {
            missing.push_back("cameras");
            continue;
        }
        for (const auto& target : targets) {
            const json selector = target.value("camera_selector", json::object());
            const json resolution = target.value("resolution", json::object());
            if (targetRequiresPhysicalCamera_(step, target) &&
                selector.empty() &&
                target.value("resolved_camera", json::object()).empty()) {
                missing.push_back("cameras");
            }
            const std::string resolutionStatus = text_(resolution, "status");
            if (resolutionStatus == "missing_target" || resolutionStatus == "not_found") {
                missing.push_back("cameras");
            }
        }

        const json agents = step.value("agents", json::array());
        const bool isGroupStep =
            step.value("execution", json::object()).value("mode", std::string()) == "inference_group_image";
        if (isGroupStep) {
            if (!inferenceGroupHasAnalysis_(step)) {
                bool sawUsableAgent = false;
                for (const auto& agent : agents) {
                    if (agentSpecHasAnalysis_(agent)) {
                        sawUsableAgent = true;
                        break;
                    }
                }
                if (!sawUsableAgent) {
                    missing.push_back("analysis");
                }
            }
            continue;
        }

        if (agents.empty()) {
            missing.push_back("analysis");
        }
        for (const auto& agent : agents) {
            if (!agentSpecHasAnalysis_(agent)) {
                missing.push_back("analysis");
            }
        }
    }

    std::sort(missing.begin(), missing.end());
    missing.erase(std::unique(missing.begin(), missing.end()), missing.end());
    return missing;
}

json finalizeJobBlueprintValidation(const json& value)
{
    json blueprint = chooseJobTopology(value);
    json missing = json::array();
    for (const auto& item : collectMissingJobFields(blueprint)) {
        missing.push_back(item);
    }
    blueprint["validation"]["missing_fields"] = missing;
    blueprint["validation"]["ready_to_apply"] = missing.empty();
    if (!blueprint["validation"].contains("warnings")) {
        blueprint["validation"]["warnings"] = json::array();
    }
    return blueprint;
}

json compileBlueprintToInstallRequest(const json& value)
{
    const json blueprint = finalizeJobBlueprintValidation(value);
    const json steps = blueprint.value("steps", json::array());

    std::map<std::string, std::string> globalSlotByLocalKey;
    std::map<std::string, std::string> labelByGlobalSlotKey;
    std::map<std::string, std::string> runtimeCameraNameByGlobalSlotKey;
    std::map<std::string, int> cameraIdByGlobalSlotKey;

    json cameraSlots = json::array();
    json cameraSlotMapping = json::array();

    for (const auto& step : steps) {
        const std::string stepKey = text_(step, "step_key");
        for (const auto& target : step.value("targets", json::array())) {
            const std::string localSlotKey = text_(target, "slot_key");
            if (localSlotKey.empty()) {
                continue;
            }
            const std::string globalSlotKey = stepKey.empty()
                ? localSlotKey
                : stepKey + "__" + localSlotKey;
            globalSlotByLocalKey[stepKey + ":" + localSlotKey] = globalSlotKey;

            const json resolvedCamera = target.value("resolved_camera", json::object());
            const int cameraId = intField_(resolvedCamera, "id", 0);
            const std::string label = !text_(target, "slot_label").empty()
                ? text_(target, "slot_label")
                : (!text_(resolvedCamera, "name").empty() ? text_(resolvedCamera, "name") : localSlotKey);
            const std::string runtimeCameraName = !text_(resolvedCamera, "name").empty()
                ? text_(resolvedCamera, "name")
                : label;
            const std::string acceptedInputType =
                lowerAscii(text_(target, "input_type")) == "image" ? "image" : "video";

            labelByGlobalSlotKey[globalSlotKey] = label;
            runtimeCameraNameByGlobalSlotKey[globalSlotKey] = runtimeCameraName;
            cameraIdByGlobalSlotKey[globalSlotKey] = cameraId;

            cameraSlots.push_back(json::object({
                { "slot_key", globalSlotKey },
                { "label", label },
                { "required", true },
                { "accepted_input_types", json::array({ acceptedInputType }) },
            }));
            if (cameraId > 0) {
                cameraSlotMapping.push_back(json::object({
                    { "slot_key", globalSlotKey },
                    { "camera_id", cameraId },
                }));
            }
        }
    }

    json snapshotSteps = json::array();
    for (const auto& step : steps) {
        const std::string stepKey = text_(step, "step_key");
        const std::string role = lowerAscii(text_(step, "role"));
        json snapshotStep = json::object({
            { "step_key", stepKey },
            { "step_order", static_cast<int>(snapshotSteps.size()) + 1 },
            { "name", text_(step, "name").empty() ? stepKey : text_(step, "name") },
            { "timeout_seconds", (std::max)(120, intField_(step, "timeout_seconds", 120)) },
            { "status", "draft" },
        });

        const json startCondition = step.value("start_condition", json::object());
        const std::string startMode = lowerAscii(text_(startCondition, "mode"));
        if (!startMode.empty() && startMode != "none") {
            const std::string fromStepKey = text_(startCondition, "from_step_key");
            if (!fromStepKey.empty()) {
                snapshotStep["start_condition_from_step_key"] = fromStepKey;
            }
            if (startMode == "positive" || startMode == "negative") {
                std::string pattern;
                const std::string targetSlotKey = text_(startCondition, "target_slot_key");
                const std::string upstreamGlobalSlot = globalSlotByLocalKey[fromStepKey + ":" + targetSlotKey];
                if (!upstreamGlobalSlot.empty() && runtimeCameraNameByGlobalSlotKey.count(upstreamGlobalSlot)) {
                    pattern = runtimeCameraNameByGlobalSlotKey[upstreamGlobalSlot];
                }
                std::string condition = "start:" + startMode + ":" + (text_(startCondition, "answer_key").empty() ? "result" : text_(startCondition, "answer_key"));
                if (!pattern.empty()) {
                    condition += ":" + pattern;
                }
                snapshotStep["start_condition"] = condition;
            }
            else if (startMode == "sequential") {
                snapshotStep["start_condition"] = "start:sequential:result";
            }
            else if (startMode == "custom") {
                std::string condition = "start:custom:" + (text_(startCondition, "extract_text").empty() ? "result" : text_(startCondition, "extract_text"));
                const std::string targetSlotKey = text_(startCondition, "target_slot_key");
                const std::string upstreamGlobalSlot = globalSlotByLocalKey[fromStepKey + ":" + targetSlotKey];
                if (!upstreamGlobalSlot.empty() && runtimeCameraNameByGlobalSlotKey.count(upstreamGlobalSlot)) {
                    condition += ":" + runtimeCameraNameByGlobalSlotKey[upstreamGlobalSlot];
                }
                snapshotStep["start_condition"] = condition;
            }
            else if (startMode == "time") {
                const std::string timeHhmm = text_(startCondition, "time_hhmm");
                if (!timeHhmm.empty()) {
                    snapshotStep["start_condition"] = "start:time:" + timeHhmm;
                }
                else {
                    snapshotStep["start_condition"] = "start:elapsed:" + std::to_string((std::max)(0, intField_(startCondition, "time_offset_seconds", 0)));
                }
            }
            else if (startMode == "elapsed") {
                snapshotStep["start_condition"] = "start:elapsed:" + std::to_string((std::max)(0, intField_(startCondition, "time_offset_seconds", 0)));
            }
        }

        json targets = json::array();
        for (const auto& target : step.value("targets", json::array())) {
            const std::string localSlotKey = text_(target, "slot_key");
            const std::string globalSlotKey = globalSlotByLocalKey[stepKey + ":" + localSlotKey];
            if (globalSlotKey.empty()) {
                continue;
            }
            targets.push_back(json::object({
                { "target_slot_key", globalSlotKey },
                { "input_type", lowerAscii(text_(target, "input_type")) == "image" ? "image" : "video" },
            }));
        }
        snapshotStep["targets"] = targets;

        json pipelines = json::array();
        for (const auto& input : step.value("knowledge_inputs", json::array())) {
            const std::string fromStepKey = text_(input, "from_step_key");
            const std::string toLocalSlotKey = text_(input, "to_camera_slot_key");
            const std::string toGlobalSlotKey = globalSlotByLocalKey[stepKey + ":" + toLocalSlotKey];
            json inputTargetSlots = json::array();
            json inputInjectKeys = json::array();
            for (const auto& row : input.value("from_camera_slot_keys", json::array())) {
                if (!row.is_string()) {
                    continue;
                }
                const std::string fromLocalSlotKey = slugifyKey(row.get<std::string>(), "");
                const std::string fromGlobalSlotKey = globalSlotByLocalKey[fromStepKey + ":" + fromLocalSlotKey];
                if (fromGlobalSlotKey.empty()) {
                    continue;
                }
                inputTargetSlots.push_back(fromGlobalSlotKey);
                inputInjectKeys.push_back(runtimeCameraNameByGlobalSlotKey[fromGlobalSlotKey]);
            }
            if (!fromStepKey.empty() && !toGlobalSlotKey.empty() && !inputInjectKeys.empty()) {
                pipelines.push_back(json::object({
                    { "input_from_step_key", fromStepKey },
                    { "input_inject_keys", inputInjectKeys },
                    { "input_target_slot_keys", inputTargetSlots },
                    { "target_camera_slot_key", toGlobalSlotKey },
                    { "target_camera_name", runtimeCameraNameByGlobalSlotKey[toGlobalSlotKey] },
                }));
            }
        }
        if (!pipelines.empty()) {
            snapshotStep["pipelines"] = pipelines;
        }

        const std::string executionMode = lowerAscii(text_(step.value("execution", json::object()), "mode"));
        if (executionMode == "inference_group_image") {
            const json inferenceGroup = step.value("inference_group", json::object());
            const json compiledGroupSnapshot = inferenceGroup.value("compiled_snapshot", json::object());
            if (compiledGroupSnapshot.is_object() && !compiledGroupSnapshot.empty()) {
                json targetSlotKeys = json::array();
                const json explicitTargets = inferenceGroup.value("target_slot_keys", json::array());
                if (explicitTargets.is_array() && !explicitTargets.empty()) {
                    for (const auto& slotValue : explicitTargets) {
                        if (!slotValue.is_string()) {
                            continue;
                        }
                        const std::string localSlotKey = slugifyKey(slotValue.get<std::string>(), "");
                        const std::string globalSlotKey = globalSlotByLocalKey[stepKey + ":" + localSlotKey];
                        if (!globalSlotKey.empty()) {
                            targetSlotKeys.push_back(globalSlotKey);
                        }
                    }
                }
                else {
                    for (const auto& target : step.value("targets", json::array())) {
                        const std::string localSlotKey = text_(target, "slot_key");
                        const std::string globalSlotKey = globalSlotByLocalKey[stepKey + ":" + localSlotKey];
                        if (!globalSlotKey.empty()) {
                            targetSlotKeys.push_back(globalSlotKey);
                        }
                    }
                }

                const std::string sourceLocalSlotKey = resolveInferenceGroupSourceLocalSlotKey_(step);
                std::string sourceGlobalSlotKey = sourceLocalSlotKey.empty()
                    ? std::string()
                    : globalSlotByLocalKey[stepKey + ":" + sourceLocalSlotKey];
                if (sourceGlobalSlotKey.empty() && !targetSlotKeys.empty() && targetSlotKeys[0].is_string()) {
                    sourceGlobalSlotKey = targetSlotKeys[0].get<std::string>();
                }

                const std::string groupAgentKey = stepKey.empty()
                    ? "shared_group_agent"
                    : stepKey + "_shared_agent";

                json sourceAgentSnapshot = json::object();
                for (const auto& agent : step.value("agents", json::array())) {
                    const json compiledSnapshot = agent.value("compiled_snapshot", json::object());
                    if (!compiledSnapshot.is_object() || compiledSnapshot.empty()) {
                        continue;
                    }
                    const std::string candidateLocalSlotKey = slugifyKey(text_(agent, "camera_slot_key"), "");
                    if (!sourceLocalSlotKey.empty() && candidateLocalSlotKey == sourceLocalSlotKey) {
                        sourceAgentSnapshot = compiledSnapshot;
                        break;
                    }
                    if (sourceAgentSnapshot.empty()) {
                        sourceAgentSnapshot = compiledSnapshot;
                    }
                }
                if (sourceAgentSnapshot.empty()) {
                    sourceAgentSnapshot = compiledGroupSnapshot;
                }
                if (sourceAgentSnapshot.is_object() && !sourceAgentSnapshot.empty()) {
                    sourceAgentSnapshot["agent_key"] = groupAgentKey;
                    if (text_(sourceAgentSnapshot, "display_name").empty()) {
                        sourceAgentSnapshot["display_name"] =
                            text_(step, "name").empty() ? stepKey : text_(step, "name");
                    }
                    if (text_(sourceAgentSnapshot, "summary").empty()) {
                        std::string summary;
                        for (const auto& agent : step.value("agents", json::array())) {
                            summary = text_(agent, "goal_summary");
                            if (!summary.empty()) {
                                break;
                            }
                        }
                        if (summary.empty()) {
                            summary = text_(step, "name");
                        }
                        if (!summary.empty()) {
                            sourceAgentSnapshot["summary"] = summary;
                        }
                    }

                    json groupSourceAgent = json::object({
                        { "agent_snapshot", sourceAgentSnapshot },
                    });
                    if (!sourceGlobalSlotKey.empty()) {
                        groupSourceAgent["camera_slot_key"] = sourceGlobalSlotKey;
                    }
                    snapshotStep["agents"] = json::array({ groupSourceAgent });
                }

                json groupSnapshot = json::object({
                    { "id", stepKey + "_group" },
                    { "name", text_(step, "name").empty() ? stepKey : text_(step, "name") },
                    { "target_slot_keys", targetSlotKeys },
                    { "agent_key", groupAgentKey },
                    { "input_type", lowerAscii(text_(compiledGroupSnapshot, "input_type")) == "image" ? "image" : "video" },
                    { "video_packaging_mode", text_(compiledGroupSnapshot, "video_packaging_mode") },
                    { "prompt_template", text_(compiledGroupSnapshot, "prompt_template") },
                    { "alert_condition", text_(compiledGroupSnapshot, "alert_condition") },
                    { "negative_condition", text_(compiledGroupSnapshot, "negative_condition") },
                    { "priority_level", role == "decision" ? "HIGH" : "MEDIUM" },
                    { "inference_model", text_(compiledGroupSnapshot, "inference_model") },
                    { "model_fps", intField_(compiledGroupSnapshot, "model_fps", 1) },
                    { "run_every", intField_(compiledGroupSnapshot, "run_every", 60) },
                    { "running_resolution", intField_(compiledGroupSnapshot, "running_resolution", 640) },
                    { "only_capture_on_motion", boolField_(compiledGroupSnapshot, "only_capture_on_motion", true) },
                });
                if (!sourceGlobalSlotKey.empty()) {
                    groupSnapshot["source_target_slot_key"] = sourceGlobalSlotKey;
                }

                snapshotStep["inference_groups"] = json::array({ groupSnapshot });
            }
        }
        else {
            json agents = json::array();
            for (const auto& agent : step.value("agents", json::array())) {
                const json compiledSnapshot = agent.value("compiled_snapshot", json::object());
                if (!compiledSnapshot.is_object() || compiledSnapshot.empty()) {
                    continue;
                }
                json snapshotAgent = json::object({
                    { "agent_snapshot", compiledSnapshot },
                });
                const std::string destinationType = lowerAscii(text_(agent, "destination_type"));
                if (destinationType == "step_camera" || destinationType == "camera") {
                    const std::string localSlotKey = text_(agent, "camera_slot_key");
                    const std::string globalSlotKey = globalSlotByLocalKey[stepKey + ":" + localSlotKey];
                    if (!globalSlotKey.empty()) {
                        snapshotAgent["camera_slot_key"] = globalSlotKey;
                    }
                }
                agents.push_back(snapshotAgent);
            }
            if (!agents.empty()) {
                snapshotStep["agents"] = agents;
            }
        }

        snapshotSteps.push_back(snapshotStep);
    }

    const json schedule = blueprint.value("job", json::object()).value("schedule", json::object());
    const std::string jobName = text_(blueprint.value("job", json::object()), "name");
    const std::string jobDescription = text_(blueprint.value("job", json::object()), "description");
    json snapshot = json::object({
        { "type", "task" },
        { "title", jobName },
        { "summary", jobDescription },
        { "description", jobDescription },
        { "job", json::object({
            { "name", jobName },
            { "description", jobDescription },
            { "schedule_mode", text_(schedule, "mode") == "none" ? "" : text_(schedule, "mode") },
            { "timezone", text_(schedule, "timezone") },
            { "active_from", text_(schedule, "active_from") },
            { "active_until", text_(schedule, "active_until") },
            { "schedule_days", schedule.value("schedule_days", json::array()) },
            { "status", "draft" },
        }) },
        { "camera_slots", cameraSlots },
        { "steps", snapshotSteps },
        { "tags", json::array() },
    });

    return json::object({
        { "snapshot", snapshot },
        { "camera_slot_mapping", cameraSlotMapping },
    });
}

} // namespace shared
} // namespace chatv2

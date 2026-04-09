#include "CreateJobSkill.h"

#include <algorithm>
#include <cctype>
#include <initializer_list>
#include <limits>
#include <regex>
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

std::string lowerAsciiCopy_(std::string value)
{
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return value;
}

std::string firstNonEmptyText_(std::initializer_list<std::string> values)
{
    for (const auto& value : values) {
        if (!value.empty()) {
            return value;
        }
    }
    return "";
}

bool containsAny_(const std::string& value, const std::vector<std::string>& needles)
{
    return std::any_of(needles.begin(), needles.end(), [&](const std::string& needle) {
        return !needle.empty() && value.find(needle) != std::string::npos;
    });
}

bool hasDecisionConstraint_(const json& blueprint, const std::string& expected)
{
    const json decision = blueprint.value("decision", json::object());
    const json constraints = decision.value("constraints", json::array());
    if (!constraints.is_array()) {
        return false;
    }

    const std::string normalizedExpected = lowerAsciiCopy_(shared::normalizeInlineWhitespace(expected));
    for (const auto& item : constraints) {
        if (!item.is_string()) {
            continue;
        }
        if (lowerAsciiCopy_(shared::normalizeInlineWhitespace(item.get<std::string>())) == normalizedExpected) {
            return true;
        }
    }
    return false;
}

void ensureDecisionConstraint_(json& blueprint, const std::string& constraint)
{
    if (hasDecisionConstraint_(blueprint, constraint)) {
        return;
    }

    if (!blueprint.contains("decision") || !blueprint["decision"].is_object()) {
        blueprint["decision"] = json::object();
    }
    if (!blueprint["decision"].contains("constraints") || !blueprint["decision"]["constraints"].is_array()) {
        blueprint["decision"]["constraints"] = json::array();
    }
    blueprint["decision"]["constraints"].push_back(shared::normalizeInlineWhitespace(constraint));
}

bool isExplicitJobArtifactRequest_(
    const json& payload,
    const SkillSelection& selection,
    const json& blueprint)
{
    if (hasDecisionConstraint_(blueprint, "force_job_artifact")) {
        return true;
    }

    const std::string reason = lowerAsciiCopy_(shared::normalizeInlineWhitespace(selection.reason));
    if (reason == "explicit_job_creation_action_request") {
        return true;
    }

    const std::string entity = lowerAsciiCopy_(shared::normalizeInlineWhitespace(selection.entity));
    const std::string intent = lowerAsciiCopy_(shared::normalizeInlineWhitespace(selection.intent));
    if (entity == "job" &&
        intent == "create" &&
        reason == "routing_lexicon_override") {
        return true;
    }

    const std::string message = lowerAsciiCopy_(shared::normalizeInlineWhitespace(shared::jsonStringField(payload, "query")));
    const bool mentionsJobArtifact = containsAny_(message, {
        "job",
        "jobs",
        "workflow",
        "workflows",
        "tarefa",
        "tarefas",
        "task",
        "tasks",
    });
    const bool wantsCreation = containsAny_(message, {
        "create",
        "criar",
        "novo",
        "nova",
        "montar",
        "setup",
        "set up",
        "agendar",
        "schedule",
        "inicie",
        "iniciar",
        "comece",
        "quero",
        "preciso",
    });
    return mentionsJobArtifact && wantsCreation;
}

bool isTrimSeparator_(char ch)
{
    return std::isspace(static_cast<unsigned char>(ch)) != 0 ||
        ch == '-' ||
        ch == '|' ||
        ch == ',' ||
        ch == ';' ||
        ch == ':';
}

std::string trimCameraLabelEdges_(std::string value)
{
    while (!value.empty() && isTrimSeparator_(value.front())) {
        value.erase(value.begin());
    }
    while (!value.empty() && isTrimSeparator_(value.back())) {
        value.pop_back();
    }
    return shared::normalizeInlineWhitespace(std::move(value));
}

std::string stripListPrefix_(std::string value)
{
    value = shared::trimText(std::move(value));
    while (!value.empty() &&
        (value.front() == '-' || value.front() == '*' || value.front() == '+')) {
        value.erase(value.begin());
        value = shared::trimText(std::move(value));
    }

    static const std::regex orderedPrefix(R"(^\(?\d+\)?\s*[\.\-:]\s*)", std::regex::icase);
    return shared::trimText(std::regex_replace(value, orderedPrefix, ""));
}

std::string extractIpv4_(const std::string& value)
{
    static const std::regex ipv4Pattern(R"(\b(?:\d{1,3}\.){3}\d{1,3}\b)");
    std::smatch match;
    if (std::regex_search(value, match, ipv4Pattern)) {
        return match.str(0);
    }
    return "";
}

std::string uniqueSlotKeyForTarget_(
    const std::string& preferredLabel,
    const std::string& fallbackBase,
    std::vector<std::string>& usedSlotKeys)
{
    std::string base = shared::slugifyKey(preferredLabel, fallbackBase);
    if (base.empty()) {
        base = fallbackBase;
    }

    std::string candidate = base;
    int suffix = 2;
    while (std::find(usedSlotKeys.begin(), usedSlotKeys.end(), candidate) != usedSlotKeys.end()) {
        candidate = base + "_" + std::to_string(suffix++);
    }
    usedSlotKeys.push_back(candidate);
    return candidate;
}

bool looksLikeCameraSectionHeader_(const std::string& line)
{
    const std::string normalized = lowerAsciiCopy_(shared::normalizeInlineWhitespace(line));
    if (normalized.find(':') == std::string::npos) {
        return false;
    }
    return containsAny_(normalized, {
        "camera",
        "cameras",
        "camara",
        "camaras",
    });
}

bool looksLikeCameraSectionTerminator_(const std::string& line)
{
    const std::string normalized = lowerAsciiCopy_(shared::normalizeInlineWhitespace(line));
    if (normalized.empty()) {
        return true;
    }
    return containsAny_(normalized, {
        "identific",
        "detectar",
        "detec",
        "essa tarefa",
        "esse job",
        "este job",
        "workflow",
        "single step",
        "unico step",
        "run every",
        "input type",
        "deve ser executada",
        "must run",
    });
}

bool messageRequestsSingleStep_(const json& payload)
{
    const std::string message = lowerAsciiCopy_(shared::normalizeInlineWhitespace(shared::jsonStringField(payload, "query")));
    if (message.empty()) {
        return false;
    }

    return containsAny_(message, {
        "single step",
        "one step",
        "1 step",
        "um step",
        "apenas um step",
        "unico step",
        "único step",
        "um unico step",
        "um único step",
        "dentro de um unico step",
        "dentro de um único step",
        "em um unico step",
        "em um único step",
        "um so step",
        "um só step",
    });
}

std::string explicitInputTypeFromPayload_(const json& payload)
{
    const std::string message = shared::normalizeInlineWhitespace(shared::jsonStringField(payload, "query"));
    if (message.empty()) {
        return "";
    }

    std::smatch match;
    static const std::regex inputTypePattern(
        R"((?:input[_\s-]*type|tipo\s+de\s+entrada)\s*(?:pode\s+ser|can\s+be|deve\s+ser|is|=|:)?\s*(image|imagem|video))",
        std::regex::icase);
    if (std::regex_search(message, match, inputTypePattern)) {
        const std::string rawValue = lowerAsciiCopy_(match.str(1));
        return rawValue == "imagem" ? "image" : rawValue;
    }

    return "";
}

int explicitRunEverySecondsFromPayload_(const json& payload)
{
    const std::string message = shared::normalizeInlineWhitespace(shared::jsonStringField(payload, "query"));
    if (message.empty()) {
        return 0;
    }

    std::smatch match;
    static const std::regex cadencePattern(
        R"((?:\ba\s*cada\b|\bevery\b)\s*(\d{1,4})\s*(s|sec|secs|seg|segs|segundo|segundos|second|seconds|min|mins|minute|minutes|minuto|minutos)?)",
        std::regex::icase);
    if (!std::regex_search(message, match, cadencePattern)) {
        return 0;
    }

    const int amount = std::stoi(match.str(1));
    if (amount <= 0) {
        return 0;
    }

    const std::string unit = lowerAsciiCopy_(match.str(2));
    const bool isMinuteUnit =
        unit == "min" ||
        unit == "mins" ||
        unit == "minute" ||
        unit == "minutes" ||
        unit == "minuto" ||
        unit == "minutos";
    return isMinuteUnit ? amount * 60 : amount;
}

void applyExplicitExecutionPreferencesToBlueprint_(json& blueprint, const json& payload)
{
    if (!blueprint.contains("steps") || !blueprint["steps"].is_array()) {
        return;
    }

    const std::string inputType = explicitInputTypeFromPayload_(payload);
    const int runEverySeconds = explicitRunEverySecondsFromPayload_(payload);
    if (inputType.empty() && runEverySeconds <= 0) {
        return;
    }

    const bool wantsSingleStep = messageRequestsSingleStep_(payload) ||
        lowerAsciiCopy_(safeText_(blueprint.value("decision", json::object()), "execution_mode")) == "single_step_job";

    for (auto& step : blueprint["steps"]) {
        if (!step.is_object()) {
            continue;
        }

        if (!inputType.empty()) {
            if (!step.contains("targets") || !step["targets"].is_array()) {
                step["targets"] = json::array();
            }
            for (auto& target : step["targets"]) {
                if (target.is_object()) {
                    target["input_type"] = inputType;
                }
            }
        }

        if (!step.contains("agents") || !step["agents"].is_array()) {
            step["agents"] = json::array();
        }
        for (auto& agentSpec : step["agents"]) {
            if (!agentSpec.is_object()) {
                continue;
            }
            if (!agentSpec.contains("agent_patch") || !agentSpec["agent_patch"].is_object()) {
                agentSpec["agent_patch"] = json::object();
            }
            if (!inputType.empty()) {
                agentSpec["agent_patch"]["input_type"] = inputType;
            }
            if (runEverySeconds > 0) {
                agentSpec["agent_patch"]["run_every"] = runEverySeconds;
            }
        }

        if ((!inputType.empty() || runEverySeconds > 0) &&
            (!step.contains("inference_group") || !step["inference_group"].is_object())) {
            step["inference_group"] = json::object();
        }
        if (step["inference_group"].is_object()) {
            if (inputType == "image") {
                step["inference_group"]["input_type"] = "image";
            }
            if (!step["inference_group"].contains("shared_agent_patch") ||
                !step["inference_group"]["shared_agent_patch"].is_object()) {
                step["inference_group"]["shared_agent_patch"] = json::object();
            }
            if (step["inference_group"]["shared_agent_patch"].is_object()) {
                if (!inputType.empty()) {
                    step["inference_group"]["shared_agent_patch"]["input_type"] = inputType;
                }
                if (runEverySeconds > 0) {
                    step["inference_group"]["shared_agent_patch"]["run_every"] = runEverySeconds;
                }
            }
        }

        const std::size_t targetCount = step.value("targets", json::array()).size();
        if (inputType == "image" && wantsSingleStep && targetCount > 1) {
            if (!step.contains("execution") || !step["execution"].is_object()) {
                step["execution"] = json::object();
            }
            step["execution"]["mode"] = "inference_group_image";
            if (safeText_(step["execution"], "reason").empty()) {
                step["execution"]["reason"] = "explicit_image_input_request";
            }
            step["inference_group"]["enabled"] = true;
        }
    }
}

bool looksLikeExecutionPreferenceLine_(const std::string& line)
{
    const std::string normalized = lowerAsciiCopy_(shared::normalizeInlineWhitespace(line));
    if (normalized.empty()) {
        return false;
    }

    return containsAny_(normalized, {
        "run every",
        "a cada",
        "input type",
        "tipo de entrada",
        "single step",
        "one step",
        "um step",
        "unico step",
        "mesmo agente",
        "same agent",
        "grupo unico",
        "deve ser executada",
        "must run",
        "workflow",
    });
}

bool looksLikeCreationInstructionLine_(const std::string& line)
{
    const std::string normalized = lowerAsciiCopy_(shared::normalizeInlineWhitespace(line));
    if (normalized.empty()) {
        return false;
    }

    return containsAny_(normalized, {
        "crie um job",
        "crie uma tarefa",
        "criar job",
        "criar tarefa",
        "create a job",
        "create job",
        "job/tarefa",
    });
}

bool looksLikeExplicitCameraLine_(const std::string& line)
{
    const std::string normalized = shared::normalizeInlineWhitespace(stripListPrefix_(line));
    if (normalized.empty() || normalized.back() == ':') {
        return false;
    }
    if (!extractIpv4_(normalized).empty()) {
        return true;
    }

    std::size_t separatorCount = 0;
    std::size_t searchFrom = 0;
    while (true) {
        const std::size_t found = normalized.find(" - ", searchFrom);
        if (found == std::string::npos) {
            break;
        }
        ++separatorCount;
        searchFrom = found + 3;
    }
    return separatorCount >= 2;
}

std::string normalizeGoalSummaryCandidate_(std::string line)
{
    line = shared::normalizeInlineWhitespace(stripListPrefix_(std::move(line)));
    while (!line.empty() &&
        (line.back() == ';' || line.back() == ':' || line.back() == ',' || line.back() == '.')) {
        line.pop_back();
    }
    return shared::normalizeInlineWhitespace(std::move(line));
}

int analysisGoalCandidateScore_(const std::string& candidate, bool afterCameraSection)
{
    if (candidate.empty()) {
        return 0;
    }

    const std::string normalized = lowerAsciiCopy_(candidate);
    if (looksLikeCameraSectionHeader_(candidate) ||
        looksLikeExecutionPreferenceLine_(candidate) ||
        looksLikeCreationInstructionLine_(candidate) ||
        looksLikeExplicitCameraLine_(candidate)) {
        return 0;
    }

    int score = afterCameraSection ? 40 : 0;
    if (containsAny_(normalized, {
        "identific",
        "detect",
        "detec",
        "analis",
        "analise",
        "vestimenta",
        "interno",
        "intruso",
        "pessoa",
        "individ",
        "uniforme",
        "calcao",
        "comport",
        "alert",
    })) {
        score += 70;
    }
    if (candidate.size() >= 20) {
        score += 10;
    }
    if (candidate.size() >= 40) {
        score += 10;
    }
    return score;
}

std::string explicitGoalSummaryFromPayload_(const json& payload)
{
    const std::string message = shared::jsonStringField(payload, "query");
    if (message.empty()) {
        return "";
    }

    std::vector<std::string> lines;
    std::istringstream input(message);
    std::string line;
    while (std::getline(input, line)) {
        lines.push_back(line);
    }

    bool inCameraSection = false;
    bool collectedCameraLines = false;
    bool afterCameraSection = false;
    int bestScore = 0;
    std::string bestCandidate;

    for (const auto& rawLine : lines) {
        const std::string trimmed = shared::trimText(rawLine);
        if (trimmed.empty()) {
            if (inCameraSection && collectedCameraLines) {
                inCameraSection = false;
                afterCameraSection = true;
            }
            continue;
        }

        if (looksLikeCameraSectionHeader_(trimmed)) {
            inCameraSection = true;
            collectedCameraLines = false;
            afterCameraSection = false;
            continue;
        }

        if (inCameraSection) {
            if (looksLikeExplicitCameraLine_(trimmed)) {
                collectedCameraLines = true;
                continue;
            }
            if (collectedCameraLines) {
                inCameraSection = false;
                afterCameraSection = true;
            }
        }

        const std::string candidate = normalizeGoalSummaryCandidate_(trimmed);
        const int score = analysisGoalCandidateScore_(candidate, afterCameraSection);
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }

    return bestScore >= 40 ? bestCandidate : "";
}

bool snapshotHasRequiredPromptFields_(const json& value)
{
    return !safeText_(value, "prompt_template").empty() &&
        !safeText_(value, "alert_condition").empty();
}

bool agentSpecAlreadyHasAnalysis_(const json& agent)
{
    if (!safeText_(agent, "goal_summary").empty()) {
        return true;
    }
    if (snapshotHasRequiredPromptFields_(agent.value("agent_patch", json::object()))) {
        return true;
    }
    if (snapshotHasRequiredPromptFields_(agent.value("compiled_snapshot", json::object()))) {
        return true;
    }
    return false;
}

std::string defaultAlertPolicyForStep_(const json& step, std::size_t stepCount)
{
    const std::string role = lowerAsciiCopy_(safeText_(step, "role"));
    if (role == "decision") {
        return "final_decision_only";
    }
    if (role == "collector" && stepCount > 1) {
        return "never";
    }
    return "local";
}

std::string firstStepTargetSlotKey_(const json& step)
{
    const json targets = step.value("targets", json::array());
    for (const auto& target : targets) {
        const std::string slotKey = safeText_(target, "slot_key");
        if (!slotKey.empty()) {
            return slotKey;
        }
    }
    return "";
}

json seedAgentPatchForStep_(const json& step)
{
    const json groupPatch =
        step.value("inference_group", json::object()).value("shared_agent_patch", json::object());
    return groupPatch.is_object() ? groupPatch : json::object();
}

void seedAgentGoalSummary_(
    json& agent,
    const json& step,
    const std::string& goalSummary,
    std::size_t stepCount)
{
    if (!agent.is_object()) {
        agent = json::object();
    }
    if (!agent.contains("agent_patch") || !agent["agent_patch"].is_object()) {
        agent["agent_patch"] = seedAgentPatchForStep_(step);
    }
    if (safeText_(agent, "goal_summary").empty()) {
        agent["goal_summary"] = goalSummary;
    }
    if (safeText_(agent, "alert_policy").empty()) {
        agent["alert_policy"] = defaultAlertPolicyForStep_(step, stepCount);
    }
    const std::string firstTargetSlotKey = firstStepTargetSlotKey_(step);
    if (safeText_(agent, "destination_type").empty()) {
        agent["destination_type"] = firstTargetSlotKey.empty() ? "step_default" : "step_camera";
    }
    std::string destinationType = lowerAsciiCopy_(safeText_(agent, "destination_type"));
    if (destinationType == "step_default" && !firstTargetSlotKey.empty()) {
        agent["destination_type"] = "step_camera";
        destinationType = "step_camera";
    }
    if ((destinationType == "step_camera" || destinationType == "camera") &&
        safeText_(agent, "camera_slot_key").empty() &&
        !firstTargetSlotKey.empty()) {
        agent["camera_slot_key"] = firstTargetSlotKey;
    }
}

void applyGoalSummaryFallbacksToBlueprint_(json& blueprint, const json& payload)
{
    std::string goalSummary = explicitGoalSummaryFromPayload_(payload);
    if (!goalSummary.empty()) {
        if (!blueprint.contains("job") || !blueprint["job"].is_object()) {
            blueprint["job"] = json::object();
        }
        blueprint["job"]["description"] = goalSummary;
    }
    else {
        goalSummary = safeText_(blueprint.value("job", json::object()), "description");
    }

    if (goalSummary.empty() || !blueprint.contains("steps") || !blueprint["steps"].is_array()) {
        return;
    }

    const std::size_t stepCount = blueprint["steps"].size();
    for (auto& step : blueprint["steps"]) {
        if (!step.is_object()) {
            continue;
        }

        const std::string executionMode = lowerAsciiCopy_(safeText_(step.value("execution", json::object()), "mode"));
        if (!step.contains("agents") || !step["agents"].is_array()) {
            step["agents"] = json::array();
        }

        bool seededAny = false;
        if (step["agents"].empty()) {
            const json targets = step.value("targets", json::array());
            if (executionMode == "inference_group_image" || (!targets.is_array() || targets.empty())) {
                json seededAgent = json::object();
                seedAgentGoalSummary_(seededAgent, step, goalSummary, stepCount);
                step["agents"] = json::array({ seededAgent });
                seededAny = true;
            }
            else {
                for (const auto& target : targets) {
                    json seededAgent = json::object({
                        { "destination_type", "step_camera" },
                        { "camera_slot_key", safeText_(target, "slot_key") },
                    });
                    seedAgentGoalSummary_(seededAgent, step, goalSummary, stepCount);
                    step["agents"].push_back(seededAgent);
                }
                seededAny = true;
            }
        }

        for (auto& agent : step["agents"]) {
            const std::string destinationType = lowerAsciiCopy_(safeText_(agent, "destination_type"));
            const bool needsBinding =
                (destinationType.empty() ||
                 destinationType == "step_default" ||
                 ((destinationType == "step_camera" || destinationType == "camera") &&
                  safeText_(agent, "camera_slot_key").empty())) &&
                !firstStepTargetSlotKey_(step).empty();
            if (!needsBinding && agentSpecAlreadyHasAnalysis_(agent)) {
                continue;
            }
            seedAgentGoalSummary_(agent, step, goalSummary, stepCount);
            seededAny = true;
        }

        if (executionMode == "inference_group_image") {
            if (!step.contains("inference_group") || !step["inference_group"].is_object()) {
                step["inference_group"] = json::object();
            }
            if (safeText_(step["inference_group"], "source_target_slot_key").empty()) {
                const std::string firstTargetSlotKey = firstStepTargetSlotKey_(step);
                if (!firstTargetSlotKey.empty()) {
                    step["inference_group"]["source_target_slot_key"] = firstTargetSlotKey;
                }
            }
            if (seededAny && !step["inference_group"].contains("enabled")) {
                step["inference_group"]["enabled"] = true;
            }
        }
    }
}

std::string parsedTargetKey_(const json& target)
{
    const json selector = target.value("camera_selector", json::object());
    const std::string name = lowerAsciiCopy_(safeText_(selector, "name"));
    const std::string ip = lowerAsciiCopy_(safeText_(selector, "ip_address"));
    if (!name.empty() || !ip.empty()) {
        return name + "|" + ip;
    }
    return lowerAsciiCopy_(safeText_(target, "slot_label"));
}

void appendUniqueParsedTarget_(json& targets, const json& target)
{
    if (!targets.is_array() || !target.is_object() || target.empty()) {
        return;
    }
    const std::string key = parsedTargetKey_(target);
    if (key.empty()) {
        return;
    }
    for (const auto& existing : targets) {
        if (parsedTargetKey_(existing) == key) {
            return;
        }
    }
    targets.push_back(target);
}

json buildExplicitCameraTargetFromLine_(const std::string& rawLine)
{
    const std::string displayLine = stripListPrefix_(rawLine);
    if (displayLine.empty() || displayLine.back() == ':') {
        return json::object();
    }

    const std::string ipAddress = extractIpv4_(displayLine);
    static const std::regex ipv4Pattern(R"(\b(?:\d{1,3}\.){3}\d{1,3}\b)");
    std::string selectorName = ipAddress.empty()
        ? displayLine
        : std::regex_replace(displayLine, ipv4Pattern, " ");
    selectorName = trimCameraLabelEdges_(selectorName);

    if (selectorName.empty() && ipAddress.empty()) {
        return json::object();
    }

    json selector = json::object();
    if (!selectorName.empty()) {
        selector["name"] = selectorName;
    }
    if (!ipAddress.empty()) {
        selector["ip_address"] = ipAddress;
    }

    json target = json::object({
        { "camera_selector", selector },
    });
    if (!displayLine.empty()) {
        target["slot_label"] = displayLine;
    }
    return target;
}

json extractExplicitCameraTargetsFromPayload_(const json& payload)
{
    json targets = json::array();
    const std::string message = shared::jsonStringField(payload, "query");
    if (message.empty()) {
        return targets;
    }

    std::vector<std::string> lines;
    std::istringstream input(message);
    std::string line;
    while (std::getline(input, line)) {
        lines.push_back(line);
    }

    bool inCameraSection = false;
    bool collectedAny = false;
    for (const auto& rawLine : lines) {
        const std::string trimmed = shared::trimText(rawLine);
        if (trimmed.empty()) {
            if (inCameraSection && collectedAny) {
                break;
            }
            continue;
        }

        if (!inCameraSection) {
            if (looksLikeCameraSectionHeader_(trimmed)) {
                inCameraSection = true;
            }
            continue;
        }

        if (looksLikeCameraSectionHeader_(trimmed) && collectedAny) {
            break;
        }
        if (looksLikeCameraSectionTerminator_(trimmed) && collectedAny) {
            break;
        }

        const json parsedTarget = buildExplicitCameraTargetFromLine_(trimmed);
        if (parsedTarget.empty()) {
            if (collectedAny) {
                break;
            }
            continue;
        }

        appendUniqueParsedTarget_(targets, parsedTarget);
        collectedAny = true;
    }

    if (!targets.empty()) {
        return targets;
    }

    for (const auto& rawLine : lines) {
        const std::string trimmed = shared::trimText(rawLine);
        if (trimmed.empty() || extractIpv4_(trimmed).empty()) {
            continue;
        }
        const json parsedTarget = buildExplicitCameraTargetFromLine_(trimmed);
        appendUniqueParsedTarget_(targets, parsedTarget);
    }

    return targets;
}

std::size_t countTargetsWithExplicitCameraReference_(const json& targets)
{
    if (!targets.is_array()) {
        return 0;
    }

    std::size_t count = 0;
    for (const auto& target : targets) {
        if (!target.is_object()) {
            continue;
        }
        if (!target.value("camera_selector", json::object()).empty() ||
            !target.value("resolved_camera", json::object()).empty()) {
            ++count;
        }
    }
    return count;
}

json buildTargetFromTemplate_(
    const json& templateTarget,
    const json& parsedTarget,
    std::size_t index,
    std::vector<std::string>& usedSlotKeys)
{
    json target = templateTarget.is_object() ? templateTarget : json::object();
    target.erase("resolved_camera");
    target.erase("resolution");

    const std::string slotLabel = !safeText_(parsedTarget, "slot_label").empty()
        ? safeText_(parsedTarget, "slot_label")
        : safeText_(parsedTarget.value("camera_selector", json::object()), "name");
    if (!slotLabel.empty()) {
        target["slot_label"] = slotLabel;
    }

    const std::string fallbackKey = "camera_" + std::to_string(index + 1);
    const std::string slotKey = uniqueSlotKeyForTarget_(
        slotLabel.empty()
            ? safeText_(parsedTarget.value("camera_selector", json::object()), "name")
            : slotLabel,
        fallbackKey,
        usedSlotKeys);
    target["slot_key"] = slotKey;
    target["camera_selector"] = parsedTarget.value("camera_selector", json::object());

    if (safeText_(target, "input_type").empty()) {
        target["input_type"] = "video";
    }

    return target;
}

void syncStepTargetsWithExplicitCameraList_(json& step, const json& parsedTargets)
{
    if (!step.is_object() || !parsedTargets.is_array() || parsedTargets.empty()) {
        return;
    }

    const json currentTargets = step.value("targets", json::array());
    const std::size_t explicitTargetCount = countTargetsWithExplicitCameraReference_(currentTargets);
    const bool shouldReplaceTargets =
        currentTargets.empty() ||
        explicitTargetCount == 0 ||
        currentTargets.size() == parsedTargets.size() ||
        (currentTargets.size() == 1 && parsedTargets.size() > 1);
    if (!shouldReplaceTargets) {
        return;
    }

    const json templateTarget = currentTargets.empty() ? json::object() : currentTargets[0];
    json nextTargets = json::array();
    std::vector<std::string> usedSlotKeys;
    for (std::size_t index = 0; index < parsedTargets.size(); ++index) {
        nextTargets.push_back(buildTargetFromTemplate_(templateTarget, parsedTargets[index], index, usedSlotKeys));
    }
    step["targets"] = nextTargets;

    const std::string executionMode = lowerAsciiCopy_(safeText_(step.value("execution", json::object()), "mode"));
    if (executionMode == "inference_group_image") {
        step["inference_group"]["target_slot_keys"] = json::array();
        for (const auto& target : step["targets"]) {
            if (!safeText_(target, "slot_key").empty()) {
                step["inference_group"]["target_slot_keys"].push_back(safeText_(target, "slot_key"));
            }
        }
        return;
    }

    if (!step.contains("agents") || !step["agents"].is_array() || step["agents"].size() != 1) {
        return;
    }

    const json templateAgent = step["agents"][0];
    const std::string destinationType = lowerAsciiCopy_(safeText_(templateAgent, "destination_type"));
    if (destinationType != "step_camera" && destinationType != "camera") {
        return;
    }

    json nextAgents = json::array();
    for (const auto& target : step["targets"]) {
        json agent = templateAgent;
        agent["camera_slot_key"] = safeText_(target, "slot_key");
        nextAgents.push_back(agent);
    }
    step["agents"] = nextAgents;
}

bool agentUsesPhysicalCameraDestination_(const json& agent)
{
    const std::string destinationType = lowerAsciiCopy_(safeText_(agent, "destination_type"));
    return destinationType == "step_camera" || destinationType == "camera";
}

bool targetLikelyRequiresPhysicalCamera_(const json& step, const json& target)
{
    if (!target.is_object()) {
        return false;
    }
    if (target.contains("camera_required")) {
        return target.value("camera_required", true);
    }

    if (!target.value("camera_selector", json::object()).empty() ||
        !target.value("resolved_camera", json::object()).empty()) {
        return true;
    }

    const std::string executionMode = lowerAsciiCopy_(safeText_(step.value("execution", json::object()), "mode"));
    if (executionMode == "inference_group_image") {
        return true;
    }

    const std::string slotKey = shared::slugifyKey(safeText_(target, "slot_key"), "");
    for (const auto& agent : step.value("agents", json::array())) {
        if (!agentUsesPhysicalCameraDestination_(agent)) {
            continue;
        }
        if (slotKey.empty()) {
            return true;
        }
        if (shared::slugifyKey(safeText_(agent, "camera_slot_key"), "") == slotKey) {
            return true;
        }
    }

    return lowerAsciiCopy_(safeText_(target, "input_type")) != "image";
}

bool stepLikelyUsesPhysicalCameras_(const json& step)
{
    const std::string executionMode = lowerAsciiCopy_(safeText_(step.value("execution", json::object()), "mode"));
    if (executionMode == "inference_group_image") {
        return true;
    }

    for (const auto& agent : step.value("agents", json::array())) {
        if (agentUsesPhysicalCameraDestination_(agent)) {
            return true;
        }
    }

    for (const auto& target : step.value("targets", json::array())) {
        if (targetLikelyRequiresPhysicalCamera_(step, target)) {
            return true;
        }
    }

    return false;
}

bool stepStillNeedsCameraTargets_(const json& step)
{
    const json targets = step.value("targets", json::array());
    if (!targets.is_array() || targets.empty()) {
        return stepLikelyUsesPhysicalCameras_(step);
    }

    bool sawPhysicalTarget = false;
    for (const auto& target : targets) {
        if (!targetLikelyRequiresPhysicalCamera_(step, target)) {
            continue;
        }
        sawPhysicalTarget = true;
        if (target.value("camera_selector", json::object()).empty() &&
            target.value("resolved_camera", json::object()).empty()) {
            return true;
        }
    }

    return !sawPhysicalTarget && stepLikelyUsesPhysicalCameras_(step);
}

std::size_t selectPrimaryCameraStepIndex_(const json& blueprint)
{
    const json steps = blueprint.value("steps", json::array());
    if (!steps.is_array() || steps.empty()) {
        return static_cast<std::size_t>(-1);
    }

    std::size_t bestIndex = 0;
    int bestScore = std::numeric_limits<int>::min();
    for (std::size_t index = 0; index < steps.size(); ++index) {
        const auto& step = steps[index];
        int score = 0;
        if (stepStillNeedsCameraTargets_(step)) {
            score += 100;
        }
        if (stepLikelyUsesPhysicalCameras_(step)) {
            score += 40;
        }
        const std::string role = lowerAsciiCopy_(safeText_(step, "role"));
        if (role == "collector") {
            score += 15;
        }
        else if (role == "decision") {
            score += 5;
        }
        if (!step.value("agents", json::array()).empty()) {
            score += 10;
        }
        if (!step.value("targets", json::array()).empty()) {
            score += 5;
        }
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    }
    return bestIndex;
}

void coerceBlueprintToSingleStepWhenExplicit_(json& blueprint, const json& payload)
{
    const bool shouldForceSingleStep =
        messageRequestsSingleStep_(payload) ||
        lowerAsciiCopy_(safeText_(blueprint.value("decision", json::object()), "execution_mode")) == "single_step_job";
    if (!shouldForceSingleStep) {
        return;
    }
    if (!blueprint.contains("steps") || !blueprint["steps"].is_array() || blueprint["steps"].size() <= 1) {
        return;
    }

    const std::size_t selectedIndex = selectPrimaryCameraStepIndex_(blueprint);
    if (selectedIndex == static_cast<std::size_t>(-1) || selectedIndex >= blueprint["steps"].size()) {
        return;
    }

    json step = blueprint["steps"][selectedIndex];
    step.erase("start_condition");
    step.erase("knowledge_inputs");
    if (!step.contains("execution") || !step["execution"].is_object()) {
        step["execution"] = json::object();
    }
    if (safeText_(step.value("execution", json::object()), "mode").empty()) {
        step["execution"]["mode"] = "per_target_agents";
    }

    blueprint["steps"] = json::array({ step });
    if (!blueprint.contains("decision") || !blueprint["decision"].is_object()) {
        blueprint["decision"] = json::object();
    }
    blueprint["decision"]["execution_mode"] = "single_step_job";
    blueprint["decision"]["reason"] = "single-step orchestration requested";
}

std::vector<std::size_t> collectCandidateStepIndexesForExplicitCameras_(const json& blueprint)
{
    std::vector<std::size_t> needingTargets;
    std::vector<std::size_t> physicalCameraSteps;

    const json steps = blueprint.value("steps", json::array());
    if (!steps.is_array()) {
        return needingTargets;
    }

    for (std::size_t index = 0; index < steps.size(); ++index) {
        const auto& step = steps[index];
        if (stepStillNeedsCameraTargets_(step)) {
            needingTargets.push_back(index);
        }
        if (stepLikelyUsesPhysicalCameras_(step)) {
            physicalCameraSteps.push_back(index);
        }
    }

    if (!needingTargets.empty()) {
        return needingTargets;
    }
    return physicalCameraSteps;
}

void applyExplicitCameraTargetsToBlueprint_(json& blueprint, const json& payload)
{
    const json parsedTargets = extractExplicitCameraTargetsFromPayload_(payload);
    if (!parsedTargets.is_array() || parsedTargets.empty()) {
        return;
    }

    coerceBlueprintToSingleStepWhenExplicit_(blueprint, payload);

    if (!blueprint.contains("steps") || !blueprint["steps"].is_array() || blueprint["steps"].empty()) {
        return;
    }

    if (blueprint["steps"].size() == 1) {
        syncStepTargetsWithExplicitCameraList_(blueprint["steps"][0], parsedTargets);
        return;
    }

    const std::vector<std::size_t> candidateIndexes = collectCandidateStepIndexesForExplicitCameras_(blueprint);
    if (candidateIndexes.size() == 1 && candidateIndexes[0] < blueprint["steps"].size()) {
        syncStepTargetsWithExplicitCameraList_(blueprint["steps"][candidateIndexes[0]], parsedTargets);
    }
}

void applyResolvedCameraToTarget_(json& target, const json& camera)
{
    if (!target.is_object() || !camera.is_object() || camera.empty()) {
        return;
    }

    target["resolved_camera"] = camera;
    target["resolution"] = json::object({
        { "status", "resolved" },
        { "item", camera },
        { "candidates", json::array() },
    });

    json selector = target.value("camera_selector", json::object());
    if (!selector.is_object()) {
        selector = json::object();
    }

    int cameraId = 0;
    if (shared::tryJsonIntField(camera, "id", cameraId) && cameraId > 0) {
        selector["id"] = cameraId;
    }

    const std::vector<const char*> selectorFields = {
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
    for (const auto* field : selectorFields) {
        const std::string fieldValue = safeText_(camera, field);
        if (!fieldValue.empty()) {
            selector[field] = fieldValue;
        }
    }
    target["camera_selector"] = selector;
}

bool tryResolveTargetByEmbeddedIp_(json& target)
{
    if (!target.is_object()) {
        return false;
    }

    const json resolution = target.value("resolution", json::object());
    if (safeText_(resolution, "status") != "ambiguous") {
        return false;
    }

    std::string ipAddress = extractIpv4_(safeText_(target, "slot_label"));
    if (ipAddress.empty()) {
        ipAddress = safeText_(target.value("camera_selector", json::object()), "ip_address");
    }
    if (ipAddress.empty()) {
        ipAddress = extractIpv4_(safeText_(target.value("camera_selector", json::object()), "name"));
    }
    if (ipAddress.empty()) {
        return false;
    }

    json matchedCamera = json::object();
    for (const auto& candidate : resolution.value("candidates", json::array())) {
        if (!candidate.is_object()) {
            continue;
        }
        if (lowerAsciiCopy_(safeText_(candidate, "ip_address")) != lowerAsciiCopy_(ipAddress)) {
            continue;
        }
        if (!matchedCamera.empty()) {
            return false;
        }
        matchedCamera = candidate;
    }

    if (matchedCamera.empty()) {
        return false;
    }

    applyResolvedCameraToTarget_(target, matchedCamera);
    return true;
}

int parseNumericChoiceFromMessage_(const std::string& rawMessage)
{
    const std::string message = shared::trimText(rawMessage);
    if (message.empty() || !extractIpv4_(message).empty()) {
        return 0;
    }

    std::smatch match;
    static const std::regex simpleChoice(R"(^(\d{1,2})[\.\)]?$)", std::regex::icase);
    if (std::regex_match(message, match, simpleChoice)) {
        return std::stoi(match.str(1));
    }

    static const std::regex labeledChoice(R"(^(?:opcao|option|camera)\s*#?\s*(\d{1,2})[\.\)]?$)", std::regex::icase);
    if (std::regex_match(message, match, labeledChoice)) {
        return std::stoi(match.str(1));
    }

    return 0;
}

bool candidateMatchesReplyText_(const json& candidate, const std::string& normalizedReply)
{
    if (normalizedReply.empty()) {
        return false;
    }

    const std::vector<std::string> variants = {
        lowerAsciiCopy_(safeText_(candidate, "name")),
        lowerAsciiCopy_(safeText_(candidate, "description")),
        lowerAsciiCopy_(safeText_(candidate, "scene_description")),
    };
    return std::any_of(variants.begin(), variants.end(), [&](const std::string& variant) {
        return !variant.empty() && normalizedReply == variant;
    });
}

bool applyCameraConfirmationFromMessage_(json& blueprint, const json& payload)
{
    const std::string message = shared::trimText(shared::jsonStringField(payload, "query"));
    if (message.empty() || !blueprint.contains("steps") || !blueprint["steps"].is_array()) {
        return false;
    }

    json* ambiguousTarget = nullptr;
    std::size_t ambiguousTargetCount = 0;
    for (auto& step : blueprint["steps"]) {
        if (!step.is_object() || !step.contains("targets") || !step["targets"].is_array()) {
            continue;
        }
        for (auto& target : step["targets"]) {
            if (safeText_(target.value("resolution", json::object()), "status") == "ambiguous") {
                ambiguousTarget = &target;
                ++ambiguousTargetCount;
            }
        }
    }

    if (ambiguousTarget == nullptr || ambiguousTargetCount != 1) {
        return false;
    }

    const json candidates = ambiguousTarget->value("resolution", json::object()).value("candidates", json::array());
    if (!candidates.is_array() || candidates.empty()) {
        return false;
    }

    const int numericChoice = parseNumericChoiceFromMessage_(message);
    if (numericChoice > 0 && numericChoice <= static_cast<int>(candidates.size())) {
        applyResolvedCameraToTarget_(*ambiguousTarget, candidates[static_cast<std::size_t>(numericChoice - 1)]);
        return true;
    }

    const std::string replyIp = extractIpv4_(message);
    if (!replyIp.empty()) {
        json matched = json::object();
        for (const auto& candidate : candidates) {
            if (!candidate.is_object()) {
                continue;
            }
            if (lowerAsciiCopy_(safeText_(candidate, "ip_address")) != lowerAsciiCopy_(replyIp)) {
                continue;
            }
            if (!matched.empty()) {
                return false;
            }
            matched = candidate;
        }
        if (!matched.empty()) {
            applyResolvedCameraToTarget_(*ambiguousTarget, matched);
            return true;
        }
    }

    const std::string normalizedReply = lowerAsciiCopy_(shared::normalizeInlineWhitespace(message));
    if (normalizedReply.size() < 3) {
        return false;
    }

    json matched = json::object();
    for (const auto& candidate : candidates) {
        if (!candidate.is_object() || !candidateMatchesReplyText_(candidate, normalizedReply)) {
            continue;
        }
        if (!matched.empty()) {
            return false;
        }
        matched = candidate;
    }

    if (!matched.empty()) {
        applyResolvedCameraToTarget_(*ambiguousTarget, matched);
        return true;
    }

    return false;
}

void applyEmbeddedIpDisambiguation_(json& blueprint)
{
    if (!blueprint.contains("steps") || !blueprint["steps"].is_array()) {
        return;
    }

    for (auto& step : blueprint["steps"]) {
        if (!step.is_object() || !step.contains("targets") || !step["targets"].is_array()) {
            continue;
        }
        for (auto& target : step["targets"]) {
            tryResolveTargetByEmbeddedIp_(target);
        }
    }
}

std::string cameraCandidateSummary_(const json& camera)
{
    std::ostringstream out;
    const std::string cameraName = safeText_(camera, "name");
    out << (cameraName.empty() ? "camera" : cameraName);

    const std::string ipAddress = safeText_(camera, "ip_address");
    if (!ipAddress.empty()) {
        out << " - IP " << ipAddress;
    }

    const std::string description = !safeText_(camera, "scene_description").empty()
        ? safeText_(camera, "scene_description")
        : safeText_(camera, "description");
    if (!description.empty() && description != cameraName) {
        out << " - " << description;
    }

    return out.str();
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
            << cameraCandidateSummary_(camera);
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

int positiveIntField_(const json& value, const char* key)
{
    int parsed = 0;
    if (shared::tryJsonIntField(value, key, parsed) && parsed > 0) {
        return parsed;
    }
    return 0;
}

std::string targetPreviewLabel_(const json& target)
{
    const json selector = target.value("camera_selector", json::object());
    const json resolvedCamera = target.value("resolved_camera", json::object());
    const std::string baseLabel = firstNonEmptyText_({
        safeText_(target, "slot_label"),
        safeText_(selector, "name"),
        safeText_(resolvedCamera, "name"),
        safeText_(target, "slot_key"),
    });
    const std::string ipAddress = firstNonEmptyText_({
        safeText_(selector, "ip_address"),
        safeText_(resolvedCamera, "ip_address"),
        extractIpv4_(baseLabel),
    });

    if (baseLabel.empty()) {
        return ipAddress;
    }
    if (!ipAddress.empty() &&
        lowerAsciiCopy_(baseLabel).find(lowerAsciiCopy_(ipAddress)) == std::string::npos) {
        return baseLabel + " - " + ipAddress;
    }
    return baseLabel;
}

std::string stepTitleForMetadata_(const json& step, std::size_t index)
{
    const std::string explicitName = safeText_(step, "name");
    if (!explicitName.empty()) {
        return explicitName;
    }

    const std::string stepKey = safeText_(step, "step_key");
    if (!stepKey.empty()) {
        return stepKey;
    }

    return "step_" + std::to_string(index + 1);
}

std::string inferStepInputType_(const json& step)
{
    for (const auto& target : step.value("targets", json::array())) {
        const std::string inputType = safeText_(target, "input_type");
        if (!inputType.empty()) {
            return inputType;
        }
    }

    const json inferenceGroupSnapshot =
        step.value("inference_group", json::object()).value("compiled_snapshot", json::object());
    const std::string groupInputType = safeText_(inferenceGroupSnapshot, "input_type");
    if (!groupInputType.empty()) {
        return groupInputType;
    }

    for (const auto& agentSpec : step.value("agents", json::array())) {
        const std::string compiledInputType =
            safeText_(agentSpec.value("compiled_snapshot", json::object()), "input_type");
        if (!compiledInputType.empty()) {
            return compiledInputType;
        }

        const std::string patchInputType =
            safeText_(agentSpec.value("agent_patch", json::object()), "input_type");
        if (!patchInputType.empty()) {
            return patchInputType;
        }
    }

    return "";
}

int inferStepRunEverySeconds_(const json& step)
{
    const json inferenceGroupSnapshot =
        step.value("inference_group", json::object()).value("compiled_snapshot", json::object());
    int runEverySeconds = positiveIntField_(inferenceGroupSnapshot, "run_every");
    if (runEverySeconds > 0) {
        return runEverySeconds;
    }

    for (const auto& agentSpec : step.value("agents", json::array())) {
        runEverySeconds = positiveIntField_(agentSpec.value("compiled_snapshot", json::object()), "run_every");
        if (runEverySeconds > 0) {
            return runEverySeconds;
        }

        runEverySeconds = positiveIntField_(agentSpec.value("agent_patch", json::object()), "run_every");
        if (runEverySeconds > 0) {
            return runEverySeconds;
        }
    }

    return 0;
}

json buildJobCreationStepMetadata_(const json& step, std::size_t index)
{
    const json targets = step.value("targets", json::array());
    const std::size_t targetCount = targets.is_array() ? targets.size() : 0;
    json previewLabels = json::array();
    constexpr std::size_t kMaxPreviewTargets = 4;
    for (const auto& target : targets) {
        const std::string label = targetPreviewLabel_(target);
        if (!label.empty()) {
            previewLabels.push_back(label);
        }
        if (previewLabels.size() >= kMaxPreviewTargets) {
            break;
        }
    }

    json metadata = json::object({
        { "step_index", static_cast<int>(index + 1) },
        { "step_name", stepTitleForMetadata_(step, index) },
        { "target_count", static_cast<int>(targetCount) },
        { "target_preview_labels", previewLabels },
    });

    const std::string stepKey = safeText_(step, "step_key");
    if (!stepKey.empty()) {
        metadata["step_key"] = stepKey;
    }

    const std::string role = safeText_(step, "role");
    if (!role.empty()) {
        metadata["role"] = role;
    }

    const std::string executionMode = safeText_(step.value("execution", json::object()), "mode");
    if (!executionMode.empty()) {
        metadata["execution_mode"] = executionMode;
    }

    const std::string inputType = inferStepInputType_(step);
    if (!inputType.empty()) {
        metadata["input_type"] = inputType;
    }

    const int runEverySeconds = inferStepRunEverySeconds_(step);
    if (runEverySeconds > 0) {
        metadata["run_every_seconds"] = runEverySeconds;
    }

    if (targetCount > previewLabels.size()) {
        metadata["remaining_target_count"] =
            static_cast<int>(targetCount - previewLabels.size());
    }

    return metadata;
}

int targetCountFromBlueprint_(const json& blueprint)
{
    int targetCount = 0;
    for (const auto& step : blueprint.value("steps", json::array())) {
        const json targets = step.value("targets", json::array());
        if (targets.is_array()) {
            targetCount += static_cast<int>(targets.size());
        }
    }
    return targetCount;
}

json buildJobCreationMessageMetadata_(
    const std::string& language,
    const json& blueprint,
    const json& installed)
{
    const json installedJob = installed.value("job", json::object());
    int jobId = positiveIntField_(installed, "job_id");
    if (jobId <= 0) {
        jobId = positiveIntField_(installedJob, "id");
    }

    const std::string jobName = firstNonEmptyText_({
        safeText_(installedJob, "name"),
        safeText_(blueprint.value("job", json::object()), "name"),
    });

    json stepMetadata = json::array();
    const json steps = blueprint.value("steps", json::array());
    for (std::size_t index = 0; index < steps.size(); ++index) {
        stepMetadata.push_back(buildJobCreationStepMetadata_(steps[index], index));
    }

    int stepCount = positiveIntField_(installedJob, "step_count");
    if (stepCount <= 0) {
        stepCount = static_cast<int>(steps.size());
    }

    int targetCount = positiveIntField_(installedJob, "target_count");
    if (targetCount <= 0) {
        targetCount = targetCountFromBlueprint_(blueprint);
    }

    json metadata = json::object({
        { "type", "job_creation_result" },
        { "status", "created" },
        { "language", normalizeAssistantLanguageTag(language) },
        { "step_count", stepCount },
        { "target_count", targetCount },
        { "steps", stepMetadata },
    });
    if (jobId > 0) {
        metadata["job_id"] = jobId;
    }
    if (!jobName.empty()) {
        metadata["job_name"] = jobName;
    }
    return metadata;
}

std::string buildCreatedJobAnswer_(
    const std::string& language,
    const std::string& jobName,
    std::size_t stepCount)
{
    const bool isPt = normalizeAssistantLanguageTag(language) == "pt";
    if (stepCount == 0) {
        return isPt
            ? (jobName.empty()
                ? "Criei o job."
                : "Criei o job \"" + jobName + "\".")
            : (jobName.empty()
                ? "I created the job."
                : "I created the job \"" + jobName + "\".");
    }

    const std::string stepLabel = isPt
        ? (stepCount == 1
            ? "1 etapa"
            : std::to_string(stepCount) + " etapas")
        : (stepCount == 1
            ? "1 step"
            : std::to_string(stepCount) + " steps");

    return isPt
        ? (jobName.empty()
            ? "Criei o job com " + stepLabel + "."
            : "Criei o job \"" + jobName + "\" com " + stepLabel + ".")
        : (jobName.empty()
            ? "I created the job with " + stepLabel + "."
            : "I created the job \"" + jobName + "\" with " + stepLabel + ".");
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
    applyExplicitCameraTargetsToBlueprint_(blueprint, payload);
    applyExplicitExecutionPreferencesToBlueprint_(blueprint, payload);
    applyGoalSummaryFallbacksToBlueprint_(blueprint, payload);
    applyCameraConfirmationFromMessage_(blueprint, payload);
    if (isExplicitJobArtifactRequest_(payload, selection, blueprint)) {
        ensureDecisionConstraint_(blueprint, "force_job_artifact");
    }
    blueprint = shared::finalizeJobBlueprintValidation(blueprint);

    const std::string executionMode = safeText_(blueprint.value("decision", json::object()), "execution_mode");
    const bool forceJobArtifact = hasDecisionConstraint_(blueprint, "force_job_artifact");
    if (executionMode == "camera_agent" && !forceJobArtifact) {
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
    applyEmbeddedIpDisambiguation_(blueprint);
    applyCameraConfirmationFromMessage_(blueprint, payload);
    applyGoalSummaryFallbacksToBlueprint_(blueprint, payload);
    for (auto& step : blueprint["steps"]) {
        for (auto& target : step["targets"]) {
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
    result.answer = buildCreatedJobAnswer_(
        language,
        answerJobName,
        blueprint.value("steps", json::array()).size());
    result.metadata["job"] = installed.value("job", json::object());
    result.metadata["message_metadata"] = buildJobCreationMessageMetadata_(language, blueprint, installed);
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

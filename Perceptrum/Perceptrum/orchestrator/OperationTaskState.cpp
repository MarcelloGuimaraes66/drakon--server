#include "OperationTaskState.h"

#include <algorithm>
#include <cctype>
#include <ctime>

#include "PromptBuilder.h"

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

std::vector<std::string> normalizeStringArray_(const std::vector<std::string>& values)
{
    std::vector<std::string> normalized;
    for (const auto& value : values) {
        const std::string clean = trimCopy_(value);
        if (clean.empty()) {
            continue;
        }
        normalized.push_back(clean);
        if (normalized.size() >= 24) {
            break;
        }
    }
    return normalized;
}

std::string currentIsoTimestamp_()
{
    const std::time_t now = std::time(nullptr);
    std::tm timeInfo{};
#if defined(_WIN32)
    gmtime_s(&timeInfo, &now);
#else
    gmtime_r(&now, &timeInfo);
#endif

    char buffer[32] = {};
    if (std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeInfo) == 0) {
        return "";
    }
    return buffer;
}

std::string entitySessionKey_(std::string entityType, const std::string& suffix)
{
    entityType = lowerAsciiCopy_(trimCopy_(std::move(entityType)));
    std::replace_if(entityType.begin(), entityType.end(), [](unsigned char ch) {
        return !(std::isalnum(ch) != 0);
    }, '_');
    entityType.erase(
        std::unique(entityType.begin(), entityType.end(), [](char left, char right) {
            return left == '_' && right == '_';
        }),
        entityType.end());
    if (entityType.empty()) {
        return suffix;
    }
    return "last_" + entityType + "_" + suffix;
}

nlohmann::json buildOperationTaskRecord_(const OperationTaskDescriptor& descriptor)
{
    nlohmann::json task = nlohmann::json::object({
        { "type", trimCopy_(descriptor.type) },
        { "status", trimCopy_(descriptor.status) },
        { "phase", trimCopy_(descriptor.phase) },
        { "summary", trimCopy_(descriptor.summary) },
        { "missing_fields", normalizeStringArray_(descriptor.missingFields) },
        { "collected_fields", normalizeStringArray_(descriptor.collectedFields) },
        { "updated_at", currentIsoTimestamp_() },
    });

    const std::string entityType = trimCopy_(descriptor.entityType);
    if (!entityType.empty()) {
        task["entity_type"] = entityType;
    }

    const std::string intent = trimCopy_(descriptor.intent);
    if (!intent.empty()) {
        task["intent"] = intent;
    }

    const std::string rawLanguage = trimCopy_(descriptor.language);
    if (!rawLanguage.empty()) {
        const std::string language = normalizeAssistantLanguageTag(rawLanguage);
        task["language"] = language;
        task["reply_language"] = language;
    }

    const std::string goal = trimCopy_(descriptor.goal);
    if (!goal.empty()) {
        task["goal"] = goal;
    }

    const std::string answerPreview = trimCopy_(descriptor.answerPreview);
    if (!answerPreview.empty()) {
        task["answer_preview"] = answerPreview;
    }

    if (descriptor.draft.is_object() && !descriptor.draft.empty()) {
        task["draft"] = descriptor.draft;
    }

    if (descriptor.uiContract.is_object() && !descriptor.uiContract.empty()) {
        task["ui_contract"] = descriptor.uiContract;
    }

    return task;
}

nlohmann::json mergeRecentTasks_(
    const nlohmann::json& taskState,
    const nlohmann::json& newestTask,
    std::size_t maxRecentTasks)
{
    nlohmann::json recentTasks = nlohmann::json::array();
    if (newestTask.is_object()) {
        recentTasks.push_back(newestTask);
    }

    if (taskState.is_object() &&
        taskState.contains("recent_tasks") &&
        taskState["recent_tasks"].is_array()) {
        for (const auto& item : taskState["recent_tasks"]) {
            if (!item.is_object()) {
                continue;
            }
            if (recentTasks.size() >= maxRecentTasks) {
                break;
            }
            recentTasks.push_back(item);
        }
    }

    return recentTasks;
}

void updateSessionEntities_(
    nlohmann::json& taskState,
    const OperationTaskDescriptor& descriptor)
{
    if (!taskState.contains("session_entities") || !taskState["session_entities"].is_object()) {
        taskState["session_entities"] = nlohmann::json::object();
    }

    if (!descriptor.draft.is_object()) {
        return;
    }

    const auto captureString = [&](const char* field, const std::string& suffix) {
        if (!descriptor.draft.contains(field) || !descriptor.draft[field].is_string()) {
            return;
        }
        const std::string value = trimCopy_(descriptor.draft[field].get<std::string>());
        if (value.empty()) {
            return;
        }
        taskState["session_entities"][entitySessionKey_(descriptor.entityType, suffix)] = value;
    };

    captureString("name", "name");
    captureString("id", "id");
}

} // namespace

nlohmann::json defaultOperationTaskState()
{
    return nlohmann::json::object({
        { "version", 2 },
        { "active_task", nullptr },
        { "recent_tasks", nlohmann::json::array() },
        { "session_entities", nlohmann::json::object() },
    });
}

nlohmann::json normalizeOperationTaskState(nlohmann::json taskState)
{
    if (!taskState.is_object()) {
        taskState = defaultOperationTaskState();
    }

    if (!taskState.contains("version") || !taskState["version"].is_number_integer()) {
        taskState["version"] = 2;
    }

    if (!taskState.contains("active_task") ||
        (!taskState["active_task"].is_null() && !taskState["active_task"].is_object())) {
        taskState["active_task"] = nullptr;
    }

    if (!taskState.contains("recent_tasks") || !taskState["recent_tasks"].is_array()) {
        taskState["recent_tasks"] = nlohmann::json::array();
    }

    if (!taskState.contains("session_entities") || !taskState["session_entities"].is_object()) {
        taskState["session_entities"] = nlohmann::json::object();
    }

    return taskState;
}

nlohmann::json taskStateFromConversationContext(const nlohmann::json& conversationContext)
{
    return normalizeOperationTaskState(
        conversationContext.is_object()
            ? conversationContext.value("task_state", defaultOperationTaskState())
            : defaultOperationTaskState());
}

std::string activeOperationTaskType(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return "";
    }

    const auto& activeTask = taskState["active_task"];
    if (!activeTask.contains("type") || !activeTask["type"].is_string()) {
        return "";
    }
    return trimCopy_(activeTask["type"].get<std::string>());
}

std::string activeOperationTaskLanguage(const nlohmann::json& conversationContext)
{
    const nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    if (!taskState.contains("active_task") || !taskState["active_task"].is_object()) {
        return "";
    }

    const auto& activeTask = taskState["active_task"];
    if (!activeTask.contains("language") || !activeTask["language"].is_string()) {
        return "";
    }
    return normalizeAssistantLanguageTag(activeTask["language"].get<std::string>());
}

nlohmann::json upsertActiveOperationTask(
    const nlohmann::json& conversationContext,
    const OperationTaskDescriptor& descriptor)
{
    nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    taskState["active_task"] = buildOperationTaskRecord_(descriptor);
    updateSessionEntities_(taskState, descriptor);
    return taskState;
}

nlohmann::json completeOperationTask(
    const nlohmann::json& conversationContext,
    const OperationTaskDescriptor& descriptor)
{
    nlohmann::json taskState = taskStateFromConversationContext(conversationContext);
    const nlohmann::json completedTask = buildOperationTaskRecord_(descriptor);
    taskState["active_task"] = nullptr;
    taskState["recent_tasks"] = mergeRecentTasks_(taskState, completedTask, 4);
    updateSessionEntities_(taskState, descriptor);
    return taskState;
}

} // namespace chatv2

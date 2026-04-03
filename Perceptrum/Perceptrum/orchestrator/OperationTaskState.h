#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace chatv2 {

struct OperationTaskDescriptor {
    std::string type;
    std::string entityType;
    std::string intent;
    std::string status;
    std::string phase;
    std::string language;
    std::string goal;
    std::string summary;
    std::string answerPreview;
    std::vector<std::string> missingFields;
    std::vector<std::string> collectedFields;
    nlohmann::json draft = nlohmann::json::object();
    nlohmann::json uiContract = nlohmann::json::object();
};

nlohmann::json defaultOperationTaskState();
nlohmann::json normalizeOperationTaskState(nlohmann::json taskState);
nlohmann::json taskStateFromConversationContext(const nlohmann::json& conversationContext);
std::string activeOperationTaskType(const nlohmann::json& conversationContext);
std::string activeOperationTaskLanguage(const nlohmann::json& conversationContext);
nlohmann::json upsertActiveOperationTask(
    const nlohmann::json& conversationContext,
    const OperationTaskDescriptor& descriptor);
nlohmann::json completeOperationTask(
    const nlohmann::json& conversationContext,
    const OperationTaskDescriptor& descriptor);

} // namespace chatv2

#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "../../SkillTypes.h"

namespace chatv2 {

class LocalLlmClient;

namespace shared {

nlohmann::json defaultJobBlueprint();
nlohmann::json normalizeJobBlueprint(const nlohmann::json& value);
nlohmann::json mergeJobBlueprint(
    const nlohmann::json& existingDraft,
    const nlohmann::json& patchDraft);
nlohmann::json activeCreateJobDraft(const nlohmann::json& conversationContext);
nlohmann::json normalizeRouterCreateJobDraft(const SkillSelection& selection);
nlohmann::json extractJobBlueprintDraft(
    const LocalLlmClient& llm,
    const nlohmann::json& payload,
    const nlohmann::json& conversationContext,
    const SkillSelection& selection);
nlohmann::json chooseJobTopology(const nlohmann::json& blueprint);
nlohmann::json resolveJobBlueprintSelectors(
    const nlohmann::json& blueprint,
    const nlohmann::json& cameraInventory);
std::vector<std::string> collectMissingJobFields(const nlohmann::json& blueprint);
nlohmann::json finalizeJobBlueprintValidation(const nlohmann::json& blueprint);
nlohmann::json compileBlueprintToInstallRequest(const nlohmann::json& blueprint);

} // namespace shared
} // namespace chatv2

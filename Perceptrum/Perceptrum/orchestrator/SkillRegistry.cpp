#include "SkillRegistry.h"

#include "skills/CreateCameraSkill.h"
#include "skills/CreateCamerasBatchSkill.h"
#include "skills/CreateCameraAgentSkill.h"
#include "skills/CreateJobSkill.h"
#include "skills/ControlCameraSkill.h"
#include "skills/ControlJobSkill.h"
#include "skills/EditCameraAgentSkill.h"
#include "skills/EditCameraSkill.h"
#include "skills/EditCamerasBatchSkill.h"
#include "skills/ExplainAppSkill.h"
#include "skills/ReadStateSkill.h"
#include "skills/ScanNetworkSkill.h"
#include "skills/VideoSearchSkill.h"

namespace chatv2 {

SkillRegistry::SkillRegistry()
{
    registerSkill(std::make_unique<VideoSearchSkill>());
    registerSkill(std::make_unique<ExplainAppSkill>());
    registerSkill(std::make_unique<CreateCameraSkill>());
    registerSkill(std::make_unique<CreateCamerasBatchSkill>());
    registerSkill(std::make_unique<ControlCameraSkill>());
    registerSkill(std::make_unique<EditCameraSkill>());
    registerSkill(std::make_unique<EditCamerasBatchSkill>());
    registerSkill(std::make_unique<CreateJobSkill>());
    registerSkill(std::make_unique<ControlJobSkill>());
    registerSkill(std::make_unique<CreateCameraAgentSkill>());
    registerSkill(std::make_unique<EditCameraAgentSkill>());
    registerSkill(std::make_unique<ReadStateSkill>());
    registerSkill(std::make_unique<ScanNetworkSkill>());
}

bool SkillRegistry::hasSkill(const std::string& skillName) const
{
    return skills_.find(skillName) != skills_.end();
}

SkillRunResult SkillRegistry::execute(
    const std::string& skillName,
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection& selection) const
{
    const auto it = skills_.find(skillName);
    if (it == skills_.end() || !it->second) {
        SkillRunResult result;
        result.status = SkillExecutionStatus::Failed;
        result.skillName = skillName;
        result.error = "unknown_skill";
        result.answer =
            "chatv2 could not map this request to a registered skill. No action was executed.";
        return result;
    }

    return it->second->execute(agent, payload, selection);
}

void SkillRegistry::registerSkill(std::unique_ptr<IChatV2Skill> skill)
{
    if (!skill) return;
    const SkillDefinition definition = skill->definition();
    if (definition.name.empty()) return;
    definitions_.push_back(definition);
    skills_[definition.name] = std::move(skill);
}

} // namespace chatv2

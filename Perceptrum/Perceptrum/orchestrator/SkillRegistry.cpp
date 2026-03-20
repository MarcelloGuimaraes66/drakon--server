#include "SkillRegistry.h"

#include "skills/CreateCameraSkill.h"
#include "skills/CreateCameraAgentSkill.h"
#include "skills/CreateJobSkill.h"
#include "skills/ExplainAppSkill.h"
#include "skills/ReadStateSkill.h"
#include "skills/VideoSearchSkill.h"

namespace chatv2 {

SkillRegistry::SkillRegistry()
{
    registerSkill(std::make_unique<VideoSearchSkill>());
    registerSkill(std::make_unique<ExplainAppSkill>());
    registerSkill(std::make_unique<CreateCameraSkill>());
    registerSkill(std::make_unique<CreateJobSkill>());
    registerSkill(std::make_unique<CreateCameraAgentSkill>());
    registerSkill(std::make_unique<ReadStateSkill>());
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

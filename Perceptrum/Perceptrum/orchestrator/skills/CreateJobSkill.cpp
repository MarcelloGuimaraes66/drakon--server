#include "CreateJobSkill.h"

namespace chatv2 {

SkillDefinition CreateJobSkill::definition() const
{
    return SkillDefinition{
        "create_job",
        "Builds jobs and calls the existing backend job endpoints.",
        false,
    };
}

SkillRunResult CreateJobSkill::execute(
    AgentCore&,
    const nlohmann::json&,
    const SkillSelection&)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "create_job";
    result.answer = "I cannot create jobs directly from chat yet. No changes were applied.";
    return result;
}

} // namespace chatv2

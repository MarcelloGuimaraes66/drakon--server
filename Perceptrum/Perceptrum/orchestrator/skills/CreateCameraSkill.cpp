#include "CreateCameraSkill.h"

namespace chatv2 {

SkillDefinition CreateCameraSkill::definition() const
{
    return SkillDefinition{
        "create_camera",
        "Creates cameras using the existing backend camera endpoints.",
        false,
    };
}

SkillRunResult CreateCameraSkill::execute(
    AgentCore&,
    const nlohmann::json&,
    const SkillSelection&)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "create_camera";
    result.answer = "I cannot create cameras directly from chat yet. No changes were applied.";
    return result;
}

} // namespace chatv2

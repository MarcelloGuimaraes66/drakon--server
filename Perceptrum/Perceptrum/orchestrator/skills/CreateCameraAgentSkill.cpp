#include "CreateCameraAgentSkill.h"

namespace chatv2 {

SkillDefinition CreateCameraAgentSkill::definition() const
{
    return SkillDefinition{
        "create_camera_agent",
        "Creates agents directly on cameras using the existing backend endpoints.",
        false,
    };
}

SkillRunResult CreateCameraAgentSkill::execute(
    AgentCore&,
    const nlohmann::json&,
    const SkillSelection&)
{
    SkillRunResult result;
    result.status = SkillExecutionStatus::Completed;
    result.skillName = "create_camera_agent";
    result.answer = "I cannot create camera agents directly from chat yet. No changes were applied.";
    return result;
}

} // namespace chatv2

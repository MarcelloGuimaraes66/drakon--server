#include "VideoSearchSkill.h"

#include "../../core/AgentCore.h"

namespace chatv2 {

SkillDefinition VideoSearchSkill::definition() const
{
    return SkillDefinition{
        "video_search",
        "Calls the existing chat video/image search pipeline for one or more cameras.",
        true,
    };
}

SkillRunResult VideoSearchSkill::execute(
    AgentCore& agent,
    const nlohmann::json& payload,
    const SkillSelection&)
{
    SkillRunResult result;
    result.skillName = "video_search";

    const bool videoSearchAllowed =
        payload.is_object() ? payload.value("video_search_allowed", true) : true;
    if (!videoSearchAllowed) {
        result.status = SkillExecutionStatus::Completed;
        result.answer = payload.is_object()
            ? payload.value(
                "video_search_block_message",
                std::string("Video search is not available for this request."))
            : std::string("Video search is not available for this request.");
        return result;
    }

    agent.executeVideoSearchPipeline(payload);
    result.status = SkillExecutionStatus::Delegated;
    return result;
}

} // namespace chatv2

#pragma once

#include "../SkillTypes.h"

namespace chatv2 {

class CreateCamerasBatchSkill : public IChatV2Skill {
public:
    SkillDefinition definition() const override;
    SkillRunResult execute(
        AgentCore& agent,
        const nlohmann::json& payload,
        const SkillSelection& selection) override;
};

} // namespace chatv2

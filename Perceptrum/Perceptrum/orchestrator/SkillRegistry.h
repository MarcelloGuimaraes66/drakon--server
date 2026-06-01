#pragma once

#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "SkillTypes.h"

namespace chatv2 {

class SkillRegistry {
public:
    SkillRegistry();

    bool hasSkill(const std::string& skillName) const;
    const std::vector<SkillDefinition>& definitions() const { return definitions_; }

    SkillRunResult execute(
        const std::string& skillName,
        AgentCore& agent,
        const nlohmann::json& payload,
        const SkillSelection& selection) const;

private:
    void registerSkill(std::unique_ptr<IChatV2Skill> skill);

    std::vector<SkillDefinition> definitions_;
    std::unordered_map<std::string, std::unique_ptr<IChatV2Skill>> skills_;
};

} // namespace chatv2

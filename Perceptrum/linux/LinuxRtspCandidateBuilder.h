#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace perceptrum::linux_runtime {

std::vector<std::string> BuildLinuxRtspCandidatesFromCameraJson(
    const nlohmann::json& camera);

std::vector<std::string> SplitLinuxRtspCandidateList(const std::string& raw);

std::string MaskLinuxRtspCredentials(std::string value);

} // namespace perceptrum::linux_runtime

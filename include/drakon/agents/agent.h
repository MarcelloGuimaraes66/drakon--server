#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

namespace drakon::agents {

struct Agent {
  std::string agent_id;
  std::string name;
  std::string type;
  std::string model_provider;
  std::string model;
  std::string prompt_template_id;
  std::vector<std::string> tools_allowed;
  nlohmann::json output_schema = nlohmann::json::object();
  nlohmann::json safety_policy = nlohmann::json::object();
  bool enabled = true;
};

struct AgentParseResult {
  Agent agent;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;

  [[nodiscard]] bool ok() const { return errors.empty(); }
};

AgentParseResult parse_agent_json(const nlohmann::json& value, const std::string& context);
nlohmann::json agent_to_json(const Agent& agent);

}  // namespace drakon::agents

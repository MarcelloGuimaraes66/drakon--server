#include "drakon/agents/agent.h"

#include <string_view>

namespace drakon::agents {

namespace {

std::string string_or(const nlohmann::json& object, std::string_view key, std::string fallback = {}) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null() || !it->is_string()) {
    return fallback;
  }
  return it->get<std::string>();
}

bool bool_or(const nlohmann::json& object, std::string_view key, bool fallback) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null() || !it->is_boolean()) {
    return fallback;
  }
  return it->get<bool>();
}

std::vector<std::string> string_array_or_empty(const nlohmann::json& object, std::string_view key) {
  std::vector<std::string> out;
  const auto it = object.find(std::string(key));
  if (it == object.end() || !it->is_array()) {
    return out;
  }
  for (const auto& item : *it) {
    if (item.is_string() && !item.get<std::string>().empty()) {
      out.push_back(item.get<std::string>());
    }
  }
  return out;
}

void require_string(
    const nlohmann::json& object,
    std::string_view key,
    const std::string& context,
    std::vector<std::string>& errors) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || !it->is_string() || it->get<std::string>().empty()) {
    errors.push_back(context + "." + std::string(key) + " must be a non-empty string");
  }
}

}  // namespace

AgentParseResult parse_agent_json(const nlohmann::json& value, const std::string& context) {
  AgentParseResult result;
  if (!value.is_object()) {
    result.errors.push_back(context + " must be a JSON object");
    return result;
  }

  require_string(value, "agent_id", context, result.errors);
  require_string(value, "name", context, result.errors);
  require_string(value, "type", context, result.errors);
  require_string(value, "model_provider", context, result.errors);
  require_string(value, "model", context, result.errors);

  result.agent.agent_id = string_or(value, "agent_id");
  result.agent.name = string_or(value, "name");
  result.agent.type = string_or(value, "type");
  result.agent.model_provider = string_or(value, "model_provider");
  result.agent.model = string_or(value, "model");
  result.agent.prompt_template_id = string_or(value, "prompt_template_id");
  result.agent.tools_allowed = string_array_or_empty(value, "tools_allowed");
  result.agent.enabled = bool_or(value, "enabled", true);

  if (const auto it = value.find("output_schema"); it != value.end() && it->is_object()) {
    result.agent.output_schema = *it;
  }
  if (const auto it = value.find("safety_policy"); it != value.end() && it->is_object()) {
    result.agent.safety_policy = *it;
  }

  if (result.agent.enabled && result.agent.model_provider != "dry-run" &&
      result.agent.model_provider != "stub" && result.agent.model_provider != "disabled") {
    result.warnings.push_back(
        context + ".model_provider is configured for a real provider; dry-run will not call it");
  }

  return result;
}

nlohmann::json agent_to_json(const Agent& agent) {
  return {
      {"agent_id", agent.agent_id},
      {"name", agent.name},
      {"type", agent.type},
      {"model_provider", agent.model_provider},
      {"model", agent.model},
      {"prompt_template_id", agent.prompt_template_id},
      {"tools_allowed", agent.tools_allowed},
      {"output_schema", agent.output_schema},
      {"safety_policy", agent.safety_policy},
      {"enabled", agent.enabled},
  };
}

}  // namespace drakon::agents

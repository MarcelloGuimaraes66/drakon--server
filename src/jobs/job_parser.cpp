#include "drakon/jobs/job_parser.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <sstream>
#include <string_view>

#include "drakon/runtime/redaction.h"

namespace drakon::jobs {

namespace {

std::string read_file(const std::filesystem::path& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    return {};
  }
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

std::string lower_copy(std::string_view value) {
  std::string out(value);
  std::ranges::transform(out, out.begin(), [](unsigned char c) {
    return static_cast<char>(std::tolower(c));
  });
  return out;
}

bool is_secret_key(std::string_view key) {
  const auto lower = lower_copy(key);
  return lower == "password" || lower == "api_key" || lower == "token" ||
         lower == "secret" || lower == "webhook_secret" || lower == "dsn" ||
         lower == "connection_string";
}

bool is_placeholder_secret(std::string_view value) {
  return value.empty() || value == "***" || value == "REPLACE_ME" ||
         value == "example" || value == "disabled";
}

void validate_no_inline_secrets(
    const nlohmann::json& value,
    std::string_view key,
    std::vector<std::string>& errors) {
  if (value.is_object()) {
    for (const auto& [child_key, child_value] : value.items()) {
      validate_no_inline_secrets(child_value, child_key, errors);
    }
    return;
  }
  if (value.is_array()) {
    for (const auto& child_value : value) {
      validate_no_inline_secrets(child_value, key, errors);
    }
    return;
  }
  if (!value.is_string()) {
    return;
  }

  const auto text = value.get<std::string>();
  const auto lower_key = lower_copy(key);
  if (is_secret_key(lower_key) && !lower_key.ends_with("_ref") && !is_placeholder_secret(text)) {
    errors.push_back("inline secret-like field '" + std::string(key) +
                     "' is not allowed in job JSON; use a *_ref field");
  }
  if (runtime::contains_unmasked_rtsp_credentials(text)) {
    errors.push_back("unmasked RTSP credentials are not allowed in job JSON");
  }
}

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

int int_or(const nlohmann::json& object, std::string_view key, int fallback) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null() || !it->is_number_integer()) {
    return fallback;
  }
  return it->get<int>();
}

std::optional<std::string> optional_string(const nlohmann::json& object, std::string_view key) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null()) {
    return std::nullopt;
  }
  if (!it->is_string() || it->get<std::string>().empty()) {
    return std::nullopt;
  }
  return it->get<std::string>();
}

std::vector<std::string> string_array_or_empty(const nlohmann::json& object, std::string_view key) {
  std::vector<std::string> out;
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null()) {
    return out;
  }
  if (it->is_string() && !it->get<std::string>().empty()) {
    out.push_back(it->get<std::string>());
    return out;
  }
  if (!it->is_array()) {
    return out;
  }
  for (const auto& item : *it) {
    if (item.is_string() && !item.get<std::string>().empty()) {
      out.push_back(item.get<std::string>());
    } else if (item.is_number_integer()) {
      out.push_back(std::to_string(item.get<int>()));
    }
  }
  return out;
}

nlohmann::json object_or_empty(const nlohmann::json& object, std::string_view key) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null() || !it->is_object()) {
    return nlohmann::json::object();
  }
  return *it;
}

Trigger parse_trigger(const nlohmann::json& root) {
  Trigger trigger;
  const auto raw = object_or_empty(root, "trigger");
  trigger.raw = raw;
  trigger.type = string_or(raw, "type", "manual");
  return trigger;
}

Schedule parse_schedule(const nlohmann::json& root) {
  Schedule schedule;
  const auto raw = object_or_empty(root, "schedule");
  schedule.raw = raw;
  schedule.mode = string_or(raw, "mode", "none");
  schedule.timezone = string_or(raw, "timezone");
  return schedule;
}

Condition parse_condition(const nlohmann::json& step_json) {
  Condition condition;
  const auto it = step_json.find("condition");
  if (it == step_json.end() || it->is_null()) {
    condition.raw = {{"type", "always"}};
    return condition;
  }
  if (it->is_string()) {
    condition.type = it->get<std::string>();
    condition.raw = {{"type", condition.type}};
    return condition;
  }
  if (it->is_object()) {
    condition.raw = *it;
    condition.type = string_or(*it, "type", "always");
    condition.expression = string_or(*it, "expression");
  }
  return condition;
}

Action parse_action(const nlohmann::json& step_json) {
  Action action;
  const auto raw = object_or_empty(step_json, "action");
  action.raw = raw;
  action.type = string_or(raw, "type", "noop");
  action.params = object_or_empty(raw, "params");
  return action;
}

RetryPolicy parse_retry_policy(const nlohmann::json& step_json) {
  RetryPolicy retry;
  const auto raw = object_or_empty(step_json, "retry_policy");
  retry.raw = raw;
  retry.max_attempts = int_or(raw, "max_attempts", 0);
  retry.backoff_seconds = int_or(raw, "backoff_seconds", 0);
  return retry;
}

Step parse_step(const nlohmann::json& value) {
  Step step;
  step.step_id = string_or(value, "step_id");
  step.type = string_or(value, "type");
  step.name = string_or(value, "name");
  step.enabled = bool_or(value, "enabled", true);
  step.input = object_or_empty(value, "input");
  step.condition = parse_condition(value);
  step.action = parse_action(value);
  step.next_on_success = optional_string(value, "next_on_success");
  step.next_on_failure = optional_string(value, "next_on_failure");
  step.timeout_seconds = int_or(value, "timeout_seconds", 0);
  step.retry_policy = parse_retry_policy(value);
  step.agent_id = optional_string(value, "agent_id");
  return step;
}

void require_non_empty(std::string_view value, const std::string& field, std::vector<std::string>& errors) {
  if (value.empty()) {
    errors.push_back(field + " must be a non-empty string");
  }
}

bool contains(const std::set<std::string>& values, const std::string& needle) {
  return values.find(needle) != values.end();
}

}  // namespace

JobLoadResult load_job_file(const std::filesystem::path& path) {
  JobLoadResult result;
  result.job.source_path = path;

  std::error_code exists_ec;
  if (!std::filesystem::exists(path, exists_ec)) {
    result.errors.push_back("job file not found: " + path.string());
    return result;
  }

  const auto text = read_file(path);
  if (text.empty()) {
    result.errors.push_back("job file is empty or unreadable: " + path.string());
    return result;
  }

  nlohmann::json root;
  try {
    root = nlohmann::json::parse(text);
  } catch (const nlohmann::json::parse_error& ex) {
    result.errors.push_back("invalid JSON job: " + std::string(ex.what()));
    return result;
  }

  if (!root.is_object()) {
    result.errors.push_back("job file must be a JSON object");
    return result;
  }
  validate_no_inline_secrets(root, "", result.errors);

  result.job.schema_version = string_or(root, "schema_version", "drakon.job.v1");
  result.job.job_id = string_or(root, "job_id");
  result.job.name = string_or(root, "name");
  result.job.enabled = bool_or(root, "enabled", true);
  result.job.camera_ids = string_array_or_empty(root, "camera_ids");
  if (result.job.camera_ids.empty()) {
    result.job.camera_ids = string_array_or_empty(root, "camera_id");
  }
  result.job.trigger = parse_trigger(root);
  result.job.schedule = parse_schedule(root);
  result.job.agent_id = optional_string(root, "agent_id");
  result.job.inference_profile = object_or_empty(root, "inference_profile");
  result.job.alert_policy = object_or_empty(root, "alert_policy");
  result.job.output_policy = object_or_empty(root, "output_policy");
  result.job.created_at = string_or(root, "created_at");
  result.job.updated_at = string_or(root, "updated_at");

  const auto steps_it = root.find("steps");
  if (steps_it != root.end() && steps_it->is_array()) {
    for (const auto& item : *steps_it) {
      if (!item.is_object()) {
        result.errors.push_back("steps[] must contain JSON objects");
        continue;
      }
      result.job.steps.push_back(parse_step(item));
    }
  }

  if (const auto agents_it = root.find("agents"); agents_it != root.end() && agents_it->is_array()) {
    std::size_t index = 0;
    for (const auto& item : *agents_it) {
      auto parsed = agents::parse_agent_json(item, "agents[" + std::to_string(index) + "]");
      result.errors.insert(result.errors.end(), parsed.errors.begin(), parsed.errors.end());
      result.warnings.insert(result.warnings.end(), parsed.warnings.begin(), parsed.warnings.end());
      if (parsed.ok()) {
        result.job.agents.push_back(std::move(parsed.agent));
      }
      ++index;
    }
  }

  auto validation = validate_job(result.job);
  result.errors.insert(result.errors.end(), validation.errors.begin(), validation.errors.end());
  result.warnings.insert(result.warnings.end(), validation.warnings.begin(), validation.warnings.end());
  return result;
}

JobValidationResult validate_job(const Job& job) {
  JobValidationResult result;

  if (job.schema_version != "drakon.job.v1") {
    result.errors.push_back("schema_version must be drakon.job.v1");
  }
  require_non_empty(job.job_id, "job_id", result.errors);
  require_non_empty(job.name, "name", result.errors);
  if (job.camera_ids.empty()) {
    result.errors.push_back("camera_ids must contain at least one camera id");
  }
  if (job.steps.empty()) {
    result.errors.push_back("steps must contain at least one step");
  }

  const std::set<std::string> trigger_types = {"manual", "schedule", "webhook", "event", "frame_index"};
  if (!contains(trigger_types, job.trigger.type)) {
    result.errors.push_back("trigger.type is not supported: " + job.trigger.type);
  }

  const std::set<std::string> schedule_modes = {
      "none", "manual", "interval", "cron", "daily", "weekly", "monthly", "yearly"};
  if (!contains(schedule_modes, job.schedule.mode)) {
    result.errors.push_back("schedule.mode is not supported: " + job.schedule.mode);
  }

  std::set<std::string> step_ids;
  std::set<std::string> agent_ids;
  for (const auto& agent : job.agents) {
    if (!agent_ids.insert(agent.agent_id).second) {
      result.errors.push_back("duplicate agent_id: " + agent.agent_id);
    }
  }

  if (job.agent_id && !agent_ids.empty() && !contains(agent_ids, *job.agent_id)) {
    result.errors.push_back("job.agent_id does not reference a declared agent: " + *job.agent_id);
  }

  const std::set<std::string> condition_types = {
      "always", "manual", "previous_success", "positive", "negative", "elapsed", "time", "never"};
  const std::set<std::string> dry_run_known_actions = {
      "noop", "dry_run_note", "agent", "read_frames", "write_json", "emit_event", "emit_alert"};

  for (const auto& step : job.steps) {
    require_non_empty(step.step_id, "steps[].step_id", result.errors);
    require_non_empty(step.type, "steps[" + step.step_id + "].type", result.errors);
    require_non_empty(step.name, "steps[" + step.step_id + "].name", result.errors);
    if (!step.step_id.empty() && !step_ids.insert(step.step_id).second) {
      result.errors.push_back("duplicate step_id: " + step.step_id);
    }
    if (!contains(condition_types, step.condition.type)) {
      result.errors.push_back("step " + step.step_id + " has unsupported condition.type: " +
                              step.condition.type);
    }
    if (step.action.type.empty()) {
      result.errors.push_back("step " + step.step_id + " action.type must be non-empty");
    } else if (!contains(dry_run_known_actions, step.action.type)) {
      result.warnings.push_back("step " + step.step_id + " action.type is future/unknown for dry-run: " +
                                step.action.type);
    }
    if (step.timeout_seconds < 0) {
      result.errors.push_back("step " + step.step_id + " timeout_seconds must be >= 0");
    }
    if (step.retry_policy.max_attempts < 0 || step.retry_policy.backoff_seconds < 0) {
      result.errors.push_back("step " + step.step_id + " retry_policy values must be >= 0");
    }
    if (step.agent_id && !agent_ids.empty() && !contains(agent_ids, *step.agent_id)) {
      result.errors.push_back("step " + step.step_id + " agent_id does not reference a declared agent: " +
                              *step.agent_id);
    }
  }

  for (const auto& step : job.steps) {
    if (step.next_on_success && !contains(step_ids, *step.next_on_success)) {
      result.errors.push_back("step " + step.step_id +
                              " next_on_success does not reference a declared step: " + *step.next_on_success);
    }
    if (step.next_on_failure && !contains(step_ids, *step.next_on_failure)) {
      result.errors.push_back("step " + step.step_id +
                              " next_on_failure does not reference a declared step: " + *step.next_on_failure);
    }
  }

  if (job.alert_policy.value("mode", std::string("disabled")) != "disabled") {
    result.warnings.push_back("alert_policy is present; dry-run will not deliver alerts");
  }
  if (job.inference_profile.value("enabled", false)) {
    result.warnings.push_back("inference_profile.enabled is true; dry-run will not run inference");
  }

  result.ok = result.errors.empty();
  return result;
}

nlohmann::json job_to_json(const Job& job) {
  nlohmann::json agents_json = nlohmann::json::array();
  for (const auto& agent : job.agents) {
    agents_json.push_back(agents::agent_to_json(agent));
  }

  nlohmann::json steps_json = nlohmann::json::array();
  for (const auto& step : job.steps) {
    nlohmann::json row = {
        {"step_id", step.step_id},
        {"type", step.type},
        {"name", step.name},
        {"enabled", step.enabled},
        {"input", step.input},
        {"condition", step.condition.raw},
        {"action", step.action.raw},
        {"timeout_seconds", step.timeout_seconds},
        {"retry_policy", step.retry_policy.raw},
    };
    if (step.next_on_success) {
      row["next_on_success"] = *step.next_on_success;
    }
    if (step.next_on_failure) {
      row["next_on_failure"] = *step.next_on_failure;
    }
    if (step.agent_id) {
      row["agent_id"] = *step.agent_id;
    }
    steps_json.push_back(std::move(row));
  }

  nlohmann::json out = {
      {"schema_version", job.schema_version},
      {"job_id", job.job_id},
      {"name", job.name},
      {"enabled", job.enabled},
      {"camera_ids", job.camera_ids},
      {"trigger", job.trigger.raw},
      {"schedule", job.schedule.raw},
      {"steps", steps_json},
      {"agents", agents_json},
      {"inference_profile", job.inference_profile},
      {"alert_policy", job.alert_policy},
      {"output_policy", job.output_policy},
      {"created_at", job.created_at},
      {"updated_at", job.updated_at},
  };
  if (job.agent_id) {
    out["agent_id"] = *job.agent_id;
  }
  return out;
}

}  // namespace drakon::jobs

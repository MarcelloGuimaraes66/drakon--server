#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "drakon/agents/agent.h"

namespace drakon::jobs {

enum class RuntimeStatus {
  Pending,
  Running,
  Completed,
  Skipped,
  Failed,
  DryRun,
};

struct Trigger {
  std::string type = "manual";
  nlohmann::json raw = nlohmann::json::object();
};

struct Schedule {
  std::string mode = "none";
  std::string timezone;
  nlohmann::json raw = nlohmann::json::object();
};

struct Condition {
  std::string type = "always";
  std::string expression;
  nlohmann::json raw = nlohmann::json::object();
};

struct Action {
  std::string type = "noop";
  nlohmann::json params = nlohmann::json::object();
  nlohmann::json raw = nlohmann::json::object();
};

struct RetryPolicy {
  int max_attempts = 0;
  int backoff_seconds = 0;
  nlohmann::json raw = nlohmann::json::object();
};

struct Step {
  std::string step_id;
  std::string type;
  std::string name;
  bool enabled = true;
  nlohmann::json input = nlohmann::json::object();
  Condition condition;
  Action action;
  std::optional<std::string> next_on_success;
  std::optional<std::string> next_on_failure;
  int timeout_seconds = 0;
  RetryPolicy retry_policy;
  std::optional<std::string> agent_id;
};

struct Job {
  std::string schema_version = "drakon.job.v1";
  std::string job_id;
  std::string name;
  bool enabled = true;
  std::vector<std::string> camera_ids;
  Trigger trigger;
  Schedule schedule;
  std::vector<Step> steps;
  std::vector<agents::Agent> agents;
  std::optional<std::string> agent_id;
  nlohmann::json inference_profile = nlohmann::json::object();
  nlohmann::json alert_policy = nlohmann::json::object();
  nlohmann::json output_policy = nlohmann::json::object();
  std::string created_at;
  std::string updated_at;
  std::filesystem::path source_path;
};

std::string runtime_status_to_string(RuntimeStatus status);

}  // namespace drakon::jobs

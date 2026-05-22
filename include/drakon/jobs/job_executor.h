#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "drakon/jobs/job_types.h"

namespace drakon::jobs {

struct JobDryRunStepResult {
  std::string step_id;
  RuntimeStatus status = RuntimeStatus::Pending;
  std::string message;
};

struct JobDryRunResult {
  bool ok = false;
  std::string job_id;
  std::string run_id;
  std::filesystem::path index_path;
  std::vector<JobDryRunStepResult> steps;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;
  nlohmann::json summary = nlohmann::json::object();
};

JobDryRunResult run_job_dry_run(const Job& job, const std::filesystem::path& data_root);

}  // namespace drakon::jobs

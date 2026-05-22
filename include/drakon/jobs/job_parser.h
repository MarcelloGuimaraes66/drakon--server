#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "drakon/jobs/job_types.h"

namespace drakon::jobs {

struct JobLoadResult {
  Job job;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;

  [[nodiscard]] bool ok() const { return errors.empty(); }
};

struct JobValidationResult {
  bool ok = false;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;
};

JobLoadResult load_job_file(const std::filesystem::path& path);
JobValidationResult validate_job(const Job& job);
nlohmann::json job_to_json(const Job& job);

}  // namespace drakon::jobs

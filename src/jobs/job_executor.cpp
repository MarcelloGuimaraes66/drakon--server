#include "drakon/jobs/job_executor.h"

#include <chrono>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>

#include "drakon/jobs/job_parser.h"

namespace drakon::jobs {

namespace {

std::string utc_now_iso() {
  const auto now = std::chrono::system_clock::now();
  const auto millis =
      std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
  const std::time_t seconds = static_cast<std::time_t>(millis / 1000);
  const int ms = static_cast<int>(millis % 1000);

  std::tm tm_utc{};
  gmtime_r(&seconds, &tm_utc);

  std::ostringstream out;
  out << std::put_time(&tm_utc, "%Y-%m-%dT%H:%M:%S") << "." << std::setw(3)
      << std::setfill('0') << ms << "Z";
  return out.str();
}

std::string compact_utc_now() {
  const auto now = std::chrono::system_clock::now();
  const auto millis =
      std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
  const std::time_t seconds = static_cast<std::time_t>(millis / 1000);
  const int ms = static_cast<int>(millis % 1000);

  std::tm tm_utc{};
  gmtime_r(&seconds, &tm_utc);

  std::ostringstream out;
  out << std::put_time(&tm_utc, "%Y%m%dT%H%M%S") << std::setw(3) << std::setfill('0')
      << ms << "Z";
  return out.str();
}

std::string dry_run_step_message(const Step& step) {
  if (!step.enabled) {
    return "step disabled; skipped";
  }
  if (step.condition.type == "never") {
    return "condition=never; skipped";
  }
  if (step.action.type == "agent") {
    return "agent action simulated; no LLM call executed";
  }
  if (step.action.type == "emit_alert") {
    return "alert action simulated; no delivery executed";
  }
  if (step.action.type == "read_frames") {
    return "frame read action simulated; no camera capture started";
  }
  return "action simulated: " + step.action.type;
}

bool append_jsonl(const std::filesystem::path& path, const nlohmann::json& line, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create jobs index directory: " + ec.message();
    return false;
  }

  std::ofstream out(path, std::ios::binary | std::ios::app);
  if (!out) {
    error = "failed to open jobs index";
    return false;
  }
  out << line.dump() << '\n';
  if (!out) {
    error = "failed to append jobs index";
    return false;
  }
  return true;
}

nlohmann::json make_index_record(
    const Job& job,
    const JobDryRunResult& run,
    const std::string& timestamp_utc) {
  nlohmann::json steps = nlohmann::json::array();
  int completed = 0;
  int skipped = 0;
  int failed = 0;
  for (const auto& step : run.steps) {
    const auto status = runtime_status_to_string(step.status);
    if (step.status == RuntimeStatus::Completed) {
      ++completed;
    } else if (step.status == RuntimeStatus::Skipped) {
      ++skipped;
    } else if (step.status == RuntimeStatus::Failed) {
      ++failed;
    }
    steps.push_back({
        {"step_id", step.step_id},
        {"status", status},
        {"message", step.message},
    });
  }

  nlohmann::json agents = nlohmann::json::array();
  for (const auto& agent : job.agents) {
    agents.push_back({
        {"agent_id", agent.agent_id},
        {"enabled", agent.enabled},
        {"model_provider", agent.model_provider},
        {"model", agent.model},
    });
  }

  return {
      {"schema_version", "drakon.jobs.v1"},
      {"record_type", "job_run"},
      {"job_id", job.job_id},
      {"job_name", job.name},
      {"run_id", run.run_id},
      {"timestamp_utc", timestamp_utc},
      {"dry_run", true},
      {"runtime_status", run.ok ? "completed" : "failed"},
      {"enabled", job.enabled},
      {"trigger_type", job.trigger.type},
      {"schedule_mode", job.schedule.mode},
      {"camera_ids", job.camera_ids},
      {"steps_total", run.steps.size()},
      {"steps_completed", completed},
      {"steps_skipped", skipped},
      {"steps_failed", failed},
      {"steps", steps},
      {"agents", agents},
  };
}

}  // namespace

JobDryRunResult run_job_dry_run(const Job& job, const std::filesystem::path& data_root) {
  JobDryRunResult result;
  result.job_id = job.job_id;
  result.run_id = "jobrun_" + job.job_id + "_" + compact_utc_now();
  result.index_path = data_root / "indexes" / "jobs.jsonl";

  const auto validation = validate_job(job);
  result.warnings.insert(result.warnings.end(), validation.warnings.begin(), validation.warnings.end());
  if (!validation.ok) {
    result.errors.insert(result.errors.end(), validation.errors.begin(), validation.errors.end());
    return result;
  }

  if (!job.enabled) {
    result.warnings.push_back("job is disabled; dry-run only validates and records skipped state");
  }

  for (const auto& step : job.steps) {
    JobDryRunStepResult step_result;
    step_result.step_id = step.step_id;
    if (!job.enabled || !step.enabled || step.condition.type == "never") {
      step_result.status = RuntimeStatus::Skipped;
    } else {
      step_result.status = RuntimeStatus::Completed;
    }
    step_result.message = dry_run_step_message(step);
    result.steps.push_back(std::move(step_result));
  }

  const auto timestamp = utc_now_iso();
  result.ok = result.errors.empty();
  result.summary = {
      {"job_id", result.job_id},
      {"run_id", result.run_id},
      {"timestamp_utc", timestamp},
      {"dry_run", true},
      {"runtime_status", result.ok ? "completed" : "failed"},
      {"steps", result.steps.size()},
      {"index_path", result.index_path.generic_string()},
  };

  std::string error;
  if (!append_jsonl(result.index_path, make_index_record(job, result, timestamp), error)) {
    result.ok = false;
    result.errors.push_back(error);
  }

  return result;
}

}  // namespace drakon::jobs

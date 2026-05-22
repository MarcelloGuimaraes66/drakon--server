#include "drakon/jobs/job_types.h"

namespace drakon::jobs {

std::string runtime_status_to_string(RuntimeStatus status) {
  switch (status) {
    case RuntimeStatus::Pending:
      return "pending";
    case RuntimeStatus::Running:
      return "running";
    case RuntimeStatus::Completed:
      return "completed";
    case RuntimeStatus::Skipped:
      return "skipped";
    case RuntimeStatus::Failed:
      return "failed";
    case RuntimeStatus::DryRun:
      return "dry_run";
  }
  return "unknown";
}

}  // namespace drakon::jobs

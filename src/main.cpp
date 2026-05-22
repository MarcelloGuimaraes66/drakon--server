#include <chrono>
#include <csignal>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#include "drakon/alerts/alerts.h"
#include "drakon/camera/capture.h"
#include "drakon/config/config_loader.h"
#include "drakon/database/database.h"
#include "drakon/frame_store/frame_store.h"
#include "drakon/inference/inference.h"
#include "drakon/jobs/job_executor.h"
#include "drakon/jobs/job_parser.h"
#include "drakon/runtime/redaction.h"
#include "drakon/runtime/runtime_paths.h"
#include "drakon/runtime/version.h"

namespace {

using drakon::config::ConfigLoadResult;

volatile std::sig_atomic_t g_stop_requested = 0;

void handle_stop_signal(int) {
  g_stop_requested = 1;
}

std::filesystem::path default_config_path() {
  return std::filesystem::current_path() / "config" / "drakon-server.example.json";
}

void print_help() {
  std::cout
      << "drakon-server " << drakon::runtime::kVersion << "\n"
      << "\n"
      << "CLI/headless scaffold for camera capture, JSON contracts and dashboard indexes.\n"
      << "\n"
      << "Usage:\n"
      << "  drakon-server --help\n"
      << "  drakon-server version\n"
      << "  drakon-server validate-config --config <path>\n"
      << "  drakon-server prepare-runtime --config <path>\n"
      << "  drakon-server check-deps\n"
      << "  drakon-server status [--config <path>]\n"
      << "  drakon-server db-init --config <path>\n"
      << "  drakon-server db-status --config <path>\n"
      << "  drakon-server list-cameras --config <path>\n"
      << "  drakon-server capture-test --config <path> --camera-id <id> --seconds <n> [--dry-run]\n"
      << "  drakon-server index-frames --config <path>\n"
      << "  drakon-server validate-job --job <path>\n"
      << "  drakon-server run-job --job <path> --dry-run [--config <path>]\n"
      << "  drakon-server infer-frame --config <path> --frame <path>\n"
      << "  drakon-server infer-batch --config <path> --frames-index <path>\n"
      << "  drakon-server generate-alerts --config <path>\n"
      << "  drakon-server send-webhooks --config <path> --dry-run\n"
      << "  drakon-server serve-api --config <path> --port <port>\n"
      << "  drakon-server run --config <path> [--once]\n"
      << "\n"
      << "Capture supports dry-run/test sources, webcam and RTSP/file through OpenCV/FFmpeg.\n"
      << "Frame metadata is indexed to data/indexes/frames.jsonl for dashboard reads.\n"
      << "Inference supports explicit mock mode; external providers are not called in this phase.\n";
}

std::optional<std::string> option_value(const std::vector<std::string>& args, std::string_view name) {
  for (std::size_t i = 0; i + 1 < args.size(); ++i) {
    if (args[i] == name) {
      return args[i + 1];
    }
  }
  return std::nullopt;
}

bool has_flag(const std::vector<std::string>& args, std::string_view name) {
  for (const auto& arg : args) {
    if (arg == name) {
      return true;
    }
  }
  return false;
}

int option_int(const std::vector<std::string>& args, std::string_view name, int fallback) {
  const auto value = option_value(args, name);
  if (!value) {
    return fallback;
  }
  try {
    return std::stoi(*value);
  } catch (...) {
    return fallback;
  }
}

void print_load_result(const ConfigLoadResult& loaded) {
  for (const auto& warning : loaded.warnings) {
    std::cout << "warning: " << warning << "\n";
  }
  for (const auto& error : loaded.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
}

void print_job_messages(const std::vector<std::string>& warnings, const std::vector<std::string>& errors) {
  for (const auto& warning : warnings) {
    std::cout << "warning: " << warning << "\n";
  }
  for (const auto& error : errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
}

std::filesystem::path infer_project_root_from_job_path(const std::filesystem::path& job_path) {
  const auto abs = std::filesystem::absolute(job_path).lexically_normal();
  const auto parent = abs.parent_path();
  if (parent.filename() == "jobs" && parent.parent_path().filename() == "config") {
    return parent.parent_path().parent_path();
  }
  return std::filesystem::current_path();
}

int validate_config_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: validate-config requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  std::cout << "config: valid\n";
  std::cout << "schema_version: " << loaded.config.schema_version << "\n";
  std::cout << "instance_id: " << loaded.config.runtime.instance_id << "\n";
  std::cout << "database_type: " << loaded.config.database.type << "\n";
  if (!loaded.config.database.path.empty()) {
    std::cout << "database_path: " << loaded.config.database.path.string() << "\n";
  }
  std::cout << "capture_profiles: " << loaded.config.capture.profiles.size() << "\n";
  std::cout << "cameras: " << loaded.config.camera_count << "\n";
  return 0;
}

int prepare_runtime_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: prepare-runtime requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  try {
    const auto paths = drakon::runtime::make_runtime_paths(loaded.config);
    drakon::runtime::prepare_runtime_directories(paths);
    std::cout << "runtime: prepared\n";
    for (const auto& dir : drakon::runtime::required_runtime_directories(paths)) {
      std::cout << "dir: " << dir.string() << "\n";
    }
    std::cout << "log: " << paths.log_file.string() << "\n";
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "error: failed to prepare runtime: "
              << drakon::runtime::redact_secret_like_values(ex.what()) << "\n";
    return 1;
  }
}

std::optional<std::filesystem::path> find_on_path(const std::string& executable) {
  const char* path_env = std::getenv("PATH");
  if (path_env == nullptr) {
    return std::nullopt;
  }

  std::string path_value(path_env);
  std::size_t start = 0;
  while (start <= path_value.size()) {
    const auto end = path_value.find(':', start);
    const auto part = path_value.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (!part.empty()) {
      const auto candidate = std::filesystem::path(part) / executable;
      std::error_code ec;
      if (std::filesystem::exists(candidate, ec) && !std::filesystem::is_directory(candidate, ec)) {
        return candidate;
      }
    }
    if (end == std::string::npos) {
      break;
    }
    start = end + 1;
  }

  return std::nullopt;
}

void print_dep(const std::string& name, bool required) {
  const auto found = find_on_path(name);
  std::cout << name << ": ";
  if (found) {
    std::cout << "found (" << found->string() << ")\n";
  } else {
    std::cout << "missing";
    if (!required) {
      std::cout << " (optional)";
    }
    std::cout << "\n";
  }
}

int check_deps_command() {
  std::cout << "Dependency check for scaffold phase\n";
  print_dep("ffmpeg", true);
  print_dep("ffprobe", true);
  print_dep("node", false);
  if (find_on_path("python3")) {
    print_dep("python3", false);
  } else {
    print_dep("python", false);
  }
  std::cout << "ffmpeg_link: " << drakon::camera::ffmpeg_version_summary() << "\n";
  std::cout << "inference: mock provider requires no external dependency\n";
  return 0;
}

int status_command(const std::vector<std::string>& args) {
  const auto config_path = option_value(args, "--config").value_or(default_config_path().string());
  const auto loaded = drakon::config::load_config(config_path);

  std::cout << "project: " << drakon::runtime::kProjectName << "\n";
  std::cout << "version: " << drakon::runtime::kVersion << "\n";
  std::cout << "config: " << config_path << "\n";

  print_load_result(loaded);
  if (!loaded.ok()) {
    std::cout << "status: config-invalid\n";
    return 2;
  }

  const auto paths = drakon::runtime::make_runtime_paths(loaded.config);
  std::cout << "status: scaffold-ready\n";
  std::cout << "data_dir: " << paths.data_dir.string() << "\n";
  std::cout << "runtime_dir: " << paths.runtime_dir.string() << "\n";
  std::cout << "logs_dir: " << paths.logs_dir.string() << "\n";
  std::cout << "capture: available\n";
  std::cout << "rtsp: available-via-opencv-ffmpeg\n";
  std::cout << "inference: " << loaded.config.inference.provider << "\n";
  std::cout << "database: " << loaded.config.database.type << "\n";
  return 0;
}

int db_init_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: db-init requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::database::initialize_database(loaded.config);
  for (const auto& message : result.messages) {
    std::cout << message << "\n";
  }
  for (const auto& error : result.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
  if (!result.ok) {
    return 1;
  }

  std::cout << "database: initialized\n";
  std::cout << "type: " << loaded.config.database.type << "\n";
  std::cout << "path: " << loaded.config.database.path.string() << "\n";
  return 0;
}

int db_status_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: db-status requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto status = drakon::database::inspect_database(loaded.config);
  std::cout << "database_type: " << status.type << "\n";
  if (!status.path.empty()) {
    std::cout << "database_path: " << status.path.string() << "\n";
  }
  std::cout << "connected: " << (status.connected ? "yes" : "no") << "\n";
  std::cout << "initialized: " << (status.initialized ? "yes" : "no") << "\n";
  for (const auto& table : status.tables) {
    std::cout << "table: " << table.name << " exists=" << (table.exists ? "yes" : "no")
              << " rows=" << table.row_count << "\n";
  }
  for (const auto& error : status.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }

  return status.errors.empty() && status.initialized ? 0 : 1;
}

int list_cameras_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: list-cameras requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  std::vector<std::string> errors;
  const auto cameras = drakon::database::list_cameras(loaded.config, errors);
  for (const auto& error : errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
  if (!errors.empty()) {
    return 1;
  }

  std::cout << "cameras: " << cameras.size() << "\n";
  for (const auto& camera : cameras) {
    std::cout << camera.camera_id << "\t" << camera.name << "\t"
              << (camera.enabled ? "enabled" : "disabled") << "\t" << camera.source_type
              << "\t" << camera.status << "\n";
  }
  return 0;
}

int capture_test_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  const auto camera_id = option_value(args, "--camera-id");
  if (!config_arg && !has_flag(args, "--dry-run")) {
    std::cerr << "error: capture-test requires --config <path>\n";
    return 2;
  }
  if (!camera_id) {
    std::cerr << "error: capture-test requires --camera-id <id>\n";
    return 2;
  }

  drakon::camera::CaptureTestOptions options;
  options.config_path = config_arg.value_or(default_config_path().string());
  options.camera_id = *camera_id;
  options.seconds = option_int(args, "--seconds", 5);
  options.dry_run = has_flag(args, "--dry-run");

  const auto loaded = drakon::config::load_config(options.config_path);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::camera::run_capture_test(loaded.config, options);
  for (const auto& message : result.messages) {
    std::cout << message << "\n";
  }
  for (const auto& error : result.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }

  if (!result.ok) {
    return 1;
  }

  std::cout << "capture: ok\n";
  std::cout << "camera_id: " << result.camera_id << "\n";
  std::cout << "capture_session_id: " << result.capture_session_id << "\n";
  std::cout << "frames_saved: " << result.frames_saved << "\n";
  return 0;
}

int index_frames_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: index-frames requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::frame_store::rebuild_frame_index(loaded.config.runtime.data_root);
  for (const auto& warning : result.warnings) {
    std::cout << "warning: " << warning << "\n";
  }
  for (const auto& error : result.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
  if (!result.ok) {
    return 1;
  }

  std::cout << "frames_index: rebuilt\n";
  std::cout << "path: " << result.index_path.string() << "\n";
  std::cout << "records_written: " << result.records_written << "\n";
  return 0;
}

int validate_job_command(const std::vector<std::string>& args) {
  const auto job_arg = option_value(args, "--job");
  if (!job_arg) {
    std::cerr << "error: validate-job requires --job <path>\n";
    return 2;
  }

  const auto loaded = drakon::jobs::load_job_file(*job_arg);
  print_job_messages(loaded.warnings, loaded.errors);
  if (!loaded.ok()) {
    return 2;
  }

  std::cout << "job: valid\n";
  std::cout << "job_id: " << loaded.job.job_id << "\n";
  std::cout << "name: " << loaded.job.name << "\n";
  std::cout << "enabled: " << (loaded.job.enabled ? "yes" : "no") << "\n";
  std::cout << "trigger_type: " << loaded.job.trigger.type << "\n";
  std::cout << "schedule_mode: " << loaded.job.schedule.mode << "\n";
  std::cout << "cameras: " << loaded.job.camera_ids.size() << "\n";
  std::cout << "steps: " << loaded.job.steps.size() << "\n";
  std::cout << "agents: " << loaded.job.agents.size() << "\n";
  return 0;
}

int run_job_command(const std::vector<std::string>& args) {
  const auto job_arg = option_value(args, "--job");
  if (!job_arg) {
    std::cerr << "error: run-job requires --job <path>\n";
    return 2;
  }
  if (!has_flag(args, "--dry-run")) {
    std::cerr << "error: real job execution is not implemented; use --dry-run\n";
    return 2;
  }

  const auto loaded_job = drakon::jobs::load_job_file(*job_arg);
  print_job_messages(loaded_job.warnings, loaded_job.errors);
  if (!loaded_job.ok()) {
    return 2;
  }

  auto data_root = infer_project_root_from_job_path(*job_arg) / "data";
  if (const auto config_arg = option_value(args, "--config")) {
    const auto loaded_config = drakon::config::load_config(*config_arg);
    print_load_result(loaded_config);
    if (!loaded_config.ok()) {
      return 2;
    }
    data_root = loaded_config.config.runtime.data_root;
  }

  const auto result = drakon::jobs::run_job_dry_run(loaded_job.job, data_root);
  print_job_messages(result.warnings, result.errors);
  if (!result.ok) {
    return 1;
  }

  std::cout << "job_run: dry-run-ok\n";
  std::cout << "job_id: " << result.job_id << "\n";
  std::cout << "run_id: " << result.run_id << "\n";
  std::cout << "index_path: " << result.index_path.string() << "\n";
  for (const auto& step : result.steps) {
    std::cout << "step: " << step.step_id << " status="
              << drakon::jobs::runtime_status_to_string(step.status)
              << " message=" << step.message << "\n";
  }
  return 0;
}

int infer_frame_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  const auto frame_arg = option_value(args, "--frame");
  if (!config_arg) {
    std::cerr << "error: infer-frame requires --config <path>\n";
    return 2;
  }
  if (!frame_arg) {
    std::cerr << "error: infer-frame requires --frame <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::inference::infer_frame(loaded.config, *frame_arg);
  if (!result.ok) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(result.error) << "\n";
    if (!result.result_path.empty()) {
      std::cerr << "result_path: " << result.result_path.string() << "\n";
    }
    return 1;
  }

  std::cout << "inference: " << result.status << "\n";
  std::cout << "inference_id: " << result.inference_id << "\n";
  std::cout << "frame_id: " << result.frame_id << "\n";
  std::cout << "camera_id: " << result.camera_id << "\n";
  std::cout << "result_path: " << result.result_path.string() << "\n";
  std::cout << "index_path: " << result.index_path.string() << "\n";
  return 0;
}

int infer_batch_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  const auto frames_index_arg = option_value(args, "--frames-index");
  if (!config_arg) {
    std::cerr << "error: infer-batch requires --config <path>\n";
    return 2;
  }
  if (!frames_index_arg) {
    std::cerr << "error: infer-batch requires --frames-index <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::inference::infer_batch(loaded.config, *frames_index_arg);
  for (const auto& error : result.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
  if (!result.ok) {
    return 1;
  }

  std::cout << "inference_batch: ok\n";
  std::cout << "processed: " << result.processed << "\n";
  std::cout << "failed: " << result.failed << "\n";
  const auto index_path = loaded.config.runtime.data_root / "indexes" / "inference.jsonl";
  std::cout << "index_path: " << index_path.string() << "\n";
  return 0;
}

int generate_alerts_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: generate-alerts requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::alerts::generate_alerts_from_inference(loaded.config);
  for (const auto& warning : result.warnings) {
    std::cout << "warning: " << warning << "\n";
  }
  for (const auto& error : result.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
  if (!result.ok) {
    return 1;
  }

  std::cout << "alerts: generated\n";
  std::cout << "inferences_read: " << result.inferences_read << "\n";
  std::cout << "events_written: " << result.events_written << "\n";
  std::cout << "alerts_written: " << result.alerts_written << "\n";
  std::cout << "events_index_records: " << result.events_index_records << "\n";
  std::cout << "alerts_index_records: " << result.alerts_index_records << "\n";
  std::cout << "alerts_index: " << (loaded.config.runtime.data_root / "indexes" / "alerts.jsonl").string()
            << "\n";
  std::cout << "events_index: " << (loaded.config.runtime.data_root / "indexes" / "events.jsonl").string()
            << "\n";
  return 0;
}

int send_webhooks_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: send-webhooks requires --config <path>\n";
    return 2;
  }
  if (!has_flag(args, "--dry-run")) {
    std::cerr << "error: real webhook delivery is not implemented in this phase; use --dry-run\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const auto result = drakon::alerts::send_webhooks_dry_run(loaded.config);
  for (const auto& warning : result.warnings) {
    std::cout << "warning: " << warning << "\n";
  }
  for (const auto& error : result.errors) {
    std::cerr << "error: " << drakon::runtime::redact_secret_like_values(error) << "\n";
  }
  if (!result.ok) {
    return 1;
  }

  std::cout << "webhooks: dry-run-ok\n";
  std::cout << "alerts_read: " << result.alerts_read << "\n";
  std::cout << "enabled_webhooks: " << result.enabled_webhooks << "\n";
  std::cout << "simulated_deliveries: " << result.simulated_deliveries << "\n";
  std::cout << "real_delivery: disabled\n";
  return 0;
}

int serve_api_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: serve-api requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  const int port = option_int(args, "--port", 8077);
  std::cout << "api: planned\n";
  std::cout << "port: " << port << "\n";
  std::cout << "socket_opened: no\n";
  std::cout << "reason: local HTTP server is documented but not implemented in this phase\n";
  std::cout << "planned_endpoint: GET /health\n";
  std::cout << "planned_endpoint: GET /status\n";
  std::cout << "planned_endpoint: GET /dashboard/indexes\n";
  std::cout << "planned_endpoint: GET /alerts\n";
  std::cout << "planned_endpoint: GET /events\n";
  std::cout << "planned_endpoint: GET /frames\n";
  return 0;
}

int run_command(const std::vector<std::string>& args) {
  const auto config_arg = option_value(args, "--config");
  if (!config_arg) {
    std::cerr << "error: run requires --config <path>\n";
    return 2;
  }

  const auto loaded = drakon::config::load_config(*config_arg);
  print_load_result(loaded);
  if (!loaded.ok()) {
    return 2;
  }

  try {
    const auto paths = drakon::runtime::make_runtime_paths(loaded.config);
    drakon::runtime::prepare_runtime_directories(paths);

    std::cout << "service: starting\n";
    std::cout << "config: " << *config_arg << "\n";
    std::cout << "instance_id: " << loaded.config.runtime.instance_id << "\n";
    std::cout << "data_dir: " << paths.data_dir.string() << "\n";
    std::cout << "logs_dir: " << paths.logs_dir.string() << "\n";
    std::cout << "database: " << loaded.config.database.type << "\n";
    std::cout << "capture: " << (loaded.config.capture.enabled ? "enabled" : "disabled") << "\n";
    std::cout << "inference: " << loaded.config.inference.provider << "\n";
    std::cout << "alerts: " << (loaded.config.alerts.enabled ? "enabled" : "disabled") << "\n";

    if (has_flag(args, "--once")) {
      std::cout << "service: ready-once\n";
      return 0;
    }

    g_stop_requested = 0;
    std::signal(SIGTERM, handle_stop_signal);
    std::signal(SIGINT, handle_stop_signal);

    std::cout << "service: ready\n";
    while (g_stop_requested == 0) {
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
    std::cout << "service: stopping\n";
    return 0;
  } catch (const std::exception& ex) {
    std::cerr << "error: service failed: "
              << drakon::runtime::redact_secret_like_values(ex.what()) << "\n";
    return 1;
  }
}

}  // namespace

int main(int argc, char** argv) {
  std::vector<std::string> args;
  args.reserve(static_cast<std::size_t>(argc));
  for (int i = 0; i < argc; ++i) {
    args.emplace_back(argv[i]);
  }

  if (args.size() <= 1 || args[1] == "--help" || args[1] == "help") {
    print_help();
    return 0;
  }

  const std::string command = args[1];
  if (command == "version" || command == "--version") {
    std::cout << drakon::runtime::kProjectName << " " << drakon::runtime::kVersion << "\n";
    return 0;
  }
  if (command == "validate-config") {
    return validate_config_command(args);
  }
  if (command == "prepare-runtime") {
    return prepare_runtime_command(args);
  }
  if (command == "check-deps") {
    return check_deps_command();
  }
  if (command == "status") {
    return status_command(args);
  }
  if (command == "db-init") {
    return db_init_command(args);
  }
  if (command == "db-status") {
    return db_status_command(args);
  }
  if (command == "list-cameras") {
    return list_cameras_command(args);
  }
  if (command == "capture-test") {
    return capture_test_command(args);
  }
  if (command == "index-frames") {
    return index_frames_command(args);
  }
  if (command == "validate-job") {
    return validate_job_command(args);
  }
  if (command == "run-job") {
    return run_job_command(args);
  }
  if (command == "infer-frame") {
    return infer_frame_command(args);
  }
  if (command == "infer-batch") {
    return infer_batch_command(args);
  }
  if (command == "generate-alerts") {
    return generate_alerts_command(args);
  }
  if (command == "send-webhooks") {
    return send_webhooks_command(args);
  }
  if (command == "serve-api") {
    return serve_api_command(args);
  }
  if (command == "run") {
    return run_command(args);
  }

  std::cerr << "error: unknown command: " << command << "\n";
  std::cerr << "run 'drakon-server --help' for usage\n";
  return 2;
}

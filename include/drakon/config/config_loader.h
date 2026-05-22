#pragma once

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace drakon::config {

struct CaptureProfileConfig {
  std::string profile_id;
  double fps = 0.0;
  bool enabled = false;
  std::string image_format;
  int quality = 0;
};

struct CameraConfig {
  std::string camera_id;
  std::string name;
  bool enabled = false;
  std::string source_type;
  std::optional<std::string> rtsp_url;
  std::optional<std::string> device_path;
  std::optional<std::string> source_path;
  std::optional<std::string> credentials_ref;
  int webcam_index = -1;
  std::string description;
  std::vector<std::string> fps_profiles;
  std::string location_json;
  std::string analysis_profile_json;
  std::string metadata_json;
  std::string created_at;
  std::string updated_at;
};

struct RuntimeConfig {
  std::string instance_id;
  std::filesystem::path project_root;
  std::filesystem::path config_path;
  std::filesystem::path data_root;
  std::filesystem::path runtime_root;
  std::filesystem::path config_root;
  std::filesystem::path log_root;
  std::string timezone;

  // Backward-compatible aliases used by Prompt 3 code paths.
  std::filesystem::path data_dir;
  std::filesystem::path runtime_dir;
  std::filesystem::path config_dir;
  std::filesystem::path log_dir;
};

struct DatabaseConfig {
  std::string type;
  std::filesystem::path path;
  std::optional<std::string> connection_string_ref;
};

struct CaptureConfig {
  bool enabled = false;
  std::vector<CaptureProfileConfig> profiles;
};

struct InferenceConfig {
  bool enabled = false;
  std::string provider;
  std::string model;
  std::string api_key_ref;
  std::string prompt_id;
  std::string prompt_version;
  std::string prompt_template;
  bool allow_raw_response = false;
};

struct AlertWebhookConfig {
  std::string webhook_id;
  std::string name;
  bool enabled = false;
  std::string url_ref;
  std::string secret_ref;
};

struct AlertsConfig {
  bool enabled = false;
  int dedupe_window_seconds = 0;
  std::vector<std::string> channels;
  std::vector<AlertWebhookConfig> webhooks;
};

struct DrakonConfig {
  std::string schema_version;
  RuntimeConfig runtime;
  DatabaseConfig database;
  CaptureConfig capture;
  InferenceConfig inference;
  AlertsConfig alerts;
  std::vector<CameraConfig> cameras;
  std::string database_mode;
  bool capture_enabled = false;
  bool inference_enabled = false;
  bool alerts_enabled = false;
  std::size_t camera_count = 0;
};

struct ConfigLoadResult {
  DrakonConfig config;
  std::vector<std::string> errors;
  std::vector<std::string> warnings;

  [[nodiscard]] bool ok() const { return errors.empty(); }
};

ConfigLoadResult load_config(const std::filesystem::path& path);

}  // namespace drakon::config

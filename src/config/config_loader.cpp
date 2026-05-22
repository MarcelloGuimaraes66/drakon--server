#include "drakon/config/config_loader.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <set>
#include <sstream>
#include <string_view>

#include <nlohmann/json.hpp>

#include "drakon/runtime/redaction.h"

namespace drakon::config {

namespace {

using json = nlohmann::json;

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

std::filesystem::path infer_project_root(const std::filesystem::path& config_path) {
  auto abs = std::filesystem::absolute(config_path).lexically_normal();
  auto parent = abs.parent_path();
  if (parent.filename() == "config") {
    return parent.parent_path();
  }
  return parent;
}

std::filesystem::path resolve_path(const std::filesystem::path& root, const std::string& value) {
  std::filesystem::path path = value;
  if (path.is_absolute()) {
    return path.lexically_normal();
  }
  return (root / path).lexically_normal();
}

bool is_within_or_equal(const std::filesystem::path& root, const std::filesystem::path& child) {
  const auto root_abs = std::filesystem::absolute(root).lexically_normal();
  const auto child_abs = std::filesystem::absolute(child).lexically_normal();

  auto root_it = root_abs.begin();
  auto child_it = child_abs.begin();
  for (; root_it != root_abs.end(); ++root_it, ++child_it) {
    if (child_it == child_abs.end() || *root_it != *child_it) {
      return false;
    }
  }
  return true;
}

bool is_allowed_system_runtime_root(const std::filesystem::path& child) {
  static const std::filesystem::path allowed_roots[] = {
      "/etc/drakon-server",
      "/var/lib/drakon-server",
      "/var/log/drakon-server",
      "/run/drakon-server",
  };

  for (const auto& root : allowed_roots) {
    if (is_within_or_equal(root, child)) {
      return true;
    }
  }
  return false;
}

bool is_allowed_runtime_path(const std::filesystem::path& project_root,
                             const std::filesystem::path& child) {
  return is_within_or_equal(project_root, child) || is_allowed_system_runtime_root(child);
}

std::optional<std::string> optional_string(const json& object, std::string_view key) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null()) {
    return std::nullopt;
  }
  if (!it->is_string()) {
    return std::nullopt;
  }
  return it->get<std::string>();
}

std::string string_or(const json& object, std::string_view key, std::string fallback = {}) {
  return optional_string(object, key).value_or(std::move(fallback));
}

bool bool_or(const json& object, std::string_view key, bool fallback = false) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null()) {
    return fallback;
  }
  if (!it->is_boolean()) {
    return fallback;
  }
  return it->get<bool>();
}

std::string json_dump_or_empty(const json& object, std::string_view key) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || it->is_null()) {
    return "{}";
  }
  return it->dump();
}

std::vector<std::string> string_array_from_json(const json& value) {
  std::vector<std::string> out;
  if (!value.is_array()) {
    return out;
  }
  for (const auto& item : value) {
    if (item.is_string() && !item.get<std::string>().empty()) {
      out.push_back(item.get<std::string>());
    }
  }
  return out;
}

bool is_valid_database_type(std::string_view type) {
  return type == "sqlite" || type == "postgres" || type == "disabled";
}

bool is_valid_source_type(std::string_view source_type) {
  return source_type == "rtsp" || source_type == "webcam" || source_type == "file" ||
         source_type == "test";
}

bool is_secret_key(std::string_view key) {
  const std::string lower = lower_copy(key);
  return lower == "password" || lower == "api_key" || lower == "token" ||
         lower == "bot_token" || lower == "telegram_bot_token" ||
         lower == "model_api_key" || lower == "validator_model_api_key" ||
         lower == "webhook_secret" || lower == "dsn" || lower == "connection_string";
}

bool is_placeholder_secret(std::string_view value) {
  return value.empty() || value == "***" || value == "REPLACE_ME" || value == "example" ||
         value == "disabled";
}

void validate_no_inline_secrets(
    const json& value,
    std::string_view key,
    bool allow_inline,
    std::vector<std::string>& errors) {
  if (value.is_object()) {
    for (const auto& [child_key, child_value] : value.items()) {
      validate_no_inline_secrets(child_value, child_key, allow_inline, errors);
    }
    return;
  }

  if (!value.is_string()) {
    return;
  }

  const std::string string_value = value.get<std::string>();
  const std::string lower_key = lower_copy(key);
  if (!allow_inline && is_secret_key(lower_key) && !lower_key.ends_with("_ref") &&
      !is_placeholder_secret(string_value)) {
    errors.push_back("inline secret-like field '" + std::string(key) +
                     "' is not allowed; use a *_ref field instead");
  }

  if (runtime::contains_unmasked_rtsp_credentials(string_value)) {
    errors.push_back("unmasked RTSP credentials are not allowed in config JSON");
  }
}

void require_object(const json& root, std::string_view key, std::vector<std::string>& errors) {
  const auto it = root.find(std::string(key));
  if (it == root.end()) {
    errors.push_back("missing required config key: " + std::string(key));
    return;
  }
  if (!it->is_object()) {
    errors.push_back(std::string(key) + " must be a JSON object");
  }
}

void require_array(const json& root, std::string_view key, std::vector<std::string>& errors) {
  const auto it = root.find(std::string(key));
  if (it == root.end()) {
    errors.push_back("missing required config key: " + std::string(key));
    return;
  }
  if (!it->is_array()) {
    errors.push_back(std::string(key) + " must be a JSON array");
  }
}

std::optional<json> object_at(const json& root, std::string_view key) {
  const auto it = root.find(std::string(key));
  if (it == root.end() || !it->is_object()) {
    return std::nullopt;
  }
  return std::optional<json>{*it};
}

std::optional<json> array_at(const json& root, std::string_view key) {
  const auto it = root.find(std::string(key));
  if (it == root.end() || !it->is_array()) {
    return std::nullopt;
  }
  return std::optional<json>{*it};
}

void validate_required_string(
    const json& object,
    std::string_view key,
    std::string_view context,
    std::vector<std::string>& errors) {
  const auto it = object.find(std::string(key));
  if (it == object.end() || !it->is_string() || it->get<std::string>().empty()) {
    errors.push_back(std::string(context) + "." + std::string(key) +
                     " must be a non-empty string");
  }
}

}  // namespace

ConfigLoadResult load_config(const std::filesystem::path& path) {
  ConfigLoadResult result;
  result.config.runtime.config_path = std::filesystem::absolute(path).lexically_normal();

  std::error_code exists_ec;
  if (!std::filesystem::exists(path, exists_ec)) {
    result.errors.push_back("config file not found: " + path.string());
    return result;
  }

  const std::string text = read_file(path);
  if (text.empty()) {
    result.errors.push_back("config file is empty or unreadable: " + path.string());
    return result;
  }

  json root;
  try {
    root = json::parse(text);
  } catch (const json::parse_error& ex) {
    result.errors.push_back("invalid JSON config: " + std::string(ex.what()));
    return result;
  }

  if (!root.is_object()) {
    result.errors.push_back("config must be a JSON object");
    return result;
  }

  require_object(root, "runtime", result.errors);
  require_object(root, "database", result.errors);
  require_object(root, "capture", result.errors);
  require_object(root, "inference", result.errors);
  require_object(root, "alerts", result.errors);
  require_array(root, "cameras", result.errors);

  result.config.schema_version = string_or(root, "schema_version");
  if (result.config.schema_version != "drakon.v1") {
    result.errors.push_back("schema_version must be drakon.v1");
  }

  const bool allow_inline =
      object_at(root, "security").has_value()
          ? bool_or(*object_at(root, "security"), "allow_inline_secrets", false)
          : false;
  validate_no_inline_secrets(root, "", allow_inline, result.errors);

  const auto runtime_object = object_at(root, "runtime");
  const auto database_object = object_at(root, "database");
  const auto capture_object = object_at(root, "capture");
  const auto inference_object = object_at(root, "inference");
  const auto alerts_object = object_at(root, "alerts");
  const auto cameras_array = array_at(root, "cameras");

  if (!runtime_object || !database_object || !capture_object || !inference_object ||
      !alerts_object || !cameras_array) {
    return result;
  }

  auto& runtime = result.config.runtime;
  runtime.project_root = infer_project_root(path);
  runtime.instance_id = string_or(*runtime_object, "instance_id", "drakon-local");
  runtime.timezone = string_or(*runtime_object, "timezone", "UTC");

  const auto data_root_value = optional_string(*runtime_object, "data_root")
                                   .or_else([&]() { return optional_string(*runtime_object, "data_dir"); });
  const auto log_root_value = optional_string(*runtime_object, "log_root")
                                  .or_else([&]() { return optional_string(*runtime_object, "log_dir"); });
  const auto runtime_root_value =
      optional_string(*runtime_object, "runtime_root")
          .or_else([&]() { return optional_string(*runtime_object, "runtime_dir"); })
          .value_or("runtime");
  const auto config_root_value =
      optional_string(*runtime_object, "config_root")
          .or_else([&]() { return optional_string(*runtime_object, "config_dir"); })
          .value_or("config");

  if (!data_root_value || data_root_value->empty()) {
    result.errors.push_back("runtime.data_root must be a non-empty path");
  }
  if (!log_root_value || log_root_value->empty()) {
    result.errors.push_back("runtime.log_root must be a non-empty path");
  }

  runtime.data_root = resolve_path(runtime.project_root, data_root_value.value_or("data"));
  runtime.log_root = resolve_path(runtime.project_root, log_root_value.value_or("data/logs"));
  runtime.runtime_root = resolve_path(runtime.project_root, runtime_root_value);
  runtime.config_root = resolve_path(runtime.project_root, config_root_value);

  runtime.data_dir = runtime.data_root;
  runtime.log_dir = runtime.log_root;
  runtime.runtime_dir = runtime.runtime_root;
  runtime.config_dir = runtime.config_root;

  for (const auto& checked_path :
       {runtime.data_root, runtime.runtime_root, runtime.config_root, runtime.log_root}) {
    if (!is_allowed_runtime_path(runtime.project_root, checked_path)) {
      result.errors.push_back("runtime path is outside project root and allowed system roots: " +
                              checked_path.string());
    }
  }

  auto& db = result.config.database;
  db.type = string_or(*database_object, "type", string_or(*database_object, "mode", "disabled"));
  if (!is_valid_database_type(db.type)) {
    result.errors.push_back("database.type must be sqlite, postgres or disabled");
  }

  const auto database_path = optional_string(*database_object, "path").or_else([&]() {
    if (const auto sqlite_object = object_at(*database_object, "sqlite")) {
      return optional_string(*sqlite_object, "path");
    }
    return std::optional<std::string>{};
  });

  if (db.type == "sqlite") {
    if (!database_path || database_path->empty()) {
      result.errors.push_back("database.path is required when database.type is sqlite");
    } else {
      db.path = resolve_path(runtime.project_root, *database_path);
      if (!is_allowed_runtime_path(runtime.project_root, db.path)) {
        result.errors.push_back("database.path is outside project root and allowed system roots: " +
                                db.path.string());
      }
    }
  }

  if (db.type == "postgres") {
    db.connection_string_ref =
        optional_string(*database_object, "connection_string_ref")
            .or_else([&]() { return optional_string(*database_object, "dsn_ref"); });
    if (!db.connection_string_ref || db.connection_string_ref->empty()) {
      result.errors.push_back(
          "database.connection_string_ref is required when database.type is postgres");
    }
  }

  result.config.database_mode = db.type;

  auto& capture = result.config.capture;
  capture.enabled = bool_or(*capture_object, "enabled", false);
  const auto profiles_it = capture_object->find("profiles");
  if (profiles_it == capture_object->end() || !profiles_it->is_array() || profiles_it->empty()) {
    result.errors.push_back("capture.profiles must be a non-empty array");
  } else {
    std::set<std::string> seen_profiles;
    for (std::size_t i = 0; i < profiles_it->size(); ++i) {
      const auto& item = (*profiles_it)[i];
      const std::string context = "capture.profiles[" + std::to_string(i) + "]";
      if (!item.is_object()) {
        result.errors.push_back(context + " must be a JSON object");
        continue;
      }

      CaptureProfileConfig profile;
      profile.profile_id = string_or(item, "profile_id");
      profile.fps = item.value("fps", 0.0);
      profile.enabled = bool_or(item, "enabled", false);
      profile.image_format = string_or(item, "image_format", "jpg");
      profile.quality = item.value("quality", 90);

      if (profile.profile_id.empty()) {
        result.errors.push_back(context + ".profile_id must be non-empty");
      } else if (!seen_profiles.insert(profile.profile_id).second) {
        result.errors.push_back("duplicate capture profile: " + profile.profile_id);
      }
      if (profile.fps <= 0.0) {
        result.errors.push_back(context + ".fps must be greater than zero");
      }
      if (profile.quality < 1 || profile.quality > 100) {
        result.errors.push_back(context + ".quality must be between 1 and 100");
      }

      capture.profiles.push_back(std::move(profile));
    }
  }

  result.config.capture_enabled = capture.enabled;
  auto& inference = result.config.inference;
  inference.enabled = bool_or(*inference_object, "enabled", false);
  inference.provider = string_or(*inference_object, "provider",
                                 string_or(*inference_object, "default_provider", "disabled"));
  inference.model = string_or(*inference_object, "model", "mock-frame-analyzer");
  inference.api_key_ref = string_or(*inference_object, "api_key_ref");
  inference.prompt_id = string_or(*inference_object, "prompt_id", "default_frame_analysis");
  inference.prompt_version = string_or(*inference_object, "prompt_version", "v1");
  inference.prompt_template = string_or(
      *inference_object,
      "prompt_template",
      "Return structured JSON for this frame. Do not infer beyond visible evidence.");
  inference.allow_raw_response = bool_or(*inference_object, "allow_raw_response", false);

  if (inference.enabled) {
    if (inference.provider.empty() || inference.provider == "disabled") {
      result.errors.push_back("inference.provider must be configured when inference.enabled is true");
    }
    if (inference.model.empty()) {
      result.errors.push_back("inference.model must be configured when inference.enabled is true");
    }
    if (inference.provider != "mock" && inference.api_key_ref.empty()) {
      result.warnings.push_back(
          "inference provider is not mock; infer-frame will require an explicit api_key_ref");
    }
  }

  result.config.inference_enabled = inference.enabled;
  auto& alerts = result.config.alerts;
  alerts.enabled = bool_or(*alerts_object, "enabled", false);
  alerts.dedupe_window_seconds = alerts_object->value("dedupe_window_seconds", 0);
  if (const auto channels_it = alerts_object->find("channels");
      channels_it != alerts_object->end() && channels_it->is_array()) {
    alerts.channels = string_array_from_json(*channels_it);
  }
  if (const auto webhooks_it = alerts_object->find("webhooks");
      webhooks_it != alerts_object->end() && webhooks_it->is_array()) {
    for (std::size_t i = 0; i < webhooks_it->size(); ++i) {
      const auto& item = (*webhooks_it)[i];
      const std::string context = "alerts.webhooks[" + std::to_string(i) + "]";
      if (!item.is_object()) {
        result.errors.push_back(context + " must be a JSON object");
        continue;
      }
      AlertWebhookConfig webhook;
      webhook.webhook_id = string_or(item, "webhook_id", string_or(item, "id"));
      webhook.name = string_or(item, "name", webhook.webhook_id);
      webhook.enabled = bool_or(item, "enabled", false);
      webhook.url_ref = string_or(item, "url_ref");
      webhook.secret_ref = string_or(item, "secret_ref",
                                     string_or(item, "webhook_secret_ref"));
      if (webhook.enabled) {
        if (webhook.webhook_id.empty()) {
          result.errors.push_back(context + ".webhook_id must be non-empty when enabled");
        }
        if (webhook.url_ref.empty()) {
          result.errors.push_back(context + ".url_ref must be configured; inline webhook URLs are not allowed");
        }
      }
      alerts.webhooks.push_back(std::move(webhook));
    }
  }

  result.config.alerts_enabled = alerts.enabled;

  std::set<std::string> known_profiles;
  for (const auto& profile : capture.profiles) {
    known_profiles.insert(profile.profile_id);
  }

  std::set<std::string> seen_cameras;
  for (std::size_t i = 0; i < cameras_array->size(); ++i) {
    const auto& item = (*cameras_array)[i];
    const std::string context = "cameras[" + std::to_string(i) + "]";
    if (!item.is_object()) {
      result.errors.push_back(context + " must be a JSON object");
      continue;
    }

    validate_required_string(item, "camera_id", context, result.errors);
    validate_required_string(item, "name", context, result.errors);
    validate_required_string(item, "source_type", context, result.errors);

    CameraConfig camera;
    camera.camera_id = string_or(item, "camera_id");
    camera.name = string_or(item, "name");
    camera.enabled = bool_or(item, "enabled", false);
    camera.source_type = string_or(item, "source_type");
    camera.rtsp_url = optional_string(item, "rtsp_url");
    camera.device_path = optional_string(item, "device_path");
    camera.source_path = optional_string(item, "source_path");
    camera.credentials_ref = optional_string(item, "credentials_ref");
    camera.webcam_index = item.value("webcam_index", -1);
    camera.description = string_or(item, "description");
    camera.location_json = json_dump_or_empty(item, "location");
    camera.analysis_profile_json = json_dump_or_empty(item, "analysis_profile");
    camera.metadata_json = json_dump_or_empty(item, "metadata");
    camera.created_at = string_or(item, "created_at");
    camera.updated_at = string_or(item, "updated_at");

    if (!camera.camera_id.empty() && !seen_cameras.insert(camera.camera_id).second) {
      result.errors.push_back("duplicate camera_id: " + camera.camera_id);
    }
    if (!is_valid_source_type(camera.source_type)) {
      result.errors.push_back(context + ".source_type must be rtsp, webcam, file or test");
    }

    const auto fps_profiles_it = item.find("fps_profiles");
    if (fps_profiles_it == item.end() || !fps_profiles_it->is_array() ||
        fps_profiles_it->empty()) {
      result.errors.push_back(context + ".fps_profiles must be a non-empty array");
    } else {
      for (const auto& profile_ref : *fps_profiles_it) {
        if (!profile_ref.is_string() || profile_ref.get<std::string>().empty()) {
          result.errors.push_back(context + ".fps_profiles entries must be non-empty strings");
          continue;
        }
        const auto profile_id = profile_ref.get<std::string>();
        camera.fps_profiles.push_back(profile_id);
        if (!known_profiles.empty() && !known_profiles.contains(profile_id)) {
          result.errors.push_back(context + " references unknown capture profile: " + profile_id);
        }
      }
    }

    if (camera.source_type == "rtsp" && !camera.rtsp_url && !camera.credentials_ref) {
      result.errors.push_back(context + " source_type rtsp requires rtsp_url or credentials_ref");
    }
    if (camera.source_type == "webcam" && !camera.device_path && camera.webcam_index < 0) {
      result.errors.push_back(context + " source_type webcam requires device_path or webcam_index");
    }
    if (camera.source_type == "file" && !camera.source_path && !camera.device_path) {
      result.errors.push_back(context + " source_type file requires source_path or device_path");
    }

    result.config.cameras.push_back(std::move(camera));
  }

  result.config.camera_count = result.config.cameras.size();
  if (result.config.camera_count == 0) {
    result.warnings.push_back("config has no cameras enabled yet");
  }
  if (result.config.database.type == "postgres") {
    result.warnings.push_back("postgres config is parsed, but postgres connection is not implemented yet");
  }

  return result;
}

}  // namespace drakon::config

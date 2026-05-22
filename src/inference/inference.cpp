#include "drakon/inference/inference.h"

#include <algorithm>
#include <cctype>
#include <chrono>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>

#include "drakon/frame_store/frame_store.h"
#include "drakon/runtime/redaction.h"

namespace drakon::inference {

namespace {

struct FrameRecord {
  std::string frame_id;
  std::string camera_id;
  std::string timestamp_utc;
  std::string timestamp_local;
  std::string fps_profile;
  std::string image_path;
  std::string metadata_path;
  int width = 0;
  int height = 0;
  std::string source;
  std::string checksum;
};

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

std::string compact_timestamp_from_iso(std::string value) {
  value.erase(std::remove_if(value.begin(), value.end(), [](unsigned char c) {
                return c == '-' || c == ':' || c == '.';
              }),
              value.end());
  return frame_store::sanitize_path_part(value.empty() ? utc_now_iso() : value);
}

std::filesystem::path resolve_existing_path(
    const config::DrakonConfig& config,
    const std::filesystem::path& path) {
  std::error_code ec;
  if (std::filesystem::exists(path, ec)) {
    return std::filesystem::absolute(path).lexically_normal();
  }
  if (path.is_relative()) {
    const auto project_candidate = (config.runtime.project_root / path).lexically_normal();
    if (std::filesystem::exists(project_candidate, ec)) {
      return std::filesystem::absolute(project_candidate).lexically_normal();
    }
    const auto data_candidate = (config.runtime.data_root / path).lexically_normal();
    if (std::filesystem::exists(data_candidate, ec)) {
      return std::filesystem::absolute(data_candidate).lexically_normal();
    }
  }
  return std::filesystem::absolute(path).lexically_normal();
}

std::optional<nlohmann::json> read_json_file(const std::filesystem::path& path, std::string& error) {
  std::ifstream in(path, std::ios::binary);
  if (!in) {
    error = "failed to open JSON file: " + path.string();
    return std::nullopt;
  }
  try {
    return nlohmann::json::parse(in);
  } catch (const std::exception& ex) {
    error = "invalid JSON file " + path.string() + ": " + ex.what();
    return std::nullopt;
  }
}

std::string relative_to_data_root(
    const config::DrakonConfig& config,
    const std::filesystem::path& absolute_path) {
  std::error_code ec;
  auto rel = std::filesystem::relative(absolute_path, config.runtime.data_root, ec);
  if (!ec && !rel.empty() && rel.native().rfind("..", 0) != 0) {
    return rel.generic_string();
  }
  return absolute_path.lexically_normal().generic_string();
}

FrameRecord frame_record_from_json(const nlohmann::json& metadata) {
  FrameRecord record;
  record.frame_id = metadata.value("frame_id", "");
  record.camera_id = metadata.value("camera_id", "");
  record.timestamp_utc = metadata.value("timestamp_utc", "");
  record.timestamp_local = metadata.value("timestamp_local", "");
  record.fps_profile = metadata.value("fps_profile", "");
  record.image_path = metadata.value("image_path", "");
  record.metadata_path = metadata.value("metadata_path", "");
  record.width = metadata.value("width", 0);
  record.height = metadata.value("height", 0);
  record.source = metadata.value("source", metadata.value("source_uri_masked", ""));
  record.checksum = metadata.value("checksum", "");
  return record;
}

std::optional<FrameRecord> load_frame_record_from_path(
    const config::DrakonConfig& config,
    const std::filesystem::path& frame_path,
    std::string& error) {
  const auto resolved = resolve_existing_path(config, frame_path);
  std::error_code ec;
  if (!std::filesystem::exists(resolved, ec)) {
    error = "frame path not found: " + frame_path.string();
    return std::nullopt;
  }

  if (resolved.extension() == ".json") {
    auto metadata = read_json_file(resolved, error);
    if (!metadata) {
      return std::nullopt;
    }
    auto record = frame_record_from_json(*metadata);
    if (record.metadata_path.empty()) {
      record.metadata_path = relative_to_data_root(config, resolved);
    }
    return record;
  }

  auto same_stem = resolved;
  same_stem.replace_extension(".json");
  if (std::filesystem::exists(same_stem, ec)) {
    auto metadata = read_json_file(same_stem, error);
    if (!metadata) {
      return std::nullopt;
    }
    return frame_record_from_json(*metadata);
  }

  const std::string image_relative = relative_to_data_root(config, resolved);
  for (const auto& entry : std::filesystem::directory_iterator(resolved.parent_path(), ec)) {
    if (ec) {
      break;
    }
    if (!entry.is_regular_file(ec) || entry.path().extension() != ".json") {
      continue;
    }
    std::string candidate_error;
    auto metadata = read_json_file(entry.path(), candidate_error);
    if (!metadata) {
      continue;
    }
    auto record = frame_record_from_json(*metadata);
    if (record.image_path == image_relative || record.image_path == resolved.generic_string()) {
      return record;
    }
  }

  error = "frame metadata sidecar was not found for: " + frame_path.string();
  return std::nullopt;
}

std::filesystem::path inference_relative_path(const FrameRecord& frame, const std::string& inference_id) {
  std::string timestamp = frame.timestamp_utc.empty() ? utc_now_iso() : frame.timestamp_utc;
  const std::string year = timestamp.size() >= 4 ? timestamp.substr(0, 4) : "unknown";
  const std::string month = timestamp.size() >= 7 ? timestamp.substr(5, 2) : "00";
  const std::string day = timestamp.size() >= 10 ? timestamp.substr(8, 2) : "00";
  const std::string hour = timestamp.size() >= 13 ? timestamp.substr(11, 2) : "00";

  return std::filesystem::path("inference") /
         frame_store::sanitize_path_part(frame.camera_id) /
         year / month / day / hour / (inference_id + ".json");
}

bool write_text_atomic(const std::filesystem::path& path, const std::string& text, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create inference directory: " + ec.message();
    return false;
  }

  auto tmp = path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp inference result";
      return false;
    }
    out << text;
    if (!out) {
      error = "failed to write temp inference result";
      return false;
    }
  }

  std::filesystem::rename(tmp, path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish inference result: " + ec.message();
    return false;
  }
  return true;
}

bool append_jsonl(const std::filesystem::path& path, const nlohmann::json& line, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create inference index directory: " + ec.message();
    return false;
  }

  std::ofstream out(path, std::ios::binary | std::ios::app);
  if (!out) {
    error = "failed to open inference index";
    return false;
  }
  out << line.dump() << '\n';
  if (!out) {
    error = "failed to append inference index";
    return false;
  }
  return true;
}

nlohmann::json index_line_from_result(
    const nlohmann::json& result,
    const std::string& result_path_relative) {
  return {
      {"schema_version", "drakon.inference.v1"},
      {"record_type", "inference"},
      {"inference_id", result.value("inference_id", "")},
      {"frame_id", result.value("frame_id", "")},
      {"camera_id", result.value("camera_id", "")},
      {"timestamp", result.value("timestamp", "")},
      {"model_provider", result.value("model_provider", "")},
      {"model", result.value("model", "")},
      {"mock", result.value("mock", false)},
      {"risk_score", result.value("risk_score", 0.0)},
      {"status", result.value("status", "")},
      {"error", result.value("error", nlohmann::json(nullptr))},
      {"result_path", result_path_relative},
  };
}

std::string functional_provider_error(const config::InferenceConfig& inference) {
  if (!inference.enabled) {
    return "inference is disabled; set inference.enabled=true and inference.provider=mock for mock mode";
  }
  if (inference.provider.empty() || inference.provider == "disabled") {
    return "inference.provider is not configured; set inference.provider=mock for mock mode";
  }
  if (inference.provider != "mock") {
    if (inference.api_key_ref.empty()) {
      return "inference provider '" + inference.provider +
             "' requires explicit api_key_ref; no external API call was attempted";
    }
    return "inference provider '" + inference.provider +
           "' is not implemented in this phase; no external API call was attempted";
  }
  if (inference.model.empty()) {
    return "inference.model is required for provider=mock";
  }
  return {};
}

InferenceRunResult write_inference_result(
    const config::DrakonConfig& config,
    const FrameRecord& frame,
    nlohmann::json result_json) {
  InferenceRunResult result;
  result.inference_id = result_json.value("inference_id", "");
  result.frame_id = frame.frame_id;
  result.camera_id = frame.camera_id;
  result.status = result_json.value("status", "");
  result.result_json = result_json;
  result.index_path = config.runtime.data_root / "indexes" / "inference.jsonl";

  const auto relative_path = inference_relative_path(frame, result.inference_id);
  result.result_path = config.runtime.data_root / relative_path;

  std::string error;
  if (!write_text_atomic(result.result_path, result_json.dump(2), error)) {
    result.error = error;
    return result;
  }
  if (!append_jsonl(result.index_path, index_line_from_result(result_json, relative_path.generic_string()), error)) {
    result.error = error;
    return result;
  }

  result.ok = result.status == "mock" || result.status == "completed";
  if (!result.ok) {
    result.error = result_json.value("error", nlohmann::json::object()).dump();
  }
  return result;
}

}  // namespace

InferenceRunResult infer_frame(
    const config::DrakonConfig& config,
    const std::filesystem::path& frame_path) {
  InferenceRunResult result;

  std::string error;
  const auto frame = load_frame_record_from_path(config, frame_path, error);
  if (!frame) {
    result.error = error;
    result.status = "error";
    return result;
  }
  result.frame_id = frame->frame_id;
  result.camera_id = frame->camera_id;

  const std::string inference_id =
      "inf_" + frame_store::sanitize_path_part(frame->camera_id) + "_" +
      frame_store::sanitize_path_part(frame->frame_id.empty()
                                          ? compact_timestamp_from_iso(frame->timestamp_utc)
                                          : frame->frame_id);
  const auto timestamp = utc_now_iso();
  const auto provider_error = functional_provider_error(config.inference);

  nlohmann::json prompt = {
      {"prompt_id", config.inference.prompt_id},
      {"prompt_version", config.inference.prompt_version},
      {"template", config.inference.prompt_template},
  };

  nlohmann::json result_json = {
      {"schema_version", "drakon.inference.v1"},
      {"inference_id", inference_id},
      {"frame_id", frame->frame_id},
      {"camera_id", frame->camera_id},
      {"timestamp", timestamp},
      {"timestamp_utc", timestamp},
      {"frame_timestamp_utc", frame->timestamp_utc},
      {"model_provider", config.inference.provider},
      {"model", config.inference.model},
      {"prompt", prompt},
      {"objects", nlohmann::json::array()},
      {"events", nlohmann::json::array()},
      {"risk_score", 0.0},
      {"alert_candidates", nlohmann::json::array()},
      {"raw_response_path", nullptr},
      {"mock", config.inference.provider == "mock"},
      {"frame", {
          {"image_path", frame->image_path},
          {"metadata_path", frame->metadata_path},
          {"width", frame->width},
          {"height", frame->height},
          {"fps_profile", frame->fps_profile},
          {"source", runtime::redact_secret_like_values(frame->source)},
          {"checksum", frame->checksum},
      }},
      {"status", provider_error.empty() ? "mock" : "error"},
      {"error", provider_error.empty()
                    ? nlohmann::json(nullptr)
                    : nlohmann::json{{"code", "provider_not_available"}, {"message", provider_error}}},
  };

  return write_inference_result(config, *frame, std::move(result_json));
}

InferenceBatchResult infer_batch(
    const config::DrakonConfig& config,
    const std::filesystem::path& frames_index_path) {
  InferenceBatchResult batch;
  const auto resolved_index = resolve_existing_path(config, frames_index_path);
  std::ifstream in(resolved_index, std::ios::binary);
  if (!in) {
    batch.errors.push_back("frames index not found or unreadable: " + frames_index_path.string());
    return batch;
  }

  std::string line;
  int line_number = 0;
  while (std::getline(in, line)) {
    ++line_number;
    if (line.empty()) {
      continue;
    }
    nlohmann::json row;
    try {
      row = nlohmann::json::parse(line);
    } catch (const std::exception& ex) {
      ++batch.failed;
      batch.errors.push_back("invalid frames index JSONL line " + std::to_string(line_number) +
                             ": " + ex.what());
      continue;
    }

    const auto metadata_path = row.value("metadata_path", std::string());
    const auto image_path = row.value("image_path", std::string());
    const std::filesystem::path input_path = !metadata_path.empty() ? metadata_path : image_path;
    if (input_path.empty()) {
      ++batch.failed;
      batch.errors.push_back("frames index line " + std::to_string(line_number) +
                             " has no metadata_path or image_path");
      continue;
    }

    auto result = infer_frame(config, input_path);
    if (result.ok) {
      ++batch.processed;
    } else {
      ++batch.failed;
      batch.errors.push_back("frame " + input_path.string() + ": " + result.error);
    }
    batch.results.push_back(std::move(result));
  }

  batch.ok = batch.failed == 0 && batch.processed > 0;
  if (batch.processed == 0 && batch.failed == 0) {
    batch.errors.push_back("frames index is empty: " + frames_index_path.string());
  }
  return batch;
}

}  // namespace drakon::inference

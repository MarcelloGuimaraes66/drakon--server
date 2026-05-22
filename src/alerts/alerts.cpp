#include "drakon/alerts/alerts.h"

#include <algorithm>
#include <fstream>
#include <optional>
#include <set>
#include <sstream>

#include "drakon/events/events.h"
#include "drakon/frame_store/frame_store.h"
#include "drakon/runtime/redaction.h"

namespace drakon::alerts {

namespace {

std::string timestamp_or_nowish(const nlohmann::json& value) {
  return value.value("timestamp", value.value("timestamp_utc", std::string("unknown")));
}

std::filesystem::path dated_relative_path(
    const std::string& root_name,
    const std::string& id,
    const std::string& timestamp) {
  const std::string year = timestamp.size() >= 4 ? timestamp.substr(0, 4) : "unknown";
  const std::string month = timestamp.size() >= 7 ? timestamp.substr(5, 2) : "00";
  const std::string day = timestamp.size() >= 10 ? timestamp.substr(8, 2) : "00";
  return std::filesystem::path(root_name) / year / month / day /
         (frame_store::sanitize_path_part(id) + ".json");
}

std::filesystem::path resolve_existing_path(
    const config::DrakonConfig& config,
    const std::filesystem::path& path) {
  std::error_code ec;
  if (std::filesystem::exists(path, ec)) {
    return std::filesystem::absolute(path).lexically_normal();
  }
  if (path.is_relative()) {
    const auto data_candidate = (config.runtime.data_root / path).lexically_normal();
    if (std::filesystem::exists(data_candidate, ec)) {
      return std::filesystem::absolute(data_candidate).lexically_normal();
    }
    const auto project_candidate = (config.runtime.project_root / path).lexically_normal();
    if (std::filesystem::exists(project_candidate, ec)) {
      return std::filesystem::absolute(project_candidate).lexically_normal();
    }
  }
  return std::filesystem::absolute(path).lexically_normal();
}

std::string relative_to_data_root(
    const std::filesystem::path& data_root,
    const std::filesystem::path& absolute_path) {
  std::error_code ec;
  auto rel = std::filesystem::relative(absolute_path, data_root, ec);
  if (!ec && !rel.empty() && rel.native().rfind("..", 0) != 0) {
    return rel.generic_string();
  }
  return absolute_path.lexically_normal().generic_string();
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

bool write_text_atomic(const std::filesystem::path& path, const std::string& text, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create alert directory: " + ec.message();
    return false;
  }

  auto tmp = path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp alert file";
      return false;
    }
    out << text;
    if (!out) {
      error = "failed to write temp alert file";
      return false;
    }
  }

  std::filesystem::rename(tmp, path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish alert file: " + ec.message();
    return false;
  }
  return true;
}

std::string severity_from_risk(double risk_score) {
  if (risk_score >= 0.9) {
    return "critical";
  }
  if (risk_score >= 0.7) {
    return "high";
  }
  if (risk_score >= 0.4) {
    return "medium";
  }
  return "low";
}

std::string string_or(const nlohmann::json& object, const std::string& key, std::string fallback) {
  const auto it = object.find(key);
  if (it == object.end() || it->is_null() || !it->is_string()) {
    return fallback;
  }
  return it->get<std::string>();
}

nlohmann::json string_array_ref(std::string value) {
  nlohmann::json refs = nlohmann::json::array();
  if (!value.empty()) {
    refs.push_back(std::move(value));
  }
  return refs;
}

nlohmann::json make_event_from_inference_candidate(
    const nlohmann::json& inference,
    const nlohmann::json& candidate,
    const std::string& event_id,
    const std::string& alert_id) {
  const auto timestamp = inference.value("timestamp", inference.value("timestamp_utc", std::string("")));
  return {
      {"schema_version", "drakon.events.v1"},
      {"event_id", event_id},
      {"camera_id", inference.value("camera_id", "")},
      {"source", "inference"},
      {"event_type", string_or(candidate, "event_type", string_or(candidate, "type", "alert_candidate"))},
      {"timestamp", timestamp},
      {"timestamp_utc", timestamp},
      {"frame_refs", string_array_ref(inference.value("frame_id", ""))},
      {"inference_refs", string_array_ref(inference.value("inference_id", ""))},
      {"alert_refs", string_array_ref(alert_id)},
      {"status", "open"},
      {"metadata", {
          {"candidate", candidate},
          {"mock", inference.value("mock", false)},
      }},
  };
}

nlohmann::json make_event_from_inference_event(
    const nlohmann::json& inference,
    const nlohmann::json& detected_event,
    const std::string& event_id) {
  const auto timestamp = inference.value("timestamp", inference.value("timestamp_utc", std::string("")));
  return {
      {"schema_version", "drakon.events.v1"},
      {"event_id", event_id},
      {"camera_id", inference.value("camera_id", "")},
      {"source", "inference"},
      {"event_type", string_or(detected_event, "event_type", string_or(detected_event, "type", "inference_event"))},
      {"timestamp", timestamp},
      {"timestamp_utc", timestamp},
      {"frame_refs", string_array_ref(inference.value("frame_id", ""))},
      {"inference_refs", string_array_ref(inference.value("inference_id", ""))},
      {"alert_refs", nlohmann::json::array()},
      {"status", "observed"},
      {"metadata", detected_event},
  };
}

nlohmann::json make_alert_from_candidate(
    const nlohmann::json& inference,
    const nlohmann::json& candidate,
    const std::string& alert_id,
    const std::string& event_id) {
  const auto timestamp = inference.value("timestamp", inference.value("timestamp_utc", std::string("")));
  const double risk_score = candidate.value("risk_score", inference.value("risk_score", 0.0));
  return {
      {"schema_version", "drakon.alerts.v1"},
      {"alert_id", alert_id},
      {"event_id", event_id},
      {"camera_id", inference.value("camera_id", "")},
      {"job_id", inference.value("job_id", "")},
      {"severity", string_or(candidate, "severity", severity_from_risk(risk_score))},
      {"type", string_or(candidate, "type", string_or(candidate, "event_type", "inference_alert"))},
      {"title", string_or(candidate, "title", "Inference alert candidate")},
      {"description", string_or(candidate, "description", "Generated from structured inference alert_candidates.")},
      {"timestamp", timestamp},
      {"timestamp_utc", timestamp},
      {"frame_refs", string_array_ref(inference.value("frame_id", ""))},
      {"inference_refs", string_array_ref(inference.value("inference_id", ""))},
      {"recommended_action", string_or(candidate, "recommended_action", "Review the frame and inference result.")},
      {"delivery_status", {
          {"state", "pending"},
          {"targets", nlohmann::json::array()},
          {"last_attempt_at", nullptr},
          {"error", nullptr},
      }},
      {"acknowledged", false},
      {"metadata", {
          {"candidate", candidate},
          {"risk_score", risk_score},
          {"mock", inference.value("mock", false)},
      }},
  };
}

bool write_alert(const config::DrakonConfig& config, const nlohmann::json& alert, std::string& error) {
  const auto alert_id = alert.value("alert_id", "");
  if (alert_id.empty()) {
    error = "alert_id is required";
    return false;
  }
  const auto relative_path = dated_relative_path("alerts", alert_id, timestamp_or_nowish(alert));
  return write_text_atomic(config.runtime.data_root / relative_path, alert.dump(2), error);
}

std::vector<nlohmann::json> load_inference_results(
    const config::DrakonConfig& config,
    GenerateAlertsResult& result) {
  std::vector<nlohmann::json> out;
  const auto index_path = config.runtime.data_root / "indexes" / "inference.jsonl";
  std::ifstream in(index_path, std::ios::binary);
  if (!in) {
    result.errors.push_back("inference index not found: " + index_path.string());
    return out;
  }

  std::set<std::string> seen_paths;
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
      result.warnings.push_back("skipped invalid inference index line " + std::to_string(line_number) +
                                ": " + ex.what());
      continue;
    }
    const auto result_path = row.value("result_path", std::string());
    if (result_path.empty() || !seen_paths.insert(result_path).second) {
      continue;
    }
    std::string error;
    auto inference = read_json_file(resolve_existing_path(config, result_path), error);
    if (!inference) {
      result.warnings.push_back(error);
      continue;
    }
    out.push_back(std::move(*inference));
  }
  result.inferences_read = static_cast<int>(out.size());
  return out;
}

struct IndexedAlert {
  std::string timestamp;
  std::string alert_id;
  nlohmann::json line;
};

}  // namespace

nlohmann::json make_alert_index_line(
    const nlohmann::json& alert,
    const std::string& alert_path_relative) {
  return {
      {"schema_version", "drakon.alerts.v1"},
      {"record_type", "alert"},
      {"alert_id", alert.value("alert_id", "")},
      {"event_id", alert.value("event_id", "")},
      {"camera_id", alert.value("camera_id", "")},
      {"job_id", alert.value("job_id", "")},
      {"severity", alert.value("severity", "")},
      {"type", alert.value("type", "")},
      {"title", alert.value("title", "")},
      {"description", alert.value("description", "")},
      {"timestamp", alert.value("timestamp", "")},
      {"timestamp_utc", alert.value("timestamp_utc", alert.value("timestamp", ""))},
      {"frame_refs", alert.value("frame_refs", nlohmann::json::array())},
      {"inference_refs", alert.value("inference_refs", nlohmann::json::array())},
      {"recommended_action", alert.value("recommended_action", "")},
      {"delivery_status", alert.value("delivery_status", nlohmann::json::object())},
      {"acknowledged", alert.value("acknowledged", false)},
      {"alert_path", alert_path_relative},
  };
}

GenerateAlertsResult generate_alerts_from_inference(const config::DrakonConfig& config) {
  GenerateAlertsResult result;
  if (!config.alerts.enabled) {
    result.warnings.push_back("alerts are disabled in config; no alerts generated");
  }

  const auto inferences = load_inference_results(config, result);
  if (!result.errors.empty()) {
    return result;
  }

  for (const auto& inference : inferences) {
    const auto inference_id = inference.value("inference_id", "");
    if (inference_id.empty()) {
      result.warnings.push_back("skipped inference without inference_id");
      continue;
    }

    const auto detected_events = inference.value("events", nlohmann::json::array());
    if (detected_events.is_array()) {
      int event_index = 0;
      for (const auto& detected_event : detected_events) {
        ++event_index;
        if (!detected_event.is_object()) {
          continue;
        }
        const auto event_id = "event_" + frame_store::sanitize_path_part(inference_id) + "_" +
                              std::to_string(event_index);
        auto event = make_event_from_inference_event(inference, detected_event, event_id);
        auto write = events::write_event(config, event);
        if (!write.ok) {
          result.errors.push_back(write.error);
          continue;
        }
        ++result.events_written;
      }
    }

    const auto candidates = inference.value("alert_candidates", nlohmann::json::array());
    if (!candidates.is_array() || !config.alerts.enabled) {
      continue;
    }

    int candidate_index = 0;
    for (const auto& candidate : candidates) {
      ++candidate_index;
      if (!candidate.is_object()) {
        continue;
      }
      const auto suffix = std::to_string(candidate_index);
      const auto event_id = "event_" + frame_store::sanitize_path_part(inference_id) + "_alert_" + suffix;
      const auto alert_id = "alert_" + frame_store::sanitize_path_part(inference_id) + "_" + suffix;
      auto event = make_event_from_inference_candidate(inference, candidate, event_id, alert_id);
      auto alert = make_alert_from_candidate(inference, candidate, alert_id, event_id);

      auto event_write = events::write_event(config, event);
      if (!event_write.ok) {
        result.errors.push_back(event_write.error);
        continue;
      }
      ++result.events_written;

      std::string error;
      if (!write_alert(config, alert, error)) {
        result.errors.push_back(error);
        continue;
      }
      ++result.alerts_written;
    }
  }

  std::string error;
  if (!events::rebuild_events_index(config.runtime.data_root, result.events_index_records, error)) {
    result.errors.push_back(error);
  }
  if (!rebuild_alerts_index(config.runtime.data_root, result.alerts_index_records, error)) {
    result.errors.push_back(error);
  }

  result.ok = result.errors.empty();
  return result;
}

bool rebuild_alerts_index(
    const std::filesystem::path& data_root,
    std::size_t& records_written,
    std::string& error) {
  records_written = 0;
  const auto alerts_dir = data_root / "alerts";
  const auto index_path = data_root / "indexes" / "alerts.jsonl";

  std::error_code ec;
  std::vector<IndexedAlert> records;
  if (std::filesystem::exists(alerts_dir, ec)) {
    for (const auto& entry : std::filesystem::recursive_directory_iterator(alerts_dir, ec)) {
      if (ec) {
        error = "failed to scan alerts directory: " + ec.message();
        return false;
      }
      if (!entry.is_regular_file(ec) || entry.path().extension() != ".json") {
        continue;
      }
      std::ifstream in(entry.path(), std::ios::binary);
      if (!in) {
        continue;
      }
      nlohmann::json alert;
      try {
        alert = nlohmann::json::parse(in);
      } catch (...) {
        continue;
      }
      const auto rel = relative_to_data_root(data_root, entry.path());
      records.push_back({
          timestamp_or_nowish(alert),
          alert.value("alert_id", ""),
          make_alert_index_line(alert, rel),
      });
    }
  }

  std::sort(records.begin(), records.end(), [](const IndexedAlert& left, const IndexedAlert& right) {
    if (left.timestamp == right.timestamp) {
      return left.alert_id < right.alert_id;
    }
    return left.timestamp < right.timestamp;
  });

  std::filesystem::create_directories(index_path.parent_path(), ec);
  if (ec) {
    error = "failed to create alerts index directory: " + ec.message();
    return false;
  }

  auto tmp = index_path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp alerts index";
      return false;
    }
    for (const auto& record : records) {
      out << record.line.dump() << '\n';
    }
    if (!out) {
      error = "failed to write temp alerts index";
      return false;
    }
  }

  std::filesystem::rename(tmp, index_path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish alerts index: " + ec.message();
    return false;
  }

  records_written = records.size();
  return true;
}

WebhookDryRunResult send_webhooks_dry_run(const config::DrakonConfig& config) {
  WebhookDryRunResult result;
  for (const auto& webhook : config.alerts.webhooks) {
    if (webhook.enabled) {
      ++result.enabled_webhooks;
    }
  }

  const auto index_path = config.runtime.data_root / "indexes" / "alerts.jsonl";
  std::ifstream in(index_path, std::ios::binary);
  if (!in) {
    result.warnings.push_back("alerts index not found; nothing to deliver");
    result.ok = true;
    return result;
  }

  std::string line;
  while (std::getline(in, line)) {
    if (line.empty()) {
      continue;
    }
    nlohmann::json alert;
    try {
      alert = nlohmann::json::parse(line);
    } catch (...) {
      result.warnings.push_back("skipped invalid alert index line");
      continue;
    }
    ++result.alerts_read;
    const auto status = alert.value("delivery_status", nlohmann::json::object());
    const auto state = status.value("state", std::string("pending"));
    if (state == "pending") {
      result.simulated_deliveries += result.enabled_webhooks;
    }
  }

  result.ok = true;
  return result;
}

}  // namespace drakon::alerts

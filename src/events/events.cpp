#include "drakon/events/events.h"

#include <algorithm>
#include <fstream>
#include <sstream>

#include "drakon/frame_store/frame_store.h"

namespace drakon::events {

namespace {

std::string timestamp_or_unknown(const nlohmann::json& value) {
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

bool write_text_atomic(const std::filesystem::path& path, const std::string& text, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create event directory: " + ec.message();
    return false;
  }

  auto tmp = path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp event file";
      return false;
    }
    out << text;
    if (!out) {
      error = "failed to write temp event file";
      return false;
    }
  }

  std::filesystem::rename(tmp, path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish event file: " + ec.message();
    return false;
  }
  return true;
}

struct IndexedEvent {
  std::string timestamp;
  std::string event_id;
  nlohmann::json line;
};

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

}  // namespace

nlohmann::json make_event_index_line(
    const nlohmann::json& event,
    const std::string& event_path_relative) {
  return {
      {"schema_version", "drakon.events.v1"},
      {"record_type", "event"},
      {"event_id", event.value("event_id", "")},
      {"camera_id", event.value("camera_id", "")},
      {"source", event.value("source", "")},
      {"event_type", event.value("event_type", "")},
      {"timestamp", event.value("timestamp", "")},
      {"timestamp_utc", event.value("timestamp_utc", event.value("timestamp", ""))},
      {"frame_refs", event.value("frame_refs", nlohmann::json::array())},
      {"inference_refs", event.value("inference_refs", nlohmann::json::array())},
      {"alert_refs", event.value("alert_refs", nlohmann::json::array())},
      {"status", event.value("status", "")},
      {"event_path", event_path_relative},
  };
}

EventWriteResult write_event(
    const config::DrakonConfig& config,
    const nlohmann::json& event) {
  EventWriteResult result;
  result.event_id = event.value("event_id", "");
  if (result.event_id.empty()) {
    result.error = "event_id is required";
    return result;
  }

  const auto relative_path = dated_relative_path("events", result.event_id, timestamp_or_unknown(event));
  result.event_path = config.runtime.data_root / relative_path;
  result.index_path = config.runtime.data_root / "indexes" / "events.jsonl";

  if (!write_text_atomic(result.event_path, event.dump(2), result.error)) {
    return result;
  }

  result.ok = true;
  return result;
}

bool rebuild_events_index(
    const std::filesystem::path& data_root,
    std::size_t& records_written,
    std::string& error) {
  records_written = 0;
  const auto events_dir = data_root / "events";
  const auto index_path = data_root / "indexes" / "events.jsonl";

  std::error_code ec;
  std::vector<IndexedEvent> records;
  if (std::filesystem::exists(events_dir, ec)) {
    for (const auto& entry : std::filesystem::recursive_directory_iterator(events_dir, ec)) {
      if (ec) {
        error = "failed to scan events directory: " + ec.message();
        return false;
      }
      if (!entry.is_regular_file(ec) || entry.path().extension() != ".json") {
        continue;
      }
      std::ifstream in(entry.path(), std::ios::binary);
      if (!in) {
        continue;
      }
      nlohmann::json event;
      try {
        event = nlohmann::json::parse(in);
      } catch (...) {
        continue;
      }
      const auto rel = relative_to_data_root(data_root, entry.path());
      records.push_back({
          timestamp_or_unknown(event),
          event.value("event_id", ""),
          make_event_index_line(event, rel),
      });
    }
  }

  std::sort(records.begin(), records.end(), [](const IndexedEvent& left, const IndexedEvent& right) {
    if (left.timestamp == right.timestamp) {
      return left.event_id < right.event_id;
    }
    return left.timestamp < right.timestamp;
  });

  std::filesystem::create_directories(index_path.parent_path(), ec);
  if (ec) {
    error = "failed to create events index directory: " + ec.message();
    return false;
  }

  auto tmp = index_path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp events index";
      return false;
    }
    for (const auto& record : records) {
      out << record.line.dump() << '\n';
    }
    if (!out) {
      error = "failed to write temp events index";
      return false;
    }
  }

  std::filesystem::rename(tmp, index_path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish events index: " + ec.message();
    return false;
  }

  records_written = records.size();
  return true;
}

}  // namespace drakon::events

#include "drakon/database/database.h"

#include <sqlite3.h>

#include <filesystem>
#include <memory>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "drakon/runtime/redaction.h"

namespace drakon::database {

namespace {

struct SqliteDeleter {
  void operator()(sqlite3* db) const {
    if (db != nullptr) {
      sqlite3_close(db);
    }
  }
};

using SqliteHandle = std::unique_ptr<sqlite3, SqliteDeleter>;

struct StatementDeleter {
  void operator()(sqlite3_stmt* stmt) const {
    if (stmt != nullptr) {
      sqlite3_finalize(stmt);
    }
  }
};

using StatementHandle = std::unique_ptr<sqlite3_stmt, StatementDeleter>;

SqliteHandle open_sqlite(const std::filesystem::path& path, std::vector<std::string>& errors) {
  sqlite3* raw = nullptr;
  const int rc = sqlite3_open(path.string().c_str(), &raw);
  SqliteHandle db(raw);
  if (rc != SQLITE_OK) {
    const char* message = raw != nullptr ? sqlite3_errmsg(raw) : "unknown sqlite open error";
    errors.push_back("failed to open sqlite database: " +
                     runtime::redact_secret_like_values(message));
    return {};
  }
  return db;
}

bool exec_sql(sqlite3* db, std::string_view sql, std::vector<std::string>& errors) {
  char* raw_error = nullptr;
  const int rc = sqlite3_exec(db, std::string(sql).c_str(), nullptr, nullptr, &raw_error);
  if (rc == SQLITE_OK) {
    return true;
  }

  std::string message = raw_error != nullptr ? raw_error : sqlite3_errmsg(db);
  sqlite3_free(raw_error);
  errors.push_back(runtime::redact_secret_like_values(message));
  return false;
}

StatementHandle prepare(sqlite3* db, std::string_view sql, std::vector<std::string>& errors) {
  sqlite3_stmt* raw = nullptr;
  const int rc = sqlite3_prepare_v2(db, std::string(sql).c_str(), -1, &raw, nullptr);
  if (rc != SQLITE_OK) {
    errors.push_back(runtime::redact_secret_like_values(sqlite3_errmsg(db)));
    return {};
  }
  return StatementHandle(raw);
}

void bind_text(sqlite3_stmt* stmt, int index, const std::string& value) {
  sqlite3_bind_text(stmt, index, value.c_str(), static_cast<int>(value.size()), SQLITE_TRANSIENT);
}

std::string text_column(sqlite3_stmt* stmt, int index) {
  const unsigned char* text = sqlite3_column_text(stmt, index);
  return text == nullptr ? std::string{} : reinterpret_cast<const char*>(text);
}

const char* kSchemaSql = R"SQL(
CREATE TABLE IF NOT EXISTS cameras (
  camera_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_uri_masked TEXT,
  device_path TEXT,
  credentials_ref TEXT,
  location_json TEXT,
  description TEXT,
  fps_profiles_json TEXT NOT NULL,
  analysis_profile_json TEXT,
  metadata_json TEXT,
  status TEXT NOT NULL,
  last_seen_at_utc TEXT,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  camera_ids_json TEXT NOT NULL DEFAULT '[]',
  trigger_json TEXT,
  schedule_json TEXT,
  agent_id TEXT,
  inference_profile TEXT,
  alert_policy_json TEXT,
  output_policy_json TEXT,
  status TEXT NOT NULL DEFAULT 'disabled',
  created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  model_provider TEXT NOT NULL,
  model TEXT,
  prompt_template_id TEXT,
  tools_allowed_json TEXT,
  output_schema_json TEXT,
  safety_policy_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS frames (
  frame_id TEXT PRIMARY KEY,
  camera_id TEXT NOT NULL,
  capture_session_id TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,
  timestamp_local TEXT,
  timezone TEXT,
  fps_profile TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  image_path TEXT NOT NULL,
  metadata_path TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  checksum TEXT,
  status TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inferences (
  inference_id TEXT PRIMARY KEY,
  frame_id TEXT,
  camera_id TEXT NOT NULL,
  job_id TEXT,
  agent_id TEXT,
  timestamp_utc TEXT NOT NULL,
  model_provider TEXT,
  model TEXT,
  prompt_id TEXT,
  prompt_version TEXT,
  result_json TEXT,
  objects_json TEXT,
  events_detected_json TEXT,
  risk_score REAL,
  alert_candidates_json TEXT,
  raw_response_path TEXT,
  status TEXT NOT NULL,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  event_id TEXT,
  inference_id TEXT,
  camera_id TEXT,
  job_id TEXT,
  severity TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  timestamp_utc TEXT NOT NULL,
  timestamp_local TEXT,
  frame_refs_json TEXT,
  inference_refs_json TEXT,
  delivery_targets_json TEXT,
  delivery_status_json TEXT,
  recommended_action TEXT,
  acknowledged INTEGER DEFAULT 0,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  camera_id TEXT,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,
  timestamp_local TEXT,
  frame_refs_json TEXT,
  inference_refs_json TEXT,
  alert_refs_json TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_frames_camera_timestamp ON frames(camera_id, timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_inferences_camera_timestamp ON inferences(camera_id, timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(event_type, timestamp_utc);
)SQL";

std::string join_json_string_array(const std::vector<std::string>& values) {
  std::ostringstream out;
  out << "[";
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (i != 0) {
      out << ",";
    }
    out << "\"";
    for (char c : values[i]) {
      if (c == '"' || c == '\\') {
        out << '\\';
      }
      out << c;
    }
    out << "\"";
  }
  out << "]";
  return out.str();
}

std::string camera_status(const config::CameraConfig& camera) {
  return camera.enabled ? "enabled" : "disabled";
}

bool upsert_camera(sqlite3* db, const config::CameraConfig& camera, std::vector<std::string>& errors) {
  auto stmt = prepare(
      db,
      R"SQL(
INSERT INTO cameras (
  camera_id, name, enabled, source_type, source_uri_masked, device_path,
  credentials_ref, location_json, description, fps_profiles_json,
  analysis_profile_json, metadata_json, status, created_at_utc, updated_at_utc
) VALUES (
  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP),
  COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP)
)
ON CONFLICT(camera_id) DO UPDATE SET
  name = excluded.name,
  enabled = excluded.enabled,
  source_type = excluded.source_type,
  source_uri_masked = excluded.source_uri_masked,
  device_path = excluded.device_path,
  credentials_ref = excluded.credentials_ref,
  location_json = excluded.location_json,
  description = excluded.description,
  fps_profiles_json = excluded.fps_profiles_json,
  analysis_profile_json = excluded.analysis_profile_json,
  metadata_json = excluded.metadata_json,
  status = excluded.status,
  updated_at_utc = excluded.updated_at_utc
)SQL",
      errors);
  if (!stmt) {
    return false;
  }

  const std::string source_uri_masked =
      camera.rtsp_url ? runtime::redact_uri_credentials(*camera.rtsp_url) : std::string{};
  const std::string fps_profiles_json = join_json_string_array(camera.fps_profiles);

  bind_text(stmt.get(), 1, camera.camera_id);
  bind_text(stmt.get(), 2, camera.name);
  sqlite3_bind_int(stmt.get(), 3, camera.enabled ? 1 : 0);
  bind_text(stmt.get(), 4, camera.source_type);
  bind_text(stmt.get(), 5, source_uri_masked);
  bind_text(stmt.get(), 6, camera.device_path.value_or(""));
  bind_text(stmt.get(), 7, camera.credentials_ref.value_or(""));
  bind_text(stmt.get(), 8, camera.location_json);
  bind_text(stmt.get(), 9, camera.description);
  bind_text(stmt.get(), 10, fps_profiles_json);
  bind_text(stmt.get(), 11, camera.analysis_profile_json);
  bind_text(stmt.get(), 12, camera.metadata_json);
  bind_text(stmt.get(), 13, camera_status(camera));
  bind_text(stmt.get(), 14, camera.created_at);
  bind_text(stmt.get(), 15, camera.updated_at);

  const int rc = sqlite3_step(stmt.get());
  if (rc != SQLITE_DONE) {
    errors.push_back(runtime::redact_secret_like_values(sqlite3_errmsg(db)));
    return false;
  }
  return true;
}

bool table_exists(sqlite3* db, const std::string& table_name, std::vector<std::string>& errors) {
  auto stmt = prepare(
      db,
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      errors);
  if (!stmt) {
    return false;
  }
  bind_text(stmt.get(), 1, table_name);
  const int rc = sqlite3_step(stmt.get());
  if (rc == SQLITE_ROW) {
    return true;
  }
  if (rc == SQLITE_DONE) {
    return false;
  }
  errors.push_back(runtime::redact_secret_like_values(sqlite3_errmsg(db)));
  return false;
}

int table_row_count(sqlite3* db, const std::string& table_name, std::vector<std::string>& errors) {
  const std::string sql = "SELECT COUNT(*) FROM " + table_name;
  auto stmt = prepare(db, sql, errors);
  if (!stmt) {
    return 0;
  }
  const int rc = sqlite3_step(stmt.get());
  if (rc == SQLITE_ROW) {
    return sqlite3_column_int(stmt.get(), 0);
  }
  if (rc != SQLITE_DONE) {
    errors.push_back(runtime::redact_secret_like_values(sqlite3_errmsg(db)));
  }
  return 0;
}

bool ensure_sqlite_config(const config::DrakonConfig& config, std::vector<std::string>& errors) {
  if (config.database.type != "sqlite") {
    errors.push_back("only sqlite database operations are implemented in this phase");
    return false;
  }
  if (config.database.path.empty()) {
    errors.push_back("sqlite database path is empty");
    return false;
  }
  return true;
}

}  // namespace

std::vector<std::string> required_table_names() {
  return {"cameras", "jobs", "agents", "frames", "inferences", "alerts", "events"};
}

DatabaseResult initialize_database(const config::DrakonConfig& config) {
  DatabaseResult result;
  if (!ensure_sqlite_config(config, result.errors)) {
    return result;
  }

  std::error_code ec;
  std::filesystem::create_directories(config.database.path.parent_path(), ec);
  if (ec) {
    result.errors.push_back("failed to create database directory: " +
                            runtime::redact_secret_like_values(ec.message()));
    return result;
  }

  auto db = open_sqlite(config.database.path, result.errors);
  if (!db) {
    return result;
  }

  exec_sql(db.get(), "PRAGMA foreign_keys = ON", result.errors);
  exec_sql(db.get(), "PRAGMA journal_mode = WAL", result.errors);
  exec_sql(db.get(), "PRAGMA synchronous = NORMAL", result.errors);
  exec_sql(db.get(), kSchemaSql, result.errors);

  if (!result.errors.empty()) {
    return result;
  }

  for (const auto& camera : config.cameras) {
    upsert_camera(db.get(), camera, result.errors);
  }

  if (!result.errors.empty()) {
    return result;
  }

  result.ok = true;
  result.messages.push_back("sqlite schema initialized");
  result.messages.push_back("cameras imported: " + std::to_string(config.cameras.size()));
  return result;
}

DatabaseStatus inspect_database(const config::DrakonConfig& config) {
  DatabaseStatus status;
  status.type = config.database.type;
  status.path = config.database.path;

  if (!ensure_sqlite_config(config, status.errors)) {
    return status;
  }

  std::error_code exists_ec;
  if (!std::filesystem::exists(config.database.path, exists_ec)) {
    status.errors.push_back("sqlite database file does not exist");
    return status;
  }

  auto db = open_sqlite(config.database.path, status.errors);
  if (!db) {
    return status;
  }
  status.connected = true;

  bool all_tables_exist = true;
  for (const auto& table_name : required_table_names()) {
    TableStatus table;
    table.name = table_name;
    table.exists = table_exists(db.get(), table_name, status.errors);
    if (table.exists) {
      table.row_count = table_row_count(db.get(), table_name, status.errors);
    } else {
      all_tables_exist = false;
    }
    status.tables.push_back(std::move(table));
  }

  status.initialized = all_tables_exist && status.errors.empty();
  return status;
}

std::vector<CameraRow> list_cameras(
    const config::DrakonConfig& config,
    std::vector<std::string>& errors) {
  std::vector<CameraRow> cameras;
  if (!ensure_sqlite_config(config, errors)) {
    return cameras;
  }

  auto db = open_sqlite(config.database.path, errors);
  if (!db) {
    return cameras;
  }

  auto stmt = prepare(
      db.get(),
      "SELECT camera_id, name, enabled, source_type, status FROM cameras ORDER BY camera_id",
      errors);
  if (!stmt) {
    return cameras;
  }

  while (true) {
    const int rc = sqlite3_step(stmt.get());
    if (rc == SQLITE_DONE) {
      break;
    }
    if (rc != SQLITE_ROW) {
      errors.push_back(runtime::redact_secret_like_values(sqlite3_errmsg(db.get())));
      break;
    }

    CameraRow row;
    row.camera_id = text_column(stmt.get(), 0);
    row.name = text_column(stmt.get(), 1);
    row.enabled = sqlite3_column_int(stmt.get(), 2) != 0;
    row.source_type = text_column(stmt.get(), 3);
    row.status = text_column(stmt.get(), 4);
    cameras.push_back(std::move(row));
  }

  return cameras;
}

}  // namespace drakon::database

#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "drakon/config/config_loader.h"

namespace drakon::database {

struct DatabaseResult {
  bool ok = false;
  std::vector<std::string> messages;
  std::vector<std::string> errors;
};

struct TableStatus {
  std::string name;
  bool exists = false;
  int row_count = 0;
};

struct DatabaseStatus {
  std::string type;
  std::filesystem::path path;
  bool connected = false;
  bool initialized = false;
  std::vector<TableStatus> tables;
  std::vector<std::string> errors;
};

struct CameraRow {
  std::string camera_id;
  std::string name;
  bool enabled = false;
  std::string source_type;
  std::string status;
};

DatabaseResult initialize_database(const config::DrakonConfig& config);
DatabaseStatus inspect_database(const config::DrakonConfig& config);
std::vector<CameraRow> list_cameras(const config::DrakonConfig& config, std::vector<std::string>& errors);
std::vector<std::string> required_table_names();

}  // namespace drakon::database

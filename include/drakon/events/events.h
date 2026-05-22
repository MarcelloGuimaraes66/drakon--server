#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "drakon/config/config_loader.h"

namespace drakon::events {

struct EventWriteResult {
  bool ok = false;
  std::string event_id;
  std::filesystem::path event_path;
  std::filesystem::path index_path;
  std::string error;
};

EventWriteResult write_event(
    const config::DrakonConfig& config,
    const nlohmann::json& event);

bool rebuild_events_index(
    const std::filesystem::path& data_root,
    std::size_t& records_written,
    std::string& error);

nlohmann::json make_event_index_line(
    const nlohmann::json& event,
    const std::string& event_path_relative);

}  // namespace drakon::events

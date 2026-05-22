#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "drakon/config/config_loader.h"

namespace drakon::alerts {

struct GenerateAlertsResult {
  bool ok = false;
  int inferences_read = 0;
  int events_written = 0;
  int alerts_written = 0;
  std::size_t events_index_records = 0;
  std::size_t alerts_index_records = 0;
  std::vector<std::string> warnings;
  std::vector<std::string> errors;
};

struct WebhookDryRunResult {
  bool ok = false;
  int alerts_read = 0;
  int enabled_webhooks = 0;
  int simulated_deliveries = 0;
  std::vector<std::string> warnings;
  std::vector<std::string> errors;
};

GenerateAlertsResult generate_alerts_from_inference(const config::DrakonConfig& config);
WebhookDryRunResult send_webhooks_dry_run(const config::DrakonConfig& config);

bool rebuild_alerts_index(
    const std::filesystem::path& data_root,
    std::size_t& records_written,
    std::string& error);

nlohmann::json make_alert_index_line(
    const nlohmann::json& alert,
    const std::string& alert_path_relative);

}  // namespace drakon::alerts

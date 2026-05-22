#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "drakon/config/config_loader.h"

namespace drakon::inference {

struct InferenceRunResult {
  bool ok = false;
  std::string inference_id;
  std::string frame_id;
  std::string camera_id;
  std::filesystem::path result_path;
  std::filesystem::path index_path;
  std::string status;
  std::string error;
  nlohmann::json result_json = nlohmann::json::object();
};

struct InferenceBatchResult {
  bool ok = false;
  int processed = 0;
  int failed = 0;
  std::vector<std::string> errors;
  std::vector<InferenceRunResult> results;
};

InferenceRunResult infer_frame(
    const config::DrakonConfig& config,
    const std::filesystem::path& frame_path);

InferenceBatchResult infer_batch(
    const config::DrakonConfig& config,
    const std::filesystem::path& frames_index_path);

}  // namespace drakon::inference

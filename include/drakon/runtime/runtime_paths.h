#pragma once

#include <filesystem>
#include <vector>

#include "drakon/config/config_loader.h"

namespace drakon::runtime {

struct RuntimePaths {
  std::filesystem::path project_root;
  std::filesystem::path data_dir;
  std::filesystem::path runtime_dir;
  std::filesystem::path frames_dir;
  std::filesystem::path inference_dir;
  std::filesystem::path alerts_dir;
  std::filesystem::path events_dir;
  std::filesystem::path indexes_dir;
  std::filesystem::path logs_dir;
  std::filesystem::path log_file;
};

RuntimePaths make_runtime_paths(const config::DrakonConfig& config);
std::vector<std::filesystem::path> required_runtime_directories(const RuntimePaths& paths);
void prepare_runtime_directories(const RuntimePaths& paths);
bool path_exists(const std::filesystem::path& path);

}  // namespace drakon::runtime

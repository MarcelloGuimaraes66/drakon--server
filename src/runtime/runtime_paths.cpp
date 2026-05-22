#include "drakon/runtime/runtime_paths.h"

#include <fstream>

namespace drakon::runtime {

RuntimePaths make_runtime_paths(const config::DrakonConfig& config) {
  RuntimePaths paths;
  paths.project_root = config.runtime.project_root;
  paths.data_dir = config.runtime.data_dir;
  paths.runtime_dir = config.runtime.runtime_dir;
  paths.frames_dir = paths.data_dir / "frames";
  paths.inference_dir = paths.data_dir / "inference";
  paths.alerts_dir = paths.data_dir / "alerts";
  paths.events_dir = paths.data_dir / "events";
  paths.indexes_dir = paths.data_dir / "indexes";
  paths.logs_dir = config.runtime.log_dir;
  paths.log_file = paths.logs_dir / "drakon-server.log";
  return paths;
}

std::vector<std::filesystem::path> required_runtime_directories(const RuntimePaths& paths) {
  return {
      paths.data_dir,
      paths.frames_dir,
      paths.inference_dir,
      paths.alerts_dir,
      paths.events_dir,
      paths.indexes_dir,
      paths.logs_dir,
      paths.runtime_dir,
  };
}

void prepare_runtime_directories(const RuntimePaths& paths) {
  for (const auto& dir : required_runtime_directories(paths)) {
    std::filesystem::create_directories(dir);
  }

  std::ofstream log(paths.log_file, std::ios::app);
  if (log) {
    log << "drakon-server runtime prepared\n";
  }
}

bool path_exists(const std::filesystem::path& path) {
  std::error_code ec;
  return std::filesystem::exists(path, ec);
}

}  // namespace drakon::runtime

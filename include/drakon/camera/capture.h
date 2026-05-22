#pragma once

#include <filesystem>
#include <string>
#include <vector>

#include "drakon/config/config_loader.h"

namespace drakon::camera {

struct CaptureTestOptions {
  std::filesystem::path config_path;
  std::string camera_id;
  int seconds = 5;
  bool dry_run = false;
};

struct CaptureTestResult {
  bool ok = false;
  std::string camera_id;
  std::string capture_session_id;
  int frames_saved = 0;
  std::vector<std::string> messages;
  std::vector<std::string> errors;
};

CaptureTestResult run_capture_test(const config::DrakonConfig& config, const CaptureTestOptions& options);
std::string ffmpeg_version_summary();

}  // namespace drakon::camera

#pragma once

#include <chrono>
#include <filesystem>
#include <string>
#include <vector>

#include <opencv2/core.hpp>

#include "drakon/config/config_loader.h"

namespace drakon::camera {

struct FrameWriteRequest {
  std::string camera_id;
  std::string capture_session_id;
  std::string fps_profile;
  int sequence = 0;
  std::string source_uri_masked;
  std::string timezone;
  bool dry_run = false;
  std::chrono::system_clock::time_point timestamp_utc;
  cv::Mat image;
};

struct FrameWriteResult {
  bool ok = false;
  std::string frame_id;
  std::filesystem::path image_path;
  std::filesystem::path metadata_path;
  std::string checksum;
  std::string error;
};

class FrameWriter {
 public:
  FrameWriter(std::filesystem::path data_root, std::vector<config::CaptureProfileConfig> profiles);

  FrameWriteResult write(const FrameWriteRequest& request) const;

 private:
  std::filesystem::path data_root_;
  std::vector<config::CaptureProfileConfig> profiles_;
};

std::string sanitize_path_part(std::string value);

}  // namespace drakon::camera

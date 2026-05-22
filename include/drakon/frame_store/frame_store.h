#pragma once

#include <chrono>
#include <cstddef>
#include <filesystem>
#include <string>
#include <vector>

#include <opencv2/core.hpp>

#include "drakon/config/config_loader.h"

namespace drakon::frame_store {

struct FrameStoreRequest {
  std::string camera_id;
  std::string capture_session_id;
  std::string fps_profile;
  int sequence = 0;
  std::string source;
  std::string timezone;
  bool dry_run = false;
  std::chrono::system_clock::time_point timestamp_utc;
  cv::Mat image;
};

struct FrameStoreResult {
  bool ok = false;
  std::string frame_id;
  std::filesystem::path image_path;
  std::filesystem::path metadata_path;
  std::filesystem::path index_path;
  std::string checksum;
  std::string error;
};

struct FrameIndexRebuildResult {
  bool ok = false;
  std::size_t records_written = 0;
  std::filesystem::path index_path;
  std::vector<std::string> warnings;
  std::vector<std::string> errors;
};

class FrameStore {
 public:
  FrameStore(std::filesystem::path data_root, std::vector<config::CaptureProfileConfig> profiles);

  FrameStoreResult store(const FrameStoreRequest& request) const;

 private:
  std::filesystem::path data_root_;
  std::vector<config::CaptureProfileConfig> profiles_;
};

FrameIndexRebuildResult rebuild_frame_index(const std::filesystem::path& data_root);

std::string sanitize_path_part(std::string value);

}  // namespace drakon::frame_store

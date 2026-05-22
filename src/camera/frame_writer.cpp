#include "drakon/camera/frame_writer.h"

#include <cctype>
#include <fstream>
#include <iomanip>
#include <sstream>

#include <nlohmann/json.hpp>
#include <opencv2/imgcodecs.hpp>

namespace drakon::camera {

namespace {

std::string compact_utc_timestamp(std::chrono::system_clock::time_point tp) {
  const auto millis =
      std::chrono::duration_cast<std::chrono::milliseconds>(tp.time_since_epoch()).count();
  const std::time_t seconds = static_cast<std::time_t>(millis / 1000);
  const int ms = static_cast<int>(millis % 1000);

  std::tm tm_utc{};
  gmtime_r(&seconds, &tm_utc);

  std::ostringstream out;
  out << std::put_time(&tm_utc, "%Y%m%dT%H%M%S") << std::setw(3) << std::setfill('0')
      << ms << "Z";
  return out.str();
}

std::string iso_utc_timestamp(std::chrono::system_clock::time_point tp) {
  const auto millis =
      std::chrono::duration_cast<std::chrono::milliseconds>(tp.time_since_epoch()).count();
  const std::time_t seconds = static_cast<std::time_t>(millis / 1000);
  const int ms = static_cast<int>(millis % 1000);

  std::tm tm_utc{};
  gmtime_r(&seconds, &tm_utc);

  std::ostringstream out;
  out << std::put_time(&tm_utc, "%Y-%m-%dT%H:%M:%S") << "." << std::setw(3)
      << std::setfill('0') << ms << "Z";
  return out.str();
}

std::string iso_local_timestamp(std::chrono::system_clock::time_point tp) {
  const auto millis =
      std::chrono::duration_cast<std::chrono::milliseconds>(tp.time_since_epoch()).count();
  const std::time_t seconds = static_cast<std::time_t>(millis / 1000);
  const int ms = static_cast<int>(millis % 1000);

  std::tm tm_local{};
  localtime_r(&seconds, &tm_local);

  std::ostringstream out;
  out << std::put_time(&tm_local, "%Y-%m-%dT%H:%M:%S") << "." << std::setw(3)
      << std::setfill('0') << ms;
  return out.str();
}

std::tm local_tm(std::chrono::system_clock::time_point tp) {
  const auto seconds = std::chrono::system_clock::to_time_t(tp);
  std::tm tm_local{};
  localtime_r(&seconds, &tm_local);
  return tm_local;
}

std::string two_digits(int value) {
  std::ostringstream out;
  out << std::setw(2) << std::setfill('0') << value;
  return out.str();
}

std::string extension_for_profile(const config::CaptureProfileConfig& profile) {
  if (profile.image_format == "png") {
    return ".png";
  }
  return ".jpg";
}

const config::CaptureProfileConfig* find_profile(
    const std::vector<config::CaptureProfileConfig>& profiles,
    const std::string& profile_id) {
  for (const auto& profile : profiles) {
    if (profile.profile_id == profile_id) {
      return &profile;
    }
  }
  return nullptr;
}

std::string fnv1a64(const std::vector<unsigned char>& bytes) {
  std::uint64_t hash = 1469598103934665603ULL;
  for (unsigned char byte : bytes) {
    hash ^= static_cast<std::uint64_t>(byte);
    hash *= 1099511628211ULL;
  }
  std::ostringstream out;
  out << "fnv1a64:" << std::hex << std::setw(16) << std::setfill('0') << hash;
  return out.str();
}

bool write_bytes_atomic(
    const std::filesystem::path& path,
    const std::vector<unsigned char>& bytes,
    std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create frame directory: " + ec.message();
    return false;
  }

  auto tmp = path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp frame file";
      return false;
    }
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    if (!out) {
      error = "failed to write temp frame file";
      return false;
    }
  }

  std::filesystem::rename(tmp, path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish frame file: " + ec.message();
    return false;
  }
  return true;
}

bool write_text_atomic(const std::filesystem::path& path, const std::string& text, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create metadata directory: " + ec.message();
    return false;
  }

  auto tmp = path;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      error = "failed to open temp metadata file";
      return false;
    }
    out << text;
    if (!out) {
      error = "failed to write temp metadata file";
      return false;
    }
  }

  std::filesystem::rename(tmp, path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    error = "failed to publish metadata file: " + ec.message();
    return false;
  }
  return true;
}

}  // namespace

std::string sanitize_path_part(std::string value) {
  for (char& c : value) {
    const auto uc = static_cast<unsigned char>(c);
    if (!std::isalnum(uc) && c != '_' && c != '-' && c != '.') {
      c = '_';
    }
  }
  return value.empty() ? "unknown" : value;
}

FrameWriter::FrameWriter(std::filesystem::path data_root, std::vector<config::CaptureProfileConfig> profiles)
    : data_root_(std::move(data_root)), profiles_(std::move(profiles)) {}

FrameWriteResult FrameWriter::write(const FrameWriteRequest& request) const {
  FrameWriteResult result;
  if (request.image.empty()) {
    result.error = "empty frame image";
    return result;
  }

  const auto* profile = find_profile(profiles_, request.fps_profile);
  config::CaptureProfileConfig fallback;
  fallback.profile_id = request.fps_profile;
  fallback.image_format = "jpg";
  fallback.quality = 90;
  if (profile == nullptr) {
    profile = &fallback;
  }

  const auto local = local_tm(request.timestamp_utc);
  const std::string safe_camera_id = sanitize_path_part(request.camera_id);
  const std::string safe_profile = sanitize_path_part(request.fps_profile);
  const std::string timestamp_compact = compact_utc_timestamp(request.timestamp_utc);

  std::ostringstream sequence_part;
  sequence_part << std::setw(6) << std::setfill('0') << request.sequence;
  result.frame_id = "frame_" + safe_camera_id + "_" + timestamp_compact + "_" + sequence_part.str();

  const auto relative_dir = std::filesystem::path("frames") / safe_camera_id /
                            std::to_string(local.tm_year + 1900) /
                            two_digits(local.tm_mon + 1) / two_digits(local.tm_mday) /
                            two_digits(local.tm_hour) / two_digits(local.tm_min) / safe_profile;

  const std::string extension = extension_for_profile(*profile);
  const std::string base_name = timestamp_compact + "_" + sequence_part.str();
  const auto image_relative = relative_dir / (base_name + extension);
  const auto metadata_relative = relative_dir / (base_name + ".json");

  std::vector<unsigned char> encoded;
  std::vector<int> params;
  if (extension == ".jpg") {
    params = {cv::IMWRITE_JPEG_QUALITY, profile->quality <= 0 ? 90 : profile->quality};
  }

  if (!cv::imencode(extension, request.image, encoded, params)) {
    result.error = "failed to encode frame image";
    return result;
  }

  result.image_path = data_root_ / image_relative;
  result.metadata_path = data_root_ / metadata_relative;
  result.checksum = fnv1a64(encoded);

  if (!write_bytes_atomic(result.image_path, encoded, result.error)) {
    return result;
  }

  nlohmann::json metadata = {
      {"schema_version", "drakon.v1"},
      {"frame_id", result.frame_id},
      {"camera_id", request.camera_id},
      {"capture_session_id", request.capture_session_id},
      {"timestamp_utc", iso_utc_timestamp(request.timestamp_utc)},
      {"timestamp_local", iso_local_timestamp(request.timestamp_utc)},
      {"timezone", request.timezone},
      {"fps_profile", request.fps_profile},
      {"sequence", request.sequence},
      {"image_path", image_relative.generic_string()},
      {"metadata_path", metadata_relative.generic_string()},
      {"width", request.image.cols},
      {"height", request.image.rows},
      {"source_uri_masked", request.source_uri_masked},
      {"checksum", result.checksum},
      {"status", "stored"},
      {"dry_run", request.dry_run},
  };

  if (!write_text_atomic(result.metadata_path, metadata.dump(2), result.error)) {
    return result;
  }

  result.ok = true;
  return result;
}

}  // namespace drakon::camera

#include "drakon/frame_store/frame_store.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <ctime>
#include <fstream>
#include <iomanip>
#include <sstream>

#include <nlohmann/json.hpp>
#include <opencv2/imgcodecs.hpp>

namespace drakon::frame_store {

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

std::string sequence_part(int sequence) {
  std::ostringstream out;
  out << std::setw(6) << std::setfill('0') << sequence;
  return out.str();
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

std::string format_fps(double fps) {
  std::ostringstream out;
  if (std::abs(fps - std::round(fps)) < 0.000001) {
    out << static_cast<int>(std::round(fps));
  } else {
    out << std::fixed << std::setprecision(2) << fps;
  }
  auto value = out.str();
  while (value.find('.') != std::string::npos && value.ends_with('0')) {
    value.pop_back();
  }
  if (value.ends_with('.')) {
    value.pop_back();
  }
  return value.empty() ? "unknown" : value;
}

std::string fps_path_part(const config::CaptureProfileConfig& profile, const std::string& requested_id) {
  if (!requested_id.empty() && requested_id.starts_with("fps_")) {
    return sanitize_path_part(requested_id);
  }
  if (!profile.profile_id.empty() && profile.profile_id.starts_with("fps_")) {
    return sanitize_path_part(profile.profile_id);
  }
  return sanitize_path_part("fps_" + format_fps(profile.fps));
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

nlohmann::json index_record_from_metadata(const nlohmann::json& metadata) {
  nlohmann::json line = {
      {"schema_version", metadata.value("schema_version", "drakon.v1")},
      {"record_type", "frame"},
      {"frame_id", metadata.value("frame_id", "")},
      {"camera_id", metadata.value("camera_id", "")},
      {"timestamp_utc", metadata.value("timestamp_utc", "")},
      {"timestamp_local", metadata.value("timestamp_local", "")},
      {"fps_profile", metadata.value("fps_profile", "")},
      {"image_path", metadata.value("image_path", "")},
      {"metadata_path", metadata.value("metadata_path", "")},
      {"width", metadata.value("width", 0)},
      {"height", metadata.value("height", 0)},
      {"source", metadata.value("source", metadata.value("source_uri_masked", ""))},
      {"checksum", metadata.value("checksum", "")},
      {"status", metadata.value("status", "stored")},
  };
  return line;
}

bool append_jsonl(const std::filesystem::path& path, const nlohmann::json& line, std::string& error) {
  std::error_code ec;
  std::filesystem::create_directories(path.parent_path(), ec);
  if (ec) {
    error = "failed to create indexes directory: " + ec.message();
    return false;
  }

  std::ofstream out(path, std::ios::binary | std::ios::app);
  if (!out) {
    error = "failed to open frames index";
    return false;
  }
  out << line.dump() << '\n';
  if (!out) {
    error = "failed to append frames index";
    return false;
  }
  return true;
}

struct IndexedMetadata {
  std::string timestamp_utc;
  std::string frame_id;
  nlohmann::json record;
};

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

FrameStore::FrameStore(std::filesystem::path data_root, std::vector<config::CaptureProfileConfig> profiles)
    : data_root_(std::move(data_root)), profiles_(std::move(profiles)) {}

FrameStoreResult FrameStore::store(const FrameStoreRequest& request) const {
  FrameStoreResult result;
  if (request.image.empty()) {
    result.error = "empty frame image";
    return result;
  }

  const auto* profile = find_profile(profiles_, request.fps_profile);
  config::CaptureProfileConfig fallback;
  fallback.profile_id = request.fps_profile;
  fallback.fps = 0.0;
  fallback.image_format = "jpg";
  fallback.quality = 90;
  if (profile == nullptr) {
    profile = &fallback;
  }

  const auto local = local_tm(request.timestamp_utc);
  const std::string safe_camera_id = sanitize_path_part(request.camera_id);
  const std::string safe_profile = fps_path_part(*profile, request.fps_profile);
  const std::string timestamp_compact = compact_utc_timestamp(request.timestamp_utc);
  const std::string sequence_text = sequence_part(request.sequence);
  result.frame_id = "frame_" + safe_camera_id + "_" + timestamp_compact + "_" + sequence_text;

  const auto relative_dir = std::filesystem::path("frames") / safe_camera_id /
                            std::to_string(local.tm_year + 1900) /
                            two_digits(local.tm_mon + 1) / two_digits(local.tm_mday) /
                            two_digits(local.tm_hour) / two_digits(local.tm_min) / safe_profile;

  const std::string image_name = timestamp_compact + "_" + safe_camera_id + "_" + sequence_text + ".jpg";
  const auto image_relative = relative_dir / image_name;
  const auto metadata_relative = relative_dir / (result.frame_id + ".json");

  std::vector<unsigned char> encoded;
  const std::vector<int> params = {
      cv::IMWRITE_JPEG_QUALITY,
      profile->quality <= 0 ? 90 : profile->quality,
  };

  if (!cv::imencode(".jpg", request.image, encoded, params)) {
    result.error = "failed to encode frame image";
    return result;
  }

  result.image_path = data_root_ / image_relative;
  result.metadata_path = data_root_ / metadata_relative;
  result.index_path = data_root_ / "indexes" / "frames.jsonl";
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
      {"source", request.source},
      {"source_uri_masked", request.source},
      {"checksum", result.checksum},
      {"status", "stored"},
      {"dry_run", request.dry_run},
  };

  if (!write_text_atomic(result.metadata_path, metadata.dump(2), result.error)) {
    return result;
  }
  if (!append_jsonl(result.index_path, index_record_from_metadata(metadata), result.error)) {
    return result;
  }

  result.ok = true;
  return result;
}

FrameIndexRebuildResult rebuild_frame_index(const std::filesystem::path& data_root) {
  FrameIndexRebuildResult result;
  result.index_path = data_root / "indexes" / "frames.jsonl";

  const auto frames_dir = data_root / "frames";
  std::error_code ec;
  if (!std::filesystem::exists(frames_dir, ec)) {
    result.ok = true;
    return result;
  }
  if (ec) {
    result.errors.push_back("failed to inspect frames directory: " + ec.message());
    return result;
  }

  std::vector<IndexedMetadata> records;
  for (const auto& entry : std::filesystem::recursive_directory_iterator(frames_dir, ec)) {
    if (ec) {
      result.errors.push_back("failed to scan frames directory: " + ec.message());
      return result;
    }
    if (!entry.is_regular_file(ec) || entry.path().extension() != ".json") {
      continue;
    }

    std::ifstream in(entry.path(), std::ios::binary);
    if (!in) {
      result.warnings.push_back("skipped unreadable metadata: " + entry.path().generic_string());
      continue;
    }

    nlohmann::json metadata;
    try {
      metadata = nlohmann::json::parse(in);
    } catch (const std::exception& ex) {
      result.warnings.push_back("skipped invalid metadata " + entry.path().generic_string() + ": " + ex.what());
      continue;
    }

    auto record = index_record_from_metadata(metadata);
    if (record.value("frame_id", "").empty() || record.value("image_path", "").empty()) {
      result.warnings.push_back("skipped incomplete metadata: " + entry.path().generic_string());
      continue;
    }
    records.push_back({
        record.value("timestamp_utc", ""),
        record.value("frame_id", ""),
        std::move(record),
    });
  }
  if (ec) {
    result.errors.push_back("failed to scan frames directory: " + ec.message());
    return result;
  }

  std::sort(records.begin(), records.end(), [](const IndexedMetadata& left, const IndexedMetadata& right) {
    if (left.timestamp_utc == right.timestamp_utc) {
      return left.frame_id < right.frame_id;
    }
    return left.timestamp_utc < right.timestamp_utc;
  });

  std::filesystem::create_directories(result.index_path.parent_path(), ec);
  if (ec) {
    result.errors.push_back("failed to create indexes directory: " + ec.message());
    return result;
  }

  auto tmp = result.index_path;
  tmp += ".rebuild.tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) {
      result.errors.push_back("failed to open temp frames index");
      return result;
    }
    for (const auto& record : records) {
      out << record.record.dump() << '\n';
    }
    if (!out) {
      result.errors.push_back("failed to write temp frames index");
      return result;
    }
  }

  std::filesystem::rename(tmp, result.index_path, ec);
  if (ec) {
    std::filesystem::remove(tmp);
    result.errors.push_back("failed to publish frames index: " + ec.message());
    return result;
  }

  result.records_written = records.size();
  result.ok = true;
  return result;
}

}  // namespace drakon::frame_store

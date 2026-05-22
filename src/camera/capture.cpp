#include "drakon/camera/capture.h"

extern "C" {
#include <libavformat/avformat.h>
}

#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <map>
#include <sstream>

#include <opencv2/imgproc.hpp>
#include <opencv2/videoio.hpp>

#include "drakon/database/database.h"
#include "drakon/frame_store/frame_store.h"
#include "drakon/runtime/redaction.h"

namespace drakon::camera {

namespace {

const config::CameraConfig* find_camera_config(
    const config::DrakonConfig& config,
    const std::string& camera_id) {
  for (const auto& camera : config.cameras) {
    if (camera.camera_id == camera_id) {
      return &camera;
    }
  }
  return nullptr;
}

std::vector<config::CaptureProfileConfig> active_profiles(
    const config::DrakonConfig& config,
    const config::CameraConfig& camera) {
  std::vector<config::CaptureProfileConfig> profiles;
  for (const auto& profile_id : camera.fps_profiles) {
    for (const auto& profile : config.capture.profiles) {
      if (profile.profile_id == profile_id && profile.enabled) {
        profiles.push_back(profile);
      }
    }
  }
  return profiles;
}

std::string now_session_id(const std::string& camera_id) {
  const auto now = std::chrono::system_clock::now();
  const auto millis =
      std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()).count();
  return "capture_" + frame_store::sanitize_path_part(camera_id) + "_" + std::to_string(millis);
}

std::optional<std::string> env_ref_value(const std::string& ref) {
  constexpr std::string_view prefix = "env:";
  if (!ref.starts_with(prefix)) {
    return std::nullopt;
  }
  const std::string name = ref.substr(prefix.size());
  const char* value = std::getenv(name.c_str());
  if (value == nullptr || std::string(value).empty()) {
    return std::nullopt;
  }
  return std::string(value);
}

std::optional<std::string> resolve_rtsp_url(const config::CameraConfig& camera, std::string& error) {
  if (camera.credentials_ref) {
    const auto from_env = env_ref_value(*camera.credentials_ref);
    if (from_env && from_env->starts_with("rtsp://")) {
      return from_env;
    }
    if (camera.rtsp_url && camera.rtsp_url->find("***") == std::string::npos) {
      return camera.rtsp_url;
    }
    error = "credentials_ref is set but did not resolve to an RTSP URL for camera " + camera.camera_id;
    return std::nullopt;
  }

  if (camera.rtsp_url && camera.rtsp_url->find("***") == std::string::npos) {
    return camera.rtsp_url;
  }

  error = "rtsp_url is missing or masked; provide a full URL through credentials_ref env var";
  return std::nullopt;
}

cv::Mat make_synthetic_frame(const std::string& camera_id, int sequence, const std::string& profile_id) {
  cv::Mat frame(720, 1280, CV_8UC3, cv::Scalar(30, 45, 60));
  const int stripe = (sequence * 17) % frame.cols;
  cv::rectangle(frame, cv::Rect(stripe, 0, 80, frame.rows), cv::Scalar(90, 160, 210), cv::FILLED);
  cv::putText(frame, "drakon-server dry-run", cv::Point(60, 120), cv::FONT_HERSHEY_SIMPLEX,
              1.4, cv::Scalar(245, 245, 245), 2, cv::LINE_AA);
  cv::putText(frame, "camera=" + camera_id, cv::Point(60, 190), cv::FONT_HERSHEY_SIMPLEX,
              0.9, cv::Scalar(230, 230, 230), 2, cv::LINE_AA);
  cv::putText(frame, "profile=" + profile_id + " seq=" + std::to_string(sequence),
              cv::Point(60, 250), cv::FONT_HERSHEY_SIMPLEX, 0.9, cv::Scalar(230, 230, 230),
              2, cv::LINE_AA);
  return frame;
}

int dry_run_capture(
    const config::DrakonConfig& config,
    const config::CameraConfig& camera,
    const std::vector<config::CaptureProfileConfig>& profiles,
    const CaptureTestOptions& options,
    CaptureTestResult& result) {
  frame_store::FrameStore store(config.runtime.data_root, config.capture.profiles);
  const std::string session_id = now_session_id(camera.camera_id);
  result.capture_session_id = session_id;

  int sequence = 0;
  for (const auto& profile : profiles) {
    const int frame_count = std::max(1, static_cast<int>(std::ceil(options.seconds * profile.fps)));
    for (int i = 0; i < frame_count; ++i) {
      ++sequence;
      const auto timestamp =
          std::chrono::system_clock::now() +
          std::chrono::milliseconds(static_cast<int>(1000.0 * i / std::max(1.0, profile.fps)));
      frame_store::FrameStoreRequest request;
      request.camera_id = camera.camera_id;
      request.capture_session_id = session_id;
      request.fps_profile = profile.profile_id;
      request.sequence = sequence;
      request.source = "dry-run";
      request.timezone = config.runtime.timezone;
      request.dry_run = true;
      request.timestamp_utc = timestamp;
      request.image = make_synthetic_frame(camera.camera_id, sequence, profile.profile_id);

      auto write_result = store.store(request);
      if (!write_result.ok) {
        result.errors.push_back(write_result.error);
        return sequence - 1;
      }
      ++result.frames_saved;
    }
  }

  return result.frames_saved;
}

bool open_capture_source(
    const config::CameraConfig& camera,
    cv::VideoCapture& capture,
    std::string& source_uri_masked,
    std::string& error) {
  if (camera.source_type == "rtsp") {
    const auto rtsp_url = resolve_rtsp_url(camera, error);
    if (!rtsp_url) {
      return false;
    }
    source_uri_masked = runtime::redact_uri_credentials(*rtsp_url);
    if (!capture.open(*rtsp_url, cv::CAP_FFMPEG)) {
      error = "failed to open RTSP source for camera " + camera.camera_id;
      return false;
    }
    return true;
  }

  if (camera.source_type == "webcam") {
    if (camera.device_path) {
      source_uri_masked = *camera.device_path;
      if (!capture.open(*camera.device_path, cv::CAP_V4L2) && !capture.open(*camera.device_path)) {
        error = "failed to open webcam device for camera " + camera.camera_id;
        return false;
      }
      return true;
    }

    source_uri_masked = "webcam_index:" + std::to_string(camera.webcam_index);
    if (!capture.open(camera.webcam_index, cv::CAP_V4L2) && !capture.open(camera.webcam_index)) {
      error = "failed to open webcam index for camera " + camera.camera_id;
      return false;
    }
    return true;
  }

  if (camera.source_type == "file") {
    const std::string path = camera.source_path.value_or(camera.device_path.value_or(""));
    source_uri_masked = path;
    if (path.empty() || !capture.open(path, cv::CAP_FFMPEG)) {
      error = "failed to open file source for camera " + camera.camera_id;
      return false;
    }
    return true;
  }

  error = "camera source type does not require a real capture source";
  return false;
}

void maybe_check_database_catalog(const config::DrakonConfig& config, CaptureTestResult& result) {
  if (config.database.type != "sqlite" || config.database.path.empty()) {
    return;
  }
  std::error_code ec;
  if (!std::filesystem::exists(config.database.path, ec)) {
    return;
  }

  std::vector<std::string> errors;
  const auto rows = database::list_cameras(config, errors);
  if (!errors.empty()) {
    result.messages.push_back("database camera catalog could not be read; using config camera");
    return;
  }

  for (const auto& row : rows) {
    if (row.camera_id == result.camera_id) {
      result.messages.push_back("camera catalog verified in sqlite");
      return;
    }
  }
  result.messages.push_back("camera not present in sqlite catalog; using config camera");
}

}  // namespace

std::string ffmpeg_version_summary() {
  std::ostringstream out;
  out << "libavformat=" << LIBAVFORMAT_VERSION_MAJOR << "."
      << LIBAVFORMAT_VERSION_MINOR << "." << LIBAVFORMAT_VERSION_MICRO
      << " runtime=" << avformat_version();
  return out.str();
}

CaptureTestResult run_capture_test(const config::DrakonConfig& config, const CaptureTestOptions& options) {
  CaptureTestResult result;
  result.camera_id = options.camera_id;

  if (options.seconds <= 0) {
    result.errors.push_back("--seconds must be greater than zero");
    return result;
  }

  const auto* camera = find_camera_config(config, options.camera_id);
  if (camera == nullptr) {
    result.errors.push_back("camera not found in config: " + options.camera_id);
    return result;
  }

  maybe_check_database_catalog(config, result);

  auto profiles = active_profiles(config, *camera);
  if (profiles.empty()) {
    result.errors.push_back("camera has no enabled capture profiles");
    return result;
  }

  result.messages.push_back("capture backend: OpenCV VideoCapture; " + ffmpeg_version_summary());

  if (options.dry_run || camera->source_type == "test") {
    dry_run_capture(config, *camera, profiles, options, result);
    result.ok = result.errors.empty();
    return result;
  }

  cv::VideoCapture capture;
  std::string source_uri_masked;
  std::string open_error;
  if (!open_capture_source(*camera, capture, source_uri_masked, open_error)) {
    result.errors.push_back(open_error);
    return result;
  }

  const std::string session_id = now_session_id(camera->camera_id);
  result.capture_session_id = session_id;
  frame_store::FrameStore store(config.runtime.data_root, config.capture.profiles);

  std::map<std::string, std::chrono::steady_clock::time_point> next_due;
  for (const auto& profile : profiles) {
    next_due[profile.profile_id] = std::chrono::steady_clock::now();
  }

  const auto started = std::chrono::steady_clock::now();
  const auto deadline = started + std::chrono::seconds(options.seconds);
  int sequence = 0;
  while (std::chrono::steady_clock::now() < deadline) {
    cv::Mat frame;
    if (!capture.read(frame) || frame.empty()) {
      result.errors.push_back("capture source returned no frame for camera " + camera->camera_id);
      break;
    }

    const auto now = std::chrono::steady_clock::now();
    for (const auto& profile : profiles) {
      if (now < next_due[profile.profile_id]) {
        continue;
      }

      ++sequence;
      frame_store::FrameStoreRequest request;
      request.camera_id = camera->camera_id;
      request.capture_session_id = session_id;
      request.fps_profile = profile.profile_id;
      request.sequence = sequence;
      request.source = source_uri_masked;
      request.timezone = config.runtime.timezone;
      request.dry_run = false;
      request.timestamp_utc = std::chrono::system_clock::now();
      request.image = frame;

      auto write_result = store.store(request);
      if (!write_result.ok) {
        result.errors.push_back(write_result.error);
        break;
      }
      ++result.frames_saved;
      const auto interval_ms = std::max(1, static_cast<int>(std::round(1000.0 / profile.fps)));
      next_due[profile.profile_id] = now + std::chrono::milliseconds(interval_ms);
    }

    if (!result.errors.empty()) {
      break;
    }
  }

  result.ok = result.errors.empty() && result.frames_saved > 0;
  if (!result.ok && result.errors.empty()) {
    result.errors.push_back("capture completed without saving frames");
  }
  return result;
}

}  // namespace drakon::camera

#include "PortalCounter.h"

#include "../logging/Logging.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_set>
#include <unordered_map>
#include <utility>
#include <vector>

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <opencv2/video.hpp>
#include <opencv2/videoio.hpp>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>
#endif

namespace fs = std::filesystem;

namespace {
    constexpr int kBackgroundHistory = 500;
    constexpr double kBackgroundVarThreshold = 45.0;
    constexpr int kMinBlobWidth = 25;
    constexpr int kMinBlobHeight = 60;
    constexpr int kMatchDistancePx = 90;
    constexpr int kThresholdBinary = 200;
    constexpr double kBoundaryMarginFraction = 0.08;
    constexpr int kBoundaryMarginMinPx = 20;
    constexpr int kBoundaryMarginMaxPx = 80;

    struct Detection_ {
        float centroidX = 0.0f;
        float centroidY = 0.0f;
        int x = 0;
        int y = 0;
        int width = 0;
        int height = 0;
        double area = 0.0;
    };

    struct BoundaryMetrics_ {
        int edgeIndex = -1;
        double boundaryDistancePx = 0.0;
        double interiorDistancePx = 0.0;
    };

    struct PolygonGate_ {
        int topY = 0;
        int centerY = 0;
        int bottomY = 0;
        int entryThresholdY = 0;
        int exitThresholdY = 0;
    };

    struct TrackState_ {
        int trackId = -1;
        float centroidX = 0.0f;
        float centroidY = 0.0f;
        int x = 0;
        int y = 0;
        int width = 0;
        int height = 0;
        int firstFrame = 0;
        int lastFrame = 0;
        int seenFrames = 1;
        int missedFrames = 0;
        float firstX = 0.0f;
        float firstY = 0.0f;
        float minX = 0.0f;
        float maxX = 0.0f;
        float minY = 0.0f;
        float maxY = 0.0f;
        int maxBottomY = 0;
        double pathLengthPx = 0.0;
        bool counted = false;
        bool touchedPolygon = false;
        bool bboxTouchedPolygon = false;
        bool centroidEnteredPolygon = false;
        bool segmentIntersectedPolygon = false;
        int polygonTouchFrames = 0;
        int firstTouchFrame = -1;
        int lastTouchFrame = -1;
        float firstTouchY = 0.0f;
        float lastTouchY = 0.0f;
        int lastVisibleFrameIndex = 0;
        std::string lastVisibleUtcIso;
        cv::Mat lastVisibleFrame;
    };

    struct TempPathCleanup_ {
        std::vector<fs::path> paths;

        void add(const fs::path& path) {
            if (!path.empty()) {
                paths.push_back(path);
            }
        }

        ~TempPathCleanup_() {
            for (auto it = paths.rbegin(); it != paths.rend(); ++it) {
                std::error_code ec;
                fs::remove_all(*it, ec);
            }
        }
    };

    static std::string base64EncodeBytes_(const unsigned char* data, size_t len) {
        static constexpr std::array<char, 64> kAlphabet = {
            'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P',
            'Q','R','S','T','U','V','W','X','Y','Z','a','b','c','d','e','f',
            'g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v',
            'w','x','y','z','0','1','2','3','4','5','6','7','8','9','+','/'
        };

        std::string out;
        out.reserve(((len + 2) / 3) * 4);

        size_t index = 0;
        while (index + 2 < len) {
            const unsigned int block =
                (static_cast<unsigned int>(data[index]) << 16) |
                (static_cast<unsigned int>(data[index + 1]) << 8) |
                static_cast<unsigned int>(data[index + 2]);
            out.push_back(kAlphabet[(block >> 18) & 0x3F]);
            out.push_back(kAlphabet[(block >> 12) & 0x3F]);
            out.push_back(kAlphabet[(block >> 6) & 0x3F]);
            out.push_back(kAlphabet[block & 0x3F]);
            index += 3;
        }

        if (index < len) {
            const unsigned int first = static_cast<unsigned int>(data[index]);
            const unsigned int second = (index + 1 < len)
                ? static_cast<unsigned int>(data[index + 1])
                : 0u;
            const unsigned int block = (first << 16) | (second << 8);
            out.push_back(kAlphabet[(block >> 18) & 0x3F]);
            out.push_back(kAlphabet[(block >> 12) & 0x3F]);
            if (index + 1 < len) {
                out.push_back(kAlphabet[(block >> 6) & 0x3F]);
            }
            else {
                out.push_back('=');
            }
            out.push_back('=');
        }

        return out;
    }

    static std::string jpegMatToDataUrl_(const cv::Mat& frame) {
        if (frame.empty()) return std::string();
        std::vector<unsigned char> encoded;
        if (!cv::imencode(".jpg", frame, encoded) || encoded.empty()) {
            return std::string();
        }
        return "data:image/jpeg;base64," +
            base64EncodeBytes_(encoded.data(), encoded.size());
    }

    static bool parseUtcIso_(const std::string& rawIso, std::chrono::system_clock::time_point& out) {
        if (rawIso.size() < 19) return false;

        std::tm tmUtc{};
        try {
            tmUtc.tm_year = std::stoi(rawIso.substr(0, 4)) - 1900;
            tmUtc.tm_mon = std::stoi(rawIso.substr(5, 2)) - 1;
            tmUtc.tm_mday = std::stoi(rawIso.substr(8, 2));
            tmUtc.tm_hour = std::stoi(rawIso.substr(11, 2));
            tmUtc.tm_min = std::stoi(rawIso.substr(14, 2));
            tmUtc.tm_sec = std::stoi(rawIso.substr(17, 2));
            tmUtc.tm_isdst = 0;
        }
        catch (...) {
            return false;
        }

#ifdef _WIN32
        const std::time_t tt = _mkgmtime(&tmUtc);
#else
        const std::time_t tt = timegm(&tmUtc);
#endif
        if (tt == static_cast<std::time_t>(-1)) return false;
        out = std::chrono::system_clock::from_time_t(tt);
        return true;
    }

    static std::string formatUtcIso_(
        const std::chrono::system_clock::time_point& tp) {
        const auto tt = std::chrono::system_clock::to_time_t(tp);
        std::tm tmUtc{};
#ifdef _WIN32
        gmtime_s(&tmUtc, &tt);
#else
        gmtime_r(&tt, &tmUtc);
#endif
        char buffer[32];
        if (std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &tmUtc) == 0) {
            return std::string();
        }
        return std::string(buffer);
    }

    static std::string timestampForFrame_(
        const std::string& windowStartUtcIso,
        int frameIndex,
        double fps) {
        if (windowStartUtcIso.empty() || fps <= 0.0 || frameIndex < 0) {
            return std::string();
        }
        std::chrono::system_clock::time_point startTp{};
        if (!parseUtcIso_(windowStartUtcIso, startTp)) {
            return std::string();
        }
        const auto deltaMs = static_cast<long long>(
            std::llround((static_cast<double>(frameIndex) / fps) * 1000.0));
        return formatUtcIso_(startTp + std::chrono::milliseconds(deltaMs));
    }

    static double durationSecondsBetweenUtcIso_(
        const std::string& startUtcIso,
        const std::string& endUtcIso) {
        if (startUtcIso.empty() || endUtcIso.empty()) {
            return 0.0;
        }

        std::chrono::system_clock::time_point startTp{};
        std::chrono::system_clock::time_point endTp{};
        if (!parseUtcIso_(startUtcIso, startTp) || !parseUtcIso_(endUtcIso, endTp) || endTp <= startTp) {
            return 0.0;
        }

        return static_cast<double>(
            std::chrono::duration_cast<std::chrono::milliseconds>(endTp - startTp).count()) /
            1000.0;
    }

    static std::vector<cv::Point> polygonToPixels_(
        const JobAnalysisRegion& region,
        const cv::Size& size) {
        std::vector<cv::Point> polygon;
        polygon.reserve(region.polygon_norm.size());
        for (const auto& point : region.polygon_norm) {
            const int px = std::clamp(
                static_cast<int>(std::lround(point.x * static_cast<double>(size.width - 1))),
                0,
                (std::max)(0, size.width - 1));
            const int py = std::clamp(
                static_cast<int>(std::lround(point.y * static_cast<double>(size.height - 1))),
                0,
                (std::max)(0, size.height - 1));
            polygon.emplace_back(px, py);
        }
        return polygon;
    }

    static cv::Mat buildRoiMask_(
        const cv::Size& size,
        const std::vector<cv::Point>& polygon) {
        cv::Mat mask(size, CV_8U, cv::Scalar(0));
        if (polygon.size() >= 3) {
            std::vector<std::vector<cv::Point>> polygons{ polygon };
            cv::fillPoly(mask, polygons, cv::Scalar(255));
        }
        return mask;
    }

    static cv::Rect frameWindowToPixels_(
        const JobFrameWindowNorm& frameWindowNorm,
        const cv::Size& size) {
        if (!frameWindowNorm.enabled || size.width <= 0 || size.height <= 0) {
            return cv::Rect(0, 0, size.width, size.height);
        }

        const double clampedX = std::clamp(frameWindowNorm.x, 0.0, 1.0);
        const double clampedY = std::clamp(frameWindowNorm.y, 0.0, 1.0);
        const double clampedWidth = std::clamp(frameWindowNorm.width, 0.0, 1.0);
        const double clampedHeight = std::clamp(frameWindowNorm.height, 0.0, 1.0);

        const int x1 = std::clamp(
            static_cast<int>(std::lround(clampedX * static_cast<double>(size.width))),
            0,
            size.width);
        const int y1 = std::clamp(
            static_cast<int>(std::lround(clampedY * static_cast<double>(size.height))),
            0,
            size.height);
        const int x2 = std::clamp(
            static_cast<int>(std::lround((clampedX + clampedWidth) * static_cast<double>(size.width))),
            x1 + 1,
            size.width);
        const int y2 = std::clamp(
            static_cast<int>(std::lround((clampedY + clampedHeight) * static_cast<double>(size.height))),
            y1 + 1,
            size.height);
        return cv::Rect(cv::Point(x1, y1), cv::Point(x2, y2));
    }

    static cv::Mat buildDetectionMask_(
        const cv::Size& size,
        const JobAnalysisRegion& region,
        const std::vector<cv::Point>& polygon) {
        cv::Mat mask(size, CV_8U, cv::Scalar(0));
        if (region.full_frame) {
            mask.setTo(cv::Scalar(255));
            return mask;
        }

        const cv::Rect frameWindow = frameWindowToPixels_(region.frame_window_norm, size);
        if (frameWindow.width > 0 && frameWindow.height > 0) {
            mask(frameWindow).setTo(cv::Scalar(255));
            return mask;
        }

        if (!polygon.empty()) {
            const cv::Rect polygonBounds = cv::boundingRect(polygon);
            if (polygonBounds.width > 0 && polygonBounds.height > 0) {
                mask(polygonBounds).setTo(cv::Scalar(255));
            }
        }

        return mask;
    }

    static double pointToSegmentDistance_(
        const cv::Point2f& point,
        const cv::Point2f& a,
        const cv::Point2f& b) {
        const cv::Point2f ab = b - a;
        const float abLenSq = ab.dot(ab);
        if (abLenSq <= 1e-6f) {
            return std::hypot(point.x - a.x, point.y - a.y);
        }
        const float t = std::clamp(((point - a).dot(ab)) / abLenSq, 0.0f, 1.0f);
        const cv::Point2f projection = a + (ab * t);
        return std::hypot(point.x - projection.x, point.y - projection.y);
    }

    static BoundaryMetrics_ computeBoundaryMetrics_(
        const cv::Point2f& point,
        const std::vector<cv::Point>& polygon) {
        BoundaryMetrics_ metrics;
        if (polygon.size() < 3) return metrics;

        const std::vector<cv::Point2f> polygonF(
            polygon.begin(),
            polygon.end());
        metrics.interiorDistancePx = cv::pointPolygonTest(polygonF, point, true);

        double bestDistance = std::numeric_limits<double>::max();
        int bestEdge = -1;
        for (size_t i = 0; i < polygonF.size(); ++i) {
            const cv::Point2f& a = polygonF[i];
            const cv::Point2f& b = polygonF[(i + 1) % polygonF.size()];
            const double distance = pointToSegmentDistance_(point, a, b);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestEdge = static_cast<int>(i);
            }
        }

        metrics.edgeIndex = bestEdge;
        metrics.boundaryDistancePx =
            std::isfinite(bestDistance) ? bestDistance : 0.0;
        return metrics;
    }

    static int computeBoundaryMarginPx_(const std::vector<cv::Point>& polygon) {
        if (polygon.empty()) return 24;
        const cv::Rect bbox = cv::boundingRect(polygon);
        const int base = static_cast<int>(std::lround(
            (std::min)(bbox.width, bbox.height) * kBoundaryMarginFraction));
        return std::clamp(base, kBoundaryMarginMinPx, kBoundaryMarginMaxPx);
    }

    static PolygonGate_ computePolygonGate_(const std::vector<cv::Point>& polygon) {
        PolygonGate_ gate;
        if (polygon.size() < 3) return gate;

        const cv::Rect bbox = cv::boundingRect(polygon);
        const int gateHeight = (std::max)(1, bbox.height);
        const int originSlackPx = (std::clamp)(
            static_cast<int>(std::lround(static_cast<double>(gateHeight) * 0.15)),
            6,
            24);
        const int exitSlackPx = (std::clamp)(
            static_cast<int>(std::lround(static_cast<double>(gateHeight) * 0.10)),
            4,
            18);

        gate.topY = bbox.y;
        gate.centerY = bbox.y + (bbox.height / 2);
        gate.bottomY = bbox.y + (std::max)(0, bbox.height - 1);
        gate.entryThresholdY = gate.centerY + originSlackPx;
        gate.exitThresholdY = gate.bottomY + exitSlackPx;
        return gate;
    }

    static double cross2d_(
        const cv::Point2f& a,
        const cv::Point2f& b,
        const cv::Point2f& c) {
        return
            static_cast<double>(b.x - a.x) * static_cast<double>(c.y - a.y) -
            static_cast<double>(b.y - a.y) * static_cast<double>(c.x - a.x);
    }

    static bool pointOnSegment_(
        const cv::Point2f& point,
        const cv::Point2f& a,
        const cv::Point2f& b) {
        constexpr double kEpsilon = 1e-4;
        return
            point.x <= (std::max)(a.x, b.x) + kEpsilon &&
            point.x + kEpsilon >= (std::min)(a.x, b.x) &&
            point.y <= (std::max)(a.y, b.y) + kEpsilon &&
            point.y + kEpsilon >= (std::min)(a.y, b.y);
    }

    static bool segmentsIntersect_(
        const cv::Point2f& a1,
        const cv::Point2f& a2,
        const cv::Point2f& b1,
        const cv::Point2f& b2) {
        constexpr double kEpsilon = 1e-4;

        const double d1 = cross2d_(a1, a2, b1);
        const double d2 = cross2d_(a1, a2, b2);
        const double d3 = cross2d_(b1, b2, a1);
        const double d4 = cross2d_(b1, b2, a2);

        const auto oppositeSigns = [&](double left, double right) {
            return (left > kEpsilon && right < -kEpsilon) ||
                (left < -kEpsilon && right > kEpsilon);
        };

        if (oppositeSigns(d1, d2) && oppositeSigns(d3, d4)) {
            return true;
        }
        if (std::abs(d1) <= kEpsilon && pointOnSegment_(b1, a1, a2)) return true;
        if (std::abs(d2) <= kEpsilon && pointOnSegment_(b2, a1, a2)) return true;
        if (std::abs(d3) <= kEpsilon && pointOnSegment_(a1, b1, b2)) return true;
        if (std::abs(d4) <= kEpsilon && pointOnSegment_(a2, b1, b2)) return true;
        return false;
    }

    static bool segmentIntersectsPolygon_(
        const cv::Point2f& start,
        const cv::Point2f& end,
        const std::vector<cv::Point>& polygon) {
        if (polygon.size() < 3) return false;

        const std::vector<cv::Point2f> polygonF(
            polygon.begin(),
            polygon.end());
        if (cv::pointPolygonTest(polygonF, start, false) >= 0.0 ||
            cv::pointPolygonTest(polygonF, end, false) >= 0.0) {
            return true;
        }

        for (size_t index = 0; index < polygonF.size(); ++index) {
            const cv::Point2f& a = polygonF[index];
            const cv::Point2f& b = polygonF[(index + 1) % polygonF.size()];
            if (segmentsIntersect_(start, end, a, b)) {
                return true;
            }
        }
        return false;
    }

    static bool detectionBboxTouchesPolygon_(
        const Detection_& detection,
        const cv::Mat& polygonMask) {
        if (polygonMask.empty()) return false;

        cv::Rect bbox(detection.x, detection.y, detection.width, detection.height);
        bbox &= cv::Rect(0, 0, polygonMask.cols, polygonMask.rows);
        if (bbox.width <= 0 || bbox.height <= 0) return false;
        return cv::countNonZero(polygonMask(bbox)) > 0;
    }

    static std::vector<Detection_> detectPeople_(
        const cv::Mat& frame,
        const cv::Mat& detectionMask,
        cv::Ptr<cv::BackgroundSubtractor>& subtractor,
        const PortalCounterConfig& config) {
        std::vector<Detection_> detections;
        if (frame.empty()) return detections;

        cv::Mat gray;
        cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
        cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0.0);

        cv::Mat foregroundMask;
        subtractor->apply(gray, foregroundMask);
        cv::bitwise_and(foregroundMask, detectionMask, foregroundMask);
        cv::threshold(foregroundMask, foregroundMask, kThresholdBinary, 255, cv::THRESH_BINARY);

        const cv::Mat openKernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(5, 5));
        const cv::Mat closeKernel = cv::getStructuringElement(cv::MORPH_ELLIPSE, cv::Size(7, 7));
        cv::morphologyEx(foregroundMask, foregroundMask, cv::MORPH_OPEN, openKernel, cv::Point(-1, -1), 1);
        cv::morphologyEx(foregroundMask, foregroundMask, cv::MORPH_CLOSE, closeKernel, cv::Point(-1, -1), 2);
        cv::dilate(foregroundMask, foregroundMask, closeKernel, cv::Point(-1, -1), 1);

        std::vector<std::vector<cv::Point>> contours;
        cv::findContours(
            foregroundMask,
            contours,
            cv::RETR_EXTERNAL,
            cv::CHAIN_APPROX_SIMPLE);

        for (const auto& contour : contours) {
            const double area = cv::contourArea(contour);
            if (area < static_cast<double>(config.min_area) ||
                area > static_cast<double>(config.max_area)) {
                continue;
            }

            const cv::Rect bbox = cv::boundingRect(contour);
            if (bbox.width < kMinBlobWidth || bbox.height < kMinBlobHeight) {
                continue;
            }

            const cv::Point2f centroid(
                bbox.x + static_cast<float>(bbox.width) / 2.0f,
                bbox.y + static_cast<float>(bbox.height) / 2.0f);

            Detection_ detection;
            detection.centroidX = centroid.x;
            detection.centroidY = centroid.y;
            detection.x = bbox.x;
            detection.y = bbox.y;
            detection.width = bbox.width;
            detection.height = bbox.height;
            detection.area = area;
            detections.push_back(std::move(detection));
        }

        return detections;
    }

    static std::tuple<
        std::vector<std::pair<int, int>>,
        std::unordered_set<int>,
        std::unordered_set<int>>
    assignDetections_(
        const std::unordered_map<int, TrackState_>& tracks,
        const std::vector<Detection_>& detections) {
        struct Candidate_ {
            double distance = 0.0;
            int trackId = -1;
            int detectionIndex = -1;
        };

        std::vector<Candidate_> candidates;
        for (const auto& [trackId, track] : tracks) {
            for (size_t detectionIndex = 0; detectionIndex < detections.size(); ++detectionIndex) {
                const auto& detection = detections[detectionIndex];
                const double distance = std::hypot(
                    static_cast<double>(track.centroidX - detection.centroidX),
                    static_cast<double>(track.centroidY - detection.centroidY));
                if (distance <= static_cast<double>(kMatchDistancePx)) {
                    candidates.push_back(Candidate_{
                        distance,
                        trackId,
                        static_cast<int>(detectionIndex) });
                }
            }
        }

        std::sort(
            candidates.begin(),
            candidates.end(),
            [](const Candidate_& a, const Candidate_& b) {
                if (a.distance != b.distance) return a.distance < b.distance;
                if (a.trackId != b.trackId) return a.trackId < b.trackId;
                return a.detectionIndex < b.detectionIndex;
            });

        std::vector<std::pair<int, int>> assignments;
        std::unordered_set<int> usedTracks;
        std::unordered_set<int> usedDetections;
        for (const auto& candidate : candidates) {
            if (usedTracks.count(candidate.trackId) > 0 ||
                usedDetections.count(candidate.detectionIndex) > 0) {
                continue;
            }
            assignments.emplace_back(candidate.trackId, candidate.detectionIndex);
            usedTracks.insert(candidate.trackId);
            usedDetections.insert(candidate.detectionIndex);
        }

        return { assignments, usedTracks, usedDetections };
    }

    static void drawPolygonAndCounter_(
        cv::Mat& frame,
        const std::vector<cv::Point>& polygon,
        int totalCount) {
        if (frame.empty()) return;
        if (polygon.size() >= 3) {
            cv::polylines(frame, std::vector<std::vector<cv::Point>>{ polygon }, true, cv::Scalar(0, 255, 255), 2);
        }
        cv::putText(
            frame,
            "Portal count: " + std::to_string(totalCount),
            cv::Point(20, 34),
            cv::FONT_HERSHEY_SIMPLEX,
            0.8,
            cv::Scalar(255, 255, 255),
            2,
            cv::LINE_AA);
    }

    static void drawTrack_(
        cv::Mat& frame,
        const TrackState_& track,
        const cv::Scalar& color,
        const std::string& suffix = std::string()) {
        if (frame.empty()) return;
        const cv::Point topLeft(track.x, track.y);
        const cv::Point bottomRight(track.x + track.width, track.y + track.height);
        cv::rectangle(frame, topLeft, bottomRight, color, 2);
        std::string label = "ID " + std::to_string(track.trackId);
        if (!suffix.empty()) {
            label += " " + suffix;
        }
        cv::putText(
            frame,
            label,
            cv::Point(track.x, (std::max)(18, track.y - 8)),
            cv::FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
            cv::LINE_AA);
    }

    static cv::Mat renderAnnotatedFrame_(
        const cv::Mat& frame,
        const std::vector<cv::Point>& polygon,
        const std::unordered_map<int, TrackState_>& tracks,
        int totalCount) {
        cv::Mat annotated = frame.clone();
        drawPolygonAndCounter_(annotated, polygon, totalCount);
        for (const auto& [trackId, track] : tracks) {
            (void)trackId;
            if (track.missedFrames > 0) continue;
            drawTrack_(
                annotated,
                track,
                track.counted ? cv::Scalar(0, 215, 255) : cv::Scalar(0, 255, 0));
        }
        return annotated;
    }

    static cv::Mat renderProofFrame_(
        const TrackState_& track,
        const std::vector<cv::Point>& polygon,
        int totalCount) {
        cv::Mat proof = track.lastVisibleFrame.clone();
        drawPolygonAndCounter_(proof, polygon, totalCount);
        drawTrack_(proof, track, cv::Scalar(0, 165, 255), "COUNTED");
        return proof;
    }

    static bool trackQualifiesTraversal_(
        const TrackState_& track,
        const PortalCounterConfig& config,
        const PolygonGate_& gate,
        int processedFrames) {
        if (track.counted) return false;
        if (processedFrames < config.warmup_frames) return false;
        if (track.seenFrames < config.min_track_frames_for_count) return false;
        if (track.pathLengthPx < static_cast<double>(config.min_path_length_px)) return false;
        if (!track.touchedPolygon) return false;

        const double verticalTravelPx =
            static_cast<double>(track.maxY - track.minY);
        const double horizontalTravelPx =
            static_cast<double>(track.maxX - track.minX);
        const double netDeltaYPx =
            static_cast<double>(track.centroidY - track.firstY);
        const bool startsAboveGate =
            track.firstY <= static_cast<float>(gate.entryThresholdY) ||
            track.minY <= static_cast<float>(gate.entryThresholdY);
        const bool exitsBelowGate =
            track.maxBottomY >= gate.exitThresholdY ||
            track.maxY >= static_cast<float>(gate.exitThresholdY);

        if (!startsAboveGate) return false;
        if (!exitsBelowGate) return false;
        if (netDeltaYPx < (std::max)(20.0, static_cast<double>(config.min_path_length_px) * 0.55)) {
            return false;
        }
        if (verticalTravelPx < static_cast<double>(config.min_path_length_px)) return false;
        if (horizontalTravelPx > verticalTravelPx * 1.35) return false;
        if (!track.segmentIntersectedPolygon &&
            !track.bboxTouchedPolygon &&
            !track.centroidEnteredPolygon) {
            return false;
        }
        return true;
    }

    static json buildTrackDiagnostic_(
        const TrackState_& track,
        const PortalCounterConfig& config,
        const PolygonGate_& gate,
        int processedFrames) {
        const double verticalTravelPx =
            static_cast<double>(track.maxY - track.minY);
        const double horizontalTravelPx =
            static_cast<double>(track.maxX - track.minX);
        const double netDeltaYPx =
            static_cast<double>(track.centroidY - track.firstY);
        const bool qualifies =
            trackQualifiesTraversal_(track, config, gate, processedFrames);

        return json{
            { "track_id", track.trackId },
            { "seen_frames", track.seenFrames },
            { "first_frame", track.firstFrame },
            { "last_frame", track.lastFrame },
            { "first_y", track.firstY },
            { "last_y", track.centroidY },
            { "min_y", track.minY },
            { "max_y", track.maxY },
            { "max_bottom_y", track.maxBottomY },
            { "path_length_px", track.pathLengthPx },
            { "vertical_travel_px", verticalTravelPx },
            { "horizontal_travel_px", horizontalTravelPx },
            { "net_delta_y_px", netDeltaYPx },
            { "touched_polygon", track.touchedPolygon },
            { "bbox_touched_polygon", track.bboxTouchedPolygon },
            { "centroid_entered_polygon", track.centroidEnteredPolygon },
            { "segment_intersected_polygon", track.segmentIntersectedPolygon },
            { "polygon_touch_frames", track.polygonTouchFrames },
            { "first_touch_frame", track.firstTouchFrame },
            { "last_touch_frame", track.lastTouchFrame },
            { "gate_entry_threshold_y", gate.entryThresholdY },
            { "gate_exit_threshold_y", gate.exitThresholdY },
            { "qualified", qualifies }
        };
    }

    static void maybeAppendProofImage_(
        json& groupImages,
        const TrackState_& track,
        const std::vector<cv::Point>& polygon,
        int totalCount,
        int maxProofFrames) {
        if (!groupImages.is_array() || groupImages.size() >= static_cast<size_t>(maxProofFrames)) {
            return;
        }
        if (track.lastVisibleFrame.empty()) return;

        const cv::Mat proofFrame = renderProofFrame_(track, polygon, totalCount);
        const std::string imageDataUrl = jpegMatToDataUrl_(proofFrame);
        if (imageDataUrl.empty()) return;

        json item = {
            { "image_jpeg_b64", imageDataUrl },
            { "track_id", track.trackId }
        };
        if (!track.lastVisibleUtcIso.empty()) {
            item["snapshot_ts_utc_iso"] = track.lastVisibleUtcIso;
        }
        groupImages.push_back(std::move(item));
    }

    static bool createVideoWriter_(
        const fs::path& outPath,
        double fps,
        const cv::Size& size,
        cv::VideoWriter& writer) {
        std::error_code ec;
        fs::create_directories(outPath.parent_path(), ec);

        const double safeFps = fps > 0.0 ? fps : 12.0;
        const std::array<int, 3> codecs = {
            cv::VideoWriter::fourcc('m', 'p', '4', 'v'),
            cv::VideoWriter::fourcc('a', 'v', 'c', '1'),
            cv::VideoWriter::fourcc('H', '2', '6', '4')
        };

        for (int codec : codecs) {
            writer.open(outPath.string(), codec, safeFps, size, true);
            if (writer.isOpened()) {
                return true;
            }
        }
        return false;
    }

#ifdef _WIN32
    static void ensureOpenCvVideoIoThreadReady_() {
        thread_local bool attempted = false;
        if (attempted) return;
        attempted = true;

        const HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (FAILED(hr) && hr != S_FALSE && hr != RPC_E_CHANGED_MODE) {
            try {
                Logger::instance().logDebugNoEscalation(
                    "job",
                    "PortalCounter: OpenCV video I/O CoInitializeEx failed hr=" + std::to_string(hr));
            }
            catch (...) {
            }
        }
    }
#else
    static void ensureOpenCvVideoIoThreadReady_() {}
#endif

    static const char* videoCaptureBackendName_(int backend) {
        switch (backend) {
        case cv::CAP_FFMPEG:
            return "CAP_FFMPEG";
        case cv::CAP_MSMF:
            return "CAP_MSMF";
        case cv::CAP_ANY:
            return "CAP_ANY";
        default:
            return "CAP_UNKNOWN";
        }
    }

    static bool openVideoCapture_(
        const std::string& inputVideoPath,
        cv::VideoCapture& capture,
        std::string* outFailureDetails = nullptr) {
        const fs::path videoPath(inputVideoPath);
        if (inputVideoPath.empty()) {
            capture.release();
            if (outFailureDetails) {
                *outFailureDetails = "empty input path";
            }
            return false;
        }

        ensureOpenCvVideoIoThreadReady_();

        const std::array<int, 3> backends = {
            cv::CAP_FFMPEG,
            cv::CAP_MSMF,
            cv::CAP_ANY
        };

        constexpr int kMaxOpenAttempts = 4;
        constexpr auto kRetryDelay = std::chrono::milliseconds(75);
        std::ostringstream attempts;

        for (int attempt = 0; attempt < kMaxOpenAttempts; ++attempt) {
            for (int backend : backends) {
                capture.release();
                const bool opened = capture.open(videoPath.string(), backend);
                attempts
                    << "[attempt=" << (attempt + 1)
                    << ",backend=" << videoCaptureBackendName_(backend)
                    << ",opened=" << (opened ? "true" : "false")
                    << "]";
                if (capture.isOpened()) {
                    if (outFailureDetails) {
                        *outFailureDetails = attempts.str();
                    }
                    return true;
                }
            }

            if (attempt + 1 < kMaxOpenAttempts) {
                std::this_thread::sleep_for(kRetryDelay);
            }
        }

        capture.release();
        if (outFailureDetails) {
            *outFailureDetails = attempts.str();
        }
        return false;
    }

    static bool copyVideoToSafeOpenPath_(
        const fs::path& sourcePath,
        const fs::path& safePath,
        std::string* outErr = nullptr) {
        std::error_code ec;
        fs::create_directories(safePath.parent_path(), ec);
        if (ec) {
            if (outErr) {
                *outErr = "failed creating safe open dir: " + ec.message();
            }
            return false;
        }

        ec.clear();
        fs::copy_file(
            sourcePath,
            safePath,
            fs::copy_options::overwrite_existing,
            ec);
        if (ec) {
            if (outErr) {
                *outErr = "failed copying video to safe open path: " + ec.message();
            }
            return false;
        }
        return true;
    }

    static std::string describeInputVideoPath_(const std::string& inputVideoPath) {
        std::ostringstream oss;
        oss << inputVideoPath;

        std::error_code ec;
        const fs::path path(inputVideoPath);
        const bool exists = fs::exists(path, ec) && !ec;
        oss << " (exists=" << (exists ? "true" : "false");
        if (exists) {
            const auto bytes = fs::file_size(path, ec);
            if (!ec) {
                oss << ", bytes=" << bytes;
            }
        }
        oss << ")";
        return oss.str();
    }

    static bool waitForReadableInputVideoPath_(
        const fs::path& inputVideoPath,
        std::string* outErr = nullptr) {
        constexpr int kMaxAttempts = 8;
        constexpr auto kRetryDelay = std::chrono::milliseconds(50);

        for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
            std::error_code ec;
            const bool exists = fs::exists(inputVideoPath, ec) && !ec;
            const std::uintmax_t size = exists ? fs::file_size(inputVideoPath, ec) : 0;
            if (exists && !ec && size > 0) {
                std::ifstream ifs(inputVideoPath, std::ios::binary);
                if (ifs.good()) {
                    return true;
                }
            }
            if (attempt + 1 < kMaxAttempts) {
                std::this_thread::sleep_for(kRetryDelay);
            }
        }

        if (outErr) {
            *outErr =
                "video not readable yet: " +
                describeInputVideoPath_(inputVideoPath.string());
        }
        return false;
    }

    static std::string getExecutableDir_() {
#ifdef _WIN32
        char buffer[MAX_PATH];
        DWORD len = GetModuleFileNameA(nullptr, buffer, MAX_PATH);
        if (len == 0) {
            return std::string();
        }
        return fs::path(buffer).parent_path().string();
#else
        return fs::current_path().string();
#endif
    }

    static std::wstring utf8ToWide_(const std::string& str) {
#ifdef _WIN32
        if (str.empty()) return L"";
        const int sizeNeeded =
            MultiByteToWideChar(CP_UTF8, 0, str.c_str(), static_cast<int>(str.size()), nullptr, 0);
        std::wstring result(sizeNeeded, 0);
        MultiByteToWideChar(
            CP_UTF8,
            0,
            str.c_str(),
            static_cast<int>(str.size()),
            &result[0],
            sizeNeeded);
        return result;
#else
        return std::wstring(str.begin(), str.end());
#endif
    }

    static int runProcessAndWaitWin_(const std::wstring& cmdLine) {
#ifdef _WIN32
        STARTUPINFOW si{};
        si.cb = sizeof(si);

        PROCESS_INFORMATION pi{};
        std::wstring mutableCmd = cmdLine;

        const BOOL ok = CreateProcessW(
            nullptr,
            mutableCmd.data(),
            nullptr,
            nullptr,
            FALSE,
            CREATE_NO_WINDOW,
            nullptr,
            nullptr,
            &si,
            &pi);

        if (!ok) {
            return -1;
        }

        WaitForSingleObject(pi.hProcess, INFINITE);

        DWORD exitCode = 0;
        GetExitCodeProcess(pi.hProcess, &exitCode);

        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return static_cast<int>(exitCode);
#else
        (void)cmdLine;
        return -1;
#endif
    }

    static bool transcodeToWebMp4_(
        const fs::path& srcMp4Path,
        const fs::path& dstMp4Path,
        std::string* outErr = nullptr) {
        std::error_code ec;
        if (!fs::exists(srcMp4Path, ec) || ec) {
            if (outErr) *outErr = "src does not exist: " + srcMp4Path.string();
            return false;
        }

        fs::create_directories(dstMp4Path.parent_path(), ec);
        if (ec) {
            if (outErr) *outErr = "create_directories failed: " + ec.message();
            return false;
        }

        fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
        if (!fs::exists(ffmpegPath, ec) || ec) {
            std::error_code copyEc;
            fs::copy_file(srcMp4Path, dstMp4Path, fs::copy_options::overwrite_existing, copyEc);
            if (copyEc) {
                if (outErr) *outErr = "ffmpeg missing and copy failed: " + copyEc.message();
                return false;
            }
            return true;
        }

        const std::wstring ffmpegW = utf8ToWide_(ffmpegPath.string());
        const std::wstring inW = utf8ToWide_(srcMp4Path.string());
        const std::wstring outW = utf8ToWide_(dstMp4Path.string());

        const std::wstring cmdLine =
            L"\"" + ffmpegW + L"\""
            L" -y -hide_banner -loglevel error"
            L" -i \"" + inW + L"\""
            L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
            L" -an "
            L" \"" + outW + L"\"";

        const int rc = runProcessAndWaitWin_(cmdLine);
        if (rc != 0) {
            if (outErr) *outErr = "ffmpeg transcode failed rc=" + std::to_string(rc);
            std::error_code copyEc;
            fs::copy_file(srcMp4Path, dstMp4Path, fs::copy_options::overwrite_existing, copyEc);
            return !copyEc;
        }

        if (!fs::exists(dstMp4Path, ec) || ec) {
            if (outErr) *outErr = "output missing after ffmpeg: " + dstMp4Path.string();
            return false;
        }

        return true;
    }

    static bool encodeFramesToMp4WithFfmpeg_(
        const fs::path& framesDir,
        const fs::path& dstMp4Path,
        double fps,
        std::string* outErr = nullptr) {
        std::error_code ec;
        if (!fs::exists(framesDir, ec) || ec) {
            if (outErr) {
                *outErr = "frames dir does not exist: " + framesDir.string();
            }
            return false;
        }

        fs::create_directories(dstMp4Path.parent_path(), ec);
        if (ec) {
            if (outErr) {
                *outErr = "create_directories failed: " + ec.message();
            }
            return false;
        }

        fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
        if (!fs::exists(ffmpegPath, ec) || ec) {
            if (outErr) {
                *outErr = "ffmpeg missing for annotated video encoding: " + ffmpegPath.string();
            }
            return false;
        }

        const fs::path framePattern = framesDir / "frame_%06d.jpg";
        const double safeFps = fps > 0.0 ? fps : 12.0;
        std::ostringstream fpsStream;
        fpsStream << std::fixed << std::setprecision(3) << safeFps;

        const std::wstring ffmpegW = utf8ToWide_(ffmpegPath.string());
        const std::wstring patternW = utf8ToWide_(framePattern.string());
        const std::wstring outW = utf8ToWide_(dstMp4Path.string());
        const std::wstring fpsW = utf8ToWide_(fpsStream.str());

        const std::wstring cmdLine =
            L"\"" + ffmpegW + L"\""
            L" -y -hide_banner -loglevel error"
            L" -framerate " + fpsW +
            L" -i \"" + patternW + L"\""
            L" -c:v libx264 -pix_fmt yuv420p -movflags +faststart"
            L" -an "
            L" \"" + outW + L"\"";

        const int rc = runProcessAndWaitWin_(cmdLine);
        if (rc != 0) {
            if (outErr) {
                *outErr = "ffmpeg annotated video encode failed rc=" + std::to_string(rc);
            }
            return false;
        }

        if (!fs::exists(dstMp4Path, ec) || ec) {
            if (outErr) {
                *outErr = "annotated video output missing after ffmpeg: " + dstMp4Path.string();
            }
            return false;
        }

        return true;
    }

    static bool extractFramesWithFfmpeg_(
        const fs::path& srcMp4Path,
        const fs::path& framesDir,
        TempPathCleanup_& tempCleanup,
        std::vector<fs::path>& outFramePaths,
        std::string* outErr = nullptr) {
        outFramePaths.clear();

        std::error_code ec;
        if (!fs::exists(srcMp4Path, ec) || ec) {
            if (outErr) {
                *outErr = "src does not exist: " + srcMp4Path.string();
            }
            return false;
        }

        fs::remove_all(framesDir, ec);
        ec.clear();
        fs::create_directories(framesDir, ec);
        if (ec) {
            if (outErr) {
                *outErr = "failed creating frames dir: " + ec.message();
            }
            return false;
        }

        fs::path ffmpegPath = fs::path(getExecutableDir_()) / "ffmpeg.exe";
        if (!fs::exists(ffmpegPath, ec) || ec) {
            if (outErr) {
                *outErr = "ffmpeg missing for frame extraction: " + ffmpegPath.string();
            }
            return false;
        }

        const fs::path framePattern = framesDir / "frame_%06d.jpg";
        const std::wstring ffmpegW = utf8ToWide_(ffmpegPath.string());
        const std::wstring inW = utf8ToWide_(srcMp4Path.string());
        const std::wstring patternW = utf8ToWide_(framePattern.string());

        const std::wstring cmdLine =
            L"\"" + ffmpegW + L"\""
            L" -y -hide_banner -loglevel error"
            L" -i \"" + inW + L"\""
            L" -vsync 0 -q:v 2"
            L" \"" + patternW + L"\"";

        const int rc = runProcessAndWaitWin_(cmdLine);
        if (rc != 0) {
            if (outErr) {
                *outErr = "ffmpeg frame extraction failed rc=" + std::to_string(rc);
            }
            return false;
        }

        for (const auto& entry : fs::directory_iterator(framesDir, ec)) {
            if (ec) break;
            if (!entry.is_regular_file()) continue;
            const std::string ext = entry.path().extension().string();
            if (_stricmp(ext.c_str(), ".jpg") == 0 || _stricmp(ext.c_str(), ".jpeg") == 0) {
                outFramePaths.push_back(entry.path());
            }
        }

        std::sort(outFramePaths.begin(), outFramePaths.end());
        if (outFramePaths.empty()) {
            if (outErr) {
                *outErr = "ffmpeg extracted no readable frame files";
            }
            return false;
        }

        tempCleanup.add(framesDir);
        return true;
    }

    static bool openVideoCaptureWithFallback_(
        const fs::path& inputVideoPath,
        const fs::path& outputDir,
        TempPathCleanup_& tempCleanup,
        cv::VideoCapture& capture,
        std::string* outErr = nullptr) {
        std::string readableErr;
        if (!waitForReadableInputVideoPath_(inputVideoPath, &readableErr)) {
            if (outErr) *outErr = readableErr;
            return false;
        }

        std::string directOpenDetails;
        if (openVideoCapture_(inputVideoPath.string(), capture, &directOpenDetails)) {
            return true;
        }

        const fs::path safeOpenPath = outputDir / "portal_counter_input_open.mp4";
        std::string copyErr;
        if (!copyVideoToSafeOpenPath_(inputVideoPath, safeOpenPath, &copyErr)) {
            if (outErr) {
                *outErr =
                    "failed opening video: " + describeInputVideoPath_(inputVideoPath.string()) +
                    "; safe-copy error: " + copyErr;
            }
            return false;
        }
        tempCleanup.add(safeOpenPath);

        readableErr.clear();
        (void)waitForReadableInputVideoPath_(safeOpenPath, &readableErr);
        std::string safeOpenDetails;
        if (openVideoCapture_(safeOpenPath.string(), capture, &safeOpenDetails)) {
            return true;
        }

        const fs::path normalizedOpenPath = outputDir / "portal_counter_input_open.opencv_normalized.mp4";
        std::string normalizeErr;
        if (!transcodeToWebMp4_(safeOpenPath, normalizedOpenPath, &normalizeErr)) {
            if (outErr) {
                *outErr =
                    "failed opening video: " + describeInputVideoPath_(inputVideoPath.string()) +
                    "; safe_open=" + describeInputVideoPath_(safeOpenPath.string()) +
                    "; normalize_err=" + normalizeErr;
            }
            return false;
        }
        tempCleanup.add(normalizedOpenPath);

        readableErr.clear();
        if (!waitForReadableInputVideoPath_(normalizedOpenPath, &readableErr)) {
            if (outErr) {
                *outErr =
                    "normalized clip not readable yet normalized=" +
                    describeInputVideoPath_(normalizedOpenPath.string()) +
                    "; source=" + describeInputVideoPath_(inputVideoPath.string()) +
                    "; reason=" + readableErr;
            }
            return false;
        }

        std::string normalizedOpenDetails;
        if (openVideoCapture_(normalizedOpenPath.string(), capture, &normalizedOpenDetails)) {
            return true;
        }

        if (outErr) {
            *outErr =
                "failed opening video: " + describeInputVideoPath_(inputVideoPath.string()) +
                "; safe_open=" + describeInputVideoPath_(safeOpenPath.string()) +
                "; normalized_open=" + describeInputVideoPath_(normalizedOpenPath.string()) +
                "; open_attempts_direct=" + directOpenDetails +
                "; open_attempts_safe=" + safeOpenDetails +
                "; open_attempts_normalized=" + normalizedOpenDetails;
        }
        return false;
    }
}

PortalCounterResult runPortalCounterOnVideo(
    const std::string& inputVideoPath,
    const JobAnalysisRegion& region,
    const PortalCounterConfig& config,
    const std::string& outputDirectory,
    const std::string& windowStartUtcIso,
    const std::string& windowEndUtcIso) {
    PortalCounterResult result;

    try {
        if (inputVideoPath.empty()) {
            result.error = "empty input video path";
            return result;
        }
        if (region.polygon_norm.size() < 3) {
            result.error = "portal counter requires a polygon analysis region";
            return result;
        }

        fs::path outputDir = outputDirectory.empty()
            ? fs::path(inputVideoPath).parent_path()
            : fs::path(outputDirectory);
        std::error_code ec;
        fs::create_directories(outputDir, ec);

        TempPathCleanup_ tempInputCleanup;
        cv::VideoCapture capture;
        fs::path openPath = fs::path(inputVideoPath);
        std::string openErr;
        std::vector<fs::path> extractedFramePaths;
        cv::Mat prefetchedFrame;
        size_t nextExtractedFrameIndex = 0;
        bool usingExtractedFrames = false;
        std::string decodeMode = "opencv_capture";

        double fps = 12.0;
        int width = 0;
        int height = 0;
        if (!openVideoCaptureWithFallback_(
                openPath,
                outputDir,
                tempInputCleanup,
                capture,
                &openErr)) {
            const fs::path framesDir = outputDir / "portal_counter_frames";
            std::string extractErr;
            if (!extractFramesWithFfmpeg_(
                    openPath,
                    framesDir,
                    tempInputCleanup,
                    extractedFramePaths,
                    &extractErr)) {
                result.error = openErr + "; frame_extract_err=" + extractErr;
                return result;
            }

            for (; nextExtractedFrameIndex < extractedFramePaths.size(); ++nextExtractedFrameIndex) {
                prefetchedFrame = cv::imread(
                    extractedFramePaths[nextExtractedFrameIndex].string(),
                    cv::IMREAD_COLOR);
                if (!prefetchedFrame.empty()) {
                    ++nextExtractedFrameIndex;
                    break;
                }
            }
            if (prefetchedFrame.empty()) {
                result.error =
                    "ffmpeg extracted frames but none could be decoded; source=" +
                    describeInputVideoPath_(openPath.string());
                return result;
            }

            usingExtractedFrames = true;
            decodeMode = "ffmpeg_frame_sequence";
            width = prefetchedFrame.cols;
            height = prefetchedFrame.rows;

            const double durationHintSeconds =
                durationSecondsBetweenUtcIso_(windowStartUtcIso, windowEndUtcIso);
            const double extractedFps =
                durationHintSeconds > 0.0
                    ? static_cast<double>(extractedFramePaths.size()) / durationHintSeconds
                    : 0.0;
            if (extractedFps > 0.0) {
                fps = extractedFps;
            }

            try {
                Logger::instance().logWarning(
                    "job",
                    "PortalCounter: falling back to ffmpeg frame extraction"
                    " source=" + describeInputVideoPath_(openPath.string()) +
                    " frames=" + std::to_string(extractedFramePaths.size()) +
                    " fps=" + std::to_string(fps) +
                    " open_err=" + openErr);
            }
            catch (...) {
            }
        }
        else {
            fps = capture.get(cv::CAP_PROP_FPS) > 0.0
                ? capture.get(cv::CAP_PROP_FPS)
                : 12.0;
            width = static_cast<int>(capture.get(cv::CAP_PROP_FRAME_WIDTH));
            height = static_cast<int>(capture.get(cv::CAP_PROP_FRAME_HEIGHT));
        }

        if (width <= 0 || height <= 0) {
            result.error = "invalid input video dimensions";
            return result;
        }

        const cv::Size frameSize(width, height);
        const std::vector<cv::Point> polygon = polygonToPixels_(region, frameSize);
        if (polygon.size() < 3) {
            result.error = "failed converting polygon to pixel coordinates";
            return result;
        }

        const cv::Mat polygonMask = buildRoiMask_(frameSize, polygon);
        const cv::Mat detectionMask = buildDetectionMask_(frameSize, region, polygon);
        const PolygonGate_ polygonGate = computePolygonGate_(polygon);
        cv::Ptr<cv::BackgroundSubtractor> subtractor = cv::createBackgroundSubtractorMOG2(
            kBackgroundHistory,
            kBackgroundVarThreshold,
            false);

        const fs::path annotatedVideoPath = outputDir / "portal_counter_annotated.mp4";
        cv::VideoWriter writer;
        fs::path annotatedFramesDir;
        bool usingAnnotatedFrameFallback = false;
        if (config.save_annotated_video &&
            !createVideoWriter_(annotatedVideoPath, fps, frameSize, writer)) {
            annotatedFramesDir = outputDir / "portal_counter_annotated_frames";
            fs::remove_all(annotatedFramesDir, ec);
            ec.clear();
            fs::create_directories(annotatedFramesDir, ec);
            if (ec) {
                result.error =
                    "failed creating annotated video writer and fallback frames dir: " +
                    ec.message();
                return result;
            }
            tempInputCleanup.add(annotatedFramesDir);
            usingAnnotatedFrameFallback = true;

            try {
                Logger::instance().logWarning(
                    "job",
                    "PortalCounter: falling back to ffmpeg annotated video encoding"
                    " output=" + annotatedVideoPath.string() +
                    " fps=" + std::to_string(fps));
            }
            catch (...) {
            }
        }

        std::unordered_map<int, TrackState_> tracks;
        int nextTrackId = 1;
        int processedFrames = 0;
        int totalCount = 0;
        json groupImages = json::array();
        std::vector<int> countedTrackIds;
        json trackDiagnostics = json::array();

        auto finalizeTrack = [&](TrackState_& track) {
            const bool qualifies =
                trackQualifiesTraversal_(track, config, polygonGate, processedFrames);
            if (trackDiagnostics.size() < 24) {
                trackDiagnostics.push_back(
                    buildTrackDiagnostic_(track, config, polygonGate, processedFrames));
            }
            if (!qualifies) {
                return;
            }

            track.counted = true;
            totalCount += 1;
            countedTrackIds.push_back(track.trackId);
            maybeAppendProofImage_(
                groupImages,
                track,
                polygon,
                totalCount,
                config.max_proof_frames);
        };

        auto readNextFrame = [&](cv::Mat& outFrame) -> bool {
            if (!usingExtractedFrames) {
                return capture.read(outFrame);
            }

            if (!prefetchedFrame.empty()) {
                outFrame = prefetchedFrame.clone();
                prefetchedFrame.release();
                return !outFrame.empty();
            }

            while (nextExtractedFrameIndex < extractedFramePaths.size()) {
                outFrame = cv::imread(
                    extractedFramePaths[nextExtractedFrameIndex].string(),
                    cv::IMREAD_COLOR);
                ++nextExtractedFrameIndex;
                if (!outFrame.empty()) {
                    return true;
                }
            }

            outFrame.release();
            return false;
        };

        cv::Mat frame;
        while (readNextFrame(frame)) {
            const int frameIndex = processedFrames;
            const std::string frameUtcIso = timestampForFrame_(windowStartUtcIso, frameIndex, fps);
            const std::vector<Detection_> detections = detectPeople_(
                frame,
                detectionMask,
                subtractor,
                config);

            auto [assignments, usedTracks, usedDetections] = assignDetections_(tracks, detections);

            for (const auto& [trackId, detectionIndex] : assignments) {
                auto itTrack = tracks.find(trackId);
                if (itTrack == tracks.end()) continue;
                TrackState_& track = itTrack->second;
                const Detection_& detection = detections[detectionIndex];
                const float previousX = track.centroidX;
                const float previousY = track.centroidY;
                const cv::Point2f previousPoint(previousX, previousY);

                track.pathLengthPx += std::hypot(
                    static_cast<double>(detection.centroidX - previousX),
                    static_cast<double>(detection.centroidY - previousY));
                track.centroidX = detection.centroidX;
                track.centroidY = detection.centroidY;
                track.x = detection.x;
                track.y = detection.y;
                track.width = detection.width;
                track.height = detection.height;
                track.lastFrame = frameIndex;
                track.seenFrames += 1;
                track.missedFrames = 0;
                track.minX = (std::min)(track.minX, detection.centroidX);
                track.maxX = (std::max)(track.maxX, detection.centroidX);
                track.minY = (std::min)(track.minY, detection.centroidY);
                track.maxY = (std::max)(track.maxY, detection.centroidY);
                track.maxBottomY = (std::max)(
                    track.maxBottomY,
                    detection.y + detection.height);

                const BoundaryMetrics_ metrics = computeBoundaryMetrics_(
                    cv::Point2f(detection.centroidX, detection.centroidY),
                    polygon);
                const bool insidePolygon = metrics.interiorDistancePx >= 0.0;
                const bool bboxTouchesPolygon =
                    detectionBboxTouchesPolygon_(detection, polygonMask);
                const bool segmentTouchesPolygon =
                    segmentIntersectsPolygon_(
                        previousPoint,
                        cv::Point2f(detection.centroidX, detection.centroidY),
                        polygon);
                const bool touchesPolygonNow =
                    insidePolygon || bboxTouchesPolygon || segmentTouchesPolygon;

                if (touchesPolygonNow) {
                    if (!track.touchedPolygon) {
                        track.firstTouchFrame = frameIndex;
                        track.firstTouchY = detection.centroidY;
                    }
                    track.touchedPolygon = true;
                    track.polygonTouchFrames += 1;
                    track.lastTouchFrame = frameIndex;
                    track.lastTouchY = detection.centroidY;
                }
                track.bboxTouchedPolygon = track.bboxTouchedPolygon || bboxTouchesPolygon;
                track.centroidEnteredPolygon = track.centroidEnteredPolygon || insidePolygon;
                track.segmentIntersectedPolygon =
                    track.segmentIntersectedPolygon || segmentTouchesPolygon;
                track.lastVisibleFrame = frame.clone();
                track.lastVisibleFrameIndex = frameIndex;
                track.lastVisibleUtcIso = frameUtcIso;
            }

            for (auto itTrack = tracks.begin(); itTrack != tracks.end();) {
                if (usedTracks.count(itTrack->first) > 0) {
                    ++itTrack;
                    continue;
                }

                itTrack->second.missedFrames += 1;
                if (itTrack->second.missedFrames > config.max_missed_frames) {
                    finalizeTrack(itTrack->second);
                    itTrack = tracks.erase(itTrack);
                }
                else {
                    ++itTrack;
                }
            }

            for (size_t detectionIndex = 0; detectionIndex < detections.size(); ++detectionIndex) {
                if (usedDetections.count(static_cast<int>(detectionIndex)) > 0) continue;
                const Detection_& detection = detections[detectionIndex];
                const BoundaryMetrics_ metrics = computeBoundaryMetrics_(
                    cv::Point2f(detection.centroidX, detection.centroidY),
                    polygon);

                TrackState_ track;
                track.trackId = nextTrackId++;
                track.centroidX = detection.centroidX;
                track.centroidY = detection.centroidY;
                track.x = detection.x;
                track.y = detection.y;
                track.width = detection.width;
                track.height = detection.height;
                track.firstFrame = frameIndex;
                track.lastFrame = frameIndex;
                track.firstX = detection.centroidX;
                track.firstY = detection.centroidY;
                track.minX = detection.centroidX;
                track.maxX = detection.centroidX;
                track.minY = detection.centroidY;
                track.maxY = detection.centroidY;
                track.maxBottomY = detection.y + detection.height;
                const bool insidePolygon = metrics.interiorDistancePx >= 0.0;
                const bool bboxTouchesPolygon =
                    detectionBboxTouchesPolygon_(detection, polygonMask);
                const bool touchesPolygonNow =
                    insidePolygon || bboxTouchesPolygon;
                track.touchedPolygon = touchesPolygonNow;
                track.bboxTouchedPolygon = bboxTouchesPolygon;
                track.centroidEnteredPolygon = insidePolygon;
                track.segmentIntersectedPolygon = false;
                track.polygonTouchFrames = touchesPolygonNow ? 1 : 0;
                track.firstTouchFrame = touchesPolygonNow ? frameIndex : -1;
                track.lastTouchFrame = touchesPolygonNow ? frameIndex : -1;
                track.firstTouchY = touchesPolygonNow ? detection.centroidY : 0.0f;
                track.lastTouchY = touchesPolygonNow ? detection.centroidY : 0.0f;
                track.lastVisibleFrame = frame.clone();
                track.lastVisibleFrameIndex = frameIndex;
                track.lastVisibleUtcIso = frameUtcIso;
                tracks.emplace(track.trackId, std::move(track));
            }

            if (writer.isOpened() || usingAnnotatedFrameFallback) {
                cv::Mat annotatedFrame = renderAnnotatedFrame_(frame, polygon, tracks, totalCount);
                if (writer.isOpened()) {
                    writer.write(annotatedFrame);
                }
                else {
                    std::ostringstream fileName;
                    fileName
                        << "frame_"
                        << std::setfill('0') << std::setw(6)
                        << (processedFrames + 1)
                        << ".jpg";
                    const fs::path annotatedFramePath = annotatedFramesDir / fileName.str();
                    if (!cv::imwrite(annotatedFramePath.string(), annotatedFrame)) {
                        result.error =
                            "failed writing annotated frame: " + annotatedFramePath.string();
                        return result;
                    }
                }
            }

            processedFrames += 1;
        }

        capture.release();
        if (writer.isOpened()) {
            writer.release();
        }
        if (config.save_annotated_video && usingAnnotatedFrameFallback) {
            std::string encodeErr;
            if (!encodeFramesToMp4WithFfmpeg_(
                    annotatedFramesDir,
                    annotatedVideoPath,
                    fps,
                    &encodeErr)) {
                result.error =
                    "failed encoding annotated video via ffmpeg fallback: " + encodeErr;
                return result;
            }
        }

        for (auto& [trackId, track] : tracks) {
            (void)trackId;
            finalizeTrack(track);
        }

        result.ok = true;
        result.totalCount = totalCount;
        result.processedFrames = processedFrames;
        result.fps = fps;
        result.processedDurationSeconds =
            fps > 0.0 ? (static_cast<double>(processedFrames) / fps) : 0.0;
        result.annotatedVideoPath = annotatedVideoPath.string();
        result.countedTrackIds = countedTrackIds;
        result.groupImages = std::move(groupImages);
        result.countResult = json{
            { "total_count", totalCount },
            { "processed_frames", processedFrames },
            { "processed_duration_seconds", result.processedDurationSeconds },
            { "fps", fps },
            { "decode_mode", decodeMode },
            { "counted_track_ids", countedTrackIds },
            { "region_id", region.region_id },
            { "frame_width", width },
            { "frame_height", height },
            { "gate_top_y", polygonGate.topY },
            { "gate_center_y", polygonGate.centerY },
            { "gate_bottom_y", polygonGate.bottomY },
            { "gate_entry_threshold_y", polygonGate.entryThresholdY },
            { "gate_exit_threshold_y", polygonGate.exitThresholdY },
            { "track_diagnostics", trackDiagnostics }
        };
        return result;
    }
    catch (const std::exception& ex) {
        result.error = ex.what();
        return result;
    }
    catch (...) {
        result.error = "unknown portal counter exception";
        return result;
    }
}

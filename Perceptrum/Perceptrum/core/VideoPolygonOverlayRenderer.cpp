#include "VideoPolygonOverlayRenderer.h"

#include "../platform/platform_common.h"
#include "../platform/platform_process.h"

#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
#include <system_error>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace analysisregion {

namespace {

#ifdef _WIN32
constexpr const char* kFfmpegExecutableName_ = "ffmpeg.exe";
#else
constexpr const char* kFfmpegExecutableName_ = "ffmpeg";
#endif

struct PreparedRegion_ {
    std::string label;
    std::string regionId;
    cv::Scalar colorBgr;
    std::vector<cv::Point> points;
    cv::Point centroid;
};

static int clampByte_(double value)
{
    return static_cast<int>(std::llround((std::max)(0.0, (std::min)(255.0, value))));
}

static int alphaByte_(double alpha)
{
    return clampByte_(alpha * 255.0);
}

static cv::Scalar bgrWithAlpha_(const cv::Scalar& bgr, double alpha)
{
    return cv::Scalar(
        bgr[0],
        bgr[1],
        bgr[2],
        alphaByte_(alpha)
    );
}

static cv::Point centroidForPolygon_(const std::vector<cv::Point>& polygon)
{
    if (polygon.empty()) {
        return cv::Point();
    }

    const cv::Moments moments = cv::moments(polygon);
    if (std::fabs(moments.m00) > 1e-6) {
        return cv::Point(
            static_cast<int>(std::lround(moments.m10 / moments.m00)),
            static_cast<int>(std::lround(moments.m01 / moments.m00))
        );
    }

    cv::Point sum(0, 0);
    for (const auto& point : polygon) {
        sum.x += point.x;
        sum.y += point.y;
    }
    return cv::Point(
        sum.x / static_cast<int>(polygon.size()),
        sum.y / static_cast<int>(polygon.size())
    );
}

static std::vector<PreparedRegion_> buildPreparedRegions_(
    const std::vector<RegionSpec>& regions,
    const cv::Size& frameSize)
{
    std::vector<PreparedRegion_> out;
    const std::vector<RegionSpec> polygonRegions = CollectPolygonRegions(regions);
    out.reserve(polygonRegions.size());

    for (std::size_t index = 0; index < polygonRegions.size(); ++index) {
        const auto& region = polygonRegions[index];
        std::vector<cv::Point> polygon = RegionPolygonToPixels(region, frameSize);
        if (polygon.size() < 3) {
            continue;
        }

        PreparedRegion_ prepared;
        prepared.regionId = region.regionId;
        prepared.label = region.label.empty() ? region.regionId : region.label;
        if (prepared.label.empty()) {
            prepared.label = "Region";
        }
        prepared.colorBgr = OverlayColorForIndex(index);
        prepared.points = std::move(polygon);
        prepared.centroid = centroidForPolygon_(prepared.points);
        out.push_back(std::move(prepared));
    }

    return out;
}

static int strokeWidthPx_(const cv::Size& frameSize, const OverlayStyle& style)
{
    const int minSide = (std::min)(frameSize.width, frameSize.height);
    return (std::max)(style.minimumStrokeWidthPx, minSide / 430);
}

static double fontScale_(const cv::Size& frameSize)
{
    const int minSide = (std::min)(frameSize.width, frameSize.height);
    return (std::max)(0.50, static_cast<double>(minSide) / 1500.0);
}

static cv::Rect buildLabelRect_(
    const cv::Size& frameSize,
    const cv::Point& anchor,
    const std::string& label,
    double fontScale,
    int thickness,
    int& outBaseline)
{
    outBaseline = 0;
    const cv::Size textSize = cv::getTextSize(
        label,
        cv::FONT_HERSHEY_SIMPLEX,
        fontScale,
        thickness,
        &outBaseline
    );
    const int padX = 6;
    const int padY = 5;
    const int rectW = textSize.width + (padX * 2);
    const int rectH = textSize.height + outBaseline + (padY * 2);

    int left = anchor.x - (rectW / 2);
    int top = anchor.y - (rectH / 2);
    left = std::clamp(left, 2, (std::max)(2, frameSize.width - rectW - 2));
    top = std::clamp(top, 2, (std::max)(2, frameSize.height - rectH - 2));
    return cv::Rect(left, top, rectW, rectH);
}

static fs::path resolveFfmpegExecutable_()
{
    const fs::path executableDir = perceptrum::platform::GetExecutableDirectory();
    if (!executableDir.empty()) {
        const fs::path bundled = executableDir / kFfmpegExecutableName_;
        std::error_code bundledEc;
        if (fs::exists(bundled, bundledEc) && !bundledEc) {
            return bundled;
        }
    }

    return perceptrum::platform::SearchExecutableInPath(kFfmpegExecutableName_);
}

static bool waitForReadablePath_(
    const fs::path& path,
    std::string* outErr)
{
    constexpr int kMaxAttempts = 8;
    constexpr auto kRetryDelay = std::chrono::milliseconds(50);
    for (int attempt = 0; attempt < kMaxAttempts; ++attempt) {
        std::error_code ec;
        const bool exists = fs::exists(path, ec) && !ec;
        const std::uintmax_t size = exists ? fs::file_size(path, ec) : 0;
        if (exists && !ec && size > 0) {
            std::ifstream ifs(path, std::ios::binary);
            if (ifs.good()) {
                return true;
            }
        }
        if (attempt + 1 < kMaxAttempts) {
            std::this_thread::sleep_for(kRetryDelay);
        }
    }

    if (outErr) {
        *outErr = "path not readable yet: " + path.string();
    }
    return false;
}

static bool probeVideoFrameSizeWithFfmpeg_(
    const fs::path& srcClipPath,
    cv::Size& outFrameSize,
    std::string* outErr)
{
    outFrameSize = cv::Size();

    std::error_code ec;
    if (!fs::exists(srcClipPath, ec) || ec) {
        if (outErr) *outErr = "source clip missing: " + srcClipPath.string();
        return false;
    }

    const fs::path ffmpegPath = resolveFfmpegExecutable_();

    perceptrum::platform::ProcessLaunchOptions launchOptions;
    launchOptions.executablePath = ffmpegPath;
    launchOptions.arguments = {
        "-hide_banner",
        "-i",
        srcClipPath.string(),
    };

    perceptrum::platform::ProcessRunResult runResult;
    std::string launchError;
    if (!perceptrum::platform::RunProcessAndCaptureOutput(launchOptions, runResult, launchError)) {
        if (outErr) {
            *outErr = "ffmpeg probe launch failed: " + launchError;
        }
        return false;
    }

    std::istringstream iss(runResult.combinedOutput);
    std::string line;
    const std::regex sizeRegex(R"((\d{2,5})x(\d{2,5}))");
    while (std::getline(iss, line)) {
        if (line.find("Video:") == std::string::npos) {
            continue;
        }

        std::smatch match;
        if (std::regex_search(line, match, sizeRegex) && match.size() >= 3) {
            try {
                outFrameSize.width = std::stoi(match[1].str());
                outFrameSize.height = std::stoi(match[2].str());
            }
            catch (...) {
                outFrameSize = cv::Size();
            }
            if (outFrameSize.width > 0 && outFrameSize.height > 0) {
                return true;
            }
        }
    }

    if (outErr) {
        *outErr = "failed to parse video dimensions from ffmpeg output";
        if (!runResult.combinedOutput.empty()) {
            *outErr += " exitCode=" + std::to_string(runResult.exitCode);
        }
    }
    return false;
}

} // namespace

cv::Scalar OverlayColorForIndex(std::size_t index)
{
    static const std::array<cv::Scalar, 6> palette = {
        cv::Scalar(250, 165, 96),   // sky blue
        cv::Scalar(105, 197, 255),  // amber
        cv::Scalar(148, 227, 139),  // green
        cv::Scalar(209, 158, 255),  // violet
        cv::Scalar(147, 122, 255),  // rose
        cv::Scalar(233, 228, 116)   // yellow
    };
    return palette[index % palette.size()];
}

int DrawRegionsOnFrame(
    cv::Mat& frame,
    const std::vector<RegionSpec>& regions,
    std::vector<std::string>* outDrawnRegionIds,
    const OverlayStyle& style)
{
    if (outDrawnRegionIds) outDrawnRegionIds->clear();
    if (frame.empty()) {
        return 0;
    }

    const std::vector<PreparedRegion_> prepared = buildPreparedRegions_(regions, frame.size());
    if (prepared.empty()) {
        return 0;
    }

    cv::Mat overlay = frame.clone();
    for (const auto& region : prepared) {
        std::vector<std::vector<cv::Point>> polygons{ region.points };
        cv::fillPoly(overlay, polygons, region.colorBgr, cv::LINE_AA);
    }
    cv::addWeighted(overlay, style.fillAlpha, frame, 1.0 - style.fillAlpha, 0.0, frame);

    const int lineThickness = strokeWidthPx_(frame.size(), style);
    const double fontScale = fontScale_(frame.size());
    const int textThickness = (std::max)(1, lineThickness - 1);

    for (const auto& region : prepared) {
        std::vector<std::vector<cv::Point>> polygons{ region.points };
        cv::polylines(frame, polygons, true, region.colorBgr, lineThickness, cv::LINE_AA);
        if (style.drawVertices) {
            for (const auto& point : region.points) {
                cv::circle(frame, point, (std::max)(2, lineThickness), region.colorBgr, cv::FILLED, cv::LINE_AA);
            }
        }

        int baseline = 0;
        const cv::Rect labelRect = buildLabelRect_(
            frame.size(),
            region.centroid,
            region.label,
            fontScale,
            textThickness,
            baseline);
        cv::rectangle(frame, labelRect, cv::Scalar(10, 12, 18), cv::FILLED, cv::LINE_AA);
        cv::rectangle(frame, labelRect, region.colorBgr, 1, cv::LINE_AA);
        const cv::Point textOrg(
            labelRect.x + 6,
            labelRect.y + labelRect.height - baseline - 4
        );
        cv::putText(
            frame,
            region.label,
            textOrg,
            cv::FONT_HERSHEY_SIMPLEX,
            fontScale,
            cv::Scalar(245, 248, 255),
            textThickness,
            cv::LINE_AA
        );

        if (outDrawnRegionIds && !region.regionId.empty()) {
            outDrawnRegionIds->push_back(region.regionId);
        }
    }

    return static_cast<int>(prepared.size());
}

bool RenderOverlayPng(
    const fs::path& overlayPngPath,
    const cv::Size& frameSize,
    const std::vector<RegionSpec>& regions,
    std::vector<std::string>* outDrawnRegionIds,
    std::string* outErr,
    const OverlayStyle& style)
{
    if (outDrawnRegionIds) outDrawnRegionIds->clear();
    if (frameSize.width <= 0 || frameSize.height <= 0) {
        if (outErr) *outErr = "invalid frame size for overlay";
        return false;
    }

    const std::vector<PreparedRegion_> prepared = buildPreparedRegions_(regions, frameSize);
    if (prepared.empty()) {
        if (outErr) *outErr = "no drawable polygon regions";
        return false;
    }

    cv::Mat overlay(frameSize, CV_8UC4, cv::Scalar(0, 0, 0, 0));
    const int lineThickness = strokeWidthPx_(frameSize, style);
    const double fontScale = fontScale_(frameSize);
    const int textThickness = (std::max)(1, lineThickness - 1);

    for (const auto& region : prepared) {
        std::vector<std::vector<cv::Point>> polygons{ region.points };
        cv::fillPoly(
            overlay,
            polygons,
            bgrWithAlpha_(region.colorBgr, style.fillAlpha),
            cv::LINE_AA);
        cv::polylines(
            overlay,
            polygons,
            true,
            bgrWithAlpha_(region.colorBgr, style.strokeAlpha),
            lineThickness,
            cv::LINE_AA);

        if (style.drawVertices) {
            for (const auto& point : region.points) {
                cv::circle(
                    overlay,
                    point,
                    (std::max)(2, lineThickness),
                    bgrWithAlpha_(region.colorBgr, style.strokeAlpha),
                    cv::FILLED,
                    cv::LINE_AA);
            }
        }

        int baseline = 0;
        const cv::Rect labelRect = buildLabelRect_(
            frameSize,
            region.centroid,
            region.label,
            fontScale,
            textThickness,
            baseline);
        cv::rectangle(
            overlay,
            labelRect,
            cv::Scalar(10, 12, 18, alphaByte_(style.labelBackgroundAlpha)),
            cv::FILLED,
            cv::LINE_AA);
        cv::rectangle(
            overlay,
            labelRect,
            bgrWithAlpha_(region.colorBgr, style.labelBorderAlpha),
            1,
            cv::LINE_AA);
        const cv::Point textOrg(
            labelRect.x + 6,
            labelRect.y + labelRect.height - baseline - 4
        );
        cv::putText(
            overlay,
            region.label,
            textOrg,
            cv::FONT_HERSHEY_SIMPLEX,
            fontScale,
            cv::Scalar(245, 248, 255, 245),
            textThickness,
            cv::LINE_AA
        );

        if (outDrawnRegionIds && !region.regionId.empty()) {
            outDrawnRegionIds->push_back(region.regionId);
        }
    }

    std::error_code ec;
    fs::create_directories(overlayPngPath.parent_path(), ec);
    if (ec) {
        if (outErr) *outErr = "failed creating overlay parent dir: " + ec.message();
        return false;
    }
    if (!cv::imwrite(overlayPngPath.string(), overlay)) {
        if (outErr) *outErr = "cv::imwrite failed for overlay png";
        return false;
    }
    return true;
}

bool AnnotateVideoClipWithOverlay(
    const fs::path& srcClipPath,
    const std::vector<RegionSpec>& regions,
    fs::path& outClipPath,
    std::vector<std::string>* outDrawnRegionIds,
    std::string* outErr,
    const OverlayStyle& style)
{
    outClipPath.clear();
    if (outDrawnRegionIds) outDrawnRegionIds->clear();

    const std::vector<RegionSpec> polygonRegions = CollectPolygonRegions(regions);
    if (polygonRegions.empty()) {
        outClipPath = srcClipPath;
        return true;
    }

    cv::Size frameSize;
    if (!probeVideoFrameSizeWithFfmpeg_(srcClipPath, frameSize, outErr)) {
        return false;
    }

    fs::path overlayPngPath = srcClipPath;
    overlayPngPath += ".roi_overlay.png";
    std::error_code ec;
    fs::remove(overlayPngPath, ec);

    struct OverlayPathCleanup_ {
        fs::path path;
        ~OverlayPathCleanup_()
        {
            if (path.empty()) return;
            std::error_code cleanupEc;
            fs::remove(path, cleanupEc);
        }
    } overlayCleanup{ overlayPngPath };

    if (!RenderOverlayPng(overlayPngPath, frameSize, polygonRegions, outDrawnRegionIds, outErr, style)) {
        return false;
    }

    const fs::path ffmpegPath = resolveFfmpegExecutable_();

    fs::path dstClipPath = srcClipPath;
    dstClipPath += ".roi_overlay.mp4";
    fs::remove(dstClipPath, ec);

    perceptrum::platform::ProcessLaunchOptions launchOptions;
    launchOptions.executablePath = ffmpegPath;
    launchOptions.arguments = {
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        srcClipPath.string(),
        "-i",
        overlayPngPath.string(),
        "-filter_complex",
        "[0:v][1:v]overlay=0:0:eof_action=repeat:format=auto[v]",
        "-map",
        "[v]",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        dstClipPath.string(),
    };

    perceptrum::platform::ProcessRunResult runResult;
    std::string launchError;
    if (!perceptrum::platform::RunProcessAndCaptureOutput(launchOptions, runResult, launchError)) {
        if (outErr) {
            *outErr = "ffmpeg roi overlay launch failed: " + launchError;
        }
        return false;
    }

    if (runResult.exitCode != 0) {
        if (outErr) {
            *outErr =
                "ffmpeg roi overlay failed rc=" + std::to_string(runResult.exitCode) +
                " src=" + srcClipPath.string();

            const std::string trimmedOutput =
                perceptrum::platform::TrimAscii(runResult.combinedOutput);
            if (!trimmedOutput.empty()) {
                *outErr += " details=" + trimmedOutput;
            }
        }
        return false;
    }

    if (!waitForReadablePath_(dstClipPath, outErr)) {
        return false;
    }

    outClipPath = std::move(dstClipPath);
    return true;
}

} // namespace analysisregion

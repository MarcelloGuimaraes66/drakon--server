#pragma once

#include "AnalysisRegionGeometry.h"

#include <filesystem>
#include <string>
#include <vector>

#include <opencv2/core.hpp>

namespace analysisregion {

struct OverlayStyle {
    double fillAlpha = 0.14;
    double strokeAlpha = 0.96;
    double labelBackgroundAlpha = 0.80;
    double labelBorderAlpha = 0.96;
    bool drawVertices = false;
    int minimumStrokeWidthPx = 2;
};

cv::Scalar OverlayColorForIndex(std::size_t index);
int DrawRegionsOnFrame(
    cv::Mat& frame,
    const std::vector<RegionSpec>& regions,
    std::vector<std::string>* outDrawnRegionIds = nullptr,
    const OverlayStyle& style = OverlayStyle{});
bool RenderOverlayPng(
    const std::filesystem::path& overlayPngPath,
    const cv::Size& frameSize,
    const std::vector<RegionSpec>& regions,
    std::vector<std::string>* outDrawnRegionIds = nullptr,
    std::string* outErr = nullptr,
    const OverlayStyle& style = OverlayStyle{});
bool AnnotateVideoClipWithOverlay(
    const std::filesystem::path& srcClipPath,
    const std::vector<RegionSpec>& regions,
    std::filesystem::path& outClipPath,
    std::vector<std::string>* outDrawnRegionIds = nullptr,
    std::string* outErr = nullptr,
    const OverlayStyle& style = OverlayStyle{});

} // namespace analysisregion

#pragma once

#include <opencv2/core.hpp>

#include <string>
#include <vector>

namespace analysisregion {

struct PointNorm {
    double x = 0.0;
    double y = 0.0;
};

struct FrameWindowNorm {
    bool enabled = false;
    double x = 0.0;
    double y = 0.0;
    double width = 1.0;
    double height = 1.0;
};

struct RegionSpec {
    std::string regionId;
    std::string label;
    bool enabled = true;
    bool fullFrame = true;
    std::vector<PointNorm> polygonNorm;
    int drawRefWidth = 0;
    int drawRefHeight = 0;
    double contextPaddingPct = 0.0;
    FrameWindowNorm frameWindowNorm;
};

bool IsFrameWindowActive(const FrameWindowNorm& frameWindow);
FrameWindowNorm NormalizeFrameWindow(const FrameWindowNorm& frameWindow);
FrameWindowNorm ResolveFrameWindow(const std::vector<RegionSpec>& regions);
RegionSpec BuildFrameWindowCropRegion(const FrameWindowNorm& frameWindow);
std::vector<PointNorm> ClipPolygonToFrameWindow(
    const std::vector<PointNorm>& polygon,
    const FrameWindowNorm& frameWindow);
std::vector<RegionSpec> RemapRegionsToFrameWindow(
    const std::vector<RegionSpec>& regions,
    const FrameWindowNorm& frameWindow);
std::vector<RegionSpec> CollectPolygonRegions(
    const std::vector<RegionSpec>& regions);
cv::Rect FrameWindowToRect(
    const FrameWindowNorm& frameWindow,
    const cv::Size& size);
std::vector<cv::Point> PolygonToPixels(
    const std::vector<PointNorm>& polygon,
    const cv::Size& size);
std::vector<cv::Point> RegionPolygonToPixels(
    const RegionSpec& region,
    const cv::Size& size);
cv::Rect ComputeRegionCropRect(
    const RegionSpec& region,
    const cv::Size& imageSize);

} // namespace analysisregion

#include "AnalysisRegionGeometry.h"

#include <opencv2/imgproc.hpp>

#include <algorithm>
#include <cmath>

namespace analysisregion {

namespace {

static double clamp01_(double value)
{
    return (std::max)(0.0, (std::min)(1.0, value));
}

} // namespace

bool IsFrameWindowActive(const FrameWindowNorm& frameWindow)
{
    return frameWindow.enabled &&
        frameWindow.width > 1e-6 &&
        frameWindow.height > 1e-6 &&
        (frameWindow.x > 1e-6 ||
         frameWindow.y > 1e-6 ||
         frameWindow.width < (1.0 - 1e-6) ||
         frameWindow.height < (1.0 - 1e-6));
}

FrameWindowNorm NormalizeFrameWindow(const FrameWindowNorm& frameWindow)
{
    FrameWindowNorm normalized;
    double width = clamp01_(frameWindow.width);
    double height = clamp01_(frameWindow.height);
    if (width <= 1e-6 || height <= 1e-6) {
        return normalized;
    }

    const double maxX = (std::max)(0.0, 1.0 - width);
    const double maxY = (std::max)(0.0, 1.0 - height);

    normalized.x = (std::min)(maxX, (std::max)(0.0, frameWindow.x));
    normalized.y = (std::min)(maxY, (std::max)(0.0, frameWindow.y));
    normalized.width = width;
    normalized.height = height;
    normalized.enabled =
        normalized.x > 1e-6 ||
        normalized.y > 1e-6 ||
        normalized.width < (1.0 - 1e-6) ||
        normalized.height < (1.0 - 1e-6);
    return normalized;
}

FrameWindowNorm ResolveFrameWindow(const std::vector<RegionSpec>& regions)
{
    for (const auto& region : regions) {
        const FrameWindowNorm normalized = NormalizeFrameWindow(region.frameWindowNorm);
        if (IsFrameWindowActive(normalized)) {
            return normalized;
        }
    }
    return FrameWindowNorm{};
}

RegionSpec BuildFrameWindowCropRegion(const FrameWindowNorm& frameWindow)
{
    const FrameWindowNorm normalized = NormalizeFrameWindow(frameWindow);

    RegionSpec region;
    region.regionId = "frame-window";
    region.label = "Frame window";
    region.enabled = true;
    region.fullFrame = false;

    const double x1 = clamp01_(normalized.x);
    const double y1 = clamp01_(normalized.y);
    const double x2 = clamp01_(normalized.x + normalized.width);
    const double y2 = clamp01_(normalized.y + normalized.height);
    region.polygonNorm = {
        PointNorm{ x1, y1 },
        PointNorm{ x2, y1 },
        PointNorm{ x2, y2 },
        PointNorm{ x1, y2 }
    };
    return region;
}

std::vector<PointNorm> ClipPolygonToFrameWindow(
    const std::vector<PointNorm>& polygon,
    const FrameWindowNorm& frameWindow)
{
    if (polygon.size() < 3) {
        return polygon;
    }

    const FrameWindowNorm normalized = NormalizeFrameWindow(frameWindow);
    if (!IsFrameWindowActive(normalized)) {
        return polygon;
    }

    const double minX = clamp01_(normalized.x);
    const double minY = clamp01_(normalized.y);
    const double maxX = clamp01_(normalized.x + normalized.width);
    const double maxY = clamp01_(normalized.y + normalized.height);

    auto intersectAtX = [](const PointNorm& a, const PointNorm& b, double x) -> PointNorm {
        const double dx = b.x - a.x;
        if (std::abs(dx) <= 1e-9) {
            return PointNorm{ x, a.y };
        }
        const double t = (x - a.x) / dx;
        return PointNorm{ x, a.y + ((b.y - a.y) * t) };
    };
    auto intersectAtY = [](const PointNorm& a, const PointNorm& b, double y) -> PointNorm {
        const double dy = b.y - a.y;
        if (std::abs(dy) <= 1e-9) {
            return PointNorm{ a.x, y };
        }
        const double t = (y - a.y) / dy;
        return PointNorm{ a.x + ((b.x - a.x) * t), y };
    };
    auto clipEdge = [](const std::vector<PointNorm>& input, const auto& inside, const auto& intersect) {
        std::vector<PointNorm> output;
        if (input.empty()) return output;
        output.reserve(input.size() + 4);

        PointNorm prev = input.back();
        bool prevInside = inside(prev);
        for (const auto& curr : input) {
            const bool currInside = inside(curr);
            if (currInside) {
                if (!prevInside) {
                    output.push_back(intersect(prev, curr));
                }
                output.push_back(curr);
            }
            else if (prevInside) {
                output.push_back(intersect(prev, curr));
            }
            prev = curr;
            prevInside = currInside;
        }
        return output;
    };

    std::vector<PointNorm> clipped = polygon;
    clipped = clipEdge(
        clipped,
        [&](const PointNorm& point) { return point.x >= minX; },
        [&](const PointNorm& a, const PointNorm& b) { return intersectAtX(a, b, minX); });
    clipped = clipEdge(
        clipped,
        [&](const PointNorm& point) { return point.x <= maxX; },
        [&](const PointNorm& a, const PointNorm& b) { return intersectAtX(a, b, maxX); });
    clipped = clipEdge(
        clipped,
        [&](const PointNorm& point) { return point.y >= minY; },
        [&](const PointNorm& a, const PointNorm& b) { return intersectAtY(a, b, minY); });
    clipped = clipEdge(
        clipped,
        [&](const PointNorm& point) { return point.y <= maxY; },
        [&](const PointNorm& a, const PointNorm& b) { return intersectAtY(a, b, maxY); });
    return clipped;
}

std::vector<RegionSpec> RemapRegionsToFrameWindow(
    const std::vector<RegionSpec>& regions,
    const FrameWindowNorm& frameWindow)
{
    const FrameWindowNorm normalized = NormalizeFrameWindow(frameWindow);
    if (!IsFrameWindowActive(normalized)) {
        return regions;
    }

    std::vector<RegionSpec> out;
    out.reserve(regions.size());
    const double invWidth = normalized.width > 1e-6 ? (1.0 / normalized.width) : 1.0;
    const double invHeight = normalized.height > 1e-6 ? (1.0 / normalized.height) : 1.0;

    for (const auto& region : regions) {
        RegionSpec next = region;
        next.frameWindowNorm = FrameWindowNorm{};
        if (!next.fullFrame && !next.polygonNorm.empty()) {
            auto clippedPolygon = ClipPolygonToFrameWindow(next.polygonNorm, normalized);
            if (clippedPolygon.size() < 3) {
                continue;
            }
            for (auto& point : clippedPolygon) {
                point.x = clamp01_((point.x - normalized.x) * invWidth);
                point.y = clamp01_((point.y - normalized.y) * invHeight);
            }
            next.polygonNorm = std::move(clippedPolygon);
        }
        out.push_back(std::move(next));
    }
    return out;
}

std::vector<RegionSpec> CollectPolygonRegions(
    const std::vector<RegionSpec>& regions)
{
    std::vector<RegionSpec> out;
    out.reserve(regions.size());
    for (const auto& region : regions) {
        if (!region.enabled) continue;
        if (region.fullFrame) continue;
        if (region.polygonNorm.size() < 3) continue;
        out.push_back(region);
    }
    return out;
}

cv::Rect FrameWindowToRect(
    const FrameWindowNorm& frameWindow,
    const cv::Size& size)
{
    if (size.width <= 0 || size.height <= 0) {
        return cv::Rect();
    }

    const FrameWindowNorm normalized = NormalizeFrameWindow(frameWindow);
    if (!IsFrameWindowActive(normalized)) {
        return cv::Rect(0, 0, size.width, size.height);
    }

    const double x1Norm = clamp01_(normalized.x);
    const double y1Norm = clamp01_(normalized.y);
    const double x2Norm = clamp01_(normalized.x + normalized.width);
    const double y2Norm = clamp01_(normalized.y + normalized.height);

    int x1 = static_cast<int>(std::floor(x1Norm * static_cast<double>(size.width)));
    int y1 = static_cast<int>(std::floor(y1Norm * static_cast<double>(size.height)));
    int x2 = static_cast<int>(std::ceil(x2Norm * static_cast<double>(size.width)));
    int y2 = static_cast<int>(std::ceil(y2Norm * static_cast<double>(size.height)));

    x1 = (std::max)(0, (std::min)(size.width - 1, x1));
    y1 = (std::max)(0, (std::min)(size.height - 1, y1));
    x2 = (std::max)(x1 + 1, (std::min)(size.width, x2));
    y2 = (std::max)(y1 + 1, (std::min)(size.height, y2));

    return cv::Rect(x1, y1, x2 - x1, y2 - y1);
}

std::vector<cv::Point> PolygonToPixels(
    const std::vector<PointNorm>& polygon,
    const cv::Size& size)
{
    std::vector<cv::Point> out;
    if (size.width <= 0 || size.height <= 0) {
        return out;
    }

    out.reserve(polygon.size());
    const int maxX = (std::max)(0, size.width - 1);
    const int maxY = (std::max)(0, size.height - 1);
    for (const auto& point : polygon) {
        int x = static_cast<int>(std::llround(clamp01_(point.x) * static_cast<double>(maxX)));
        int y = static_cast<int>(std::llround(clamp01_(point.y) * static_cast<double>(maxY)));
        x = (std::max)(0, (std::min)(maxX, x));
        y = (std::max)(0, (std::min)(maxY, y));
        out.emplace_back(x, y);
    }
    return out;
}

std::vector<cv::Point> RegionPolygonToPixels(
    const RegionSpec& region,
    const cv::Size& size)
{
    return PolygonToPixels(region.polygonNorm, size);
}

cv::Rect ComputeRegionCropRect(
    const RegionSpec& region,
    const cv::Size& imageSize)
{
    if (imageSize.width <= 1 || imageSize.height <= 1) {
        return cv::Rect();
    }
    if (region.fullFrame || region.polygonNorm.size() < 3) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    const auto polygon = RegionPolygonToPixels(region, imageSize);
    if (polygon.size() < 3) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    cv::Rect rect = cv::boundingRect(polygon);
    if (rect.width <= 0 || rect.height <= 0) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    const double pct = (std::min)(0.4, (std::max)(0.0, region.contextPaddingPct));
    const int padX = static_cast<int>(std::llround(static_cast<double>(rect.width) * pct));
    const int padY = static_cast<int>(std::llround(static_cast<double>(rect.height) * pct));

    int x1 = (std::max)(0, rect.x - padX);
    int y1 = (std::max)(0, rect.y - padY);
    int x2 = (std::min)(imageSize.width, rect.x + rect.width + padX);
    int y2 = (std::min)(imageSize.height, rect.y + rect.height + padY);
    if (x2 <= x1 || y2 <= y1) {
        return cv::Rect(0, 0, imageSize.width, imageSize.height);
    }

    return cv::Rect(x1, y1, x2 - x1, y2 - y1);
}

} // namespace analysisregion

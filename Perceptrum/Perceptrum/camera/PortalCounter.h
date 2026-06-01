#pragma once

#include "../jobs/JobTypes.h"

#include <string>
#include <vector>

struct PortalCounterResult {
    bool ok = false;
    std::string error;
    int totalCount = 0;
    int processedFrames = 0;
    double fps = 0.0;
    double processedDurationSeconds = 0.0;
    std::string annotatedVideoPath;
    std::vector<int> countedTrackIds;
    json groupImages = json::array();
    json countResult = json::object();
};

PortalCounterResult runPortalCounterOnVideo(
    const std::string& inputVideoPath,
    const JobAnalysisRegion& region,
    const PortalCounterConfig& config,
    const std::string& outputDirectory,
    const std::string& windowStartUtcIso = std::string(),
    const std::string& windowEndUtcIso = std::string());

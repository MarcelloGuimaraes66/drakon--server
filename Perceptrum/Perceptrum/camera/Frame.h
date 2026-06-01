// camera/Frame.h
#pragma once

#include <chrono>
#include <string>
#include <opencv2/core.hpp>

struct Frame {
    cv::Mat image;    // the frame pixels
    std::chrono::steady_clock::time_point timestamp;
    std::string cameraId;     // which camera this belongs to
};

#include "MotionDetector.h"
#include "../logging/Logging.h"
#include <opencv2/imgproc.hpp>
#include <iostream>


MotionDetector::MotionDetector(const std::string& cameraId,
    double sensitivity,
    std::chrono::seconds idleTimeout)
    : cameraId_(cameraId),
    sensitivity_(sensitivity),
    idleTimeout_(idleTimeout),
    lastMotionTime_(Clock::now()) {
}



bool MotionDetector::update(const cv::Mat& frame) {
    if (frame.empty()) return false;

    // 1) Downscale + grayscale
    cv::Mat small, gray;
    cv::resize(frame, small, cv::Size(160, 90));
    cv::cvtColor(small, gray, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);

    int totalPixels = gray.rows * gray.cols;

    // 2) First frame: init both prev and background
    if (!hasPrev_) {
        gray.copyTo(prevSmallGray_);
        gray.convertTo(bgFloat_, CV_32F); // init background
        hasPrev_ = true;
        hasBg_ = true;
        lastMotionTime_ = Clock::now();
        return false;
    }

    bool motionFast = false;
    bool motionBg = false;

    // 3) FAST path: diff vs previous frame (what you already had)
    {
        cv::Mat diffPrev, threshPrev;
        cv::absdiff(gray, prevSmallGray_, diffPrev);
        cv::threshold(diffPrev, threshPrev, thresholdValue_, 255, cv::THRESH_BINARY);

        // Clean tiny noise
        cv::erode(threshPrev, threshPrev, cv::Mat(), cv::Point(-1, -1), 1);
        cv::dilate(threshPrev, threshPrev, cv::Mat(), cv::Point(-1, -1), 1);

        int changedPrev = cv::countNonZero(threshPrev);
        double fracPrev = totalPixels > 0
            ? static_cast<double>(changedPrev) / static_cast<double>(totalPixels)
            : 0.0;

        bool globalChange = (fracPrev > globalChangeFrac_);

        if (!globalChange &&
            changedPrev >= minChangedPixels_ &&
            fracPrev >= sensitivity_) {
            motionFast = true;
        }
    }

    // 4) SLOW path: diff vs background (good for slow motion)
    if (hasBg_) {
        cv::Mat bgU8, diffBg, threshBg;
        bgFloat_.convertTo(bgU8, CV_8U);

        cv::absdiff(gray, bgU8, diffBg);

        // Slightly more sensitive threshold for background
        int bgThreshold = std::max(5, thresholdValue_ / 2); // e.g. 10 if thresholdValue_ = 20
        cv::threshold(diffBg, threshBg, bgThreshold, 255, cv::THRESH_BINARY);

        cv::erode(threshBg, threshBg, cv::Mat(), cv::Point(-1, -1), 1);
        cv::dilate(threshBg, threshBg, cv::Mat(), cv::Point(-1, -1), 1);

        int changedBg = cv::countNonZero(threshBg);
        double fracBg = totalPixels > 0
            ? static_cast<double>(changedBg) / static_cast<double>(totalPixels)
            : 0.0;

        // Here you can be a bit more generous with thresholds
        if (changedBg >= minChangedPixels_ &&
            fracBg >= sensitivity_ * 0.5) { // 0.5x sensitivity for slow path
            motionBg = true;
        }

        // 5) Update background model (slowly)
        cv::accumulateWeighted(gray, bgFloat_, bgAlpha_);
    }

    bool motionNow = (motionFast || motionBg);

    if (motionNow) {
        lastMotionTime_ = Clock::now();
    }

    // 6) Always update previous frame
    gray.copyTo(prevSmallGray_);

    return motionNow;
}





bool MotionDetector::update(const cv::Mat& frame, const MotionUpdateParams& p) {
    if (frame.empty()) return false;

    // resolve params (usa membros se não vier override)
    const double sensitivity      = p.sensitivity.value_or(sensitivity_);
    const int    thresholdValue   = p.thresholdValue.value_or(thresholdValue_);
    const int    minChangedPixels = p.minChangedPixels.value_or(minChangedPixels_);
    const double globalChangeFrac = p.globalChangeFrac.value_or(globalChangeFrac_);
    const double bgAlpha          = p.bgAlpha.value_or(bgAlpha_);

    // 1) Downscale + grayscale
    cv::Mat small, gray;
    cv::resize(frame, small, cv::Size(160, 90));
    cv::cvtColor(small, gray, cv::COLOR_BGR2GRAY);
    cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);

    int totalPixels = gray.rows * gray.cols;

    if (!hasPrev_) {
        gray.copyTo(prevSmallGray_);
        gray.convertTo(bgFloat_, CV_32F);
        hasPrev_ = true;
        hasBg_ = true;
        lastMotionTime_ = Clock::now();
        return false;
    }

    bool motionFast = false;
    bool motionBg = false;

    // 3) FAST path
    {
        cv::Mat diffPrev, threshPrev;
        cv::absdiff(gray, prevSmallGray_, diffPrev);
        cv::threshold(diffPrev, threshPrev, thresholdValue, 255, cv::THRESH_BINARY);

        cv::erode(threshPrev, threshPrev, cv::Mat(), cv::Point(-1, -1), 1);
        cv::dilate(threshPrev, threshPrev, cv::Mat(), cv::Point(-1, -1), 1);

        int changedPrev = cv::countNonZero(threshPrev);
        double fracPrev = totalPixels > 0 ? (double)changedPrev / (double)totalPixels : 0.0;

        bool globalChange = (fracPrev > globalChangeFrac);

        if (!globalChange &&
            changedPrev >= minChangedPixels &&
            fracPrev >= sensitivity) {
            motionFast = true;
        }
    }

    // 4) SLOW path
    if (hasBg_) {
        cv::Mat bgU8, diffBg, threshBg;
        bgFloat_.convertTo(bgU8, CV_8U);

        cv::absdiff(gray, bgU8, diffBg);

        int bgThreshold = std::max(5, thresholdValue / 2);
        cv::threshold(diffBg, threshBg, bgThreshold, 255, cv::THRESH_BINARY);

        cv::erode(threshBg, threshBg, cv::Mat(), cv::Point(-1, -1), 1);
        cv::dilate(threshBg, threshBg, cv::Mat(), cv::Point(-1, -1), 1);

        int changedBg = cv::countNonZero(threshBg);
        double fracBg = totalPixels > 0 ? (double)changedBg / (double)totalPixels : 0.0;

        if (changedBg >= minChangedPixels &&
            fracBg >= sensitivity * 0.5) {
            motionBg = true;
        }

        // usa bgAlpha local
        cv::accumulateWeighted(gray, bgFloat_, bgAlpha);
    }

    bool motionNow = (motionFast || motionBg);
    if (motionNow) lastMotionTime_ = Clock::now();

    gray.copyTo(prevSmallGray_);
    return motionNow;
}






bool MotionDetector::hasRecentMotion() const {
    auto now = Clock::now();
    auto elapsed = now - lastMotionTime_;
    return elapsed <= idleTimeout_;
}

std::optional<MotionDetector::Clock::duration>
MotionDetector::timeSinceLastMotion() const {
    auto now = Clock::now();
    return now - lastMotionTime_;
}

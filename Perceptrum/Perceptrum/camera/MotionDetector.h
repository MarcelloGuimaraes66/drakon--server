#pragma once

#include <chrono>
#include <optional>
#include <string>
#include <opencv2/core.hpp>



struct MotionUpdateParams {
    std::optional<double> sensitivity;      // usa sensitivity_ se nullopt
    std::optional<int>    thresholdValue;   // usa thresholdValue_ se nullopt
    std::optional<int>    minChangedPixels; // usa minChangedPixels_ se nullopt
    std::optional<double> globalChangeFrac; // usa globalChangeFrac_ se nullopt
    std::optional<double> bgAlpha;          // usa bgAlpha_ se nullopt
};


class MotionDetector {
public:
    using Clock = std::chrono::steady_clock;



    // sensitivity = fraction of pixels that must change (e.g. 0.01 = 1%)
    // idleTimeout = how long we keep "recent motion" true after last detection
    MotionDetector(const std::string& cameraId,
        double sensitivity = 0.02,
        std::chrono::seconds idleTimeout = std::chrono::seconds(5));

    // Update with a new frame; returns true if motion detected *in this frame*.
    bool update(const cv::Mat& frame);

    // permite override dos parâmetros
    bool update(const cv::Mat& frame, const MotionUpdateParams& p);

    // True if there was motion within idleTimeout_.
    bool hasRecentMotion() const;

    // How long since last motion, if known.
    std::optional<Clock::duration> timeSinceLastMotion() const;

    
private:
    std::string cameraId_;
    double sensitivity_;
    std::chrono::seconds idleTimeout_;

    // Previous frame (downscaled gray)
    cv::Mat prevSmallGray_;
    bool hasPrev_ = false;

    Clock::time_point lastMotionTime_;

    // Internal tuning parameters
    int    thresholdValue_ = 20;   // per-pixel diff threshold
    int    minChangedPixels_ = 80;   // ignore tiny specks / noise
    double globalChangeFrac_ = 0.5;  // if more than 50% of pixels change, treat as global (AF/AE)

    // --- NEW: background model for slow motion ---
    cv::Mat bgFloat_;         // CV_32F background
    bool hasBg_ = false;
    double bgAlpha_ = 0.02;   // learning rate (smaller = slower update, more "memory")

};

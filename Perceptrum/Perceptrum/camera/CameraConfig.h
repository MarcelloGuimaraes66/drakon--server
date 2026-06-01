#pragma once

#include <string>
#include <vector>
#include <cstdint>
#include <nlohmann/json.hpp>

struct AlgorithmConfig {
    int algorithmId{ -1 };
    std::string type;
    std::string llmPrompt;
    std::string displayName;
    nlohmann::json configJson;
    bool isCustomV2{ false };
    std::string priorityLevel{ "MEDIUM" };
    std::string promptTemplate;
    std::string alertCondition;
    std::string negativeCondition;
    std::string inputType{ "video" };
    std::string videoPackagingMode{ "mosaic_3x3" };
    std::string inferenceModel{ "ultra" };
    int runEverySeconds{ 60 };
    int runningResolution{ 640 }; // core only: 640 or 1024
    bool onlyCaptureOnMotion{ true };
    int modelFps{ 1 };
    std::string modelName{ "gpt-5.1" };
    std::string validatorModelName{ "gpt-5.1" };
    std::string modelApiKey;
    std::string validatorModelApiKey;
    std::string temporalPlanHash;
    std::string temporalPlanVersion;
    std::string temporalCompiledAt;
    std::string temporalCompileModel;
    nlohmann::json temporalPlanEnvelope = nlohmann::json::object();
    nlohmann::json alertChannels = nlohmann::json::object();

    struct AnalysisRegionPoint {
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

    struct AnalysisRegion {
        std::string regionId;
        std::string label;
        bool enabled = true;
        bool fullFrame = true;
        std::vector<AnalysisRegionPoint> polygonNorm;
        int drawRefWidth = 1920;
        int drawRefHeight = 1080;
        FrameWindowNorm frameWindowNorm;
    };

    struct FaceTargetImage {
        int id = -1;
        std::string imageUrl;
    };

    struct FaceTarget {
        int id = -1;
        std::string name;
        std::string description;
        std::vector<FaceTargetImage> images;
    };

    struct NegativeReferenceImage {
        int id = -1;
        std::string imageUrl;
    };

    std::vector<AnalysisRegion> analysisRegions;
    std::vector<FaceTarget> faceTargets;
    std::vector<NegativeReferenceImage> negativeReferenceImages;
};

struct StorageConfig {
    bool storeFrames{ false };
    int  retentionDays{ 0 };
    bool hydrateExistingSegments{ true };
};


struct CameraConfig {
    std::string id;
    std::string name;
    std::string rtspUrl;

    double expectedFps = 1.0;
    std::string modelPath;
    std::string labelsPath;

    std::string captureAccelerationMode{ "cpu" };
    bool useGpu{ false };
    std::uint64_t resourceEstimateCpuBytes = 0;
    std::uint64_t resourceEstimateGpuBytes = 0;

    // List of algorithm types that came from payload.enabled_algorithms
    std::vector<std::string> enabledAlgorithms;

    std::vector<AlgorithmConfig> algorithms;

    int webcam_index = -1;

    StorageConfig storage;

    // "frame_rate" from payload: one frame every N seconds goes to inference buffer
    int frameCaptureIntervalSeconds = 1;   // 1 = every second (premium); 8 = every 8s; 12 = every 12s...

    long long timeOffsetSeconds = 0;

    int analysisSpeed = 3;               // 1, 3, 5, 10 (seconds per frame)
    std::string modelTier = "light";     // "light" | "plus" | "pro"

    bool telegramEnabled{ false };
    std::string telegramBotToken;
    std::string telegramChatId;
    std::string cameraSessionId;
    std::string startOrigin;
    bool isDrakonFindTemporarySession{ false };
    bool isVideoSearchTemporarySession{ false };

    std::string descriptionModelName{ "gpt-5.1" };
    std::string descriptionModelApiKey;

    // Direct camera AI Agents can inherit a camera-wide capture policy that
    // mirrors the Jobs/Steps capture mode control.
    bool directCaptureOnMotionOnly{ false };

    // Preserve legacy manual behavior: when camera is started directly with no
    // enabled inference agents, keep recording video even if image-only demands
    // appear later (e.g., from jobs).
    bool forceVideoRecordingWithoutInference{ false };

};

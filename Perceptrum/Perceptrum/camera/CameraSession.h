#pragma once
#include <string>
#include <thread>
#include <atomic>
#include <iostream>

#include "CameraConfig.h"
#include "FrameBuffer.h"
#include "MotionDetector.h"
#include "FrameDiskWriter.h"


#include <memory>
#include <chrono>

#include <mutex>
#include <deque>
#include <opencv2/opencv.hpp>
#include <condition_variable>
#include <unordered_map>



class AgentCore;

// Sess?o de uma c?mera: captura + (futuro) infer?ncia usando FrameBuffer.
class CameraSession {
public:
    struct OpenMonitorSnapshot {
        int cameraId = -1;
        std::string cameraName;
        bool streamOnline = false;
        bool captureEnabled = false;
        bool inferenceEnabled = false;
        double actualFps = 0.0;
        double expectedFps = 0.0;
        std::uint64_t lastFrameAgeMs = 0;
        int queueDepth = 0;
        std::uint64_t overwrittenFrames = 0;
        std::uint64_t reconnectCount = 0;
        int consumerCount = 0;
        int width = 0;
        int height = 0;
        bool useGpu = false;
        double captureThreadCpuPercent = 0.0;
        std::uint64_t captureMemEstimatedBytes = 0;
        std::uint64_t processWorkingSetBytes = 0;
        std::uint64_t processPrivateBytes = 0;
        std::uint64_t captureReadLatencyTotalUs = 0;
        std::uint64_t captureReadSamples = 0;
        std::uint64_t decodeLatencyTotalUs = 0;
        std::uint64_t decodeSamples = 0;
        std::uint64_t diskReadBytesTotal = 0;
        std::uint64_t diskReadLatencyTotalUs = 0;
        std::uint64_t diskReadOperations = 0;
        std::uint64_t diskWriteBytesTotal = 0;
        std::uint64_t diskWriteLatencyTotalUs = 0;
        std::uint64_t diskWriteOperations = 0;
        std::uint64_t inferenceInputTotal = 0;
        std::uint64_t inferenceProcessedTotal = 0;
        std::uint64_t lastInferenceAgeMs = 0;
        std::uint64_t inferenceSuccessCount = 0;
        std::uint64_t inferenceErrorCount = 0;
        std::vector<int> activeJobIds;
    };

    CameraSession(const CameraConfig& cfg,
        std::shared_ptr<void> bufferEngine,
        std::shared_ptr<void> inferenceFactory);

    ~CameraSession();

    const std::string& id() const { return config_.id; }

    void start();
    void stop();

    //void setOwner(AgentCore* owner) { owner_ = owner; }

    void setOwner(AgentCore* owner);
    void setDirectServiceRequested(bool requested);
    void updateDirectCaptureOnMotion(bool onlyCaptureOnMotion);
    bool directCaptureOnMotion() const { return directCaptureOnMotionOnly_.load(std::memory_order_relaxed); }


    void updateAlgorithms(std::vector<AlgorithmConfig> algos);
    void updateTelegramSettings(bool enabled, std::string botToken, std::string chatId);
    bool matchesStartConfig(const CameraConfig& cfg) const;

    std::string getLastJobStillJpegBase64() const;

    std::string getLastJobStillTsUtcIso() const;

    // True when capture stream is currently healthy/connected.
    bool isStreamOnline() const { return streamOnline_.load(std::memory_order_relaxed); }
    OpenMonitorSnapshot getOpenMonitorSnapshot() const;

private:
    // Ponto ?nico que sobe as threads base da c?mera
    void base_camera_thread();

    void captureLoop_();
    // Futuro:
    void inferenceLoop_();
    std::string currentStartOrigin_() const;

    CameraConfig config_;

    // Buffer de frames compartilhado entre captura e infer?ncia
    FrameBuffer buffer_;

    std::atomic<bool> running_{ false };
    std::atomic<bool> streamOnline_{ false };
    std::atomic<bool> directServiceRequested_{ false };
    std::atomic<bool> directCaptureOnMotionOnly_{ false };
    std::thread        captureThread_;
    std::thread     inferenceThread_;

    std::thread descriptionThread_;

    // Controle de motion / skip
    std::atomic<bool> skipFrames_{ false };
    std::atomic<bool> captureEnabled_{ false };
    std::atomic<bool> inferenceEnabled_{ false };
    std::chrono::steady_clock::time_point lastMotionSeen_{ std::chrono::steady_clock::now() };
    std::chrono::steady_clock::time_point lastMotionForImageSnapshot_{ std::chrono::steady_clock::time_point::min() };

    MotionDetector motionDetector_;

    FrameDiskWriter frameDiskWriter_;

    AgentCore* owner_ = nullptr;

    std::chrono::steady_clock::time_point lastThumbnailSent_{};

    bool shouldPublishDashboardThumbnail_() const;
    void maybePublishDashboardThumbnail_(const cv::Mat& frame, std::chrono::steady_clock::time_point now);
    void sendThumbnail_(const cv::Mat& frame);

    void thumbnailLoop_();
    void enqueueThumbnail_(std::string b64);

    std::thread thumbnailThread_;
    std::atomic<bool> thumbnailStop_{ false };
    std::mutex thumbnailMutex_;
    std::condition_variable thumbnailCv_;
    std::string pendingThumbnailB64_;
    bool thumbnailPending_{ false };


    std::atomic<bool> descriptionCheckStarted_{ false };
    void checkCameraDescriptionOnce_();

    std::mutex firstFrameMutex_;
    std::condition_variable firstFrameCv_;
    cv::Mat firstFrameForDescription_;
    std::atomic<bool> firstFrameSaved_{ false };
    std::atomic<bool> descriptionFrameRequested_{ false };

    void sendCameraDescription(const std::string& cameraIdStr,
        const std::string& description,
        bool descriptionFirstCheckSuccessful);

    void runWebcamCapture_(int webcamIndex);

    mutable std::mutex algorithmsMutex_;
    bool hasDirectVideoInferenceConfigured_();
    bool hasDirectImageInferenceConfigured_();
    bool shouldForceVideoCapture_() const;
    std::vector<VideoCaptureProfile> getConfiguredVideoCaptureProfiles_() const;
    std::vector<VideoCaptureProfile> getEffectiveRecordingProfiles_() const;
    bool isCustomAlgorithmDueNow_(const std::string& algoType, int runEverySeconds);
    bool shouldRunCustomAlgorithmNow_(const std::string& algoType, int runEverySeconds);
    std::mutex customImageMotionMutex_;
    std::unordered_map<std::string, cv::Mat> customImagePreviousByAlgo_;
    std::mutex customRunEveryMutex_;
    std::unordered_map<std::string, std::chrono::steady_clock::time_point> customLastRunAtByAlgo_;
    struct TemporalEvidenceItem {
        std::string evidenceKey;
        std::string eventName;
        std::string entityId;
        std::string zone;
        int frameIndex = -1;
        std::string frameTimestampInSegment;
        std::string timestampName;
        std::string timestampUtcIso;
        std::string timestampLocalIso;
        std::string reason;
        std::string imageJpegBase64;
    };
    struct TemporalRuntimeSlot {
        nlohmann::json planEnvelope = nlohmann::json::object();
        nlohmann::json state = nlohmann::json::object();
        nlohmann::json visualState = nlohmann::json::object();
        std::string promptHash;
        std::chrono::steady_clock::time_point touchedAt{};
    };
    std::mutex temporalMutex_;
    std::unordered_map<std::string, TemporalRuntimeSlot> temporalByAlgo_;
    std::unordered_map<std::string, std::deque<TemporalEvidenceItem>> temporalEvidenceByAlgo_;

    void maybeUpdateJobStill_(const cv::Mat& frame, std::chrono::steady_clock::time_point now);
    mutable std::mutex jobStillMutex_;
    std::string lastJobStillB64_;
    std::chrono::steady_clock::time_point lastJobStillAt_{};
    std::string lastJobStillTsUtcIso_;

    std::atomic<std::uint64_t> telemetryLastFrameTickMs_{ 0 };
    std::atomic<double> telemetryActualFps_{ 0.0 };
    std::atomic<int> telemetryQueueDepth_{ 0 };
    std::atomic<double> telemetryCaptureThreadCpuPercent_{ 0.0 };
    std::atomic<std::uint64_t> telemetryCaptureMemEstimatedBytes_{ 0 };
    std::atomic<std::uint64_t> telemetryProcessWorkingSetBytes_{ 0 };
    std::atomic<std::uint64_t> telemetryProcessPrivateBytes_{ 0 };
    std::atomic<int> telemetryFrameWidth_{ 0 };
    std::atomic<int> telemetryFrameHeight_{ 0 };
    std::atomic<std::uint64_t> telemetryReconnectCount_{ 0 };
    std::atomic<std::uint64_t> telemetryCaptureReadLatencyTotalUs_{ 0 };
    std::atomic<std::uint64_t> telemetryCaptureReadSamples_{ 0 };
    std::atomic<std::uint64_t> telemetryDecodeLatencyTotalUs_{ 0 };
    std::atomic<std::uint64_t> telemetryDecodeSamples_{ 0 };
    std::atomic<std::uint64_t> telemetryDiskReadBytesTotal_{ 0 };
    std::atomic<std::uint64_t> telemetryDiskReadLatencyTotalUs_{ 0 };
    std::atomic<std::uint64_t> telemetryDiskReadOperations_{ 0 };
    std::atomic<std::uint64_t> telemetryInferenceInputTotal_{ 0 };
    std::atomic<std::uint64_t> telemetryInferenceProcessedTotal_{ 0 };
    std::atomic<std::uint64_t> telemetryLastInferenceTickMs_{ 0 };
    std::atomic<std::uint64_t> telemetryInferenceSuccessCount_{ 0 };
    std::atomic<std::uint64_t> telemetryInferenceErrorCount_{ 0 };

};


void startTokenUsageWorker();
void stopTokenUsageWorker();
void startCaptureMetricsWorker();
void stopCaptureMetricsWorker();
void startOpenMonitorWorker(AgentCore* owner);
void stopOpenMonitorWorker();


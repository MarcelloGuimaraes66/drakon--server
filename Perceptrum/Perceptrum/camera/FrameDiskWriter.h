#pragma once

#include <string>
#include <chrono>
#include <deque>
#include <filesystem>
#include <cstdint>
#include <atomic>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <opencv2/opencv.hpp>
#include <functional>
#include <vector>

struct VideoCaptureProfile {
    int clipSeconds = 10;
    int fps = 1;
};

/**
 * Writes rolling video segments directly to disk at the configured profile FPS.
 *
 * Called once per frame from CameraSession::captureLoop_.
 * Each enabled profile keeps its own cadence and clip rotation window.
 *
 * File layout example:
 *   baseDir/cam_<id>/YYYY/MM/DD/
 *     <id>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_10s.mp4
 *     <id>_YYYYMMDD_HHMMSS_YYYYMMDD_HHMMSS_60s.mp4
 */
class FrameDiskWriter {
public:
    struct RetentionSweepStats {
        int scannedFiles = 0;
        int deletedFiles = 0;
        int parsedByNameTimestamp = 0;
        int parsedByFileTime = 0;
        int prunedDirectories = 0;
        int failed = 0;
    };

    struct IoTelemetrySnapshot {
        std::uint64_t bytesWrittenTotal = 0;
        std::uint64_t writeLatencyTotalUs = 0;
        std::uint64_t writeOperations = 0;
    };

    FrameDiskWriter(
        const std::string& cameraId,
        const std::string& baseDir,
        bool enabled,
        std::chrono::milliseconds minInterval = std::chrono::milliseconds(0),
        std::chrono::seconds timeOffset = std::chrono::seconds(0),
        double outputFps = 1.0,  // default: 1 FPS segments
        int retentionDays = 0,
        bool hydrateExistingSegments = true
    );
    ~FrameDiskWriter();

    void setEnabled(bool enabled);
    void setMinInterval(std::chrono::milliseconds interval);
    void setOutputFps(double fps);
    void setCaptureProfiles(const std::vector<VideoCaptureProfile>& profiles);
    static RetentionSweepStats runRetentionCleanupNow(
        const std::string& cameraId,
        const std::string& baseDir,
        int retentionDays);
    void runRetentionCleanupIfDue();
    IoTelemetrySnapshot getIoTelemetrySnapshot() const;

    /// Called per frame. Will:
    ///  - throttle each enabled profile to its configured FPS
    ///  - append frames to the active 10s and/or 60s segments
    ///  - finalize each segment when it reaches its configured clip duration
    void save(const cv::Mat& frame);
    void flushVideoClipIfIdle(std::chrono::milliseconds idleThreshold);
    bool shouldEmitImageSnapshotOnlyNow() const;

    struct MaterializeOpenClipResult {
        bool attempted = false;
        bool materialized = false;
        bool waitingForTarget = false;
        bool targetOutsideOpenClip = false;
        bool noOpenClip = false;
        int clipSeconds = 0;
        std::string reason;
        std::string openClipPath;
        std::string clipStartUtcIso;
        std::string clipScheduledEndUtcIso;
        std::string lastFrameUtcIso;
        std::string finalizedPath;
        std::string finalizedEndUtcIso;
    };

    MaterializeOpenClipResult materializeOpenClipThroughUtc(
        const std::chrono::system_clock::time_point& targetUtc,
        int preferredClipSeconds = 10);
    void forceFinalizeAllOpenClips(const std::string& reason = std::string());

    
    //void setJobsCopyPredicate(std::function<bool()> pred);

    //void setJobsCopyJobIdsProvider(std::function<std::vector<int>()> provider);

    struct JobsCopyTarget {
        int jobId = -1;
        int stepId = -1;
        bool needsVideo = true;
        bool copyVideo = true;
        bool copyImage = false;
    };

    void setJobsCopyTargetsProvider(std::function<std::vector<JobsCopyTarget>()> provider);
    void setInferenceCopyEnabledProvider(std::function<bool()> provider);
    void setInferenceImageCopyEnabledProvider(std::function<bool()> provider);
    void setForceVideoCaptureProvider(std::function<bool()> provider);


    

private:
    mutable std::mutex writerMutex_;
    std::string cameraId_;
    std::string baseDir_;
    bool enabled_{ false };
    std::chrono::milliseconds minInterval_{ 0 };
    std::chrono::steady_clock::time_point lastSaved_{};
    std::chrono::seconds timeOffset_{ 0 };
    double fps_{ 1.0 };
    int retentionDays_{ 0 };
    bool hydrateExistingSegments_{ true };
    std::chrono::steady_clock::time_point lastRetentionSweep_{};
    std::atomic<std::uint64_t> telemetryBytesWrittenTotal_{ 0 };
    std::atomic<std::uint64_t> telemetryWriteLatencyTotalUs_{ 0 };
    std::atomic<std::uint64_t> telemetryWriteOperations_{ 0 };


    //std::function<bool()> shouldCopyJobs_;

    std::function<std::vector<JobsCopyTarget>()> jobsTargetsProvider_;
    std::function<bool()> inferenceCopyEnabledProvider_;
    std::function<bool()> inferenceImageCopyEnabledProvider_;
    std::function<bool()> forceVideoCaptureProvider_;
    std::chrono::steady_clock::time_point lastImageSnapshotSaved_{};
    std::chrono::seconds imageSnapshotInterval_{ std::chrono::seconds(10) };

    void initializeFromDisk_();
    bool isValidMp4_(const std::string& path);

    // --- Media-Foundation-based segment writer (no external process) ---
    struct SegmentWriter {
        std::string path;
        double fps{ 0.0 };
        int width{ 0 };
        int height{ 0 };
        bool opened{ false };
        std::int64_t frameCount{ 0 };
        std::chrono::steady_clock::time_point clipStartAt{};
        std::chrono::steady_clock::time_point nextSampleAt{};
        std::chrono::system_clock::time_point clipStartWallTime{};
        bool timelineInitialized{ false };
        cv::Mat heldFrame;
        bool hasHeldFrame{ false };

#ifdef _WIN32
        struct MfEncoder;        // defined in .cpp
        MfEncoder* encoder{ nullptr };
#endif

        bool isOpened() const { return opened; }
    };

    // We write 10s and/or 60s directly depending on the active capture profiles.
    SegmentWriter writer10_;
    SegmentWriter writer60_;

    int framesIn10_{ 0 };
    int framesIn60_{ 0 };

    bool capture10Enabled_{ true };
    bool capture60Enabled_{ false };
    int capture10Fps_{ 1 };
    int capture60Fps_{ 0 };
    std::chrono::milliseconds minInterval10_{ std::chrono::milliseconds(1000) };
    std::chrono::milliseconds minInterval60_{ std::chrono::milliseconds(0) };
    std::chrono::steady_clock::time_point lastSaved10_{};
    std::chrono::steady_clock::time_point lastSaved60_{};

    // Paths of short clips
    std::deque<std::string> tenSecondPaths_;   // ~10s clips
    std::deque<std::string> sixtySecondPaths_; // ~60s clips

    bool canSaveNow_(std::chrono::steady_clock::time_point now) const;
    std::chrono::milliseconds activeMinInterval_() const;
    double activeClipFps_() const;
    static std::chrono::milliseconds intervalForFps_(double fps);
    static int normalizeClipFps_(double fps);
    static int probeClipFps_(const std::string& path);

    // time + directory helpers
    struct TimeParts {
        std::tm tmLocal{};
        int ms{ 0 };
    };
    std::chrono::steady_clock::time_point lastVideoFrameWriteAt10_{};
    std::chrono::steady_clock::time_point lastVideoFrameWriteAt60_{};
    std::chrono::system_clock::time_point lastVideoFrameWallTime10_{};
    std::chrono::system_clock::time_point lastVideoFrameWallTime60_{};
    TimeParts lastVideoFrameWriteTp10_{};
    TimeParts lastVideoFrameWriteTp60_{};
    bool hasLastVideoFrameWriteTp10_{ false };
    bool hasLastVideoFrameWriteTp60_{ false };
    bool hasLastVideoFrameWallTime10_{ false };
    bool hasLastVideoFrameWallTime60_{ false };
    TimeParts getTimeParts_() const;
    TimeParts getTimePartsForSystemTime_(
        const std::chrono::system_clock::time_point& tp) const;
    std::string ensureBaseDirAndMakePrefix_(const TimeParts& tp) const;
    void clearSegmentTimeline_(SegmentWriter& writer);

    // writer helpers
    void openWriterIfNeeded_(SegmentWriter& w,
        const std::string& path,
        const cv::Size& size,
        double fps,
        std::chrono::steady_clock::time_point clipStartAt,
        std::chrono::system_clock::time_point clipStartWallTime);
    void closeWriter_(SegmentWriter& w);
    void writeFrame_(SegmentWriter& w, const cv::Mat& frame);
    void recordWriteTelemetry_(std::uint64_t bytesWritten, std::uint64_t latencyUs);


    // rotation helpers
    void rotate10s_(
        const cv::Size& size,
        const TimeParts& tp,
        std::chrono::steady_clock::time_point clipStartAt,
        std::chrono::system_clock::time_point clipStartWallTime);
    void rotate60s_(
        const cv::Size& size,
        const TimeParts& tp,
        std::chrono::steady_clock::time_point clipStartAt,
        std::chrono::system_clock::time_point clipStartWallTime);

    // finalize clip filename to include end timestamp
    void finalizeLastClipName_(
        std::deque<std::string>& clipPaths,
        const TimeParts& endTp,
        const std::string& durationSuffix);
    void discardOpenClip_(
        SegmentWriter& writer,
        int& framesInClip,
        std::deque<std::string>& clipPaths,
        std::chrono::steady_clock::time_point& lastWriteAt,
        TimeParts& lastWriteTp,
        bool& hasLastWriteTp);
    bool finalizeOpenClip_(
        SegmentWriter& writer,
        int clipSeconds,
        int& framesInClip,
        std::deque<std::string>& clipPaths,
        std::chrono::steady_clock::time_point& lastWriteAt,
        TimeParts& lastWriteTp,
        bool& hasLastWriteTp,
        const std::vector<JobsCopyTarget>& jobsTargets,
        bool shouldCopyInferenceVideo,
        const TimeParts* forcedEndTp = nullptr);
    MaterializeOpenClipResult materializeProfileThroughUtc_(
        SegmentWriter& writer,
        int clipSeconds,
        int& framesInClip,
        std::deque<std::string>& clipPaths,
        std::chrono::steady_clock::time_point& lastWriteAt,
        TimeParts& lastWriteTp,
        bool& hasLastWriteTp,
        std::chrono::system_clock::time_point& lastFrameWallTime,
        bool& hasLastFrameWallTime,
        const std::vector<JobsCopyTarget>& jobsTargets,
        bool shouldCopyInferenceVideo,
        const std::chrono::system_clock::time_point& targetUtc);
    bool forceFinalizeProfile_(
        SegmentWriter& writer,
        int clipSeconds,
        int& framesInClip,
        std::deque<std::string>& clipPaths,
        std::chrono::steady_clock::time_point& lastWriteAt,
        TimeParts& lastWriteTp,
        bool& hasLastWriteTp,
        std::chrono::system_clock::time_point& lastFrameWallTime,
        bool& hasLastFrameWallTime,
        const std::vector<JobsCopyTarget>& jobsTargets,
        bool shouldCopyInferenceVideo,
        const std::string& reason);

    void saveLocked_(const cv::Mat& frame);
    void flushVideoClipIfIdleLocked_(std::chrono::milliseconds idleThreshold);
    MaterializeOpenClipResult materializeOpenClipThroughUtcLocked_(
        const std::chrono::system_clock::time_point& targetUtc,
        int preferredClipSeconds);
    void forceFinalizeAllOpenClipsLocked_(const std::string& reason);

    void workerLoop_();
    void beginSynchronousWorkerBarrier_(bool dropAsyncSaves = true);
    void endSynchronousWorkerBarrier_();

    bool asyncWorkerEnabled_{ true };
    mutable std::mutex workerStateMutex_;
    std::condition_variable workerCv_;
    std::condition_variable workerIdleCv_;
    std::thread workerThread_;
    cv::Mat pendingFrameBuffer_;
    cv::Mat workerFrameBuffer_;
    bool pendingFrameReady_{ false };
    bool pendingFlushRequested_{ false };
    std::chrono::milliseconds pendingFlushIdleThreshold_{ std::chrono::milliseconds(0) };
    bool workerStopRequested_{ false };
    bool workerPauseRequested_{ false };
    bool dropAsyncSavesWhilePaused_{ false };
    bool workerActive_{ false };

};

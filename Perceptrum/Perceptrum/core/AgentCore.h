#pragma once
#include <map>
#include <memory>
#include <thread>
#include <atomic>
#include <string>
#include <nlohmann/json.hpp>
#include <vector>
#include <cstdint>
#include <optional>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <utility>

#include "../camera/CameraSession.h"
#include "TemporalEvidence.h"


// Video data we send to Gemini (MP4 in memory)
struct EncodedVideoSegment {
    std::vector<std::uint8_t> bytes;
    std::string startTs;  // "YYYYMMDD_HHMMSS"
    std::string endTs;    // "YYYYMMDD_HHMMSS"

    std::string sourceFilePath; // caminho do mp4 usado para este segmento
    bool isTempFile = false;    // true if this is a temporary segment_*.mp4 file

    int cameraId = -1;           
    std::string cameraName;      

    // Job Step flags
    bool alertCondition = false;
    // -1 = not triggered; otherwise the id of the step to start
    int startConditionStepId = -1;

    // Uploaded-video analysis manifest. When enabled, sampling must obey these
    // exact chunk boundaries instead of inferring duration/fps from the file.
    bool uploadAnalysisSegment = false;
    int uploadChunkIndex = -1;
    int uploadChunkCount = 0;
    int uploadPlannedSampleStart = 0;
    int uploadPlannedSampleCount = 0;
    int uploadPlannedTotalSamples = 0;
    int uploadPlannedFps = 0;
    double uploadPlannedSamplingFps = 0.0;
    double uploadStartSeconds = 0.0;
    double uploadDurationSeconds = 0.0;

};

// Multi-camera IMAGE input for Gemini group inference (Job Steps)
struct GroupImageInput {
    int cameraId = -1;
    std::string cameraName;
    std::string regionId;
    std::string regionLabel;
    int regionIndex = -1;
    bool fullFrame = true;
    std::string snapshotTsUtcIso;
    std::string jpegBase64; // can be "data:image/jpeg;base64,..." or raw base64
    std::string injectedInput;
    // Optional provenance marker used only for diagnostics/logging.
    std::string sourceTag;
};

struct FaceReferenceImage {
    int targetId = -1;
    std::string targetName;
    std::string targetDescription;
    std::string referenceImageUrl;
    std::string imageDataUrl; // "data:image/jpeg;base64,..."
};

struct NegativeReferenceImage {
    int imageId = -1;
    std::string imageDataUrl; // "data:image/jpeg;base64,..."
};

struct DrakonFindReferenceImage {
    int imageId = -1;
    std::string imageUrl;
    std::string contentType;
    std::string imageDataUrl; // "data:image/jpeg;base64,..."
};

struct DrakonFindInferenceResult {
    bool hasMatch = false;
    double confidence = 0.0;
    std::string summary;
    nlohmann::json observedTraits = nlohmann::json::array();
    nlohmann::json detectionTimeInVideo = nlohmann::json::array();
    nlohmann::json raw = nlohmann::json::object();
};

// Result of analyzing ONE video segment
struct VideoHit {
    bool hasMatch = false;        // true if Gemini says this segment contains what user asked
    std::string answer;           // short natural-language answer from model

    // These fix the "no member 'timestamp' / 'framePath'" errors
    std::string framePath;        // representative frame path (optional, can stay empty)
    std::string timestamp;        // representative timestamp (optional)

    std::string segmentStartTs;   // segment start timestamp
    std::string segmentEndTs;     // segment end timestamp

    std::vector<std::string> detectionTimeInVideo;
    size_t segmentIndex = 0;

    int cameraId = -1;           
    std::string cameraName;      

    // Job Step flags
    bool alertCondition = false;
    bool faceIdMatch = false;
    std::vector<std::string> faceIdTargetNames;
    nlohmann::json faceIdentityMatches = nlohmann::json::array();
    nlohmann::json crossCameraWatchlistMatches = nlohmann::json::array();
    std::vector<std::string> alertRegionIds;
    // -1 = not triggered; otherwise the id of the step to start
    int startConditionStepId = -1;
    nlohmann::json identityPatch = nlohmann::json::array();
    nlohmann::json observations = nlohmann::json::array();
    nlohmann::json unknownReasons = nlohmann::json::array();
    bool temporalPayloadPresent = false;
    int eventFrameIndex = -1;
    std::string eventTimestampName;
    std::string eventFrameTimestampInSegment;
    std::string eventTimestampUtcIso;
    std::string eventTimestampLocalIso;
    std::vector<TemporalEvidenceCandidate> temporalEvidenceCandidates;
    // Chat-only visual fallback evidence synthesized from the analyzed prompt frames.
    // Kept separate from temporalEvidenceCandidates so it does not affect temporal state/memory.
    std::vector<TemporalEvidenceCandidate> chatFallbackEvidenceCandidates;
    nlohmann::json identityPortraitCandidates = nlohmann::json::array();
    nlohmann::json matchedEntityIds = nlohmann::json::array();
    nlohmann::json identityCards = nlohmann::json::array();
    std::string primaryIdentityCardId;
    bool analysisFailed = false;
    std::string analysisFailureReason;
    int plannedFrameCount = 0;
    int extractedFrameCount = 0;

};


class JobRuntime;
namespace chatv2 {
class ChatV2Orchestrator;
}


class AgentCore {
public:
    struct AgentEventPostResult {
        bool ok = false;
        long httpCode = -1;
        std::string response;
    };

    struct JobAlertVideoUploadResult {
        bool ok = false;
        bool skippedByBudget = false;
        long httpCode = -1;
        std::uintmax_t fileSizeBytes = 0;
        std::string response;
        std::string videoKey;
        std::string videoUrl;
        std::string error;
    };

    AgentCore(const std::string& baseUrl,
        const std::string& controlPlaneBaseUrl,
        const std::string& exeToken,
        const std::string& clientId);

    ~AgentCore();

    void start();
    void stop();

    void notifyCameraConnectionError(const std::string& cameraId,
        const std::string& rtspUrl,
        const std::string& errorMessage,
        const nlohmann::json& extraDetails = nlohmann::json::object());

    void sendThumbnail(const std::string& cameraId,
        const std::vector<unsigned char>& jpegBytes);
    void sendThumbnail(const std::string& cameraId,
        const std::string& jpegBase64);


    void sendAlgoEvent(const std::string& cameraId,
        const std::string& cameraName,
        const std::string& algoType,
        const std::string& timestampIso,
        const std::string& mediaType,
        const std::string& mediaBase64,
        const nlohmann::json& extraDetails = nlohmann::json::object());

    void initTimeSync();

    bool bootstrapCameras_();

    long long timeOffsetSeconds() const { return timeOffsetSeconds_; }

    std::vector<std::string> collectFramePathsForWindow(
        const std::string& framesRoot,
        const nlohmann::json& routerResult);

    struct FrameHit {
        std::string framePath;
        std::string timestamp;
    };


    bool downloadUrlToBytes_(const std::string& url, std::vector<uint8_t>& outBytes);

    std::string sendThumbnailAndGetUrl(const std::string& cameraId,
        const std::string& jpegBase64);


    const std::string& getClientId() const { return clientId_; }
    const std::string& getExeToken() const { return exeToken_; }
    const std::string& getBackendBaseUrl() const { return baseUrl_; }
    void executeVideoSearchPipeline(const nlohmann::json& payload);

    VideoHit runCameraCustomVideoInference(
        const EncodedVideoSegment& segment,
        const std::string& promptTemplate,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& modelName,
        const std::string& modelApiKey,
        int modelInputFps,
        int runningResolution,
        const std::string& videoPackagingMode,
        int expectedWindowSeconds,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens);

    VideoHit runCameraCustomImageInference(
        int cameraId,
        const std::string& jpegBase64,
        const std::string& promptTemplate,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& modelName,
        const std::string& modelApiKey,
        const std::string& snapshotTsUtcIso,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens);

    bool materializeOperationalIdentityCards(
        VideoHit& hit,
        nlohmann::json& temporalState,
        nlohmann::json& visualState,
        const std::string& logStreamId = std::string(),
        const std::string& scopeTag = std::string());
    nlohmann::json collectOperationalIdentityCards(
        const nlohmann::json& temporalState,
        nlohmann::json& visualState);

    bool isRunning() const;

    bool ensureTemporalPlanForRuntime(
        const std::string& sourceType,
        int sourceId,
        const std::string& promptCore,
        const std::string& alertCondition,
        const std::string& negativeCondition,
        const std::string& inputType,
        const std::string& language,
        const std::string& modelFamily,
        const std::string& compileApiKey,
        nlohmann::json& inOutPlanEnvelope,
        bool persistResult = true,
        const std::string& runtimeLogId = "");


    // Used by JobRuntime
    void postAgentEvent(
        const std::string& eventType,
        std::optional<int> cameraId,
        const std::string& userId,
        const std::string& message,
        const nlohmann::json& details
    );
    AgentEventPostResult postAgentEventWithResult(
        const std::string& eventType,
        std::optional<int> cameraId,
        const std::string& userId,
        const std::string& message,
        const nlohmann::json& details
    );
    JobAlertVideoUploadResult uploadJobAlertVideo(
        int cameraId,
        int jobId,
        int stepId,
        const std::string& filePathUtf8
    );
    CameraSession* getCameraSession(int cameraId);
    bool isCameraStreamOnline(int cameraId) const;
    std::vector<CameraSession::OpenMonitorSnapshot> collectOpenMonitorCameraSnapshots() const;

    struct ResourceAdmissionCamera {
        int cameraId = -1;
        std::string cameraName;
        std::string cameraSessionId;
        std::string captureMode = "cpu";
        std::uint64_t requiredCpuBytes = 0;
        std::uint64_t requiredGpuBytes = 0;
        bool wasRunningBefore = false;
    };

    struct ResourceAdmissionDecision {
        bool allowed = true;
        std::string reasonCode;
        std::string message;
        std::string device = "cpu";
        std::string deviceSummary;
        std::uint64_t requiredCpuBytes = 0;
        std::uint64_t requiredGpuBytes = 0;
        std::uint64_t availableCpuBytes = 0;
        std::uint64_t availableGpuBytes = 0;
        std::uint64_t gpuTotalBytes = 0;
        std::uint64_t gpuBudgetBytes = 0;
        std::uint64_t reclaimedCpuBytes = 0;
        std::uint64_t reclaimedGpuBytes = 0;
        std::string gpuAdapterName;
        std::vector<ResourceAdmissionCamera> blockedCameras;
    };

    struct JobStepCameraStartResult {
        bool ok = true;
        std::string error;
        ResourceAdmissionDecision blockedDecision;
        std::vector<int> startedCameraIds;
    };

    // JobRuntime: start/stop cameras using the same transport session while
    // keeping direct runs isolated from job-owned leases.
    void ensureCameraStartedForJob(int cameraId, int jobId, int stepId, const nlohmann::json& startPayload);
    void stopCameraForJob(int cameraId, int jobId, int stepId);

    // JobRuntime calls these
    //void jobsCaptureAcquire(int cameraId, int jobId);
    //void jobsCaptureRelease(int cameraId, int jobId);

    struct JobStepKey {
        int jobId = -1;
        int stepId = -1;

        bool operator==(const JobStepKey& o) const noexcept {
            return jobId == o.jobId && stepId == o.stepId;
        }
    };

    struct JobStepKeyHash {
        size_t operator()(const JobStepKey& k) const noexcept {
            // simple stable hash
            return (std::hash<int>{}(k.jobId) * 1315423911u) ^ std::hash<int>{}(k.stepId);
        }
    };

    // enable/disable capture copy per step
    void jobsCaptureAcquire(
        int cameraId,
        int jobId,
        int stepId,
        bool needsVideo,
        bool needsImage,
        int requestedTenSecondVideoFps,
        int requestedSixtySecondVideoFps,
        bool onlyCaptureOnMotion = true);
    void jobsCaptureRelease(int cameraId, int jobId, int stepId);

    // FrameDiskWriter vai chamar isso
    std::vector<FrameDiskWriter::JobsCopyTarget> getActiveJobStepsForCamera(int cameraId) const;


    // FrameDiskWriter queries this via CameraSession/AgentCore
    bool isJobsCaptureEnabled(int cameraId) const;
    bool shouldOnlyCaptureOnMotion(int cameraId) const;
    bool consumeJobsBootstrapCaptureIfRequested(int cameraId);
    int getJobsRequestedVideoCaptureFps(int cameraId, int clipSeconds) const;
    int getChatRequestedVideoCaptureFps(int cameraId, int clipSeconds) const;
    int getDrakonFindRequestedVideoCaptureFps(int cameraId, int clipSeconds) const;

    std::vector<int> getActiveJobIdsForCamera(int cameraId) const;

    friend class JobRuntime;



private:
    struct EventMediaUploadResult {
        bool ok = false;
        long httpCode = -1;
        std::string response;
        std::string storageKey;
        std::string mediaUrl;
        std::string error;
    };

    struct DrakonFindTaskState {
        std::atomic<bool> cancelRequested{ false };
        std::atomic<bool> done{ false };
    };

    struct DrakonFindTask {
        std::shared_ptr<DrakonFindTaskState> state;
        std::thread worker;
    };

    struct ChatTaskState {
        std::atomic<bool> cancelRequested{ false };
        std::atomic<bool> done{ false };
    };

    struct CoreModelExecutionLease {
        AgentCore* owner = nullptr;
        bool active = false;

        CoreModelExecutionLease() = default;
        CoreModelExecutionLease(AgentCore* owner, bool active);
        CoreModelExecutionLease(const CoreModelExecutionLease&) = delete;
        CoreModelExecutionLease& operator=(const CoreModelExecutionLease&) = delete;
        CoreModelExecutionLease(CoreModelExecutionLease&& other) noexcept;
        CoreModelExecutionLease& operator=(CoreModelExecutionLease&& other) noexcept;
        ~CoreModelExecutionLease();

        explicit operator bool() const noexcept { return active; }
        void release();
    };

    struct CoreChatPriorityReservation {
        AgentCore* owner = nullptr;
        bool active = false;

        CoreChatPriorityReservation() = default;
        CoreChatPriorityReservation(AgentCore* owner, bool active);
        CoreChatPriorityReservation(const CoreChatPriorityReservation&) = delete;
        CoreChatPriorityReservation& operator=(const CoreChatPriorityReservation&) = delete;
        CoreChatPriorityReservation(CoreChatPriorityReservation&& other) noexcept;
        CoreChatPriorityReservation& operator=(CoreChatPriorityReservation&& other) noexcept;
        ~CoreChatPriorityReservation();

        explicit operator bool() const noexcept { return active; }
        void release();
    };

    struct ChatTemporalState;

    EventMediaUploadResult uploadEventMedia_(
        int cameraId,
        const std::string& kind,
        const std::string& rawBase64OrDataUrl,
        const std::string& contentTypeHint = std::string()) const;
    void promotePrimaryEventMediaReferences_(int cameraId, nlohmann::json& details) const;

    void workerLoop_();
    void processCommand_(const nlohmann::json& cmd);
    void handlePromptEnhanceCommand_(int commandId, const nlohmann::json& payload);
    void handleAgentDesignCommand_(int commandId, const nlohmann::json& payload);
    void handleRefreshThumbnailCommand_(int commandId, const nlohmann::json& payload);
    void handleCameraImportPreviewCommand_(int commandId, const nlohmann::json& payload);
    void handleTemporalRecompileCommand_(int commandId, const nlohmann::json& payload);
    void handleProbeWebcamsCommand_(int commandId, const nlohmann::json& payload);
    void handleProbeCameraCaptureAccelerationCommand_(int commandId, const nlohmann::json& payload);
    void handleDrakonFindStartCommand_(int commandId, const nlohmann::json& payload);
    void handleDrakonFindCancelCommand_(int commandId, const nlohmann::json& payload);
    void handleChatCancelCommand_(int commandId, const nlohmann::json& payload);
    void handleChatIdentityUpsertCommand_(int commandId, const nlohmann::json& payload);
    DrakonFindInferenceResult runDrakonFindImageInference_(
        int cameraId,
        const std::string& jpegBase64,
        const std::string& searchPrompt,
        const std::vector<DrakonFindReferenceImage>& referenceImages,
        const std::string& modelName,
        const std::string& modelApiKey,
        const std::string& snapshotTsUtcIso,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens);
    DrakonFindInferenceResult runDrakonFindVideoInference_(
        const EncodedVideoSegment& segment,
        const std::string& searchPrompt,
        const std::vector<DrakonFindReferenceImage>& referenceImages,
        const std::string& modelName,
        const std::string& modelApiKey,
        int modelInputFps,
        int expectedWindowSeconds,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens);
    bool uploadDrakonFindHitMedia_(
        int searchId,
        int cameraId,
        int attemptCount,
        const std::string& mediaType,
        const std::string& contentType,
        const std::vector<std::uint8_t>& bytes,
        const std::string& timeInVideo,
        std::string& outKey,
        std::string& outUrl);
    void cleanupCompletedDrakonFindTasks_(bool joinAll = false);
    void cleanupCompletedChatTasks_();
    std::shared_ptr<ChatTaskState> registerChatTask_(int chatSessionId);
    bool isChatCancellationRequested_(int chatSessionId) const;
    void postCommandResult_(
        int commandId,
        const std::string& status,
        const nlohmann::json& resultPayload);
    bool loadPersistedChatTemporalState_(int chatSessionId, ChatTemporalState& outState);
    bool persistChatTemporalState_(int chatSessionId, const ChatTemporalState& state);
    CameraConfig buildCameraConfigFromPayload_(int cameraId, const nlohmann::json& payload);
    struct GpuMemorySnapshot {
        bool available = false;
        std::string adapterName;
        std::uint64_t totalBytes = 0;
        std::uint64_t budgetBytes = 0;
        std::uint64_t currentUsageBytes = 0;
        std::uint64_t availableBytes = 0;
    };
    struct CameraStartOutcome {
        bool started = false;
        bool reused = false;
        bool blocked = false;
        bool wasRunningBefore = false;
        ResourceAdmissionDecision admission;
        std::string error;
    };
    CameraStartOutcome startCameraFromPayload_(int cameraId, const nlohmann::json& payload);
    JobStepCameraStartResult startJobStepCameras_(
        int jobId,
        int stepId,
        const std::vector<std::pair<int, nlohmann::json>>& cameraPayloads,
        ResourceAdmissionDecision& outDecision);
    CameraStartOutcome startCameraFromPayloadLocked_(
        int cameraId,
        const nlohmann::json& payload,
        const CameraConfig& cfg,
        bool skipAdmissionCheck);
    ResourceAdmissionDecision evaluateCameraStartAdmissionLocked_(
        const std::vector<ResourceAdmissionCamera>& requests,
        const std::unordered_set<int>& replacedCameraIds) const;
    bool queryGpuMemorySnapshot_(GpuMemorySnapshot& out) const;
    std::uint64_t estimateCpuBytesForConfig_(const CameraConfig& cfg) const;
    std::uint64_t estimateGpuBytesForConfig_(const CameraConfig& cfg) const;
    nlohmann::json resourceAdmissionDecisionToJson_(
        const ResourceAdmissionDecision& decision,
        const std::string& startOrigin) const;
    void stopCamera_(int cameraId);

    std::string baseUrl_;
    std::string controlPlaneBaseUrl_;
    std::string exeToken_;
    std::string clientId_;
    std::string machineTimezoneForBackend_;

    std::atomic<bool>              running_;
    std::thread                    worker_;
    // sessions_ is accessed from multiple threads (workerLoop_, chat threads, JobRuntime threads).
    // Guard it to avoid iterator invalidation / use-after-free.
    mutable std::mutex             sessionsMu_;
    std::map<int, std::unique_ptr<CameraSession>> sessions_;
    mutable std::mutex             directServiceMu_;
    std::unordered_map<int, bool>  directServiceRequestedByCamera_;
    mutable std::mutex             resourceAdmissionMu_;

    //std::unordered_map<int, std::unordered_map<int, int>> jobsCaptureByCamera_;
    struct JobsCaptureState {
        int refCount = 0;
        bool onlyCaptureOnMotion = true;
        bool bootstrapPending = true;
        bool needsVideo = false;
        bool needsImage = false;
        int requestedTenSecondVideoFps = 0;
        int requestedSixtySecondVideoFps = 0;
    };
    std::unordered_map<int, std::unordered_map<JobStepKey, int, JobStepKeyHash>> jobSessionRefsByCamera_;
    std::unordered_map<int, std::unordered_map<JobStepKey, JobsCaptureState, JobStepKeyHash>> jobsCaptureByCamera_;

    std::unique_ptr<JobRuntime> jobRuntime_;
    std::unique_ptr<chatv2::ChatV2Orchestrator> chatV2Orchestrator_;

    mutable std::mutex jobsMu_;
    mutable std::mutex chatTasksMu_;
    std::unordered_map<int, std::shared_ptr<ChatTaskState>> chatTasksBySession_;
    mutable std::mutex coreModelArbiterMu_;
    std::condition_variable coreModelArbiterCv_;
    bool coreModelExecutionInFlight_ = false;
    int activeCoreChatPriorityReservations_ = 0;
    //std::unordered_map<int, int> jobsCaptureRefCount_; // cameraId -> count

    void setCameraServiceRunning_(
        int cameraId,
        bool running,
        const std::string& source,
        std::optional<bool> online = std::nullopt);
    void setDirectServiceRequested_(int cameraId, bool requested);
    bool isDirectServiceRequested_(int cameraId) const;
    bool isDirectServiceStart_(const CameraConfig& cfg) const;
    void jobsSessionAcquire_(int cameraId, int jobId, int stepId);
    void jobsSessionRelease_(int cameraId, int jobId, int stepId);
    bool hasActiveJobSessionConsumersLocked_(int cameraId) const;
    bool hasActiveJobSessionConsumers_(int cameraId) const;
    std::vector<int> getActiveJobIdsForCameraLocked_(int cameraId) const;
    void stopDirectCamera_(int cameraId);

    void handleOrchestratorQuery_(const nlohmann::json& payload);
    void handleChatQuery_(const nlohmann::json& payload);
    nlohmann::json fetchAgentCameras_();
    nlohmann::json fetchAgentCameraById_(int cameraId);
    nlohmann::json routeQuestionToCamerasWithLlm_(
        const std::string& userQuestion,
        const nlohmann::json& cameras,
        const std::string& routerModelTier,
        const std::string& routerApiKey,
        bool requestCoreChatPriority = false,
        const std::function<bool()>& shouldAbort = {},
        const nlohmann::json& conversationContext = nlohmann::json::object());
    std::string buildCameraRouterSystemPrompt_() const;
    CoreChatPriorityReservation reserveCoreChatPriority_(int chatSessionId);
    CoreModelExecutionLease acquireCoreModelExecutionLease_(
        const std::string& modelName,
        bool requestChatPriority,
        const std::function<bool()>& shouldAbort,
        const std::string& waitScope,
        const std::string& logId = "");
    void releaseCoreModelExecutionLease_();
    void releaseCoreChatPriorityReservation_();
    std::string postOpenAIChatCompletionsWithCoreLease_(
        const std::string& apiKey,
        const nlohmann::json& bodyJson,
        const std::function<void()>& onFirstRetry,
        bool requestChatPriority = false,
        const std::function<bool()>& shouldAbort = {},
        const std::string& waitScope = "",
        const std::string& cameraLogId = "",
        long requestTimeoutSecOverride = 0L);
    std::string postOpenAIResponsesWithCoreLease_(
        const std::string& apiKey,
        const nlohmann::json& chatCompletionsBodyJson,
        const std::function<void()>& onFirstRetry,
        bool requestChatPriority = false,
        const std::function<bool()>& shouldAbort = {},
        const std::string& waitScope = "",
        const std::string& cameraLogId = "",
        long requestTimeoutSecOverride = 0L);

    long long timeOffsetSeconds_ = 0;

    struct HitImageUpload {
        std::string key;
        std::string url;
        std::string timeInVideo;
    };

    struct HitVideoUpload {
        std::string key;
        std::string url;
        std::string timeInVideo;
    };

    bool sendHitVideosAndGetUrls_(
        int cameraId,
        int chatSessionId,
        const std::vector<std::pair<std::vector<uint8_t>, std::string>>& mp4AndTimes,
        std::vector<HitVideoUpload>& outUploaded);



    bool sendHitImagesAndGetUrls_(
        int cameraId,
        int chatSessionId,
        const std::vector<std::pair<std::vector<unsigned char>, std::string>>& jpegAndTimes,
        std::vector<HitImageUpload>& outUploaded
    );


    std::vector<FrameHit> callGeminiVisionBatch_(
        const std::vector<std::string>& batchFramePaths,
        const std::string& userQuestion,
        const std::string& uploadedImageBase64,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        std::string& outAnswer);

    std::vector<FrameHit> analyzeFramesWithGemini_(
        const std::vector<std::string>& framePaths,
        const std::string& userQuestion,
        bool stopOnFirstHit,
        const std::string& uploadedImageBase64,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        std::string& outModelAnswer);


    VideoHit callGeminiVisionVideoSegment_(
        const EncodedVideoSegment& segment,
        const std::string& userQuestion,
        const std::string& uploadedImageBase64,
        const std::string& modelTier,
        const std::string& geminiApiKey,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        int requestTimeoutSeconds = 0);

    VideoHit callOpenAIVisionVideoSegment_(
        const EncodedVideoSegment& segment,
        const std::string& userQuestion,
        const std::string& uploadedImageBase64,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        int modelInputFps,
        int expectedWindowSeconds,
        int runningResolution,
        const std::string& videoPackagingMode,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        bool requestCoreChatPriority = false,
        const std::function<bool()>& shouldAbort = {},
        int requestTimeoutSeconds = 0);




    VideoHit callGeminiVisionVideoSegmentJOB_(
        const EncodedVideoSegment& segment,
        const std::string& userQuestion,
        const std::string& uploadedImageBase64,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& modelTier,
        const std::string& geminiApiKey,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        int requestTimeoutSeconds = 0);
    
    VideoHit callGeminiVisionImageJOB_(
        int cameraId,
        const std::string& jpegBase64,
        const std::string& userQuestion,
        const std::string& uploadedImageBase64,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& modelTier,
        const std::string& geminiApiKey,
        const std::string& snapshotTsUtcIso,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        int requestTimeoutSeconds = 0
    );

    VideoHit callGeminiVisionImageGroupJOB_(
        const std::vector<GroupImageInput>& inputs,
        const std::string& groupPrompt,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& modelTier,
        const std::string& geminiApiKey,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens
    );

    VideoHit callOpenAIVisionVideoSegmentJOB_(
        const EncodedVideoSegment& segment,
        const std::string& userQuestion,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        int modelInputFps,
        int expectedWindowSeconds,
        int runningResolution,
        const std::string& videoPackagingMode,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        int requestTimeoutSeconds = 0);

    VideoHit callOpenAIVisionImageJOB_(
        int cameraId,
        const std::string& jpegBase64,
        const std::string& userQuestion,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        const std::string& snapshotTsUtcIso,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        int requestTimeoutSeconds = 0
    );

    VideoHit callOpenAIVisionImageGroupJOB_(
        const std::vector<GroupImageInput>& inputs,
        const std::string& groupPrompt,
        const std::vector<FaceReferenceImage>& faceReferences,
        const std::vector<NegativeReferenceImage>& negativeReferences,
        const std::string& alertConditionText,
        const std::string& startConditionText,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens
    );



    std::vector<VideoHit> analyzeVideosWithGemini_(
        const std::vector<EncodedVideoSegment>& videos,
        const std::string& userQuestion,
        bool stopOnFirstHit,
        const std::string& uploadedImageBase64,
        const std::string& modelTier,
        const std::string& geminiApiKey,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        std::string& outModelAnswer);

    std::vector<VideoHit> analyzeVideosWithOpenAI_(
        const std::vector<EncodedVideoSegment>& videos,
        const std::string& userQuestion,
        bool stopOnFirstHit,
        const std::string& uploadedImageBase64,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        int modelInputFps,
        int runningResolution,
        int& outPromptTokens,
        int& outOutputTokens,
        int& outTotalTokens,
        std::string& outModelAnswer,
        bool requestCoreChatPriority = false,
        const std::function<bool()>& shouldAbort = {});

    struct ChatTemporalState;

    struct ChatTemporalVideoAnalysisResult {
        std::vector<VideoHit> visibleHits;
        std::vector<VideoHit> allHits;
        int promptTokens = 0;
        int outputTokens = 0;
        int totalTokens = 0;
        std::string modelAnswer;
        bool temporalAlert = false;
        bool temporalReport = false;
        nlohmann::json temporalOperatorResults = nlohmann::json::array();
        std::string temporalSummary;
        int plannedSampleCount = 0;
        int processedSampleCount = 0;
        std::string failureReason;
        bool aborted = false;
    };

    std::vector<std::size_t> buildChatTemporalExecutionOrder_(
        const std::vector<EncodedVideoSegment>& videos,
        const nlohmann::json& routerResult) const;

    ChatTemporalVideoAnalysisResult analyzeVideosWithOpenAISequentialTemporalChat_(
        const std::vector<EncodedVideoSegment>& videos,
        const nlohmann::json& routerResult,
        const std::string& userQuestionBase,
        const std::string& uploadedImageBase64,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        int modelInputFps,
        int runningResolution,
        int chatSessionId,
        ChatTemporalState& chatTemporalState,
        bool requestCoreChatPriority = false,
        const std::function<bool()>& shouldAbort = {});

    ChatTemporalVideoAnalysisResult analyzeVideosWithOpenAISequentialIdentityChat_(
        const std::vector<EncodedVideoSegment>& videos,
        const nlohmann::json& routerResult,
        const std::string& userQuestionBase,
        const std::string& uploadedImageBase64,
        const std::string& openAiModelName,
        const std::string& openAiApiKey,
        int modelInputFps,
        int runningResolution,
        int chatSessionId,
        ChatTemporalState& chatTemporalState,
        bool requestCoreChatPriority = false,
        const std::function<bool()>& shouldAbort = {});

    void updateCameraAlgorithms_(int cameraId, const nlohmann::json& payload);
    void runConfiguredFrameRetentionSweepIfDue_(bool force = false);

    // scheduler to check jobs
    void schedulerPingLoop_();
    void triggerSchedulerTickOnce_();
    bool compileTemporalPlanWithModel_(
        const std::string& compileModelName,
        const std::string& compileApiKey,
        const nlohmann::json& compileInput,
        nlohmann::json& outEnvelope,
        const std::string& runtimeLogId = "",
        std::string* outFailureReason = nullptr);
    void postTemporalCompileResultEvent_(
        const std::string& sourceType,
        int sourceId,
        const nlohmann::json& envelope,
        const std::string& compileModel,
        bool persistPlanCache = true);
    void pruneChatTemporalSessions_();

    std::atomic<bool> schedulerPingerRunning_{ false };
    std::thread       schedulerPingerThread_;
    std::chrono::steady_clock::time_point lastConfiguredRetentionSweep_{};

    struct ChatTemporalState {
        nlohmann::json planEnvelope = nlohmann::json::object();
        nlohmann::json state = nlohmann::json::object();
        nlohmann::json visualState = nlohmann::json::object();
        std::string promptHash;
        std::chrono::steady_clock::time_point touchedAt{};
    };
    std::mutex chatTemporalMu_;
    std::unordered_map<int, ChatTemporalState> chatTemporalBySession_;

    int acquireChatVideoCapture_(int cameraId, int requestedVideoFps, int requestedClipSeconds = 10);
    void releaseChatVideoCapture_(int cameraId, int requestId);
    int acquireDrakonFindVideoCapture_(int searchId, int cameraId, int requestedVideoFps, int requestedClipSeconds = 60);
    void releaseDrakonFindVideoCapture_(int cameraId, int requestId);
    mutable std::mutex chatCaptureMu_;
    int nextChatCaptureRequestId_ = 1;
    struct ChatCaptureRequest {
        int requestedVideoFps = 1;
        int clipSeconds = 10;
    };
    std::unordered_map<int, std::unordered_map<int, ChatCaptureRequest>> chatCaptureRequestsByCamera_;
    mutable std::mutex drakonFindCaptureMu_;
    int nextDrakonFindCaptureRequestId_ = 1;
    struct DrakonFindCaptureRequest {
        int searchId = -1;
        int requestedVideoFps = 1;
        int clipSeconds = 60;
    };
    std::unordered_map<int, std::unordered_map<int, DrakonFindCaptureRequest>> drakonFindCaptureRequestsByCamera_;

    std::mutex drakonFindMu_;
    std::unordered_map<int, std::unique_ptr<DrakonFindTask>> drakonFindTasks_;

};

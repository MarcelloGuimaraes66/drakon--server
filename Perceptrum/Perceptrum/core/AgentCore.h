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

#include "../camera/CameraSession.h"
#include "TemporalEvidence.h"


// Video data we send to Gemini (MP4 in memory)
struct EncodedVideoSegment {
    std::vector<std::uint8_t> bytes;
    std::string startTs;  // "YYYYMMDD_HHMMSS"
    std::string endTs;    // "YYYYMMDD_HHMMSS"

    std::string sourceFilePath; // caminho do mp4 usado para este segmento
    bool isTempFile = false;    // true se é um segment_*.mp4 temporário; false se é um clip gravado em storage

    int cameraId = -1;           
    std::string cameraName;      

    // Job Step flags
    bool alertCondition = false;
    // -1 = not triggered; otherwise the id of the step to start
    int startConditionStepId = -1;

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

    // JobRuntime: start/stop cameras using the same logic as start_camera commands.
    // These are thin wrappers around the existing private helpers.
    void ensureCameraStartedForJob(int cameraId, const nlohmann::json& startPayload);
    void stopCameraForJob(int cameraId);

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
            // hash simples e estável
            return (std::hash<int>{}(k.jobId) * 1315423911u) ^ std::hash<int>{}(k.stepId);
        }
    };

    // liga/desliga cópia por step
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

    void workerLoop_();
    void processCommand_(const nlohmann::json& cmd);
    void handlePromptEnhanceCommand_(int commandId, const nlohmann::json& payload);
    void handleRefreshThumbnailCommand_(int commandId, const nlohmann::json& payload);
    void handleCameraImportPreviewCommand_(int commandId, const nlohmann::json& payload);
    void handleDrakonFindStartCommand_(int commandId, const nlohmann::json& payload);
    void handleDrakonFindCancelCommand_(int commandId, const nlohmann::json& payload);
    void handleChatCancelCommand_(int commandId, const nlohmann::json& payload);
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
    CameraConfig buildCameraConfigFromPayload_(int cameraId, const nlohmann::json& payload);
    void startCameraFromPayload_(int cameraId, const nlohmann::json& payload);
    void stopCamera_(int cameraId);

    std::string baseUrl_;
    std::string exeToken_;
    std::string clientId_;
    std::string machineTimezoneForBackend_;

    std::atomic<bool>              running_;
    std::thread                    worker_;
    // sessions_ is accessed from multiple threads (workerLoop_, chat threads, JobRuntime threads).
    // Guard it to avoid iterator invalidation / use-after-free.
    mutable std::mutex             sessionsMu_;
    std::map<int, std::unique_ptr<CameraSession>> sessions_;

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

    void setCameraServiceRunning_(int cameraId, bool running, const std::string& source);

    void handleOrchestratorQuery_(const nlohmann::json& payload);
    void handleChatQuery_(const nlohmann::json& payload);
    nlohmann::json fetchAgentCameras_();
    nlohmann::json routeQuestionToCamerasWithLlm_(
        const std::string& userQuestion,
        const nlohmann::json& cameras,
        const std::string& routerModelTier,
        const std::string& routerApiKey,
        bool requestCoreChatPriority = false,
        const std::function<bool()>& shouldAbort = {});
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
        const std::string& cameraLogId = "");

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
        int& outTotalTokens);

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
        const std::function<bool()>& shouldAbort = {});




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
        int& outTotalTokens);
    
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
        int& outTotalTokens
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
        int& outTotalTokens);

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
        int& outTotalTokens
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

    void updateCameraAlgorithms_(int cameraId, const nlohmann::json& payload);

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
        const std::string& compileModel);
    void pruneChatTemporalSessions_();

    std::atomic<bool> schedulerPingerRunning_{ false };
    std::thread       schedulerPingerThread_;

    struct ChatTemporalState {
        nlohmann::json planEnvelope = nlohmann::json::object();
        nlohmann::json state = nlohmann::json::object();
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

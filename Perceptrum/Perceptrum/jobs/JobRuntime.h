// JobRuntime.h
#pragma once
#include "JobTypes.h"
#include "../core/ContentCoverageTracker.h"
#include "../core/TemporalEvidence.h"
#include <deque>
#include <memory>
#include <mutex>
#include <thread>
#include <atomic>
#include <unordered_map>
#include <unordered_set>
#include <vector>
#include <chrono>

class AgentCore;
class CameraSession;

class JobRuntime {
public:
    explicit JobRuntime(AgentCore* owner);
    ~JobRuntime();

    // Called by AgentCore::processCommand_
    void onJobStartCommand(const json& cmd);
    void onJobStopCommand(const json& cmd);

private:
    struct JobInstance {
        struct InferenceMediaInfo {
            bool hadInput = false;
            bool coverageRelevant = false;
            std::string consumptionKey;
            std::string latestCapturedEndUtc;
            std::string processedSegmentStartUtc;
            std::string processedSegmentEndUtc;
        };

        JobStartPayload payload;
        std::thread worker;
        std::atomic<bool> cancel{ false };

        // Baseline for time-based start conditions
        std::chrono::steady_clock::time_point jobStartedAt;

        // outputs by step_id
        std::unordered_map<int, StepOutput> outputs;
        std::mutex outputsMu;

        // Custom start-condition triggers collected while an upstream step is running
        std::unordered_set<int> triggeredStartStepIds;
        std::mutex triggeredMu;

        struct CustomStartHook {
            int from_step_id = -1;      // step whose inference should evaluate the condition
            int downstream_step_id = -1; // step to start if condition is satisfied
            std::string pattern;        // optional camera_name to match (payload.start_condition.pattern)
            std::string extract;        // payload.start_condition.extract
        };

        // Pre-scanned custom start-condition hooks (built once from payload)
        std::vector<CustomStartHook> customStartHooks;

        struct PipelineHook {
            int to_step_id = -1;
            int target_camera_id = -1;
            int from_step_id = -1;
            // If >=0, use directly; otherwise resolve using from_camera_key at runtime
            int from_camera_id = -1;
            std::string from_camera_key;
        };

        // Pre-scanned pipelines (built once from payload)
        std::vector<PipelineHook> pipelineHooks;

        // step state
        enum class StepState { Pending, Running, Completed, Skipped, Failed };
        struct StepRun {
            enum class CompletionPhase { Idle, Capturing, DrainingToTarget, Finalizing, Completed };
            struct CameraCoverageRun {
                bool enabled = false;
                std::chrono::system_clock::time_point anchorUtc{};
                std::chrono::system_clock::time_point targetEndUtc{};
                std::string anchorUtcIso;
                std::string targetEndUtcIso;
                std::string capturedFrontierUtcIso;
                std::string materializedFrontierUtcIso;
                std::string coveredUntilUtcIso;
                std::string latestCapturedUtcIso;
                std::string firstGapStartUtcIso;
                long long coverageGapSeconds = 0;
                bool complete = false;
                bool hasAnalysisAnchor = false;
                std::chrono::system_clock::time_point analysisAnchorUtc{};
                bool hasAnalysisFrontier = false;
                std::chrono::system_clock::time_point analysisFrontierUtc{};
                std::string analysisAnchorUtcIso;
                std::string analysisFrontierUtcIso;
                long long analysisLagSeconds = 0;
                bool analysisComplete = false;
                std::string analysisStatus = "not_applicable";
                std::string materializationStatus = "not_applicable";
                contentcoverage::Tracker tracker;
            };

            JobStepDef def;
            StepState state = StepState::Pending;
            std::chrono::steady_clock::time_point startedAt;
            std::chrono::steady_clock::time_point captureDeadline;
            std::chrono::steady_clock::time_point deadline;
            std::chrono::steady_clock::time_point hardStopDeadline;
            std::chrono::system_clock::time_point startedAtSystemUtc;
            std::chrono::system_clock::time_point captureDeadlineUtc;
            std::chrono::system_clock::time_point hardStopDeadlineUtc;
            std::chrono::system_clock::time_point requiredCompletionEndUtc;
            std::chrono::system_clock::time_point analysisTargetEndUtc;
            int configuredAnalysisDurationSeconds = 0;
            int configuredAnalysisHardStopSeconds = 0;
            std::atomic<bool> cancel{ false };
            std::atomic<bool> timeoutRequested{ false };
            std::vector<std::thread> workers; // one per target camera
            std::string injectedInput;
            bool coverageDriven = false;
            bool coverageIncomplete = false;
            bool analysisDriven = false;
            bool analysisTargetPendingAnchor = false;
            bool analysisTargetResolvedFromAnchor = false;
            bool analysisTargetClampedToFirstDue = false;
            std::atomic<CompletionPhase> completionPhase{ CompletionPhase::Idle };
            std::string startedAtSystemUtcIso;
            std::string captureDeadlineUtcIso;
            std::string hardStopDeadlineUtcIso;
            std::string requiredCompletionEndUtcIso;
            std::string analysisTargetEndUtcIso;
            std::string earliestFirstDueUtcIso;
            std::string analysisTargetSource = "step_timeout";
            std::string analysisCompletionMode = "legacy_deadline";
            std::mutex coverageMu;
            std::unordered_map<int, CameraCoverageRun> coverageByCamera;
        };
        std::unordered_map<int, StepRun> stepRuns; // step_id -> runtime
    };

    AgentCore* owner_ = nullptr;

    std::mutex mu_;
    std::unordered_map<int, std::shared_ptr<JobInstance>> running_; // job_id -> instance
    struct TemporalRuntimeSlot {
        json planEnvelope = json::object();
        json state = json::object();
        json visualState = json::object();
        std::string promptHash;
        std::chrono::steady_clock::time_point touchedAt{};
    };
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
    using TemporalEvidenceTrail = std::deque<TemporalEvidenceItem>;
    std::mutex temporalMu_;
    std::unordered_map<std::string, TemporalRuntimeSlot> temporalBySlot_;
    std::unordered_map<std::string, TemporalEvidenceTrail> temporalEvidenceBySlot_;
    std::mutex crossCameraHuntsMu_;
    std::unordered_map<std::string, json> crossCameraHuntsByStep_;

    void clearJobEphemeralState_(int jobId);

private:
    void runJob_(std::shared_ptr<JobInstance> job);

    // execution helpers
    static const JobAgentDef* selectAgentForCamera_(const JobStepDef& step, int cameraId);
    std::string resolvePipelineInput_(std::shared_ptr<JobInstance> job,
                                     const JobStepDef& step,
                                     const std::unordered_map<int, JobStepDef>& stepsById);
    std::string resolvePipelineInputsForCamera_(std::shared_ptr<JobInstance> job,
                                              const JobStepDef& step,
                                              int targetCameraId,
                                              const std::unordered_map<int, JobStepDef>& stepsById);

    // Start condition
    bool conditionSatisfied_(std::shared_ptr<JobInstance> job, const JobStepDef& step,
                             const std::unordered_map<int, JobStepDef>& stepsById,
                             const std::unordered_map<int, JobInstance::StepRun>& runsById);
    static std::optional<bool> extractSentimentPositive_(const std::string& out, const std::string& answerKey);
    static JobStepDef::StartCondition deriveLegacyStartCondition_(const JobStepDef& step);

    // reporting helpers
    void postJobEvent_(const std::string& eventType, const JobDefSnapshot& job, const json& details);
    void postStepEvent_(const std::string& eventType, const JobDefSnapshot& job, const JobStepDef& step, const json& extra);

    // inference + alert
    std::string runAgentInferenceOnCamera_(int jobId, int stepId, int cameraId, const JobAgentDef& agent, const std::string& injectedInput,
        const std::string& alertConditionText, const std::string& startConditionText,
        const std::string& modelTier, const std::string& jobRunId,
        const std::string& stepRunId, const std::string& agentRunId,
        int timeoutSeconds, std::atomic<bool>& cancel,
        const std::string& coverageCutoffUtcIso = std::string(),
        JobInstance::InferenceMediaInfo* outMediaInfo = nullptr);
    std::string maybeEmitFinalTemporalReportOnTimeout_(
        int jobId,
        int stepId,
        int cameraId,
        const JobAgentDef& agent,
        const std::string& alertConditionText,
        const std::string& jobRunId,
        const std::string& stepRunId,
        const std::string& agentRunId,
        const std::string& evaluationNowIsoUtc,
        const json* coverageDetails = nullptr);
    //void maybeFireAlerts_(const JobStartPayload& payload, const JobStepDef& step, int cameraId, const std::string& inferenceOutput);

    void maybeFireAlerts_(
        const JobStartPayload& payload,
        const JobStepDef& step,
        int cameraId,
        const JobAgentDef& agent,
        const std::string& inferenceOutput,
        bool suppressDelivery = false
    );

    // utils
    static bool isLikelyJson_(const std::string& s);

    bool stepNeedsVideoCaptureForCamera_(const JobStepDef& step, int cameraId) const;

    TemporalEvidenceTrail loadTemporalEvidenceTrail_(const std::string& temporalSlotKey);
    void saveTemporalEvidenceTrail_(
        const std::string& temporalSlotKey,
        const TemporalEvidenceTrail& trail);
    static std::string trimTemporalEvidenceValue_(const std::string& value);
    static void mergeTemporalEvidenceTrail_(
        TemporalEvidenceTrail& trail,
        const std::vector<TemporalEvidenceCandidate>& candidates,
        const std::vector<std::string>& acceptedEvidenceKeys);
    static json buildTemporalAlertGroupImages_(
        const TemporalEvidenceTrail& trail,
        const json& operatorResults,
        const std::vector<std::string>& fallbackEvidenceKeys,
        int cameraId,
        const std::string& cameraName);
    static std::string extractFirstTemporalGroupImageB64_(const json& groupImages);
};

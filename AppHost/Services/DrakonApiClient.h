#pragma once

#include "../Pages/CameraRecord.h"

#include <filesystem>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace winrt::DrakonDesktop::services
{
    struct ServiceResponse
    {
        bool success{ false };
        long statusCode{ 0 };
        std::string error;
    };

    template <typename T>
    struct ServiceValueResponse : ServiceResponse
    {
        T value{};
    };

    struct AuthState
    {
        bool isAuthenticated{ false };
        std::string userId;
        std::string email;
        std::string authProvider;
        std::string countryCode;
        std::string createdAt;
        std::string displayName;
    };

    struct BillingStatus
    {
        bool hasActiveSubscription{ false };
        bool hasActiveCard{ false };
        bool canAddCameras{ false };
        int32_t activeCameras{ 0 };
    };

    struct DashboardAlertItem
    {
        std::string title;
        std::string subtitle;
    };

    struct DashboardRuntimeItem
    {
        std::string title;
        std::string subtitle;
    };

    struct DashboardSnapshot
    {
        int32_t camerasTotal{ 0 };
        int32_t camerasRunning{ 0 };
        int32_t jobsTotal{ 0 };
        int32_t jobsRunning{ 0 };
        int32_t agentsEnabledTotal{ 0 };
        int32_t unreadAlerts{ 0 };
        int32_t detections24hTotal{ 0 };
        int32_t pendingCommands{ 0 };
        int32_t stepsRunning{ 0 };
        std::string lastUpdatedAt;
        std::vector<DashboardAlertItem> recentAlerts;
        std::vector<DashboardRuntimeItem> captureThreads;
    };

    struct ApiKeySettings
    {
        bool hasKey{ false };
        std::string apiKeyPreview;
    };

    struct TelegramSettings
    {
        bool enabled{ false };
        std::string chatId;
        std::string botToken;
    };

    struct PairingConnection
    {
        std::string clientId;
        std::string exeId;
        std::string pairedAt;
        std::string lastSeenAt;
        int32_t lastSeenAgeSeconds{ 0 };
        bool isHeartbeatFresh{ false };
        bool isAvailableForChat{ false };
        std::string status;
        std::string effectiveStatus;
        std::string chatEffectiveStatus;
    };

    struct PairCodeSnapshot
    {
        std::string pairCode;
        std::string expiresAt;
    };

    struct PairingStatusSnapshot
    {
        std::string status;
        std::string effectiveStatus;
        std::string chatEffectiveStatus;
        bool isAvailableForChat{ false };
        bool isHeartbeatFresh{ false };
        std::string clientId;
        std::string exeId;
        std::string pairedAt;
        std::string lastSeenAt;
        int32_t lastSeenAgeSeconds{ 0 };
        std::string timezoneIana;
        std::string timezoneSource;
        std::string timezoneUpdatedAt;
        std::vector<PairingConnection> connections;
    };

    struct TokenBalanceSnapshot
    {
        int64_t balance{ 0 };
        int64_t inputBalance{ 0 };
        int64_t outputBalance{ 0 };
        int64_t totalSpent{ 0 };
    };

    struct PaymentRecord
    {
        int32_t id{ 0 };
        int64_t amount{ 0 };
        std::string currency;
        std::string paymentType;
        std::string status;
        std::string description;
        std::string createdAt;
    };

    struct SubscriptionSnapshot
    {
        bool exists{ false };
        int32_t id{ 0 };
        bool isActive{ false };
        int32_t cameraCount{ 0 };
        int32_t secondsPerFrame{ 0 };
        std::string modelTier;
        std::string status;
        std::string subscriptionType;
        std::string startedAt;
        std::string accessUntil;
    };

    struct BillingCard
    {
        int32_t id{ 0 };
        std::string brand;
        std::string last4;
        int32_t expMonth{ 0 };
        int32_t expYear{ 0 };
        bool isDefault{ false };
    };

    struct StartCameraResult
    {
        bool agentsDisabledNoSubscription{ false };
    };

    struct JobScheduleWindow
    {
        std::string startTime;
        std::string endTime;
    };

    struct JobScheduleDay
    {
        std::string dayName;
        int32_t dayOfWeek{ -1 };
        int32_t dayOfMonth{ -1 };
        int32_t monthOfYear{ -1 };
        std::vector<JobScheduleWindow> windows;
    };

    struct JobRecord
    {
        int32_t id{ 0 };
        std::string name;
        std::string description;
        std::string startAt;
        std::string endAt;
        std::string status;
        std::string createdAt;
        std::string scheduleMode;
        std::string timezone;
        std::string activeFrom;
        std::string activeUntil;
        std::vector<JobScheduleDay> scheduleDays;
        std::string scheduleSummary;
        std::string runtimeStatus;
        std::string runtimeStartedAtUtc;
        std::string runtimeUpdatedAt;
    };

    struct JobStepRecord
    {
        int32_t id{ 0 };
        int32_t jobId{ 0 };
        int32_t stepOrder{ 0 };
        std::string name;
        int32_t timeoutSeconds{ 0 };
        std::string status;
        bool hasInputFromStepId{ false };
        int32_t inputFromStepId{ 0 };
        std::string inputInjectKey;
        std::string onMissingInput;
        std::string startCondition;
        bool hasStartConditionFromStepId{ false };
        int32_t startConditionFromStepId{ 0 };
        std::string inferenceGroupsJson;
    };

    struct JobMutationRequest
    {
        std::string name;
        std::string description;
        std::string scheduleMode;
        std::string status;
        std::optional<std::string> activeFrom;
        std::optional<std::string> activeUntil;
        std::optional<std::string> startAt;
        std::optional<std::string> endAt;
        std::vector<JobScheduleDay> scheduleDays;
    };

    struct JobStepMutationRequest
    {
        int32_t stepOrder{ 0 };
        std::string name;
        int32_t timeoutSeconds{ 300 };
    };

    struct ChatSessionRecord
    {
        int32_t id{ 0 };
        std::string title;
        std::string createdAt;
        std::string updatedAt;
    };

    struct ChatMessageRecord
    {
        int32_t id{ 0 };
        std::string role;
        std::string content;
        std::string createdAt;
        std::string updatedAt;
        std::string messageType;
        std::string warning;
        std::string warningCode;
        std::string uploadedImageBase64;
        std::string cameraSelectionJson;
        std::string progressJson;
        bool isPending{ false };
        int64_t tokensUsed{ 0 };
    };

    struct ChatSendRequest
    {
        std::string content;
        std::optional<int32_t> cameraId;
        std::optional<std::string> uploadedImageBase64;
        std::optional<int32_t> uploadedVideoId;
        std::string modelTier{ "ultra" };
        int32_t modelFps{ 1 };
        std::optional<int32_t> runningResolution;
    };

    struct ChatSendResult
    {
        std::vector<ChatMessageRecord> messages;
        std::string warning;
        std::string warningCode;
    };

    struct DrakonFindTargetImage
    {
        int32_t id{ 0 };
        int32_t targetId{ 0 };
        std::string imageUrl;
        std::string contentType;
        std::string createdAt;
        std::string updatedAt;
    };

    struct DrakonFindTarget
    {
        int32_t id{ 0 };
        std::string userId;
        std::string entityType;
        std::string name;
        std::string description;
        std::vector<std::string> traits;
        std::vector<DrakonFindTargetImage> images;
        int32_t imageCount{ 0 };
        std::string createdAt;
        std::string updatedAt;
        int32_t searchCount{ 0 };
        int32_t queuedSearchCount{ 0 };
        int32_t runningSearchCount{ 0 };
        std::string lastSearchAt;
    };

    struct DrakonFindScopeStateSummary
    {
        std::string stateCode;
        std::string stateName;
        int32_t cameraCount{ 0 };
    };

    struct DrakonFindScopeCameraPreview
    {
        int32_t id{ 0 };
        std::string userId;
        std::string name;
        std::string city;
        std::string state;
        std::string stateCode;
        std::string country;
        std::string countryCode;
        int32_t allowPublicAccess{ 0 };
    };

    struct DrakonFindScopeResolution
    {
        std::string countryCode;
        std::vector<std::string> selectedStates;
        int32_t eligibleCameraCount{ 0 };
        int32_t eligibleOwnerCount{ 0 };
        std::vector<int32_t> excludedCameraIds;
        std::vector<DrakonFindScopeStateSummary> states;
        std::vector<DrakonFindScopeCameraPreview> cameras;
        std::string previewUpdatedAt;
    };

    struct DrakonFindSearchClientSummary
    {
        std::string clientId;
        std::string exeId;
        int32_t cameraCount{ 0 };
        int32_t completedCameraCount{ 0 };
        int32_t matchedCameraCount{ 0 };
    };

    struct DrakonFindSearch
    {
        int32_t id{ 0 };
        std::string userId;
        int32_t targetId{ 0 };
        std::string targetName;
        std::string targetEntityType;
        std::string targetDescription;
        std::string status;
        std::string runtimeMode;
        std::string inputType;
        int32_t windowSeconds{ 0 };
        int32_t durationSeconds{ 0 };
        std::string runUntil;
        std::string countryCode;
        std::vector<std::string> selectedStates;
        int32_t selectedStateCount{ 0 };
        int32_t eligibleCameraCount{ 0 };
        int32_t eligibleOwnerCount{ 0 };
        int32_t attemptCount{ 0 };
        int32_t dispatchedCommandCount{ 0 };
        int32_t completedCameraCount{ 0 };
        int32_t matchedCameraCount{ 0 };
        int32_t pendingCameraCount{ 0 };
        int32_t hitCount{ 0 };
        int32_t activeClientCount{ 0 };
        std::string lastEventAt;
        std::string lastError;
        std::vector<DrakonFindSearchClientSummary> clients;
        bool hasScopeSnapshot{ false };
        DrakonFindScopeResolution scopeSnapshot;
        std::string startedAt;
        std::string completedAt;
        std::string createdAt;
        std::string updatedAt;
    };

    struct DrakonFindHit
    {
        int32_t id{ 0 };
        int32_t searchId{ 0 };
        int32_t targetId{ 0 };
        int32_t cameraId{ 0 };
        std::string cameraName;
        std::string cameraOwnerUserId;
        std::string clientId;
        std::string exeId;
        std::string cameraCity;
        std::string cameraStateCode;
        std::string summary;
        double confidence{ 0.0 };
        std::string imageUrl;
        std::string videoUrl;
        std::string detailsJson;
        std::string matchedAt;
        std::string createdAt;
    };

    struct DrakonFindAuditLog
    {
        int32_t id{ 0 };
        std::string actorUserId;
        std::string actorEmail;
        std::string actionType;
        bool hasTargetId{ false };
        int32_t targetId{ 0 };
        bool hasSearchId{ false };
        int32_t searchId{ 0 };
        std::string message;
        std::string metadataJson;
        std::string createdAt;
    };

    struct DrakonFindCreateTargetRequest
    {
        std::string entityType;
        std::string name;
        std::string description;
        std::vector<std::string> traits;
    };

    struct DrakonFindCreateSearchRequest
    {
        int32_t targetId{ 0 };
        std::string countryCode{ "BR" };
        std::vector<std::string> selectedStates;
        int32_t durationSeconds{ 1800 };
        std::vector<int32_t> excludedCameraIds;
    };

    class DrakonApiClient
    {
    public:
        static DrakonApiClient& Instance();

        std::string BaseUrl() const;

        ServiceValueResponse<std::string> DetectCountry();
        ServiceResponse LocalLogin(std::string const& email, std::string const& password);
        ServiceResponse LocalSignup(
            std::string const& email,
            std::string const& password,
            std::string const& countryCode);
        ServiceResponse LocalLogout();
        ServiceValueResponse<AuthState> GetAuthState();
        ServiceValueResponse<BillingStatus> GetBillingStatus();
        ServiceValueResponse<DashboardSnapshot> GetDashboard();
        ServiceValueResponse<ApiKeySettings> GetOpenAiSettings();
        ServiceValueResponse<ApiKeySettings> SaveOpenAiSettings(std::optional<std::string> const& apiKey, bool clear);
        ServiceValueResponse<ApiKeySettings> GetZAiSettings();
        ServiceValueResponse<ApiKeySettings> SaveZAiSettings(std::optional<std::string> const& apiKey, bool clear);
        ServiceValueResponse<TelegramSettings> GetTelegramSettings();
        ServiceValueResponse<TelegramSettings> SaveTelegramSettings(TelegramSettings const& settings);
        ServiceValueResponse<PairCodeSnapshot> GeneratePairCode();
        ServiceValueResponse<PairingStatusSnapshot> GetPairingStatus();
        ServiceResponse DisconnectPairing();
        ServiceValueResponse<TokenBalanceSnapshot> GetTokenBalance();
        ServiceValueResponse<std::vector<PaymentRecord>> GetPayments();
        ServiceValueResponse<SubscriptionSnapshot> GetActiveSubscription();
        ServiceValueResponse<std::vector<BillingCard>> GetBillingCards();
        ServiceResponse CancelSubscription();
        ServiceResponse RemoveBillingCard(int32_t cardId);
        ServiceValueResponse<std::string> CreateCreditsCheckoutSession(int32_t creditsAmount, std::string const& tokenType);
        ServiceValueResponse<std::string> CreateSubscriptionCheckoutSession(
            std::string const& planTier,
            int32_t secondsPerFrame,
            int32_t cameraCount);
        ServiceValueResponse<std::vector<JobRecord>> GetJobs();
        ServiceValueResponse<JobRecord> CreateJob(JobMutationRequest const& request);
        ServiceValueResponse<JobRecord> UpdateJob(int32_t jobId, JobMutationRequest const& request);
        ServiceResponse DeleteJob(int32_t jobId);
        ServiceResponse StartJob(int32_t jobId);
        ServiceResponse StopJob(int32_t jobId);
        ServiceValueResponse<std::vector<JobStepRecord>> GetJobSteps(int32_t jobId);
        ServiceValueResponse<JobStepRecord> CreateJobStep(int32_t jobId, JobStepMutationRequest const& request);
        ServiceResponse DeleteJobStep(int32_t stepId);
        ServiceValueResponse<std::vector<winrt::DrakonDesktop::CameraRecord>> GetCameras();
        ServiceValueResponse<StartCameraResult> StartCamera(int32_t cameraId);
        ServiceResponse EnqueueCommand(
            std::string const& commandType,
            std::optional<int32_t> cameraId,
            std::string const& payloadJson);
        ServiceValueResponse<winrt::DrakonDesktop::CameraRecord> CreateCamera(winrt::DrakonDesktop::CameraRecord const& record);
        ServiceValueResponse<winrt::DrakonDesktop::CameraRecord> UpdateCamera(winrt::DrakonDesktop::CameraRecord const& record);
        ServiceResponse DeleteCamera(int32_t cameraId);
        ServiceValueResponse<std::vector<ChatSessionRecord>> GetChatSessions();
        ServiceValueResponse<ChatSessionRecord> CreateChatSession(std::optional<std::string> const& title);
        ServiceValueResponse<ChatSessionRecord> RenameChatSession(int32_t sessionId, std::string const& title);
        ServiceResponse DeleteChatSession(int32_t sessionId);
        ServiceValueResponse<std::vector<ChatMessageRecord>> GetChatMessages(int32_t sessionId);
        ServiceValueResponse<ChatSendResult> SendChatMessage(int32_t sessionId, ChatSendRequest const& request);
        ServiceResponse CancelChatSession(int32_t sessionId, std::string const& reason);
        ServiceValueResponse<std::vector<DrakonFindTarget>> GetDrakonFindTargets();
        ServiceValueResponse<std::vector<DrakonFindSearch>> GetDrakonFindSearches();
        ServiceValueResponse<std::vector<DrakonFindAuditLog>> GetDrakonFindAuditLog(int32_t limit);
        ServiceValueResponse<std::vector<DrakonFindHit>> GetDrakonFindHits(int32_t limit);
        ServiceValueResponse<DrakonFindScopeResolution> ResolveDrakonFindScope(
            std::string const& countryCode,
            std::vector<std::string> const& selectedStates,
            std::vector<int32_t> const& excludedCameraIds);
        ServiceValueResponse<DrakonFindTarget> CreateDrakonFindTarget(DrakonFindCreateTargetRequest const& request);
        ServiceResponse DeleteDrakonFindTarget(int32_t targetId);
        ServiceResponse DeleteDrakonFindTargetImage(int32_t targetId, int32_t imageId);
        ServiceResponse CreateDrakonFindSearch(DrakonFindCreateSearchRequest const& request);
        ServiceResponse CancelDrakonFindSearch(int32_t searchId);
        ServiceResponse RetryDrakonFindSearch(int32_t searchId);
        ServiceResponse DeleteDrakonFindSearch(int32_t searchId);
        ServiceResponse DeleteDrakonFindHit(int32_t hitId);

    private:
        struct HttpResponse
        {
            bool transportOk{ false };
            long statusCode{ 0 };
            std::string body;
            std::vector<std::string> setCookies;
            std::string error;
        };

        DrakonApiClient();

        HttpResponse SendRequest(
            std::string const& method,
            std::string const& path,
            std::optional<std::string> const& jsonBody,
            bool includeSessionCookie);
        static std::string NormalizeBaseUrl(std::string value);

        mutable std::mutex m_mutex;
        std::string m_baseUrl;
        std::string m_sessionCookie;
        std::filesystem::path m_sessionCookiePath;
    };
}

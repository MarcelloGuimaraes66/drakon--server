#pragma once

#include "LinuxCameraSessionManager.h"
#include "RuntimePaths.h"

#include "../Perceptrum/runtime/interfaces/IAgentRuntime.h"
#include "../Perceptrum/runtime/interfaces/IRuntimeLogger.h"
#include "../Perceptrum/runtime/interfaces/ITokenStore.h"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace perceptrum::linux_runtime {

class LinuxJobRuntime final {
public:
    LinuxJobRuntime(
        RuntimePaths paths,
        perceptrum::runtime::IRuntimeLogger* logger,
        perceptrum::runtime::ITokenStore* tokenStore);
    ~LinuxJobRuntime();

    bool start();
    void stop() noexcept;
    void applyStatus(perceptrum::runtime::AgentRuntimeStatus& status) const;

private:
    void workerLoop();
    void pollOnce();
    void executeCommand(const nlohmann::json& command);
    nlohmann::json executeStartCamera(const nlohmann::json& command);
    nlohmann::json executeStopCamera(const nlohmann::json& command);
    nlohmann::json executeProbeWebcams(const nlohmann::json& command);
    nlohmann::json executeOrchestratorQuery(const nlohmann::json& command);
    nlohmann::json executeOperationalQuery(const nlohmann::json& command);
    nlohmann::json executeTemporalRecompile(const nlohmann::json& command);
    nlohmann::json executeJobStart(const nlohmann::json& command);
    nlohmann::json executeJobStop(const nlohmann::json& command);
    void maybePostOpenMonitorSnapshot();
    bool postCommandResult(int commandId, const std::string& status, const nlohmann::json& result, const std::string& error);
    bool postChatResponse(const nlohmann::json& body);
    bool postAgentEvent(const std::string& eventType, int cameraId, const std::string& message, const nlohmann::json& details);
    bool postOpenMonitorSnapshot(const nlohmann::json& body);
    bool postThumbnail(int cameraId, const std::filesystem::path& thumbnailPath, std::string& error);
    void recordCompleted(std::string commandType);
    void recordFailed(std::string commandType, std::string error);

    RuntimePaths paths_;
    perceptrum::runtime::IRuntimeLogger* logger_ = nullptr;
    perceptrum::runtime::ITokenStore* tokenStore_ = nullptr;
    std::thread worker_;
    std::atomic<bool> running_{ false };

    mutable std::mutex mutex_;
    std::string baseUrl_;
    std::string clientId_;
    std::string token_;
    std::string lastCommandType_;
    std::string lastError_;
    std::string llmProvider_ = "fake";
    std::chrono::steady_clock::time_point startedAt_{};
    std::chrono::steady_clock::time_point lastOpenMonitorAt_{};
    std::chrono::steady_clock::time_point lastMetricsSampleAt_{};
    long long lastHostCpuTotal_ = 0;
    long long lastHostCpuIdle_ = 0;
    long long lastProcessCpuTicks_ = 0;
    long long lastDiskReadBytes_ = 0;
    long long lastDiskWriteBytes_ = 0;
    long long lastNetRxBytes_ = 0;
    long long lastNetTxBytes_ = 0;
    long long lastProcessReadBytes_ = 0;
    long long lastProcessWriteBytes_ = 0;
    int commandsPolled_ = 0;
    int commandsCompleted_ = 0;
    int commandsFailed_ = 0;
    std::unordered_set<int> activeJobs_;
    LinuxCameraSessionManager cameraSessions_;
};

} // namespace perceptrum::linux_runtime

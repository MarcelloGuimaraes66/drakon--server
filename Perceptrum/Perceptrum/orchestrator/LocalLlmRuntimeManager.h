#pragma once

#include "../platform/platform_process.h"

#include <mutex>
#include <string>

namespace chatv2 {

class LocalLlmRuntimeManager {
public:
    struct Config {
        std::string baseUrl;
        std::string host = "127.0.0.1";
        int port = 11435;
        int contextSize = 4096;
        int threads = 0;
        int startupTimeoutMs = 30000;
        bool autostart = true;
        bool requireLlm = false;
        std::string serverPath;
        std::string modelPath;
    };

    LocalLlmRuntimeManager();
    ~LocalLlmRuntimeManager();

    void start();
    void stop();
    bool ensureReady();

    bool requiresLlm() const;
    bool hasConfiguredEndpoint() const;
    std::string baseUrl() const;
    std::string lastError() const;
    const Config& config() const { return config_; }

private:
    void loadConfig_();
    std::string defaultBaseUrl_() const;
    bool isHealthy_(const std::string& baseUrl) const;
    bool isManagedProcessRunning_();
    bool launchManagedProcess_();
    bool waitForHealthy_(int timeoutMs);
    void terminateManagedProcess_();
    void closeProcessHandles_();

    mutable std::mutex mutex_;
    Config config_;
    perceptrum::platform::ProcessHandle processHandle_{};
    bool processActive_ = false;
    bool usingManagedProcess_ = false;
    std::string resolvedBaseUrl_;
    std::string lastError_;
};

} // namespace chatv2

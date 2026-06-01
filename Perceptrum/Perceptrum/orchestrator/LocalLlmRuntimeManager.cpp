#include "LocalLlmRuntimeManager.h"

#include <algorithm>
#include <chrono>
#include <sstream>
#include <thread>
#include <vector>

#include "ConfigUtils.h"
#include "HttpUtils.h"
#include "../platform/platform_process.h"

namespace chatv2 {

namespace {

std::vector<std::filesystem::path> buildServerCandidates_()
{
    std::vector<std::filesystem::path> candidates;
    for (const auto& root : buildLocalLlmRootCandidates()) {
#ifdef _WIN32
        candidates.push_back(root / "bin" / "llama-server.exe");
        candidates.push_back(root / "llama-server.exe");
#else
        candidates.push_back(root / "bin" / "llama-server");
        candidates.push_back(root / "llama-server");
#endif
    }
    return candidates;
}

std::vector<std::filesystem::path> buildModelDirectoryCandidates_()
{
    std::vector<std::filesystem::path> directories;
    for (const auto& root : buildLocalLlmRootCandidates()) {
        directories.push_back(root / "models" / "chatv2");
        directories.push_back(root / "models");
        directories.push_back(root);
    }
    return directories;
}

std::string normalizeBaseUrl_(std::string value)
{
    value = trimCopy(std::move(value));
    while (!value.empty() && value.back() == '/') {
        value.pop_back();
    }
    return value;
}

} // namespace

LocalLlmRuntimeManager::LocalLlmRuntimeManager()
{
    loadConfig_();
}

LocalLlmRuntimeManager::~LocalLlmRuntimeManager()
{
    stop();
}

void LocalLlmRuntimeManager::loadConfig_()
{
    config_.baseUrl = loadConfigValue(
        "CHATV2_LLM_BASE_URL",
        { "chatv2_llm_base_url.txt" });
    config_.host = loadConfigValue(
        "CHATV2_LLM_HOST",
        { "chatv2_llm_host.txt" });
    if (config_.host.empty()) {
        config_.host = "127.0.0.1";
    }

    config_.port = parseIntValue(
        loadConfigValue("CHATV2_LLM_PORT", { "chatv2_llm_port.txt" }),
        11435,
        1,
        65535);
    config_.contextSize = parseIntValue(
        loadConfigValue("CHATV2_LLM_CTX_SIZE", { "chatv2_llm_ctx_size.txt" }),
        4096,
        512,
        131072);

    const unsigned int hardwareThreads = (std::max)(1u, std::thread::hardware_concurrency());
    const unsigned int suggestedThreads = hardwareThreads > 2 ? hardwareThreads - 2 : hardwareThreads;
    const int defaultThreads = static_cast<int>((std::max)(1u, suggestedThreads));
    config_.threads = parseIntValue(
        loadConfigValue("CHATV2_LLM_THREADS", { "chatv2_llm_threads.txt" }),
        defaultThreads,
        1,
        256);
    config_.startupTimeoutMs = parseIntValue(
        loadConfigValue(
            "CHATV2_LLM_STARTUP_TIMEOUT_MS",
            { "chatv2_llm_startup_timeout_ms.txt" }),
        30000,
        1000,
        300000);
    config_.autostart = parseBoolValue(
        loadConfigValue("CHATV2_LLM_AUTOSTART", { "chatv2_llm_autostart.txt" }),
        true);
    config_.requireLlm = parseBoolValue(
        loadConfigValue("CHATV2_LLM_REQUIRE", { "chatv2_llm_require.txt" }),
        false);

    config_.serverPath = loadConfigValue(
        "CHATV2_LLM_SERVER_PATH",
        { "chatv2_llm_server_path.txt" });
    if (config_.serverPath.empty()) {
        const auto serverPath = findExistingFile(buildServerCandidates_());
        if (!serverPath.empty()) {
            config_.serverPath = serverPath.string();
        }
    }

    config_.modelPath = loadConfigValue(
        "CHATV2_LLM_MODEL_PATH",
        { "chatv2_llm_model_path.txt" });
    if (config_.modelPath.empty()) {
        const auto modelPath = findFirstGgufFile(buildModelDirectoryCandidates_());
        if (!modelPath.empty()) {
            config_.modelPath = modelPath.string();
        }
    }

    resolvedBaseUrl_ = config_.baseUrl.empty() ? defaultBaseUrl_() : normalizeBaseUrl_(config_.baseUrl);
    lastError_.clear();
}

std::string LocalLlmRuntimeManager::defaultBaseUrl_() const
{
    std::ostringstream out;
    out << "http://" << config_.host << ":" << config_.port;
    return out.str();
}

bool LocalLlmRuntimeManager::isHealthy_(const std::string& baseUrl) const
{
    if (baseUrl.empty()) return false;

    HttpResponse healthResponse = getUrl(baseUrl + "/health");
    if (healthResponse.ok()) {
        return true;
    }

    HttpResponse modelsResponse = getUrl(baseUrl + "/v1/models");
    return modelsResponse.ok();
}

bool LocalLlmRuntimeManager::isManagedProcessRunning_()
{
    if (!processActive_) return false;
    return perceptrum::platform::IsProcessRunning(processHandle_);
}

bool LocalLlmRuntimeManager::launchManagedProcess_()
{
    if (config_.serverPath.empty()) {
        lastError_ =
            "chatv2 local LLM server binary was not found. Configure chatv2_llm_server_path.txt.";
        return false;
    }
    if (config_.modelPath.empty()) {
        lastError_ =
            "chatv2 local model file was not found. Configure chatv2_llm_model_path.txt.";
        return false;
    }

    closeProcessHandles_();

    perceptrum::platform::ProcessLaunchOptions options;
    options.executablePath = config_.serverPath;
    options.workingDirectory = std::filesystem::path(config_.serverPath).parent_path();
    options.hideWindow = true;
    options.arguments = {
        "-m",
        config_.modelPath,
        "--host",
        config_.host,
        "--port",
        std::to_string(config_.port),
        "-t",
        std::to_string(config_.threads),
        "-c",
        std::to_string(config_.contextSize),
        "-ngl",
        "0",
        "-np",
        "1",
    };

    std::string launchError;
    if (!perceptrum::platform::LaunchProcess(options, processHandle_, launchError)) {
        lastError_ = launchError.empty()
            ? "Failed to launch local LLM process."
            : launchError;
        return false;
    }

    processActive_ = true;
    usingManagedProcess_ = true;
    lastError_.clear();
    return true;
}

bool LocalLlmRuntimeManager::waitForHealthy_(int timeoutMs)
{
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeoutMs);

    while (std::chrono::steady_clock::now() < deadline) {
        if (isHealthy_(resolvedBaseUrl_)) {
            lastError_.clear();
            return true;
        }

        if (usingManagedProcess_ && !isManagedProcessRunning_()) {
            int exitCode = 0;
            (void)perceptrum::platform::TryGetProcessExitCode(processHandle_, exitCode);
            lastError_ =
                "llama-server exited before becoming healthy. exit_code=" + std::to_string(exitCode);
            terminateManagedProcess_();
            return false;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(250));
    }

    lastError_ =
        "chatv2 local LLM did not become healthy before timeout (" +
        std::to_string(timeoutMs) + " ms).";
    return false;
}

void LocalLlmRuntimeManager::closeProcessHandles_()
{
    perceptrum::platform::CloseProcess(processHandle_);
}

void LocalLlmRuntimeManager::terminateManagedProcess_()
{
    if (processActive_ || processHandle_.active) {
        std::string terminateError;
        (void)perceptrum::platform::TerminateProcess(processHandle_, 0, 2000, &terminateError);
        if (!terminateError.empty()) {
            lastError_ = terminateError;
        }
    }

    closeProcessHandles_();
    processActive_ = false;
    usingManagedProcess_ = false;
}

void LocalLlmRuntimeManager::start()
{
    ensureReady();
}

void LocalLlmRuntimeManager::stop()
{
    std::lock_guard<std::mutex> lock(mutex_);
    terminateManagedProcess_();
}

bool LocalLlmRuntimeManager::ensureReady()
{
    std::lock_guard<std::mutex> lock(mutex_);

    if (!resolvedBaseUrl_.empty() && isHealthy_(resolvedBaseUrl_)) {
        lastError_.clear();
        return true;
    }

    if (!config_.baseUrl.empty()) {
        lastError_ =
            "chatv2 configured base URL is not healthy: " + config_.baseUrl;
        return false;
    }

    if (!config_.autostart) {
        lastError_ =
            "chatv2 local LLM autostart is disabled and no explicit base URL was configured.";
        return false;
    }

    if (usingManagedProcess_ && isManagedProcessRunning_()) {
        return waitForHealthy_(config_.startupTimeoutMs);
    }

    terminateManagedProcess_();

    if (!launchManagedProcess_()) {
        return false;
    }

    return waitForHealthy_(config_.startupTimeoutMs);
}

bool LocalLlmRuntimeManager::requiresLlm() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return config_.requireLlm;
}

bool LocalLlmRuntimeManager::hasConfiguredEndpoint() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return !config_.baseUrl.empty() || (!config_.serverPath.empty() && !config_.modelPath.empty());
}

std::string LocalLlmRuntimeManager::baseUrl() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return resolvedBaseUrl_;
}

std::string LocalLlmRuntimeManager::lastError() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return lastError_;
}

} // namespace chatv2

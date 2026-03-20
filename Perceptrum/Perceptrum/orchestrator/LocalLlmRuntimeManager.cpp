#include "LocalLlmRuntimeManager.h"

#include <algorithm>
#include <chrono>
#include <sstream>
#include <thread>
#include <vector>

#include "ConfigUtils.h"
#include "HttpUtils.h"

namespace chatv2 {

namespace {

std::vector<std::filesystem::path> buildServerCandidates_()
{
    std::vector<std::filesystem::path> candidates;
    for (const auto& root : buildLocalLlmRootCandidates()) {
        candidates.push_back(root / "bin" / "llama-server.exe");
        candidates.push_back(root / "llama-server.exe");
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

std::wstring toWide_(const std::string& value)
{
    if (value.empty()) return std::wstring();
    const int required = MultiByteToWideChar(
        CP_UTF8,
        0,
        value.c_str(),
        static_cast<int>(value.size()),
        nullptr,
        0);
    if (required <= 0) return std::wstring(value.begin(), value.end());

    std::wstring out(static_cast<size_t>(required), L'\0');
    MultiByteToWideChar(
        CP_UTF8,
        0,
        value.c_str(),
        static_cast<int>(value.size()),
        out.data(),
        required);
    return out;
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

bool LocalLlmRuntimeManager::isManagedProcessRunning_() const
{
    if (!processActive_ || !processInfo_.hProcess) return false;

    DWORD waitResult = WaitForSingleObject(processInfo_.hProcess, 0);
    return waitResult == WAIT_TIMEOUT;
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

    const std::wstring serverPath = toWide_(config_.serverPath);
    const std::wstring modelPath = toWide_(config_.modelPath);

    std::wostringstream command;
    command
        << L"\"" << serverPath << L"\""
        << L" -m \"" << modelPath << L"\""
        << L" --host " << toWide_(config_.host)
        << L" --port " << config_.port
        << L" -t " << config_.threads
        << L" -c " << config_.contextSize
        << L" -ngl 0"
        << L" -np 1";

    std::wstring cmdLine = command.str();

    STARTUPINFOW startupInfo;
    ZeroMemory(&startupInfo, sizeof(startupInfo));
    startupInfo.cb = sizeof(startupInfo);
    startupInfo.dwFlags = STARTF_USESHOWWINDOW;
    startupInfo.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION processInfo;
    ZeroMemory(&processInfo, sizeof(processInfo));

    std::vector<wchar_t> mutableCommand(cmdLine.begin(), cmdLine.end());
    mutableCommand.push_back(L'\0');

    const std::wstring workingDirectory = std::filesystem::path(serverPath).parent_path().wstring();
    BOOL created = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        workingDirectory.empty() ? nullptr : workingDirectory.c_str(),
        &startupInfo,
        &processInfo);

    if (!created) {
        lastError_ =
            "CreateProcessW failed for llama-server.exe, GetLastError=" + std::to_string(GetLastError());
        return false;
    }

    closeProcessHandles_();
    processInfo_ = processInfo;
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
            DWORD exitCode = 0;
            if (processInfo_.hProcess) {
                GetExitCodeProcess(processInfo_.hProcess, &exitCode);
            }
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
    if (processInfo_.hThread) {
        CloseHandle(processInfo_.hThread);
        processInfo_.hThread = nullptr;
    }
    if (processInfo_.hProcess) {
        CloseHandle(processInfo_.hProcess);
        processInfo_.hProcess = nullptr;
    }
}

void LocalLlmRuntimeManager::terminateManagedProcess_()
{
    if (processInfo_.hProcess) {
        if (isManagedProcessRunning_()) {
            TerminateProcess(processInfo_.hProcess, 0);
            WaitForSingleObject(processInfo_.hProcess, 2000);
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

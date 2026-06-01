#pragma once

#include <cstdint>
#include <filesystem>
#include <string>
#include <vector>

namespace perceptrum::platform {

struct ProcessHandle {
#ifdef _WIN32
    void* process = nullptr;
    void* thread = nullptr;
    std::uint32_t processId = 0;
#else
    int processId = -1;
#endif
    bool active = false;
    bool exitKnown = false;
    int cachedExitCode = 0;
};

struct ProcessLaunchOptions {
    std::filesystem::path executablePath;
    std::vector<std::string> arguments;
    std::filesystem::path workingDirectory;
    bool hideWindow = true;
};

struct ProcessRunResult {
    int exitCode = 0;
    std::string combinedOutput;
};

bool LaunchProcess(
    const ProcessLaunchOptions& options,
    ProcessHandle& processHandle,
    std::string& errorMessage);

bool RunProcessAndCaptureOutput(
    const ProcessLaunchOptions& options,
    ProcessRunResult& result,
    std::string& errorMessage);

bool IsProcessRunning(ProcessHandle& processHandle);
bool TryGetProcessExitCode(ProcessHandle& processHandle, int& exitCode);
bool WaitForProcessExit(ProcessHandle& processHandle, int timeoutMs, int& exitCode);
bool TerminateProcess(
    ProcessHandle& processHandle,
    int exitCode,
    int waitTimeoutMs,
    std::string* errorMessage = nullptr);

void CloseProcess(ProcessHandle& processHandle) noexcept;

} // namespace perceptrum::platform

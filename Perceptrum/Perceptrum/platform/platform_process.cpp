#include "platform_process.h"

#include "platform_common.h"

#include <array>
#include <chrono>
#include <thread>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace {

#ifdef _WIN32
std::wstring QuoteWindowsArgument(const std::wstring& argument)
{
    if (argument.empty()) {
        return L"\"\"";
    }

    const bool needsQuotes = argument.find_first_of(L" \t\n\v\"") != std::wstring::npos;
    if (!needsQuotes) {
        return argument;
    }

    std::wstring quoted;
    quoted.push_back(L'"');

    unsigned int backslashCount = 0;
    for (wchar_t ch : argument) {
        if (ch == L'\\') {
            ++backslashCount;
            continue;
        }

        if (ch == L'"') {
            quoted.append(backslashCount * 2 + 1, L'\\');
            quoted.push_back(L'"');
            backslashCount = 0;
            continue;
        }

        if (backslashCount > 0) {
            quoted.append(backslashCount, L'\\');
            backslashCount = 0;
        }

        quoted.push_back(ch);
    }

    if (backslashCount > 0) {
        quoted.append(backslashCount * 2, L'\\');
    }

    quoted.push_back(L'"');
    return quoted;
}

HANDLE AsHandle(void* handle) noexcept
{
    return static_cast<HANDLE>(handle);
}
#else
int ExitCodeFromStatus(const int status) noexcept
{
    if (WIFEXITED(status)) {
        return WEXITSTATUS(status);
    }

    if (WIFSIGNALED(status)) {
        return 128 + WTERMSIG(status);
    }

    return status;
}
#endif

} // namespace

namespace perceptrum::platform {

bool LaunchProcess(
    const ProcessLaunchOptions& options,
    ProcessHandle& processHandle,
    std::string& errorMessage)
{
    errorMessage.clear();
    CloseProcess(processHandle);

    if (options.executablePath.empty()) {
        errorMessage = "Executable path is empty.";
        return false;
    }

#ifdef _WIN32
    const std::filesystem::path resolvedExecutable =
        SearchExecutableInPath(options.executablePath);
    const std::wstring executableWide = resolvedExecutable.wstring();

    std::wstring commandLine = QuoteWindowsArgument(executableWide);
    for (const auto& argument : options.arguments) {
        commandLine.push_back(L' ');
        commandLine += QuoteWindowsArgument(Utf8ToWide(argument));
    }

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    if (options.hideWindow) {
        startupInfo.dwFlags = STARTF_USESHOWWINDOW;
        startupInfo.wShowWindow = SW_HIDE;
    }

    PROCESS_INFORMATION processInfo{};

    std::vector<wchar_t> mutableCommandLine(commandLine.begin(), commandLine.end());
    mutableCommandLine.push_back(L'\0');

    const std::wstring workingDirectory = options.workingDirectory.empty()
        ? std::wstring{}
        : options.workingDirectory.wstring();

    const DWORD creationFlags = options.hideWindow ? CREATE_NO_WINDOW : 0;
    const BOOL created = CreateProcessW(
        executableWide.c_str(),
        mutableCommandLine.data(),
        nullptr,
        nullptr,
        FALSE,
        creationFlags,
        nullptr,
        workingDirectory.empty() ? nullptr : workingDirectory.c_str(),
        &startupInfo,
        &processInfo);

    if (!created) {
        errorMessage = "CreateProcessW failed with error=" + std::to_string(GetLastError());
        return false;
    }

    processHandle.process = processInfo.hProcess;
    processHandle.thread = processInfo.hThread;
    processHandle.processId = processInfo.dwProcessId;
    processHandle.active = true;
    processHandle.exitKnown = false;
    processHandle.cachedExitCode = 0;
    return true;
#else
    const std::filesystem::path resolvedExecutable =
        SearchExecutableInPath(options.executablePath);

    const pid_t childPid = ::fork();
    if (childPid < 0) {
        errorMessage = "fork failed: " + std::string(std::strerror(errno));
        return false;
    }

    if (childPid == 0) {
        if (!options.workingDirectory.empty()) {
            ::chdir(options.workingDirectory.string().c_str());
        }

        std::vector<std::string> argumentsStorage;
        argumentsStorage.reserve(options.arguments.size() + 1);
        argumentsStorage.push_back(resolvedExecutable.string());
        for (const auto& argument : options.arguments) {
            argumentsStorage.push_back(argument);
        }

        std::vector<char*> argv;
        argv.reserve(argumentsStorage.size() + 1);
        for (auto& argument : argumentsStorage) {
            argv.push_back(argument.data());
        }
        argv.push_back(nullptr);

        ::execv(resolvedExecutable.string().c_str(), argv.data());
        std::_Exit(127);
    }

    processHandle.processId = static_cast<int>(childPid);
    processHandle.active = true;
    processHandle.exitKnown = false;
    processHandle.cachedExitCode = 0;
    return true;
#endif
}

bool RunProcessAndCaptureOutput(
    const ProcessLaunchOptions& options,
    ProcessRunResult& result,
    std::string& errorMessage)
{
    result.exitCode = 0;
    result.combinedOutput.clear();
    errorMessage.clear();

    if (options.executablePath.empty()) {
        errorMessage = "Executable path is empty.";
        return false;
    }

#ifdef _WIN32
    SECURITY_ATTRIBUTES securityAttributes{};
    securityAttributes.nLength = sizeof(securityAttributes);
    securityAttributes.bInheritHandle = TRUE;

    HANDLE readPipe = nullptr;
    HANDLE writePipe = nullptr;
    if (!CreatePipe(&readPipe, &writePipe, &securityAttributes, 0)) {
        errorMessage = "CreatePipe failed with error=" + std::to_string(GetLastError());
        return false;
    }

    if (!SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0)) {
        errorMessage = "SetHandleInformation failed with error=" + std::to_string(GetLastError());
        CloseHandle(readPipe);
        CloseHandle(writePipe);
        return false;
    }

    HANDLE nullInput = CreateFileW(
        L"NUL",
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        &securityAttributes,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (nullInput == INVALID_HANDLE_VALUE) {
        errorMessage = "CreateFileW(NUL) failed with error=" + std::to_string(GetLastError());
        CloseHandle(readPipe);
        CloseHandle(writePipe);
        return false;
    }

    const std::filesystem::path resolvedExecutable =
        SearchExecutableInPath(options.executablePath);
    const std::wstring executableWide = resolvedExecutable.wstring();

    std::wstring commandLine = QuoteWindowsArgument(executableWide);
    for (const auto& argument : options.arguments) {
        commandLine.push_back(L' ');
        commandLine += QuoteWindowsArgument(Utf8ToWide(argument));
    }

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    startupInfo.dwFlags = STARTF_USESTDHANDLES;
    if (options.hideWindow) {
        startupInfo.dwFlags |= STARTF_USESHOWWINDOW;
        startupInfo.wShowWindow = SW_HIDE;
    }
    startupInfo.hStdInput = nullInput;
    startupInfo.hStdOutput = writePipe;
    startupInfo.hStdError = writePipe;

    PROCESS_INFORMATION processInfo{};

    std::vector<wchar_t> mutableCommandLine(commandLine.begin(), commandLine.end());
    mutableCommandLine.push_back(L'\0');

    const std::wstring workingDirectory = options.workingDirectory.empty()
        ? std::wstring{}
        : options.workingDirectory.wstring();

    const DWORD creationFlags = options.hideWindow ? CREATE_NO_WINDOW : 0;
    const BOOL created = CreateProcessW(
        executableWide.c_str(),
        mutableCommandLine.data(),
        nullptr,
        nullptr,
        TRUE,
        creationFlags,
        nullptr,
        workingDirectory.empty() ? nullptr : workingDirectory.c_str(),
        &startupInfo,
        &processInfo);

    CloseHandle(writePipe);
    writePipe = nullptr;
    CloseHandle(nullInput);
    nullInput = nullptr;

    if (!created) {
        errorMessage = "CreateProcessW failed with error=" + std::to_string(GetLastError());
        CloseHandle(readPipe);
        return false;
    }

    ProcessHandle processHandle{};
    processHandle.process = processInfo.hProcess;
    processHandle.thread = processInfo.hThread;
    processHandle.processId = processInfo.dwProcessId;
    processHandle.active = true;

    std::thread reader([readPipe, &result]() {
        std::array<char, 4096> buffer{};
        DWORD bytesRead = 0;
        while (ReadFile(readPipe, buffer.data(), static_cast<DWORD>(buffer.size()), &bytesRead, nullptr) &&
            bytesRead > 0) {
            result.combinedOutput.append(buffer.data(), buffer.data() + bytesRead);
        }
        CloseHandle(readPipe);
    });

    int exitCode = 0;
    const bool waited = WaitForProcessExit(processHandle, -1, exitCode);
    CloseProcess(processHandle);
    reader.join();

    if (!waited) {
        errorMessage = "Failed waiting for process exit.";
        return false;
    }

    result.exitCode = exitCode;
    return true;
#else
    int pipeFds[2]{ -1, -1 };
    if (::pipe(pipeFds) != 0) {
        errorMessage = "pipe failed: " + std::string(std::strerror(errno));
        return false;
    }

    const int nullInput = ::open("/dev/null", O_RDONLY);

    const std::filesystem::path resolvedExecutable =
        SearchExecutableInPath(options.executablePath);

    const pid_t childPid = ::fork();
    if (childPid < 0) {
        errorMessage = "fork failed: " + std::string(std::strerror(errno));
        ::close(pipeFds[0]);
        ::close(pipeFds[1]);
        if (nullInput >= 0) {
            ::close(nullInput);
        }
        return false;
    }

    if (childPid == 0) {
        if (nullInput >= 0) {
            ::dup2(nullInput, STDIN_FILENO);
        }
        ::dup2(pipeFds[1], STDOUT_FILENO);
        ::dup2(pipeFds[1], STDERR_FILENO);

        ::close(pipeFds[0]);
        ::close(pipeFds[1]);
        if (nullInput >= 0) {
            ::close(nullInput);
        }

        if (!options.workingDirectory.empty()) {
            ::chdir(options.workingDirectory.string().c_str());
        }

        std::vector<std::string> argumentsStorage;
        argumentsStorage.reserve(options.arguments.size() + 1);
        argumentsStorage.push_back(resolvedExecutable.string());
        for (const auto& argument : options.arguments) {
            argumentsStorage.push_back(argument);
        }

        std::vector<char*> argv;
        argv.reserve(argumentsStorage.size() + 1);
        for (auto& argument : argumentsStorage) {
            argv.push_back(argument.data());
        }
        argv.push_back(nullptr);

        ::execv(resolvedExecutable.string().c_str(), argv.data());
        std::_Exit(127);
    }

    ::close(pipeFds[1]);
    if (nullInput >= 0) {
        ::close(nullInput);
    }

    ProcessHandle processHandle{};
    processHandle.processId = static_cast<int>(childPid);
    processHandle.active = true;

    std::thread reader([readFd = pipeFds[0], &result]() {
        std::array<char, 4096> buffer{};
        while (true) {
            const ssize_t bytesRead = ::read(readFd, buffer.data(), buffer.size());
            if (bytesRead <= 0) {
                break;
            }
            result.combinedOutput.append(buffer.data(), buffer.data() + bytesRead);
        }
        ::close(readFd);
    });

    int exitCode = 0;
    const bool waited = WaitForProcessExit(processHandle, -1, exitCode);
    CloseProcess(processHandle);
    reader.join();

    if (!waited) {
        errorMessage = "Failed waiting for process exit.";
        return false;
    }

    result.exitCode = exitCode;
    return true;
#endif
}

bool IsProcessRunning(ProcessHandle& processHandle)
{
    if (!processHandle.active) {
        return false;
    }

#ifdef _WIN32
    const HANDLE process = AsHandle(processHandle.process);
    if (!process) {
        processHandle.active = false;
        return false;
    }

    DWORD exitCode = STILL_ACTIVE;
    if (!GetExitCodeProcess(process, &exitCode)) {
        processHandle.active = false;
        return false;
    }

    if (exitCode == STILL_ACTIVE) {
        return true;
    }

    processHandle.active = false;
    processHandle.exitKnown = true;
    processHandle.cachedExitCode = static_cast<int>(exitCode);
    return false;
#else
    int status = 0;
    const pid_t waitResult = ::waitpid(processHandle.processId, &status, WNOHANG);
    if (waitResult == 0) {
        return true;
    }

    if (waitResult == processHandle.processId) {
        processHandle.active = false;
        processHandle.exitKnown = true;
        processHandle.cachedExitCode = ExitCodeFromStatus(status);
        return false;
    }

    if (waitResult < 0 && errno == ECHILD) {
        processHandle.active = false;
    }
    return false;
#endif
}

bool TryGetProcessExitCode(ProcessHandle& processHandle, int& exitCode)
{
    if (processHandle.exitKnown) {
        exitCode = processHandle.cachedExitCode;
        return true;
    }

    if (IsProcessRunning(processHandle)) {
        return false;
    }

    if (processHandle.exitKnown) {
        exitCode = processHandle.cachedExitCode;
        return true;
    }

    return false;
}

bool WaitForProcessExit(ProcessHandle& processHandle, int timeoutMs, int& exitCode)
{
    if (processHandle.exitKnown) {
        exitCode = processHandle.cachedExitCode;
        return true;
    }

    if (!processHandle.active) {
        exitCode = processHandle.cachedExitCode;
        return processHandle.exitKnown;
    }

#ifdef _WIN32
    const HANDLE process = AsHandle(processHandle.process);
    if (!process) {
        return false;
    }

    const DWORD waitTimeout = timeoutMs < 0 ? INFINITE : static_cast<DWORD>(timeoutMs);
    const DWORD waitResult = WaitForSingleObject(process, waitTimeout);
    if (waitResult != WAIT_OBJECT_0) {
        return false;
    }

    DWORD rawExitCode = 0;
    if (!GetExitCodeProcess(process, &rawExitCode)) {
        return false;
    }

    processHandle.active = false;
    processHandle.exitKnown = true;
    processHandle.cachedExitCode = static_cast<int>(rawExitCode);
    exitCode = processHandle.cachedExitCode;
    return true;
#else
    const auto start = std::chrono::steady_clock::now();
    while (timeoutMs < 0 ||
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now() - start).count() < timeoutMs) {
        if (TryGetProcessExitCode(processHandle, exitCode)) {
            return true;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(25));
    }

    return TryGetProcessExitCode(processHandle, exitCode);
#endif
}

bool TerminateProcess(
    ProcessHandle& processHandle,
    int exitCode,
    int waitTimeoutMs,
    std::string* errorMessage)
{
    if (errorMessage != nullptr) {
        errorMessage->clear();
    }

    if (!processHandle.active) {
        return true;
    }

#ifdef _WIN32
    const HANDLE process = AsHandle(processHandle.process);
    if (!process) {
        processHandle.active = false;
        return true;
    }

    if (!::TerminateProcess(process, static_cast<UINT>(exitCode))) {
        if (errorMessage != nullptr) {
            *errorMessage = "TerminateProcess failed with error=" + std::to_string(GetLastError());
        }
        return false;
    }

    int ignoredExitCode = 0;
    const bool exited = WaitForProcessExit(processHandle, waitTimeoutMs, ignoredExitCode);
    if (!exited && errorMessage != nullptr) {
        *errorMessage = "Timed out waiting for process termination.";
    }
    return exited;
#else
    if (::kill(processHandle.processId, SIGTERM) != 0 && errno != ESRCH) {
        if (errorMessage != nullptr) {
            *errorMessage = "kill(SIGTERM) failed: " + std::string(std::strerror(errno));
        }
        return false;
    }

    int ignoredExitCode = 0;
    if (WaitForProcessExit(processHandle, waitTimeoutMs, ignoredExitCode)) {
        return true;
    }

    if (::kill(processHandle.processId, SIGKILL) != 0 && errno != ESRCH) {
        if (errorMessage != nullptr) {
            *errorMessage = "kill(SIGKILL) failed: " + std::string(std::strerror(errno));
        }
        return false;
    }

    const bool exited = WaitForProcessExit(processHandle, waitTimeoutMs, ignoredExitCode);
    if (!exited && errorMessage != nullptr) {
        *errorMessage = "Timed out waiting for process termination.";
    }
    processHandle.cachedExitCode = exited ? ignoredExitCode : exitCode;
    return exited;
#endif
}

void CloseProcess(ProcessHandle& processHandle) noexcept
{
#ifdef _WIN32
    if (processHandle.thread != nullptr) {
        CloseHandle(AsHandle(processHandle.thread));
        processHandle.thread = nullptr;
    }

    if (processHandle.process != nullptr) {
        CloseHandle(AsHandle(processHandle.process));
        processHandle.process = nullptr;
    }

    processHandle.processId = 0;
#else
    if (processHandle.active) {
        int ignoredExitCode = 0;
        (void)TryGetProcessExitCode(processHandle, ignoredExitCode);
    }
    processHandle.processId = -1;
#endif

    processHandle.active = false;
    processHandle.exitKnown = false;
    processHandle.cachedExitCode = 0;
}

} // namespace perceptrum::platform

#include "platform_shutdown.h"

#include <algorithm>
#include <thread>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <atomic>
#include <csignal>
#include <mutex>
#endif

namespace {

#ifndef _WIN32
std::atomic<bool> g_shutdownRequested{ false };
std::once_flag g_signalHandlerOnce;

void HandleTerminationSignal(int)
{
    g_shutdownRequested.store(true);
}

void InstallSignalHandlers()
{
    std::signal(SIGINT, HandleTerminationSignal);
    std::signal(SIGTERM, HandleTerminationSignal);
}
#endif

} // namespace

namespace perceptrum::platform {

ShutdownSignal::ShutdownSignal(const std::wstring& signalName)
{
#ifdef _WIN32
    if (!signalName.empty()) {
        handle_ = OpenEventW(SYNCHRONIZE, FALSE, signalName.c_str());
    }
#else
    (void)signalName;
    std::call_once(g_signalHandlerOnce, InstallSignalHandlers);
#endif
}

ShutdownSignal::~ShutdownSignal()
{
#ifdef _WIN32
    if (handle_ != nullptr) {
        CloseHandle(static_cast<HANDLE>(handle_));
        handle_ = nullptr;
    }
#endif
}

bool ShutdownSignal::WaitFor(std::chrono::milliseconds timeout) const
{
#ifdef _WIN32
    if (handle_ != nullptr) {
        const DWORD waitResult = WaitForSingleObject(
            static_cast<HANDLE>(handle_),
            timeout.count() < 0 ? INFINITE : static_cast<DWORD>(timeout.count()));
        return waitResult == WAIT_OBJECT_0;
    }

    std::this_thread::sleep_for(timeout);
    return false;
#else
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    while (std::chrono::steady_clock::now() < deadline) {
        if (g_shutdownRequested.load()) {
            return true;
        }

        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
            deadline - std::chrono::steady_clock::now());
        std::this_thread::sleep_for((std::min)(remaining, std::chrono::milliseconds(50)));
    }

    return g_shutdownRequested.load();
#endif
}

} // namespace perceptrum::platform

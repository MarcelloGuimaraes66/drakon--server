#pragma once

#include <chrono>
#include <string>

namespace perceptrum::platform {

class ShutdownSignal {
public:
    explicit ShutdownSignal(const std::wstring& signalName);
    ~ShutdownSignal();

    ShutdownSignal(const ShutdownSignal&) = delete;
    ShutdownSignal& operator=(const ShutdownSignal&) = delete;

    bool WaitFor(std::chrono::milliseconds timeout) const;

private:
#ifdef _WIN32
    void* handle_ = nullptr;
#endif
};

} // namespace perceptrum::platform

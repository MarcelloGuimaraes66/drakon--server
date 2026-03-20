#pragma once

#include <windows.h>

#include <filesystem>
#include <initializer_list>
#include <string>
#include <utility>

namespace DrakonDesktop::platform
{
    struct LocalBackendStatus
    {
        bool ready{ false };
        bool startedByHost{ false };
        std::wstring summary;
        std::wstring uiBaseUrl{ L"http://127.0.0.1:4000" };
        std::filesystem::path logPath;
    };

    class LocalBackendHost
    {
    public:
        LocalBackendHost();
        ~LocalBackendHost();

        LocalBackendHost(LocalBackendHost const&) = delete;
        LocalBackendHost& operator=(LocalBackendHost const&) = delete;

        LocalBackendStatus EnsureReady();
        void Shutdown();

        LocalBackendStatus const& Status() const noexcept;

    private:
        bool ProbeReady() const;
        bool WaitForReady(DWORD timeoutMs, std::wstring& error) const;
        bool StartProcess(std::wstring& error);
        static std::wstring BuildEnvironmentBlock(std::initializer_list<std::pair<std::wstring, std::wstring>> overrides);

        std::filesystem::path m_logPath;
        HANDLE m_process{ nullptr };
        HANDLE m_job{ nullptr };
        DWORD m_processId{ 0 };
        LocalBackendStatus m_status;
    };
}

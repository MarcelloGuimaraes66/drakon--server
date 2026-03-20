#pragma once

#include <windows.h>

#include <filesystem>
#include <initializer_list>
#include <mutex>
#include <optional>
#include <string>
#include <utility>

namespace DrakonDesktop::platform
{
    struct PerceptrumRuntimeStatus
    {
        bool paired{ false };
        bool running{ false };
        std::string clientId;
        std::string exeId;
        std::string baseUrl;
        std::string summary;
        std::string lastError;
        std::filesystem::path logPath;
    };

    class PerceptrumRuntimeHost
    {
    public:
        PerceptrumRuntimeHost();
        ~PerceptrumRuntimeHost();

        PerceptrumRuntimeHost(PerceptrumRuntimeHost const&) = delete;
        PerceptrumRuntimeHost& operator=(PerceptrumRuntimeHost const&) = delete;

        PerceptrumRuntimeStatus Start();
        PerceptrumRuntimeStatus StartWithPairCode(std::string const& pairCode);
        PerceptrumRuntimeStatus StartWithProvisionedSession(
            std::string const& exeToken,
            std::string const& clientId,
            std::string const& exeId,
            std::optional<std::string> const& timezoneIana);
        void Stop();

        PerceptrumRuntimeStatus Status() const;

    private:
        bool StartInternal(std::string& error);
        void StopInternal();
        void PersistProvisionedSession(
            std::string const& exeToken,
            std::string const& clientId,
            std::string const& exeId,
            std::optional<std::string> const& timezoneIana) const;
        void PersistBaseUrlFiles() const;
        void RefreshStatus();
        static std::wstring BuildEnvironmentBlock(std::initializer_list<std::pair<std::wstring, std::wstring>> overrides);

        mutable std::mutex m_statusMutex;
        PerceptrumRuntimeStatus m_status;
        HANDLE m_process{ nullptr };
        HANDLE m_job{ nullptr };
        HANDLE m_shutdownEvent{ nullptr };
        DWORD m_processId{ 0 };
    };
}

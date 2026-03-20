#include "pch.h"
#include "PerceptrumRuntimeHost.h"

#include "AppRuntimeConfig.h"
#include "SecureLocalStore.h"
#include "../BootstrapTrace.h"

#include <Windows.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <map>

namespace
{
    std::wstring AsciiToWide(std::string const& value)
    {
        return std::wstring(value.begin(), value.end());
    }

    std::string WideToUtf8(std::wstring const& value)
    {
        if (value.empty())
        {
            return {};
        }

        auto const required = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
        if (required <= 0)
        {
            std::string fallback;
            fallback.reserve(value.size());
            for (auto const ch : value)
            {
                fallback.push_back(static_cast<char>(ch & 0xFF));
            }
            return fallback;
        }

        std::string utf8(static_cast<size_t>(required), '\0');
        WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, utf8.data(), required, nullptr, nullptr);
        utf8.resize(static_cast<size_t>(required) - 1);
        return utf8;
    }

    bool LooksLikeProtectedBlob(std::string const& value)
    {
        if (value.size() < 32 || value.rfind("AQAAANCM", 0) != 0)
        {
            return false;
        }

        return std::all_of(value.begin(), value.end(), [](unsigned char ch)
        {
            return std::isalnum(ch) != 0 || ch == '+' || ch == '/' || ch == '=';
        });
    }

}

namespace DrakonDesktop::platform
{
    PerceptrumRuntimeHost::PerceptrumRuntimeHost()
    {
        m_status.logPath = RuntimeConfig().serviceLogPath;
    }

    PerceptrumRuntimeHost::~PerceptrumRuntimeHost()
    {
        Stop();
    }

    PerceptrumRuntimeStatus PerceptrumRuntimeHost::Start()
    {
        std::string error;
        StartInternal(error);
        if (!error.empty())
        {
            std::lock_guard lock(m_statusMutex);
            m_status.lastError = error;
            m_status.summary = "Unable to start the servico cpp.";
        }
        RefreshStatus();
        return Status();
    }

    PerceptrumRuntimeStatus PerceptrumRuntimeHost::StartWithPairCode(std::string const& pairCode)
    {
        (void)pairCode;
        std::lock_guard lock(m_statusMutex);
        m_status.lastError = "Pair code bootstrap is no longer used by AppHost. Local session provisioning happens via the embedded frontend.";
        m_status.summary = "servico cpp waiting for embedded local session";
        return m_status;
    }

    PerceptrumRuntimeStatus PerceptrumRuntimeHost::StartWithProvisionedSession(
        std::string const& exeToken,
        std::string const& clientId,
        std::string const& exeId,
        std::optional<std::string> const& timezoneIana)
    {
        m_pendingProvisionedSession = ProvisionedSessionSnapshot{
            exeToken,
            clientId,
            exeId,
            timezoneIana,
        };
        PersistProvisionedSession(exeToken, clientId, exeId, timezoneIana);
        StopInternal();

        std::string error;
        StartInternal(error);
        if (!error.empty())
        {
            std::lock_guard lock(m_statusMutex);
            m_status.lastError = error;
            m_status.summary = "servico cpp session was written, but the process could not be started.";
        }
        RefreshStatus();
        return Status();
    }

    void PerceptrumRuntimeHost::Stop()
    {
        StopInternal();
    }

    PerceptrumRuntimeStatus PerceptrumRuntimeHost::Status() const
    {
        std::lock_guard lock(m_statusMutex);
        return m_status;
    }

    bool PerceptrumRuntimeHost::StartInternal(std::string& error)
    {
        auto const& config = RuntimeConfig();

        if (m_process != nullptr)
        {
            DWORD exitCode = STILL_ACTIVE;
            if (GetExitCodeProcess(m_process, &exitCode) && exitCode == STILL_ACTIVE)
            {
                return true;
            }
            StopInternal();
        }

        std::filesystem::create_directories(config.serviceSessionDirectory);
        PersistBaseUrlFiles();

        if (!std::filesystem::exists(config.executablePath))
        {
            error = "Host executable path is not available.";
            return false;
        }

        std::wstring shutdownEventName = L"Local\\AppHost.ServiceCpp." + std::to_wstring(GetCurrentProcessId());
        m_shutdownEvent = CreateEventW(nullptr, TRUE, FALSE, shutdownEventName.c_str());
        if (m_shutdownEvent == nullptr)
        {
            error = "Unable to create shutdown event for servico cpp.";
            return false;
        }

        SECURITY_ATTRIBUTES securityAttributes{};
        securityAttributes.nLength = sizeof(securityAttributes);
        securityAttributes.bInheritHandle = TRUE;

        auto logHandle = CreateFileW(
            config.serviceLogPath.wstring().c_str(),
            FILE_APPEND_DATA,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &securityAttributes,
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (logHandle == INVALID_HANDLE_VALUE)
        {
            error = "Unable to open servico cpp log file.";
            CloseHandle(m_shutdownEvent);
            m_shutdownEvent = nullptr;
            return false;
        }

        STARTUPINFOW startupInfo{};
        startupInfo.cb = sizeof(startupInfo);
        startupInfo.dwFlags = STARTF_USESTDHANDLES;
        startupInfo.hStdOutput = logHandle;
        startupInfo.hStdError = logHandle;
        startupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

        PROCESS_INFORMATION processInfo{};
        auto commandLine =
            L"\"" + config.executablePath.wstring() + L"\" --port=" + std::to_wstring(config.port) +
            L" --internal-role=service-cpp --shutdown-event=\"" + shutdownEventName + L"\"";

        auto environmentBlock = BuildEnvironmentBlock({
            { L"APP_BASE_URL", config.uiBaseUrl },
            { L"DRAKON_WORKSPACE_ROOT", config.workspaceRoot.wstring() },
            { L"PORT", std::to_wstring(config.port) },
            { L"SYSTEM_ACTIVITY_LOG_PATH", config.systemActivityLogPath.wstring() },
            { L"APP_PROVISIONED_EXE_TOKEN",
                m_pendingProvisionedSession.has_value()
                    ? AsciiToWide(m_pendingProvisionedSession->exeToken)
                    : std::wstring{} },
            { L"APP_PROVISIONED_CLIENT_ID",
                m_pendingProvisionedSession.has_value()
                    ? AsciiToWide(m_pendingProvisionedSession->clientId)
                    : std::wstring{} },
            { L"APP_PROVISIONED_EXE_ID",
                m_pendingProvisionedSession.has_value()
                    ? AsciiToWide(m_pendingProvisionedSession->exeId)
                    : std::wstring{} },
            { L"APP_PROVISIONED_TIMEZONE",
                (m_pendingProvisionedSession.has_value() && m_pendingProvisionedSession->timezoneIana.has_value())
                    ? AsciiToWide(*m_pendingProvisionedSession->timezoneIana)
                    : std::wstring{} },
        });

        if (!CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            TRUE,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            environmentBlock.data(),
            config.serviceSessionDirectory.wstring().c_str(),
            &startupInfo,
            &processInfo))
        {
            error = "Unable to start internal servico cpp process. Win32=" + std::to_string(GetLastError());
            CloseHandle(logHandle);
            CloseHandle(m_shutdownEvent);
            m_shutdownEvent = nullptr;
            return false;
        }

        CloseHandle(logHandle);
        CloseHandle(processInfo.hThread);

        m_job = CreateJobObjectW(nullptr, nullptr);
        if (m_job != nullptr)
        {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limitInfo{};
            limitInfo.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(m_job, JobObjectExtendedLimitInformation, &limitInfo, sizeof(limitInfo));
            AssignProcessToJobObject(m_job, processInfo.hProcess);
        }

        m_process = processInfo.hProcess;
        m_processId = processInfo.dwProcessId;

        AppendBootstrapTrace("runtime: internal servico cpp started");
        AppendBootstrapTrace("runtime: pid=" + std::to_string(m_processId));
        return true;
    }

    void PerceptrumRuntimeHost::StopInternal()
    {
        if (m_shutdownEvent != nullptr)
        {
            SetEvent(m_shutdownEvent);
        }

        if (m_process != nullptr)
        {
            WaitForSingleObject(m_process, 5000);
            CloseHandle(m_process);
            m_process = nullptr;
            m_processId = 0;
        }

        if (m_job != nullptr)
        {
            TerminateJobObject(m_job, 0);
            CloseHandle(m_job);
            m_job = nullptr;
        }

        if (m_shutdownEvent != nullptr)
        {
            CloseHandle(m_shutdownEvent);
            m_shutdownEvent = nullptr;
        }

        RefreshStatus();
    }

    void PerceptrumRuntimeHost::PersistProvisionedSession(
        std::string const& exeToken,
        std::string const& clientId,
        std::string const& exeId,
        std::optional<std::string> const& timezoneIana) const
    {
        auto const& config = RuntimeConfig();
        std::filesystem::create_directories(config.serviceSessionDirectory);

        WriteProtectedLocalText(config.serviceSessionDirectory / "exe_token.txt", exeToken);
        WriteProtectedLocalText(config.serviceSessionDirectory / "client_id.txt", clientId);
        WriteProtectedLocalText(config.serviceSessionDirectory / "exe_id.txt", exeId);
        if (timezoneIana.has_value() && !timezoneIana->empty())
        {
            WriteProtectedLocalText(config.serviceSessionDirectory / "paired_timezone.txt", *timezoneIana);
        }
        else
        {
            RemoveProtectedLocalText(config.serviceSessionDirectory / "paired_timezone.txt");
        }

        PersistBaseUrlFiles();
    }

    void PerceptrumRuntimeHost::PersistBaseUrlFiles() const
    {
        auto const& config = RuntimeConfig();
        std::ofstream(config.serviceSessionDirectory / "drakon_base_url.txt", std::ios::trunc) << WideToUtf8(config.uiBaseUrl);
        std::ofstream(config.serviceSessionDirectory / "perceptrum_base_url.txt", std::ios::trunc) << WideToUtf8(config.uiBaseUrl);
    }

    void PerceptrumRuntimeHost::RefreshStatus()
    {
        auto const& config = RuntimeConfig();
        auto const exeTokenPath = config.serviceSessionDirectory / "exe_token.txt";
        auto const clientIdPath = config.serviceSessionDirectory / "client_id.txt";
        auto const exeIdPath = config.serviceSessionDirectory / "exe_id.txt";
        auto const exeToken = ReadProtectedLocalText(exeTokenPath).value_or(std::string{});
        auto const clientId = ReadProtectedLocalText(clientIdPath).value_or(std::string{});
        auto const exeId = ReadProtectedLocalText(exeIdPath).value_or(std::string{});
        if (!exeToken.empty()) WriteProtectedLocalText(exeTokenPath, exeToken);
        if (!clientId.empty()) WriteProtectedLocalText(clientIdPath, clientId);
        if (!exeId.empty()) WriteProtectedLocalText(exeIdPath, exeId);
        auto const hasUsableProvisionedSession =
            !exeToken.empty() &&
            !clientId.empty() &&
            !exeId.empty() &&
            !LooksLikeProtectedBlob(exeToken) &&
            !LooksLikeProtectedBlob(clientId) &&
            !LooksLikeProtectedBlob(exeId);

        DWORD exitCode = 0;
        const bool running =
            m_process != nullptr &&
            GetExitCodeProcess(m_process, &exitCode) &&
            exitCode == STILL_ACTIVE;

        std::lock_guard lock(m_statusMutex);
        m_status.running = running;
        m_status.paired = hasUsableProvisionedSession;
        m_status.clientId = clientId;
        m_status.exeId = exeId;
        m_status.baseUrl = WideToUtf8(config.uiBaseUrl);
        m_status.logPath = config.serviceLogPath;
        if (!hasUsableProvisionedSession &&
            (!exeToken.empty() || !clientId.empty() || !exeId.empty()))
        {
            m_status.summary = "servico cpp local session requires reprovisioning.";
        }
        else if (m_status.summary.empty())
        {
            m_status.summary = running
                ? "servico cpp running in headless mode."
                : "servico cpp not running.";
        }
    }

    std::wstring PerceptrumRuntimeHost::BuildEnvironmentBlock(std::initializer_list<std::pair<std::wstring, std::wstring>> overrides)
    {
        std::map<std::wstring, std::wstring, std::less<>> variables;

        auto inherited = GetEnvironmentStringsW();
        if (inherited != nullptr)
        {
            for (auto current = inherited; *current != L'\0'; current += (wcslen(current) + 1))
            {
                std::wstring entry(current);
                auto separator = entry.find(L'=');
                if (separator == std::wstring::npos || separator == 0)
                {
                    continue;
                }

                variables.emplace(entry.substr(0, separator), entry.substr(separator + 1));
            }

            FreeEnvironmentStringsW(inherited);
        }

        for (auto const& [key, value] : overrides)
        {
            variables[key] = value;
        }

        std::wstring block;
        for (auto const& [key, value] : variables)
        {
            block += key;
            block += L'=';
            block += value;
            block.push_back(L'\0');
        }
        block.push_back(L'\0');
        return block;
    }
}

#include "pch.h"
#include "LocalBackendHost.h"

#include "AppRuntimeConfig.h"
#include "../BootstrapTrace.h"

#include <Windows.h>
#include <winhttp.h>

#include <map>

namespace
{
    constexpr DWORD kBootstrapTimeoutMs = 45000;
    constexpr DWORD kProbeSleepMs = 350;

    std::wstring AsciiToWide(std::string const& value)
    {
        return std::wstring(value.begin(), value.end());
    }

    bool ProbeHttp(std::wstring const& host, INTERNET_PORT port)
    {
        auto session = WinHttpOpen(L"AppHost/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (session == nullptr)
        {
            return false;
        }

        auto connection = WinHttpConnect(session, host.c_str(), port, 0);
        if (connection == nullptr)
        {
            WinHttpCloseHandle(session);
            return false;
        }

        auto request = WinHttpOpenRequest(connection, L"GET", L"/index.html", nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
        bool ok = false;
        if (request != nullptr)
        {
            if (WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
                WinHttpReceiveResponse(request, nullptr))
            {
                DWORD statusCode = 0;
                DWORD statusCodeSize = sizeof(statusCode);
                if (WinHttpQueryHeaders(
                    request,
                    WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                    WINHTTP_HEADER_NAME_BY_INDEX,
                    &statusCode,
                    &statusCodeSize,
                    WINHTTP_NO_HEADER_INDEX))
                {
                    ok = statusCode >= 200 && statusCode < 500;
                }
            }
            WinHttpCloseHandle(request);
        }

        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return ok;
    }
}

namespace DrakonDesktop::platform
{
    LocalBackendHost::LocalBackendHost()
    {
        m_logPath = RuntimeConfig().backendLogPath;
        m_status.logPath = m_logPath;
    }

    LocalBackendHost::~LocalBackendHost()
    {
        Shutdown();
    }

    LocalBackendStatus LocalBackendHost::EnsureReady()
    {
        m_status = {};
        m_status.logPath = m_logPath;
        m_status.uiBaseUrl = RuntimeConfig().uiBaseUrl;

        if (ProbeReady())
        {
            m_status.ready = true;
            m_status.summary = L"Local backend already responding.";
            return m_status;
        }

        std::wstring error;
        if (!StartProcess(error))
        {
            m_status.summary = error;
            return m_status;
        }

        if (!WaitForReady(kBootstrapTimeoutMs, error))
        {
            m_status.summary = error;
            return m_status;
        }

        m_status.ready = true;
        m_status.startedByHost = true;
        m_status.summary = L"Local backend ready on " + RuntimeConfig().uiBaseUrl;
        return m_status;
    }

    void LocalBackendHost::Shutdown()
    {
        if (m_job != nullptr)
        {
            TerminateJobObject(m_job, 0);
            CloseHandle(m_job);
            m_job = nullptr;
        }

        if (m_process != nullptr)
        {
            WaitForSingleObject(m_process, 5000);
            CloseHandle(m_process);
            m_process = nullptr;
            m_processId = 0;
        }
    }

    LocalBackendStatus const& LocalBackendHost::Status() const noexcept
    {
        return m_status;
    }

    bool LocalBackendHost::ProbeReady() const
    {
        return ProbeHttp(L"127.0.0.1", RuntimeConfig().port);
    }

    bool LocalBackendHost::WaitForReady(DWORD timeoutMs, std::wstring& error) const
    {
        auto const startTick = GetTickCount64();
        while ((GetTickCount64() - startTick) < timeoutMs)
        {
            if (ProbeReady())
            {
                return true;
            }

            Sleep(kProbeSleepMs);
        }

        error = L"Timed out waiting for the local backend to respond on " + RuntimeConfig().uiBaseUrl +
            L". Check " + m_logPath.wstring();
        return false;
    }

    bool LocalBackendHost::StartProcess(std::wstring& error)
    {
        auto const& config = RuntimeConfig();
        if (!std::filesystem::exists(config.nodeExecutablePath))
        {
            error = L"Node runtime was not found at " + config.nodeExecutablePath.wstring();
            return false;
        }
        if (!std::filesystem::exists(config.tsxCliPath))
        {
            error = L"tsx CLI was not found at " + config.tsxCliPath.wstring();
            return false;
        }
        if (!std::filesystem::exists(config.desktopServerScriptPath))
        {
            error = L"desktop-local-server.mjs was not found at " + config.desktopServerScriptPath.wstring();
            return false;
        }
        if (!std::filesystem::exists(config.tsconfigPath))
        {
            error = L"tsconfig.worker.json was not found at " + config.tsconfigPath.wstring();
            return false;
        }
        if (!std::filesystem::exists(config.staticRoot))
        {
            error = L"Built frontend was not found at " + config.staticRoot.wstring();
            return false;
        }

        std::filesystem::create_directories(config.serviceSessionDirectory);

        SECURITY_ATTRIBUTES securityAttributes{};
        securityAttributes.nLength = sizeof(securityAttributes);
        securityAttributes.bInheritHandle = TRUE;

        auto logHandle = CreateFileW(
            m_logPath.wstring().c_str(),
            FILE_APPEND_DATA,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &securityAttributes,
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL,
            nullptr);
        if (logHandle == INVALID_HANDLE_VALUE)
        {
            error = L"Unable to open backend log file. Win32=" + std::to_wstring(GetLastError());
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
            L"\"" + config.nodeExecutablePath.wstring() + L"\" \"" + config.tsxCliPath.wstring() +
            L"\" --tsconfig \"" + config.tsconfigPath.wstring() + L"\" \"" +
            config.desktopServerScriptPath.wstring() + L"\"";

        auto environmentBlock = BuildEnvironmentBlock({
            { L"DRAKON_WORKSPACE_ROOT", config.workspaceRoot.wstring() },
            { L"PORT", std::to_wstring(config.port) },
            { L"APP_BIND_HOST", L"127.0.0.1" },
            { L"APP_BASE_URL", config.uiBaseUrl },
            { L"APP_ALLOWED_ORIGINS", config.uiBaseUrl + L",http://127.0.0.1:" + std::to_wstring(config.port) },
            { L"APP_RUNTIME_ENV", L"local" },
            { L"ENV_PROFILE", L"local" },
            { L"APP_STATIC_ROOT", config.staticRoot.wstring() },
            { L"APP_SERVICE_SESSION_DIR", config.serviceSessionDirectory.wstring() },
            { L"STORAGE_ROOT", config.storageRoot.wstring() },
            { L"APP_DB_BACKEND", config.brandId == "drakon" ? L"postgres" : L"sqlite" },
        });

        if (!CreateProcessW(
            nullptr,
            commandLine.data(),
            nullptr,
            nullptr,
            TRUE,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            environmentBlock.data(),
            config.drakonSiteRoot.wstring().c_str(),
            &startupInfo,
            &processInfo))
        {
            error = L"Unable to start the local backend. Win32=" + std::to_wstring(GetLastError());
            CloseHandle(logHandle);
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

        AppendBootstrapTrace("backend: started local backend process");
        AppendBootstrapTrace("backend: pid=" + std::to_string(m_processId));
        return true;
    }

    std::wstring LocalBackendHost::BuildEnvironmentBlock(std::initializer_list<std::pair<std::wstring, std::wstring>> overrides)
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

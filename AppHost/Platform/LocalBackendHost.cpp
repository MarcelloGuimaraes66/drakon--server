#include "pch.h"
#include "LocalBackendHost.h"

#include "AppRuntimeConfig.h"
#include "DesktopDatabaseKeyStore.h"
#include "SecureLocalStore.h"
#include "../BootstrapTrace.h"

#include <Windows.h>
#include <winhttp.h>

#include <fstream>
#include <map>
#include <nlohmann/json.hpp>
#include <sstream>
#include <vector>

namespace
{
    constexpr DWORD kBootstrapTimeoutMs = 45000;
    constexpr DWORD kProbeSleepMs = 350;
    constexpr wchar_t kHealthEndpointPath[] = L"/api/runtime/health";

    struct HealthProbeResult
    {
        bool reachable{ false };
        bool ready{ false };
        bool fatal{ false };
        DWORD statusCode{ 0 };
        std::wstring summary;
    };

    std::wstring AsciiToWide(std::string const& value)
    {
        return std::wstring(value.begin(), value.end());
    }

    std::wstring Utf8ToWide(std::string const& value)
    {
        if (value.empty())
        {
            return {};
        }

        auto const required = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0);
        if (required <= 0)
        {
            return AsciiToWide(value);
        }

        std::wstring wide(static_cast<size_t>(required), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), wide.data(), required);
        return wide;
    }

    std::string ReadResponseBody(HINTERNET request)
    {
        std::string body;
        while (true)
        {
            DWORD bytesAvailable = 0;
            if (!WinHttpQueryDataAvailable(request, &bytesAvailable))
            {
                break;
            }

            if (bytesAvailable == 0)
            {
                break;
            }

            std::string chunk(static_cast<size_t>(bytesAvailable), '\0');
            DWORD bytesRead = 0;
            if (!WinHttpReadData(request, chunk.data(), bytesAvailable, &bytesRead) || bytesRead == 0)
            {
                break;
            }

            chunk.resize(static_cast<size_t>(bytesRead));
            body += chunk;
        }

        return body;
    }

    std::wstring TrimCopy(std::wstring value)
    {
        auto isSpace = [](wchar_t ch)
        {
            return ch == L' ' || ch == L'\t' || ch == L'\r' || ch == L'\n';
        };

        while (!value.empty() && isSpace(value.front()))
        {
            value.erase(value.begin());
        }

        while (!value.empty() && isSpace(value.back()))
        {
            value.pop_back();
        }

        return value;
    }

    std::wstring RemoveEnvironmentTerminatorBytes(std::wstring value)
    {
        auto const terminator = value.find(L'\0');
        if (terminator != std::wstring::npos)
        {
            value.resize(terminator);
        }

        return value;
    }

    std::wstring ReadLogTail(std::filesystem::path const& logPath, size_t maxBytes = 4096)
    {
        std::ifstream stream(logPath, std::ios::binary);
        if (!stream)
        {
            return {};
        }

        stream.seekg(0, std::ios::end);
        auto const size = static_cast<size_t>(stream.tellg());
        auto const start = size > maxBytes ? size - maxBytes : 0;
        stream.seekg(static_cast<std::streamoff>(start), std::ios::beg);

        std::string chunk(size - start, '\0');
        stream.read(chunk.data(), static_cast<std::streamsize>(chunk.size()));
        chunk.resize(static_cast<size_t>(stream.gcount()));

        auto const lastLineBreak = chunk.find_last_of("\r\n");
        if (lastLineBreak != std::string::npos && lastLineBreak + 1 < chunk.size())
        {
            chunk = chunk.substr(lastLineBreak + 1);
        }

        return TrimCopy(Utf8ToWide(chunk));
    }

    HealthProbeResult ProbeHttp(std::wstring const& host, INTERNET_PORT port)
    {
        HealthProbeResult result;
        auto session = WinHttpOpen(L"AppHost/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (session == nullptr)
        {
            return result;
        }

        auto connection = WinHttpConnect(session, host.c_str(), port, 0);
        if (connection == nullptr)
        {
            WinHttpCloseHandle(session);
            return result;
        }

        auto request = WinHttpOpenRequest(connection, L"GET", kHealthEndpointPath, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
        if (request != nullptr)
        {
            if (WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) &&
                WinHttpReceiveResponse(request, nullptr))
            {
                result.reachable = true;
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
                    result.statusCode = statusCode;
                }

                auto const body = ReadResponseBody(request);
                if (!body.empty())
                {
                    try
                    {
                        auto const parsed = nlohmann::json::parse(body);
                        result.ready = parsed.value("ready", false);
                        result.fatal = parsed.value("fatal", statusCode >= 500);
                        result.summary = Utf8ToWide(parsed.value("summary", std::string{}));
                    }
                    catch (...)
                    {
                        result.summary = Utf8ToWide(body);
                        result.ready = statusCode >= 200 && statusCode < 300;
                        result.fatal = statusCode >= 500;
                    }
                }
                else
                {
                    result.ready = statusCode >= 200 && statusCode < 300;
                    result.fatal = statusCode >= 500;
                }
            }
            WinHttpCloseHandle(request);
        }

        WinHttpCloseHandle(connection);
        WinHttpCloseHandle(session);
        return result;
    }
}

namespace DrakonDesktop::platform
{
    LocalBackendHost::LocalBackendHost()
    {
        m_logPath = RuntimeConfig().backendLogPath;
        m_agentLogPath = RuntimeConfig().agentBackendLogPath;
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

        std::wstring existingSummary;
        bool existingFatal = false;
        if (ProbeReady(&existingSummary, &existingFatal))
        {
            m_status.ready = true;
            m_status.summary = existingSummary.empty()
                ? L"Local backend already responding."
                : existingSummary;
            return m_status;
        }
        if (existingFatal)
        {
            m_status.summary = existingSummary;
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
        m_status.summary = L"Local backend ready on " + RuntimeConfig().uiBaseUrl +
            L" with agent ingress on " + RuntimeConfig().agentBaseUrl;
        return m_status;
    }

    void LocalBackendHost::Shutdown()
    {
        if (m_agentJob != nullptr)
        {
            TerminateJobObject(m_agentJob, 0);
            CloseHandle(m_agentJob);
            m_agentJob = nullptr;
        }

        if (m_agentProcess != nullptr)
        {
            WaitForSingleObject(m_agentProcess, 5000);
            CloseHandle(m_agentProcess);
            m_agentProcess = nullptr;
            m_agentProcessId = 0;
        }

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

    bool LocalBackendHost::ProbeReady(std::wstring* summary, bool* fatal) const
    {
        auto const uiProbe = ProbeHttp(L"127.0.0.1", RuntimeConfig().port);
        auto const agentProbe = ProbeHttp(L"127.0.0.1", RuntimeConfig().agentPort);
        if (summary != nullptr)
        {
            if (!uiProbe.summary.empty() && !agentProbe.summary.empty())
            {
                *summary = L"UI: " + uiProbe.summary + L" Agent: " + agentProbe.summary;
            }
            else if (!uiProbe.summary.empty())
            {
                *summary = L"UI: " + uiProbe.summary;
            }
            else
            {
                *summary = agentProbe.summary.empty()
                    ? std::wstring{}
                    : (L"Agent: " + agentProbe.summary);
            }
        }
        if (fatal != nullptr)
        {
            *fatal = uiProbe.fatal || agentProbe.fatal;
        }
        return uiProbe.reachable && uiProbe.ready && agentProbe.reachable && agentProbe.ready;
    }

    bool LocalBackendHost::WaitForReady(DWORD timeoutMs, std::wstring& error) const
    {
        auto const startTick = GetTickCount64();
        std::wstring lastSummary;
        auto composeLogHint = [&]()
        {
            return m_logPath.wstring() + L" and " + m_agentLogPath.wstring();
        };
        auto processExitedWithError = [&](HANDLE processHandle,
                                          std::filesystem::path const& logPath,
                                          std::wstring const& roleLabel) -> bool
        {
            if (processHandle == nullptr)
            {
                return false;
            }

            auto const waitResult = WaitForSingleObject(processHandle, 0);
            if (waitResult != WAIT_OBJECT_0)
            {
                return false;
            }

            auto const logTail = ReadLogTail(logPath);
            error = L"Local " + roleLabel + L" backend exited before becoming ready.";
            if (!logTail.empty())
            {
                error += L" Last log line: " + logTail;
            }
            else if (!lastSummary.empty())
            {
                error += L" " + lastSummary;
            }
            else
            {
                error += L" Check " + logPath.wstring();
            }

            return true;
        };
        while ((GetTickCount64() - startTick) < timeoutMs)
        {
            bool fatal = false;
            std::wstring summary;
            if (ProbeReady(&summary, &fatal))
            {
                return true;
            }

            if (!summary.empty())
            {
                lastSummary = summary;
            }

            if (fatal)
            {
                error = summary.empty()
                    ? L"Local backend reported an unrecoverable startup failure. Check " + composeLogHint()
                    : summary + L" Check " + composeLogHint();
                return false;
            }

            if (processExitedWithError(m_process, m_logPath, L"UI"))
            {
                return false;
            }

            if (processExitedWithError(m_agentProcess, m_agentLogPath, L"agent"))
            {
                return false;
            }

            Sleep(kProbeSleepMs);
        }

        error = !lastSummary.empty()
            ? lastSummary + L" Check " + composeLogHint()
            : L"Timed out waiting for the local backend to respond on " + RuntimeConfig().uiBaseUrl +
                L" and " + RuntimeConfig().agentBaseUrl +
                L". Check " + composeLogHint();
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
        if (!std::filesystem::exists(config.desktopServerScriptPath))
        {
            error = L"Backend entrypoint was not found at " + config.desktopServerScriptPath.wstring();
            return false;
        }
        if (config.backendUsesTsx && !std::filesystem::exists(config.tsxCliPath))
        {
            error = L"tsx CLI was not found at " + config.tsxCliPath.wstring();
            return false;
        }
        if (config.backendUsesTsx && !std::filesystem::exists(config.tsconfigPath))
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
        if (config.backendWorkingDirectory.empty() || !std::filesystem::exists(config.backendWorkingDirectory))
        {
            error = L"Backend working directory was not found at " + config.backendWorkingDirectory.wstring();
            return false;
        }

        auto const provisionedExeId = ReadProtectedLocalTextStrict(config.serviceSessionDirectory / "exe_id.txt").value_or(std::string{});

        auto const packagedDesktopUsesSqlite = !config.backendUsesTsx;
        auto const desktopBackend = packagedDesktopUsesSqlite
            ? std::wstring(L"sqlite")
            : (config.brandId == "drakon" ? std::wstring(L"postgres") : std::wstring(L"sqlite"));
        auto const desktopSqliteEncryptionMode = packagedDesktopUsesSqlite ? std::wstring(L"required") : std::wstring(L"off");
        std::wstring desktopSqliteKeyHex;
        if (packagedDesktopUsesSqlite)
        {
            auto const protectedSqliteKey = GetOrCreateDesktopSqliteKeyHex(config.serviceSessionDirectory);
            if (!protectedSqliteKey.has_value())
            {
                error = L"Unable to read or create the protected desktop SQLite key.";
                return false;
            }

            desktopSqliteKeyHex = AsciiToWide(*protectedSqliteKey);
        }

        std::wstring commandLineTemplate;
        if (config.backendUsesTsx)
        {
            commandLineTemplate =
                L"\"" + config.nodeExecutablePath.wstring() + L"\" \"" + config.tsxCliPath.wstring() +
                L"\" --tsconfig \"" + config.tsconfigPath.wstring() + L"\" \"" +
                config.desktopServerScriptPath.wstring() + L"\"";
        }
        else
        {
            commandLineTemplate =
                L"\"" + config.nodeExecutablePath.wstring() + L"\" \"" +
                config.desktopServerScriptPath.wstring() + L"\"";
        }

        auto const allowedOrigins =
            config.uiBaseUrl +
            L",http://127.0.0.1:" + std::to_wstring(config.port) +
            L"," + config.agentBaseUrl +
            L",http://127.0.0.1:" + std::to_wstring(config.agentPort);
        auto const mediaPublicBaseUrl = config.uiBaseUrl + L"/media";

        auto launchBackendProcess =
            [&](std::filesystem::path const& logPath,
                std::uint16_t port,
                std::wstring const& appBaseUrl,
                std::wstring const& role,
                HANDLE& outProcess,
                HANDLE& outJob,
                DWORD& outProcessId) -> bool
        {
            SECURITY_ATTRIBUTES roleSecurityAttributes{};
            roleSecurityAttributes.nLength = sizeof(roleSecurityAttributes);
            roleSecurityAttributes.bInheritHandle = TRUE;

            auto roleLogHandle = CreateFileW(
                logPath.wstring().c_str(),
                FILE_APPEND_DATA,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                &roleSecurityAttributes,
                OPEN_ALWAYS,
                FILE_ATTRIBUTE_NORMAL,
                nullptr);
            if (roleLogHandle == INVALID_HANDLE_VALUE)
            {
                error =
                    L"Unable to open " + role + L" backend log file. Win32=" +
                    std::to_wstring(GetLastError());
                return false;
            }

            STARTUPINFOW roleStartupInfo{};
            roleStartupInfo.cb = sizeof(roleStartupInfo);
            roleStartupInfo.dwFlags = STARTF_USESTDHANDLES;
            roleStartupInfo.hStdOutput = roleLogHandle;
            roleStartupInfo.hStdError = roleLogHandle;
            roleStartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

            std::wstring roleCommandLine = commandLineTemplate;
            auto environmentBlock = BuildEnvironmentBlock({
                { L"DRAKON_WORKSPACE_ROOT", config.workspaceRoot.wstring() },
                { L"APP_RUNTIME_ROOT", config.runtimeRoot.wstring() },
                { L"PORT", std::to_wstring(port) },
                { L"APP_BIND_HOST", L"127.0.0.1" },
                { L"APP_BASE_URL", appBaseUrl },
                { L"APP_AGENT_BASE_URL", config.agentBaseUrl },
                { L"APP_SERVER_ROLE", role },
                { L"APP_ALLOWED_ORIGINS", allowedOrigins },
                { L"APP_RUNTIME_ENV", L"local" },
                { L"ENV_PROFILE", L"local" },
                { L"APP_STATIC_ROOT", config.staticRoot.wstring() },
                { L"APP_SERVICE_SESSION_DIR", config.serviceSessionDirectory.wstring() },
                { L"STORAGE_ROOT", config.storageRoot.wstring() },
                { L"APP_DB_BACKEND", desktopBackend },
                { L"APP_SQLITE_ENCRYPTION", desktopSqliteEncryptionMode },
                { L"APP_SQLITE_KEY_HEX", desktopSqliteKeyHex },
                { L"APP_SQLITE_KEY_VERSION", packagedDesktopUsesSqlite ? std::wstring(L"v1") : std::wstring{} },
                { L"APP_SQLITE_CIPHER", packagedDesktopUsesSqlite ? std::wstring(L"sqlcipher") : std::wstring{} },
                { L"APP_SQLITE_LEGACY", packagedDesktopUsesSqlite ? std::wstring(L"4") : std::wstring{} },
                { L"APP_PROVISIONED_EXE_ID", AsciiToWide(provisionedExeId) },
                { L"R2_PUBLIC_BASE_URL", mediaPublicBaseUrl },
            });

            PROCESS_INFORMATION processInfo{};
            if (!CreateProcessW(
                    nullptr,
                    roleCommandLine.data(),
                    nullptr,
                    nullptr,
                    TRUE,
                    CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                    environmentBlock.data(),
                    config.backendWorkingDirectory.wstring().c_str(),
                    &roleStartupInfo,
                    &processInfo))
            {
                error =
                    L"Unable to start the " + role + L" local backend. Win32=" +
                    std::to_wstring(GetLastError());
                CloseHandle(roleLogHandle);
                return false;
            }

            CloseHandle(roleLogHandle);
            CloseHandle(processInfo.hThread);

            outJob = CreateJobObjectW(nullptr, nullptr);
            if (outJob != nullptr)
            {
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION limitInfo{};
                limitInfo.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(outJob, JobObjectExtendedLimitInformation, &limitInfo, sizeof(limitInfo));
                AssignProcessToJobObject(outJob, processInfo.hProcess);
            }

            outProcess = processInfo.hProcess;
            outProcessId = processInfo.dwProcessId;

            auto const roleNarrow = std::string(role.begin(), role.end());
            AppendBootstrapTrace("backend: started " + roleNarrow + " backend process");
            AppendBootstrapTrace("backend: " + roleNarrow + " pid=" + std::to_string(outProcessId));
            return true;
        };

        if (!launchBackendProcess(
                m_logPath,
                config.port,
                config.uiBaseUrl,
                L"ui",
                m_process,
                m_job,
                m_processId))
        {
            return false;
        }

        if (!launchBackendProcess(
                m_agentLogPath,
                config.agentPort,
                config.agentBaseUrl,
                L"agent",
                m_agentProcess,
                m_agentJob,
                m_agentProcessId))
        {
            Shutdown();
            return false;
        }

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
            variables[key] = RemoveEnvironmentTerminatorBytes(value);
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

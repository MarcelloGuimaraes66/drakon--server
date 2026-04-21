#include "pch.h"
#include "AppRuntimeConfig.h"

#include <Windows.h>
#include <iphlpapi.h>
#include <shellapi.h>

#include <mutex>
#include <random>
#include <unordered_set>
#include <vector>

#include <platform/platform_common.h>

#include "generated\\Branding.h"

#pragma comment(lib, "Iphlpapi.lib")

namespace
{
    std::once_flag g_runtimeConfigOnce;
    DrakonDesktop::platform::AppRuntimeConfig g_runtimeConfig;

    std::wstring Utf8ToWide(std::string const& value)
    {
        return perceptrum::platform::Utf8ToWide(value);
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

    std::wstring ReadEnvValue(wchar_t const* name)
    {
        wchar_t buffer[4096]{};
        auto const written = GetEnvironmentVariableW(name, buffer, static_cast<DWORD>(std::size(buffer)));
        if (written == 0 || written >= std::size(buffer))
        {
            return {};
        }

        return TrimCopy(buffer);
    }

    std::filesystem::path SearchExecutablePath(wchar_t const* executableName)
    {
        return perceptrum::platform::SearchExecutableInPath(std::filesystem::path(executableName));
    }

    std::filesystem::path ResolveExecutablePath()
    {
        return perceptrum::platform::GetExecutablePath();
    }

    std::filesystem::path FirstExistingPath(std::initializer_list<std::filesystem::path> candidates)
    {
        for (auto const& candidate : candidates)
        {
            if (!candidate.empty() && std::filesystem::exists(candidate))
            {
                return candidate;
            }
        }

        return {};
    }

    std::wstring ExtractArgValue(std::wstring const& token, wchar_t const* key)
    {
        std::wstring prefix = std::wstring(L"--") + key + L"=";
        if (token.rfind(prefix, 0) == 0)
        {
            return token.substr(prefix.size());
        }
        return {};
    }

    bool TryParsePortValue(std::wstring const& value, std::uint16_t& port)
    {
        auto const trimmed = TrimCopy(value);
        if (trimmed.empty())
        {
            return false;
        }

        try
        {
            auto const parsed = std::stoul(trimmed);
            if (parsed == 0 || parsed > 65535UL)
            {
                return false;
            }

            port = static_cast<std::uint16_t>(parsed);
            return true;
        }
        catch (...)
        {
            return false;
        }
    }

    std::uint16_t NetworkPortToHostPort(DWORD portValue)
    {
        auto const networkPort = static_cast<std::uint16_t>(portValue & 0xFFFF);
        return static_cast<std::uint16_t>((networkPort >> 8) | (networkPort << 8));
    }

    std::unordered_set<std::uint16_t> ReadOccupiedTcpPorts()
    {
        std::unordered_set<std::uint16_t> ports;
        DWORD tableBytes = 0;
        auto status = GetTcpTable(nullptr, &tableBytes, FALSE);
        if (status != ERROR_INSUFFICIENT_BUFFER || tableBytes == 0)
        {
            return ports;
        }

        std::vector<unsigned char> buffer(tableBytes);
        auto* table = reinterpret_cast<PMIB_TCPTABLE>(buffer.data());
        status = GetTcpTable(table, &tableBytes, FALSE);
        if (status != NO_ERROR)
        {
            return ports;
        }

        for (DWORD index = 0; index < table->dwNumEntries; ++index)
        {
            auto const port = NetworkPortToHostPort(table->table[index].dwLocalPort);
            if (port != 0)
            {
                ports.insert(port);
            }
        }

        return ports;
    }

    std::uint16_t ChooseDesktopBackendPort()
    {
        auto const occupiedPorts = ReadOccupiedTcpPorts();
        constexpr std::uint16_t kDynamicPortStart = 49152;
        constexpr std::uint16_t kDynamicPortEnd = 65535;

        std::random_device randomDevice;
        auto seed = static_cast<std::uint32_t>(GetCurrentProcessId() ^ GetTickCount());
        for (int index = 0; index < 4; ++index)
        {
            seed ^= static_cast<std::uint32_t>(randomDevice()) << (index % 2 == 0 ? 0 : 1);
        }

        std::mt19937 generator(seed);
        std::uniform_int_distribution<std::uint32_t> distribution(kDynamicPortStart, kDynamicPortEnd);
        for (int attempt = 0; attempt < 64; ++attempt)
        {
            auto const candidate = static_cast<std::uint16_t>(distribution(generator));
            if (occupiedPorts.find(candidate) == occupiedPorts.end())
            {
                return candidate;
            }
        }

        for (std::uint32_t candidate = kDynamicPortStart; candidate <= kDynamicPortEnd; ++candidate)
        {
            auto const narrowedCandidate = static_cast<std::uint16_t>(candidate);
            if (occupiedPorts.find(narrowedCandidate) == occupiedPorts.end())
            {
                return narrowedCandidate;
            }
        }

        return 4000;
    }

    bool ParseCommandLine(DrakonDesktop::platform::AppRuntimeConfig& config)
    {
        bool portExplicitlyConfigured = false;
        int argc = 0;
        auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        if (!argv)
        {
            return false;
        }

        std::unique_ptr<wchar_t*, decltype(&LocalFree)> argvGuard(argv, &LocalFree);
        for (int index = 1; index < argc; ++index)
        {
            std::wstring token = argv[index];
            std::wstring value;

            if (token == L"--port" && index + 1 < argc)
            {
                value = argv[++index];
                if (TryParsePortValue(value, config.port))
                {
                    portExplicitlyConfigured = true;
                }
                continue;
            }

            if (!(value = ExtractArgValue(token, L"port")).empty())
            {
                if (TryParsePortValue(value, config.port))
                {
                    portExplicitlyConfigured = true;
                }
                continue;
            }

            if (token == L"--internal-role" && index + 1 < argc)
            {
                value = argv[++index];
                config.internalServiceMode = (_wcsicmp(value.c_str(), L"service-cpp") == 0);
                continue;
            }

            if (!(value = ExtractArgValue(token, L"internal-role")).empty())
            {
                config.internalServiceMode = (_wcsicmp(value.c_str(), L"service-cpp") == 0);
                continue;
            }

            if (token == L"--shutdown-event" && index + 1 < argc)
            {
                config.shutdownEventName = argv[++index];
                continue;
            }

            if (!(value = ExtractArgValue(token, L"shutdown-event")).empty())
            {
                config.shutdownEventName = value;
                continue;
            }
        }

        return portExplicitlyConfigured;
    }

    std::filesystem::path ResolveLocalAppDataRoot()
    {
        auto const fromEnv = ReadEnvValue(L"LOCALAPPDATA");
        if (!fromEnv.empty())
        {
            return std::filesystem::path(fromEnv);
        }

        return std::filesystem::temp_directory_path();
    }

    void InitializeConfig()
    {
        auto& config = g_runtimeConfig;
        config.executablePath = ResolveExecutablePath();
        config.executableDirectory = config.executablePath.parent_path();
        config.runtimeRoot = config.executableDirectory / "runtime";

        config.brandId = AppBrand::kBrandId;
        config.displayName = Utf8ToWide(static_cast<const char*>(AppBrand::kDisplayName));
        config.appUserModelId = Utf8ToWide(static_cast<const char*>(AppBrand::kAppUserModelId));
        config.windowTitle = Utf8ToWide(static_cast<const char*>(AppBrand::kWindowTitle));
        config.trayTooltip = Utf8ToWide(static_cast<const char*>(AppBrand::kTrayTooltip));
        config.backgroundNotificationTitle = Utf8ToWide(static_cast<const char*>(AppBrand::kBackgroundNotificationTitle));
        config.backgroundNotificationMessage = Utf8ToWide(static_cast<const char*>(AppBrand::kBackgroundNotificationMessage));
        config.trayIconGuidValid =
            CLSIDFromString(AppBrand::kTrayIconGuidW, &config.trayIconGuid) == NOERROR;

        auto const portExplicitlyConfigured = ParseCommandLine(config);
        if (!portExplicitlyConfigured && !config.internalServiceMode)
        {
            // Use a random high port by default so the local desktop backend does not keep colliding on :4000.
            config.port = ChooseDesktopBackendPort();
        }

        auto const envWorkspaceRoot = ReadEnvValue(L"DRAKON_WORKSPACE_ROOT");
        config.workspaceRoot = FirstExistingPath({
            envWorkspaceRoot.empty() ? std::filesystem::path{} : std::filesystem::path(envWorkspaceRoot),
            config.executableDirectory,
            config.executableDirectory.parent_path(),
            std::filesystem::path(L"C:\\dev\\Workspace"),
        });

        config.brandConfigPath = FirstExistingPath({
            config.executableDirectory / "brand.config.json",
            config.runtimeRoot / "brand.config.json",
            config.workspaceRoot / "brand.config.json",
        });

        config.drakonSiteRoot = FirstExistingPath({
            config.runtimeRoot / "drakonsite",
            config.workspaceRoot / "DrakonSite",
        });

        config.nodeExecutablePath = FirstExistingPath({
            config.runtimeRoot / "node" / "node.exe",
            SearchExecutablePath(L"node.exe"),
        });

        auto const bundledBackendScriptPath = FirstExistingPath({
            config.runtimeRoot / "desktop-local-server.cjs",
            config.runtimeRoot / "desktop-local-server.mjs",
        });
        if (!bundledBackendScriptPath.empty())
        {
            config.desktopServerScriptPath = bundledBackendScriptPath;
            config.backendUsesTsx = false;
        }
        else
        {
            config.desktopServerScriptPath = FirstExistingPath({
                config.workspaceRoot / "AppHost" / "Runtime" / "desktop-local-server.mjs",
            });
            config.backendUsesTsx = true;
        }

        config.tsxCliPath = FirstExistingPath({
            config.runtimeRoot / "drakonsite" / "node_modules" / "tsx" / "dist" / "cli.mjs",
            config.drakonSiteRoot / "node_modules" / "tsx" / "dist" / "cli.mjs",
        });

        config.tsconfigPath = FirstExistingPath({
            config.runtimeRoot / "drakonsite" / "tsconfig.worker.json",
            config.drakonSiteRoot / "tsconfig.worker.json",
        });

        config.staticRoot = FirstExistingPath({
            config.runtimeRoot / "web",
            config.drakonSiteRoot / "dist",
        });

        config.backendWorkingDirectory = config.backendUsesTsx
            ? FirstExistingPath({
                config.drakonSiteRoot,
            })
            : FirstExistingPath({
                config.runtimeRoot / "drakonsite",
                config.runtimeRoot,
            });

        config.serviceSessionDirectory =
            ResolveLocalAppDataRoot() / "DrakonPerceptrumDesktop" / Utf8ToWide(config.brandId);
        std::filesystem::create_directories(config.serviceSessionDirectory);

        config.storageRoot = config.serviceSessionDirectory / "storage";
        std::filesystem::create_directories(config.storageRoot);

        config.webViewUserDataDirectory = config.serviceSessionDirectory / "webview2";
        std::filesystem::create_directories(config.webViewUserDataDirectory);

        config.brandIconPath = FirstExistingPath({
            config.runtimeRoot / "branding" / "app.ico",
            config.executableDirectory / "generated" / "current_app_icon.ico",
            config.workspaceRoot / "AppHost" / "generated" / "current_app_icon.ico",
        });

        config.backendLogPath = config.serviceSessionDirectory / "backend-host.log";
        config.serviceLogPath = config.serviceSessionDirectory / "service-cpp.log";
        config.systemActivityLogPath = config.serviceSessionDirectory / "logs" / "system-activity.jsonl";
        std::filesystem::create_directories(config.systemActivityLogPath.parent_path());
        config.uiBaseUrl = L"http://127.0.0.1:" + std::to_wstring(config.port);
    }
}

namespace DrakonDesktop::platform
{
    bool InitializeRuntimeConfig()
    {
        std::call_once(g_runtimeConfigOnce, InitializeConfig);
        return true;
    }

    AppRuntimeConfig const& RuntimeConfig()
    {
        InitializeRuntimeConfig();
        return g_runtimeConfig;
    }
}

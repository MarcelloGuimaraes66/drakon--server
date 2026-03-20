#include "pch.h"
#include "AppRuntimeConfig.h"

#include <Windows.h>
#include <shellapi.h>

#include <mutex>

#include "generated\\Branding.h"

namespace
{
    std::once_flag g_runtimeConfigOnce;
    DrakonDesktop::platform::AppRuntimeConfig g_runtimeConfig;

    std::wstring Utf8ToWide(std::string const& value)
    {
        if (value.empty())
        {
            return {};
        }

        auto const required = MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, nullptr, 0);
        if (required <= 0)
        {
            return std::wstring(value.begin(), value.end());
        }

        std::wstring wide(static_cast<size_t>(required), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, value.c_str(), -1, wide.data(), required);
        wide.resize(static_cast<size_t>(required) - 1);
        return wide;
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
        wchar_t buffer[MAX_PATH]{};
        auto const written = SearchPathW(nullptr, executableName, nullptr, static_cast<DWORD>(std::size(buffer)), buffer, nullptr);
        if (written == 0 || written >= std::size(buffer))
        {
            return std::filesystem::path(executableName);
        }

        return std::filesystem::path(buffer);
    }

    std::filesystem::path ResolveExecutablePath()
    {
        wchar_t buffer[MAX_PATH]{};
        auto const written = GetModuleFileNameW(nullptr, buffer, static_cast<DWORD>(std::size(buffer)));
        if (written == 0)
        {
            return {};
        }

        return std::filesystem::path(buffer);
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

    void ParseCommandLine(DrakonDesktop::platform::AppRuntimeConfig& config)
    {
        int argc = 0;
        auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
        if (!argv)
        {
            return;
        }

        std::unique_ptr<wchar_t*, decltype(&LocalFree)> argvGuard(argv, &LocalFree);
        for (int index = 1; index < argc; ++index)
        {
            std::wstring token = argv[index];
            std::wstring value;

            if (token == L"--port" && index + 1 < argc)
            {
                value = argv[++index];
                try
                {
                    config.port = static_cast<std::uint16_t>(std::stoi(value));
                }
                catch (...)
                {
                    config.port = 4000;
                }
                continue;
            }

            if (!(value = ExtractArgValue(token, L"port")).empty())
            {
                try
                {
                    config.port = static_cast<std::uint16_t>(std::stoi(value));
                }
                catch (...)
                {
                    config.port = 4000;
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

        ParseCommandLine(config);

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

        config.desktopServerScriptPath = FirstExistingPath({
            config.runtimeRoot / "desktop-local-server.mjs",
            config.workspaceRoot / "AppHost" / "Runtime" / "desktop-local-server.mjs",
        });

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

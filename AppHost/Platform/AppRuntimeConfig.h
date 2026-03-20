#pragma once

#include <cstdint>
#include <filesystem>
#include <string>

namespace DrakonDesktop::platform
{
    struct AppRuntimeConfig
    {
        std::string brandId{ "perceptrum" };
        std::uint16_t port{ 4000 };
        bool internalServiceMode{ false };
        std::wstring shutdownEventName;

        std::filesystem::path executablePath;
        std::filesystem::path executableDirectory;
        std::filesystem::path workspaceRoot;
        std::filesystem::path brandConfigPath;
        std::filesystem::path drakonSiteRoot;
        std::filesystem::path nodeExecutablePath;
        std::filesystem::path tsxCliPath;
        std::filesystem::path tsconfigPath;
        std::filesystem::path desktopServerScriptPath;
        std::filesystem::path staticRoot;
        std::filesystem::path storageRoot;
        std::filesystem::path runtimeRoot;
        std::filesystem::path serviceSessionDirectory;
        std::filesystem::path webViewUserDataDirectory;
        std::filesystem::path brandIconPath;
        std::filesystem::path backendLogPath;
        std::filesystem::path serviceLogPath;

        std::wstring displayName{ L"Perceptrum" };
        std::wstring appUserModelId{ L"Perceptrum" };
        std::wstring windowTitle{ L"Perceptrum" };
        std::wstring trayTooltip{ L"Perceptrum agent running" };
        std::wstring backgroundNotificationTitle;
        std::wstring backgroundNotificationMessage{ L"Perceptrum is now running in the background." };
        std::wstring uiBaseUrl{ L"http://127.0.0.1:4000" };
        GUID trayIconGuid{};
        bool trayIconGuidValid{ false };
    };

    bool InitializeRuntimeConfig();
    AppRuntimeConfig const& RuntimeConfig();
}

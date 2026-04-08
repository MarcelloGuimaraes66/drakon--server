#pragma once

#include <memory>

#include "winrt/Microsoft.UI.Xaml.h"
#include "XamlMetaDataProvider.h"

namespace DrakonDesktop::platform
{
    struct PairRuntimeRequestResult
    {
        bool succeeded{ false };
        winrt::hstring message;
    };

    struct DesktopShellRequestResult
    {
        bool succeeded{ false };
        winrt::hstring message;
    };

    class LocalBackendHost;
    class PerceptrumRuntimeHost;
    class TrayIconHost;
    PairRuntimeRequestResult PairRuntimeWithCodeFromWebSession(winrt::hstring const& pairCode);
    PairRuntimeRequestResult StartRuntimeWithProvisionedSessionFromWeb(
        winrt::hstring const& clientId,
        winrt::hstring const& exeId,
        winrt::hstring const& exeToken,
        winrt::hstring const& timezoneIana);
    DesktopShellRequestResult ScheduleLocalAppDataCleanupAfterAccountDeletionFromWeb(bool clearStorageRoot);
    bool IsRuntimeAlreadyProvisioned();
}

namespace winrt::DrakonDesktop::implementation
{
    struct App : winrt::Microsoft::UI::Xaml::ApplicationT<App, winrt::Microsoft::UI::Xaml::Markup::IXamlMetadataProvider>
    {
        App();
        ~App();

        void InitializeComponent();
        winrt::Microsoft::UI::Xaml::Markup::IXamlType GetXamlType(winrt::Windows::UI::Xaml::Interop::TypeName const& type);
        winrt::Microsoft::UI::Xaml::Markup::IXamlType GetXamlType(winrt::hstring const& fullName);
        winrt::com_array<winrt::Microsoft::UI::Xaml::Markup::XmlnsDefinition> GetXmlnsDefinitions();
        void OnLaunched(Microsoft::UI::Xaml::LaunchActivatedEventArgs const&);

    private:
        winrt::com_ptr<XamlMetaDataProvider> AppProvider();

        bool m_resourcesInitialized{ false };
        winrt::com_ptr<XamlMetaDataProvider> m_appProvider;
        winrt::Microsoft::UI::Xaml::Window m_window{ nullptr };
        std::unique_ptr<::DrakonDesktop::platform::LocalBackendHost> m_backendHost;
        std::unique_ptr<::DrakonDesktop::platform::PerceptrumRuntimeHost> m_runtimeHost;
        std::unique_ptr<::DrakonDesktop::platform::TrayIconHost> m_trayIconHost;
    };
}

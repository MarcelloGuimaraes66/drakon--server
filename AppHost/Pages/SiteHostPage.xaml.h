#pragma once

#include <cstdint>

namespace winrt::DrakonDesktop::implementation
{
    struct SiteHostPage : winrt::Microsoft::UI::Xaml::Controls::PageT<SiteHostPage>
    {
        SiteHostPage();
        SiteHostPage(winrt::hstring const& initialNavigationUrl, bool enableResidentRuntimeBridge);

        void InitializeComponent();

    private:
        void SetStatus(
            winrt::hstring const& title,
            winrt::hstring const& detail,
            bool isBusy,
            bool showOverlay);
        void UpdateNavigationButtons(
            winrt::Microsoft::UI::Xaml::Controls::WebView2 const& webView);
        winrt::fire_and_forget RevealLoadingOverlayAfterDelay(std::uint64_t navigationToken);
        winrt::fire_and_forget NavigateToLiveSite(bool forceReload);
        void OnPageLoaded(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnBackClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnReloadClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnOpenInBrowserClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnNavigationCompleted(
            winrt::Microsoft::UI::Xaml::Controls::WebView2 const& sender,
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2NavigationCompletedEventArgs const& args);
        void OnHistoryChanged(
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2 const& sender,
            winrt::Windows::Foundation::IInspectable const& args);
        void OnNavigationStarting(
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2 const& sender,
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2NavigationStartingEventArgs const& args);
        winrt::fire_and_forget InstallNativePairingBridge(
            winrt::Microsoft::UI::Xaml::Controls::WebView2 const& webView);
        void OnWebMessageReceived(
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2 const& sender,
            winrt::Microsoft::Web::WebView2::Core::CoreWebView2WebMessageReceivedEventArgs const& args);

        bool m_initialized{ false };
        bool m_navigationStarted{ false };
        bool m_navigationInFlight{ false };
        bool m_webViewHooksInstalled{ false };
        bool m_pairingBridgeInstalled{ false };
        bool m_pairingCompleted{ false };
        bool m_pairingRequested{ false };
        std::uint64_t m_navigationToken{ 0 };
        winrt::hstring m_initialNavigationUrl;
        bool m_enableResidentRuntimeBridge{ true };
    };
}

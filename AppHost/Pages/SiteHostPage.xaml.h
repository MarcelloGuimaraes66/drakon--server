#pragma once

namespace winrt::DrakonDesktop::implementation
{
    struct SiteHostPage : winrt::Microsoft::UI::Xaml::Controls::PageT<SiteHostPage>
    {
        SiteHostPage();

        void InitializeComponent();

    private:
        void SetStatus(
            winrt::hstring const& title,
            winrt::hstring const& detail,
            bool isBusy,
            bool showOverlay);
        void UpdateNavigationButtons(
            winrt::Microsoft::UI::Xaml::Controls::WebView2 const& webView);
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
        bool m_webViewHooksInstalled{ false };
        bool m_pairingBridgeInstalled{ false };
        bool m_pairingCompleted{ false };
        bool m_pairingRequested{ false };
    };
}

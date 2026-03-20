#pragma once

namespace winrt::DrakonDesktop::implementation
{
    struct LoginPage : winrt::Microsoft::UI::Xaml::Controls::PageT<LoginPage>
    {
        LoginPage();

        void InitializeComponent();

    private:
        void WireUpActions();
        void UpdateResponsiveState(double width);
        bool IsCompactMode() const;
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        winrt::fire_and_forget LoadInitialContextAsync();
        winrt::fire_and_forget OnLoginClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnSignupClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnUnavailableActionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnPageSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);
        bool m_initialized{ false };
    };
}

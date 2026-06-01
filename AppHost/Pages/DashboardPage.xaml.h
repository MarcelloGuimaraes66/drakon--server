#pragma once

namespace winrt::DrakonDesktop::implementation
{
    struct DashboardPage : winrt::Microsoft::UI::Xaml::Controls::PageT<DashboardPage>
    {
        DashboardPage();

        void InitializeComponent();

    private:
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        void SetNamedText(winrt::hstring const& elementName, winrt::hstring const& value);
        winrt::fire_and_forget LoadDashboardAsync(bool announceResult);
        void UpdateResponsiveState(double width);
        void OnPageSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);
        bool m_initialized{ false };
        bool m_loadedRemoteData{ false };
    };
}

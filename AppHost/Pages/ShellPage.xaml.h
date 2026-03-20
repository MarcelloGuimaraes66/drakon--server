#pragma once

#include "winrt/Microsoft.UI.Xaml.Controls.h"
#include "winrt/Microsoft.UI.Xaml.h"
#include "winrt/Microsoft.UI.Xaml.Navigation.h"

namespace winrt::DrakonDesktop::implementation
{
    struct ShellPage : winrt::Microsoft::UI::Xaml::Controls::PageT<ShellPage>
    {
        ShellPage();

        void InitializeComponent();

    private:
        void WireUpNavigation();
        void NavigateTo(winrt::hstring const& destination);
        void SetNamedText(winrt::hstring const& elementName, winrt::hstring const& value);
        void UpdateNavigationSelection(winrt::hstring const& destination);
        void ApplySidebarState(bool collapsed);
        void UpdateResponsiveState(double width);
        winrt::fire_and_forget LoadShellChromeAsync();
        void OnShellSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);
        void OnNavigationButtonClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSidebarToggleClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnLogoutClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);

        bool m_initialized{ false };
        bool m_userCollapsedSidebar{ false };
        bool m_effectiveSidebarCollapsed{ false };
        winrt::hstring m_currentDestination{ L"dashboard" };
        winrt::Microsoft::UI::Xaml::Controls::Frame m_contentFrame{ nullptr };
    };
}

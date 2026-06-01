#pragma once

#include "MainWindow.g.h"

namespace DrakonDesktop::platform
{
    void ConfigureMainWindowChrome();
    void UpdateMainWindowTheme(bool useLightTheme);
}

namespace winrt::DrakonDesktop::implementation
{
    struct MainWindow : MainWindowT<MainWindow>
    {
        MainWindow();
        MainWindow(winrt::hstring const& initialNavigationUrl);
        ~MainWindow();

        void InitializeComponent();
        void ConfigureWindowChrome();
        void ApplyHostTheme(Microsoft::UI::Xaml::ElementTheme theme);

    private:
        void ApplyChromeSurfaceColors(Microsoft::UI::Xaml::ElementTheme theme);
        void ApplyCaptionButtonColors(
            Microsoft::UI::Windowing::AppWindowTitleBar const& titleBar,
            Microsoft::UI::Xaml::ElementTheme theme);

        bool m_initialized{ false };
        bool m_windowChromeConfigured{ false };
        Microsoft::UI::Xaml::ElementTheme m_currentTheme{ Microsoft::UI::Xaml::ElementTheme::Dark };
        winrt::hstring m_initialNavigationUrl;
    };
}

namespace winrt::DrakonDesktop::factory_implementation
{
    struct MainWindow : MainWindowT<MainWindow, implementation::MainWindow>
    {
    };
}

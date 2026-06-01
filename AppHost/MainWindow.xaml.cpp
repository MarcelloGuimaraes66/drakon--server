#include "pch.h"
#include "BootstrapTrace.h"
#include "MainWindow.xaml.h"
#include "Pages\\SiteHostPage.xaml.h"
#include "winrt/Microsoft.UI.Xaml.Media.h"
#include <winrt/Microsoft.UI.Windowing.h>
#include <winrt/Windows.UI.h>
#include <algorithm>
#include <vector>
#if __has_include("MainWindow.g.cpp")
#include "MainWindow.g.cpp"
#endif

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Windowing;
using namespace Windows::UI;

namespace
{
    std::vector<winrt::DrakonDesktop::implementation::MainWindow*> g_mainWindows;

    Color MakeColor(std::uint8_t a, std::uint8_t r, std::uint8_t g, std::uint8_t b)
    {
        Color color{};
        color.A = a;
        color.R = r;
        color.G = g;
        color.B = b;
        return color;
    }

    Microsoft::UI::Xaml::Media::SolidColorBrush MakeBrush(Color const& color)
    {
        return Microsoft::UI::Xaml::Media::SolidColorBrush(color);
    }
}

namespace winrt::DrakonDesktop::implementation
{
    MainWindow::MainWindow()
        : MainWindow(winrt::hstring{})
    {
    }

    MainWindow::MainWindow(winrt::hstring const& initialNavigationUrl)
    {
        m_initialNavigationUrl = initialNavigationUrl;
        g_mainWindows.push_back(this);
        AppendBootstrapTrace("window: ctor");
        try
        {
            SystemBackdrop(Microsoft::UI::Xaml::Media::MicaBackdrop{});
            AppendBootstrapTrace("window: mica backdrop assigned");
        }
        catch (...)
        {
            AppendBootstrapTrace("window: mica backdrop unavailable");
        }
    }

    MainWindow::~MainWindow()
    {
        g_mainWindows.erase(
            std::remove(g_mainWindows.begin(), g_mainWindows.end(), this),
            g_mainWindows.end());
    }

    void MainWindow::InitializeComponent()
    {
        AppendBootstrapTrace("window: InitializeComponent enter");
        if (m_initialized)
        {
            AppendBootstrapTrace("window: InitializeComponent already initialized");
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///MainWindow.xaml" });

        auto const root = Content().as<FrameworkElement>();
        auto const enableResidentRuntimeBridge = m_initialNavigationUrl.empty();
        root.FindName(L"WindowContentHost")
            .as<Controls::Border>()
            .Child(make<DrakonDesktop::implementation::SiteHostPage>(
                m_initialNavigationUrl,
                enableResidentRuntimeBridge));
        m_initialized = true;
        ApplyHostTheme(m_currentTheme);
        AppendBootstrapTrace("window: InitializeComponent exit");
    }

    void MainWindow::ConfigureWindowChrome()
    {
        try
        {
            auto const appWindow = AppWindow();
            if (!appWindow)
            {
                AppendBootstrapTrace("window: AppWindow unavailable during chrome configuration");
                return;
            }

            auto const titleBar = appWindow.TitleBar();
            titleBar.ExtendsContentIntoTitleBar(true);
            titleBar.IconShowOptions(IconShowOptions::HideIconAndSystemMenu);
            titleBar.PreferredHeightOption(TitleBarHeightOption::Standard);

            ExtendsContentIntoTitleBar(true);
            auto const root = Content().try_as<FrameworkElement>();
            if (!root)
            {
                AppendBootstrapTrace("window: root unavailable during chrome configuration");
                return;
            }

            auto const appTitleBar = root.FindName(L"AppTitleBar").try_as<UIElement>();
            if (!appTitleBar)
            {
                AppendBootstrapTrace("window: AppTitleBar unavailable during chrome configuration");
                return;
            }

            SetTitleBar(appTitleBar);

            ApplyChromeSurfaceColors(m_currentTheme);
            ApplyCaptionButtonColors(titleBar, m_currentTheme);
            m_windowChromeConfigured = true;
            AppendBootstrapTrace("window: custom title bar configured");
        }
        catch (...)
        {
            AppendBootstrapTrace("window: custom title bar configuration failed");
        }
    }

    void MainWindow::ApplyHostTheme(ElementTheme theme)
    {
        m_currentTheme = theme;
        ApplyChromeSurfaceColors(theme);

        auto const root = Content().try_as<FrameworkElement>();
        if (root)
        {
            if (auto layoutRoot = root.FindName(L"WindowLayoutRoot").try_as<FrameworkElement>())
            {
                layoutRoot.RequestedTheme(theme);
            }
        }

        if (m_windowChromeConfigured)
        {
            try
            {
                ApplyCaptionButtonColors(AppWindow().TitleBar(), theme);
            }
            catch (...)
            {
                AppendBootstrapTrace("window: title bar theme application failed");
            }
        }
    }

    void MainWindow::ApplyChromeSurfaceColors(ElementTheme theme)
    {
        auto const isLight = theme == ElementTheme::Light;
        auto const headerBackground = isLight
            ? MakeColor(0xFF, 0xFD, 0xFD, 0xFD)
            : MakeColor(0xFF, 0x18, 0x18, 0x18);
        auto const windowBackground = isLight
            ? MakeColor(0xFF, 0xF5, 0xF7, 0xFB)
            : MakeColor(0xFF, 0x11, 0x11, 0x11);
        auto const borderColor = isLight
            ? MakeColor(0x14, 0x00, 0x00, 0x00)
            : MakeColor(0x66, 0x34, 0x34, 0x34);

        auto const root = Content().try_as<FrameworkElement>();
        if (!root)
        {
            return;
        }

        if (auto layoutRoot = root.FindName(L"WindowLayoutRoot").try_as<Controls::Grid>())
        {
            layoutRoot.Background(MakeBrush(windowBackground));
        }

        if (auto titleBarHost = root.FindName(L"AppTitleBarHost").try_as<Controls::Border>())
        {
            titleBarHost.Background(MakeBrush(headerBackground));
            titleBarHost.BorderBrush(MakeBrush(borderColor));
        }

        if (auto titleBarElement = root.FindName(L"AppTitleBar").try_as<Controls::TitleBar>())
        {
            titleBarElement.Background(MakeBrush(headerBackground));
        }
    }

    void MainWindow::ApplyCaptionButtonColors(
        AppWindowTitleBar const& titleBar,
        ElementTheme theme)
    {
        auto const isLight = theme == ElementTheme::Light;
        auto const background = isLight
            ? MakeColor(0xFF, 0xFD, 0xFD, 0xFD)
            : MakeColor(0xFF, 0x18, 0x18, 0x18);
        auto const inactiveBackground = isLight
            ? MakeColor(0xFF, 0xF7, 0xF8, 0xFA)
            : MakeColor(0xFF, 0x15, 0x15, 0x15);
        auto const foreground = isLight ? MakeColor(0xFF, 0x11, 0x11, 0x11) : MakeColor(0xFF, 0xEC, 0xEC, 0xEC);
        auto const inactiveForeground = isLight ? MakeColor(0x99, 0x11, 0x11, 0x11) : MakeColor(0x99, 0xEC, 0xEC, 0xEC);
        auto const hoverBackground = isLight ? MakeColor(0x14, 0x00, 0x00, 0x00) : MakeColor(0x20, 0xFF, 0xFF, 0xFF);
        auto const pressedBackground = isLight ? MakeColor(0x22, 0x00, 0x00, 0x00) : MakeColor(0x30, 0xFF, 0xFF, 0xFF);

        titleBar.BackgroundColor(background);
        titleBar.InactiveBackgroundColor(inactiveBackground);
        titleBar.ForegroundColor(foreground);
        titleBar.InactiveForegroundColor(inactiveForeground);

        titleBar.ButtonBackgroundColor(background);
        titleBar.ButtonInactiveBackgroundColor(inactiveBackground);
        titleBar.ButtonForegroundColor(foreground);
        titleBar.ButtonInactiveForegroundColor(inactiveForeground);
        titleBar.ButtonHoverBackgroundColor(hoverBackground);
        titleBar.ButtonPressedBackgroundColor(pressedBackground);
        titleBar.ButtonHoverForegroundColor(foreground);
        titleBar.ButtonPressedForegroundColor(foreground);
    }
}

namespace DrakonDesktop::platform
{
    void ConfigureMainWindowChrome()
    {
        for (auto* window : g_mainWindows)
        {
            if (window != nullptr)
            {
                window->ConfigureWindowChrome();
            }
        }
    }

    void UpdateMainWindowTheme(bool useLightTheme)
    {
        for (auto* window : g_mainWindows)
        {
            if (window != nullptr)
            {
                window->ApplyHostTheme(useLightTheme ? ElementTheme::Light : ElementTheme::Dark);
            }
        }
    }
}

#include "pch.h"
#include "DashboardPage.xaml.h"
#include "../Services/DrakonApiClient.h"

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;

namespace winrt::DrakonDesktop::implementation
{
    DashboardPage::DashboardPage()
    {
        InitializeComponent();
        SizeChanged({ this, &DashboardPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());
        LoadDashboardAsync(false);
    }

    void DashboardPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/DashboardPage.xaml" });

        m_initialized = true;
    }

    void DashboardPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"DashboardInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    void DashboardPage::SetNamedText(hstring const& elementName, hstring const& value)
    {
        if (auto text = FindName(elementName).try_as<TextBlock>())
        {
            text.Text(value);
        }
    }

    fire_and_forget DashboardPage::LoadDashboardAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing dashboard from /api/dashboard...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetDashboard()) dashboard{};
        if (auth.success && auth.value.isAuthenticated)
        {
            dashboard = services::DrakonApiClient::Instance().GetDashboard();
        }
        co_await uiThread;

        auto setAlertItem = [&](hstring const& titleName, hstring const& subtitleName, size_t index)
            {
                if (!dashboard.success || index >= dashboard.value.recentAlerts.size())
                {
                    return;
                }

                SetNamedText(titleName, to_hstring(dashboard.value.recentAlerts[index].title));
                SetNamedText(subtitleName, to_hstring(dashboard.value.recentAlerts[index].subtitle));
            };

        if (auth.success && auth.value.isAuthenticated)
        {
            if (dashboard.success)
            {
                auto camerasLabel = to_hstring(dashboard.value.camerasRunning) + L"/" + to_hstring(dashboard.value.camerasTotal);
                auto jobsLabel = to_hstring(dashboard.value.jobsRunning) + L"/" + to_hstring(dashboard.value.jobsTotal);

                SetNamedText(L"DesktopCamerasRunningValueText", camerasLabel);
                SetNamedText(L"DesktopJobsRunningValueText", jobsLabel);
                SetNamedText(L"DesktopStepsRunningValueText", to_hstring(dashboard.value.stepsRunning));
                SetNamedText(L"DesktopAgentsEnabledValueText", to_hstring(dashboard.value.agentsEnabledTotal));
                SetNamedText(L"DesktopDetections24hValueText", to_hstring(dashboard.value.detections24hTotal));
                SetNamedText(L"DesktopPendingCommandsValueText", to_hstring(dashboard.value.pendingCommands));
                SetNamedText(L"DesktopUnreadAlertsValueText", to_hstring(dashboard.value.unreadAlerts));

                SetNamedText(L"CompactCamerasRunningValueText", camerasLabel);
                SetNamedText(L"CompactJobsRunningValueText", jobsLabel);
                SetNamedText(L"CompactAgentsEnabledValueText", to_hstring(dashboard.value.agentsEnabledTotal));
                SetNamedText(L"CompactUnreadAlertsValueText", to_hstring(dashboard.value.unreadAlerts));

                setAlertItem(L"DesktopAlertOneTitleText", L"DesktopAlertOneSubtitleText", 0);
                setAlertItem(L"DesktopAlertTwoTitleText", L"DesktopAlertTwoSubtitleText", 1);
                setAlertItem(L"DesktopAlertThreeTitleText", L"DesktopAlertThreeSubtitleText", 2);
                setAlertItem(L"DesktopAlertFourTitleText", L"DesktopAlertFourSubtitleText", 3);
                setAlertItem(L"CompactAlertOneTitleText", L"CompactAlertOneSubtitleText", 0);
                setAlertItem(L"CompactAlertTwoTitleText", L"CompactAlertTwoSubtitleText", 1);

                m_loadedRemoteData = true;

                if (announceResult)
                {
                    ShowStatus(L"Dashboard synchronized from backend.", InfoBarSeverity::Success);
                }

                co_return;
            }

            if (dashboard.statusCode == 0)
            {
                if (announceResult || !m_loadedRemoteData)
                {
                    ShowStatus(
                        L"Dashboard backend unavailable. Keeping the current visual snapshot visible.",
                        InfoBarSeverity::Warning);
                }
                co_return;
            }

            ShowStatus(to_hstring(dashboard.error), InfoBarSeverity::Error);
            co_return;
        }

        if (announceResult)
        {
            ShowStatus(
                L"Dashboard requires an authenticated local Drakon session before loading backend metrics.",
                InfoBarSeverity::Warning);
        }
    }

    void DashboardPage::UpdateResponsiveState(double width)
    {
        auto desktop = FindName(L"DesktopLayout").try_as<FrameworkElement>();
        auto compact = FindName(L"CompactLayout").try_as<FrameworkElement>();

        if (!desktop || !compact)
        {
            return;
        }

        auto compactMode = width > 0 && width < 1260;
        desktop.Visibility(compactMode ? Visibility::Collapsed : Visibility::Visible);
        compact.Visibility(compactMode ? Visibility::Visible : Visibility::Collapsed);
    }

    void DashboardPage::OnPageSizeChanged(
        Windows::Foundation::IInspectable const&,
        SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }
}

#include "pch.h"
#include "SettingsPage.xaml.h"

#include <Windows.h>
#include <shellapi.h>
#include <winrt/Windows.ApplicationModel.DataTransfer.h>

#include <algorithm>
#include <chrono>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Windows::ApplicationModel::DataTransfer;

namespace
{
    bool TryLaunchUrl(std::wstring const& url)
    {
        auto result = reinterpret_cast<intptr_t>(ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        return result > 32;
    }

    int64_t SecondsUntilIsoUtc(std::string const& value)
    {
        if (value.size() < 19)
        {
            return -1;
        }

        try
        {
            SYSTEMTIME utc{};
            utc.wYear = static_cast<WORD>(std::stoi(value.substr(0, 4)));
            utc.wMonth = static_cast<WORD>(std::stoi(value.substr(5, 2)));
            utc.wDay = static_cast<WORD>(std::stoi(value.substr(8, 2)));
            utc.wHour = static_cast<WORD>(std::stoi(value.substr(11, 2)));
            utc.wMinute = static_cast<WORD>(std::stoi(value.substr(14, 2)));
            utc.wSecond = static_cast<WORD>(std::stoi(value.substr(17, 2)));

            FILETIME targetFileTime{};
            if (!SystemTimeToFileTime(&utc, &targetFileTime))
            {
                return -1;
            }

            FILETIME nowFileTime{};
            GetSystemTimeAsFileTime(&nowFileTime);

            ULARGE_INTEGER target{};
            target.LowPart = targetFileTime.dwLowDateTime;
            target.HighPart = targetFileTime.dwHighDateTime;

            ULARGE_INTEGER now{};
            now.LowPart = nowFileTime.dwLowDateTime;
            now.HighPart = nowFileTime.dwHighDateTime;

            auto diff100ns = static_cast<int64_t>(target.QuadPart - now.QuadPart);
            return diff100ns / 10000000LL;
        }
        catch (...)
        {
            return -1;
        }
    }

    std::wstring ToWide(std::string const& value)
    {
        return winrt::to_hstring(value).c_str();
    }

    int32_t ReadTaggedInt32(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }
        return 0;
    }
}

namespace winrt::DrakonDesktop::implementation
{
    SettingsPage::SettingsPage()
    {
        InitializeComponent();
        WireUpActions();
        ApplyActiveTab();
        m_pollTimer = DispatcherTimer();
        m_pollTimer.Interval(std::chrono::seconds(2));
        m_pollTimer.Tick({ this, &SettingsPage::OnPollTimerTick });
        m_pollTimer.Start();
        RefreshSettingsAsync(false);
    }

    void SettingsPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/SettingsPage.xaml" });

        m_initialized = true;
    }

    void SettingsPage::WireUpActions()
    {
        FindName(L"SettingsRefreshButton").as<Button>().Click({ this, &SettingsPage::OnRefreshClick });
        FindName(L"UserTabButton").as<Button>().Click({ this, &SettingsPage::OnTabClick });
        FindName(L"ApiKeysTabButton").as<Button>().Click({ this, &SettingsPage::OnTabClick });
        FindName(L"AlertsTabButton").as<Button>().Click({ this, &SettingsPage::OnTabClick });
        FindName(L"ConnectivityTabButton").as<Button>().Click({ this, &SettingsPage::OnTabClick });
        FindName(L"GeneratePairCodeButton").as<Button>().Click({ this, &SettingsPage::OnGeneratePairCodeClick });
        FindName(L"DisconnectExeButton").as<Button>().Click({ this, &SettingsPage::OnDisconnectExeClick });
        FindName(L"ToggleQuickInstructionsButton").as<Button>().Click({ this, &SettingsPage::OnToggleQuickInstructionsClick });
        FindName(L"CopyPairCodeButton").as<Button>().Click({ this, &SettingsPage::OnCopyPairCodeClick });
        FindName(L"CopyClientIdButton").as<Button>().Click({ this, &SettingsPage::OnCopyClientIdClick });
        FindName(L"CopyExeIdButton").as<Button>().Click({ this, &SettingsPage::OnCopyExeIdClick });
        FindName(L"OpenAiPortalButton").as<Button>().Click({ this, &SettingsPage::OnOpenAiPortalClick });
        FindName(L"ZAiPortalButton").as<Button>().Click({ this, &SettingsPage::OnZAiPortalClick });
        FindName(L"SaveOpenAiButton").as<Button>().Click({ this, &SettingsPage::OnSaveOpenAiClick });
        FindName(L"RemoveOpenAiButton").as<Button>().Click({ this, &SettingsPage::OnRemoveOpenAiClick });
        FindName(L"SaveZAiButton").as<Button>().Click({ this, &SettingsPage::OnSaveZAiClick });
        FindName(L"RemoveZAiButton").as<Button>().Click({ this, &SettingsPage::OnRemoveZAiClick });
        FindName(L"SaveTelegramButton").as<Button>().Click({ this, &SettingsPage::OnSaveTelegramClick });
    }

    void SettingsPage::ApplyActiveTab()
    {
        auto styles = Resources();
        auto activeStyle = styles.Lookup(box_value(L"SettingsTabButtonActiveStyle")).as<Style>();
        auto inactiveStyle = styles.Lookup(box_value(L"SettingsTabButtonStyle")).as<Style>();

        FindName(L"UserTabButton").as<Button>().Style(m_activeTab == SettingsSectionTab::User ? activeStyle : inactiveStyle);
        FindName(L"ApiKeysTabButton").as<Button>().Style(m_activeTab == SettingsSectionTab::ApiKeys ? activeStyle : inactiveStyle);
        FindName(L"AlertsTabButton").as<Button>().Style(m_activeTab == SettingsSectionTab::Alerts ? activeStyle : inactiveStyle);
        FindName(L"ConnectivityTabButton").as<Button>().Style(m_activeTab == SettingsSectionTab::Connectivity ? activeStyle : inactiveStyle);

        FindName(L"UserSettingsSection").as<FrameworkElement>().Visibility(
            m_activeTab == SettingsSectionTab::User ? Visibility::Visible : Visibility::Collapsed);
        FindName(L"ApiKeysSettingsSection").as<FrameworkElement>().Visibility(
            m_activeTab == SettingsSectionTab::ApiKeys ? Visibility::Visible : Visibility::Collapsed);
        FindName(L"AlertsSettingsSection").as<FrameworkElement>().Visibility(
            m_activeTab == SettingsSectionTab::Alerts ? Visibility::Visible : Visibility::Collapsed);
        FindName(L"ConnectivitySettingsSection").as<FrameworkElement>().Visibility(
            m_activeTab == SettingsSectionTab::Connectivity ? Visibility::Visible : Visibility::Collapsed);
    }

    void SettingsPage::SetText(hstring const& elementName, hstring const& value)
    {
        if (auto textBox = FindName(elementName).try_as<TextBox>())
        {
            textBox.Text(value);
            return;
        }

        if (auto text = FindName(elementName).try_as<TextBlock>())
        {
            text.Text(value);
        }
    }

    void SettingsPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"SettingsInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    void SettingsPage::CopyTextToClipboard(std::wstring const& value)
    {
        DataPackage package;
        package.SetText(value);
        Clipboard::SetContent(package);
        Clipboard::Flush();
    }

    void SettingsPage::UpdatePairCodeCountdown()
    {
        if (m_pairCode.empty() || m_pairExpiresAt.empty())
        {
            SetText(L"PairCodeExpiryText", L"");
            return;
        }

        auto secondsRemaining = SecondsUntilIsoUtc(m_pairExpiresAt);
        if (secondsRemaining < 0)
        {
            SetText(L"PairCodeExpiryText", to_hstring("Expires at " + m_pairExpiresAt));
            return;
        }

        if (secondsRemaining <= 0)
        {
            SetText(L"PairCodeExpiryText", L"Expired");
            return;
        }

        auto minutes = secondsRemaining / 60;
        auto seconds = secondsRemaining % 60;
        auto text = std::to_string(minutes) + ":" + (seconds < 10 ? "0" : "") + std::to_string(seconds);
        SetText(L"PairCodeExpiryText", to_hstring("Expires in " + text));
    }

    void SettingsPage::RenderState()
    {
        auto displayName = m_authState.displayName.empty() ? std::string("Local account") : m_authState.displayName;
        auto country = m_authState.countryCode.empty() ? std::string("-") : m_authState.countryCode;
        auto createdAt = m_authState.createdAt.empty() ? std::string("-") : m_authState.createdAt.substr(0, (std::min)(m_authState.createdAt.size(), static_cast<size_t>(10)));

        SetText(L"UserNameTextBox", to_hstring(displayName));
        SetText(L"UserEmailTextBox", to_hstring(m_authState.email.empty() ? std::string("-") : m_authState.email));
        SetText(L"UserCountryTextBox", to_hstring(country));
        SetText(L"UserCreatedAtTextBox", to_hstring(createdAt));

        auto statusDot = FindName(L"PairingStatusDot").as<Border>();
        auto statusText = FindName(L"PairingStatusText").as<TextBlock>();
        auto connectionDetails = FindName(L"ConnectionDetailsBorder").as<FrameworkElement>();
        auto pairCodeBorder = FindName(L"PairCodeBorder").as<FrameworkElement>();
        auto disconnectButton = FindName(L"DisconnectExeButton").as<Button>();
        auto quickInstructions = FindName(L"QuickInstructionsBorder").as<FrameworkElement>();
        quickInstructions.Visibility(m_quickInstructionsOpen ? Visibility::Visible : Visibility::Collapsed);

        auto connected = m_pairingStatus.status == "connected";
        statusDot.Background(Application::Current().Resources().Lookup(box_value(
            connected ? L"DrakonSuccessBrush" : L"DrakonMutedBrush")).as<Media::Brush>());
        statusText.Text(connected ? L"Connected" : L"Not connected");
        connectionDetails.Visibility(connected ? Visibility::Visible : Visibility::Collapsed);
        disconnectButton.IsEnabled(connected);

        if (connected)
        {
            SetText(L"PairingClientIdTextBlock", to_hstring(m_pairingStatus.clientId));
            SetText(L"PairingExeIdTextBlock", to_hstring(m_pairingStatus.exeId));
            SetText(L"PairingTimezoneTextBox", to_hstring(m_pairingStatus.timezoneIana.empty() ? std::string("-") : m_pairingStatus.timezoneIana));

            auto heartbeat = m_pairingStatus.lastSeenAgeSeconds <= 0
                ? std::string("fresh")
                : std::to_string(m_pairingStatus.lastSeenAgeSeconds) + " second(s) ago";
            SetText(L"PairingHeartbeatTextBox", to_hstring(heartbeat));
        }

        pairCodeBorder.Visibility(m_pairCode.empty() ? Visibility::Collapsed : Visibility::Visible);
        SetText(L"PairCodeValueText", to_hstring(m_pairCode.empty() ? std::string("------") : m_pairCode));
        UpdatePairCodeCountdown();

        auto zAiStatus = FindName(L"ZAiStatusText").as<TextBlock>();
        zAiStatus.Text(m_zAiSettings.hasKey ? L"Configured" : L"Not configured");
        SetText(L"ZAiPreviewTextBox", to_hstring(m_zAiSettings.hasKey ? m_zAiSettings.apiKeyPreview : std::string("No key configured")));

        auto openAiStatus = FindName(L"OpenAiStatusText").as<TextBlock>();
        openAiStatus.Text(m_openAiSettings.hasKey ? L"Configured" : L"Not configured");
        SetText(L"OpenAiPreviewTextBox", to_hstring(m_openAiSettings.hasKey ? m_openAiSettings.apiKeyPreview : std::string("No key configured")));

        auto telegramToggle = FindName(L"TelegramEnabledToggle").as<ToggleSwitch>();
        telegramToggle.IsOn(m_telegramSettings.enabled);
        SetText(L"TelegramChatIdTextBox", to_hstring(m_telegramSettings.chatId));
        FindName(L"TelegramBotTokenPasswordBox").as<PasswordBox>().Password(to_hstring(m_telegramSettings.botToken));

        ApplyActiveTab();
    }

    fire_and_forget SettingsPage::RefreshSettingsAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing settings from the authenticated backend session...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetPairingStatus()) pairing{};
        decltype(services::DrakonApiClient::Instance().GetOpenAiSettings()) openAi{};
        decltype(services::DrakonApiClient::Instance().GetZAiSettings()) zAi{};
        decltype(services::DrakonApiClient::Instance().GetTelegramSettings()) telegram{};

        if (auth.success && auth.value.isAuthenticated)
        {
            pairing = services::DrakonApiClient::Instance().GetPairingStatus();
            openAi = services::DrakonApiClient::Instance().GetOpenAiSettings();
            zAi = services::DrakonApiClient::Instance().GetZAiSettings();
            telegram = services::DrakonApiClient::Instance().GetTelegramSettings();
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (pairing.success) m_pairingStatus = pairing.value;
            if (openAi.success) m_openAiSettings = openAi.value;
            if (zAi.success) m_zAiSettings = zAi.value;
            if (telegram.success) m_telegramSettings = telegram.value;
            RenderState();

            if (announceResult)
            {
                ShowStatus(L"Settings synchronized from backend routes.", InfoBarSeverity::Success);
            }
            co_return;
        }

        RenderState();
        if (announceResult || !auth.success || !auth.value.isAuthenticated)
        {
            auto message = auth.error.empty()
                ? L"Settings requires an authenticated Drakon session."
                : L"Unable to validate settings session: " + to_hstring(auth.error);
            ShowStatus(message, InfoBarSeverity::Warning);
        }
    }

    fire_and_forget SettingsPage::PollPairingAsync()
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (!m_authState.isAuthenticated)
        {
            co_return;
        }

        co_await winrt::resume_background();
        auto pairing = services::DrakonApiClient::Instance().GetPairingStatus();
        co_await uiThread;

        if (pairing.success)
        {
            m_pairingStatus = pairing.value;
            if (m_pairingStatus.status == "connected")
            {
                m_pairCode.clear();
                m_pairExpiresAt.clear();
            }
            RenderState();
        }
    }

    fire_and_forget SettingsPage::OnGeneratePairCodeClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (!m_authState.isAuthenticated)
        {
            ShowStatus(L"Authenticate first on Login before generating a pair code.", InfoBarSeverity::Warning);
            co_return;
        }

        ShowStatus(L"Generating pair code through /api/pairing/generate...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().GeneratePairCode();
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        m_pairCode = response.value.pairCode;
        m_pairExpiresAt = response.value.expiresAt;
        RenderState();
        ShowStatus(L"Pair code generated. You can now copy it into the local runtime.", InfoBarSeverity::Success);
    }

    fire_and_forget SettingsPage::OnDisconnectExeClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        ShowStatus(L"Disconnecting the linked EXE...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().DisconnectPairing();
        auto pairing = response.success ? services::DrakonApiClient::Instance().GetPairingStatus() : services::ServiceValueResponse<services::PairingStatusSnapshot>{};
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        if (pairing.success)
        {
            m_pairingStatus = pairing.value;
        }
        m_pairCode.clear();
        m_pairExpiresAt.clear();
        RenderState();
        ShowStatus(L"The EXE pairing was disconnected.", InfoBarSeverity::Success);
    }

    void SettingsPage::OnToggleQuickInstructionsClick(IInspectable const&, RoutedEventArgs const&)
    {
        m_quickInstructionsOpen = !m_quickInstructionsOpen;
        RenderState();
    }

    void SettingsPage::OnCopyPairCodeClick(IInspectable const&, RoutedEventArgs const&)
    {
        if (m_pairCode.empty())
        {
            ShowStatus(L"There is no pair code available to copy.", InfoBarSeverity::Warning);
            return;
        }

        CopyTextToClipboard(ToWide(m_pairCode));
        ShowStatus(L"Pair code copied to the clipboard.", InfoBarSeverity::Success);
    }

    void SettingsPage::OnCopyClientIdClick(IInspectable const&, RoutedEventArgs const&)
    {
        if (m_pairingStatus.clientId.empty())
        {
            ShowStatus(L"There is no client ID available to copy.", InfoBarSeverity::Warning);
            return;
        }

        CopyTextToClipboard(ToWide(m_pairingStatus.clientId));
        ShowStatus(L"Client ID copied to the clipboard.", InfoBarSeverity::Success);
    }

    void SettingsPage::OnCopyExeIdClick(IInspectable const&, RoutedEventArgs const&)
    {
        if (m_pairingStatus.exeId.empty())
        {
            ShowStatus(L"There is no EXE ID available to copy.", InfoBarSeverity::Warning);
            return;
        }

        CopyTextToClipboard(ToWide(m_pairingStatus.exeId));
        ShowStatus(L"EXE ID copied to the clipboard.", InfoBarSeverity::Success);
    }

    void SettingsPage::OnOpenAiPortalClick(IInspectable const&, RoutedEventArgs const&)
    {
        if (!TryLaunchUrl(L"https://platform.openai.com/api-keys"))
        {
            ShowStatus(L"Windows could not open the OpenAI API keys page.", InfoBarSeverity::Error);
        }
    }

    void SettingsPage::OnZAiPortalClick(IInspectable const&, RoutedEventArgs const&)
    {
        if (!TryLaunchUrl(L"https://z.ai/manage-apikey/apikey-list"))
        {
            ShowStatus(L"Windows could not open the Z.ai API keys page.", InfoBarSeverity::Error);
        }
    }

    fire_and_forget SettingsPage::OnSaveOpenAiClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto password = winrt::to_string(FindName(L"OpenAiPasswordBox").as<PasswordBox>().Password());
        if (password.empty())
        {
            ShowStatus(L"Enter an OpenAI API key before saving.", InfoBarSeverity::Warning);
            co_return;
        }

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().SaveOpenAiSettings(password, false);
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        m_openAiSettings = response.value;
        FindName(L"OpenAiPasswordBox").as<PasswordBox>().Password(L"");
        RenderState();
        ShowStatus(L"OpenAI API key saved.", InfoBarSeverity::Success);
    }

    fire_and_forget SettingsPage::OnRemoveOpenAiClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().SaveOpenAiSettings(std::nullopt, true);
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        m_openAiSettings = response.value;
        FindName(L"OpenAiPasswordBox").as<PasswordBox>().Password(L"");
        RenderState();
        ShowStatus(L"OpenAI API key removed.", InfoBarSeverity::Success);
    }

    fire_and_forget SettingsPage::OnSaveZAiClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto password = winrt::to_string(FindName(L"ZAiPasswordBox").as<PasswordBox>().Password());
        if (password.empty())
        {
            ShowStatus(L"Enter a Z.ai API key before saving.", InfoBarSeverity::Warning);
            co_return;
        }

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().SaveZAiSettings(password, false);
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        m_zAiSettings = response.value;
        FindName(L"ZAiPasswordBox").as<PasswordBox>().Password(L"");
        RenderState();
        ShowStatus(L"Z.ai API key saved.", InfoBarSeverity::Success);
    }

    fire_and_forget SettingsPage::OnRemoveZAiClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().SaveZAiSettings(std::nullopt, true);
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        m_zAiSettings = response.value;
        FindName(L"ZAiPasswordBox").as<PasswordBox>().Password(L"");
        RenderState();
        ShowStatus(L"Z.ai API key removed.", InfoBarSeverity::Success);
    }

    fire_and_forget SettingsPage::OnSaveTelegramClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        services::TelegramSettings settings;
        settings.enabled = FindName(L"TelegramEnabledToggle").as<ToggleSwitch>().IsOn();
        settings.chatId = winrt::to_string(FindName(L"TelegramChatIdTextBox").as<TextBox>().Text());
        settings.botToken = winrt::to_string(FindName(L"TelegramBotTokenPasswordBox").as<PasswordBox>().Password());

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().SaveTelegramSettings(settings);
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        m_telegramSettings = response.value;
        RenderState();
        ShowStatus(L"Telegram settings saved.", InfoBarSeverity::Success);
    }

    void SettingsPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        RefreshSettingsAsync(true);
    }

    void SettingsPage::OnTabClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        switch (ReadTaggedInt32(sender))
        {
        case 1:
            m_activeTab = SettingsSectionTab::ApiKeys;
            break;
        case 2:
            m_activeTab = SettingsSectionTab::Alerts;
            break;
        case 3:
            m_activeTab = SettingsSectionTab::Connectivity;
            break;
        case 0:
        default:
            m_activeTab = SettingsSectionTab::User;
            break;
        }

        ApplyActiveTab();
    }

    void SettingsPage::OnPollTimerTick(IInspectable const&, IInspectable const&)
    {
        UpdatePairCodeCountdown();
        if (!m_pairCode.empty() || m_pairingStatus.status == "connected")
        {
            PollPairingAsync();
        }
    }
}

#pragma once

#include "../Services/DrakonApiClient.h"

namespace winrt::DrakonDesktop::implementation
{
    struct SettingsPage : winrt::Microsoft::UI::Xaml::Controls::PageT<SettingsPage>
    {
        SettingsPage();

        void InitializeComponent();

    private:
        enum class SettingsSectionTab
        {
            User = 0,
            Users = 1,
            ApiKeys = 2,
            Alerts = 3,
            Connectivity = 4,
        };

        void WireUpActions();
        void ApplyActiveTab();
        void UpdatePairCodeCountdown();
        void RenderState();
        void RenderAccountUsersSection();
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        void SetText(winrt::hstring const& elementName, winrt::hstring const& value);
        void CopyTextToClipboard(std::wstring const& value);
        winrt::fire_and_forget RefreshSettingsAsync(bool announceResult);
        winrt::fire_and_forget PollPairingAsync();
        winrt::fire_and_forget OnGeneratePairCodeClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnDisconnectExeClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnToggleQuickInstructionsClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCopyPairCodeClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCopyClientIdClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCopyExeIdClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnOpenAiPortalClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnZAiPortalClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnSaveOpenAiClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnRemoveOpenAiClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnSaveZAiClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnRemoveZAiClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnSaveTelegramClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnCreateAccountUserClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnManagedUserSelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        winrt::fire_and_forget OnSaveManagedUserClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnResetManagedUserPasswordClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnTabClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnPollTimerTick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Windows::Foundation::IInspectable const& args);

        bool m_initialized{ false };
        bool m_quickInstructionsOpen{ false };
        SettingsSectionTab m_activeTab{ SettingsSectionTab::User };
        services::AuthState m_authState{};
        services::ApiKeySettings m_openAiSettings{};
        services::ApiKeySettings m_zAiSettings{};
        services::TelegramSettings m_telegramSettings{};
        services::AccountUsersSnapshot m_accountUsers{};
        services::PairingStatusSnapshot m_pairingStatus{};
        std::string m_pairCode;
        std::string m_pairExpiresAt;
        std::string m_selectedManagedUserId;
        winrt::Microsoft::UI::Xaml::DispatcherTimer m_pollTimer{ nullptr };
    };
}

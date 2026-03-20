#pragma once

#include "../Services/DrakonApiClient.h"

namespace winrt::DrakonDesktop::implementation
{
    struct SettingsPage : winrt::Microsoft::UI::Xaml::Controls::PageT<SettingsPage>
    {
        SettingsPage();

        void InitializeComponent();

    private:
        void WireUpActions();
        void UpdatePairCodeCountdown();
        void RenderState();
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
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnPollTimerTick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Windows::Foundation::IInspectable const& args);

        bool m_initialized{ false };
        bool m_quickInstructionsOpen{ false };
        services::AuthState m_authState{};
        services::ApiKeySettings m_openAiSettings{};
        services::ApiKeySettings m_zAiSettings{};
        services::TelegramSettings m_telegramSettings{};
        services::PairingStatusSnapshot m_pairingStatus{};
        std::string m_pairCode;
        std::string m_pairExpiresAt;
        winrt::Microsoft::UI::Xaml::DispatcherTimer m_pollTimer{ nullptr };
    };
}

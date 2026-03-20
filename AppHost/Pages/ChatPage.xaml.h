#pragma once

#include "../Services/DrakonApiClient.h"
#include "CameraRecord.h"

#include <optional>
#include <vector>

namespace winrt::DrakonDesktop::implementation
{
    struct ChatPage : winrt::Microsoft::UI::Xaml::Controls::PageT<ChatPage>
    {
        ChatPage();

        void InitializeComponent();

    private:
        void InitializeFallbackData();
        void WireUpActions();
        void PopulateStaticSelectors();
        void PopulateCameraSelector();
        void UpdateResponsiveState(double width);
        void RenderSessions();
        void RenderMessages();
        void RenderConversationState();
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        std::optional<size_t> FindSessionIndex(int32_t sessionId) const;
        void NavigateToBilling();
        services::ChatSessionRecord const* ActiveSession() const;
        std::optional<int32_t> SelectedCameraId() const;
        services::ChatSendRequest BuildSendRequest() const;
        winrt::hstring PendingExecutionNotice() const;
        winrt::fire_and_forget RefreshChatAsync(bool announceResult);
        winrt::fire_and_forget LoadMessagesAsync(bool announceResult);
        winrt::fire_and_forget CreateSessionAsync();
        winrt::fire_and_forget RenameSessionAsync(int32_t sessionId);
        winrt::fire_and_forget DeleteSessionAsync(int32_t sessionId);
        winrt::fire_and_forget SendActiveMessageAsync();
        winrt::fire_and_forget CancelPendingAsync();
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnNewSessionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnRenameSessionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteSessionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSelectSessionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSendMessageClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCancelPendingClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnPageSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);
        void OnPollTimerTick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Windows::Foundation::IInspectable const& args);

        bool m_initialized{ false };
        bool m_loadedRemoteData{ false };
        bool m_usingLocalFallback{ true };
        int32_t m_nextLocalSessionId{ 801 };
        int32_t m_pollTick{ 0 };
        std::optional<int32_t> m_activeSessionId;
        winrt::Microsoft::UI::Xaml::DispatcherTimer m_pollTimer{ nullptr };
        services::AuthState m_authState{};
        services::TokenBalanceSnapshot m_tokenBalance{};
        services::PairingStatusSnapshot m_pairingStatus{};
        std::vector<services::ChatSessionRecord> m_sessions;
        std::vector<services::ChatMessageRecord> m_messages;
        std::vector<winrt::DrakonDesktop::CameraRecord> m_cameras;
    };
}

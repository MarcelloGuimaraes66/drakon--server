#pragma once

#include "../Services/DrakonApiClient.h"

namespace winrt::DrakonDesktop::implementation
{
    struct BillingPage : winrt::Microsoft::UI::Xaml::Controls::PageT<BillingPage>
    {
        BillingPage();

        void InitializeComponent();

    private:
        void WireUpActions();
        void UpdateResponsiveState(double width);
        void UpdateSelectionVisuals();
        void RenderPayments();
        void RenderCards();
        void RenderBillingState();
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        void SetText(winrt::hstring const& elementName, winrt::hstring const& value);
        bool CurrentPlanMatchesSelection() const;
        winrt::fire_and_forget RefreshBillingAsync(bool announceResult);
        winrt::fire_and_forget OnSubscribeClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnBuyTokensClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnManagePlansCardsClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnCancelSubscriptionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget OnRemoveCardClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnTierSelectionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSpeedSelectionClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCameraCountMinusClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCameraCountPlusClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnPageSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);

        bool m_initialized{ false };
        bool m_loadedRemoteData{ false };
        std::string m_selectedTier{ "plus" };
        int32_t m_selectedSecondsPerFrame{ 3 };
        int32_t m_cameraCount{ 1 };
        services::AuthState m_authState{};
        services::BillingStatus m_billingStatus{};
        services::TokenBalanceSnapshot m_tokenBalance{};
        services::SubscriptionSnapshot m_subscription{};
        std::vector<services::PaymentRecord> m_payments;
        std::vector<services::BillingCard> m_cards;
    };
}

#pragma once

#include "../Services/DrakonApiClient.h"

#include <optional>
#include <vector>

namespace winrt::DrakonDesktop::implementation
{
    struct DrakonFindPage : winrt::Microsoft::UI::Xaml::Controls::PageT<DrakonFindPage>
    {
        DrakonFindPage();

        void InitializeComponent();

    private:
        void InitializeFallbackData();
        void PopulateSelectors();
        void WireUpActions();
        void UpdateResponsiveState(double width);
        void UpdateMetrics();
        void RenderTargets();
        void RenderSelectedTarget();
        void RenderScope();
        void RenderSearches();
        void RenderHits();
        void RenderAudit();
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        std::vector<std::string> ParseSelectedStates() const;
        void SyncStateSelectionFromInput();
        std::optional<size_t> FindTargetIndex(int32_t targetId) const;
        services::DrakonFindTarget const* SelectedTarget() const;
        int32_t SelectedDurationSeconds() const;
        int32_t ActiveSearchCount() const;
        int32_t EffectiveEligibleCameraCount() const;
        int32_t IncludedOwnerCount() const;
        winrt::Microsoft::UI::Xaml::UIElement CreateTargetCard(services::DrakonFindTarget const& target) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateTargetImageCard(
            services::DrakonFindTargetImage const& image,
            bool canDelete) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateScopeStateCard(
            services::DrakonFindScopeStateSummary const& stateSummary) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateScopeCameraCard(
            services::DrakonFindScopeCameraPreview const& camera) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateSearchCard(services::DrakonFindSearch const& search) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateHitCard(services::DrakonFindHit const& hit) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateAuditCard(services::DrakonFindAuditLog const& audit) const;
        winrt::Windows::Foundation::IAsyncAction RefreshAllAsync(bool announceResult);
        winrt::fire_and_forget ResolveScopeAsync(bool announceResult);
        winrt::fire_and_forget CreateTargetAsync();
        winrt::fire_and_forget CreateSearchAsync();
        winrt::fire_and_forget DeleteTargetAsync(int32_t targetId);
        winrt::fire_and_forget DeleteTargetImageAsync(int32_t targetId, int32_t imageId);
        winrt::fire_and_forget CancelSearchAsync(int32_t searchId);
        winrt::fire_and_forget RetrySearchAsync(int32_t searchId);
        winrt::fire_and_forget DeleteSearchAsync(int32_t searchId);
        winrt::fire_and_forget DeleteHitAsync(int32_t hitId);
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCreateTargetClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnResolveScopeClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCreateSearchClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnStateSelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& args);
        void OnSelectTargetClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteTargetClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteTargetImageClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnToggleScopeCameraClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCancelSearchClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnRetrySearchClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteSearchClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteHitClick(
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
        int32_t m_pollTick{ 0 };
        std::string m_countryCode{ "BR" };
        winrt::Microsoft::UI::Xaml::DispatcherTimer m_pollTimer{ nullptr };
        services::AuthState m_authState{};
        std::vector<std::string> m_selectedStates;
        std::vector<int32_t> m_excludedCameraIds;
        std::optional<int32_t> m_selectedTargetId;
        std::vector<services::DrakonFindTarget> m_targets;
        std::vector<services::DrakonFindSearch> m_searches;
        std::vector<services::DrakonFindHit> m_hits;
        std::vector<services::DrakonFindAuditLog> m_audit;
        std::optional<services::DrakonFindScopeResolution> m_scope;
    };
}

#pragma once

#include "../Services/DrakonApiClient.h"

#include <optional>
#include <vector>

namespace winrt::DrakonDesktop::implementation
{
    struct JobsPage : winrt::Microsoft::UI::Xaml::Controls::PageT<JobsPage>
    {
        JobsPage();

        void InitializeComponent();

    private:
        void InitializeFallbackData();
        void WireUpActions();
        void UpdateResponsiveState(double width);
        void UpdateMetrics();
        void RenderJobs();
        void RenderSelectedJob();
        void RenderSteps();
        void PopulateSelectors();
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        void SetText(winrt::hstring const& elementName, winrt::hstring const& value);
        std::optional<size_t> FindJobIndex(int32_t jobId) const;
        services::JobRecord const* SelectedJob() const;
        void SyncEditorFromSelectedJob();
        int32_t ActiveJobsCount() const;
        int32_t RuntimeBusyJobsCount() const;
        winrt::Microsoft::UI::Xaml::UIElement CreateJobCard(services::JobRecord const& job) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateStepCard(services::JobStepRecord const& step) const;
        winrt::Windows::Foundation::IAsyncAction RefreshJobsAsync(bool announceResult);
        winrt::Windows::Foundation::IAsyncAction LoadStepsAsync(int32_t jobId, bool announceResult);
        winrt::fire_and_forget CreateJobAsync();
        winrt::fire_and_forget SaveSelectedJobAsync();
        winrt::fire_and_forget DeleteJobAsync(int32_t jobId);
        winrt::fire_and_forget StartJobAsync(int32_t jobId);
        winrt::fire_and_forget StopJobAsync(int32_t jobId);
        winrt::fire_and_forget CreateStepAsync();
        winrt::fire_and_forget DeleteStepAsync(int32_t stepId);
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCreateJobClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSaveSelectedJobClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnCreateStepClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnSelectJobClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteJobClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnStartJobClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnStopJobClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteStepClick(
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
        std::string m_globalTimezone{ "UTC" };
        winrt::Microsoft::UI::Xaml::DispatcherTimer m_pollTimer{ nullptr };
        services::AuthState m_authState{};
        std::optional<int32_t> m_selectedJobId;
        std::vector<services::JobRecord> m_jobs;
        std::vector<services::JobStepRecord> m_steps;
        std::vector<winrt::DrakonDesktop::CameraRecord> m_cameras;
    };
}

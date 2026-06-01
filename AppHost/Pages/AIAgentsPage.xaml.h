#pragma once

#include "CameraRecord.h"

#include <optional>
#include <vector>

namespace winrt::DrakonDesktop::implementation
{
    struct AIAgentsPage : winrt::Microsoft::UI::Xaml::Controls::PageT<AIAgentsPage>
    {
        AIAgentsPage();

        void InitializeComponent();

    private:
        void InitializeSampleData();
        void WireUpActions();
        void UpdateResponsiveState(double width);
        void RenderCards();
        std::vector<winrt::DrakonDesktop::CameraRecord> FilteredCameras() const;
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        std::optional<size_t> FindCameraIndex(int32_t cameraId) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateAddCameraCard() const;
        winrt::Microsoft::UI::Xaml::UIElement CreateCameraCard(winrt::DrakonDesktop::CameraRecord const& record) const;
        void NavigateToCameras();
        void NavigateToBilling();
        winrt::fire_and_forget LoadAgentsAsync(bool announceResult);
        winrt::fire_and_forget ToggleCameraRuntimeAsync(int32_t cameraId);
        void OnSearchChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& args);
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnOpenCamerasClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnToggleRuntimeClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnOpenEditorClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnAlgorithmsClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnPageSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);

        bool m_initialized{ false };
        bool m_loadedRemoteData{ false };
        bool m_usingLocalFallback{ true };
        int32_t m_cardsPerRow{ 3 };
        std::string m_searchTerm;
        std::vector<winrt::DrakonDesktop::CameraRecord> m_cameras;
    };
}

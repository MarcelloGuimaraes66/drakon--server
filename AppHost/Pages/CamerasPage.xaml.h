#pragma once

#include "CameraRecord.h"

#include <optional>
#include <vector>

namespace winrt::DrakonDesktop::implementation
{
    struct CamerasPage : winrt::Microsoft::UI::Xaml::Controls::PageT<CamerasPage>
    {
        CamerasPage();

        void InitializeComponent();

    private:
        void InitializeSampleData();
        void WireUpCommands();
        void UpdateResponsiveState(double width);
        void RenderCameraRows();
        void ApplyCameraCollection(std::vector<winrt::DrakonDesktop::CameraRecord> cameras);
        void ShowStatus(
            winrt::hstring const& message,
            winrt::Microsoft::UI::Xaml::Controls::InfoBarSeverity severity);
        std::optional<size_t> FindCameraIndex(int32_t cameraId) const;
        winrt::Microsoft::UI::Xaml::UIElement CreateDesktopRow(winrt::DrakonDesktop::CameraRecord const& record);
        winrt::Microsoft::UI::Xaml::UIElement CreateCompactCard(winrt::DrakonDesktop::CameraRecord const& record);
        winrt::fire_and_forget LoadRemoteCamerasAsync(bool announceResult);
        winrt::fire_and_forget BeginAddCameraAsync();
        void OnAddCameraClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnRefreshClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnEditCameraClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDeleteCameraClick(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        winrt::fire_and_forget ShowEditorAsync(std::optional<int32_t> cameraId);
        winrt::fire_and_forget ConfirmDeleteAsync(int32_t cameraId);
        void OnPageSizeChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::SizeChangedEventArgs const& args);

        bool m_initialized{ false };
        int32_t m_nextCameraId{ 100 };
        std::vector<winrt::DrakonDesktop::CameraRecord> m_cameras;
        bool m_loadedRemoteData{ false };
        bool m_usingLocalFallback{ true };
    };
}

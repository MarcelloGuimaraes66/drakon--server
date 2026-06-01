#pragma once

#include "CameraRecord.h"

#include <utility>

namespace winrt::DrakonDesktop::implementation
{
    struct CameraEditorDialog : winrt::Microsoft::UI::Xaml::Controls::UserControlT<CameraEditorDialog>
    {
        CameraEditorDialog();

        void InitializeComponent();
        void ConfigureForAdd();
        void ConfigureForEdit(winrt::DrakonDesktop::CameraRecord const& record);
        bool CommitIfValid();
        winrt::DrakonDesktop::CameraRecord Result() const;
        winrt::hstring DialogTitle() const;
        winrt::hstring DialogPrimaryButtonText() const;

    private:
        void ApplyRecordToControls(winrt::DrakonDesktop::CameraRecord const& record);
        void UpdateEditingState();
        void UpdateSubtypeState();
        void UpdateDescriptionCount();
        void UpdatePublicAccessBar();
        void ClearError();
        void SetError(winrt::hstring const& message);
        bool CurrentModeIsWebcam() const;
        bool Validate();
        void BuildResult();
        void SetSelectedComboBoxValue(
            winrt::Microsoft::UI::Xaml::Controls::ComboBox const& comboBox,
            winrt::hstring const& value,
            bool useTag = false);
        winrt::hstring GetSelectedComboBoxValue(
            winrt::Microsoft::UI::Xaml::Controls::ComboBox const& comboBox,
            bool useTag = false) const;
        std::pair<winrt::hstring, winrt::hstring> ParseDescription(winrt::hstring const& description) const;
        winrt::hstring BuildDescription(winrt::hstring const& label, winrt::hstring const& text) const;
        void OnManufacturerSelectionChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::SelectionChangedEventArgs const& args);
        winrt::fire_and_forget OnAllowPublicAccessChecked(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnAllowPublicAccessUnchecked(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::RoutedEventArgs const& args);
        void OnDescriptionTextChanged(
            winrt::Windows::Foundation::IInspectable const& sender,
            winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const& args);

        bool m_initialized{ false };
        bool m_isEditing{ false };
        bool m_internalPublicAccessChange{ false };
        bool m_publicAccessApproved{ false };
        winrt::hstring m_dialogTitle{ L"Add New Camera" };
        winrt::hstring m_primaryButtonText{ L"Add Camera" };
        winrt::DrakonDesktop::CameraRecord m_result{};
    };
}

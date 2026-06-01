#include "pch.h"
#include "CameraEditorDialog.xaml.h"

#include <algorithm>
#include <vector>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;

namespace
{
    std::string TrimCopy(std::string value)
    {
        auto const first = value.find_first_not_of(" \t\r\n");
        auto const last = value.find_last_not_of(" \t\r\n");
        if (first == std::string::npos || last == std::string::npos)
        {
            return {};
        }

        return value.substr(first, last - first + 1);
    }

    bool IsNullOrWhiteSpace(winrt::hstring const& value)
    {
        return TrimCopy(winrt::to_string(value)).empty();
    }

    Windows::Foundation::IReference<bool> BoxBool(bool value)
    {
        return box_value(value).as<Windows::Foundation::IReference<bool>>();
    }
}

namespace winrt::DrakonDesktop::implementation
{
    CameraEditorDialog::CameraEditorDialog()
    {
        InitializeComponent();

        FindName(L"ManufacturerComboBox").as<ComboBox>().SelectionChanged({ this, &CameraEditorDialog::OnManufacturerSelectionChanged });
        FindName(L"AllowPublicAccessCheckBox").as<CheckBox>().Checked({ this, &CameraEditorDialog::OnAllowPublicAccessChecked });
        FindName(L"AllowPublicAccessCheckBox").as<CheckBox>().Unchecked({ this, &CameraEditorDialog::OnAllowPublicAccessUnchecked });
        FindName(L"DescriptionTextBox").as<TextBox>().TextChanged({ this, &CameraEditorDialog::OnDescriptionTextChanged });
    }

    void CameraEditorDialog::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/CameraEditorDialog.xaml" });

        m_initialized = true;
    }

    void CameraEditorDialog::ConfigureForAdd()
    {
        m_isEditing = false;
        m_publicAccessApproved = false;
        m_result = {};
        m_result.connectionMethod = L"RTSP";
        m_result.retentionDays = 1;
        ApplyRecordToControls(m_result);
        UpdateEditingState();
        UpdateSubtypeState();
        UpdateDescriptionCount();
        UpdatePublicAccessBar();
        ClearError();
    }

    void CameraEditorDialog::ConfigureForEdit(DrakonDesktop::CameraRecord const& record)
    {
        m_isEditing = true;
        m_publicAccessApproved = record.allowPublicAccess;
        m_result = record;
        ApplyRecordToControls(record);
        UpdateEditingState();
        UpdateSubtypeState();
        UpdateDescriptionCount();
        UpdatePublicAccessBar();
        ClearError();
    }

    DrakonDesktop::CameraRecord CameraEditorDialog::Result() const
    {
        return m_result;
    }

    hstring CameraEditorDialog::DialogTitle() const
    {
        return m_dialogTitle;
    }

    hstring CameraEditorDialog::DialogPrimaryButtonText() const
    {
        return m_primaryButtonText;
    }

    bool CameraEditorDialog::CommitIfValid()
    {
        if (!Validate())
        {
            return false;
        }

        BuildResult();
        return true;
    }

    void CameraEditorDialog::ApplyRecordToControls(DrakonDesktop::CameraRecord const& record)
    {
        auto const isWebcam = record.IsWebcam();

        FindName(L"ModeTabs").as<TabView>().SelectedIndex(isWebcam ? 1 : 0);
        FindName(L"NameTextBox").as<TextBox>().Text(record.name);
        FindName(L"WebcamNameTextBox").as<TextBox>().Text(record.name);
        FindName(L"IpAddressTextBox").as<TextBox>().Text(record.ipAddress);
        FindName(L"RtspPortTextBox").as<TextBox>().Text(record.rtspPort);
        FindName(L"ChannelTextBox").as<TextBox>().Text(record.channel);
        FindName(L"SubtypeTextBox").as<TextBox>().Text(record.subtype);
        FindName(L"UsernameTextBox").as<TextBox>().Text(record.username);
        FindName(L"PasswordBox").as<PasswordBox>().Password(record.password);
        FindName(L"WebcamIndexNumberBox").as<NumberBox>().Value(record.webcamIndex.has_value() ? static_cast<double>(*record.webcamIndex) : -1.0);
        FindName(L"StreetTextBox").as<TextBox>().Text(record.street);
        FindName(L"NumberTextBox").as<TextBox>().Text(record.number);
        FindName(L"CityTextBox").as<TextBox>().Text(record.city);
        FindName(L"StateTextBox").as<TextBox>().Text(record.state);
        FindName(L"ZipCodeTextBox").as<TextBox>().Text(record.zipCode);
        FindName(L"CountryTextBox").as<TextBox>().Text(record.country);

        SetSelectedComboBoxValue(FindName(L"ManufacturerComboBox").as<ComboBox>(), record.manufacturer);
        SetSelectedComboBoxValue(
            FindName(L"ConnectionMethodComboBox").as<ComboBox>(),
            record.connectionMethod.empty() || record.connectionMethod == L"WEBCAM" ? L"RTSP" : record.connectionMethod);
        SetSelectedComboBoxValue(FindName(L"RetentionComboBox").as<ComboBox>(), to_hstring(record.retentionDays));

        m_internalPublicAccessChange = true;
        FindName(L"AllowPublicAccessCheckBox").as<CheckBox>().IsChecked(BoxBool(record.allowPublicAccess));
        m_internalPublicAccessChange = false;

        auto [label, text] = ParseDescription(record.description);
        SetSelectedComboBoxValue(FindName(L"DescriptionLabelComboBox").as<ComboBox>(), label, true);
        FindName(L"DescriptionTextBox").as<TextBox>().Text(text);
        FindName(L"AddressExpander").as<Expander>().IsExpanded(false);
    }

    void CameraEditorDialog::UpdateEditingState()
    {
        m_dialogTitle = m_isEditing ? hstring{ L"Edit Camera" } : hstring{ L"Add New Camera" };
        m_primaryButtonText = m_isEditing ? hstring{ L"Save Changes" } : hstring{ L"Add Camera" };
        FindName(L"ModeTabs").as<TabView>().IsEnabled(!m_isEditing);
        FindName(L"DescriptionSectionRoot").as<FrameworkElement>().Visibility(m_isEditing ? Visibility::Visible : Visibility::Collapsed);
    }

    void CameraEditorDialog::UpdateSubtypeState()
    {
        auto manufacturer = GetSelectedComboBoxValue(FindName(L"ManufacturerComboBox").as<ComboBox>());
        auto normalized = to_string(manufacturer);
        std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

        auto subtypeTextBox = FindName(L"SubtypeTextBox").as<TextBox>();
        auto const locked = normalized == "hikvision";
        subtypeTextBox.IsEnabled(!locked);
        subtypeTextBox.PlaceholderText(locked ? L"Locked for Hikvision" : L"0, 1, 2...");
        if (locked)
        {
            subtypeTextBox.Text(L"");
        }
    }

    void CameraEditorDialog::UpdateDescriptionCount()
    {
        auto description = FindName(L"DescriptionTextBox").as<TextBox>().Text();
        FindName(L"DescriptionCountText").as<TextBlock>().Text(to_hstring(description.size()) + L"/1900 characters");
    }

    void CameraEditorDialog::UpdatePublicAccessBar()
    {
        auto enabled = unbox_value_or<bool>(FindName(L"AllowPublicAccessCheckBox").as<CheckBox>().IsChecked(), false);
        auto infoBar = FindName(L"PublicAccessInfoBar").as<InfoBar>();
        infoBar.IsOpen(enabled);
    }

    void CameraEditorDialog::ClearError()
    {
        auto errorBar = FindName(L"DialogErrorBar").as<InfoBar>();
        errorBar.IsOpen(false);
        errorBar.Message(L"");
    }

    void CameraEditorDialog::SetError(hstring const& message)
    {
        auto errorBar = FindName(L"DialogErrorBar").as<InfoBar>();
        errorBar.Message(message);
        errorBar.IsOpen(true);
    }

    bool CameraEditorDialog::CurrentModeIsWebcam() const
    {
        return FindName(L"ModeTabs").as<TabView>().SelectedIndex() == 1;
    }

    bool CameraEditorDialog::Validate()
    {
        std::vector<hstring> missingFields;

        auto name = CurrentModeIsWebcam()
            ? FindName(L"WebcamNameTextBox").as<TextBox>().Text()
            : FindName(L"NameTextBox").as<TextBox>().Text();

        if (IsNullOrWhiteSpace(name)) missingFields.push_back(L"name");
        if (IsNullOrWhiteSpace(FindName(L"StreetTextBox").as<TextBox>().Text())) missingFields.push_back(L"street");
        if (IsNullOrWhiteSpace(FindName(L"NumberTextBox").as<TextBox>().Text())) missingFields.push_back(L"number");
        if (IsNullOrWhiteSpace(FindName(L"CityTextBox").as<TextBox>().Text())) missingFields.push_back(L"city");
        if (IsNullOrWhiteSpace(FindName(L"StateTextBox").as<TextBox>().Text())) missingFields.push_back(L"state");
        if (IsNullOrWhiteSpace(FindName(L"ZipCodeTextBox").as<TextBox>().Text())) missingFields.push_back(L"zip code");
        if (IsNullOrWhiteSpace(FindName(L"CountryTextBox").as<TextBox>().Text())) missingFields.push_back(L"country");

        if (CurrentModeIsWebcam())
        {
            if (FindName(L"WebcamIndexNumberBox").as<NumberBox>().Value() < 0)
            {
                missingFields.push_back(L"webcam index");
            }
        }
        else
        {
            if (IsNullOrWhiteSpace(FindName(L"IpAddressTextBox").as<TextBox>().Text())) missingFields.push_back(L"ip address");
            if (IsNullOrWhiteSpace(FindName(L"RtspPortTextBox").as<TextBox>().Text())) missingFields.push_back(L"rtsp port");
            if (GetSelectedComboBoxValue(FindName(L"ManufacturerComboBox").as<ComboBox>()).empty()) missingFields.push_back(L"manufacturer");
            if (GetSelectedComboBoxValue(FindName(L"ConnectionMethodComboBox").as<ComboBox>()).empty()) missingFields.push_back(L"connection method");
            if (IsNullOrWhiteSpace(FindName(L"UsernameTextBox").as<TextBox>().Text())) missingFields.push_back(L"username");
            if (IsNullOrWhiteSpace(FindName(L"PasswordBox").as<PasswordBox>().Password())) missingFields.push_back(L"password");
        }

        if (missingFields.empty())
        {
            ClearError();
            return true;
        }

        FindName(L"AddressExpander").as<Expander>().IsExpanded(true);

        hstring message = L"Required fields: ";
        for (uint32_t index = 0; index < missingFields.size(); ++index)
        {
            if (index > 0)
            {
                message = message + L", ";
            }
            message = message + missingFields[index];
        }

        SetError(message);
        return false;
    }

    void CameraEditorDialog::BuildResult()
    {
        auto result = m_result;
        result.name = CurrentModeIsWebcam()
            ? FindName(L"WebcamNameTextBox").as<TextBox>().Text()
            : FindName(L"NameTextBox").as<TextBox>().Text();
        result.street = FindName(L"StreetTextBox").as<TextBox>().Text();
        result.number = FindName(L"NumberTextBox").as<TextBox>().Text();
        result.city = FindName(L"CityTextBox").as<TextBox>().Text();
        result.state = FindName(L"StateTextBox").as<TextBox>().Text();
        result.zipCode = FindName(L"ZipCodeTextBox").as<TextBox>().Text();
        result.country = FindName(L"CountryTextBox").as<TextBox>().Text();
        result.retentionDays = GetSelectedComboBoxValue(FindName(L"RetentionComboBox").as<ComboBox>()).empty()
            ? 1
            : std::stoi(to_string(GetSelectedComboBoxValue(FindName(L"RetentionComboBox").as<ComboBox>())));
        result.allowPublicAccess = unbox_value_or<bool>(FindName(L"AllowPublicAccessCheckBox").as<CheckBox>().IsChecked(), false);

        if (CurrentModeIsWebcam())
        {
            result.connectionMethod = L"WEBCAM";
            result.manufacturer = L"Webcam";
            result.webcamIndex = static_cast<int32_t>(FindName(L"WebcamIndexNumberBox").as<NumberBox>().Value());
            result.ipAddress = L"";
            result.rtspPort = L"";
            result.username = L"";
            result.password = L"";
            result.channel = L"";
            result.subtype = L"";
        }
        else
        {
            result.connectionMethod = GetSelectedComboBoxValue(FindName(L"ConnectionMethodComboBox").as<ComboBox>());
            result.manufacturer = GetSelectedComboBoxValue(FindName(L"ManufacturerComboBox").as<ComboBox>());
            result.ipAddress = FindName(L"IpAddressTextBox").as<TextBox>().Text();
            result.rtspPort = FindName(L"RtspPortTextBox").as<TextBox>().Text();
            result.username = FindName(L"UsernameTextBox").as<TextBox>().Text();
            result.password = FindName(L"PasswordBox").as<PasswordBox>().Password();
            result.channel = FindName(L"ChannelTextBox").as<TextBox>().Text();
            result.subtype = FindName(L"SubtypeTextBox").as<TextBox>().Text();
            result.webcamIndex.reset();
        }

        if (m_isEditing)
        {
            result.description = BuildDescription(
                GetSelectedComboBoxValue(FindName(L"DescriptionLabelComboBox").as<ComboBox>(), true),
                FindName(L"DescriptionTextBox").as<TextBox>().Text());
        }
        else
        {
            result.description = L"";
        }

        m_result = result;
    }

    void CameraEditorDialog::SetSelectedComboBoxValue(ComboBox const& comboBox, hstring const& value, bool useTag)
    {
        for (uint32_t index = 0; index < comboBox.Items().Size(); ++index)
        {
            if (auto item = comboBox.Items().GetAt(index).try_as<ComboBoxItem>())
            {
                auto current = useTag ? unbox_value_or<hstring>(item.Tag(), L"") : unbox_value_or<hstring>(item.Content(), L"");
                if (current == value)
                {
                    comboBox.SelectedIndex(static_cast<int32_t>(index));
                    return;
                }
            }
        }

        comboBox.SelectedIndex(-1);
    }

    hstring CameraEditorDialog::GetSelectedComboBoxValue(ComboBox const& comboBox, bool useTag) const
    {
        if (auto item = comboBox.SelectedItem().try_as<ComboBoxItem>())
        {
            return useTag ? unbox_value_or<hstring>(item.Tag(), L"") : unbox_value_or<hstring>(item.Content(), L"");
        }

        return {};
    }

    std::pair<hstring, hstring> CameraEditorDialog::ParseDescription(hstring const& description) const
    {
        auto text = to_string(description);
        auto const labelMarker = text.find("LABEL:");
        auto const descriptionMarker = text.find("DESCRIPTION:");

        if (labelMarker == std::string::npos || descriptionMarker == std::string::npos || descriptionMarker <= labelMarker)
        {
            return { L"other_indoor", description };
        }

        auto label = TrimCopy(text.substr(labelMarker + 6, descriptionMarker - (labelMarker + 6)));
        auto body = TrimCopy(text.substr(descriptionMarker + 12));
        return { to_hstring(label.empty() ? "other_indoor" : label), to_hstring(body) };
    }

    hstring CameraEditorDialog::BuildDescription(hstring const& label, hstring const& text) const
    {
        if (IsNullOrWhiteSpace(label) && IsNullOrWhiteSpace(text))
        {
            return {};
        }

        return L"LABEL: " + label + L" DESCRIPTION: " + text;
    }

    void CameraEditorDialog::OnManufacturerSelectionChanged(
        Windows::Foundation::IInspectable const&,
        SelectionChangedEventArgs const&)
    {
        UpdateSubtypeState();
    }

    fire_and_forget CameraEditorDialog::OnAllowPublicAccessChecked(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        if (m_internalPublicAccessChange)
        {
            co_return;
        }

        auto lifetime = get_strong();

        if (!m_publicAccessApproved)
        {
            ContentDialog confirmDialog;
            confirmDialog.XamlRoot(XamlRoot());
            confirmDialog.RequestedTheme(ElementTheme::Dark);
            confirmDialog.Title(box_value(L"Enable public access"));
            confirmDialog.Content(box_value(L"This camera may become discoverable beyond private scope. Continue only if this is intended."));
            confirmDialog.PrimaryButtonText(L"Enable");
            confirmDialog.CloseButtonText(L"Cancel");

            auto result = co_await confirmDialog.ShowAsync();
            if (result != ContentDialogResult::Primary)
            {
                m_internalPublicAccessChange = true;
                FindName(L"AllowPublicAccessCheckBox").as<CheckBox>().IsChecked(BoxBool(false));
                m_internalPublicAccessChange = false;
                UpdatePublicAccessBar();
                co_return;
            }

            m_publicAccessApproved = true;
        }

        UpdatePublicAccessBar();
    }

    void CameraEditorDialog::OnAllowPublicAccessUnchecked(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        if (!m_internalPublicAccessChange)
        {
            m_publicAccessApproved = false;
        }

        UpdatePublicAccessBar();
    }

    void CameraEditorDialog::OnDescriptionTextChanged(
        Windows::Foundation::IInspectable const&,
        TextChangedEventArgs const&)
    {
        UpdateDescriptionCount();
    }
}

#include "pch.h"
#include "CameraEditorDialog.xaml.h"
#include "CamerasPage.xaml.h"
#include "../Services/DrakonApiClient.h"

#include <winrt/Microsoft.UI.Dispatching.h>

#include <algorithm>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;

namespace
{
    constexpr long HttpUnauthorized = 401;
    constexpr long HttpForbidden = 403;

    Brush LookupBrush(winrt::hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Brush>();
    }

    Style LookupStyle(winrt::hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Style>();
    }

    int32_t ReadTaggedCameraId(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }

        return 0;
    }

    bool IsSessionRejected(long statusCode)
    {
        return statusCode == HttpUnauthorized || statusCode == HttpForbidden;
    }
}

namespace winrt::DrakonDesktop::implementation
{
    CamerasPage::CamerasPage()
    {
        InitializeComponent();
        InitializeSampleData();
        WireUpCommands();
        RenderCameraRows();
        SizeChanged({ this, &CamerasPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());
        LoadRemoteCamerasAsync(false);
    }

    void CamerasPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/CamerasPage.xaml" });

        m_initialized = true;
    }

    void CamerasPage::InitializeSampleData()
    {
        m_cameras.clear();

        DrakonDesktop::CameraRecord gate04;
        gate04.id = 101;
        gate04.name = L"Gate 04";
        gate04.ipAddress = L"192.168.0.44";
        gate04.rtspPort = L"554";
        gate04.manufacturer = L"Hikvision";
        gate04.description = L"LABEL: street DESCRIPTION: acesso principal do perimetro";
        gate04.username = L"admin";
        gate04.password = L"admin123";
        gate04.channel = L"1";
        gate04.connectionMethod = L"RTSP";
        gate04.street = L"Main St";
        gate04.number = L"120";
        gate04.city = L"Manaus";
        gate04.state = L"AM";
        gate04.zipCode = L"69000-000";
        gate04.country = L"Brazil";
        gate04.retentionDays = 7;
        gate04.allowPublicAccess = false;
        gate04.isServiceRunning = true;
        m_cameras.push_back(gate04);

        DrakonDesktop::CameraRecord dock02;
        dock02.id = 102;
        dock02.name = L"Dock 02";
        dock02.ipAddress = L"192.168.0.87";
        dock02.rtspPort = L"554";
        dock02.manufacturer = L"Dahua";
        dock02.description = L"LABEL: warehouse DESCRIPTION: carga e descarga";
        dock02.username = L"operator";
        dock02.password = L"securepass";
        dock02.channel = L"201";
        dock02.subtype = L"1";
        dock02.connectionMethod = L"RTSP";
        dock02.street = L"Warehouse Ave";
        dock02.number = L"55";
        dock02.city = L"Manaus";
        dock02.state = L"AM";
        dock02.zipCode = L"69010-000";
        dock02.country = L"Brazil";
        dock02.retentionDays = 15;
        dock02.allowPublicAccess = true;
        dock02.isServiceRunning = false;
        m_cameras.push_back(dock02);

        DrakonDesktop::CameraRecord webcamLab;
        webcamLab.id = 103;
        webcamLab.name = L"Webcam Lab";
        webcamLab.manufacturer = L"Webcam";
        webcamLab.description = L"LABEL: office_room DESCRIPTION: bancada de testes";
        webcamLab.connectionMethod = L"WEBCAM";
        webcamLab.street = L"Lab Street";
        webcamLab.number = L"8";
        webcamLab.city = L"Manaus";
        webcamLab.state = L"AM";
        webcamLab.zipCode = L"69020-000";
        webcamLab.country = L"Brazil";
        webcamLab.retentionDays = 3;
        webcamLab.allowPublicAccess = false;
        webcamLab.isServiceRunning = true;
        webcamLab.webcamIndex = 0;
        m_cameras.push_back(webcamLab);

        m_nextCameraId = 104;
    }

    void CamerasPage::WireUpCommands()
    {
        FindName(L"DesktopAddButton").as<Button>().Click({ this, &CamerasPage::OnAddCameraClick });
        FindName(L"CompactAddButton").as<Button>().Click({ this, &CamerasPage::OnAddCameraClick });
        FindName(L"DesktopRefreshButton").as<Button>().Click({ this, &CamerasPage::OnRefreshClick });
        FindName(L"CompactRefreshButton").as<Button>().Click({ this, &CamerasPage::OnRefreshClick });
    }

    void CamerasPage::UpdateResponsiveState(double width)
    {
        auto desktop = FindName(L"DesktopLayout").try_as<FrameworkElement>();
        auto compact = FindName(L"CompactLayout").try_as<FrameworkElement>();

        if (!desktop || !compact)
        {
            return;
        }

        auto const compactMode = width > 0 && width < 1180;
        desktop.Visibility(compactMode ? Visibility::Collapsed : Visibility::Visible);
        compact.Visibility(compactMode ? Visibility::Visible : Visibility::Collapsed);
    }

    void CamerasPage::RenderCameraRows()
    {
        auto desktopRows = FindName(L"DesktopRowsHost").as<StackPanel>();
        auto compactCards = FindName(L"CompactCardsHost").as<StackPanel>();
        auto emptyState = FindName(L"EmptyStateBorder").as<Border>();
        auto desktopTable = FindName(L"DesktopTableBorder").as<Border>();

        desktopRows.Children().Clear();
        compactCards.Children().Clear();

        if (m_cameras.empty())
        {
            emptyState.Visibility(Visibility::Visible);
            desktopTable.Visibility(Visibility::Collapsed);
            return;
        }

        emptyState.Visibility(Visibility::Collapsed);
        desktopTable.Visibility(Visibility::Visible);

        auto sorted = m_cameras;
        std::stable_sort(
            sorted.begin(),
            sorted.end(),
            [](DrakonDesktop::CameraRecord const& left, DrakonDesktop::CameraRecord const& right)
            {
                if (left.isServiceRunning != right.isServiceRunning)
                {
                    return left.isServiceRunning > right.isServiceRunning;
                }

                return left.name < right.name;
            });

        for (size_t index = 0; index < sorted.size(); ++index)
        {
            desktopRows.Children().Append(CreateDesktopRow(sorted[index]));
            compactCards.Children().Append(CreateCompactCard(sorted[index]));

            if (index + 1 < sorted.size())
            {
                Border divider;
                divider.Height(1);
                divider.Background(LookupBrush(L"DrakonPanelBorderBrush"));
                desktopRows.Children().Append(divider);
            }
        }
    }

    void CamerasPage::ApplyCameraCollection(std::vector<winrt::DrakonDesktop::CameraRecord> cameras)
    {
        m_cameras = std::move(cameras);

        int32_t highestId = 100;
        for (auto const& record : m_cameras)
        {
            highestId = (std::max)(highestId, record.id);
        }

        m_nextCameraId = highestId + 1;
        RenderCameraRows();
    }

    void CamerasPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"CameraPageInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    std::optional<size_t> CamerasPage::FindCameraIndex(int32_t cameraId) const
    {
        for (size_t index = 0; index < m_cameras.size(); ++index)
        {
            if (m_cameras[index].id == cameraId)
            {
                return index;
            }
        }

        return std::nullopt;
    }

    UIElement CamerasPage::CreateDesktopRow(DrakonDesktop::CameraRecord const& record)
    {
        Grid row;
        row.Padding(ThicknessHelper::FromLengths(24, 18, 24, 18));
        row.ColumnSpacing(16);

        for (double width : { 1.5, 1.1, 1.0, 1.7, 0.9, 1.0 })
        {
            ColumnDefinition column;
            column.Width(GridLengthHelper::FromValueAndType(width, GridUnitType::Star));
            row.ColumnDefinitions().Append(column);
        }

        TextBlock name;
        name.Text(record.name);
        name.VerticalAlignment(VerticalAlignment::Center);
        row.Children().Append(name);

        TextBlock ip;
        ip.Text(record.ipAddress.empty() ? L"-" : record.ipAddress);
        ip.VerticalAlignment(VerticalAlignment::Center);
        Grid::SetColumn(ip, 1);
        row.Children().Append(ip);

        TextBlock manufacturer;
        manufacturer.Text(record.manufacturer);
        manufacturer.VerticalAlignment(VerticalAlignment::Center);
        Grid::SetColumn(manufacturer, 2);
        row.Children().Append(manufacturer);

        TextBlock description;
        description.Text(record.description.empty() ? L"-" : record.description);
        description.TextWrapping(TextWrapping::WrapWholeWords);
        description.VerticalAlignment(VerticalAlignment::Center);
        Grid::SetColumn(description, 3);
        row.Children().Append(description);

        Border statusBorder;
        statusBorder.Padding(ThicknessHelper::FromLengths(10, 6, 10, 6));
        statusBorder.CornerRadius(CornerRadiusHelper::FromRadii(999.0, 999.0, 999.0, 999.0));
        statusBorder.HorizontalAlignment(HorizontalAlignment::Left);
        statusBorder.Background(record.isServiceRunning ? LookupBrush(L"DrakonSuccessBrush") : LookupBrush(L"DrakonDangerBrush"));
        Grid::SetColumn(statusBorder, 4);

        TextBlock statusText;
        statusText.Text(record.isServiceRunning ? L"Online" : L"Offline");
        statusText.Foreground(LookupBrush(L"DrakonStrongTextBrush"));
        statusBorder.Child(statusText);
        row.Children().Append(statusBorder);

        StackPanel actions;
        actions.Orientation(Orientation::Horizontal);
        actions.Spacing(8);
        Grid::SetColumn(actions, 5);

        Button edit;
        edit.Content(box_value(L"Edit"));
        edit.Tag(box_value(record.id));
        edit.Click({ this, &CamerasPage::OnEditCameraClick });

        Button remove;
        remove.Content(box_value(L"Delete"));
        remove.Tag(box_value(record.id));
        remove.Click({ this, &CamerasPage::OnDeleteCameraClick });

        actions.Children().Append(edit);
        actions.Children().Append(remove);
        row.Children().Append(actions);

        return row;
    }

    UIElement CamerasPage::CreateCompactCard(DrakonDesktop::CameraRecord const& record)
    {
        Border card;
        card.Style(LookupStyle(L"DrakonPanelStyle"));

        StackPanel stack;
        stack.Spacing(12);

        TextBlock title;
        title.Text(record.name);
        title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));

        TextBlock subtitle;
        hstring descriptor = record.IsWebcam()
            ? hstring{ L"WEBCAM" }
            : record.ipAddress + L" • " + record.manufacturer;
        subtitle.Text(descriptor);
        subtitle.TextWrapping(TextWrapping::WrapWholeWords);
        subtitle.Style(LookupStyle(L"DrakonBodyTextStyle"));

        TextBlock description;
        description.Text(record.description.empty() ? L"-" : record.description);
        description.TextWrapping(TextWrapping::WrapWholeWords);
        description.Style(LookupStyle(L"DrakonCaptionTextStyle"));

        Border statusBorder;
        statusBorder.Padding(ThicknessHelper::FromLengths(10, 6, 10, 6));
        statusBorder.CornerRadius(CornerRadiusHelper::FromRadii(999.0, 999.0, 999.0, 999.0));
        statusBorder.HorizontalAlignment(HorizontalAlignment::Left);
        statusBorder.Background(record.isServiceRunning ? LookupBrush(L"DrakonSuccessBrush") : LookupBrush(L"DrakonDangerBrush"));

        TextBlock statusText;
        statusText.Text(record.isServiceRunning ? L"Online" : L"Offline");
        statusText.Foreground(LookupBrush(L"DrakonStrongTextBrush"));
        statusBorder.Child(statusText);

        Grid actions;
        actions.ColumnSpacing(8);
        actions.ColumnDefinitions().Append(ColumnDefinition{});
        actions.ColumnDefinitions().Append(ColumnDefinition{});
        actions.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        actions.ColumnDefinitions().GetAt(1).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));

        Button edit;
        edit.Content(box_value(L"Edit"));
        edit.Tag(box_value(record.id));
        edit.Click({ this, &CamerasPage::OnEditCameraClick });

        Button remove;
        remove.Content(box_value(L"Delete"));
        remove.Tag(box_value(record.id));
        remove.Click({ this, &CamerasPage::OnDeleteCameraClick });
        Grid::SetColumn(remove, 1);

        actions.Children().Append(edit);
        actions.Children().Append(remove);

        stack.Children().Append(title);
        stack.Children().Append(subtitle);
        stack.Children().Append(description);
        stack.Children().Append(statusBorder);
        stack.Children().Append(actions);
        card.Child(stack);

        return card;
    }

    fire_and_forget CamerasPage::LoadRemoteCamerasAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing camera list from /api/cameras...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetCameras()) camerasResponse{};

        if (auth.success && auth.value.isAuthenticated)
        {
            camerasResponse = services::DrakonApiClient::Instance().GetCameras();
        }

        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated)
        {
            if (camerasResponse.success)
            {
                ApplyCameraCollection(std::move(camerasResponse.value));
                m_loadedRemoteData = true;
                m_usingLocalFallback = false;

                if (announceResult)
                {
                    auto count = static_cast<int32_t>(m_cameras.size());
                    ShowStatus(
                        L"Camera list synchronized from backend. " + to_hstring(count) + L" camera(s) loaded.",
                        InfoBarSeverity::Success);
                }

                co_return;
            }

            if (camerasResponse.statusCode == 0)
            {
                m_usingLocalFallback = true;
                if (announceResult || !m_loadedRemoteData)
                {
                    ShowStatus(
                        L"Backend unavailable. Keeping local camera snapshot until /api/cameras responds again.",
                        InfoBarSeverity::Warning);
                }
                co_return;
            }

            ShowStatus(to_hstring(camerasResponse.error), InfoBarSeverity::Error);
            co_return;
        }

        m_usingLocalFallback = true;
        if (announceResult)
        {
            if (IsSessionRejected(auth.statusCode) || (auth.success && !auth.value.isAuthenticated))
            {
                ShowStatus(
                    L"Camera list requires an authenticated local Drakon session. Local dataset remains available for layout validation.",
                    InfoBarSeverity::Warning);
            }
            else
            {
                auto message = auth.error.empty()
                    ? L"Unable to validate session for /api/cameras. Local dataset remains active."
                    : L"Unable to validate session: " + to_hstring(auth.error);
                ShowStatus(message, InfoBarSeverity::Warning);
            }
        }
    }

    fire_and_forget CamerasPage::BeginAddCameraAsync()
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        ShowStatus(L"Opening camera form...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated)
        {
            ShowEditorAsync(std::nullopt);
            co_return;
        }

        ShowStatus(
            L"Camera form opened in local fallback mode because there is no authenticated Drakon web session yet.",
            InfoBarSeverity::Warning);
        ShowEditorAsync(std::nullopt);
    }

    void CamerasPage::OnAddCameraClick(IInspectable const&, RoutedEventArgs const&)
    {
        BeginAddCameraAsync();
    }

    void CamerasPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        LoadRemoteCamerasAsync(true);
    }

    void CamerasPage::OnEditCameraClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto const cameraId = ReadTaggedCameraId(sender);
        if (cameraId > 0)
        {
            ShowEditorAsync(cameraId);
        }
    }

    void CamerasPage::OnDeleteCameraClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto const cameraId = ReadTaggedCameraId(sender);
        if (cameraId > 0)
        {
            ConfirmDeleteAsync(cameraId);
        }
    }

    fire_and_forget CamerasPage::ShowEditorAsync(std::optional<int32_t> cameraId)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto editor = winrt::make_self<CameraEditorDialog>();

        if (cameraId.has_value())
        {
            auto index = FindCameraIndex(*cameraId);
            if (!index.has_value())
            {
                co_return;
            }

            editor->ConfigureForEdit(m_cameras[*index]);
        }
        else
        {
            editor->ConfigureForAdd();
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(editor->DialogTitle()));
        dialog.PrimaryButtonText(editor->DialogPrimaryButtonText());
        dialog.CloseButtonText(L"Cancel");
        dialog.DefaultButton(ContentDialogButton::Primary);
        dialog.Content(*editor);
        dialog.PrimaryButtonClick([editor](ContentDialog const&, ContentDialogButtonClickEventArgs const& args)
            {
                if (!editor->CommitIfValid())
                {
                    args.Cancel(true);
                }
            });

        auto result = co_await dialog.ShowAsync();
        if (result != ContentDialogResult::Primary)
        {
            co_return;
        }

        auto updated = editor->Result();
        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();

        std::optional<services::ServiceValueResponse<DrakonDesktop::CameraRecord>> mutationResponse;
        if (auth.success && auth.value.isAuthenticated)
        {
            mutationResponse = cameraId.has_value()
                ? services::DrakonApiClient::Instance().UpdateCamera(updated)
                : services::DrakonApiClient::Instance().CreateCamera(updated);
        }

        co_await uiThread;

        auto applyLocalMutation = [&]()
            {
                if (cameraId.has_value())
                {
                    auto index = FindCameraIndex(*cameraId);
                    if (index.has_value())
                    {
                        m_cameras[*index] = updated;
                        ShowStatus(
                            L"Camera updated in local fallback mode. Remote PATCH will be required for production parity.",
                            InfoBarSeverity::Warning);
                    }
                }
                else
                {
                    updated.id = m_nextCameraId++;
                    updated.isServiceRunning = true;
                    m_cameras.push_back(updated);
                    ShowStatus(
                        L"Camera added in local fallback mode. Remote POST will be required for full production behavior.",
                        InfoBarSeverity::Warning);
                }

                m_usingLocalFallback = true;
                RenderCameraRows();
            };

        if (auth.success && auth.value.isAuthenticated && mutationResponse.has_value())
        {
            if (mutationResponse->success)
            {
                auto remoteRecord = mutationResponse->value;
                auto index = cameraId.has_value() ? FindCameraIndex(*cameraId) : std::nullopt;

                if (cameraId.has_value() && index.has_value())
                {
                    m_cameras[*index] = remoteRecord;
                    ShowStatus(L"Camera updated through backend PATCH /api/cameras/{id}.", InfoBarSeverity::Success);
                }
                else
                {
                    m_cameras.push_back(remoteRecord);
                    ShowStatus(L"Camera created through backend POST /api/cameras.", InfoBarSeverity::Success);
                }

                m_usingLocalFallback = false;
                RenderCameraRows();
                co_return;
            }

            if (mutationResponse->statusCode == 0)
            {
                applyLocalMutation();
                co_return;
            }

            ShowStatus(to_hstring(mutationResponse->error), InfoBarSeverity::Error);
            co_return;
        }

        applyLocalMutation();
    }

    fire_and_forget CamerasPage::ConfirmDeleteAsync(int32_t cameraId)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto index = FindCameraIndex(cameraId);
        if (!index.has_value())
        {
            co_return;
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Delete camera"));
        dialog.Content(box_value(L"Are you sure you want to delete this camera?"));
        dialog.PrimaryButtonText(L"Delete");
        dialog.CloseButtonText(L"Cancel");

        auto result = co_await dialog.ShowAsync();
        if (result != ContentDialogResult::Primary)
        {
            co_return;
        }

        auto deletedName = m_cameras[*index].name;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        std::optional<services::ServiceResponse> deleteResponse;
        if (auth.success && auth.value.isAuthenticated)
        {
            deleteResponse = services::DrakonApiClient::Instance().DeleteCamera(cameraId);
        }
        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated && deleteResponse.has_value())
        {
            if (deleteResponse->success)
            {
                m_cameras.erase(m_cameras.begin() + static_cast<std::ptrdiff_t>(*index));
                m_usingLocalFallback = false;
                RenderCameraRows();
                ShowStatus(hstring{ L"Camera deleted through backend: " } + deletedName, InfoBarSeverity::Success);
                co_return;
            }

            if (deleteResponse->statusCode != 0)
            {
                ShowStatus(to_hstring(deleteResponse->error), InfoBarSeverity::Error);
                co_return;
            }
        }

        m_cameras.erase(m_cameras.begin() + static_cast<std::ptrdiff_t>(*index));
        m_usingLocalFallback = true;
        RenderCameraRows();
        ShowStatus(
            hstring{ L"Camera deleted in local fallback mode: " } + deletedName + L". Remote DELETE is still pending when backend access returns.",
            InfoBarSeverity::Warning);
    }

    void CamerasPage::OnPageSizeChanged(
        Windows::Foundation::IInspectable const&,
        SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }
}

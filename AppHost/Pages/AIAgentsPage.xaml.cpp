#include "pch.h"
#include "AIAgentsPage.xaml.h"
#include "BillingPage.xaml.h"
#include "CamerasPage.xaml.h"
#include "../Services/DrakonApiClient.h"

#include <algorithm>
#include <cctype>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;
using namespace Windows::Foundation;

namespace
{
    Brush LookupBrush(winrt::hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Brush>();
    }

    Style LookupStyle(winrt::hstring const& key)
    {
        return Application::Current().Resources().Lookup(box_value(key)).as<Style>();
    }

    std::string LowerAsciiAgents(std::string value)
    {
        std::transform(
            value.begin(),
            value.end(),
            value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    std::string NormalizeSearchToken(std::string value)
    {
        value = LowerAsciiAgents(value);
        value.erase(
            std::remove_if(
                value.begin(),
                value.end(),
                [](unsigned char ch) { return std::isspace(ch) != 0; }),
            value.end());
        return value;
    }

    int32_t ReadTaggedCameraId(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }

        return 0;
    }

    hstring CameraIdentity(winrt::DrakonDesktop::CameraRecord const& record)
    {
        auto ip = record.ipAddress.empty()
            ? std::wstring(L"Webcam / local capture")
            : std::wstring(record.ipAddress.c_str());
        if (!record.rtspPort.empty())
        {
            ip += L":" + std::wstring(record.rtspPort.c_str());
        }
        return hstring{ ip };
    }
}

namespace winrt::DrakonDesktop::implementation
{
    AIAgentsPage::AIAgentsPage()
    {
        InitializeComponent();
        InitializeSampleData();
        WireUpActions();
        RenderCards();
        SizeChanged({ this, &AIAgentsPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());
        LoadAgentsAsync(false);
    }

    void AIAgentsPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/AIAgentsPage.xaml" });

        m_initialized = true;
    }

    void AIAgentsPage::InitializeSampleData()
    {
        m_cameras.clear();

        DrakonDesktop::CameraRecord lobby;
        lobby.id = 301;
        lobby.name = L"Lobby Entrance";
        lobby.ipAddress = L"192.168.10.21";
        lobby.rtspPort = L"554";
        lobby.manufacturer = L"Hikvision";
        lobby.description = L"LABEL: entrance DESCRIPTION: fluxo principal de entrada";
        lobby.connectionMethod = L"RTSP";
        lobby.channel = L"1";
        lobby.subtype = L"1";
        lobby.isServiceRunning = true;
        lobby.retentionDays = 7;
        m_cameras.push_back(lobby);

        DrakonDesktop::CameraRecord corridor;
        corridor.id = 302;
        corridor.name = L"Warehouse Corridor";
        corridor.ipAddress = L"192.168.10.31";
        corridor.rtspPort = L"554";
        corridor.manufacturer = L"Dahua";
        corridor.description = L"LABEL: corridor DESCRIPTION: rota interna de movimentacao";
        corridor.connectionMethod = L"RTSP";
        corridor.channel = L"201";
        corridor.isServiceRunning = false;
        corridor.retentionDays = 15;
        m_cameras.push_back(corridor);

        DrakonDesktop::CameraRecord lab;
        lab.id = 303;
        lab.name = L"QA Webcam";
        lab.manufacturer = L"Webcam";
        lab.description = L"LABEL: office_room DESCRIPTION: bancada do laboratorio";
        lab.connectionMethod = L"WEBCAM";
        lab.webcamIndex = 0;
        lab.isServiceRunning = true;
        lab.retentionDays = 3;
        m_cameras.push_back(lab);
    }

    void AIAgentsPage::WireUpActions()
    {
        FindName(L"AgentSearchTextBox").as<TextBox>().TextChanged({ this, &AIAgentsPage::OnSearchChanged });
        FindName(L"CompactAgentSearchTextBox").as<TextBox>().TextChanged({ this, &AIAgentsPage::OnSearchChanged });
        FindName(L"RefreshAgentsButton").as<Button>().Click({ this, &AIAgentsPage::OnRefreshClick });
        FindName(L"CompactRefreshAgentsButton").as<Button>().Click({ this, &AIAgentsPage::OnRefreshClick });
        FindName(L"OpenCamerasButton").as<Button>().Click({ this, &AIAgentsPage::OnOpenCamerasClick });
        FindName(L"CompactOpenCamerasButton").as<Button>().Click({ this, &AIAgentsPage::OnOpenCamerasClick });
    }

    void AIAgentsPage::UpdateResponsiveState(double width)
    {
        auto desktopHeader = FindName(L"DesktopHeaderActions").try_as<FrameworkElement>();
        auto compactHeader = FindName(L"CompactHeaderActions").try_as<FrameworkElement>();

        if (desktopHeader && compactHeader)
        {
            auto const compactMode = width > 0 && width < 900;
            desktopHeader.Visibility(compactMode ? Visibility::Collapsed : Visibility::Visible);
            compactHeader.Visibility(compactMode ? Visibility::Visible : Visibility::Collapsed);
        }

        auto const newCardsPerRow = width > 0 && width < 760
            ? 1
            : width > 0 && width < 1280
            ? 2
            : 3;

        if (newCardsPerRow != m_cardsPerRow)
        {
            m_cardsPerRow = newCardsPerRow;
            RenderCards();
        }
    }

    std::vector<winrt::DrakonDesktop::CameraRecord> AIAgentsPage::FilteredCameras() const
    {
        auto filtered = m_cameras;
        auto normalizedSearch = NormalizeSearchToken(m_searchTerm);

        filtered.erase(
            std::remove_if(
                filtered.begin(),
                filtered.end(),
                [&](DrakonDesktop::CameraRecord const& record)
                {
                    if (normalizedSearch.empty())
                    {
                        return false;
                    }

                    auto haystack = NormalizeSearchToken(
                        to_string(record.name) +
                        to_string(record.manufacturer) +
                        to_string(record.description) +
                        to_string(record.ipAddress));

                    return haystack.find(normalizedSearch) == std::string::npos;
                }),
            filtered.end());

        std::stable_sort(
            filtered.begin(),
            filtered.end(),
            [](DrakonDesktop::CameraRecord const& left, DrakonDesktop::CameraRecord const& right)
            {
                if (left.isServiceRunning != right.isServiceRunning)
                {
                    return left.isServiceRunning > right.isServiceRunning;
                }

                return left.name < right.name;
            });

        return filtered;
    }

    void AIAgentsPage::RenderCards()
    {
        auto host = FindName(L"CardsRowsHost").as<StackPanel>();
        host.Children().Clear();

        std::vector<UIElement> cards;
        cards.push_back(CreateAddCameraCard());

        auto filtered = FilteredCameras();
        for (auto const& record : filtered)
        {
            cards.push_back(CreateCameraCard(record));
        }

        for (size_t index = 0; index < cards.size(); index += static_cast<size_t>(m_cardsPerRow))
        {
            Grid row;
            row.ColumnSpacing(16);

            for (int32_t column = 0; column < m_cardsPerRow; ++column)
            {
                ColumnDefinition definition;
                definition.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
                row.ColumnDefinitions().Append(definition);
            }

            for (int32_t column = 0; column < m_cardsPerRow; ++column)
            {
                auto cardIndex = index + static_cast<size_t>(column);
                if (cardIndex >= cards.size())
                {
                    break;
                }

                auto presenter = Border();
                presenter.HorizontalAlignment(HorizontalAlignment::Stretch);
                presenter.Child(cards[cardIndex]);
                Grid::SetColumn(presenter, column);
                row.Children().Append(presenter);
            }

            host.Children().Append(row);
        }
    }

    void AIAgentsPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"AgentsInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    std::optional<size_t> AIAgentsPage::FindCameraIndex(int32_t cameraId) const
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

    UIElement AIAgentsPage::CreateAddCameraCard() const
    {
        auto button = Button();
        button.HorizontalAlignment(HorizontalAlignment::Stretch);
        button.Padding(ThicknessHelper::FromUniformLength(0));

        auto border = Border();
        border.Background(LookupBrush(L"DrakonPanelAltBrush"));
        border.BorderBrush(LookupBrush(L"DrakonPanelBorderBrush"));
        border.BorderThickness(ThicknessHelper::FromUniformLength(1));
        border.CornerRadius(CornerRadiusHelper::FromUniformRadius(24));
        border.MinHeight(260);

        auto content = StackPanel();
        content.Padding(ThicknessHelper::FromLengths(24, 28, 24, 28));
        content.Spacing(14);
        content.HorizontalAlignment(HorizontalAlignment::Center);
        content.VerticalAlignment(VerticalAlignment::Center);

        auto iconBorder = Border();
        iconBorder.Width(72);
        iconBorder.Height(72);
        iconBorder.CornerRadius(CornerRadiusHelper::FromUniformRadius(20));
        iconBorder.Background(LookupBrush(L"DrakonPanelBrush"));
        iconBorder.BorderBrush(LookupBrush(L"DrakonPanelBorderBrush"));
        iconBorder.BorderThickness(ThicknessHelper::FromUniformLength(1));

        SymbolIcon plusIcon;
        plusIcon.Symbol(Symbol::Add);
        plusIcon.HorizontalAlignment(HorizontalAlignment::Center);
        plusIcon.VerticalAlignment(VerticalAlignment::Center);
        iconBorder.Child(plusIcon);

        auto title = TextBlock();
        title.Text(L"Add camera");
        title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));
        title.TextAlignment(TextAlignment::Center);

        auto body = TextBlock();
        body.Text(L"Same entry-point used by the web grid. New accounts can add cameras immediately and configure providers later.");
        body.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        body.TextAlignment(TextAlignment::Center);
        body.TextWrapping(TextWrapping::WrapWholeWords);

        content.Children().Append(iconBorder);
        content.Children().Append(title);
        content.Children().Append(body);
        border.Child(content);
        button.Content(border);
        button.Click({ const_cast<AIAgentsPage*>(this), &AIAgentsPage::OnOpenCamerasClick });
        return button;
    }

    UIElement AIAgentsPage::CreateCameraCard(winrt::DrakonDesktop::CameraRecord const& record) const
    {
        auto border = Border();
        border.Style(LookupStyle(L"DrakonPanelStyle"));

        auto root = StackPanel();
        root.Spacing(16);

        auto preview = Border();
        preview.MinHeight(170);
        preview.Background(record.isServiceRunning ? LookupBrush(L"DrakonPanelAltBrush") : LookupBrush(L"DrakonPanelBrush"));
        preview.CornerRadius(CornerRadiusHelper::FromUniformRadius(18));
        preview.BorderBrush(LookupBrush(L"DrakonPanelBorderBrush"));
        preview.BorderThickness(ThicknessHelper::FromUniformLength(1));

        auto previewGrid = Grid();

        auto previewIcon = SymbolIcon();
        previewIcon.Symbol(record.IsWebcam() ? Symbol::Video : Symbol::Camera);
        previewIcon.Width(46);
        previewIcon.Height(46);
        previewIcon.HorizontalAlignment(HorizontalAlignment::Center);
        previewIcon.VerticalAlignment(VerticalAlignment::Center);
        previewGrid.Children().Append(previewIcon);

        auto previewBadge = Border();
        previewBadge.HorizontalAlignment(HorizontalAlignment::Left);
        previewBadge.VerticalAlignment(VerticalAlignment::Top);
        previewBadge.Margin(ThicknessHelper::FromLengths(14, 14, 0, 0));
        previewBadge.Padding(ThicknessHelper::FromLengths(10, 6, 10, 6));
        previewBadge.Background(record.isServiceRunning ? LookupBrush(L"DrakonSuccessBrush") : LookupBrush(L"DrakonMutedBrush"));
        previewBadge.CornerRadius(CornerRadiusHelper::FromUniformRadius(999));

        auto previewBadgeText = TextBlock();
        previewBadgeText.Text(record.isServiceRunning ? L"Running" : L"Stopped");
        previewBadgeText.Foreground(LookupBrush(L"DrakonStrongTextBrush"));
        previewBadge.Child(previewBadgeText);
        previewGrid.Children().Append(previewBadge);
        preview.Child(previewGrid);

        auto titleRow = Grid();
        titleRow.ColumnSpacing(10);
        ColumnDefinition leftTitleColumn;
        ColumnDefinition rightTitleColumn;
        rightTitleColumn.Width(GridLengthHelper::Auto());
        titleRow.ColumnDefinitions().Append(leftTitleColumn);
        titleRow.ColumnDefinitions().Append(rightTitleColumn);

        auto titleStack = StackPanel();
        titleStack.Spacing(4);

        auto title = TextBlock();
        title.Text(record.name);
        title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));

        auto subtitle = TextBlock();
        subtitle.Text(record.manufacturer.empty() ? L"AI camera agent" : record.manufacturer);
        subtitle.Style(LookupStyle(L"DrakonCaptionTextStyle"));

        titleStack.Children().Append(title);
        titleStack.Children().Append(subtitle);

        auto status = Border();
        status.Width(14);
        status.Height(14);
        status.CornerRadius(CornerRadiusHelper::FromUniformRadius(7));
        status.Background(record.isServiceRunning ? LookupBrush(L"DrakonSuccessBrush") : LookupBrush(L"DrakonMutedBrush"));
        status.VerticalAlignment(VerticalAlignment::Top);

        titleRow.Children().Append(titleStack);
        Grid::SetColumn(status, 1);
        titleRow.Children().Append(status);

        auto infoStack = StackPanel();
        infoStack.Spacing(8);

        auto endpoint = TextBlock();
        endpoint.Text(CameraIdentity(record));
        endpoint.Style(LookupStyle(L"DrakonBodyTextStyle"));
        endpoint.TextWrapping(TextWrapping::WrapWholeWords);

        auto description = TextBlock();
        description.Text(record.description.empty() ? L"No description yet." : record.description);
        description.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        description.TextWrapping(TextWrapping::WrapWholeWords);

        auto retention = TextBlock();
        retention.Text(L"Retention: " + to_hstring(record.retentionDays) + L" day(s)");
        retention.Style(LookupStyle(L"DrakonCaptionTextStyle"));

        infoStack.Children().Append(endpoint);
        infoStack.Children().Append(description);
        infoStack.Children().Append(retention);

        auto actions = Grid();
        actions.RowSpacing(10);
        actions.ColumnSpacing(10);
        ColumnDefinition actionLeft;
        ColumnDefinition actionRight;
        actions.ColumnDefinitions().Append(actionLeft);
        actions.ColumnDefinitions().Append(actionRight);
        RowDefinition actionTop;
        RowDefinition actionBottom;
        actions.RowDefinitions().Append(actionTop);
        actions.RowDefinitions().Append(actionBottom);

        auto runtimeButton = Button();
        runtimeButton.Tag(box_value(record.id));
        runtimeButton.Content(record.isServiceRunning ? box_value(L"Stop") : box_value(L"Start"));
        if (!record.isServiceRunning)
        {
            runtimeButton.Style(LookupStyle(L"AccentButtonStyle"));
        }
        runtimeButton.Click({ const_cast<AIAgentsPage*>(this), &AIAgentsPage::OnToggleRuntimeClick });

        auto editButton = Button();
        editButton.Tag(box_value(record.id));
        editButton.Content(box_value(L"Open editor"));
        editButton.Click({ const_cast<AIAgentsPage*>(this), &AIAgentsPage::OnOpenEditorClick });

        auto algorithmsButton = Button();
        algorithmsButton.Tag(box_value(record.id));
        algorithmsButton.Content(box_value(L"Configure algorithms"));
        algorithmsButton.Click({ const_cast<AIAgentsPage*>(this), &AIAgentsPage::OnAlgorithmsClick });

        auto sourceText = TextBlock();
        sourceText.Text(record.IsWebcam() ? L"Source: WEBCAM" : L"Source: IP / RTSP");
        sourceText.Style(LookupStyle(L"DrakonCaptionTextStyle"));
        sourceText.VerticalAlignment(VerticalAlignment::Center);

        Grid::SetColumn(runtimeButton, 0);
        Grid::SetRow(runtimeButton, 0);
        Grid::SetColumn(editButton, 1);
        Grid::SetRow(editButton, 0);
        Grid::SetColumn(algorithmsButton, 0);
        Grid::SetRow(algorithmsButton, 1);
        Grid::SetColumnSpan(algorithmsButton, 2);
        Grid::SetColumn(sourceText, 1);
        Grid::SetRow(sourceText, 1);

        actions.Children().Append(runtimeButton);
        actions.Children().Append(editButton);
        actions.Children().Append(algorithmsButton);
        actions.Children().Append(sourceText);

        root.Children().Append(preview);
        root.Children().Append(titleRow);
        root.Children().Append(infoStack);
        root.Children().Append(actions);
        border.Child(root);
        return border;
    }

    void AIAgentsPage::NavigateToCameras()
    {
        if (auto frame = Parent().try_as<winrt::Microsoft::UI::Xaml::Controls::Frame>())
        {
            frame.Content(make<CamerasPage>());
            return;
        }

        ShowStatus(L"Unable to reach the shell frame for camera navigation.", InfoBarSeverity::Warning);
    }

    void AIAgentsPage::NavigateToBilling()
    {
        if (auto frame = Parent().try_as<winrt::Microsoft::UI::Xaml::Controls::Frame>())
        {
            frame.Content(make<BillingPage>());
            return;
        }

        ShowStatus(L"Unable to reach the shell frame for billing navigation.", InfoBarSeverity::Warning);
    }

    fire_and_forget AIAgentsPage::LoadAgentsAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing AI agents from /api/cameras...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetCameras()) cameras{};

        if (auth.success && auth.value.isAuthenticated)
        {
            cameras = services::DrakonApiClient::Instance().GetCameras();
        }

        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated)
        {
            if (cameras.success)
            {
                m_cameras = std::move(cameras.value);
                m_loadedRemoteData = true;
                m_usingLocalFallback = false;
                RenderCards();

                if (announceResult)
                {
                    ShowStatus(
                        L"AI agents synchronized from backend. " + to_hstring(m_cameras.size()) + L" camera(s) loaded.",
                        InfoBarSeverity::Success);
                }

                co_return;
            }

            if (cameras.statusCode == 0)
            {
                m_usingLocalFallback = true;
                if (announceResult || !m_loadedRemoteData)
                {
                    ShowStatus(
                        L"Backend unavailable. Keeping the local AI agents snapshot visible.",
                        InfoBarSeverity::Warning);
                }
                co_return;
            }

            ShowStatus(to_hstring(cameras.error), InfoBarSeverity::Error);
            co_return;
        }

        m_usingLocalFallback = true;
        if (announceResult)
        {
            ShowStatus(
                L"AI agents require an authenticated local Drakon session before loading backend cameras.",
                InfoBarSeverity::Warning);
        }
    }

    fire_and_forget AIAgentsPage::ToggleCameraRuntimeAsync(int32_t cameraId)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        auto index = FindCameraIndex(cameraId);
        if (!index.has_value())
        {
            co_return;
        }

        auto nextRunning = !m_cameras[*index].isServiceRunning;

        ShowStatus(
            nextRunning
                ? L"Starting AI agent runtime through the authenticated backend session..."
                : L"Stopping AI agent runtime through /api/commands...",
            InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();

        decltype(services::DrakonApiClient::Instance().StartCamera(cameraId)) startResponse{};
        decltype(services::DrakonApiClient::Instance().EnqueueCommand("", std::nullopt, "")) stopResponse{};

        if (auth.success && auth.value.isAuthenticated)
        {
            if (nextRunning)
            {
                startResponse = services::DrakonApiClient::Instance().StartCamera(cameraId);
            }
            else
            {
                stopResponse = services::DrakonApiClient::Instance().EnqueueCommand(
                    "stop_camera",
                    cameraId,
                    std::string("{\"camera_id\":") + std::to_string(cameraId) + "}");
            }
        }

        co_await uiThread;

        auto applyLocalState = [&]()
            {
                m_cameras[*index].isServiceRunning = nextRunning;
                m_usingLocalFallback = true;
                RenderCards();
            };

        if (auth.success && auth.value.isAuthenticated)
        {
            if (nextRunning)
            {
                if (startResponse.success)
                {
                    m_cameras[*index].isServiceRunning = true;
                    m_usingLocalFallback = false;
                    RenderCards();
                    if (startResponse.value.agentsDisabledNoSubscription)
                    {
                        ShowStatus(
                            L"Start request was accepted, but the backend skipped one or more agents for this camera. Review provider and agent settings if detections do not start.",
                            InfoBarSeverity::Warning);
                    }
                    else
                    {
                        ShowStatus(L"AI agent start command queued successfully.", InfoBarSeverity::Success);
                    }
                    co_return;
                }

                if (startResponse.statusCode == 0)
                {
                    applyLocalState();
                    ShowStatus(
                        L"Backend was offline, so the start state was flipped locally for continuity.",
                        InfoBarSeverity::Warning);
                    co_return;
                }

                ShowStatus(to_hstring(startResponse.error), InfoBarSeverity::Error);
                co_return;
            }

            if (stopResponse.success)
            {
                m_cameras[*index].isServiceRunning = false;
                m_usingLocalFallback = false;
                RenderCards();
                ShowStatus(L"Stop command queued in /api/commands.", InfoBarSeverity::Success);
                co_return;
            }

            if (stopResponse.statusCode == 0)
            {
                applyLocalState();
                ShowStatus(
                    L"Backend was offline, so the stop state was flipped locally for continuity.",
                    InfoBarSeverity::Warning);
                co_return;
            }

            ShowStatus(to_hstring(stopResponse.error), InfoBarSeverity::Error);
            co_return;
        }

        applyLocalState();
        ShowStatus(
            nextRunning
                ? L"AI agent started in local fallback mode because there is no authenticated web session yet."
                : L"AI agent stopped in local fallback mode because there is no authenticated web session yet.",
            InfoBarSeverity::Warning);
    }

    void AIAgentsPage::OnSearchChanged(IInspectable const& sender, TextChangedEventArgs const&)
    {
        auto textBox = sender.as<TextBox>();
        m_searchTerm = to_string(textBox.Text());

        auto desktopSearch = FindName(L"AgentSearchTextBox").as<TextBox>();
        auto compactSearch = FindName(L"CompactAgentSearchTextBox").as<TextBox>();

        if (desktopSearch != textBox && desktopSearch.Text() != textBox.Text())
        {
            desktopSearch.Text(textBox.Text());
        }
        if (compactSearch != textBox && compactSearch.Text() != textBox.Text())
        {
            compactSearch.Text(textBox.Text());
        }

        RenderCards();
    }

    void AIAgentsPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        LoadAgentsAsync(true);
    }

    void AIAgentsPage::OnOpenCamerasClick(IInspectable const&, RoutedEventArgs const&)
    {
        NavigateToCameras();
    }

    void AIAgentsPage::OnToggleRuntimeClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto cameraId = ReadTaggedCameraId(sender);
        if (cameraId > 0)
        {
            ToggleCameraRuntimeAsync(cameraId);
        }
    }

    void AIAgentsPage::OnOpenEditorClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto cameraId = ReadTaggedCameraId(sender);
        ShowStatus(
            cameraId > 0
                ? L"Opening the native Cameras editor for camera #" + to_hstring(cameraId) + L"."
                : L"Opening the native Cameras editor.",
            InfoBarSeverity::Informational);
        NavigateToCameras();
    }

    void AIAgentsPage::OnAlgorithmsClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto cameraId = ReadTaggedCameraId(sender);
        ShowStatus(
            cameraId > 0
                ? L"Algorithm configuration for camera #" + to_hstring(cameraId) + L" is the next pending conversion slice."
                : L"Algorithm configuration is the next pending conversion slice.",
            InfoBarSeverity::Warning);
    }

    void AIAgentsPage::OnPageSizeChanged(IInspectable const&, SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }
}

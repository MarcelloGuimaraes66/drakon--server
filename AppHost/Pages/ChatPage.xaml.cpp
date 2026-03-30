#include "pch.h"
#include "BillingPage.xaml.h"
#include "ChatPage.xaml.h"

#include <algorithm>
#include <chrono>
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

    int32_t ReadTaggedSessionId(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }

        return 0;
    }

    std::string LowerAsciiChat(std::string value)
    {
        std::transform(
            value.begin(),
            value.end(),
            value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    std::string DisplaySessionTitle(winrt::DrakonDesktop::services::ChatSessionRecord const& session)
    {
        if (!session.title.empty())
        {
            return session.title;
        }

        return "Untitled chat";
    }

    std::string FormatTimestamp(std::string value)
    {
        if (value.size() >= 16)
        {
            return value.substr(0, 16);
        }
        return value;
    }

    std::string RoleLabel(std::string role)
    {
        role = LowerAsciiChat(std::move(role));

        if (role == "assistant")
        {
            return "Assistant";
        }
        if (role == "system")
        {
            return "System";
        }
        return "User";
    }
}

namespace winrt::DrakonDesktop::implementation
{
    ChatPage::ChatPage()
    {
        InitializeComponent();
        InitializeFallbackData();
        WireUpActions();
        PopulateStaticSelectors();
        PopulateCameraSelector();
        RenderSessions();
        RenderMessages();
        RenderConversationState();
        SizeChanged({ this, &ChatPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());

        m_pollTimer = DispatcherTimer();
        m_pollTimer.Interval(std::chrono::seconds(3));
        m_pollTimer.Tick({ this, &ChatPage::OnPollTimerTick });
        m_pollTimer.Start();

        RefreshChatAsync(false);
    }

    void ChatPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/ChatPage.xaml" });

        m_initialized = true;
    }

    void ChatPage::InitializeFallbackData()
    {
        m_sessions.clear();
        m_messages.clear();
        m_cameras.clear();

        services::ChatSessionRecord first;
        first.id = 701;
        first.title = "Night shift review";
        first.createdAt = "2026-03-18T10:12:00Z";
        first.updatedAt = "2026-03-18T10:14:00Z";
        m_sessions.push_back(first);

        services::ChatSessionRecord second;
        second.id = 702;
        second.title = "Entrance incident analysis";
        second.createdAt = "2026-03-18T09:05:00Z";
        second.updatedAt = "2026-03-18T09:33:00Z";
        m_sessions.push_back(second);

        services::ChatMessageRecord firstMessage;
        firstMessage.id = 1;
        firstMessage.role = "user";
        firstMessage.content = "Summarize the last detections from the entrance camera.";
        firstMessage.createdAt = "2026-03-18T10:12:10Z";
        firstMessage.updatedAt = firstMessage.createdAt;
        m_messages.push_back(firstMessage);

        services::ChatMessageRecord secondMessage;
        secondMessage.id = 2;
        secondMessage.role = "assistant";
        secondMessage.content = "Fallback mode summary: three motion events were detected near the entrance between 10:00 and 10:10. Remote orchestration will replace this with the live backend answer when authenticated.";
        secondMessage.createdAt = "2026-03-18T10:12:18Z";
        secondMessage.updatedAt = secondMessage.createdAt;
        secondMessage.tokensUsed = 1560;
        m_messages.push_back(secondMessage);

        DrakonDesktop::CameraRecord entrance;
        entrance.id = 301;
        entrance.name = L"Lobby Entrance";
        entrance.ipAddress = L"192.168.10.21";
        entrance.manufacturer = L"Hikvision";
        entrance.connectionMethod = L"RTSP";
        entrance.isServiceRunning = true;
        m_cameras.push_back(entrance);

        DrakonDesktop::CameraRecord corridor;
        corridor.id = 302;
        corridor.name = L"Warehouse Corridor";
        corridor.ipAddress = L"192.168.10.31";
        corridor.manufacturer = L"Dahua";
        corridor.connectionMethod = L"RTSP";
        corridor.isServiceRunning = false;
        m_cameras.push_back(corridor);

        m_activeSessionId = first.id;
        m_tokenBalance.inputBalance = 2'500'000;
        m_tokenBalance.outputBalance = 2'400'000;
        m_tokenBalance.balance = 4'900'000;
        m_pairingStatus.status = "connected";
        m_pairingStatus.chatEffectiveStatus = "connected";
        m_pairingStatus.isAvailableForChat = true;
        m_pairingStatus.clientId = "local-fallback-client";
        m_pairingStatus.exeId = "local-fallback-exe";
        m_pairingStatus.lastSeenAgeSeconds = 2;
        m_nextLocalSessionId = 703;
    }

    void ChatPage::WireUpActions()
    {
        FindName(L"RefreshChatButton").as<Button>().Click({ this, &ChatPage::OnRefreshClick });
        FindName(L"NewSessionButton").as<Button>().Click({ this, &ChatPage::OnNewSessionClick });
        FindName(L"RenameSessionButton").as<Button>().Click({ this, &ChatPage::OnRenameSessionClick });
        FindName(L"DeleteSessionButton").as<Button>().Click({ this, &ChatPage::OnDeleteSessionClick });
        FindName(L"SendMessageButton").as<Button>().Click({ this, &ChatPage::OnSendMessageClick });
        FindName(L"CancelPendingButton").as<Button>().Click({ this, &ChatPage::OnCancelPendingClick });
    }

    void ChatPage::PopulateStaticSelectors()
    {
        auto tierCombo = FindName(L"ModelTierComboBox").as<ComboBox>();
        auto fpsCombo = FindName(L"ModelFpsComboBox").as<ComboBox>();
        auto resolutionCombo = FindName(L"RunningResolutionComboBox").as<ComboBox>();

        tierCombo.Items().Clear();
        fpsCombo.Items().Clear();
        resolutionCombo.Items().Clear();

        for (auto const& [label, tag] : {
            std::pair{ L"Ultra", L"ultra" },
            std::pair{ L"Light", L"light" },
            std::pair{ L"Core", L"core" }
        })
        {
            ComboBoxItem item;
            item.Content(box_value(label));
            item.Tag(box_value(tag));
            tierCombo.Items().Append(item);
        }
        tierCombo.SelectedIndex(0);

        for (auto fps : { 1, 2, 5, 10 })
        {
            ComboBoxItem item;
            item.Content(box_value(to_hstring(fps) + L" FPS"));
            item.Tag(box_value(fps));
            fpsCombo.Items().Append(item);
        }
        fpsCombo.SelectedIndex(0);

        for (auto resolution : { 640, 1024 })
        {
            ComboBoxItem item;
            item.Content(box_value(to_hstring(resolution) + L" px"));
            item.Tag(box_value(resolution));
            resolutionCombo.Items().Append(item);
        }
        resolutionCombo.SelectedIndex(0);
    }

    void ChatPage::PopulateCameraSelector()
    {
        auto combo = FindName(L"CameraSelectionComboBox").as<ComboBox>();
        combo.Items().Clear();

        ComboBoxItem allItem;
        allItem.Content(box_value(L"All cameras"));
        allItem.Tag(box_value(int32_t{ 0 }));
        combo.Items().Append(allItem);

        for (auto const& camera : m_cameras)
        {
            ComboBoxItem item;
            item.Content(box_value(camera.name.empty() ? L"Camera" : camera.name));
            item.Tag(box_value(camera.id));
            combo.Items().Append(item);
        }

        combo.SelectedIndex(0);
    }

    void ChatPage::UpdateResponsiveState(double width)
    {
        auto compact = width > 0 && width < 1180;
        auto sessionsColumn = FindName(L"SessionsColumnDefinition").as<ColumnDefinition>();
        auto conversationColumn = FindName(L"ConversationColumnDefinition").as<ColumnDefinition>();
        auto sessionsBorder = FindName(L"SessionsBorder").as<Border>();
        auto conversationBorder = FindName(L"ConversationBorder").as<Border>();

        if (compact)
        {
            sessionsColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            conversationColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));

            Grid::SetColumn(sessionsBorder, 0);
            Grid::SetColumnSpan(sessionsBorder, 2);
            Grid::SetRow(sessionsBorder, 0);
            Grid::SetRowSpan(sessionsBorder, 1);

            Grid::SetColumn(conversationBorder, 0);
            Grid::SetColumnSpan(conversationBorder, 2);
            Grid::SetRow(conversationBorder, 1);
            Grid::SetRowSpan(conversationBorder, 1);
            return;
        }

        sessionsColumn.Width(GridLengthHelper::FromPixels(340));
        conversationColumn.Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));

        Grid::SetColumn(sessionsBorder, 0);
        Grid::SetColumnSpan(sessionsBorder, 1);
        Grid::SetRow(sessionsBorder, 0);
        Grid::SetRowSpan(sessionsBorder, 2);

        Grid::SetColumn(conversationBorder, 1);
        Grid::SetColumnSpan(conversationBorder, 1);
        Grid::SetRow(conversationBorder, 0);
        Grid::SetRowSpan(conversationBorder, 2);
    }

    void ChatPage::RenderSessions()
    {
        auto host = FindName(L"SessionItemsHost").as<StackPanel>();
        host.Children().Clear();

        if (m_sessions.empty())
        {
            auto emptyBorder = Border();
            emptyBorder.Background(LookupBrush(L"DrakonPanelAltBrush"));
            emptyBorder.BorderBrush(LookupBrush(L"DrakonPanelBorderBrush"));
            emptyBorder.BorderThickness(ThicknessHelper::FromUniformLength(1));
            emptyBorder.CornerRadius(CornerRadiusHelper::FromUniformRadius(18));
            emptyBorder.Padding(ThicknessHelper::FromUniformLength(16));

            auto emptyText = TextBlock();
            emptyText.Text(L"No sessions yet. Create a new chat to mirror the DrakonSite flow.");
            emptyText.Style(LookupStyle(L"DrakonCaptionTextStyle"));
            emptyText.TextWrapping(TextWrapping::WrapWholeWords);
            emptyBorder.Child(emptyText);
            host.Children().Append(emptyBorder);
            return;
        }

        for (auto const& session : m_sessions)
        {
            auto selected = m_activeSessionId.has_value() && *m_activeSessionId == session.id;

            auto border = Border();
            border.Background(selected ? LookupBrush(L"DrakonPanelAltBrush") : LookupBrush(L"DrakonPanelBrush"));
            border.BorderBrush(selected ? LookupBrush(L"DrakonAccentBrush") : LookupBrush(L"DrakonPanelBorderBrush"));
            border.BorderThickness(ThicknessHelper::FromUniformLength(1));
            border.CornerRadius(CornerRadiusHelper::FromUniformRadius(18));
            border.Padding(ThicknessHelper::FromUniformLength(16));

            auto content = StackPanel();
            content.Spacing(10);

            auto selectButton = Button();
            selectButton.Tag(box_value(session.id));
            selectButton.Padding(ThicknessHelper::FromUniformLength(0));
            selectButton.HorizontalAlignment(HorizontalAlignment::Stretch);
            selectButton.Click({ this, &ChatPage::OnSelectSessionClick });

            auto selectContent = StackPanel();
            selectContent.Spacing(4);

            auto title = TextBlock();
            title.Text(to_hstring(DisplaySessionTitle(session)));
            title.Style(LookupStyle(L"DrakonSectionTitleTextStyle"));

            auto updated = TextBlock();
            updated.Text(to_hstring(FormatTimestamp(session.updatedAt)));
            updated.Style(LookupStyle(L"DrakonCaptionTextStyle"));

            selectContent.Children().Append(title);
            selectContent.Children().Append(updated);
            selectButton.Content(selectContent);

            auto actionGrid = Grid();
            actionGrid.ColumnSpacing(8);
            ColumnDefinition renameColumn;
            ColumnDefinition deleteColumn;
            actionGrid.ColumnDefinitions().Append(renameColumn);
            actionGrid.ColumnDefinitions().Append(deleteColumn);

            auto renameButton = Button();
            renameButton.Tag(box_value(session.id));
            renameButton.Content(box_value(L"Rename"));
            renameButton.Click({ this, &ChatPage::OnRenameSessionClick });

            auto deleteButton = Button();
            deleteButton.Tag(box_value(session.id));
            deleteButton.Content(box_value(L"Delete"));
            deleteButton.Click({ this, &ChatPage::OnDeleteSessionClick });

            Grid::SetColumn(renameButton, 0);
            Grid::SetColumn(deleteButton, 1);
            actionGrid.Children().Append(renameButton);
            actionGrid.Children().Append(deleteButton);

            content.Children().Append(selectButton);
            content.Children().Append(actionGrid);
            border.Child(content);
            host.Children().Append(border);
        }
    }

    void ChatPage::RenderMessages()
    {
        auto host = FindName(L"MessageItemsHost").as<StackPanel>();
        host.Children().Clear();

        if (m_messages.empty())
        {
            auto placeholder = Border();
            placeholder.Background(LookupBrush(L"DrakonPanelBrush"));
            placeholder.BorderBrush(LookupBrush(L"DrakonPanelBorderBrush"));
            placeholder.BorderThickness(ThicknessHelper::FromUniformLength(1));
            placeholder.CornerRadius(CornerRadiusHelper::FromUniformRadius(18));
            placeholder.Padding(ThicknessHelper::FromUniformLength(18));

            auto text = TextBlock();
            text.Text(L"Select or create a session to load the conversation.");
            text.Style(LookupStyle(L"DrakonBodyTextStyle"));
            text.TextWrapping(TextWrapping::WrapWholeWords);
            placeholder.Child(text);
            host.Children().Append(placeholder);
            return;
        }

        for (auto const& message : m_messages)
        {
            auto isUser = message.role == "user";

            auto container = StackPanel();
            container.HorizontalAlignment(isUser ? HorizontalAlignment::Right : HorizontalAlignment::Left);
            container.MaxWidth(900);
            container.Spacing(6);

            auto meta = TextBlock();
            meta.Text(to_hstring(RoleLabel(message.role) + " • " + FormatTimestamp(message.createdAt)));
            meta.Style(LookupStyle(L"DrakonCaptionTextStyle"));

            auto bubble = Border();
            bubble.Background(
                isUser
                    ? LookupBrush(L"DrakonAccentBrush")
                    : message.isPending
                    ? LookupBrush(L"DrakonPanelBrush")
                    : LookupBrush(L"DrakonPanelAltBrush"));
            bubble.BorderBrush(
                isUser
                    ? LookupBrush(L"DrakonAccentBrush")
                    : LookupBrush(L"DrakonPanelBorderBrush"));
            bubble.BorderThickness(ThicknessHelper::FromUniformLength(1));
            bubble.CornerRadius(CornerRadiusHelper::FromUniformRadius(20));
            bubble.Padding(ThicknessHelper::FromUniformLength(16));

            auto content = StackPanel();
            content.Spacing(10);

            auto body = TextBlock();
            body.Text(message.content.empty() ? L"(empty message payload)" : to_hstring(message.content));
            body.TextWrapping(TextWrapping::WrapWholeWords);
            body.Foreground(isUser ? LookupBrush(L"DrakonStrongTextBrush") : LookupBrush(L"DrakonBodyTextBrush"));
            content.Children().Append(body);

            if (message.isPending)
            {
                auto pendingText = TextBlock();
                pendingText.Text(L"Pending desktop execution...");
                pendingText.Style(LookupStyle(L"DrakonCaptionTextStyle"));
                content.Children().Append(pendingText);
            }

            if (!message.warning.empty())
            {
                auto warningText = TextBlock();
                warningText.Text(to_hstring(message.warning));
                warningText.Style(LookupStyle(L"DrakonCaptionTextStyle"));
                warningText.TextWrapping(TextWrapping::WrapWholeWords);
                content.Children().Append(warningText);
            }

            if (!message.cameraSelectionJson.empty())
            {
                auto selectionText = TextBlock();
                selectionText.Text(L"Camera selection: " + to_hstring(message.cameraSelectionJson));
                selectionText.Style(LookupStyle(L"DrakonCaptionTextStyle"));
                selectionText.TextWrapping(TextWrapping::WrapWholeWords);
                content.Children().Append(selectionText);
            }

            bubble.Child(content);
            container.Children().Append(meta);
            container.Children().Append(bubble);
            host.Children().Append(container);
        }
    }

    void ChatPage::RenderConversationState()
    {
        auto const* activeSession = ActiveSession();
        auto activeTitle = activeSession ? to_hstring(DisplaySessionTitle(*activeSession)) : hstring{ L"Select a chat session" };
        auto subtitle = activeSession
            ? L"Messages are loaded from the same /api/chat/sessions contract used by the web UI."
            : L"Create a session or choose one from the list to start sending prompts.";

        FindName(L"ActiveSessionTitleText").as<TextBlock>().Text(activeTitle);
        FindName(L"ActiveSessionSubtitleText").as<TextBlock>().Text(subtitle);

        auto pairingText = PendingExecutionNotice();
        FindName(L"ChatPairingSummaryText").as<TextBlock>().Text(pairingText);
        FindName(L"PendingExecutionText").as<TextBlock>().Text(pairingText);

        auto tokenSummary =
            L"Tokens: input " + to_hstring(m_tokenBalance.inputBalance) +
            L" • output " + to_hstring(m_tokenBalance.outputBalance);
        FindName(L"ChatTokenBalanceSummaryText").as<TextBlock>().Text(tokenSummary);

        auto canOperate = activeSession != nullptr;
        FindName(L"RenameSessionButton").as<Button>().IsEnabled(canOperate);
        FindName(L"DeleteSessionButton").as<Button>().IsEnabled(canOperate);
        FindName(L"SendMessageButton").as<Button>().IsEnabled(canOperate);

        auto hasPending = std::any_of(
            m_messages.begin(),
            m_messages.end(),
            [](services::ChatMessageRecord const& record) { return record.isPending; });
        FindName(L"CancelPendingButton").as<Button>().IsEnabled(canOperate && hasPending);
    }

    void ChatPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"ChatInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    std::optional<size_t> ChatPage::FindSessionIndex(int32_t sessionId) const
    {
        for (size_t index = 0; index < m_sessions.size(); ++index)
        {
            if (m_sessions[index].id == sessionId)
            {
                return index;
            }
        }

        return std::nullopt;
    }

    void ChatPage::NavigateToBilling()
    {
        if (auto frame = Parent().try_as<winrt::Microsoft::UI::Xaml::Controls::Frame>())
        {
            frame.Content(make<BillingPage>());
            return;
        }

        ShowStatus(L"Unable to reach the shell frame for billing navigation.", InfoBarSeverity::Warning);
    }

    services::ChatSessionRecord const* ChatPage::ActiveSession() const
    {
        if (!m_activeSessionId.has_value())
        {
            return nullptr;
        }

        auto index = FindSessionIndex(*m_activeSessionId);
        if (!index.has_value())
        {
            return nullptr;
        }

        return &m_sessions[*index];
    }

    std::optional<int32_t> ChatPage::SelectedCameraId() const
    {
        auto combo = FindName(L"CameraSelectionComboBox").as<ComboBox>();
        auto selected = combo.SelectedItem().try_as<ComboBoxItem>();
        if (!selected)
        {
            return std::nullopt;
        }

        auto value = unbox_value_or<int32_t>(selected.Tag(), 0);
        if (value <= 0)
        {
            return std::nullopt;
        }
        return value;
    }

    services::ChatSendRequest ChatPage::BuildSendRequest() const
    {
        services::ChatSendRequest request;
        request.content = to_string(FindName(L"MessageInputTextBox").as<TextBox>().Text());
        request.cameraId = SelectedCameraId();

        if (auto tier = FindName(L"ModelTierComboBox").as<ComboBox>().SelectedItem().try_as<ComboBoxItem>())
        {
            request.modelTier = to_string(unbox_value_or<hstring>(tier.Tag(), L"ultra"));
        }

        if (auto fps = FindName(L"ModelFpsComboBox").as<ComboBox>().SelectedItem().try_as<ComboBoxItem>())
        {
            request.modelFps = unbox_value_or<int32_t>(fps.Tag(), 1);
        }

        if (auto resolution = FindName(L"RunningResolutionComboBox").as<ComboBox>().SelectedItem().try_as<ComboBoxItem>())
        {
            auto selectedResolution = unbox_value_or<int32_t>(resolution.Tag(), 640);
            if (LowerAsciiChat(request.modelTier) == "core")
            {
                request.runningResolution = selectedResolution;
            }
        }

        return request;
    }

    hstring ChatPage::PendingExecutionNotice() const
    {
        if (m_pairingStatus.chatEffectiveStatus == "connected" || m_pairingStatus.isAvailableForChat)
        {
            return L"Desktop runtime connected. Chat requests can be processed by the paired executable.";
        }

        if (m_pairingStatus.chatEffectiveStatus == "stale")
        {
            return L"Desktop agent connection looks stale. Keep the executable open on this machine.";
        }

        if (m_pairingStatus.chatEffectiveStatus == "offline")
        {
            return L"Desktop agent offline. Open the EXE on this machine to continue processing chat requests.";
        }

        return L"Pairing status will update here as soon as the backend reports a desktop runtime.";
    }

    fire_and_forget ChatPage::RefreshChatAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing chat sessions, token balance and pairing status...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetChatSessions()) sessions{};
        decltype(services::DrakonApiClient::Instance().GetTokenBalance()) tokens{};
        decltype(services::DrakonApiClient::Instance().GetPairingStatus()) pairing{};
        decltype(services::DrakonApiClient::Instance().GetCameras()) cameras{};

        if (auth.success && auth.value.isAuthenticated)
        {
            sessions = services::DrakonApiClient::Instance().GetChatSessions();
            tokens = services::DrakonApiClient::Instance().GetTokenBalance();
            pairing = services::DrakonApiClient::Instance().GetPairingStatus();
            cameras = services::DrakonApiClient::Instance().GetCameras();
        }

        co_await uiThread;

        if (auth.success)
        {
            m_authState = auth.value;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            if (sessions.success)
            {
                auto previousSessionId = m_activeSessionId;
                m_sessions = std::move(sessions.value);
                m_loadedRemoteData = true;
                m_usingLocalFallback = false;

                if (previousSessionId.has_value() && FindSessionIndex(*previousSessionId).has_value())
                {
                    m_activeSessionId = previousSessionId;
                }
                else if (!m_sessions.empty())
                {
                    m_activeSessionId = m_sessions.front().id;
                }
                else
                {
                    m_activeSessionId.reset();
                    m_messages.clear();
                }

                if (tokens.success)
                {
                    m_tokenBalance = tokens.value;
                }

                if (pairing.success)
                {
                    m_pairingStatus = pairing.value;
                }

                if (cameras.success)
                {
                    m_cameras = std::move(cameras.value);
                    PopulateCameraSelector();
                }

                RenderSessions();
                RenderConversationState();

                if (m_activeSessionId.has_value())
                {
                    LoadMessagesAsync(false);
                }

                if (announceResult)
                {
                    ShowStatus(
                        L"Chat synchronized from backend. " + to_hstring(m_sessions.size()) + L" session(s) loaded.",
                        InfoBarSeverity::Success);
                }
                co_return;
            }

            if (sessions.statusCode == 0)
            {
                m_usingLocalFallback = true;
                RenderSessions();
                RenderConversationState();

                if (announceResult || !m_loadedRemoteData)
                {
                    ShowStatus(
                        L"Chat backend unavailable. Keeping the local fallback conversation visible.",
                        InfoBarSeverity::Warning);
                }
                co_return;
            }

            ShowStatus(to_hstring(sessions.error), InfoBarSeverity::Error);
            co_return;
        }

        RenderSessions();
        RenderConversationState();

        if (announceResult)
        {
            ShowStatus(
                L"Chat requires an authenticated local Drakon session before loading backend conversations.",
                InfoBarSeverity::Warning);
        }
    }

    fire_and_forget ChatPage::LoadMessagesAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        if (!m_activeSessionId.has_value())
        {
            m_messages.clear();
            RenderMessages();
            RenderConversationState();
            co_return;
        }

        if (announceResult)
        {
            ShowStatus(L"Loading messages from /api/chat/sessions/{id}/messages...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetChatMessages(*m_activeSessionId)) messages{};

        if (auth.success && auth.value.isAuthenticated)
        {
            messages = services::DrakonApiClient::Instance().GetChatMessages(*m_activeSessionId);
        }

        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated)
        {
            if (messages.success)
            {
                m_messages = std::move(messages.value);
                RenderMessages();
                RenderConversationState();

                if (announceResult)
                {
                    ShowStatus(L"Conversation synchronized from backend.", InfoBarSeverity::Success);
                }
                co_return;
            }

            if (messages.statusCode == 0)
            {
                if (announceResult)
                {
                    ShowStatus(
                        L"Chat messages endpoint is offline. Keeping the current conversation snapshot.",
                        InfoBarSeverity::Warning);
                }
                co_return;
            }

            ShowStatus(to_hstring(messages.error), InfoBarSeverity::Error);
            co_return;
        }

        RenderMessages();
        RenderConversationState();
    }

    fire_and_forget ChatPage::CreateSessionAsync()
    {
        auto lifetime = get_strong();

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Create chat"));
        dialog.PrimaryButtonText(L"Create");
        dialog.CloseButtonText(L"Cancel");

        TextBox titleBox;
        titleBox.PlaceholderText(L"Optional title");
        dialog.Content(titleBox);

        auto result = co_await dialog.ShowAsync();
        if (result != ContentDialogResult::Primary)
        {
            co_return;
        }

        auto title = to_string(titleBox.Text());

        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        if (auth.success && auth.value.isAuthenticated)
        {
            auto createResponse = services::DrakonApiClient::Instance().CreateChatSession(
                title.empty() ? std::nullopt : std::make_optional(title));

            if (createResponse.success)
            {
                m_sessions.insert(m_sessions.begin(), createResponse.value);
                m_activeSessionId = createResponse.value.id;
                m_messages.clear();
                m_usingLocalFallback = false;
                RenderSessions();
                RenderMessages();
                RenderConversationState();
                ShowStatus(L"Chat session created through backend POST /api/chat/sessions.", InfoBarSeverity::Success);
                co_return;
            }

            if (createResponse.statusCode != 0)
            {
                ShowStatus(to_hstring(createResponse.error), InfoBarSeverity::Error);
                co_return;
            }
        }

        services::ChatSessionRecord session;
        session.id = m_nextLocalSessionId++;
        session.title = title.empty() ? "Untitled chat" : title;
        session.createdAt = "local-now";
        session.updatedAt = session.createdAt;
        m_sessions.insert(m_sessions.begin(), session);
        m_activeSessionId = session.id;
        m_messages.clear();
        m_usingLocalFallback = true;
        RenderSessions();
        RenderMessages();
        RenderConversationState();
        ShowStatus(L"Chat session created in local fallback mode.", InfoBarSeverity::Warning);
    }

    fire_and_forget ChatPage::RenameSessionAsync(int32_t sessionId)
    {
        auto index = FindSessionIndex(sessionId);
        if (!index.has_value())
        {
            co_return;
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Rename chat"));
        dialog.PrimaryButtonText(L"Save");
        dialog.CloseButtonText(L"Cancel");

        TextBox titleBox;
        titleBox.Text(to_hstring(DisplaySessionTitle(m_sessions[*index])));
        dialog.Content(titleBox);

        auto result = co_await dialog.ShowAsync();
        if (result != ContentDialogResult::Primary)
        {
            co_return;
        }

        auto newTitle = to_string(titleBox.Text());
        if (newTitle.empty())
        {
            newTitle = "Untitled chat";
        }

        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        if (auth.success && auth.value.isAuthenticated)
        {
            auto renameResponse = services::DrakonApiClient::Instance().RenameChatSession(sessionId, newTitle);

            if (renameResponse.success)
            {
                m_sessions[*index] = renameResponse.value;
                RenderSessions();
                RenderConversationState();
                ShowStatus(L"Chat session renamed through backend PATCH /api/chat/sessions/{id}.", InfoBarSeverity::Success);
                co_return;
            }

            if (renameResponse.statusCode != 0)
            {
                ShowStatus(to_hstring(renameResponse.error), InfoBarSeverity::Error);
                co_return;
            }
        }

        m_sessions[*index].title = newTitle;
        RenderSessions();
        RenderConversationState();
        ShowStatus(L"Chat session renamed in local fallback mode.", InfoBarSeverity::Warning);
    }

    fire_and_forget ChatPage::DeleteSessionAsync(int32_t sessionId)
    {
        auto index = FindSessionIndex(sessionId);
        if (!index.has_value())
        {
            co_return;
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Delete chat"));
        dialog.Content(box_value(L"Are you sure you want to permanently delete this chat session and its messages?"));
        dialog.PrimaryButtonText(L"Delete");
        dialog.CloseButtonText(L"Cancel");
        dialog.DefaultButton(ContentDialogButton::Close);

        auto result = co_await dialog.ShowAsync();
        if (result != ContentDialogResult::Primary)
        {
            co_return;
        }

        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        if (auth.success && auth.value.isAuthenticated)
        {
            auto deleteResponse = services::DrakonApiClient::Instance().DeleteChatSession(sessionId);

            if (deleteResponse.success)
            {
                m_sessions.erase(m_sessions.begin() + static_cast<std::ptrdiff_t>(*index));
                if (m_activeSessionId.has_value() && *m_activeSessionId == sessionId)
                {
                    m_activeSessionId = m_sessions.empty() ? std::optional<int32_t>{} : std::optional<int32_t>{ m_sessions.front().id };
                    m_messages.clear();
                    if (m_activeSessionId.has_value())
                    {
                        LoadMessagesAsync(false);
                    }
                }
                RenderSessions();
                RenderMessages();
                RenderConversationState();
                ShowStatus(L"Chat session deleted through backend DELETE /api/chat/sessions/{id}.", InfoBarSeverity::Success);
                co_return;
            }

            if (deleteResponse.statusCode != 0)
            {
                ShowStatus(to_hstring(deleteResponse.error), InfoBarSeverity::Error);
                co_return;
            }
        }

        m_sessions.erase(m_sessions.begin() + static_cast<std::ptrdiff_t>(*index));
        if (m_activeSessionId.has_value() && *m_activeSessionId == sessionId)
        {
            m_activeSessionId = m_sessions.empty() ? std::optional<int32_t>{} : std::optional<int32_t>{ m_sessions.front().id };
            m_messages.clear();
        }
        RenderSessions();
        RenderMessages();
        RenderConversationState();
        ShowStatus(L"Chat session deleted in local fallback mode.", InfoBarSeverity::Warning);
    }

    fire_and_forget ChatPage::SendActiveMessageAsync()
    {
        auto lifetime = get_strong();

        if (!m_activeSessionId.has_value())
        {
            ShowStatus(L"Select or create a chat session before sending messages.", InfoBarSeverity::Warning);
            co_return;
        }

        auto request = BuildSendRequest();
        if (request.content.empty())
        {
            ShowStatus(L"Type a prompt before sending.", InfoBarSeverity::Warning);
            co_return;
        }

        ShowStatus(L"Sending chat message...", InfoBarSeverity::Informational);

        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        if (auth.success && auth.value.isAuthenticated)
        {
            auto sendResponse = services::DrakonApiClient::Instance().SendChatMessage(*m_activeSessionId, request);

            if (sendResponse.success)
            {
                m_messages = std::move(sendResponse.value.messages);
                FindName(L"MessageInputTextBox").as<TextBox>().Text(L"");
                RenderMessages();
                RenderConversationState();

                if (!sendResponse.value.warning.empty())
                {
                    ShowStatus(to_hstring(sendResponse.value.warning), InfoBarSeverity::Warning);
                }
                else
                {
                    ShowStatus(L"Message sent to backend chat successfully.", InfoBarSeverity::Success);
                }
                co_return;
            }

            if (sendResponse.statusCode != 0)
            {
                ShowStatus(to_hstring(sendResponse.error), InfoBarSeverity::Error);
                co_return;
            }
        }

        FindName(L"MessageInputTextBox").as<TextBox>().Text(L"");

        services::ChatMessageRecord localUser;
        localUser.id = static_cast<int32_t>(m_messages.size() + 1);
        localUser.role = "user";
        localUser.content = request.content;
        localUser.createdAt = "local-now";
        localUser.updatedAt = localUser.createdAt;
        m_messages.push_back(localUser);

        services::ChatMessageRecord localAssistant;
        localAssistant.id = static_cast<int32_t>(m_messages.size() + 1);
        localAssistant.role = "assistant";
        localAssistant.content =
            "Local fallback response: the authenticated backend was unavailable, so this message stays inside the desktop shell until remote chat becomes available again.";
        localAssistant.createdAt = "local-now";
        localAssistant.updatedAt = localAssistant.createdAt;
        localAssistant.warning = "Backend offline";
        m_messages.push_back(localAssistant);

        m_usingLocalFallback = true;
        RenderMessages();
        RenderConversationState();
        ShowStatus(L"Message handled in local fallback mode because the backend chat endpoint was unavailable.", InfoBarSeverity::Warning);
    }

    fire_and_forget ChatPage::CancelPendingAsync()
    {
        auto lifetime = get_strong();

        if (!m_activeSessionId.has_value())
        {
            co_return;
        }

        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        if (auth.success && auth.value.isAuthenticated)
        {
            auto cancelResponse = services::DrakonApiClient::Instance().CancelChatSession(*m_activeSessionId, "manual");

            if (cancelResponse.success)
            {
                LoadMessagesAsync(false);
                ShowStatus(L"Pending execution cancelled through backend.", InfoBarSeverity::Success);
                co_return;
            }

            if (cancelResponse.statusCode != 0)
            {
                ShowStatus(to_hstring(cancelResponse.error), InfoBarSeverity::Error);
                co_return;
            }
        }

        auto changed = false;
        for (auto& message : m_messages)
        {
            if (message.isPending)
            {
                message.isPending = false;
                changed = true;
            }
        }

        if (changed)
        {
            services::ChatMessageRecord systemMessage;
            systemMessage.id = static_cast<int32_t>(m_messages.size() + 1);
            systemMessage.role = "system";
            systemMessage.content = "Pending execution cancelled locally while the backend was unavailable.";
            systemMessage.createdAt = "local-now";
            systemMessage.updatedAt = systemMessage.createdAt;
            m_messages.push_back(systemMessage);
            RenderMessages();
            RenderConversationState();
        }

        ShowStatus(L"Pending execution cancelled in local fallback mode.", InfoBarSeverity::Warning);
    }

    void ChatPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        RefreshChatAsync(true);
    }

    void ChatPage::OnNewSessionClick(IInspectable const&, RoutedEventArgs const&)
    {
        CreateSessionAsync();
    }

    void ChatPage::OnRenameSessionClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto sessionId = ReadTaggedSessionId(sender);
        if (sessionId <= 0 && m_activeSessionId.has_value())
        {
            sessionId = *m_activeSessionId;
        }

        if (sessionId > 0)
        {
            RenameSessionAsync(sessionId);
        }
    }

    void ChatPage::OnDeleteSessionClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto sessionId = ReadTaggedSessionId(sender);
        if (sessionId <= 0 && m_activeSessionId.has_value())
        {
            sessionId = *m_activeSessionId;
        }

        if (sessionId > 0)
        {
            DeleteSessionAsync(sessionId);
        }
    }

    void ChatPage::OnSelectSessionClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto sessionId = ReadTaggedSessionId(sender);
        if (sessionId <= 0)
        {
            return;
        }

        m_activeSessionId = sessionId;
        RenderSessions();
        RenderMessages();
        RenderConversationState();
        LoadMessagesAsync(false);
    }

    void ChatPage::OnSendMessageClick(IInspectable const&, RoutedEventArgs const&)
    {
        SendActiveMessageAsync();
    }

    void ChatPage::OnCancelPendingClick(IInspectable const&, RoutedEventArgs const&)
    {
        CancelPendingAsync();
    }

    void ChatPage::OnPageSizeChanged(IInspectable const&, SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }

    void ChatPage::OnPollTimerTick(IInspectable const&, IInspectable const&)
    {
        ++m_pollTick;

        auto hasPending = std::any_of(
            m_messages.begin(),
            m_messages.end(),
            [](services::ChatMessageRecord const& record) { return record.isPending; });

        if (m_authState.isAuthenticated && m_activeSessionId.has_value() && hasPending)
        {
            LoadMessagesAsync(false);
            return;
        }

        if (m_pollTick % 4 == 0)
        {
            RefreshChatAsync(false);
        }
    }
}

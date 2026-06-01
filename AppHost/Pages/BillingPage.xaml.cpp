#include "pch.h"
#include "BillingPage.xaml.h"

#include <Windows.h>
#include <shellapi.h>

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <sstream>

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

    void ApplySelectionButtonStyle(Button const& button, bool selected)
    {
        button.Background(selected ? LookupBrush(L"DrakonAccentBrush") : LookupBrush(L"DrakonPanelAltBrush"));
        button.BorderBrush(selected ? LookupBrush(L"DrakonAccentBrush") : LookupBrush(L"DrakonPanelBorderBrush"));
        button.Foreground(LookupBrush(L"DrakonStrongTextBrush"));
    }

    std::string LowerAsciiLocal(std::string value)
    {
        std::transform(
            value.begin(),
            value.end(),
            value.begin(),
            [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
        return value;
    }

    std::string ReadTagString(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return winrt::to_string(unbox_value_or<hstring>(element.Tag(), L""));
        }

        return {};
    }

    int32_t ReadTagInt(IInspectable const& sender)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            return unbox_value_or<int32_t>(element.Tag(), 0);
        }

        return 0;
    }

    std::string TierLabel(std::string const& tier)
    {
        auto normalized = LowerAsciiLocal(tier);
        if (normalized == "light") return "Light";
        if (normalized == "pro") return "Pro";
        return "Plus";
    }

    double PricePerCamera(std::string const& tier, int32_t secondsPerFrame)
    {
        auto normalized = LowerAsciiLocal(tier);
        if (normalized == "light")
        {
            switch (secondsPerFrame)
            {
            case 1: return 38.7;
            case 3: return 12.9;
            case 5: return 7.74;
            default: return 3.87;
            }
        }

        if (normalized == "pro")
        {
            switch (secondsPerFrame)
            {
            case 1: return 165.72;
            case 3: return 55.24;
            case 5: return 33.14;
            default: return 16.57;
            }
        }

        switch (secondsPerFrame)
        {
        case 1: return 51.6;
        case 3: return 17.2;
        case 5: return 10.32;
        default: return 5.16;
        }
    }

    std::string FormatFixed(double value)
    {
        std::ostringstream stream;
        stream << std::fixed << std::setprecision(2) << value;
        return stream.str();
    }

    std::string FormatThousands(int64_t value)
    {
        auto raw = std::to_string(value);
        std::string formatted;
        auto digits = static_cast<int>(raw.size());
        for (int index = 0; index < digits; ++index)
        {
            if (index > 0 && (digits - index) % 3 == 0)
            {
                formatted.push_back(',');
            }
            formatted.push_back(raw[static_cast<size_t>(index)]);
        }
        return formatted;
    }

    std::string FormatCurrencyCents(int64_t amount, std::string currency)
    {
        auto normalizedCurrency = currency.empty() ? std::string("USD") : currency;
        std::transform(
            normalizedCurrency.begin(),
            normalizedCurrency.end(),
            normalizedCurrency.begin(),
            [](unsigned char ch) { return static_cast<char>(std::toupper(ch)); });

        std::ostringstream stream;
        stream << normalizedCurrency << ' ' << std::fixed << std::setprecision(2) << (static_cast<double>(amount) / 100.0);
        return stream.str();
    }

    std::string FormatDateShort(std::string value)
    {
        if (value.size() >= 10)
        {
            return value.substr(0, 10);
        }
        return value;
    }

    std::wstring ToWide(std::string const& value)
    {
        return winrt::to_hstring(value).c_str();
    }

    bool TryLaunchUrl(std::wstring const& url)
    {
        auto result = reinterpret_cast<intptr_t>(ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        return result > 32;
    }
}

namespace winrt::DrakonDesktop::implementation
{
    BillingPage::BillingPage()
    {
        InitializeComponent();
        WireUpActions();
        UpdateSelectionVisuals();
        SizeChanged({ this, &BillingPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());
        RefreshBillingAsync(false);
    }

    void BillingPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/BillingPage.xaml" });

        m_initialized = true;
    }

    void BillingPage::WireUpActions()
    {
        FindName(L"TierLightButton").as<Button>().Click({ this, &BillingPage::OnTierSelectionClick });
        FindName(L"TierPlusButton").as<Button>().Click({ this, &BillingPage::OnTierSelectionClick });
        FindName(L"TierProButton").as<Button>().Click({ this, &BillingPage::OnTierSelectionClick });
        FindName(L"Speed1Button").as<Button>().Click({ this, &BillingPage::OnSpeedSelectionClick });
        FindName(L"Speed3Button").as<Button>().Click({ this, &BillingPage::OnSpeedSelectionClick });
        FindName(L"Speed5Button").as<Button>().Click({ this, &BillingPage::OnSpeedSelectionClick });
        FindName(L"Speed10Button").as<Button>().Click({ this, &BillingPage::OnSpeedSelectionClick });
        FindName(L"CameraCountMinusButton").as<Button>().Click({ this, &BillingPage::OnCameraCountMinusClick });
        FindName(L"CameraCountPlusButton").as<Button>().Click({ this, &BillingPage::OnCameraCountPlusClick });
        FindName(L"BillingRefreshButton").as<Button>().Click({ this, &BillingPage::OnRefreshClick });
        FindName(L"SubscribeButton").as<Button>().Click({ this, &BillingPage::OnSubscribeClick });
        FindName(L"BuyTokensButton").as<Button>().Click({ this, &BillingPage::OnBuyTokensClick });
        FindName(L"ManagePlansCardsButton").as<Button>().Click({ this, &BillingPage::OnManagePlansCardsClick });
        FindName(L"CancelSubscriptionButton").as<Button>().Click({ this, &BillingPage::OnCancelSubscriptionClick });
    }

    void BillingPage::SetText(hstring const& elementName, hstring const& value)
    {
        if (auto text = FindName(elementName).try_as<TextBlock>())
        {
            text.Text(value);
        }
    }

    void BillingPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"BillingInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    bool BillingPage::CurrentPlanMatchesSelection() const
    {
        return m_subscription.exists &&
            m_subscription.isActive &&
            LowerAsciiLocal(m_subscription.modelTier) == LowerAsciiLocal(m_selectedTier) &&
            m_subscription.secondsPerFrame == m_selectedSecondsPerFrame &&
            m_subscription.cameraCount == m_cameraCount;
    }

    void BillingPage::UpdateSelectionVisuals()
    {
        auto light = FindName(L"TierLightButton").as<Button>();
        auto plus = FindName(L"TierPlusButton").as<Button>();
        auto pro = FindName(L"TierProButton").as<Button>();
        auto speed1 = FindName(L"Speed1Button").as<Button>();
        auto speed3 = FindName(L"Speed3Button").as<Button>();
        auto speed5 = FindName(L"Speed5Button").as<Button>();
        auto speed10 = FindName(L"Speed10Button").as<Button>();

        ApplySelectionButtonStyle(light, LowerAsciiLocal(m_selectedTier) == "light");
        ApplySelectionButtonStyle(plus, LowerAsciiLocal(m_selectedTier) == "plus");
        ApplySelectionButtonStyle(pro, LowerAsciiLocal(m_selectedTier) == "pro");
        ApplySelectionButtonStyle(speed1, m_selectedSecondsPerFrame == 1);
        ApplySelectionButtonStyle(speed3, m_selectedSecondsPerFrame == 3);
        ApplySelectionButtonStyle(speed5, m_selectedSecondsPerFrame == 5);
        ApplySelectionButtonStyle(speed10, m_selectedSecondsPerFrame == 10);

        auto const pricePerCamera = PricePerCamera(m_selectedTier, m_selectedSecondsPerFrame);
        auto const totalPrice = pricePerCamera * static_cast<double>(m_cameraCount);

        SetText(L"SubscriptionPriceText", to_hstring("$" + FormatFixed(totalPrice)));
        SetText(
            L"SubscriptionSummaryText",
            to_hstring(
                TierLabel(m_selectedTier) + " plan • " +
                std::to_string(m_cameraCount) + (m_cameraCount == 1 ? " camera" : " cameras") +
                " • 1 frame every " + std::to_string(m_selectedSecondsPerFrame) + " seconds per camera"));
        SetText(
            L"SubscriptionPerCameraText",
            to_hstring("$" + FormatFixed(pricePerCamera) + " per camera / month"));
        SetText(
            L"CameraCountValueText",
            to_hstring(std::to_string(m_cameraCount) + "x " + (m_cameraCount == 1 ? std::string("camera") : std::string("cameras"))));

        auto subscribeButton = FindName(L"SubscribeButton").as<Button>();
        if (CurrentPlanMatchesSelection())
        {
            subscribeButton.Content(box_value(L"Current Plan"));
            subscribeButton.IsEnabled(false);
        }
        else
        {
            subscribeButton.Content(box_value(L"Subscribe"));
            subscribeButton.IsEnabled(true);
        }
    }

    void BillingPage::RenderPayments()
    {
        auto host = FindName(L"PaymentsHost").as<StackPanel>();
        auto emptyState = FindName(L"PaymentsEmptyStateBorder").as<Border>();
        host.Children().Clear();

        if (m_payments.empty())
        {
            emptyState.Visibility(Visibility::Visible);
            return;
        }

        emptyState.Visibility(Visibility::Collapsed);

        for (auto const& payment : m_payments)
        {
            Border row;
            row.Style(Application::Current().Resources().Lookup(box_value(L"DrakonInsetPanelStyle")).as<Microsoft::UI::Xaml::Style>());

            Grid grid;
            grid.ColumnSpacing(16);
            grid.ColumnDefinitions().Append(ColumnDefinition{});
            grid.ColumnDefinitions().Append(ColumnDefinition{});
            grid.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            grid.ColumnDefinitions().GetAt(1).Width(GridLengthHelper::FromValueAndType(0, GridUnitType::Auto));

            StackPanel left;
            left.Spacing(4);

            TextBlock title;
            auto description = payment.description.empty() ? std::string("Payment") : payment.description;
            title.Text(to_hstring(description));

            TextBlock subtitle;
            subtitle.Style(Application::Current().Resources().Lookup(box_value(L"DrakonCaptionTextStyle")).as<Microsoft::UI::Xaml::Style>());
            subtitle.Text(to_hstring(FormatDateShort(payment.createdAt)));

            left.Children().Append(title);
            left.Children().Append(subtitle);

            StackPanel right;
            right.Spacing(4);
            right.HorizontalAlignment(HorizontalAlignment::Right);

            TextBlock amount;
            amount.Text(to_hstring(FormatCurrencyCents(payment.amount, payment.currency)));
            amount.HorizontalAlignment(HorizontalAlignment::Right);
            TextBlock status;
            status.Style(Application::Current().Resources().Lookup(box_value(L"DrakonCaptionTextStyle")).as<Microsoft::UI::Xaml::Style>());
            status.Text(to_hstring(payment.status));
            status.HorizontalAlignment(HorizontalAlignment::Right);

            right.Children().Append(amount);
            right.Children().Append(status);

            grid.Children().Append(left);
            Grid::SetColumn(right, 1);
            grid.Children().Append(right);
            row.Child(grid);

            host.Children().Append(row);
        }
    }

    void BillingPage::RenderCards()
    {
        auto host = FindName(L"CardsHost").as<StackPanel>();
        host.Children().Clear();

        auto summary = FindName(L"CardsSummaryText").as<TextBlock>();
        if (m_cards.empty())
        {
            summary.Text(L"No saved cards.");
            return;
        }

        summary.Text(to_hstring(std::to_string(m_cards.size()) + " saved card(s)."));

        for (auto const& card : m_cards)
        {
            Border row;
            row.Style(Application::Current().Resources().Lookup(box_value(L"DrakonPanelStyle")).as<Microsoft::UI::Xaml::Style>());
            row.Padding(ThicknessHelper::FromLengths(14, 14, 14, 14));

            Grid grid;
            grid.ColumnSpacing(12);
            grid.ColumnDefinitions().Append(ColumnDefinition{});
            grid.ColumnDefinitions().Append(ColumnDefinition{});
            grid.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            grid.ColumnDefinitions().GetAt(1).Width(GridLengthHelper::FromValueAndType(0, GridUnitType::Auto));

            StackPanel left;
            left.Spacing(4);

            TextBlock brand;
            std::string brandText = card.brand.empty() ? "card" : card.brand;
            if (card.isDefault)
            {
                brandText += " • default";
            }
            brand.Text(to_hstring(brandText));

            TextBlock last4;
            last4.Style(Application::Current().Resources().Lookup(box_value(L"DrakonCaptionTextStyle")).as<Microsoft::UI::Xaml::Style>());
            last4.Text(to_hstring("•••• " + card.last4 + " • exp " + std::to_string(card.expMonth) + "/" + std::to_string(card.expYear)));

            left.Children().Append(brand);
            left.Children().Append(last4);

            Button remove;
            remove.Content(box_value(L"Remove"));
            remove.Tag(box_value(card.id));
            remove.Click({ this, &BillingPage::OnRemoveCardClick });

            grid.Children().Append(left);
            Grid::SetColumn(remove, 1);
            grid.Children().Append(remove);
            row.Child(grid);
            host.Children().Append(row);
        }
    }

    void BillingPage::RenderBillingState()
    {
        SetText(L"TokenInputValueText", to_hstring(FormatThousands(m_tokenBalance.inputBalance)));
        SetText(L"TokenOutputValueText", to_hstring(FormatThousands(m_tokenBalance.outputBalance)));
        SetText(L"TotalSpentValueText", to_hstring(FormatThousands(m_tokenBalance.totalSpent)));

        auto activeCameraCount = m_subscription.exists ? m_subscription.cameraCount : m_billingStatus.activeCameras;
        SetText(L"ActiveCamerasValueText", to_hstring(std::to_string(activeCameraCount)));

        if (m_subscription.exists && m_subscription.cameraCount > 0)
        {
            m_cameraCount = m_subscription.cameraCount;
        }

        if (m_subscription.exists && m_subscription.secondsPerFrame > 0)
        {
            m_selectedSecondsPerFrame = m_subscription.secondsPerFrame;
        }

        if (m_subscription.exists && !m_subscription.modelTier.empty())
        {
            m_selectedTier = m_subscription.modelTier;
        }

        UpdateSelectionVisuals();
        RenderPayments();
        RenderCards();

        auto subscriptionTitle = FindName(L"ManageSubscriptionTitleText").as<TextBlock>();
        auto subscriptionStatus = FindName(L"ManageSubscriptionStatusText").as<TextBlock>();
        auto subscriptionAccess = FindName(L"ManageSubscriptionAccessText").as<TextBlock>();
        auto cancelButton = FindName(L"CancelSubscriptionButton").as<Button>();

        if (m_subscription.exists && m_subscription.isActive)
        {
            subscriptionTitle.Text(to_hstring(
                TierLabel(m_subscription.modelTier.empty() ? m_selectedTier : m_subscription.modelTier) +
                " • " + std::to_string(m_subscription.cameraCount) +
                (m_subscription.cameraCount == 1 ? " camera" : " cameras")));
            subscriptionStatus.Text(to_hstring(
                "Status: " + (m_subscription.status.empty() ? std::string("active") : m_subscription.status) +
                " • every " + std::to_string(m_subscription.secondsPerFrame) + " sec"));
            subscriptionAccess.Text(to_hstring(
                m_subscription.accessUntil.empty()
                    ? "Started at " + FormatDateShort(m_subscription.startedAt)
                    : "Access until " + FormatDateShort(m_subscription.accessUntil)));
            cancelButton.IsEnabled(true);
        }
        else
        {
            subscriptionTitle.Text(L"No active subscription");
            subscriptionStatus.Text(L"The backend returned no active subscription for the authenticated account.");
            subscriptionAccess.Text(L"");
            cancelButton.IsEnabled(false);
        }
    }

    void BillingPage::UpdateResponsiveState(double width)
    {
        auto subscriptionGrid = FindName(L"SubscriptionGrid").as<Grid>();
        auto tokenGrid = FindName(L"TokenCardsGrid").as<Grid>();
        auto manageGrid = FindName(L"ManageGrid").as<Grid>();
        auto subscriptionExplainCard = FindName(L"SubscriptionExplainCard").as<FrameworkElement>();
        auto tokenBalanceCard = FindName(L"TokenBalanceCard").as<FrameworkElement>();
        auto totalSpentCard = FindName(L"TotalSpentCard").as<FrameworkElement>();
        auto activeCamerasCard = FindName(L"ActiveCamerasCard").as<FrameworkElement>();
        auto manageSubscriptionCard = FindName(L"ManageSubscriptionCard").as<FrameworkElement>();
        auto manageCardsCard = FindName(L"ManageCardsCard").as<FrameworkElement>();

        auto narrowSubscription = width > 0 && width < 1280;
        subscriptionGrid.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        subscriptionGrid.ColumnDefinitions().GetAt(1).Width(narrowSubscription
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        Grid::SetRow(subscriptionExplainCard, narrowSubscription ? 1 : 0);
        Grid::SetColumn(subscriptionExplainCard, narrowSubscription ? 0 : 1);

        auto narrowTokens = width > 0 && width < 1180;
        if (narrowTokens)
        {
            tokenGrid.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            tokenGrid.ColumnDefinitions().GetAt(1).Width(GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel));
            tokenGrid.ColumnDefinitions().GetAt(2).Width(GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel));
            Grid::SetRow(tokenBalanceCard, 0);
            Grid::SetColumn(tokenBalanceCard, 0);
            Grid::SetRow(totalSpentCard, 1);
            Grid::SetColumn(totalSpentCard, 0);
            Grid::SetRow(activeCamerasCard, 2);
            Grid::SetColumn(activeCamerasCard, 0);
        }
        else
        {
            tokenGrid.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            tokenGrid.ColumnDefinitions().GetAt(1).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            tokenGrid.ColumnDefinitions().GetAt(2).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
            Grid::SetRow(tokenBalanceCard, 0);
            Grid::SetColumn(tokenBalanceCard, 0);
            Grid::SetRow(totalSpentCard, 0);
            Grid::SetColumn(totalSpentCard, 1);
            Grid::SetRow(activeCamerasCard, 0);
            Grid::SetColumn(activeCamerasCard, 2);
        }

        auto narrowManage = width > 0 && width < 1120;
        manageGrid.ColumnDefinitions().GetAt(0).Width(GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        manageGrid.ColumnDefinitions().GetAt(1).Width(narrowManage
            ? GridLengthHelper::FromValueAndType(0, GridUnitType::Pixel)
            : GridLengthHelper::FromValueAndType(1, GridUnitType::Star));
        Grid::SetRow(manageCardsCard, narrowManage ? 1 : 0);
        Grid::SetColumn(manageCardsCard, narrowManage ? 0 : 1);
        Grid::SetRow(manageSubscriptionCard, 0);
        Grid::SetColumn(manageSubscriptionCard, 0);
    }

    fire_and_forget BillingPage::RefreshBillingAsync(bool announceResult)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (announceResult)
        {
            ShowStatus(L"Refreshing billing from backend routes...", InfoBarSeverity::Informational);
        }

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        decltype(services::DrakonApiClient::Instance().GetBillingStatus()) billing{};
        decltype(services::DrakonApiClient::Instance().GetTokenBalance()) tokenBalance{};
        decltype(services::DrakonApiClient::Instance().GetPayments()) payments{};
        decltype(services::DrakonApiClient::Instance().GetActiveSubscription()) subscription{};
        decltype(services::DrakonApiClient::Instance().GetBillingCards()) cards{};

        if (auth.success && auth.value.isAuthenticated)
        {
            billing = services::DrakonApiClient::Instance().GetBillingStatus();
            tokenBalance = services::DrakonApiClient::Instance().GetTokenBalance();
            payments = services::DrakonApiClient::Instance().GetPayments();
            subscription = services::DrakonApiClient::Instance().GetActiveSubscription();
            cards = services::DrakonApiClient::Instance().GetBillingCards();
        }

        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated)
        {
            m_authState = auth.value;

            if (billing.success) m_billingStatus = billing.value;
            if (tokenBalance.success) m_tokenBalance = tokenBalance.value;
            if (payments.success) m_payments = payments.value;
            if (subscription.success) m_subscription = subscription.value;
            if (cards.success) m_cards = cards.value;

            RenderBillingState();
            m_loadedRemoteData = billing.success || tokenBalance.success || payments.success || subscription.success || cards.success;

            if (announceResult)
            {
                ShowStatus(L"Billing synchronized from the authenticated backend session.", InfoBarSeverity::Success);
            }

            if (!billing.success && !tokenBalance.success && !payments.success && !subscription.success && !cards.success)
            {
                auto message = billing.error.empty() ? L"Billing backend returned no successful payloads." : to_hstring(billing.error);
                ShowStatus(message, billing.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            }
            co_return;
        }

        if (announceResult || !m_loadedRemoteData)
        {
            auto message = auth.error.empty()
                ? L"Billing requires an authenticated local Drakon session before calling the backend."
                : L"Unable to validate the billing session: " + to_hstring(auth.error);
            ShowStatus(message, InfoBarSeverity::Warning);
        }
    }

    fire_and_forget BillingPage::OnSubscribeClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (!m_authState.isAuthenticated)
        {
            ShowStatus(L"Authenticate first on Login before opening Stripe checkout for a subscription.", InfoBarSeverity::Warning);
            co_return;
        }

        if (CurrentPlanMatchesSelection())
        {
            ShowStatus(L"The selected subscription already matches the active plan.", InfoBarSeverity::Informational);
            co_return;
        }

        ShowStatus(L"Creating Stripe checkout session for the selected subscription...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto checkout = services::DrakonApiClient::Instance().CreateSubscriptionCheckoutSession(
            m_selectedTier,
            m_selectedSecondsPerFrame,
            m_cameraCount);
        co_await uiThread;

        if (!checkout.success)
        {
            ShowStatus(to_hstring(checkout.error), checkout.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        if (TryLaunchUrl(ToWide(checkout.value)))
        {
            ShowStatus(L"Stripe checkout opened in the default browser.", InfoBarSeverity::Success);
        }
        else
        {
            ShowStatus(L"Checkout URL was created, but Windows could not open the default browser.", InfoBarSeverity::Error);
        }
    }

    fire_and_forget BillingPage::OnBuyTokensClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (!m_authState.isAuthenticated)
        {
            ShowStatus(L"Authenticate first on Login before purchasing chat tokens.", InfoBarSeverity::Warning);
            co_return;
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Buy Tokens"));
        dialog.PrimaryButtonText(L"Purchase");
        dialog.CloseButtonText(L"Cancel");
        dialog.DefaultButton(ContentDialogButton::Primary);

        StackPanel content;
        content.Spacing(12);

        TextBlock tokenTypeLabel;
        tokenTypeLabel.Text(L"Token type");

        ComboBox tokenTypeCombo;
        for (auto const& entry : { std::pair{ L"Both", L"both" }, std::pair{ L"Input", L"input" }, std::pair{ L"Output", L"output" } })
        {
            ComboBoxItem item;
            item.Content(box_value(entry.first));
            item.Tag(box_value(entry.second));
            tokenTypeCombo.Items().Append(item);
        }
        tokenTypeCombo.SelectedIndex(0);

        TextBlock amountLabel;
        amountLabel.Text(L"Credits amount");

        NumberBox amountBox;
        amountBox.Value(1000000);
        amountBox.SmallChange(1000000);
        amountBox.Minimum(1000000);
        amountBox.Maximum(500000000);
        amountBox.SpinButtonPlacementMode(NumberBoxSpinButtonPlacementMode::Compact);

        TextBlock note;
        note.Style(Application::Current().Resources().Lookup(box_value(L"DrakonCaptionTextStyle")).as<Microsoft::UI::Xaml::Style>());
        note.Text(L"DrakonSite uses 1M..500M token steps and sends the amount directly to /api/stripe/create-checkout-session.");
        note.TextWrapping(TextWrapping::WrapWholeWords);

        content.Children().Append(tokenTypeLabel);
        content.Children().Append(tokenTypeCombo);
        content.Children().Append(amountLabel);
        content.Children().Append(amountBox);
        content.Children().Append(note);

        dialog.Content(content);

        auto result = co_await dialog.ShowAsync();
        if (result != ContentDialogResult::Primary)
        {
            co_return;
        }

        auto selectedItem = tokenTypeCombo.SelectedItem().try_as<ComboBoxItem>();
        auto tokenType = winrt::to_string(unbox_value_or<hstring>(selectedItem.Tag(), L"both"));
        auto rawAmount = static_cast<int32_t>(std::round(amountBox.Value()));
        auto roundedMillions = (std::max)(1, rawAmount / 1000000);
        auto creditsAmount = (std::min)(500000000, roundedMillions * 1000000);

        ShowStatus(L"Creating Stripe checkout session for token purchase...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto checkout = services::DrakonApiClient::Instance().CreateCreditsCheckoutSession(creditsAmount, tokenType);
        co_await uiThread;

        if (!checkout.success)
        {
            ShowStatus(to_hstring(checkout.error), checkout.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        if (TryLaunchUrl(ToWide(checkout.value)))
        {
            ShowStatus(L"Token checkout opened in the default browser.", InfoBarSeverity::Success);
        }
        else
        {
            ShowStatus(L"Checkout URL was created, but Windows could not open the default browser.", InfoBarSeverity::Error);
        }
    }

    void BillingPage::OnManagePlansCardsClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto section = FindName(L"ManageSectionBorder").as<FrameworkElement>();
        auto const visible = section.Visibility() == Visibility::Visible;
        section.Visibility(visible ? Visibility::Collapsed : Visibility::Visible);

        if (!visible)
        {
            RefreshBillingAsync(false);
        }
    }

    fire_and_forget BillingPage::OnCancelSubscriptionClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        if (!m_subscription.exists || !m_subscription.isActive)
        {
            ShowStatus(L"There is no active subscription to cancel.", InfoBarSeverity::Warning);
            co_return;
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Cancel subscription"));
        dialog.Content(box_value(L"This will request cancellation of the active subscription on the billing backend."));
        dialog.PrimaryButtonText(L"Cancel subscription");
        dialog.CloseButtonText(L"Keep subscription");

        auto confirm = co_await dialog.ShowAsync();
        if (confirm != ContentDialogResult::Primary)
        {
            co_return;
        }

        ShowStatus(L"Cancelling active subscription...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().CancelSubscription();
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        ShowStatus(L"Subscription cancellation request sent successfully.", InfoBarSeverity::Success);
        RefreshBillingAsync(false);
    }

    fire_and_forget BillingPage::OnRemoveCardClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto const cardId = ReadTagInt(sender);
        if (cardId <= 0)
        {
            co_return;
        }

        ContentDialog dialog;
        dialog.XamlRoot(XamlRoot());
        dialog.RequestedTheme(ElementTheme::Dark);
        dialog.Title(box_value(L"Remove card"));
        dialog.Content(box_value(L"This will remove the selected card from the billing backend."));
        dialog.PrimaryButtonText(L"Remove");
        dialog.CloseButtonText(L"Cancel");

        auto confirm = co_await dialog.ShowAsync();
        if (confirm != ContentDialogResult::Primary)
        {
            co_return;
        }

        ShowStatus(L"Removing saved card...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto response = services::DrakonApiClient::Instance().RemoveBillingCard(cardId);
        co_await uiThread;

        if (!response.success)
        {
            ShowStatus(to_hstring(response.error), response.statusCode == 0 ? InfoBarSeverity::Warning : InfoBarSeverity::Error);
            co_return;
        }

        ShowStatus(L"Card removed from the backend billing profile.", InfoBarSeverity::Success);
        RefreshBillingAsync(false);
    }

    void BillingPage::OnTierSelectionClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto tag = ReadTagString(sender);
        if (!tag.empty())
        {
            m_selectedTier = tag;
            UpdateSelectionVisuals();
        }
    }

    void BillingPage::OnSpeedSelectionClick(IInspectable const& sender, RoutedEventArgs const&)
    {
        auto tag = ReadTagString(sender);
        if (!tag.empty())
        {
            m_selectedSecondsPerFrame = std::stoi(tag);
            UpdateSelectionVisuals();
        }
    }

    void BillingPage::OnCameraCountMinusClick(IInspectable const&, RoutedEventArgs const&)
    {
        m_cameraCount = (std::max)(1, m_cameraCount - 1);
        UpdateSelectionVisuals();
    }

    void BillingPage::OnCameraCountPlusClick(IInspectable const&, RoutedEventArgs const&)
    {
        m_cameraCount = (std::min)(32, m_cameraCount + 1);
        UpdateSelectionVisuals();
    }

    void BillingPage::OnRefreshClick(IInspectable const&, RoutedEventArgs const&)
    {
        RefreshBillingAsync(true);
    }

    void BillingPage::OnPageSizeChanged(IInspectable const&, SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }
}

#include "pch.h"
#include "..\\BootstrapTrace.h"
#include "AIAgentsPage.xaml.h"
#include "BillingPage.xaml.h"
#include "CamerasPage.xaml.h"
#include "ChatPage.xaml.h"
#include "DashboardPage.xaml.h"
#include "DrakonFindPage.xaml.h"
#include "JobsPage.xaml.h"
#include "LoginPage.xaml.h"
#include "ModulePlaceholderPage.xaml.h"
#include "SettingsPage.xaml.h"
#include "ShellPage.xaml.h"
#include "../Services/DrakonApiClient.h"

#include <array>
#include <cctype>
#include <iomanip>
#include <initializer_list>
#include <sstream>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::UI::Xaml::Media;

namespace winrt::DrakonDesktop::implementation
{
    namespace
    {
        Brush LookupBrush(hstring const& key)
        {
            return Application::Current().Resources().Lookup(box_value(key)).as<Brush>();
        }

        std::string FormatMillions(int64_t value)
        {
            std::ostringstream stream;
            stream << std::fixed << std::setprecision(1) << (static_cast<double>(value) / 1000000.0);
            return stream.str();
        }

        struct ModuleSpec
        {
            hstring title;
            hstring subtitle;
            hstring source;
        };

        ModuleSpec GetModuleSpec(hstring const& destination)
        {
            if (destination == L"cameras")
            {
                return {
                    L"Câmeras",
                    L"Vai incorporar leitura de runtime nativo, thumbnails, stream health e controles operacionais.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\Cameras.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\camera"
                };
            }

            if (destination == L"jobs")
            {
                return {
                    L"Jobs",
                    L"Vai portar pipelines, agenda temporal, etapas, comandos pendentes e histórico operacional.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\Jobs.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\jobs"
                };
            }

            if (destination == L"chat")
            {
                return {
                    L"Drakon Chat",
                    L"Vai consolidar o chat operacional, quick actions e inferência vinculada aos agentes.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\Chat.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\orchestrator"
                };
            }

            if (destination == L"drakon-find")
            {
                return {
                    L"Drakon Find",
                    L"Vai portar busca operacional, investigação multimídia e navegação por evidências.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\DrakonFind.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\orchestrator"
                };
            }

            if (destination == L"ai-agents")
            {
                return {
                    L"AI Agents",
                    L"Vai concentrar catálogo, configuração, estado e acionamento dos agentes operacionais.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\AIAgents.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\orchestrator"
                };
            }

            if (destination == L"billing")
            {
                return {
                    L"Billing",
                    L"Vai portar uso de tokens, custos, planos e acoplamento com a camada financeira existente.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\Billing.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\comm"
                };
            }

            if (destination == L"events")
            {
                return {
                    L"Logs & Events",
                    L"Vai concentrar monitoramento, notificações, eventos operacionais, atividade do sistema e trilha de detecções.",
                    L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\Events.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\jobs"
                };
            }

            return {
                L"Settings",
                L"Vai unificar chaves de API, Telegram, pairing, branding e preferências locais do desktop.",
                L"Fonte: C:\\dev\\DrakonSite\\src\\react-app\\pages\\Settings.tsx + C:\\dev\\perceptrum_app\\Perceptrum\\app"
            };
        }
    }

    ShellPage::ShellPage()
    {
        AppendBootstrapTrace("shell: ctor");
        InitializeComponent();
        WireUpNavigation();
        SizeChanged({ this, &ShellPage::OnShellSizeChanged });
        UpdateResponsiveState(ActualWidth());
        LoadShellChromeAsync();
    }

    void ShellPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/ShellPage.xaml" });

        m_initialized = true;
    }

    void ShellPage::WireUpNavigation()
    {
        m_contentFrame = FindName(L"ContentFrame").as<Microsoft::UI::Xaml::Controls::Frame>();
        FindName(L"NavDashboardButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavAIAgentsButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavDrakonFindButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavJobsButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavChatButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavCamerasButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavEventsButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NavSettingsButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"TokenBalanceButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"SystemActivityButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"NotificationsButton").as<Button>().Click({ this, &ShellPage::OnNavigationButtonClick });
        FindName(L"SidebarToggleButton").as<Button>().Click({ this, &ShellPage::OnSidebarToggleClick });
        FindName(L"LogoutButton").as<Button>().Click({ this, &ShellPage::OnLogoutClick });

        NavigateTo(L"login");
    }

    void ShellPage::SetNamedText(hstring const& elementName, hstring const& value)
    {
        if (auto text = FindName(elementName).try_as<TextBlock>())
        {
            text.Text(value);
        }
    }

    void ShellPage::UpdateNavigationSelection(hstring const& destination)
    {
        auto setState = [&](hstring const& elementName, bool active)
            {
                if (auto button = FindName(elementName).try_as<Button>())
                {
                    button.Background(active ? LookupBrush(L"DrakonShellActiveBrush") : Brush{ nullptr });
                    button.BorderBrush(active ? LookupBrush(L"DrakonShellActiveBorderBrush") : Brush{ nullptr });
                    button.Foreground(active ? LookupBrush(L"DrakonAccentBrush") : LookupBrush(L"DrakonSecondaryTextBrush"));
                }
            };

        setState(L"NavDashboardButton", destination == L"dashboard");
        setState(L"NavAIAgentsButton", destination == L"ai-agents");
        setState(L"NavDrakonFindButton", destination == L"drakon-find");
        setState(L"NavJobsButton", destination == L"jobs");
        setState(L"NavChatButton", destination == L"chat");
        setState(L"NavCamerasButton", destination == L"cameras");
        setState(L"NavEventsButton", destination == L"events");
        setState(L"NavSettingsButton", destination == L"settings");
    }

    void ShellPage::ApplySidebarState(bool collapsed)
    {
        m_effectiveSidebarCollapsed = collapsed;

        auto sidebarColumn = FindName(L"SidebarColumnDefinition").as<ColumnDefinition>();
        sidebarColumn.Width(collapsed
            ? GridLengthHelper::FromPixels(92.0)
            : GridLengthHelper::FromPixels(306.0));

        auto setElementVisibility = [&](hstring const& name, Microsoft::UI::Xaml::Visibility value)
            {
                if (auto element = FindName(name).try_as<FrameworkElement>())
                {
                    element.Visibility(value);
                }
            };

        auto expandedVisibility = collapsed ? Microsoft::UI::Xaml::Visibility::Collapsed : Microsoft::UI::Xaml::Visibility::Visible;
        auto collapsedVisibility = collapsed ? Microsoft::UI::Xaml::Visibility::Visible : Microsoft::UI::Xaml::Visibility::Collapsed;

        setElementVisibility(L"SidebarExpandedLogoImage", expandedVisibility);
        setElementVisibility(L"AppearanceExpandedPanel", expandedVisibility);
        setElementVisibility(L"UserDetailsPanel", expandedVisibility);
        setElementVisibility(L"LogoutText", expandedVisibility);
        setElementVisibility(L"SidebarCollapsedLogoImage", collapsedVisibility);
        setElementVisibility(L"AppearanceCollapsedPanel", collapsedVisibility);
        setElementVisibility(L"NavDashboardText", expandedVisibility);
        setElementVisibility(L"NavAIAgentsText", expandedVisibility);
        setElementVisibility(L"NavDrakonFindText", expandedVisibility);
        setElementVisibility(L"NavJobsText", expandedVisibility);
        setElementVisibility(L"NavChatText", expandedVisibility);
        setElementVisibility(L"NavCamerasText", expandedVisibility);
        setElementVisibility(L"NavEventsText", expandedVisibility);
        setElementVisibility(L"NavSettingsText", expandedVisibility);

        std::array<hstring, 8> navButtonNames{
            L"NavDashboardButton",
            L"NavAIAgentsButton",
            L"NavDrakonFindButton",
            L"NavJobsButton",
            L"NavChatButton",
            L"NavCamerasButton",
            L"NavEventsButton",
            L"NavSettingsButton"
        };

        for (auto const& name : navButtonNames)
        {
            if (auto button = FindName(name).try_as<Button>())
            {
                button.HorizontalContentAlignment(collapsed ? HorizontalAlignment::Center : HorizontalAlignment::Stretch);
                button.Padding(collapsed ? ThicknessHelper::FromLengths(0.0, 14.0, 0.0, 14.0) : ThicknessHelper::FromLengths(18.0, 14.0, 18.0, 14.0));
            }
        }

        if (auto logoutButton = FindName(L"LogoutButton").try_as<Button>())
        {
            logoutButton.HorizontalContentAlignment(collapsed ? HorizontalAlignment::Center : HorizontalAlignment::Stretch);
            logoutButton.Padding(collapsed ? ThicknessHelper::FromLengths(0.0, 12.0, 0.0, 12.0) : ThicknessHelper::FromLengths(14.0, 12.0, 14.0, 12.0));
        }
    }

    void ShellPage::UpdateResponsiveState(double width)
    {
        auto compactHeader = width > 0 && width < 980;
        auto collapseSidebar = m_userCollapsedSidebar || (width > 0 && width < 920);

        ApplySidebarState(collapseSidebar);

        if (auto tokenButton = FindName(L"TokenBalanceButton").try_as<FrameworkElement>())
        {
            tokenButton.Visibility(compactHeader ? Visibility::Collapsed : Visibility::Visible);
        }

        if (auto systemActivityText = FindName(L"SystemActivityText").try_as<FrameworkElement>())
        {
            systemActivityText.Visibility(width > 0 && width < 900 ? Visibility::Collapsed : Visibility::Visible);
        }

        if (auto languageLabel = FindName(L"LanguageLabelText").try_as<FrameworkElement>())
        {
            languageLabel.Visibility(width > 0 && width < 860 ? Visibility::Collapsed : Visibility::Visible);
        }
    }

    void ShellPage::OnShellSizeChanged(
        Windows::Foundation::IInspectable const&,
        SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }

    void ShellPage::NavigateTo(hstring const& destination)
    {
        if (!m_contentFrame)
        {
            return;
        }

        m_currentDestination = destination;
        UpdateNavigationSelection(destination);

        if (destination == L"dashboard")
        {
            m_contentFrame.Content(make<DashboardPage>());
            SetNamedText(L"CurrentPageTitleText", L"Dashboard");
            return;
        }

        if (destination == L"cameras")
        {
            m_contentFrame.Content(make<CamerasPage>());
            SetNamedText(L"CurrentPageTitleText", L"Cameras");
            return;
        }

        if (destination == L"ai-agents")
        {
            m_contentFrame.Content(make<AIAgentsPage>());
            SetNamedText(L"CurrentPageTitleText", L"AI Agents");
            return;
        }

        if (destination == L"chat")
        {
            m_contentFrame.Content(make<ChatPage>());
            SetNamedText(L"CurrentPageTitleText", L"Drakon Chat");
            return;
        }

        if (destination == L"jobs")
        {
            m_contentFrame.Content(make<JobsPage>());
            SetNamedText(L"CurrentPageTitleText", L"Jobs");
            return;
        }

        if (destination == L"drakon-find")
        {
            m_contentFrame.Content(make<DrakonFindPage>());
            SetNamedText(L"CurrentPageTitleText", L"Drakon Find");
            return;
        }

        if (destination == L"billing")
        {
            m_contentFrame.Content(make<BillingPage>());
            SetNamedText(L"CurrentPageTitleText", L"Billing");
            return;
        }

        if (destination == L"login")
        {
            m_contentFrame.Content(make<LoginPage>());
            SetNamedText(L"CurrentPageTitleText", L"Login");
            return;
        }

        if (destination == L"settings")
        {
            m_contentFrame.Content(make<SettingsPage>());
            SetNamedText(L"CurrentPageTitleText", L"Settings");
            return;
        }

        auto placeholder = winrt::make_self<ModulePlaceholderPage>();
        auto spec = GetModuleSpec(destination);
        placeholder->Configure(spec.title, spec.subtitle, spec.source);
        m_contentFrame.Content(*placeholder);
        SetNamedText(L"CurrentPageTitleText", spec.title);
    }

    fire_and_forget ShellPage::LoadShellChromeAsync()
    {
        auto lifetime = get_strong();
        apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        auto tokens = services::DrakonApiClient::Instance().GetTokenBalance();
        co_await uiThread;

        if (auth.success && auth.value.isAuthenticated)
        {
            auto displayName = auth.value.displayName.empty() ? auth.value.email : auth.value.displayName;
            SetNamedText(L"CurrentUserNameText", to_hstring(displayName));
            SetNamedText(L"CurrentUserEmailText", to_hstring(auth.value.email));

            auto initial = displayName.empty() ? std::string("D") : std::string(1, static_cast<char>(std::toupper(static_cast<unsigned char>(displayName.front()))));
            SetNamedText(L"CurrentUserInitialText", to_hstring(initial));

            if (m_currentDestination == L"login")
            {
                NavigateTo(L"dashboard");
            }
        }
        else
        {
            SetNamedText(L"CurrentUserNameText", L"Local Session");
            SetNamedText(L"CurrentUserEmailText", L"Faça login para carregar dados do backend");
            SetNamedText(L"CurrentUserInitialText", L"D");
        }

        if (tokens.success)
        {
            SetNamedText(L"HeaderInputTokensText", to_hstring(FormatMillions(tokens.value.inputBalance)) + L"M");
            SetNamedText(L"HeaderOutputTokensText", to_hstring(FormatMillions(tokens.value.outputBalance)) + L"M");
        }
    }

    void ShellPage::OnNavigationButtonClick(
        Windows::Foundation::IInspectable const& sender,
        RoutedEventArgs const&)
    {
        if (auto element = sender.try_as<FrameworkElement>())
        {
            auto destination = unbox_value_or<hstring>(element.Tag(), L"dashboard");
            NavigateTo(destination);
        }
    }

    void ShellPage::OnSidebarToggleClick(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        m_userCollapsedSidebar = !m_userCollapsedSidebar;
        UpdateResponsiveState(ActualWidth());
    }

    void ShellPage::OnLogoutClick(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        services::DrakonApiClient::Instance().LocalLogout();
        SetNamedText(L"CurrentUserNameText", L"Local Session");
        SetNamedText(L"CurrentUserEmailText", L"Faça login para carregar dados do backend");
        SetNamedText(L"CurrentUserInitialText", L"D");
        NavigateTo(L"login");
    }
}

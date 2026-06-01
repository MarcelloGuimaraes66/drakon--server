#include "pch.h"
#include "LoginPage.xaml.h"
#include "../Services/DrakonApiClient.h"

#include <winrt/Microsoft.UI.Dispatching.h>

#include <algorithm>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;

namespace
{
    bool IsValidEmail(std::string const& value)
    {
        auto const at = value.find('@');
        auto const dot = value.rfind('.');
        return at != std::string::npos && dot != std::string::npos && at < dot;
    }

    bool SetComboSelectionByTag(ComboBox const& comboBox, std::string const& code)
    {
        auto const normalized = code;
        for (uint32_t index = 0; index < comboBox.Items().Size(); ++index)
        {
            if (auto item = comboBox.Items().GetAt(index).try_as<ComboBoxItem>())
            {
                auto tag = winrt::to_string(unbox_value_or<hstring>(item.Tag(), L""));
                if (_stricmp(tag.c_str(), normalized.c_str()) == 0)
                {
                    comboBox.SelectedIndex(static_cast<int32_t>(index));
                    return true;
                }
            }
        }

        return false;
    }

    std::string SelectedComboTag(ComboBox const& comboBox)
    {
        if (auto item = comboBox.SelectedItem().try_as<ComboBoxItem>())
        {
            return winrt::to_string(unbox_value_or<hstring>(item.Tag(), L""));
        }

        return {};
    }
}

namespace winrt::DrakonDesktop::implementation
{
    LoginPage::LoginPage()
    {
        InitializeComponent();
        WireUpActions();
        LoadInitialContextAsync();
        SizeChanged({ this, &LoginPage::OnPageSizeChanged });
        UpdateResponsiveState(ActualWidth());
    }

    void LoginPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/LoginPage.xaml" });

        m_initialized = true;
    }

    void LoginPage::WireUpActions()
    {
        FindName(L"DesktopLoginSubmitButton").as<Button>().Click({ this, &LoginPage::OnLoginClick });
        FindName(L"CompactLoginSubmitButton").as<Button>().Click({ this, &LoginPage::OnLoginClick });
        FindName(L"DesktopSignupSubmitButton").as<Button>().Click({ this, &LoginPage::OnSignupClick });
        FindName(L"CompactSignupSubmitButton").as<Button>().Click({ this, &LoginPage::OnSignupClick });
        FindName(L"DesktopGoogleLoginButton").as<Button>().Click({ this, &LoginPage::OnUnavailableActionClick });
        FindName(L"CompactGoogleLoginButton").as<Button>().Click({ this, &LoginPage::OnUnavailableActionClick });
        FindName(L"DesktopForgotPasswordButton").as<Button>().Click({ this, &LoginPage::OnUnavailableActionClick });
        FindName(L"CompactForgotPasswordButton").as<Button>().Click({ this, &LoginPage::OnUnavailableActionClick });
    }

    void LoginPage::UpdateResponsiveState(double width)
    {
        auto desktop = FindName(L"DesktopLayout").try_as<FrameworkElement>();
        auto compact = FindName(L"CompactLayout").try_as<FrameworkElement>();
        auto topDesktop = FindName(L"TopActionsDesktop").try_as<FrameworkElement>();
        auto topCompact = FindName(L"TopActionsCompact").try_as<FrameworkElement>();

        if (!desktop || !compact || !topDesktop || !topCompact)
        {
            return;
        }

        auto const compactMode = width > 0 && width < 1100;

        desktop.Visibility(compactMode ? Visibility::Collapsed : Visibility::Visible);
        compact.Visibility(compactMode ? Visibility::Visible : Visibility::Collapsed);
        topDesktop.Visibility(compactMode ? Visibility::Collapsed : Visibility::Visible);
        topCompact.Visibility(compactMode ? Visibility::Visible : Visibility::Collapsed);
    }

    bool LoginPage::IsCompactMode() const
    {
        if (auto compact = FindName(L"CompactLayout").try_as<FrameworkElement>())
        {
            return compact.Visibility() == Visibility::Visible;
        }

        return false;
    }

    void LoginPage::ShowStatus(hstring const& message, InfoBarSeverity severity)
    {
        auto infoBar = FindName(L"LoginPageInfoBar").as<InfoBar>();
        infoBar.Message(message);
        infoBar.Severity(severity);
        infoBar.IsOpen(true);
    }

    fire_and_forget LoginPage::LoadInitialContextAsync()
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        co_await winrt::resume_background();
        auto auth = services::DrakonApiClient::Instance().GetAuthState();
        auto country = services::DrakonApiClient::Instance().DetectCountry();
        co_await uiThread;

        if (country.success && !country.value.empty())
        {
            SetComboSelectionByTag(FindName(L"DesktopSignupCountryComboBox").as<ComboBox>(), country.value);
            SetComboSelectionByTag(FindName(L"CompactSignupCountryComboBox").as<ComboBox>(), country.value);
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            ShowStatus(
                L"Session active for " + to_hstring(auth.value.email) + L". Cameras e billing ja podem usar o backend.",
                InfoBarSeverity::Success);
        }
    }

    fire_and_forget LoginPage::OnLoginClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto emailBox = IsCompactMode()
            ? FindName(L"CompactLoginEmailTextBox").as<TextBox>()
            : FindName(L"DesktopLoginEmailTextBox").as<TextBox>();
        auto passwordBox = IsCompactMode()
            ? FindName(L"CompactLoginPasswordBox").as<PasswordBox>()
            : FindName(L"DesktopLoginPasswordBox").as<PasswordBox>();
        auto desktopButton = FindName(L"DesktopLoginSubmitButton").as<Button>();
        auto compactButton = FindName(L"CompactLoginSubmitButton").as<Button>();

        auto const email = winrt::to_string(emailBox.Text());
        auto const password = winrt::to_string(passwordBox.Password());

        if (!IsValidEmail(email) || password.empty())
        {
            ShowStatus(L"Informe um e-mail valido e uma senha para entrar.", InfoBarSeverity::Error);
            co_return;
        }

        desktopButton.IsEnabled(false);
        compactButton.IsEnabled(false);
        ShowStatus(L"Autenticando com /api/auth/local/login...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto result = services::DrakonApiClient::Instance().LocalLogin(email, password);
        auto auth = result.success ? services::DrakonApiClient::Instance().GetAuthState() : services::ServiceValueResponse<services::AuthState>{};
        co_await uiThread;

        desktopButton.IsEnabled(true);
        compactButton.IsEnabled(true);

        if (!result.success)
        {
            ShowStatus(to_hstring(result.error), InfoBarSeverity::Error);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            ShowStatus(
                L"Login concluido para " + to_hstring(auth.value.email) + L". Abra Cameras, Billing ou Dashboard para continuar.",
                InfoBarSeverity::Success);
        }
        else
        {
            ShowStatus(L"Login concluido e sessao local criada.", InfoBarSeverity::Success);
        }
    }

    fire_and_forget LoginPage::OnSignupClick(IInspectable const&, RoutedEventArgs const&)
    {
        auto lifetime = get_strong();
        winrt::apartment_context uiThread;

        auto emailBox = IsCompactMode()
            ? FindName(L"CompactSignupEmailTextBox").as<TextBox>()
            : FindName(L"DesktopSignupEmailTextBox").as<TextBox>();
        auto passwordBox = IsCompactMode()
            ? FindName(L"CompactSignupPasswordBox").as<PasswordBox>()
            : FindName(L"DesktopSignupPasswordBox").as<PasswordBox>();
        auto countryComboBox = IsCompactMode()
            ? FindName(L"CompactSignupCountryComboBox").as<ComboBox>()
            : FindName(L"DesktopSignupCountryComboBox").as<ComboBox>();
        auto termsCheckBox = IsCompactMode()
            ? FindName(L"CompactSignupTermsCheckBox").as<CheckBox>()
            : FindName(L"DesktopSignupTermsCheckBox").as<CheckBox>();
        auto desktopButton = FindName(L"DesktopSignupSubmitButton").as<Button>();
        auto compactButton = FindName(L"CompactSignupSubmitButton").as<Button>();

        auto const email = winrt::to_string(emailBox.Text());
        auto const password = winrt::to_string(passwordBox.Password());
        auto const countryCode = SelectedComboTag(countryComboBox);
        auto const acceptedTerms = unbox_value_or<bool>(termsCheckBox.IsChecked(), false);

        if (!IsValidEmail(email))
        {
            ShowStatus(L"Informe um e-mail valido para criar a conta.", InfoBarSeverity::Error);
            co_return;
        }

        if (password.size() < 8)
        {
            ShowStatus(L"A senha precisa ter ao menos 8 caracteres.", InfoBarSeverity::Error);
            co_return;
        }

        if (countryCode.empty())
        {
            ShowStatus(L"Selecione um pais antes de criar a conta.", InfoBarSeverity::Error);
            co_return;
        }

        if (!acceptedTerms)
        {
            ShowStatus(L"Voce precisa aceitar os termos para continuar.", InfoBarSeverity::Error);
            co_return;
        }

        desktopButton.IsEnabled(false);
        compactButton.IsEnabled(false);
        ShowStatus(L"Criando conta com /api/auth/local/signup...", InfoBarSeverity::Informational);

        co_await winrt::resume_background();
        auto result = services::DrakonApiClient::Instance().LocalSignup(email, password, countryCode);
        auto auth = result.success ? services::DrakonApiClient::Instance().GetAuthState() : services::ServiceValueResponse<services::AuthState>{};
        co_await uiThread;

        desktopButton.IsEnabled(true);
        compactButton.IsEnabled(true);

        if (!result.success)
        {
            ShowStatus(to_hstring(result.error), InfoBarSeverity::Error);
            co_return;
        }

        if (auth.success && auth.value.isAuthenticated)
        {
            ShowStatus(
                L"Conta criada para " + to_hstring(auth.value.email) + L". A sessao local ja esta pronta para usar Cameras e Billing.",
                InfoBarSeverity::Success);
        }
        else
        {
            ShowStatus(L"Conta criada com sucesso.", InfoBarSeverity::Success);
        }
    }

    void LoginPage::OnUnavailableActionClick(IInspectable const&, RoutedEventArgs const&)
    {
        ShowStatus(
            L"Este botao ainda nao esta ligado ao fluxo nativo correspondente. O login local ja esta funcional nesta etapa.",
            InfoBarSeverity::Warning);
    }

    void LoginPage::OnPageSizeChanged(
        Windows::Foundation::IInspectable const&,
        SizeChangedEventArgs const& args)
    {
        UpdateResponsiveState(args.NewSize().Width);
    }
}

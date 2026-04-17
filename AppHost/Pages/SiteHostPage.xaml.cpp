#include "pch.h"
#include "SiteHostPage.xaml.h"

#include "../App.xaml.h"
#include "../BootstrapTrace.h"
#include "../MainWindow.xaml.h"
#include "../Platform/AppRuntimeConfig.h"

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cwctype>
#include <nlohmann/json.hpp>
#include <shellapi.h>
#include <utility>

using namespace winrt;
using namespace Microsoft::UI::Xaml;
using namespace Microsoft::UI::Xaml::Controls;
using namespace Microsoft::Web::WebView2::Core;
using json = nlohmann::json;

namespace winrt::DrakonDesktop::implementation
{
    namespace
    {
        constexpr wchar_t kUiUrlEnvVar[] = L"DRAKON_UI_URL";
        constexpr auto kOverlayRevealDelay = std::chrono::milliseconds(800);
        constexpr char kNativeResidentRuntimeBridgeScript[] = R"JS(
(() => {
  if (window.__drakonDesktopNativeBridgeInstalled) {
    return;
  }

  window.__drakonDesktopNativeBridgeInstalled = true;
  window.__drakonDesktopShell = true;
  let busy = false;
  let completed = Boolean(window.__drakonDesktopPairRuntimeCompleted);

  function getTheme() {
    const root = document.documentElement;
    if (root && root.classList.contains("light")) {
      return "light";
    }
    if (root && root.classList.contains("dark")) {
      return "dark";
    }
    return "dark";
  }

  let lastTheme = "";

  function cleanSessionValue(value) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || /[\u0000-\u001f\u007f]/.test(text)) {
      return "";
    }
    return text;
  }

  function reportTheme() {
    if (!window.chrome || !window.chrome.webview) {
      return;
    }
    const theme = getTheme();
    if (!theme || theme === lastTheme) {
      return;
    }
    lastTheme = theme;
    window.chrome.webview.postMessage({
      type: "theme-changed",
      theme
    });
  }

  function watchTheme() {
    if (!document.documentElement || typeof MutationObserver !== "function") {
      reportTheme();
      return;
    }

    reportTheme();

    const observer = new MutationObserver(() => {
      reportTheme();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"]
    });

    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "data-theme"]
      });
    }

    window.addEventListener("load", reportTheme);
    window.addEventListener("pageshow", reportTheme);
    document.addEventListener("readystatechange", reportTheme);
  }

  async function tryProvisionResidentRuntime() {
    if (window.__drakonDesktopPairRuntimeCompleted) {
      completed = true;
    }

    if (busy || completed || !window.chrome || !window.chrome.webview) {
      return;
    }

    busy = true;
    try {
      const response = await fetch("/api/runtime/local-session", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          timezone_iana:
            (Intl.DateTimeFormat().resolvedOptions &&
              Intl.DateTimeFormat().resolvedOptions().timeZone) || ""
        })
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const clientId = cleanSessionValue(payload && payload.client_id);
      const exeId = cleanSessionValue(payload && payload.exe_id);
      const exeToken = cleanSessionValue(payload && payload.exe_token);
      if (clientId && exeId && exeToken) {
        window.chrome.webview.postMessage({
          type: "resident-runtime-session",
          client_id: clientId,
          exe_id: exeId,
          exe_token: exeToken,
          timezone_iana:
            cleanSessionValue(payload && payload.timezone_iana)
        });
      }
    } catch {
    } finally {
      busy = false;
    }
  }

  window.__drakonDesktopTryResidentRuntime = tryProvisionResidentRuntime;
  window.__drakonDesktopTryPairRuntime = tryProvisionResidentRuntime;
  window.__drakonDesktopReportTheme = reportTheme;
  watchTheme();
  setInterval(tryProvisionResidentRuntime, 10000);
  setTimeout(tryProvisionResidentRuntime, 1200);
  setTimeout(reportTheme, 400);
})();
)JS";

        std::wstring ResolveUiUrl()
        {
            wchar_t buffer[2048]{};
            auto const written = GetEnvironmentVariableW(kUiUrlEnvVar, buffer, static_cast<DWORD>(std::size(buffer)));
            if (written == 0 || written >= std::size(buffer))
            {
                return L"http://127.0.0.1:4000/dashboard";
            }

            std::wstring base(buffer, written);
            if (base.empty())
            {
                return L"http://127.0.0.1:4000/dashboard";
            }

            if (base.ends_with(L"/dashboard") || base.ends_with(L"/login"))
            {
                return base;
            }

            if (!base.ends_with(L"/"))
            {
                base += L'/';
            }

            return base + L"dashboard";
        }

        std::wstring ResolveLoginUrl()
        {
            auto uiUrl = ResolveUiUrl();
            if (uiUrl.ends_with(L"/login"))
            {
                return uiUrl;
            }

            if (uiUrl.ends_with(L"/dashboard"))
            {
                return uiUrl.substr(0, uiUrl.size() - std::wstring(L"/dashboard").size()) + L"/login";
            }

            if (!uiUrl.ends_with(L"/"))
            {
                uiUrl += L'/';
            }

            return uiUrl + L"login";
        }

        std::wstring ReadEnvValue(wchar_t const* name)
        {
            wchar_t buffer[4096]{};
            auto const written = GetEnvironmentVariableW(name, buffer, static_cast<DWORD>(std::size(buffer)));
            if (written == 0 || written >= std::size(buffer))
            {
                return {};
            }

            return std::wstring(buffer, written);
        }

        std::wstring ReadBackendBootstrapError()
        {
            return ReadEnvValue(L"DRAKON_BACKEND_BOOTSTRAP_ERROR");
        }

        std::wstring ToLowerCopy(std::wstring value)
        {
            std::transform(value.begin(), value.end(), value.begin(), [](wchar_t ch)
            {
                return static_cast<wchar_t>(std::towlower(ch));
            });
            return value;
        }

        std::string TrimAsciiCopy(std::string value)
        {
            auto isSpace = [](unsigned char ch)
            {
                return std::isspace(ch) != 0;
            };

            while (!value.empty() && isSpace(static_cast<unsigned char>(value.front())))
            {
                value.erase(value.begin());
            }

            while (!value.empty() && isSpace(static_cast<unsigned char>(value.back())))
            {
                value.pop_back();
            }

            return value;
        }

        std::string CleanBridgeSessionValue(std::string value)
        {
            value = TrimAsciiCopy(std::move(value));
            if (value.empty())
            {
                return {};
            }

            auto const hasControlByte = std::any_of(value.begin(), value.end(), [](unsigned char ch)
            {
                return ch < 0x20 || ch == 0x7F;
            });

            return hasControlByte ? std::string{} : value;
        }

        std::wstring BuildOrigin(Windows::Foundation::Uri const& uri)
        {
            std::wstring origin = uri.SchemeName().c_str();
            origin += L"://";
            origin += uri.Host().c_str();

            auto const scheme = ToLowerCopy(std::wstring(uri.SchemeName().c_str()));
            auto const port = uri.Port();
            auto const defaultPort =
                (scheme == L"http" && port == 80) ||
                (scheme == L"https" && port == 443);
            if (port > 0 && !defaultPort)
            {
                origin += L":";
                origin += std::to_wstring(port);
            }

            return origin;
        }

        std::wstring BuildCallbackRewriteUri(std::wstring const& navigationUri)
        {
            try
            {
                Windows::Foundation::Uri const targetUri{ navigationUri };
                auto const callbackPath = ToLowerCopy(std::wstring(targetUri.Path().c_str()));
                if (callbackPath != L"/auth/callback")
                {
                    return {};
                }

                auto const absolute = std::wstring(targetUri.AbsoluteUri().c_str());
                auto const callbackPos = absolute.find(L"/auth/callback");
                if (callbackPos == std::wstring::npos)
                {
                    return {};
                }

                Windows::Foundation::Uri const uiUri{ ResolveUiUrl() };
                auto const uiOrigin = BuildOrigin(uiUri);
                if (_wcsicmp(BuildOrigin(targetUri).c_str(), uiOrigin.c_str()) == 0)
                {
                    return {};
                }

                return uiOrigin + absolute.substr(callbackPos);
            }
            catch (...)
            {
                return {};
            }
        }
    }

    SiteHostPage::SiteHostPage()
    {
        auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
        InitializeComponent();

        auto webView = FindName(L"SiteWebView").as<WebView2>();
        webView.NavigationCompleted({ this, &SiteHostPage::OnNavigationCompleted });

        FindName(L"BackButton").as<Button>().Click({ this, &SiteHostPage::OnBackClick });
        FindName(L"ReloadButton").as<Button>().Click({ this, &SiteHostPage::OnReloadClick });
        FindName(L"OpenInBrowserButton").as<Button>().Click({ this, &SiteHostPage::OnOpenInBrowserClick });
        Loaded({ this, &SiteHostPage::OnPageLoaded });

        SetStatus(
            winrt::hstring(std::wstring(L"Preparando ") + runtimeConfig.displayName),
            L"Abrindo a interface local do aplicativo.",
            true,
            false);
    }

    void SiteHostPage::InitializeComponent()
    {
        if (m_initialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///Pages/SiteHostPage.xaml" });

        m_initialized = true;
    }

    void SiteHostPage::SetStatus(
        hstring const& title,
        hstring const& detail,
        bool isBusy,
        bool showOverlay)
    {
        if (auto titleText = FindName(L"StatusTitleText").try_as<TextBlock>())
        {
            titleText.Text(title);
        }

        if (auto detailText = FindName(L"StatusDetailText").try_as<TextBlock>())
        {
            detailText.Text(detail);
        }

        if (auto ring = FindName(L"LoadingProgressRing").try_as<ProgressRing>())
        {
            ring.IsActive(isBusy);
        }

        if (auto overlay = FindName(L"LoadingOverlay").try_as<FrameworkElement>())
        {
            overlay.Visibility(showOverlay ? Visibility::Visible : Visibility::Collapsed);
        }

        if (auto actionsHost = FindName(L"OverlayActionsHost").try_as<FrameworkElement>())
        {
            actionsHost.Visibility((showOverlay && !isBusy) ? Visibility::Visible : Visibility::Collapsed);
        }
    }

    void SiteHostPage::UpdateNavigationButtons(WebView2 const& webView)
    {
        bool showBackButton = false;

        try
        {
            Windows::Foundation::Uri const uiUri{ ResolveUiUrl() };
            auto const uiOrigin = BuildOrigin(uiUri);

            if (auto const source = webView.Source())
            {
                auto const sourceOrigin = BuildOrigin(source);
                auto const sourcePath = ToLowerCopy(std::wstring(source.Path().c_str()));
                auto const isExternalSurface = _wcsicmp(sourceOrigin.c_str(), uiOrigin.c_str()) != 0;
                auto const isAuthCallback = sourcePath == L"/auth/callback";
                showBackButton = isExternalSurface || isAuthCallback;
            }
        }
        catch (...)
        {
        }

        if (auto host = FindName(L"BackButtonHost").try_as<FrameworkElement>())
        {
            host.Visibility(showBackButton ? Visibility::Visible : Visibility::Collapsed);
        }
    }

    fire_and_forget SiteHostPage::RevealLoadingOverlayAfterDelay(std::uint64_t navigationToken)
    {
        auto lifetime = get_strong();
        apartment_context uiThread;
        co_await winrt::resume_after(kOverlayRevealDelay);
        co_await uiThread;

        if (navigationToken != m_navigationToken || !m_navigationInFlight)
        {
            co_return;
        }

        auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
        SetStatus(
            winrt::hstring(std::wstring(L"Preparando ") + runtimeConfig.displayName),
            L"A interface esta iniciando com os servicos locais protegidos.",
            true,
            true);
    }

    fire_and_forget SiteHostPage::NavigateToLiveSite(bool forceReload)
    {
        auto lifetime = get_strong();
        auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
        auto const navigationToken = ++m_navigationToken;
        m_navigationInFlight = true;

        SetStatus(
            winrt::hstring(std::wstring(L"Preparando ") + runtimeConfig.displayName),
            L"A interface local esta sendo aberta.",
            true,
            false);
        RevealLoadingOverlayAfterDelay(navigationToken);

        try
        {
            auto webView = FindName(L"SiteWebView").as<WebView2>();
            co_await webView.EnsureCoreWebView2Async();

            if (auto core = webView.CoreWebView2())
            {
                core.Settings().AreDefaultContextMenusEnabled(false);
                core.Settings().AreDevToolsEnabled(true);
                core.Settings().IsStatusBarEnabled(false);
                // Keep the desktop shell at a fixed scale. On WebView2, trackpad pinch
                // and browser zoom controls can resize the entire app surface.
                core.Settings().IsZoomControlEnabled(false);
                core.Settings().IsPinchZoomEnabled(false);
                if (!m_webViewHooksInstalled)
                {
                    core.NavigationStarting({ this, &SiteHostPage::OnNavigationStarting });
                    core.HistoryChanged({ this, &SiteHostPage::OnHistoryChanged });
                    m_webViewHooksInstalled = true;
                }
            }

            InstallNativePairingBridge(webView);

            if (forceReload && webView.Source())
            {
                webView.Reload();
                co_return;
            }

            m_navigationStarted = true;
            webView.Source(Windows::Foundation::Uri{ ResolveUiUrl() });
            UpdateNavigationButtons(webView);
        }
        catch (winrt::hresult_error const& ex)
        {
            m_navigationInFlight = false;
            AppendBootstrapTrace("site-host: webview init failed");
            AppendBootstrapTrace(winrt::to_string(ex.message()));
            SetStatus(
                L"Falha ao abrir a interface do aplicativo",
                ex.message(),
                false,
                true);
        }
    }

    void SiteHostPage::OnPageLoaded(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        auto const startupError = ReadBackendBootstrapError();
        if (!startupError.empty())
        {
            SetStatus(
                L"Falha ao inicializar o backend local",
                winrt::hstring(startupError),
                false,
                true);
            return;
        }

        if (!m_navigationStarted)
        {
            NavigateToLiveSite(false);
        }
    }

    void SiteHostPage::OnBackClick(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        auto webView = FindName(L"SiteWebView").as<WebView2>();

        try
        {
            if (webView.CanGoBack())
            {
                webView.GoBack();
                return;
            }
        }
        catch (...)
        {
        }

        try
        {
            webView.Source(Windows::Foundation::Uri{ ResolveLoginUrl() });
        }
        catch (...)
        {
        }
    }

    void SiteHostPage::OnReloadClick(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        NavigateToLiveSite(true);
    }

    void SiteHostPage::OnOpenInBrowserClick(
        Windows::Foundation::IInspectable const&,
        RoutedEventArgs const&)
    {
        auto const uiUrl = ResolveUiUrl();
        ShellExecuteW(nullptr, L"open", uiUrl.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    }

    void SiteHostPage::OnNavigationCompleted(
        WebView2 const& sender,
        CoreWebView2NavigationCompletedEventArgs const& args)
    {
        m_navigationInFlight = false;
        UpdateNavigationButtons(sender);

        if (args.IsSuccess())
        {
            AppendBootstrapTrace("site-host: navigation completed");
            InstallNativePairingBridge(sender);
            if (auto core = sender.CoreWebView2())
            {
                bool isLoginSurface = false;
                try
                {
                    if (auto const source = sender.Source())
                    {
                        auto const absoluteUri = ToLowerCopy(std::wstring(source.AbsoluteUri()));
                        isLoginSurface = absoluteUri.find(L"/login") != std::wstring::npos;
                    }
                }
                catch (...)
                {
                }

                // Existing local files are not enough to prove the resident runtime is
                // still paired to the currently authenticated account. If the user is on
                // the login surface, allow a fresh local-session provision after sign-in.
                if (isLoginSurface)
                {
                    m_pairingCompleted = false;
                }

                core.ExecuteScriptAsync(
                    m_pairingCompleted
                        ? L"window.__drakonDesktopPairRuntimeCompleted = true;"
                        : L"window.__drakonDesktopPairRuntimeCompleted = false;");

                core.ExecuteScriptAsync(L"window.__drakonDesktopReportTheme && window.__drakonDesktopReportTheme();");
                core.ExecuteScriptAsync(winrt::to_hstring("window.__drakonDesktopTryResidentRuntime && window.__drakonDesktopTryResidentRuntime();"));
            }

            SetStatus(L"", L"", false, false);
            return;
        }

        auto errorMessage = ReadBackendBootstrapError();
        if (errorMessage.empty())
        {
            errorMessage = L"A interface web local nao respondeu corretamente. Verifique os logs do backend e do host.";
        }
        SetStatus(
            L"Falha ao carregar a interface web local",
            winrt::hstring(errorMessage),
            false,
            true);
    }

    void SiteHostPage::OnHistoryChanged(
        CoreWebView2 const&,
        Windows::Foundation::IInspectable const&)
    {
        try
        {
            if (auto webView = FindName(L"SiteWebView").try_as<WebView2>())
            {
                UpdateNavigationButtons(webView);
            }
        }
        catch (...)
        {
        }
    }

    void SiteHostPage::OnNavigationStarting(
        CoreWebView2 const& sender,
        CoreWebView2NavigationStartingEventArgs const& args)
    {
        auto const rewrittenUri = BuildCallbackRewriteUri(args.Uri().c_str());
        if (rewrittenUri.empty())
        {
            return;
        }

        AppendBootstrapTrace("site-host: rewriting oauth callback to active local origin");
        AppendBootstrapTrace(winrt::to_string(rewrittenUri));

        args.Cancel(true);
        try
        {
            sender.Navigate(rewrittenUri.c_str());
            SetStatus(
                L"Concluindo login Google",
                L"Redirecionando o callback OAuth para a interface local ativa.",
                true,
                true);
        }
        catch (winrt::hresult_error const& ex)
        {
            AppendBootstrapTrace("site-host: oauth callback rewrite failed");
            AppendBootstrapTrace(winrt::to_string(ex.message()));
        }
    }

    fire_and_forget SiteHostPage::InstallNativePairingBridge(WebView2 const& webView)
    {
        auto lifetime = get_strong();

        try
        {
            co_await webView.EnsureCoreWebView2Async();
            auto core = webView.CoreWebView2();
            if (!core)
            {
                co_return;
            }

            if (!m_pairingBridgeInstalled)
            {
                core.WebMessageReceived({ this, &SiteHostPage::OnWebMessageReceived });
                co_await core.AddScriptToExecuteOnDocumentCreatedAsync(winrt::to_hstring(kNativeResidentRuntimeBridgeScript));
                m_pairingBridgeInstalled = true;
                AppendBootstrapTrace("site-host: native resident runtime bridge installed");
            }
        }
        catch (winrt::hresult_error const& ex)
        {
            AppendBootstrapTrace("site-host: native resident runtime bridge failed");
            AppendBootstrapTrace(winrt::to_string(ex.message()));
        }
    }

    void SiteHostPage::OnWebMessageReceived(
        CoreWebView2 const& sender,
        CoreWebView2WebMessageReceivedEventArgs const& args)
    {
        std::string messageJson;
        try
        {
            messageJson = winrt::to_string(args.WebMessageAsJson());
        }
        catch (...)
        {
            return;
        }

        if (messageJson.empty())
        {
            return;
        }

        json payload;
        try
        {
            payload = json::parse(messageJson);
        }
        catch (...)
        {
            return;
        }

        auto const messageType = payload.value("type", std::string{});
        if (messageType == "theme-changed")
        {
            auto const theme = payload.value("theme", std::string{});
            if (theme == "light")
            {
                ::DrakonDesktop::platform::UpdateMainWindowTheme(true);
            }
            else if (theme == "dark")
            {
                ::DrakonDesktop::platform::UpdateMainWindowTheme(false);
            }
            return;
        }

        if (messageType == "account-delete-cleanup")
        {
            auto const clearStorageRoot = payload.value("clear_storage_root", false);
            auto const result =
                ::DrakonDesktop::platform::ScheduleLocalAppDataCleanupAfterAccountDeletionFromWeb(
                    clearStorageRoot);
            if (!result.succeeded)
            {
                AppendBootstrapTrace("site-host: account deletion cleanup scheduling failed");
                AppendBootstrapTrace(winrt::to_string(result.message));
            }
            return;
        }

        if (messageType != "resident-runtime-session" || m_pairingRequested || m_pairingCompleted)
        {
            return;
        }

        auto const clientId = CleanBridgeSessionValue(payload.value("client_id", std::string{}));
        auto const exeId = CleanBridgeSessionValue(payload.value("exe_id", std::string{}));
        auto const exeToken = CleanBridgeSessionValue(payload.value("exe_token", std::string{}));
        auto const timezoneIana = CleanBridgeSessionValue(payload.value("timezone_iana", std::string{}));
        if (clientId.empty() || exeId.empty() || exeToken.empty())
        {
            AppendBootstrapTrace("site-host: ignored invalid resident runtime session payload");
            return;
        }

        m_pairingRequested = true;
        auto const result = ::DrakonDesktop::platform::StartRuntimeWithProvisionedSessionFromWeb(
            winrt::to_hstring(clientId),
            winrt::to_hstring(exeId),
            winrt::to_hstring(exeToken),
            winrt::to_hstring(timezoneIana));

        if (result.succeeded)
        {
            m_pairingCompleted = true;
            try
            {
                sender.ExecuteScriptAsync(L"window.__drakonDesktopPairRuntimeCompleted = true;");
            }
            catch (...)
            {
            }
        }

        m_pairingRequested = false;
    }
}

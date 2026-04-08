#include "pch.h"
#include <Windows.h>

#ifdef GetCurrentTime
#undef GetCurrentTime
#endif

#include "App.xaml.h"
#include "BootstrapTrace.h"
#include "MainWindow.xaml.h"
#include "Platform\\AppRuntimeConfig.h"
#include "Platform\\LocalBackendHost.h"
#include "Platform\\PerceptrumRuntimeHost.h"
#include "Platform\\TrayIconHost.h"
#include <microsoft.ui.xaml.window.h>
#include <shobjidl_core.h>
#include <winrt/Microsoft.UI.Interop.h>
#include <winrt/Microsoft.UI.Windowing.h>

#include <exception>
#include <vector>

using namespace winrt;
using namespace Microsoft::UI::Xaml;

namespace
{
    ::DrakonDesktop::platform::PerceptrumRuntimeHost* g_runtimeHost = nullptr;

    std::wstring EscapePowerShellSingleQuotedLiteral(std::wstring const& value)
    {
        std::wstring escaped;
        escaped.reserve(value.size() + 8);
        for (auto const ch : value)
        {
            if (ch == L'\'')
            {
                escaped += L"''";
            }
            else
            {
                escaped.push_back(ch);
            }
        }
        return escaped;
    }

    std::filesystem::path ResolvePowerShellPath()
    {
        wchar_t systemDirectory[MAX_PATH + 1]{};
        auto const bufferLength = static_cast<UINT>(MAX_PATH + 1);
        auto const length = GetSystemDirectoryW(systemDirectory, bufferLength);
        if (length > 0 && length < bufferLength)
        {
            auto candidate = std::filesystem::path(std::wstring(systemDirectory, length)) /
                "WindowsPowerShell" / "v1.0" / "powershell.exe";
            if (std::filesystem::exists(candidate))
            {
                return candidate;
            }
        }

        return std::filesystem::path(L"powershell.exe");
    }

    bool LaunchAccountDeletionCleanupProcess(
        std::filesystem::path const& serviceSessionDirectory,
        bool clearStorageRoot,
        std::wstring& error)
    {
        auto const powerShellPath = ResolvePowerShellPath();
        std::vector<std::filesystem::path> cleanupTargets{
            serviceSessionDirectory / "backend-host.log",
            serviceSessionDirectory / "service-cpp.log",
            serviceSessionDirectory / "logs",
            serviceSessionDirectory / "webview2",
            serviceSessionDirectory / "exe_token.txt",
            serviceSessionDirectory / "client_id.txt",
            serviceSessionDirectory / "exe_id.txt",
            serviceSessionDirectory / "paired_timezone.txt",
            serviceSessionDirectory / "drakon_base_url.txt",
            serviceSessionDirectory / "perceptrum_base_url.txt",
            serviceSessionDirectory / "drakon_desktop_session.cookie",
        };
        if (clearStorageRoot)
        {
            cleanupTargets.push_back(serviceSessionDirectory / "storage");
        }

        std::wstring targetsLiteral = L"$targets=@(";
        for (size_t index = 0; index < cleanupTargets.size(); ++index)
        {
            if (index > 0)
            {
                targetsLiteral += L",";
            }

            targetsLiteral += L"'";
            targetsLiteral += EscapePowerShellSingleQuotedLiteral(cleanupTargets[index].wstring());
            targetsLiteral += L"'";
        }
        targetsLiteral += L");";

        std::wstring script;
        script.reserve(2048);
        script += L"$parentPid=" + std::to_wstring(GetCurrentProcessId()) + L";";
        script += L"$sessionDir='" + EscapePowerShellSingleQuotedLiteral(serviceSessionDirectory.wstring()) + L"';";
        script += targetsLiteral;
        script += L"$waitDeadline=(Get-Date).AddSeconds(45);";
        script += L"while((Get-Process -Id $parentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $waitDeadline){Start-Sleep -Milliseconds 250};";
        script += L"$cleanupDeadline=(Get-Date).AddSeconds(12);";
        script += L"do {";
        script += L"foreach($target in $targets){Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue};";
        script += L"$remaining=@($targets | Where-Object { Test-Path -LiteralPath $_ });";
        script += L"if($remaining.Count -eq 0){break};";
        script += L"Start-Sleep -Milliseconds 300;";
        script += L"} while((Get-Date) -lt $cleanupDeadline);";
        script += L"try {$sessionChildren=@(Get-ChildItem -LiteralPath $sessionDir -Force -ErrorAction SilentlyContinue);";
        script += L"if($sessionChildren.Count -eq 0){Remove-Item -LiteralPath $sessionDir -Force -ErrorAction SilentlyContinue}} catch {}";

        std::wstring commandLine =
            L"\"" + powerShellPath.wstring() +
            L"\" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"" +
            script + L"\"";

        STARTUPINFOW startupInfo{};
        startupInfo.cb = sizeof(startupInfo);

        PROCESS_INFORMATION processInfo{};
        if (!CreateProcessW(
                powerShellPath.wstring().c_str(),
                commandLine.data(),
                nullptr,
                nullptr,
                FALSE,
                CREATE_NO_WINDOW | DETACHED_PROCESS,
                nullptr,
                nullptr,
                &startupInfo,
                &processInfo))
        {
            error = L"Unable to start local AppData cleanup helper. Win32=" +
                std::to_wstring(GetLastError());
            return false;
        }

        CloseHandle(processInfo.hThread);
        CloseHandle(processInfo.hProcess);
        return true;
    }

    void ApplyMainWindowIcon(HWND hwnd)
    {
        auto const& config = ::DrakonDesktop::platform::RuntimeConfig();
        if (hwnd == nullptr || config.brandIconPath.empty() || !std::filesystem::exists(config.brandIconPath))
        {
            return;
        }

        auto const largeIcon = static_cast<HICON>(LoadImageW(
            nullptr,
            config.brandIconPath.wstring().c_str(),
            IMAGE_ICON,
            GetSystemMetrics(SM_CXICON),
            GetSystemMetrics(SM_CYICON),
            LR_LOADFROMFILE));
        auto const smallIcon = static_cast<HICON>(LoadImageW(
            nullptr,
            config.brandIconPath.wstring().c_str(),
            IMAGE_ICON,
            GetSystemMetrics(SM_CXSMICON),
            GetSystemMetrics(SM_CYSMICON),
            LR_LOADFROMFILE));

        if (largeIcon != nullptr)
        {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(largeIcon));
        }
        if (smallIcon != nullptr)
        {
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(smallIcon));
        }
    }

    void ApplyMaximizedStartupBounds(HWND hwnd)
    {
        if (hwnd == nullptr)
        {
            return;
        }

        try
        {
            auto const windowId = winrt::Microsoft::UI::GetWindowIdFromWindow(hwnd);
            auto const appWindow = winrt::Microsoft::UI::Windowing::AppWindow::GetFromWindowId(windowId);
            appWindow.SetPresenter(winrt::Microsoft::UI::Windowing::AppWindowPresenterKind::Overlapped);
            auto const presenter = appWindow.Presenter().as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
            presenter.SetBorderAndTitleBar(true, true);
            presenter.IsResizable(true);
            presenter.IsMaximizable(true);
            presenter.IsMinimizable(true);
            presenter.Maximize();
            return;
        }
        catch (...)
        {
        }

        ShowWindow(hwnd, SW_MAXIMIZE);
    }
}

namespace DrakonDesktop::platform
{
    bool IsRuntimeAlreadyProvisioned()
    {
        return g_runtimeHost != nullptr && g_runtimeHost->Status().paired;
    }

    PairRuntimeRequestResult PairRuntimeWithCodeFromWebSession(winrt::hstring const& pairCode)
    {
        if (!g_runtimeHost)
        {
            return { false, L"servico cpp host is not available." };
        }

        auto const status = g_runtimeHost->StartWithPairCode(winrt::to_string(pairCode));
        return { status.running || status.paired, winrt::to_hstring(status.summary) };
    }

    PairRuntimeRequestResult StartRuntimeWithProvisionedSessionFromWeb(
        winrt::hstring const& clientId,
        winrt::hstring const& exeId,
        winrt::hstring const& exeToken,
        winrt::hstring const& timezoneIana)
    {
        if (!g_runtimeHost)
        {
            return { false, L"servico cpp host is not available." };
        }

        auto const status = g_runtimeHost->StartWithProvisionedSession(
            winrt::to_string(exeToken),
            winrt::to_string(clientId),
            winrt::to_string(exeId),
            std::optional<std::string>{ winrt::to_string(timezoneIana) });
        return { status.running || status.paired, winrt::to_hstring(status.summary) };
    }

    DesktopShellRequestResult ScheduleLocalAppDataCleanupAfterAccountDeletionFromWeb(bool clearStorageRoot)
    {
        auto const& config = RuntimeConfig();
        if (config.serviceSessionDirectory.empty())
        {
            return { false, L"Local AppData session directory is not configured." };
        }

        std::wstring error;
        if (!LaunchAccountDeletionCleanupProcess(
                config.serviceSessionDirectory,
                clearStorageRoot,
                error))
        {
            return { false, winrt::hstring(error) };
        }

        AppendBootstrapTrace("app: scheduled local AppData cleanup after account deletion");
        try
        {
            if (auto current = winrt::Microsoft::UI::Xaml::Application::Current())
            {
                current.Exit();
            }
        }
        catch (...)
        {
        }

        return { true, L"Local AppData cleanup scheduled." };
    }
}

namespace winrt::DrakonDesktop::implementation
{
    App::App()
    {
#if defined _DEBUG && !defined DISABLE_XAML_GENERATED_BREAK_ON_UNHANDLED_EXCEPTION
        UnhandledException([](IInspectable const&, UnhandledExceptionEventArgs const& e)
        {
            AppendBootstrapTrace("app: unhandled exception");
            AppendBootstrapTrace(winrt::to_string(e.Message()));
            if (IsDebuggerPresent())
            {
                __debugbreak();
            }
        });
#endif
    }

    App::~App()
    {
        if (g_runtimeHost == m_runtimeHost.get())
        {
            g_runtimeHost = nullptr;
        }
    }

    void App::InitializeComponent()
    {
        if (m_resourcesInitialized)
        {
            return;
        }

        Application::LoadComponent(
            *this,
            Windows::Foundation::Uri{ L"ms-appx:///App.xaml" });

        m_resourcesInitialized = true;
    }

    winrt::Microsoft::UI::Xaml::Markup::IXamlType App::GetXamlType(winrt::Windows::UI::Xaml::Interop::TypeName const& type)
    {
        return AppProvider()->GetXamlType(type);
    }

    winrt::Microsoft::UI::Xaml::Markup::IXamlType App::GetXamlType(hstring const& fullName)
    {
        return AppProvider()->GetXamlType(fullName);
    }

    com_array<winrt::Microsoft::UI::Xaml::Markup::XmlnsDefinition> App::GetXmlnsDefinitions()
    {
        return AppProvider()->GetXmlnsDefinitions();
    }

    void App::OnLaunched([[maybe_unused]] LaunchActivatedEventArgs const&)
    {
        auto const& runtimeConfig = ::DrakonDesktop::platform::RuntimeConfig();
        if (!runtimeConfig.appUserModelId.empty())
        {
            SetCurrentProcessExplicitAppUserModelID(runtimeConfig.appUserModelId.c_str());
        }
        SetEnvironmentVariableW(L"DRAKON_UI_URL", (runtimeConfig.uiBaseUrl + L"/dashboard").c_str());
        SetEnvironmentVariableW(
            L"WEBVIEW2_USER_DATA_FOLDER",
            runtimeConfig.webViewUserDataDirectory.wstring().c_str());

        m_backendHost = std::make_unique<::DrakonDesktop::platform::LocalBackendHost>();
        auto const backendStatus = m_backendHost->EnsureReady();
        AppendBootstrapTrace("app: backend " + winrt::to_string(backendStatus.summary));
        if (backendStatus.ready)
        {
            SetEnvironmentVariableW(L"DRAKON_BACKEND_BOOTSTRAP_ERROR", nullptr);
        }
        else
        {
            SetEnvironmentVariableW(L"DRAKON_BACKEND_BOOTSTRAP_ERROR", backendStatus.summary.c_str());
        }

        m_runtimeHost = std::make_unique<::DrakonDesktop::platform::PerceptrumRuntimeHost>();
        g_runtimeHost = m_runtimeHost.get();
        auto const runtimeStatus = m_runtimeHost->Start();
        AppendBootstrapTrace("app: service-cpp " + runtimeStatus.summary);

        m_window = make<MainWindow>();
        m_window.Title(winrt::hstring(runtimeConfig.windowTitle));
        m_window.Activate();
        ::DrakonDesktop::platform::ConfigureMainWindowChrome();

        try
        {
            HWND hwnd{};
            auto windowNative = m_window.as<IWindowNative>();
            check_hresult(windowNative->get_WindowHandle(&hwnd));
            if (hwnd != nullptr)
            {
                ApplyMainWindowIcon(hwnd);
                ApplyMaximizedStartupBounds(hwnd);

                m_trayIconHost = std::make_unique<::DrakonDesktop::platform::TrayIconHost>();
                m_trayIconHost->Attach(hwnd);
            }
        }
        catch (...)
        {
            AppendBootstrapTrace("app: tray/icon hookup failed");
        }
    }

    winrt::com_ptr<XamlMetaDataProvider> App::AppProvider()
    {
        if (!m_appProvider)
        {
            m_appProvider = winrt::make_self<XamlMetaDataProvider>();
        }

        return m_appProvider;
    }
}

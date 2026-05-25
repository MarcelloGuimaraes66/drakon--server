#include "pch.h"
#include "TrayIconHost.h"
#include "../App.xaml.h"
#include "AppRuntimeConfig.h"
#include "../BootstrapTrace.h"

#include <shellapi.h>

namespace
{
    wchar_t const* kTrayIconHostPropertyName = L"DrakonDesktop.TrayIconHost";
    GUID const kDefaultTrayIconGuid
    {
        0x5c683f8b, 0xe204, 0x4aa8, { 0x9a, 0xad, 0x47, 0x89, 0xd5, 0xac, 0xb0, 0x51 }
    };

    HICON LoadApplicationIcon(UINT iconWidth, UINT iconHeight)
    {
        auto const& runtimeConfig = DrakonDesktop::platform::RuntimeConfig();
        HICON trayIcon = nullptr;

        if (!runtimeConfig.brandIconPath.empty() && std::filesystem::exists(runtimeConfig.brandIconPath))
        {
            trayIcon = static_cast<HICON>(LoadImageW(
                nullptr,
                runtimeConfig.brandIconPath.wstring().c_str(),
                IMAGE_ICON,
                iconWidth,
                iconHeight,
                LR_LOADFROMFILE));
        }

        if (trayIcon != nullptr)
        {
            return trayIcon;
        }

        return CopyIcon(LoadIconW(nullptr, IDI_APPLICATION));
    }
}

namespace DrakonDesktop::platform
{
    TrayIconHost::~TrayIconHost()
    {
        Detach();
    }

    bool TrayIconHost::Attach(HWND hwnd)
    {
        if (hwnd == nullptr)
        {
            return false;
        }

        if (m_hwnd == hwnd)
        {
            return true;
        }

        Detach();

        m_hwnd = hwnd;
        SetPropW(m_hwnd, HostPropertyName(), this);

        m_originalWindowProc = reinterpret_cast<WNDPROC>(
            SetWindowLongPtrW(m_hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&TrayIconHost::WindowProc)));

        if (m_originalWindowProc == nullptr)
        {
            RemovePropW(m_hwnd, HostPropertyName());
            m_hwnd = nullptr;
            AppendBootstrapTrace("tray: failed to subclass window");
            return false;
        }

        m_allowClose = false;
        if (CreateTrayIcon())
        {
            m_backgroundBalloonShown = false;
            AppendBootstrapTrace("tray: attached");
            return true;
        }

        Detach();
        return false;
    }

    void TrayIconHost::Detach()
    {
        if (m_hwnd == nullptr)
        {
            return;
        }

        RemoveTrayIcon();
        ReleaseLoadedIcons();

        if (m_originalWindowProc != nullptr)
        {
            SetWindowLongPtrW(m_hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(m_originalWindowProc));
            m_originalWindowProc = nullptr;
        }

        RemovePropW(m_hwnd, HostPropertyName());
        m_hwnd = nullptr;
        m_allowClose = false;
        m_backgroundBalloonShown = false;
        AppendBootstrapTrace("tray: detached");
    }

    wchar_t const* TrayIconHost::HostPropertyName()
    {
        return kTrayIconHostPropertyName;
    }

    GUID const& TrayIconHost::TrayGuid()
    {
        auto const& runtimeConfig = RuntimeConfig();
        if (runtimeConfig.trayIconGuidValid)
        {
            return runtimeConfig.trayIconGuid;
        }

        return kDefaultTrayIconGuid;
    }

    LRESULT CALLBACK TrayIconHost::WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam)
    {
        auto host = reinterpret_cast<TrayIconHost*>(GetPropW(hwnd, HostPropertyName()));
        if (host != nullptr)
        {
            return host->HandleWindowMessage(message, wParam, lParam);
        }

        return DefWindowProcW(hwnd, message, wParam, lParam);
    }

    LRESULT TrayIconHost::HandleWindowMessage(UINT message, WPARAM wParam, LPARAM lParam)
    {
        switch (message)
        {
        case WM_CLOSE:
            if (!m_allowClose)
            {
                HideWindowToTray();
                AppendBootstrapTrace("tray: close intercepted -> hide");
                return 0;
            }
            break;

        case WM_DESTROY:
            RemoveTrayIcon();
            break;

        default:
            break;
        }

        if (message == kTrayIconMessage)
        {
            auto const trayEvent = LOWORD(static_cast<DWORD>(lParam));
            if (trayEvent == WM_LBUTTONUP || trayEvent == WM_LBUTTONDBLCLK || trayEvent == NIN_SELECT || trayEvent == NIN_KEYSELECT)
            {
                ShowWindowFromTray();
                return 0;
            }

            if (trayEvent == WM_RBUTTONUP || trayEvent == WM_CONTEXTMENU)
            {
                ShowContextMenu();
                return 0;
            }
        }

        return CallWindowProcW(m_originalWindowProc, m_hwnd, message, wParam, lParam);
    }

    void TrayIconHost::ToggleWindowVisibility()
    {
        if (m_hwnd == nullptr)
        {
            return;
        }

        if (IsWindowVisible(m_hwnd) != FALSE)
        {
            HideWindowToTray();
            return;
        }

        ShowWindowFromTray();
    }

    void TrayIconHost::ShowWindowFromTray() const
    {
        if (m_hwnd == nullptr)
        {
            return;
        }

        ShowWindow(m_hwnd, SW_SHOWNORMAL);
        SetForegroundWindow(m_hwnd);
        AppendBootstrapTrace("tray: show window");
    }

    void TrayIconHost::HideWindowToTray()
    {
        if (m_hwnd == nullptr)
        {
            return;
        }

        ShowWindow(m_hwnd, SW_HIDE);
        if (!m_backgroundBalloonShown)
        {
            ShowBackgroundBalloon();
            m_backgroundBalloonShown = true;
        }
    }

    void TrayIconHost::ShowContextMenu()
    {
        if (m_hwnd == nullptr)
        {
            return;
        }

        POINT cursor{};
        GetCursorPos(&cursor);

        auto menu = CreatePopupMenu();
        if (menu == nullptr)
        {
            return;
        }

        InsertMenuW(menu, UINT_MAX, MF_BYPOSITION | MF_STRING, kOpenCommandId, L"Open");
        InsertMenuW(menu, UINT_MAX, MF_BYPOSITION | MF_STRING, kExitCommandId, L"Exit");

        SetForegroundWindow(m_hwnd);
        auto const command = TrackPopupMenu(
            menu,
            TPM_RETURNCMD | TPM_NONOTIFY,
            cursor.x,
            cursor.y,
            0,
            m_hwnd,
            nullptr);

        DestroyMenu(menu);

        if (command == kOpenCommandId)
        {
            ShowWindowFromTray();
            return;
        }

        if (command == kExitCommandId)
        {
            RequestExit();
        }
    }

    void TrayIconHost::RequestExit()
    {
        if (m_hwnd == nullptr)
        {
            return;
        }

        AppendBootstrapTrace("tray: exit requested");
        ::DrakonDesktop::platform::CloseRemoteWorkspaceWindowsForAppExit();
        m_allowClose = true;
        PostMessageW(m_hwnd, WM_CLOSE, 0, 0);
    }

    bool TrayIconHost::CreateTrayIcon()
    {
        if (m_hwnd == nullptr)
        {
            return false;
        }

        ReleaseLoadedIcons();
        m_trayIcon = LoadApplicationIcon(32, 32);
        m_balloonIcon = LoadApplicationIcon(
            static_cast<UINT>(GetSystemMetrics(SM_CXICON)),
            static_cast<UINT>(GetSystemMetrics(SM_CYICON)));
        if (m_balloonIcon == nullptr && m_trayIcon != nullptr)
        {
            m_balloonIcon = CopyIcon(m_trayIcon);
        }

        NOTIFYICONDATAW data{};
        data.cbSize = sizeof(data);
        data.hWnd = m_hwnd;
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP | NIF_GUID;
        data.uCallbackMessage = kTrayIconMessage;
        data.hIcon = m_trayIcon;
        data.guidItem = TrayGuid();
        wcscpy_s(data.szTip, RuntimeConfig().trayTooltip.c_str());

        if (!Shell_NotifyIconW(NIM_ADD, &data))
        {
            AppendBootstrapTrace("tray: Shell_NotifyIcon add failed");
            ReleaseLoadedIcons();
            return false;
        }

        data.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &data);
        m_trayIconVisible = true;
        return true;
    }

    void TrayIconHost::RemoveTrayIcon()
    {
        if (!m_trayIconVisible || m_hwnd == nullptr)
        {
            return;
        }

        NOTIFYICONDATAW data{};
        data.cbSize = sizeof(data);
        data.hWnd = m_hwnd;
        data.guidItem = TrayGuid();
        data.uFlags = NIF_GUID;

        Shell_NotifyIconW(NIM_DELETE, &data);
        m_trayIconVisible = false;
    }

    void TrayIconHost::ShowBackgroundBalloon() const
    {
        if (!m_trayIconVisible || m_hwnd == nullptr)
        {
            return;
        }

        NOTIFYICONDATAW data{};
        data.cbSize = sizeof(data);
        data.hWnd = m_hwnd;
        data.guidItem = TrayGuid();
        data.uFlags = NIF_INFO | NIF_GUID;
        auto const& runtimeConfig = RuntimeConfig();
        auto const& title =
            runtimeConfig.backgroundNotificationTitle.empty()
                ? runtimeConfig.displayName
                : runtimeConfig.backgroundNotificationTitle;
        wcscpy_s(data.szInfoTitle, title.c_str());
        wcscpy_s(data.szInfo, runtimeConfig.backgroundNotificationMessage.c_str());
        if (m_balloonIcon != nullptr)
        {
            data.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON;
            data.hBalloonIcon = m_balloonIcon;
        }
        else
        {
            data.dwInfoFlags = NIIF_NONE;
        }
        Shell_NotifyIconW(NIM_MODIFY, &data);
    }

    void TrayIconHost::ReleaseLoadedIcons()
    {
        if (m_trayIcon != nullptr)
        {
            DestroyIcon(m_trayIcon);
            m_trayIcon = nullptr;
        }

        if (m_balloonIcon != nullptr)
        {
            DestroyIcon(m_balloonIcon);
            m_balloonIcon = nullptr;
        }
    }
}

#pragma once

#include <windows.h>

namespace DrakonDesktop::platform
{
    class TrayIconHost
    {
    public:
        TrayIconHost() = default;
        ~TrayIconHost();

        TrayIconHost(TrayIconHost const&) = delete;
        TrayIconHost& operator=(TrayIconHost const&) = delete;

        bool Attach(HWND hwnd);
        void Detach();

    private:
        static constexpr UINT kTrayIconMessage = WM_APP + 0x42;
        static constexpr UINT_PTR kOpenCommandId = 1001;
        static constexpr UINT_PTR kExitCommandId = 1002;

        static wchar_t const* HostPropertyName();
        static GUID const& TrayGuid();
        static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam);

        LRESULT HandleWindowMessage(UINT message, WPARAM wParam, LPARAM lParam);
        void ToggleWindowVisibility() const;
        void ShowWindowFromTray() const;
        void HideWindowToTray() const;
        void ShowContextMenu();
        void RequestExit();

        bool CreateTrayIcon();
        void RemoveTrayIcon();
        void ShowStartupBalloon() const;
        void ReleaseLoadedIcons();

        HWND m_hwnd{ nullptr };
        WNDPROC m_originalWindowProc{ nullptr };
        bool m_trayIconVisible{ false };
        bool m_allowClose{ false };
        HICON m_trayIcon{ nullptr };
        HICON m_balloonIcon{ nullptr };
    };
}

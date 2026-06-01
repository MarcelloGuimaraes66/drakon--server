// app/TrayIcon.h
#pragma once

#include <windows.h>
#include <string>

class TrayIcon {
public:
    TrayIcon();
    ~TrayIcon();

    bool create(
        HWND hWnd,
        UINT callbackMessage,
        HICON trayIcon,
        HICON balloonIcon,
        const wchar_t* trayIconGuid,
        const std::wstring& tooltip
    );
    void destroy();
    bool showInfoBalloon(const std::wstring& title, const std::wstring& msg);

private:
    bool added_ = false;
    bool usesGuid_ = false;
    HICON trayIcon_ = nullptr;
    HICON balloonIcon_ = nullptr;
    NOTIFYICONDATA nid_{};
};

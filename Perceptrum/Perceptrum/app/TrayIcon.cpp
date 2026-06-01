// app/TrayIcon.cpp
#include "TrayIcon.h"

#include <objbase.h>

TrayIcon::TrayIcon() {
    ZeroMemory(&nid_, sizeof(nid_));
}

TrayIcon::~TrayIcon() {
    destroy();
}

bool TrayIcon::create(
    HWND hWnd,
    UINT callbackMessage,
    HICON trayIcon,
    HICON balloonIcon,
    const wchar_t* trayIconGuid,
    const std::wstring& tooltip
) {
    nid_.cbSize = sizeof(NOTIFYICONDATA);
    nid_.hWnd = hWnd;
    nid_.uID = 1;
    nid_.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
    nid_.uCallbackMessage = callbackMessage;
    nid_.hIcon = trayIcon;
    trayIcon_ = trayIcon;
    balloonIcon_ = balloonIcon;
    usesGuid_ = false;
    if (trayIconGuid && trayIconGuid[0] != L'\0') {
        GUID parsedGuid{};
        if (SUCCEEDED(CLSIDFromString(const_cast<LPOLESTR>(trayIconGuid), &parsedGuid))) {
            nid_.guidItem = parsedGuid;
            nid_.uFlags |= NIF_GUID;
            usesGuid_ = true;
        }
    }
    nid_.uVersion = NOTIFYICON_VERSION_4;
    wcsncpy_s(nid_.szTip, tooltip.c_str(), sizeof(nid_.szTip) / sizeof(WCHAR) - 1);

    added_ = Shell_NotifyIcon(NIM_ADD, &nid_) != FALSE;
    if (added_) {
        Shell_NotifyIcon(NIM_SETVERSION, &nid_);
    }
    return added_;
}

void TrayIcon::destroy() {
    if (added_) {
        nid_.uFlags = usesGuid_ ? NIF_GUID : 0;
        Shell_NotifyIcon(NIM_DELETE, &nid_);
        added_ = false;
    }
    if (balloonIcon_ && balloonIcon_ != trayIcon_) {
        DestroyIcon(balloonIcon_);
        balloonIcon_ = nullptr;
    }
    if (trayIcon_) {
        DestroyIcon(trayIcon_);
        trayIcon_ = nullptr;
    }
}

bool TrayIcon::showInfoBalloon(const std::wstring& title, const std::wstring& msg) {
    if (!added_) return false;

    nid_.uFlags = NIF_INFO | (usesGuid_ ? NIF_GUID : 0);
    wcsncpy_s(nid_.szInfoTitle, title.c_str(), sizeof(nid_.szInfoTitle) / sizeof(WCHAR) - 1);
    wcsncpy_s(nid_.szInfo, msg.c_str(), sizeof(nid_.szInfo) / sizeof(WCHAR) - 1);
    if (balloonIcon_) {
        nid_.dwInfoFlags = NIIF_USER | NIIF_LARGE_ICON;
        nid_.hBalloonIcon = balloonIcon_;
    } else {
        nid_.dwInfoFlags = NIIF_INFO;
        nid_.hBalloonIcon = nullptr;
    }

    return Shell_NotifyIcon(NIM_MODIFY, &nid_) != FALSE;
}

// Perceptrum.cpp
#include <windows.h>
#include <string>

#include <dbghelp.h>
#include <cstdio>
#include <curl/curl.h>
#include <shobjidl_core.h>

#include "comm/BackendConfig.h"

#include "app/TrayIcon.h"
#include "app/PairingDialog.h"
#include "comm/PairingClient.h"
#include "core/AgentCore.h"
#include "generated/Branding.h"
#include "Resource.h"

#include "logging/Logging.h"


#pragma comment(lib, "comctl32.lib")

#pragma comment(lib, "dbghelp.lib")

// Custom message for tray icon
#define WM_TRAYICON (WM_APP + 1)

HINSTANCE g_hInst = nullptr;
TrayIcon g_tray;
AgentCore* g_agent = nullptr;
HWND g_mainWnd = nullptr;

LRESULT CALLBACK MainWndProc(HWND, UINT, WPARAM, LPARAM);


LONG WINAPI TopLevelExceptionFilter(EXCEPTION_POINTERS* pExceptionInfo) {
    DWORD code = pExceptionInfo->ExceptionRecord->ExceptionCode;

    Logger::instance().logDebug(
        "agent",
        std::string("TopLevelExceptionFilter: Unhandled SEH exception, code=0x") +
        [](DWORD c) {
            char buf[16];
            sprintf_s(buf, "%08X", c);
            return std::string(buf);
        }(code)
            );

    // Let the process die, but we log first.
    return EXCEPTION_CONTINUE_SEARCH;
}



// Helper: wide literal
std::wstring s2ws(const std::string& s) {
    return std::wstring(s.begin(), s.end());
}

int APIENTRY wWinMain(_In_ HINSTANCE hInstance,
    _In_opt_ HINSTANCE hPrevInstance,
    _In_ LPWSTR    lpCmdLine,
    _In_ int       nCmdShow)
{
    g_hInst = hInstance;

    SetUnhandledExceptionFilter(TopLevelExceptionFilter);
    const HRESULT appIdResult = SetCurrentProcessExplicitAppUserModelID(AppBrand::kAppUserModelIdW);

    curl_global_init(CURL_GLOBAL_DEFAULT);


    // 1) Try to load existing token
    std::string exeToken, clientId;
    const std::string uiBaseUrl = GetPerceptrumBaseUrl();
    const std::string agentBaseUrl = GetPerceptrumAgentBaseUrl();
    PairingClient pairing(uiBaseUrl);

    bool alreadyPaired = pairing.loadSavedToken(exeToken, clientId);

    if (!alreadyPaired) {
        // We need to show pairing dialog before anything else.
        PairingDialog dlg(hInstance, pairing);
        if (!dlg.show(nullptr)) {
            // User cancelled or failed
            return 0;
        }
        exeToken = dlg.exeToken();
        clientId = dlg.clientId();
    }

    // 2) Register a very simple window class (hidden most of the time)
    WNDCLASSEXW wcex{};
    wcex.cbSize = sizeof(WNDCLASSEX);
    wcex.style = CS_HREDRAW | CS_VREDRAW;
    wcex.lpfnWndProc = MainWndProc;
    wcex.hInstance = hInstance;

    //wcex.hIcon = LoadIcon(hInstance, MAKEINTRESOURCE(IDI_APPLICATION));

    wcex.hIcon = (HICON)LoadImage(
        hInstance,
        MAKEINTRESOURCE(IDI_PERCEPTRUM),
        IMAGE_ICON,
        GetSystemMetrics(SM_CXICON),      // ícone grande (title bar / Alt+Tab)
        GetSystemMetrics(SM_CYICON),
        0
    );

    wcex.hCursor = LoadCursor(nullptr, IDC_ARROW);
    wcex.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wcex.lpszClassName = AppBrand::kWindowClassNameW;

    //wcex.hIconSm = LoadIcon(hInstance, MAKEINTRESOURCE(IDI_APPLICATION));

    wcex.hIconSm = (HICON)LoadImage(
        hInstance,
        MAKEINTRESOURCE(IDI_PERCEPTRUM),  // ou IDI_SMALL, se no .rc apontar pro mesmo .ico
        IMAGE_ICON,
        GetSystemMetrics(SM_CXSMICON),    // ícone pequeno (taskbar / tray)
        GetSystemMetrics(SM_CYSMICON),
        0
    );

    if (!RegisterClassExW(&wcex)) {
        return 0;
    }

    g_mainWnd = CreateWindowW(
        AppBrand::kWindowClassNameW,
        AppBrand::kWindowTitleW,
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, 0, 400, 200,
        nullptr,
        nullptr,
        hInstance,
        nullptr);

    if (!g_mainWnd) {
        return 0;
    }

    Logger::instance().logDebug("agent", "Logger initialized.");
    Logger::instance().logDebug(
        "agent",
        std::string("SetCurrentProcessExplicitAppUserModelID result=") +
        (SUCCEEDED(appIdResult) ? "success" : ("failure hr=0x" +
            [] (HRESULT hr) {
                char buf[16];
                sprintf_s(buf, "%08X", static_cast<unsigned int>(hr));
                return std::string(buf);
            }(appIdResult)))
    );

    // 3) Create tray icon
    HICON trayIcon = (HICON)LoadImage(
        hInstance,
        MAKEINTRESOURCE(IDI_PERCEPTRUM),
        IMAGE_ICON,
        GetSystemMetrics(SM_CXSMICON),
        GetSystemMetrics(SM_CYSMICON),
        0
    );

    HICON balloonIcon = (HICON)LoadImage(
        hInstance,
        MAKEINTRESOURCE(IDI_PERCEPTRUM),
        IMAGE_ICON,
        GetSystemMetrics(SM_CXICON),
        GetSystemMetrics(SM_CYICON),
        0
    );

    const bool trayCreated = g_tray.create(
        g_mainWnd,
        WM_TRAYICON,
        trayIcon,
        balloonIcon,
        AppBrand::kTrayIconGuidW,
        AppBrand::kTrayTooltipW
    );
    Logger::instance().logDebug(
        "agent",
        std::string("TrayIcon::create result=") + (trayCreated ? "success" : "failure")
    );



    // Optional: show balloon
    if (trayCreated) {
        const bool balloonShown = g_tray.showInfoBalloon(
            AppBrand::kBackgroundNotificationTitleW,
            AppBrand::kBackgroundNotificationMessageW
        );
        Logger::instance().logDebug(
            "agent",
            std::string("TrayIcon::showInfoBalloon result=") + (balloonShown ? "success" : "failure")
        );
    }


    // 4) Start AgentCore in background
    AgentCore agent(agentBaseUrl, uiBaseUrl, exeToken, clientId);
    g_agent = &agent;

    agent.initTimeSync();

    agent.bootstrapCameras_();

    agent.start();

    Logger::instance().logDebug(
        "agent",
        "wWinMain: agent.start() called, entering message loop"
    );


    // 5) Hide main window initially (only tray visible)
    ShowWindow(g_mainWnd, SW_HIDE);
    UpdateWindow(g_mainWnd);

    // 6) Message loop
    MSG msg;
    while (GetMessage(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    Logger::instance().logDebug(
        "agent",
        "wWinMain: message loop exited, msg.wParam=" + std::to_string(msg.wParam)
    );


    // Cleanup
    agent.stop();
    g_tray.destroy();


    curl_global_cleanup();

    return (int)msg.wParam;
}

void ShowMainWindow() {
    if (g_mainWnd) {
        ShowWindow(g_mainWnd, SW_SHOWNORMAL);
        SetForegroundWindow(g_mainWnd);
    }
}

void HideMainWindow() {
    if (g_mainWnd) {
        ShowWindow(g_mainWnd, SW_HIDE);
    }
}

void DoTrayRightClickMenu(HWND hWnd) {
    POINT pt;
    GetCursorPos(&pt);

    HMENU hMenu = CreatePopupMenu();
    if (!hMenu) return;

    InsertMenuW(hMenu, -1, MF_BYPOSITION | MF_STRING, 1, L"Open");
    InsertMenuW(hMenu, -1, MF_BYPOSITION | MF_STRING, 2, L"Exit");

    SetForegroundWindow(hWnd);
    int cmd = TrackPopupMenu(hMenu,
        TPM_RETURNCMD | TPM_NONOTIFY,
        pt.x, pt.y, 0, hWnd, nullptr);

    DestroyMenu(hMenu);

    if (cmd == 1) {
        ShowMainWindow();
    }
    else if (cmd == 2) {
        Logger::instance().logDebug("agent", "Tray menu: Exit selected -> PostQuitMessage");
        PostQuitMessage(0);
    }
}

LRESULT CALLBACK MainWndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam)
{
    switch (message) {
    case WM_TRAYICON: {
        const UINT trayEvent = LOWORD(static_cast<DWORD>(lParam));
        if (trayEvent == WM_LBUTTONUP || trayEvent == NIN_SELECT || trayEvent == NIN_KEYSELECT) {
            // Left click → toggle visibility
            if (IsWindowVisible(hWnd))
                HideMainWindow();
            else
                ShowMainWindow();
        }
        else if (trayEvent == WM_RBUTTONUP || trayEvent == WM_CONTEXTMENU) {
            DoTrayRightClickMenu(hWnd);
        }
        break;
    }

    case WM_CLOSE:
        // User clicked X → hide window but keep tray + agent running
        Logger::instance().logDebug("agent", "MainWndProc: WM_CLOSE (hiding window)");
        HideMainWindow();
        return 0;

    case WM_DESTROY:
        Logger::instance().logDebug("agent", "MainWndProc: WM_DESTROY -> PostQuitMessage");
        PostQuitMessage(0);
        break;
    }
    return DefWindowProc(hWnd, message, wParam, lParam);
}

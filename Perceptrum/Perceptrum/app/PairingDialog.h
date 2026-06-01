// app/PairingDialog.h
#pragma once

#include <windows.h>
#include <string>
#include "../comm/PairingClient.h"

class PairingDialog {
public:
    PairingDialog(HINSTANCE hInstance, PairingClient& client);

    // Shows dialog modally. Returns true if pairing succeeded.
    bool show(HWND hParent);

    const std::string& exeToken() const { return exeToken_; }
    const std::string& clientId() const { return clientId_; }

private:
    static INT_PTR CALLBACK DlgProc(HWND hDlg, UINT msg, WPARAM wParam, LPARAM lParam);

    INT_PTR handleMessage(HWND hDlg, UINT msg, WPARAM wParam, LPARAM lParam);

    void onButtonConnect(HWND hDlg);

    HINSTANCE hInstance_;
    PairingClient& client_;
    std::string exeToken_;
    std::string clientId_;
};

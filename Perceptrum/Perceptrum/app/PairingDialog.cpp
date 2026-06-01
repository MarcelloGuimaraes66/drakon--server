// app/PairingDialog.cpp
#include "PairingDialog.h"
#include "../Resource.h"   // for IDD_PAIRING_DIALOG, IDC_EDIT_PAIRCODE, etc.
#include "../generated/Branding.h"
#include <string>

PairingDialog::PairingDialog(HINSTANCE hInstance, PairingClient& client)
    : hInstance_(hInstance),
    client_(client) {
}

bool PairingDialog::show(HWND hParent) {
    // Pass "this" via lParam
    INT_PTR ret = DialogBoxParam(
        hInstance_,
        MAKEINTRESOURCE(IDD_PAIRING_DIALOG),
        hParent,
        PairingDialog::DlgProc,
        reinterpret_cast<LPARAM>(this));

    return (ret == IDOK);
}

INT_PTR CALLBACK PairingDialog::DlgProc(HWND hDlg, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_INITDIALOG) {
        auto* self = reinterpret_cast<PairingDialog*>(lParam);
        SetWindowLongPtr(hDlg, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        return TRUE;
    }

    auto* self = reinterpret_cast<PairingDialog*>(GetWindowLongPtr(hDlg, GWLP_USERDATA));
    if (!self) return FALSE;

    return self->handleMessage(hDlg, msg, wParam, lParam);
}

INT_PTR PairingDialog::handleMessage(HWND hDlg, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_COMMAND:
        switch (LOWORD(wParam)) {
        case IDC_BUTTON_PAIR:
            onButtonConnect(hDlg);
            return TRUE;
        case IDCANCEL:
            EndDialog(hDlg, IDCANCEL);
            return TRUE;
        }
        break;
    }
    return FALSE;
}

void PairingDialog::onButtonConnect(HWND hDlg) {
    WCHAR buf[256]{};
    GetDlgItemTextW(hDlg, IDC_EDIT_PAIRCODE, buf, 255);

    int len = lstrlenW(buf);
    if (len == 0) {
        MessageBoxW(hDlg, L"Please enter a connection key.", L"Error", MB_ICONERROR);
        return;
    }

    // Convert to std::string (UTF-8-ish simple conversion)
    char mbBuf[256]{};
    WideCharToMultiByte(CP_UTF8, 0, buf, -1, mbBuf, 256, nullptr, nullptr);
    std::string pairCode = mbBuf;

    std::string error;
    auto resOpt = client_.pairWithCode(pairCode, error);
    if (!resOpt) {
        std::wstring wErr(error.begin(), error.end());
        MessageBoxW(hDlg, wErr.c_str(), L"Pairing failed", MB_ICONERROR);
        return;
    }

    exeToken_ = resOpt->exeToken;
    clientId_ = resOpt->clientId;

    MessageBoxW(hDlg, L"Paired successfully!", AppBrand::kPairingSuccessTitleW, MB_OK | MB_ICONINFORMATION);
    EndDialog(hDlg, IDOK);
}



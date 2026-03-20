#pragma once

#include <filesystem>
#include <string>
#include <string_view>

namespace AppBrand::detail {
struct RuntimeBrandConfig {
    std::string brandId;
    std::string displayName;
    std::string assistantName;
    std::string chatName;
    std::string trayTooltip;
    std::string backgroundNotificationTitle;
    std::string backgroundNotificationMessage;
    std::string windowClassName;
    std::string windowTitle;
    std::string pairDialogTitle;
    std::string pairingSuccessTitle;
    std::string aboutDialogTitle;
    std::string aboutVersionText;
    std::string emailSubjectPrefix;
    std::string appUserModelId;
    std::string trayIconGuid;
    std::string dataRootWindows;
    std::string inferenceLoopTempDirName;
    std::string jobsInferenceTempDirName;
    std::string videoSegmentsTempDirName;
    std::string debugConcatTempDirName;
    std::string uploadedVideosTempDirName;
    std::string baseUrlEnvVarName;
    std::string legacyBaseUrlEnvVarName;
    std::string baseUrlFileName;
    std::string legacyBaseUrlFileName;

    std::wstring displayNameW;
    std::wstring trayTooltipW;
    std::wstring backgroundNotificationTitleW;
    std::wstring backgroundNotificationMessageW;
    std::wstring windowClassNameW;
    std::wstring windowTitleW;
    std::wstring pairDialogTitleW;
    std::wstring pairingSuccessTitleW;
    std::wstring appUserModelIdW;
    std::wstring trayIconGuidW;
};

const RuntimeBrandConfig& config();

struct NarrowValue {
    using Getter = const char* (*)();
    Getter getter = nullptr;

    operator const char*() const {
        return getter ? getter() : "";
    }

    operator std::string_view() const {
        return getter ? std::string_view(getter()) : std::string_view{};
    }

    operator std::filesystem::path() const {
        return std::filesystem::path(getter ? getter() : "");
    }
};

struct WideValue {
    using Getter = const wchar_t* (*)();
    Getter getter = nullptr;

    operator const wchar_t*() const {
        return getter ? getter() : L"";
    }
};

inline std::string operator+(std::string left, NarrowValue right) {
    left += static_cast<const char*>(right);
    return left;
}

inline std::filesystem::path operator/(std::filesystem::path left, NarrowValue right) {
    return left / static_cast<const char*>(right);
}
}

namespace AppBrand {
inline const detail::NarrowValue kBrandId{ []() { return detail::config().brandId.c_str(); } };
inline const detail::NarrowValue kDisplayName{ []() { return detail::config().displayName.c_str(); } };
inline const detail::NarrowValue kAssistantName{ []() { return detail::config().assistantName.c_str(); } };
inline const detail::NarrowValue kChatName{ []() { return detail::config().chatName.c_str(); } };
inline const detail::NarrowValue kTrayTooltip{ []() { return detail::config().trayTooltip.c_str(); } };
inline const detail::NarrowValue kBackgroundNotificationTitle{ []() { return detail::config().backgroundNotificationTitle.c_str(); } };
inline const detail::NarrowValue kBackgroundNotificationMessage{ []() { return detail::config().backgroundNotificationMessage.c_str(); } };
inline const detail::NarrowValue kWindowClassName{ []() { return detail::config().windowClassName.c_str(); } };
inline const detail::NarrowValue kWindowTitle{ []() { return detail::config().windowTitle.c_str(); } };
inline const detail::NarrowValue kPairDialogTitle{ []() { return detail::config().pairDialogTitle.c_str(); } };
inline const detail::NarrowValue kPairingSuccessTitle{ []() { return detail::config().pairingSuccessTitle.c_str(); } };
inline const detail::NarrowValue kAboutDialogTitle{ []() { return detail::config().aboutDialogTitle.c_str(); } };
inline const detail::NarrowValue kAboutVersionText{ []() { return detail::config().aboutVersionText.c_str(); } };
inline const detail::NarrowValue kEmailSubjectPrefix{ []() { return detail::config().emailSubjectPrefix.c_str(); } };
inline const detail::NarrowValue kAppUserModelId{ []() { return detail::config().appUserModelId.c_str(); } };
inline const detail::NarrowValue kTrayIconGuid{ []() { return detail::config().trayIconGuid.c_str(); } };
inline const detail::NarrowValue kDataRootWindows{ []() { return detail::config().dataRootWindows.c_str(); } };
inline const detail::NarrowValue kInferenceLoopTempDirName{ []() { return detail::config().inferenceLoopTempDirName.c_str(); } };
inline const detail::NarrowValue kJobsInferenceTempDirName{ []() { return detail::config().jobsInferenceTempDirName.c_str(); } };
inline const detail::NarrowValue kVideoSegmentsTempDirName{ []() { return detail::config().videoSegmentsTempDirName.c_str(); } };
inline const detail::NarrowValue kDebugConcatTempDirName{ []() { return detail::config().debugConcatTempDirName.c_str(); } };
inline const detail::NarrowValue kUploadedVideosTempDirName{ []() { return detail::config().uploadedVideosTempDirName.c_str(); } };
inline const detail::NarrowValue kBaseUrlEnvVarName{ []() { return detail::config().baseUrlEnvVarName.c_str(); } };
inline const detail::NarrowValue kLegacyBaseUrlEnvVarName{ []() { return detail::config().legacyBaseUrlEnvVarName.c_str(); } };
inline const detail::NarrowValue kBaseUrlFileName{ []() { return detail::config().baseUrlFileName.c_str(); } };
inline const detail::NarrowValue kLegacyBaseUrlFileName{ []() { return detail::config().legacyBaseUrlFileName.c_str(); } };

inline const detail::WideValue kDisplayNameW{ []() { return detail::config().displayNameW.c_str(); } };
inline const detail::WideValue kTrayTooltipW{ []() { return detail::config().trayTooltipW.c_str(); } };
inline const detail::WideValue kBackgroundNotificationTitleW{ []() { return detail::config().backgroundNotificationTitleW.c_str(); } };
inline const detail::WideValue kBackgroundNotificationMessageW{ []() { return detail::config().backgroundNotificationMessageW.c_str(); } };
inline const detail::WideValue kWindowClassNameW{ []() { return detail::config().windowClassNameW.c_str(); } };
inline const detail::WideValue kWindowTitleW{ []() { return detail::config().windowTitleW.c_str(); } };
inline const detail::WideValue kPairDialogTitleW{ []() { return detail::config().pairDialogTitleW.c_str(); } };
inline const detail::WideValue kPairingSuccessTitleW{ []() { return detail::config().pairingSuccessTitleW.c_str(); } };
inline const detail::WideValue kAppUserModelIdW{ []() { return detail::config().appUserModelIdW.c_str(); } };
inline const detail::WideValue kTrayIconGuidW{ []() { return detail::config().trayIconGuidW.c_str(); } };

inline std::filesystem::path dataRoot() {
    return std::filesystem::path(static_cast<const char*>(kDataRootWindows));
}

inline std::filesystem::path inferenceLoopTempRoot() {
    return std::filesystem::temp_directory_path() / static_cast<const char*>(kInferenceLoopTempDirName);
}

inline std::filesystem::path jobsInferenceTempRoot() {
    return std::filesystem::temp_directory_path() / static_cast<const char*>(kJobsInferenceTempDirName);
}

inline std::filesystem::path videoSegmentsTempRoot() {
    return std::filesystem::temp_directory_path() / static_cast<const char*>(kVideoSegmentsTempDirName);
}

inline std::filesystem::path debugConcatTempRoot() {
    return std::filesystem::temp_directory_path() / static_cast<const char*>(kDebugConcatTempDirName);
}

inline std::filesystem::path uploadedVideosTempRoot() {
    return std::filesystem::temp_directory_path() / static_cast<const char*>(kUploadedVideosTempDirName);
}

inline std::filesystem::path jobAlertImagesRoot() {
    return dataRoot() / "job_alert_images";
}

inline std::filesystem::path jobAlertClipsRoot() {
    return dataRoot() / "job_alert_clips";
}
}

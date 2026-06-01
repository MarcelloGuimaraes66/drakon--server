#include "BrandingRuntime.h"

#include <cctype>
#include <fstream>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace {
std::wstring Utf8ToWide(const std::string& value) {
    return perceptrum::platform::Utf8ToWide(value);
}

std::string TrimCopy(std::string value) {
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) {
        value.erase(value.begin());
    }
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) {
        value.pop_back();
    }
    return value;
}

std::string ReadEnvVar(const char* name) {
    return TrimCopy(perceptrum::platform::ReadEnvVar(name));
}

std::string ReadFirstLine(const std::filesystem::path& filePath) {
    std::ifstream in(filePath);
    if (!in.is_open()) {
        return {};
    }

    std::string line;
    std::getline(in, line);
    return TrimCopy(std::move(line));
}

std::filesystem::path ResolveConfigPath() {
    const std::string fromEnv = ReadEnvVar("APP_BRAND_CONFIG_PATH");
    const std::filesystem::path expandedEnvPath =
        perceptrum::platform::ExpandUserPath(std::filesystem::path(fromEnv));
    if (!fromEnv.empty() && std::filesystem::exists(expandedEnvPath)) {
        return expandedEnvPath;
    }

    const std::filesystem::path executableDirectory = perceptrum::platform::GetExecutableDirectory();

    const std::filesystem::path candidates[] = {
        executableDirectory / "brand.config.json",
        executableDirectory.parent_path() / "brand.config.json",
        executableDirectory.parent_path().parent_path() / "brand.config.json",
#ifdef _WIN32
        L"C:\\dev\\Workspace\\brand.config.json",
#endif
    };

    for (const auto& candidate : candidates) {
        if (!candidate.empty() && std::filesystem::exists(candidate)) {
            return candidate;
        }
    }

    return {};
}

std::string ResolveActiveBrand(const std::filesystem::path& configPath) {
    const std::string fromEnv = ReadEnvVar("APP_BRAND");
    if (fromEnv == "drakon" || fromEnv == "perceptrum") {
        return fromEnv;
    }

    if (!configPath.empty()) {
        const std::string selector = ReadFirstLine(configPath.parent_path() / "brand.txt");
        if (selector == "drakon" || selector == "perceptrum") {
            return selector;
        }
    }

    return "perceptrum";
}

AppBrand::detail::RuntimeBrandConfig LoadFallbackConfig(const std::string& brandId) {
    const bool isDrakon = brandId == "drakon";
    AppBrand::detail::RuntimeBrandConfig config;
    config.brandId = isDrakon ? "drakon" : "perceptrum";
    config.displayName = isDrakon ? "Drakon" : "Perceptrum";
    config.assistantName = config.displayName + " AI";
    config.chatName = config.displayName + " Chat";
    config.trayTooltip = config.displayName + " agent running";
    config.backgroundNotificationMessage = config.displayName + " is now running in the background.";
    config.windowClassName = config.displayName + "MainWindowClass";
    config.windowTitle = config.displayName;
    config.pairDialogTitle = config.displayName + " - Pair";
    config.pairingSuccessTitle = config.displayName;
    config.aboutDialogTitle = "About " + config.displayName;
    config.aboutVersionText = config.displayName + ", Version 1.0";
    config.emailSubjectPrefix = "[" + config.displayName + "]";
    config.appUserModelId = config.displayName;
    config.trayIconGuid = isDrakon
        ? "{A0BEB4AE-3A79-4E65-B8D8-3A7C5F99D601}"
        : "{0F84A457-60F0-4E95-A60C-0C28E0BC61C7}";
    config.storageNamespace = config.brandId;
    config.dataRootWindows = isDrakon ? "C:\\DrakonData" : "C:\\PerceptrumData";
    config.dataRootMacOS = isDrakon
        ? "~/Library/Application Support/DrakonData"
        : "~/Library/Application Support/PerceptrumData";
    config.dataRootLinux = isDrakon
        ? "~/.local/share/DrakonData"
        : "~/.local/share/PerceptrumData";
    config.inferenceLoopTempDirName = isDrakon ? "inferenceLoopDrakon" : "inferenceLoopPerceptrum";
    config.jobsInferenceTempDirName = isDrakon ? "jobsInferenceDrakon" : "jobsInferencePerceptrum";
    config.videoSegmentsTempDirName = isDrakon ? "drakon_video_segments" : "perceptrum_video_segments";
    config.debugConcatTempDirName = isDrakon ? "drakon_debug_concat" : "perceptrum_debug_concat";
    config.uploadedVideosTempDirName = isDrakon ? "drakon_uploaded_videos" : "perceptrum_uploaded_videos";
    config.baseUrlEnvVarName = isDrakon ? "DRAKON_BASE_URL" : "PERCEPTRUM_BASE_URL";
    config.legacyBaseUrlEnvVarName = "PERCEPTRUM_BASE_URL";
    config.baseUrlFileName = isDrakon ? "drakon_base_url.txt" : "perceptrum_base_url.txt";
    config.legacyBaseUrlFileName = "perceptrum_base_url.txt";
    config.displayNameW = Utf8ToWide(config.displayName);
    config.trayTooltipW = Utf8ToWide(config.trayTooltip);
    config.backgroundNotificationTitleW = Utf8ToWide(config.backgroundNotificationTitle);
    config.backgroundNotificationMessageW = Utf8ToWide(config.backgroundNotificationMessage);
    config.windowClassNameW = Utf8ToWide(config.windowClassName);
    config.windowTitleW = Utf8ToWide(config.windowTitle);
    config.pairDialogTitleW = Utf8ToWide(config.pairDialogTitle);
    config.pairingSuccessTitleW = Utf8ToWide(config.pairingSuccessTitle);
    config.appUserModelIdW = Utf8ToWide(config.appUserModelId);
    config.trayIconGuidW = Utf8ToWide(config.trayIconGuid);
    return config;
}

void PopulateWideFields(AppBrand::detail::RuntimeBrandConfig& config) {
    config.displayNameW = Utf8ToWide(config.displayName);
    config.trayTooltipW = Utf8ToWide(config.trayTooltip);
    config.backgroundNotificationTitleW = Utf8ToWide(config.backgroundNotificationTitle);
    config.backgroundNotificationMessageW = Utf8ToWide(config.backgroundNotificationMessage);
    config.windowClassNameW = Utf8ToWide(config.windowClassName);
    config.windowTitleW = Utf8ToWide(config.windowTitle);
    config.pairDialogTitleW = Utf8ToWide(config.pairDialogTitle);
    config.pairingSuccessTitleW = Utf8ToWide(config.pairingSuccessTitle);
    config.appUserModelIdW = Utf8ToWide(config.appUserModelId);
    config.trayIconGuidW = Utf8ToWide(config.trayIconGuid);
}

AppBrand::detail::RuntimeBrandConfig LoadConfigFromJson() {
    const auto configPath = ResolveConfigPath();
    const std::string brandId = ResolveActiveBrand(configPath);
    auto runtimeConfig = LoadFallbackConfig(brandId);

    if (configPath.empty()) {
        return runtimeConfig;
    }

    std::ifstream in(configPath);
    if (!in.is_open()) {
        return runtimeConfig;
    }

    json root = json::parse(in, nullptr, false);
    if (root.is_discarded()) {
        return runtimeConfig;
    }

    const json brandNode = root["brands"][brandId];
    if (!brandNode.is_object()) {
        return runtimeConfig;
    }

    auto readString = [&](const char* key, std::string AppBrand::detail::RuntimeBrandConfig::* field) {
        const json value = brandNode[key];
        if (value.is_string()) {
            runtimeConfig.*field = TrimCopy(value.get<std::string>());
        }
    };

    readString("displayName", &AppBrand::detail::RuntimeBrandConfig::displayName);
    readString("assistantName", &AppBrand::detail::RuntimeBrandConfig::assistantName);
    readString("chatName", &AppBrand::detail::RuntimeBrandConfig::chatName);
    readString("trayTooltip", &AppBrand::detail::RuntimeBrandConfig::trayTooltip);
    readString("backgroundNotificationTitle", &AppBrand::detail::RuntimeBrandConfig::backgroundNotificationTitle);
    readString("backgroundNotificationMessage", &AppBrand::detail::RuntimeBrandConfig::backgroundNotificationMessage);
    readString("windowClassName", &AppBrand::detail::RuntimeBrandConfig::windowClassName);
    readString("windowTitle", &AppBrand::detail::RuntimeBrandConfig::windowTitle);
    readString("pairDialogTitle", &AppBrand::detail::RuntimeBrandConfig::pairDialogTitle);
    readString("pairingSuccessTitle", &AppBrand::detail::RuntimeBrandConfig::pairingSuccessTitle);
    readString("aboutDialogTitle", &AppBrand::detail::RuntimeBrandConfig::aboutDialogTitle);
    readString("aboutVersionText", &AppBrand::detail::RuntimeBrandConfig::aboutVersionText);
    readString("emailSubjectPrefix", &AppBrand::detail::RuntimeBrandConfig::emailSubjectPrefix);
    readString("appUserModelId", &AppBrand::detail::RuntimeBrandConfig::appUserModelId);
    readString("trayIconGuid", &AppBrand::detail::RuntimeBrandConfig::trayIconGuid);
    readString("storageNamespace", &AppBrand::detail::RuntimeBrandConfig::storageNamespace);
    readString("dataRootWindows", &AppBrand::detail::RuntimeBrandConfig::dataRootWindows);
    readString("dataRootMacOS", &AppBrand::detail::RuntimeBrandConfig::dataRootMacOS);
    readString("dataRootLinux", &AppBrand::detail::RuntimeBrandConfig::dataRootLinux);
    readString("inferenceLoopTempDirName", &AppBrand::detail::RuntimeBrandConfig::inferenceLoopTempDirName);
    readString("jobsInferenceTempDirName", &AppBrand::detail::RuntimeBrandConfig::jobsInferenceTempDirName);
    readString("videoSegmentsTempDirName", &AppBrand::detail::RuntimeBrandConfig::videoSegmentsTempDirName);
    readString("debugConcatTempDirName", &AppBrand::detail::RuntimeBrandConfig::debugConcatTempDirName);
    readString("uploadedVideosTempDirName", &AppBrand::detail::RuntimeBrandConfig::uploadedVideosTempDirName);
    readString("baseUrlEnvVarName", &AppBrand::detail::RuntimeBrandConfig::baseUrlEnvVarName);
    readString("legacyBaseUrlEnvVarName", &AppBrand::detail::RuntimeBrandConfig::legacyBaseUrlEnvVarName);
    readString("baseUrlFileName", &AppBrand::detail::RuntimeBrandConfig::baseUrlFileName);
    readString("legacyBaseUrlFileName", &AppBrand::detail::RuntimeBrandConfig::legacyBaseUrlFileName);

    runtimeConfig.brandId = brandId;
    PopulateWideFields(runtimeConfig);
    return runtimeConfig;
}
}

namespace AppBrand::detail {
const RuntimeBrandConfig& config() {
    static const RuntimeBrandConfig instance = LoadConfigFromJson();
    return instance;
}
}

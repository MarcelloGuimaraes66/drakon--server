import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const configPath = path.join(workspaceRoot, "brand.config.json");
const brandSelectorPath = path.join(workspaceRoot, "brand.txt");
const drakonSiteRoot = path.join(workspaceRoot, "DrakonSite");
const drakonSiteIndexPath = path.join(drakonSiteRoot, "index.html");
const appHostRoot = path.join(workspaceRoot, "AppHost");
const appHostGeneratedDir = path.join(appHostRoot, "generated");
const appHostPropsPath = path.join(appHostGeneratedDir, "Branding.props");
const appHostRcPath = path.join(appHostGeneratedDir, "Branding.rc2");
const appHostInstallerIncludePath = path.join(
  appHostGeneratedDir,
  "InstallerBranding.iss"
);
const appHostIconPath = path.join(appHostGeneratedDir, "current_app_icon.ico");
const cppRoot = path.join(workspaceRoot, "Perceptrum", "Perceptrum");
const frontendGeneratedPath = path.join(
  drakonSiteRoot,
  "src",
  "shared",
  "generated",
  "brand.generated.ts"
);
const frontendPublicBrandingDir = path.join(
  drakonSiteRoot,
  "public",
  "branding",
  "current"
);
const cppGeneratedDir = path.join(cppRoot, "generated");
const cppHeaderPath = path.join(cppGeneratedDir, "Branding.h");
const cppRcPath = path.join(cppGeneratedDir, "Branding.rc2");
const cppPropsPath = path.join(cppGeneratedDir, "Branding.props");
const cppIconPath = path.join(cppGeneratedDir, "current_app_icon.ico");
const cppLegacyMainIconPath = path.join(cppRoot, "Perceptrum.ico");
const cppLegacySmallIconPath = path.join(cppRoot, "small.ico");

const installerAppIds = {
  drakon: "{{1A38F955-1A1A-4F72-9A68-0A8F2D7E30B1}",
  perceptrum: "{{4A4E93F6-0D65-42E3-9C8C-90A9340A0C52}",
};

function parseArgs(argv) {
  const args = { brand: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--brand" || token === "-b") {
      args.brand = argv[index + 1] ?? null;
      index += 1;
    }
  }
  return args;
}

function escapeTs(value) {
  return JSON.stringify(value);
}

function escapeCpp(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function escapeWideCpp(value) {
  return `L"${escapeCpp(value)}"`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function clearDir(dir) {
  await ensureDir(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(dir, entry.name), { recursive: true, force: true })
    )
  );
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function copyAsset(relativeSourcePath, targetStem, brandKey) {
  if (!relativeSourcePath) {
    return null;
  }

  const sourcePath = path.join(workspaceRoot, relativeSourcePath);
  const extension = path.extname(sourcePath) || ".bin";
  const targetName = `${brandKey}-${targetStem}${extension}`;
  const targetPath = path.join(frontendPublicBrandingDir, targetName);

  await fs.copyFile(sourcePath, targetPath);
  return `/branding/current/${targetName.replace(/\\/g, "/")}`;
}

async function readBrandSelector() {
  try {
    const raw = await fs.readFile(brandSelectorPath, "utf8");
    return raw.trim().toLowerCase();
  } catch {
    return "";
  }
}

async function writeBrandSelector(brandKey) {
  await fs.writeFile(brandSelectorPath, `${brandKey}\n`, "utf8");
}

function buildFrontendGenerated(config, activeBrandKey, activeBrand, frontendAssets) {
  const knownBrandNames = Object.values(config.brands).map((brand) => brand.displayName);
  const dataRootWindows = activeBrand.dataRootWindows;
  const mediaBaseDirCandidates = Array.from(
    new Set([
      dataRootWindows,
      dataRootWindows.replace(/^([A-Z]):\\/i, "D:\\"),
    ])
  );

  return `export const branding = {
  activeBrand: ${escapeTs(activeBrandKey)},
  knownBrandNames: ${JSON.stringify(knownBrandNames)},
  brand: {
    id: ${escapeTs(activeBrandKey)},
    displayName: ${escapeTs(activeBrand.displayName)},
    assistantName: ${escapeTs(activeBrand.assistantName)},
    chatName: ${escapeTs(activeBrand.chatName)},
    quickChatName: ${escapeTs(activeBrand.quickChatName)},
    siteTitle: ${escapeTs(activeBrand.siteTitle)},
    siteUrl: ${escapeTs(activeBrand.siteUrl)},
    siteDescription: ${escapeTs(activeBrand.siteDescription)},
    marketingTitle: ${escapeTs(activeBrand.marketingTitle)},
    trayTooltip: ${escapeTs(activeBrand.trayTooltip)},
    backgroundNotificationTitle: ${escapeTs(activeBrand.backgroundNotificationTitle)},
    backgroundNotificationMessage: ${escapeTs(activeBrand.backgroundNotificationMessage)},
    windowClassName: ${escapeTs(activeBrand.windowClassName)},
    windowTitle: ${escapeTs(activeBrand.windowTitle)},
    pairDialogTitle: ${escapeTs(activeBrand.pairDialogTitle)},
    pairingSuccessTitle: ${escapeTs(activeBrand.pairingSuccessTitle)},
    aboutDialogTitle: ${escapeTs(activeBrand.aboutDialogTitle)},
    aboutVersionText: ${escapeTs(activeBrand.aboutVersionText)},
    resourceKey: ${escapeTs(activeBrand.resourceKey)},
    emailSubjectPrefix: ${escapeTs(activeBrand.emailSubjectPrefix)},
    allowedOrigins: ${JSON.stringify(activeBrand.allowedOrigins)},
    features: {
      billingEnabled: ${activeBrand.features?.billingEnabled ? "true" : "false"},
      drakonFindEnabled: ${activeBrand.features?.drakonFindEnabled ? "true" : "false"},
      googleLoginEnabled: ${activeBrand.features?.googleLoginEnabled ? "true" : "false"}
    },
    storageKeys: {
      sidebarCollapsed: ${escapeTs(`${activeBrand.storageNamespace}:sidebar-collapsed`)},
      globalModelTier: ${escapeTs(`${activeBrand.storageNamespace}_global_model_tier`)},
      globalRunningResolution: ${escapeTs(`${activeBrand.storageNamespace}_global_running_resolution`)},
      globalUltraModelFps: ${escapeTs(`${activeBrand.storageNamespace}_global_ultra_model_fps`)}
    },
    windowEvents: {
      openAiKeyRequired: ${escapeTs(`${activeBrand.eventNamespace}:openai-key-required`)},
      zAiKeyRequired: ${escapeTs(`${activeBrand.eventNamespace}:zai-key-required`)}
    },
    cookieNames: {
      localSession: ${escapeTs(`${activeBrand.cookiePrefix}_local_session`)}
    },
    dataPaths: {
      rootWindows: ${escapeTs(dataRootWindows)},
      jobAlertClips: ${escapeTs(`${dataRootWindows}\\job_alert_clips`)},
      jobAlertImages: ${escapeTs(`${dataRootWindows}\\job_alert_images`)},
      mediaBaseDirCandidates: ${JSON.stringify(mediaBaseDirCandidates)}
    },
    assets: {
      logoMode: ${escapeTs(activeBrand.frontend.logoMode)},
      wordmarkDarkPath: ${frontendAssets.wordmarkDarkPath === null ? "null" : escapeTs(frontendAssets.wordmarkDarkPath)},
      wordmarkLightPath: ${frontendAssets.wordmarkLightPath === null ? "null" : escapeTs(frontendAssets.wordmarkLightPath)},
      loginWordmarkDarkPath: ${frontendAssets.loginWordmarkDarkPath === null ? "null" : escapeTs(frontendAssets.loginWordmarkDarkPath)},
      loginWordmarkLightPath: ${frontendAssets.loginWordmarkLightPath === null ? "null" : escapeTs(frontendAssets.loginWordmarkLightPath)},
      iconDarkPath: ${frontendAssets.iconDarkPath === null ? "null" : escapeTs(frontendAssets.iconDarkPath)},
      iconLightPath: ${frontendAssets.iconLightPath === null ? "null" : escapeTs(frontendAssets.iconLightPath)},
      faviconPath: ${frontendAssets.faviconPath === null ? "null" : escapeTs(frontendAssets.faviconPath)},
      faviconPngPath: ${frontendAssets.faviconPngPath === null ? "null" : escapeTs(frontendAssets.faviconPngPath)},
      appleTouchIconPath: ${frontendAssets.appleTouchIconPath === null ? "null" : escapeTs(frontendAssets.appleTouchIconPath)}
    }
  }
} as const;

export type ActiveBrandConfig = typeof branding.brand;
`;
}

function buildIndexHtml(activeBrand, frontendAssets) {
  const faviconPath = frontendAssets.faviconPath || frontendAssets.faviconPngPath || "/branding/current/favicon.ico";
  const faviconPngPath = frontendAssets.faviconPngPath || null;
  const appleTouchIconPath =
    frontendAssets.appleTouchIconPath || frontendAssets.faviconPngPath || null;
  return `<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${activeBrand.siteUrl}" />
    <meta property="og:title" content="${activeBrand.marketingTitle}" />
    <meta property="og:description" content="${activeBrand.siteDescription}" />
    <meta
      property="og:image"
      content="https://mocha-cdn.com/019ab6d6-cd5a-76f6-851a-a03a6c1adf6a/-COLOR-big.jpg"
    />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${activeBrand.marketingTitle}" />
    <meta name="twitter:description" content="${activeBrand.siteDescription}" />
    <meta
      name="twitter:image"
      content="https://mocha-cdn.com/019ab6d6-cd5a-76f6-851a-a03a6c1adf6a/-COLOR-big.jpg"
    />
    <link rel="icon" href="${faviconPath}" sizes="any" />
    ${faviconPngPath ? `<link rel="icon" type="image/png" sizes="32x32" href="${faviconPngPath}" />` : ""}
    ${appleTouchIconPath ? `<link rel="apple-touch-icon" sizes="180x180" href="${appleTouchIconPath}" />` : ""}
    <title>${activeBrand.siteTitle}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/react-app/main.tsx"></script>
  </body>
</html>
`;
}

function buildCppHeader(activeBrandKey, activeBrand) {
  return `#pragma once

#include <filesystem>

namespace AppBrand {
inline constexpr char kBrandId[] = "${escapeCpp(activeBrandKey)}";
inline constexpr char kDisplayName[] = "${escapeCpp(activeBrand.displayName)}";
inline constexpr char kAssistantName[] = "${escapeCpp(activeBrand.assistantName)}";
inline constexpr char kChatName[] = "${escapeCpp(activeBrand.chatName)}";
inline constexpr char kTrayTooltip[] = "${escapeCpp(activeBrand.trayTooltip)}";
inline constexpr char kBackgroundNotificationTitle[] = "${escapeCpp(activeBrand.backgroundNotificationTitle)}";
inline constexpr char kBackgroundNotificationMessage[] = "${escapeCpp(activeBrand.backgroundNotificationMessage)}";
inline constexpr char kWindowClassName[] = "${escapeCpp(activeBrand.windowClassName)}";
inline constexpr char kWindowTitle[] = "${escapeCpp(activeBrand.windowTitle)}";
inline constexpr char kPairDialogTitle[] = "${escapeCpp(activeBrand.pairDialogTitle)}";
inline constexpr char kPairingSuccessTitle[] = "${escapeCpp(activeBrand.pairingSuccessTitle)}";
inline constexpr char kAboutDialogTitle[] = "${escapeCpp(activeBrand.aboutDialogTitle)}";
inline constexpr char kAboutVersionText[] = "${escapeCpp(activeBrand.aboutVersionText)}";
inline constexpr char kEmailSubjectPrefix[] = "${escapeCpp(activeBrand.emailSubjectPrefix)}";
inline constexpr char kAppUserModelId[] = "${escapeCpp(activeBrand.appUserModelId)}";
inline constexpr char kTrayIconGuid[] = "${escapeCpp(activeBrand.trayIconGuid)}";
inline constexpr char kDataRootWindows[] = "${escapeCpp(activeBrand.dataRootWindows)}";
inline constexpr char kInferenceLoopTempDirName[] = "${escapeCpp(activeBrand.inferenceLoopTempDirName)}";
inline constexpr char kJobsInferenceTempDirName[] = "${escapeCpp(activeBrand.jobsInferenceTempDirName)}";
inline constexpr char kVideoSegmentsTempDirName[] = "${escapeCpp(activeBrand.videoSegmentsTempDirName)}";
inline constexpr char kDebugConcatTempDirName[] = "${escapeCpp(activeBrand.debugConcatTempDirName)}";
inline constexpr char kUploadedVideosTempDirName[] = "${escapeCpp(activeBrand.uploadedVideosTempDirName)}";
inline constexpr char kBaseUrlEnvVarName[] = "${escapeCpp(activeBrand.baseUrlEnvVarName)}";
inline constexpr char kLegacyBaseUrlEnvVarName[] = "${escapeCpp(activeBrand.legacyBaseUrlEnvVarName)}";
inline constexpr char kBaseUrlFileName[] = "${escapeCpp(activeBrand.baseUrlFileName)}";
inline constexpr char kLegacyBaseUrlFileName[] = "${escapeCpp(activeBrand.legacyBaseUrlFileName)}";

inline constexpr wchar_t kDisplayNameW[] = ${escapeWideCpp(activeBrand.displayName)};
inline constexpr wchar_t kTrayTooltipW[] = ${escapeWideCpp(activeBrand.trayTooltip)};
inline constexpr wchar_t kBackgroundNotificationTitleW[] = ${escapeWideCpp(activeBrand.backgroundNotificationTitle)};
inline constexpr wchar_t kBackgroundNotificationMessageW[] = ${escapeWideCpp(activeBrand.backgroundNotificationMessage)};
inline constexpr wchar_t kWindowClassNameW[] = ${escapeWideCpp(activeBrand.windowClassName)};
inline constexpr wchar_t kWindowTitleW[] = ${escapeWideCpp(activeBrand.windowTitle)};
inline constexpr wchar_t kPairDialogTitleW[] = ${escapeWideCpp(activeBrand.pairDialogTitle)};
inline constexpr wchar_t kPairingSuccessTitleW[] = ${escapeWideCpp(activeBrand.pairingSuccessTitle)};
inline constexpr wchar_t kAppUserModelIdW[] = ${escapeWideCpp(activeBrand.appUserModelId)};
inline constexpr wchar_t kTrayIconGuidW[] = ${escapeWideCpp(activeBrand.trayIconGuid)};

inline std::filesystem::path dataRoot() {
    return std::filesystem::path(kDataRootWindows);
}

inline std::filesystem::path inferenceLoopTempRoot() {
    return std::filesystem::temp_directory_path() / kInferenceLoopTempDirName;
}

inline std::filesystem::path jobsInferenceTempRoot() {
    return std::filesystem::temp_directory_path() / kJobsInferenceTempDirName;
}

inline std::filesystem::path videoSegmentsTempRoot() {
    return std::filesystem::temp_directory_path() / kVideoSegmentsTempDirName;
}

inline std::filesystem::path debugConcatTempRoot() {
    return std::filesystem::temp_directory_path() / kDebugConcatTempDirName;
}

inline std::filesystem::path uploadedVideosTempRoot() {
    return std::filesystem::temp_directory_path() / kUploadedVideosTempDirName;
}

inline std::filesystem::path jobAlertImagesRoot() {
    return dataRoot() / "job_alert_images";
}

inline std::filesystem::path jobAlertClipsRoot() {
    return dataRoot() / "job_alert_clips";
}
}
`;
}

function buildCppRc(activeBrand) {
  return `#define BRAND_MAIN_ICON "generated\\\\current_app_icon.ico"
#define BRAND_ABOUT_DIALOG_TITLE "${escapeCpp(activeBrand.aboutDialogTitle)}"
#define BRAND_ABOUT_VERSION_TEXT "${escapeCpp(activeBrand.aboutVersionText)}"
#define BRAND_APP_TITLE "${escapeCpp(activeBrand.displayName)}"
#define BRAND_PAIR_DIALOG_TITLE "${escapeCpp(activeBrand.pairDialogTitle)}"
#define BRAND_RESOURCE_KEY "${escapeCpp(activeBrand.resourceKey)}"
`;
}

function buildCppProps(activeBrand) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <TargetName>${activeBrand.cpp.targetName}</TargetName>
  </PropertyGroup>
</Project>
`;
}

function buildAppHostProps(activeBrandKey, activeBrand) {
  return `<?xml version="1.0" encoding="utf-8"?>
<Project xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <TargetName>${activeBrand.cpp.targetName}</TargetName>
    <BuildBrandId>${activeBrandKey}</BuildBrandId>
    <BuildDisplayName>${activeBrand.displayName}</BuildDisplayName>
  </PropertyGroup>
</Project>
`;
}

function buildAppHostRc2() {
  return `#define APPHOST_MAIN_ICON "generated\\\\current_app_icon.ico"
`;
}

function buildInstallerBranding(activeBrandKey, activeBrand) {
  const exeName = `${activeBrand.cpp.targetName}.exe`;
  const outputBaseFilename = `${activeBrand.cpp.targetName}Installer`;
  const defaultDirName = `{autopf}\\${activeBrand.cpp.targetName}`;
  const appId = installerAppIds[activeBrandKey] || installerAppIds.perceptrum;

  return `#define MyAppId "${appId}"
#define MyAppName "${escapeCpp(activeBrand.displayName)}"
#define MyExeName "${escapeCpp(exeName)}"
#define MyOutputBaseFilename "${escapeCpp(outputBaseFilename)}"
#define MyDefaultDirName "${escapeCpp(defaultDirName)}"
#define MyShortcutName "${escapeCpp(activeBrand.displayName)}"
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await readJson(configPath);
  let selectedBrand = "";

  if (args.brand) {
    if (!config.brands[args.brand]) {
      throw new Error(`Unknown brand "${args.brand}". Available brands: ${Object.keys(config.brands).join(", ")}`);
    }
    selectedBrand = args.brand;
  } else {
    selectedBrand = await readBrandSelector();
    if (!selectedBrand) {
      selectedBrand = config.activeBrand;
    }
  }

  if (!config.brands[selectedBrand]) {
    throw new Error(
      `Invalid brand "${selectedBrand}" in ${path.basename(brandSelectorPath)}. Available brands: ${Object.keys(config.brands).join(", ")}`
    );
  }

  if (config.activeBrand !== selectedBrand) {
    config.activeBrand = selectedBrand;
    await writeJson(configPath, config);
  }

  await writeBrandSelector(selectedBrand);

  const activeBrandKey = config.activeBrand;
  const activeBrand = config.brands[activeBrandKey];

  if (!activeBrand) {
    throw new Error(`Active brand "${activeBrandKey}" is missing from brand.config.json`);
  }

  await ensureDir(path.dirname(frontendGeneratedPath));
  await clearDir(frontendPublicBrandingDir);
  await ensureDir(cppGeneratedDir);
  await ensureDir(appHostGeneratedDir);

  const frontendAssets = {
    wordmarkDarkPath: await copyAsset(activeBrand.frontend.wordmarkDarkSource, "wordmark-dark", activeBrandKey),
    wordmarkLightPath: await copyAsset(activeBrand.frontend.wordmarkLightSource, "wordmark-light", activeBrandKey),
    loginWordmarkDarkPath: await copyAsset(
      activeBrand.frontend.loginWordmarkDarkSource ?? null,
      "login-wordmark-dark",
      activeBrandKey
    ),
    loginWordmarkLightPath: await copyAsset(
      activeBrand.frontend.loginWordmarkLightSource ?? null,
      "login-wordmark-light",
      activeBrandKey
    ),
    iconDarkPath: await copyAsset(activeBrand.frontend.iconDarkSource, "icon-dark", activeBrandKey),
    iconLightPath: await copyAsset(activeBrand.frontend.iconLightSource, "icon-light", activeBrandKey),
    faviconPath: await copyAsset(activeBrand.frontend.faviconSource, "favicon", activeBrandKey),
    faviconPngPath: await copyAsset(activeBrand.frontend.faviconPngSource ?? null, "favicon-png", activeBrandKey),
    appleTouchIconPath: await copyAsset(activeBrand.frontend.appleTouchSource ?? null, "apple-touch-icon", activeBrandKey),
  };

  await fs.copyFile(
    path.join(workspaceRoot, activeBrand.cpp.iconSource),
    cppIconPath
  );
  await fs.copyFile(
    path.join(workspaceRoot, activeBrand.cpp.iconSource),
    appHostIconPath
  );
  await fs.copyFile(
    path.join(workspaceRoot, activeBrand.cpp.iconSource),
    cppLegacyMainIconPath
  );
  await fs.copyFile(
    path.join(workspaceRoot, activeBrand.cpp.iconSource),
    cppLegacySmallIconPath
  );

  await fs.writeFile(
    frontendGeneratedPath,
    buildFrontendGenerated(config, activeBrandKey, activeBrand, frontendAssets),
    "utf8"
  );
  await fs.writeFile(drakonSiteIndexPath, buildIndexHtml(activeBrand, frontendAssets), "utf8");
  await fs.writeFile(cppHeaderPath, buildCppHeader(activeBrandKey, activeBrand), "utf8");
  await fs.writeFile(cppRcPath, buildCppRc(activeBrand), "utf8");
  await fs.writeFile(cppPropsPath, buildCppProps(activeBrand), "utf8");
  await fs.writeFile(appHostPropsPath, buildAppHostProps(activeBrandKey, activeBrand), "utf8");
  await fs.writeFile(appHostRcPath, buildAppHostRc2(), "utf8");
  await fs.writeFile(
    appHostInstallerIncludePath,
    buildInstallerBranding(activeBrandKey, activeBrand),
    "utf8"
  );

  process.stdout.write(`Applied active brand: ${activeBrand.displayName}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const appHostRoot = path.join(workspaceRoot, "AppHost");
const drakonSiteRoot = path.join(workspaceRoot, "DrakonSite");
const cliArgs = parseArgs(process.argv.slice(2));
const stageRoot = cliArgs.out
  ? path.resolve(cliArgs.out)
  : path.join(appHostRoot, "stage");
const runtimeRoot = path.join(stageRoot, "runtime");
const runtimeWebRoot = path.join(runtimeRoot, "web");
const runtimeBrandingRoot = path.join(runtimeRoot, "branding");
const runtimeBootstrapRoot = path.join(runtimeRoot, "bootstrap");
const runtimeDrakonSiteRoot = path.join(runtimeRoot, "drakonsite");
const runtimeNodeRoot = path.join(runtimeRoot, "node");
const bundledBackendPath = path.join(runtimeRoot, "desktop-local-server.cjs");
const configPath = path.join(workspaceRoot, "brand.config.json");
const brandSelectorPath = path.join(workspaceRoot, "brand.txt");
const requireFromDrakonSite = createRequire(path.join(drakonSiteRoot, "package.json"));
const esbuild = requireFromDrakonSite("esbuild");
const dotenv = requireFromDrakonSite("dotenv");
const execFileAsync = promisify(execFile);
const desktopRuntimeEnvKeys = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "CHAT_V2_ENABLED",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_CHAT_PAYG_PRICE_ID",
  "USD_TO_BRL",
  "SCHEDULER_TICK_SECRET",
];

function parseArgs(argv) {
  const args = { out: "" };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out" || token === "-o") {
      args.out = argv[index + 1] ?? "";
      index += 1;
    }
  }

  return args;
}

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const activeBrandId = String(config.activeBrand || "perceptrum").trim().toLowerCase();
const activeBrand = config.brands?.[activeBrandId];

if (!activeBrand) {
  throw new Error(`Active brand "${activeBrandId}" is not defined in brand.config.json`);
}

await fs.rm(stageRoot, { recursive: true, force: true });
await fs.mkdir(runtimeRoot, { recursive: true });
await fs.mkdir(runtimeWebRoot, { recursive: true });
await fs.mkdir(runtimeBrandingRoot, { recursive: true });
await fs.mkdir(runtimeBootstrapRoot, { recursive: true });
await fs.mkdir(runtimeDrakonSiteRoot, { recursive: true });
await fs.mkdir(runtimeNodeRoot, { recursive: true });

await bundleDesktopLocalBackend();
await fs.copyFile(configPath, path.join(stageRoot, "brand.config.json"));
await fs.copyFile(configPath, path.join(runtimeRoot, "brand.config.json"));
if (await exists(brandSelectorPath)) {
  await fs.copyFile(brandSelectorPath, path.join(stageRoot, "brand.txt"));
  await fs.copyFile(brandSelectorPath, path.join(runtimeRoot, "brand.txt"));
}
await fs.copyFile(process.execPath, path.join(runtimeNodeRoot, "node.exe"));
await stageDesktopRuntimeEnv();

await copyDir(path.join(drakonSiteRoot, "dist"), runtimeWebRoot);

const webBrandDir = path.join(runtimeWebRoot, "branding", "current");
await fs.mkdir(webBrandDir, { recursive: true });
await copyBrandAsset(activeBrand.frontend?.wordmarkDarkSource, webBrandDir, "wordmark-dark", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.wordmarkLightSource, webBrandDir, "wordmark-light", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.loginWordmarkDarkSource, webBrandDir, "login-wordmark-dark", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.loginWordmarkLightSource, webBrandDir, "login-wordmark-light", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.iconDarkSource, webBrandDir, "icon-dark", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.iconLightSource, webBrandDir, "icon-light", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.faviconSource, webBrandDir, "favicon", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.faviconPngSource, webBrandDir, "favicon-png", activeBrandId);
await copyBrandAsset(activeBrand.frontend?.appleTouchSource, webBrandDir, "apple-touch-icon", activeBrandId);

if (shouldBundleDesktopSqliteSeed(activeBrandId)) {
  await generateDesktopSqliteSeed(activeBrandId);
}

if (activeBrand.cpp?.iconSource) {
  const cppIconSource = path.join(workspaceRoot, activeBrand.cpp.iconSource);
  await fs.copyFile(cppIconSource, path.join(runtimeBrandingRoot, "app.ico"));
}

console.log(`Staged AppHost runtime at ${stageRoot}`);

async function copyDir(source, destination) {
  if (!(await exists(source))) {
    return;
  }

  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
  });
}

async function bundleDesktopLocalBackend() {
  await esbuild.build({
    entryPoints: [path.join(appHostRoot, "Runtime", "desktop-local-server.mjs")],
    absWorkingDir: drakonSiteRoot,
    alias: {
      "@": path.join(drakonSiteRoot, "src"),
    },
    bundle: true,
    conditions: ["node", "require", "default"],
    format: "cjs",
    logLevel: "info",
    minify: false,
    nodePaths: [path.join(drakonSiteRoot, "node_modules")],
    outfile: bundledBackendPath,
    platform: "node",
    sourcemap: false,
    target: "node22",
  });
}

async function copyBrandAsset(relativeSourcePath, destinationDir, stem, brandId) {
  if (!relativeSourcePath) {
    return;
  }

  const sourcePath = path.join(workspaceRoot, relativeSourcePath);
  if (!(await exists(sourcePath))) {
    return;
  }

  const extension = path.extname(sourcePath) || ".bin";
  await fs.copyFile(sourcePath, path.join(destinationDir, `${brandId}-${stem}${extension}`));
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function stageDesktopRuntimeEnv() {
  const initEnvPath = path.join(drakonSiteRoot, ".env.init");
  if (await exists(initEnvPath)) {
    await fs.copyFile(initEnvPath, path.join(runtimeDrakonSiteRoot, ".env.init"));
  }

  const sourceLocalEnv = await loadEnvFile(path.join(drakonSiteRoot, ".env.local"));
  const runtimeEnv = {};

  for (const key of desktopRuntimeEnvKeys) {
    const value = resolveRuntimeEnvValue(key, sourceLocalEnv);
    if (value) {
      runtimeEnv[key] = value;
    }
  }

  if (activeBrand.features?.googleLoginEnabled) {
    ensureRequiredRuntimeEnv(runtimeEnv, [
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
    ]);
  }

  let desktopGoogleRedirectUri = resolveRuntimeEnvValue(
    "DESKTOP_GOOGLE_OAUTH_REDIRECT_URI",
    sourceLocalEnv
  );
  if (!desktopGoogleRedirectUri && activeBrand.features?.googleLoginEnabled) {
    desktopGoogleRedirectUri = resolveDefaultDesktopGoogleRedirectUri();
  }
  if (desktopGoogleRedirectUri) {
    runtimeEnv.DESKTOP_GOOGLE_OAUTH_REDIRECT_URI = desktopGoogleRedirectUri;
  }

  await fs.writeFile(
    path.join(runtimeDrakonSiteRoot, ".env.local"),
    serializeEnv(runtimeEnv),
    "utf8"
  );
}

async function loadEnvFile(filePath) {
  if (!(await exists(filePath))) {
    return {};
  }

  const content = await fs.readFile(filePath, "utf8");
  return dotenv.parse(content);
}

function resolveRuntimeEnvValue(key, sourceEnv) {
  const fromProcess = String(process.env[key] || "").trim();
  if (fromProcess) {
    return fromProcess;
  }

  return String(sourceEnv[key] || "").trim();
}

function resolveDefaultDesktopGoogleRedirectUri() {
  const siteUrl = String(activeBrand.siteUrl || "").trim();
  if (!siteUrl) {
    return "";
  }

  try {
    return new URL("/auth/callback", siteUrl).toString();
  } catch {
    return "";
  }
}

function ensureRequiredRuntimeEnv(envMap, requiredKeys) {
  const missingKeys = requiredKeys.filter((key) => !String(envMap[key] || "").trim());
  if (missingKeys.length === 0) {
    return;
  }

  throw new Error(
    `Desktop runtime env is missing required keys for ${activeBrandId}: ${missingKeys.join(", ")}`
  );
}

function serializeEnv(envMap) {
  const header = [
    "# Generated by AppHost/Packaging/stage-runtime.mjs",
    "# Values here are limited to the desktop runtime bootstrap surface.",
    "",
  ];
  const lines = Object.entries(envMap)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${serializeEnvValue(value)}`);
  return `${header.join("\n")}${lines.join("\n")}\n`;
}

function serializeEnvValue(value) {
  if (value === "") {
    return "";
  }

  if (/[\s#"'`]/.test(value)) {
    return JSON.stringify(value);
  }

  return value;
}

function shouldBundleDesktopSqliteSeed(brandId) {
  return brandId === "perceptrum" || brandId === "drakon";
}

async function generateDesktopSqliteSeed(brandId) {
  const converterPath = path.join(
    drakonSiteRoot,
    "scripts",
    "convert-postgres-dump-to-sqlite.mjs"
  );
  const siteStem = `${brandId}_site`;
  const seedDbPath = path.join(runtimeBootstrapRoot, `${siteStem}.seed.sqlite`);
  const seedReportPath = path.join(
    runtimeBootstrapRoot,
    `${siteStem}.seed.import-report.json`
  );
  const seedSchemaPath = path.join(
    runtimeBootstrapRoot,
    `${siteStem}.seed.schema.sql`
  );

  await execFileAsync(
    process.execPath,
    [
      converterPath,
      "--brand",
      brandId,
      "--schema-only",
      "--out",
      seedDbPath,
      "--report",
      seedReportPath,
      "--schema-out",
      seedSchemaPath,
    ],
    {
      cwd: workspaceRoot,
    }
  );
}

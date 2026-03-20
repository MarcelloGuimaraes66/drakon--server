import fs from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
const appHostRoot = path.join(workspaceRoot, "AppHost");
const drakonSiteRoot = path.join(workspaceRoot, "DrakonSite");
const stageRoot = path.join(appHostRoot, "stage");
const runtimeRoot = path.join(stageRoot, "runtime");
const runtimeWebRoot = path.join(runtimeRoot, "web");
const runtimeBrandingRoot = path.join(runtimeRoot, "branding");
const runtimeDrakonSiteRoot = path.join(runtimeRoot, "drakonsite");
const runtimeNodeRoot = path.join(runtimeRoot, "node");
const configPath = path.join(workspaceRoot, "brand.config.json");
const brandSelectorPath = path.join(workspaceRoot, "brand.txt");

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
await fs.mkdir(runtimeDrakonSiteRoot, { recursive: true });
await fs.mkdir(runtimeNodeRoot, { recursive: true });

await fs.copyFile(path.join(appHostRoot, "Runtime", "desktop-local-server.mjs"), path.join(runtimeRoot, "desktop-local-server.mjs"));
await fs.copyFile(configPath, path.join(stageRoot, "brand.config.json"));
await fs.copyFile(configPath, path.join(runtimeRoot, "brand.config.json"));
if (await exists(brandSelectorPath)) {
  await fs.copyFile(brandSelectorPath, path.join(stageRoot, "brand.txt"));
  await fs.copyFile(brandSelectorPath, path.join(runtimeRoot, "brand.txt"));
}
await fs.copyFile(process.execPath, path.join(runtimeNodeRoot, "node.exe"));

await copyDir(path.join(drakonSiteRoot, "dist"), runtimeWebRoot);

for (const relativePath of [
  "server",
  "src",
  "scripts",
  "db",
  "node_modules",
]) {
  await copyDir(path.join(drakonSiteRoot, relativePath), path.join(runtimeDrakonSiteRoot, relativePath));
}

for (const fileName of [
  "package.json",
  "worker-configuration.d.ts",
  ".env.local",
  ".env.server",
  ".env.init",
]) {
  const sourcePath = path.join(drakonSiteRoot, fileName);
  if (await exists(sourcePath)) {
    await fs.copyFile(sourcePath, path.join(runtimeDrakonSiteRoot, fileName));
  }
}

for (const entry of await fs.readdir(drakonSiteRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/^tsconfig(\..+)?\.json$/i.test(entry.name)) {
    continue;
  }

  const sourcePath = path.join(drakonSiteRoot, entry.name);
  await fs.copyFile(sourcePath, path.join(runtimeDrakonSiteRoot, entry.name));
}

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

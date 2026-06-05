import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

type RuntimeProfile = "local" | "server";
type ProfileMode = RuntimeProfile | "auto";

const initialEnvValues = new Map(
  Object.entries(process.env).filter(([, value]) => value !== undefined) as Array<[string, string]>
);

const centralAuthClientKeys = new Set([
  "CENTRAL_AUTH_BASE_URL",
  "CENTRAL_AUTH_PUBLIC_KEY",
  "CENTRAL_AUTH_PUBLIC_KEY_PATH",
  "CENTRAL_AUTH_GRANT_TTL_HOURS",
  "CENTRAL_AUTH_KEY_ID",
]);

function normalizeProfile(value: string | undefined): ProfileMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "server" || normalized === "auto") {
    return normalized;
  }
  return null;
}

function loadIfExists(filePath: string) {
  const result = dotenv.config({ path: filePath });
  if (result.error) {
    const maybeErr = result.error as NodeJS.ErrnoException;
    if (maybeErr.code === "ENOENT") return false;
    throw result.error;
  }
  return true;
}

function normalizeText(value: string | undefined): string {
  return (value || "").trim();
}

function hasInitialNonBlankEnvValue(key: string): boolean {
  return normalizeText(initialEnvValues.get(key)).length > 0;
}

function loadParsedEnvFile(
  filePath: string,
  options: {
    allowedKeys?: Set<string>;
    overrideLoadedValues?: boolean;
  } = {}
) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const parsed = dotenv.parse(fs.readFileSync(filePath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (options.allowedKeys && !options.allowedKeys.has(key)) {
      continue;
    }
    if (hasInitialNonBlankEnvValue(key)) {
      continue;
    }

    const currentValue = process.env[key];
    if (options.overrideLoadedValues || normalizeText(currentValue).length === 0) {
      process.env[key] = value;
    }
  }

  return true;
}

function resolveUserPerceptrumConfigPath(fileName: string): string | null {
  const home = os.homedir();
  if (!home) {
    return null;
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "Perceptrum", fileName);
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Perceptrum", fileName);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdgConfigHome, "Perceptrum", fileName);
}

function loadCentralAuthClientEnv(runtimeProfile: RuntimeProfile) {
  if (runtimeProfile !== "local") {
    return;
  }

  const explicitPath = normalizeText(process.env.CENTRAL_AUTH_CLIENT_ENV_FILE);
  const runtimeConfigPath = normalizeText(process.env.APP_RUNTIME_CONFIG_ROOT)
    ? path.join(process.env.APP_RUNTIME_CONFIG_ROOT as string, "central-auth-client.env")
    : "";
  const userConfigPath = resolveUserPerceptrumConfigPath("central-auth-client.env") || "";
  const systemConfigPath = "/etc/perceptrum/central-auth-client.env";

  const candidates = explicitPath
    ? [explicitPath]
    : [runtimeConfigPath, userConfigPath, systemConfigPath].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (
      loadParsedEnvFile(resolved, {
        allowedKeys: centralAuthClientKeys,
        overrideLoadedValues: true,
      })
    ) {
      console.log(`[env] Loaded central identity client config: ${resolved}`);
      return;
    }
  }

  if (explicitPath) {
    console.warn(`[env] CENTRAL_AUTH_CLIENT_ENV_FILE was set but not found: ${path.resolve(explicitPath)}`);
  }
}

function detectProfile(): RuntimeProfile {
  const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
  return nodeEnv === "production" ? "server" : "local";
}

export function loadEnv() {
  const rootDir = process.cwd();

  loadIfExists(path.resolve(rootDir, ".env.init"));

  const requestedProfile = normalizeProfile(process.env.ENV_PROFILE);
  const runtimeProfile =
    requestedProfile && requestedProfile !== "auto" ? requestedProfile : detectProfile();

  const profileFile = runtimeProfile === "server" ? ".env.server" : ".env.local";
  const profileLoaded = loadIfExists(path.resolve(rootDir, profileFile));
  if (!profileLoaded) {
    console.warn(`[env] ${profileFile} not found. Falling back to defaults/OS env.`);
  }

  process.env.APP_RUNTIME_ENV = runtimeProfile;
  dotenv.config();
  loadCentralAuthClientEnv(runtimeProfile);

  if (process.env.ENV_PROFILE && !requestedProfile) {
    console.warn(
      `[env] ENV_PROFILE="${process.env.ENV_PROFILE}" is invalid. Using "${runtimeProfile}" profile.`
    );
  }

  console.log(`[env] Active profile: ${runtimeProfile} (${profileFile})`);
}

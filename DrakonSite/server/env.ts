import path from "path";
import dotenv from "dotenv";

type RuntimeProfile = "local" | "server";
type ProfileMode = RuntimeProfile | "auto";

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

  if (process.env.ENV_PROFILE && !requestedProfile) {
    console.warn(
      `[env] ENV_PROFILE="${process.env.ENV_PROFILE}" is invalid. Using "${runtimeProfile}" profile.`
    );
  }

  console.log(`[env] Active profile: ${runtimeProfile} (${profileFile})`);
}

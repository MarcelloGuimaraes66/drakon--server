import path from "path";

import { branding as generatedBranding } from "../src/shared/generated/brand.generated";

export type ActiveBrandRuntime = {
  id: "drakon" | "perceptrum";
  workspaceRoot: string;
  dataRootWindows: string | null;
};

export type RuntimeBrandPayload = typeof generatedBranding;

export type DatabaseBackend = "postgres" | "sqlite";

export function resolveActiveBrandRuntime(): ActiveBrandRuntime {
  return {
    id: generatedBranding.activeBrand as "drakon" | "perceptrum",
    workspaceRoot: path.resolve(process.cwd(), ".."),
    dataRootWindows: generatedBranding.brand.dataPaths.rootWindows || null,
  };
}

export function resolveRuntimeBrandPayload(
  _brand: ActiveBrandRuntime
): RuntimeBrandPayload {
  return generatedBranding;
}

function normalizeBackend(value: string | undefined): DatabaseBackend | "auto" | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "postgres" || normalized === "sqlite") {
    return normalized;
  }
  return null;
}

export function resolveDatabaseBackend(brand: ActiveBrandRuntime): DatabaseBackend {
  const envValue =
    normalizeBackend(process.env.APP_DB_BACKEND) ??
    normalizeBackend(process.env.LOCAL_DB_BACKEND);

  if (envValue === "postgres" || envValue === "sqlite") {
    return envValue;
  }

  return brand.id === "perceptrum" ? "sqlite" : "postgres";
}

export function resolveDefaultSqlitePath(brand: ActiveBrandRuntime, storageRoot: string) {
  const configured = process.env.SQLITE_DB_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const baseRoot =
    brand.id === "perceptrum" && brand.dataRootWindows
      ? brand.dataRootWindows
      : path.join(storageRoot, "sqlite");

  const fileName = `${brand.id}_site.sqlite`;
  return path.resolve(path.join(baseRoot, "local-site", fileName));
}

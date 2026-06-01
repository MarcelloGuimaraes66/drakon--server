export type CentralIdentityBrandId = "drakon" | "perceptrum";

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeCentralIdentityBrandId(value: unknown): CentralIdentityBrandId | null {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "drakon" || normalized === "perceptrum"
    ? (normalized as CentralIdentityBrandId)
    : null;
}

function decodeBase64UrlToText(value: string): string | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");

  try {
    if (typeof atob === "function") {
      return atob(padded);
    }
  } catch {
    return null;
  }

  const bufferCtor = (globalThis as any)?.Buffer;
  if (bufferCtor?.from) {
    try {
      return bufferCtor.from(padded, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }

  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    return null;
  }

  const parts = normalizedToken.split(".");
  if (parts.length < 2) {
    return null;
  }

  const decodedPayload = decodeBase64UrlToText(parts[1] || "");
  if (!decodedPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodedPayload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function extractCentralIdentityGrantBrandHint(
  grantToken: unknown,
  options?: {
    expectedPublicId?: unknown;
  }
): CentralIdentityBrandId | null {
  const payload = decodeJwtPayload(normalizeText(grantToken));
  if (!payload) {
    return null;
  }

  const expectedPublicId = normalizeText(options?.expectedPublicId);
  const payloadPublicId = normalizeText(payload.public_id);
  if (expectedPublicId && payloadPublicId && payloadPublicId !== expectedPublicId) {
    return null;
  }

  return normalizeCentralIdentityBrandId(payload.brand_id);
}

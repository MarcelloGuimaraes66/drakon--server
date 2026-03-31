const DEFAULT_HANDLE_BASE = "user";

export function normalizeUserHandleInput(handle: unknown): string | null {
  if (typeof handle !== "string") {
    return null;
  }

  const normalized = handle.replace(/@/g, "").trim().toLowerCase();
  if (!normalized || /\s/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function deriveHandleFromEmail(email: string): string | null {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const atIndex = normalizedEmail.indexOf("@");
  if (atIndex <= 0) {
    return null;
  }

  return normalizeUserHandleInput(normalizedEmail.slice(0, atIndex));
}

export function getDefaultHandleBase(input?: string | null): string {
  return normalizeUserHandleInput(input) || DEFAULT_HANDLE_BASE;
}

export function buildHandleCandidate(baseHandle: string, collisionIndex = 0): string {
  const normalizedBase = getDefaultHandleBase(baseHandle);
  if (collisionIndex <= 0) {
    return normalizedBase;
  }

  return `${normalizedBase}${collisionIndex + 1}`;
}

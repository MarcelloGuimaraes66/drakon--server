import {
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import {
  buildHandleCandidate,
  deriveHandleFromEmail,
  normalizeUserHandleInput,
} from "./userHandle";

const CENTRAL_IDENTITY_ALGORITHM = "EdDSA";
const DEFAULT_GRANT_TTL_HOURS = 72;
const DEFAULT_KEY_ID = "central-auth-v1";

type CentralIdentityEnvLike = {
  CENTRAL_AUTH_BASE_URL?: string;
  CENTRAL_AUTH_PUBLIC_KEY?: string;
  CENTRAL_AUTH_PRIVATE_KEY?: string;
  CENTRAL_AUTH_GRANT_TTL_HOURS?: string;
  CENTRAL_AUTH_KEY_ID?: string;
};

type ServerUserRow = {
  id: unknown;
  public_id: unknown;
  email: unknown;
  handle?: unknown;
  country_code?: unknown;
  is_active: unknown;
  auth_version: unknown;
  created_at: unknown;
  updated_at: unknown;
};

export type CentralIdentityGrantClaims = JWTPayload & {
  type: "user_auth_sync";
  payload_version: 1;
  server_id: string;
  public_id: string;
  email: string;
  is_active: boolean;
  auth_version: number;
  login_allowed: boolean;
  grant_expires_at: string;
  force_logout: boolean;
  reason: string | null;
};

export type CentralIdentityGrantEnvelope = {
  token: string;
  expires_at: string;
  login_allowed: boolean;
  force_logout: boolean;
  reason: string | null;
};

const privateKeyCache = new Map<string, Promise<any>>();
const publicKeyCache = new Map<string, Promise<any>>();

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  return value.trim();
}

function normalizeInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function normalizeDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function normalizeBooleanFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value !== null && value !== undefined && String(value).trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric !== 0;
    }
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "t", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "f", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeGrantTtlHours(rawValue: unknown): number {
  const parsed = normalizeInteger(rawValue, DEFAULT_GRANT_TTL_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GRANT_TTL_HOURS;
  }
  return parsed;
}

function getKeyId(env: CentralIdentityEnvLike): string {
  return normalizeText(env.CENTRAL_AUTH_KEY_ID) || DEFAULT_KEY_ID;
}

function getGrantExpiryIso(env: CentralIdentityEnvLike, now = new Date()): string {
  const ttlHours = normalizeGrantTtlHours(env.CENTRAL_AUTH_GRANT_TTL_HOURS);
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
}

async function importCachedPrivateKey(privateKeyPem: string): Promise<any> {
  const cacheKey = privateKeyPem.trim();
  let cached = privateKeyCache.get(cacheKey);
  if (!cached) {
    cached = importPKCS8(cacheKey, CENTRAL_IDENTITY_ALGORITHM);
    privateKeyCache.set(cacheKey, cached);
  }
  return cached;
}

async function importCachedPublicKey(publicKeyPem: string): Promise<any> {
  const cacheKey = publicKeyPem.trim();
  let cached = publicKeyCache.get(cacheKey);
  if (!cached) {
    cached = importSPKI(cacheKey, CENTRAL_IDENTITY_ALGORITHM);
    publicKeyCache.set(cacheKey, cached);
  }
  return cached;
}

function centralIdentitySchemaReadyMap() {
  const globalMapKey = "__centralIdentitySchemaReadyMap";
  const root = globalThis as any;
  if (!root[globalMapKey]) {
    root[globalMapKey] = new WeakMap<object, Promise<void>>();
  }
  return root[globalMapKey] as WeakMap<object, Promise<void>>;
}

function isPgLikeDatabase(db: D1Database): boolean {
  return String((db as any)?.constructor?.name || "")
    .toLowerCase()
    .includes("pgd1");
}

async function reconcileServerUserHandles(db: D1Database): Promise<void> {
  const rowsResult = await db
    .prepare(
      `SELECT id, public_id, email, handle
       FROM server_users
       ORDER BY created_at ASC, id ASC`
    )
    .all();
  const rows = Array.isArray((rowsResult as any)?.results)
    ? ((rowsResult as any).results as Array<Record<string, unknown>>)
    : [];
  const usedHandles = new Set<string>();
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const normalizedCurrent = normalizeUserHandleInput(row.handle);
    const baseHandle = normalizedCurrent || deriveHandleFromEmail(normalizeText(row.email)) || "user";
    let candidate = normalizedCurrent;
    let collisionIndex = 0;

    while (!candidate || usedHandles.has(candidate)) {
      candidate = buildHandleCandidate(baseHandle, collisionIndex);
      collisionIndex += 1;
    }

    usedHandles.add(candidate);

    if (candidate !== normalizedCurrent) {
      await db
        .prepare(
          `UPDATE server_users
           SET handle = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(candidate, nowIso, row.id)
        .run();
    }
  }
}

export function isCentralIdentityClientConfigured(env: CentralIdentityEnvLike): boolean {
  return Boolean(
    normalizeText(env.CENTRAL_AUTH_BASE_URL) && normalizeText(env.CENTRAL_AUTH_PUBLIC_KEY)
  );
}

export function isCentralIdentityServerConfigured(env: CentralIdentityEnvLike): boolean {
  return normalizeText(env.CENTRAL_AUTH_PRIVATE_KEY).length > 0;
}

export function buildCentralIdentityEndpointUrl(
  env: CentralIdentityEnvLike,
  pathname: string
): string {
  const baseUrl = normalizeText(env.CENTRAL_AUTH_BASE_URL);
  if (!baseUrl) {
    throw new Error("CENTRAL_AUTH_BASE_URL is not configured.");
  }

  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ""), base).toString();
}

export async function ensureCentralIdentitySchema(db: D1Database): Promise<void> {
  const readyMap = centralIdentitySchemaReadyMap();
  const cacheKey = db as unknown as object;
  const existing = readyMap.get(cacheKey);
  if (existing) {
    await existing;
    return;
  }

  const isPgLike = isPgLikeDatabase(db);

  const initPromise = (async () => {
    const addColumnIfMissing = async (sql: string) => {
      try {
        await db.prepare(sql).run();
      } catch (error: any) {
        const message = String(error?.message || error || "").toLowerCase();
        const isDuplicateColumn =
          error?.code === "42701" ||
          message.includes("duplicate column name") ||
          message.includes("already exists");
        if (!isDuplicateColumn) {
          throw error;
        }
      }
    };

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS server_users (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        email TEXT NOT NULL UNIQUE,
        handle TEXT,
        country_code TEXT,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        auth_version BIGINT NOT NULL DEFAULT 1,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS server_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL UNIQUE,
        handle TEXT,
        country_code TEXT,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        auth_version INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    ).run();

    if (isPgLike) {
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid()`
      );
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN handle TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN country_code TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN password_hash TEXT`);
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE`
      );
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN auth_version BIGINT NOT NULL DEFAULT 1`
      );
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN last_login_at TIMESTAMPTZ`);
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
      );
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
      );
    } else {
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN public_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN handle TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN country_code TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN password_hash TEXT`);
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`
      );
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1`
      );
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN last_login_at TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN created_at TEXT`);
      await addColumnIfMissing(`ALTER TABLE server_users ADD COLUMN updated_at TEXT`);
    }

    await reconcileServerUserHandles(db);

    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_users_public_id
         ON server_users(public_id)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_users_email
         ON server_users(email)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_users_handle_unique
         ON server_users(handle)`
      )
      .run();
  })();

  readyMap.set(cacheKey, initPromise);
  try {
    await initPromise;
  } catch (error) {
    readyMap.delete(cacheKey);
    throw error;
  }
}

export async function signCentralIdentityGrant(
  env: CentralIdentityEnvLike,
  serverUser: ServerUserRow,
  options?: {
    forceLogout?: boolean;
    reason?: string | null;
    grantExpiresAt?: string;
  }
): Promise<CentralIdentityGrantEnvelope> {
  const privateKeyPem = normalizeText(env.CENTRAL_AUTH_PRIVATE_KEY);
  if (!privateKeyPem) {
    throw new Error("CENTRAL_AUTH_PRIVATE_KEY is not configured.");
  }

  const publicId =
    normalizeText(serverUser.public_id) || normalizeText((serverUser as any)?.publicId);
  const email = normalizeText(serverUser.email).toLowerCase();
  const serverId = normalizeText(serverUser.id);
  const isActive = normalizeBooleanFlag(serverUser.is_active, true);
  const authVersion = normalizeInteger(serverUser.auth_version, 1);
  const now = new Date();
  const grantExpiresAt = normalizeText(options?.grantExpiresAt) || getGrantExpiryIso(env, now);
  const forceLogout = Boolean(options?.forceLogout || !isActive);
  const reason = normalizeText(options?.reason) || (isActive ? "" : "admin_disabled");
  const loginAllowed = isActive && !forceLogout;
  const privateKey = await importCachedPrivateKey(privateKeyPem);
  const token = await new SignJWT({
    type: "user_auth_sync",
    payload_version: 1,
    server_id: serverId,
    public_id: publicId,
    email,
    is_active: isActive,
    auth_version: authVersion,
    login_allowed: loginAllowed,
    grant_expires_at: grantExpiresAt,
    force_logout: forceLogout,
    reason: reason || null,
    })
    .setProtectedHeader({
      alg: CENTRAL_IDENTITY_ALGORITHM,
      kid: getKeyId(env),
      typ: "JWT",
    })
    .setSubject(publicId)
    .setIssuedAt()
    .setExpirationTime(normalizeDate(grantExpiresAt) || new Date(grantExpiresAt))
    .sign(privateKey);

  return {
    token,
    expires_at: grantExpiresAt,
    login_allowed: loginAllowed,
    force_logout: forceLogout,
    reason: reason || null,
  };
}

export async function verifyCentralIdentityGrant(
  env: CentralIdentityEnvLike,
  token: string
): Promise<{
  claims: CentralIdentityGrantClaims;
  keyId: string | null;
}> {
  const publicKeyPem = normalizeText(env.CENTRAL_AUTH_PUBLIC_KEY);
  if (!publicKeyPem) {
    throw new Error("CENTRAL_AUTH_PUBLIC_KEY is not configured.");
  }

  const publicKey = await importCachedPublicKey(publicKeyPem);
  const verified = await jwtVerify(token, publicKey, {
    algorithms: [CENTRAL_IDENTITY_ALGORITHM],
  });

  const payload = verified.payload as JWTPayload;
  const claims: CentralIdentityGrantClaims = {
    ...payload,
    type: "user_auth_sync",
    payload_version: 1,
    server_id: normalizeText((payload as any).server_id),
    public_id:
      normalizeText((payload as any).public_id) || normalizeText(payload.sub),
    email: normalizeText((payload as any).email).toLowerCase(),
    is_active: normalizeBooleanFlag((payload as any).is_active, true),
    auth_version: normalizeInteger((payload as any).auth_version, 1),
    login_allowed: normalizeBooleanFlag((payload as any).login_allowed, true),
    grant_expires_at: normalizeText((payload as any).grant_expires_at),
    force_logout: normalizeBooleanFlag((payload as any).force_logout, false),
    reason: normalizeText((payload as any).reason) || null,
  };

  if (!claims.public_id) {
    throw new Error("Central identity grant is missing public_id.");
  }
  if (!claims.email) {
    throw new Error("Central identity grant is missing email.");
  }
  if (!claims.grant_expires_at) {
    throw new Error("Central identity grant is missing grant_expires_at.");
  }

  return {
    claims,
    keyId: normalizeText(verified.protectedHeader.kid) || null,
  };
}

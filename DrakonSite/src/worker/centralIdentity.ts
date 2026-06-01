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
const DEFAULT_DEVICE_SESSION_TTL_DAYS = 30;
const DEFAULT_KEY_ID = "central-auth-v1";
const CENTRAL_DEVICE_SESSION_HASH_SALT = "central-device-session-salt-v1";

type CentralIdentityEnvLike = {
  CENTRAL_AUTH_BASE_URL?: string;
  CENTRAL_AUTH_PUBLIC_KEY?: string;
  CENTRAL_AUTH_PRIVATE_KEY?: string;
  CENTRAL_AUTH_GRANT_TTL_HOURS?: string;
  CENTRAL_AUTH_DEVICE_SESSION_TTL_DAYS?: string;
  CENTRAL_AUTH_KEY_ID?: string;
};

type ServerUserRow = {
  id: unknown;
  public_id: unknown;
  brand_id?: unknown;
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
  brand_id: string;
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

export type CentralIdentityDeviceSessionEnvelope = {
  id: string;
  token: string;
  expires_at: string;
};

export type RefreshedCentralIdentityDeviceSession = {
  id: string;
  token: string;
  expires_at: string;
  user_public_id: string;
  auth_provider: string | null;
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

function normalizeCentralIdentityBrandId(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "drakon" || normalized === "perceptrum" ? normalized : "";
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

function normalizeDeviceSessionTtlDays(rawValue: unknown): number {
  const parsed = normalizeInteger(rawValue, DEFAULT_DEVICE_SESSION_TTL_DAYS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DEVICE_SESSION_TTL_DAYS;
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

function getDeviceSessionExpiryIso(env: CentralIdentityEnvLike, now = new Date()): string {
  const ttlDays = normalizeDeviceSessionTtlDays(env.CENTRAL_AUTH_DEVICE_SESSION_TTL_DAYS);
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

function getWebCryptoApi() {
  const cryptoApi = (globalThis as any).crypto;
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Web Crypto API is not available in this runtime.");
  }
  return cryptoApi;
}

function generateRandomUuid(): string {
  const cryptoApi = getWebCryptoApi();
  if (typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-${hex[4]}${hex[5]}-${hex[6]}${hex[7]}-${hex[8]}${hex[9]}-${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`;
}

function generateOpaqueCentralDeviceSessionToken(): string {
  const bytes = new Uint8Array(32);
  getWebCryptoApi().getRandomValues(bytes);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `cis_${hex}`;
}

async function hashCentralDeviceSessionToken(token: string): Promise<string> {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    throw new Error("Central identity device session token is required.");
  }
  const data = new TextEncoder().encode(`${normalizedToken}${CENTRAL_DEVICE_SESSION_HASH_SALT}`);
  const digest = await getWebCryptoApi().subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
      `SELECT id, public_id, brand_id, email, handle
       FROM server_users
       ORDER BY created_at ASC, id ASC`
    )
    .all();
  const rows = Array.isArray((rowsResult as any)?.results)
    ? ((rowsResult as any).results as Array<Record<string, unknown>>)
    : [];
  const usedHandlesByBrand = new Map<string, Set<string>>();
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const brandId = normalizeCentralIdentityBrandId(row.brand_id);
    let usedHandles = usedHandlesByBrand.get(brandId);
    if (!usedHandles) {
      usedHandles = new Set<string>();
      usedHandlesByBrand.set(brandId, usedHandles);
    }
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

async function rebuildSqliteServerUsersTableForBrandRealms(db: D1Database): Promise<void> {
  const tableInfoResult = await db.prepare(`PRAGMA table_info(server_users)`).all();
  const tableInfo = Array.isArray((tableInfoResult as any)?.results)
    ? ((tableInfoResult as any).results as Array<Record<string, unknown>>)
    : [];
  const hasBrandId = tableInfo.some(
    (row) => normalizeText((row as any)?.name).toLowerCase() === "brand_id"
  );

  const sqliteMasterRow = await db
    .prepare(
      `SELECT sql
       FROM sqlite_master
       WHERE type = 'table'
         AND name = 'server_users'
       LIMIT 1`
    )
    .first();
  const normalizedTableSql = normalizeText((sqliteMasterRow as any)?.sql)
    .replace(/\s+/g, " ")
    .toLowerCase();
  const hasInlineEmailUnique =
    normalizedTableSql.includes("email text not null unique") ||
    normalizedTableSql.includes("email text unique not null");
  const needsRebuild =
    !hasBrandId || hasInlineEmailUnique;

  if (!needsRebuild) {
    return;
  }

  const tempTableName = "server_users__brand_realm_new";
  const copyBrandIdSql = hasBrandId ? "COALESCE(LOWER(TRIM(brand_id)), '')" : "''";

  try {
    await db.prepare("BEGIN IMMEDIATE").run();
    await db.prepare("PRAGMA defer_foreign_keys = ON").run();
    await db.prepare(`DROP TABLE IF EXISTS ${tempTableName}`).run();

    await db.prepare(
      `
      CREATE TABLE ${tempTableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        brand_id TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
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

    await db.prepare(
      `
      INSERT INTO ${tempTableName} (
        id,
        public_id,
        brand_id,
        email,
        handle,
        country_code,
        password_hash,
        is_active,
        auth_version,
        last_login_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        public_id,
        ${copyBrandIdSql},
        email,
        handle,
        country_code,
        password_hash,
        COALESCE(is_active, 1),
        COALESCE(auth_version, 1),
        last_login_at,
        COALESCE(NULLIF(TRIM(created_at), ''), CURRENT_TIMESTAMP),
        COALESCE(NULLIF(TRIM(updated_at), ''), COALESCE(NULLIF(TRIM(created_at), ''), CURRENT_TIMESTAMP))
      FROM server_users
    `
    ).run();

    await db.prepare(`DROP TABLE server_users`).run();
    await db.prepare(`ALTER TABLE ${tempTableName} RENAME TO server_users`).run();

    try {
      await db.prepare(
        `
        INSERT INTO sqlite_sequence (name, seq)
        VALUES ('server_users', COALESCE((SELECT MAX(id) FROM server_users), 0))
        ON CONFLICT(name) DO UPDATE SET seq = excluded.seq
      `
      ).run();
    } catch {
      // sqlite_sequence is not guaranteed to exist in every runtime.
    }

    await db.prepare("COMMIT").run();
  } catch (error) {
    try {
      await db.prepare("ROLLBACK").run();
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
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
    const runSchemaChange = async (sql: string, extraIgnoredMessages: string[] = []) => {
      try {
        await db.prepare(sql).run();
      } catch (error: any) {
        const message = String(error?.message || error || "").toLowerCase();
        const isExpectedDuplicateOrExisting =
          error?.code === "42701" ||
          error?.code === "42710" ||
          message.includes("duplicate column name") ||
          message.includes("already exists") ||
          extraIgnoredMessages.some((item) => message.includes(item.toLowerCase()));
        if (!isExpectedDuplicateOrExisting) {
          throw error;
        }
      }
    };

    const addColumnIfMissing = async (sql: string) => {
      await runSchemaChange(sql);
    };

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS server_users (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        brand_id TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
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
        brand_id TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL,
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

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS server_user_secret_recovery (
        server_user_public_id UUID PRIMARY KEY REFERENCES server_users(public_id) ON DELETE CASCADE,
        question_key TEXT NOT NULL,
        answer_hash TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        configured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS server_user_secret_recovery (
        server_user_public_id TEXT PRIMARY KEY,
        question_key TEXT NOT NULL,
        answer_hash TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        configured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS camera_find_shares (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        owner_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        invitee_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        origin_brand_id TEXT NOT NULL DEFAULT '',
        permission_profile TEXT NOT NULL DEFAULT 'shared_job_execution',
        access_config_json TEXT NOT NULL DEFAULT '{}',
        owner_local_camera_id INTEGER NOT NULL,
        camera_name TEXT NOT NULL,
        city TEXT,
        state_code TEXT,
        country_code TEXT NOT NULL DEFAULT 'BR',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL,
        CONSTRAINT chk_camera_find_shares_status
          CHECK (status IN ('pending', 'accepted', 'denied', 'revoked'))
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS camera_find_shares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_public_id TEXT NOT NULL,
        invitee_public_id TEXT NOT NULL,
        origin_brand_id TEXT NOT NULL DEFAULT '',
        permission_profile TEXT NOT NULL DEFAULT 'shared_job_execution',
        access_config_json TEXT NOT NULL DEFAULT '{}',
        owner_local_camera_id INTEGER NOT NULL,
        camera_name TEXT NOT NULL,
        city TEXT,
        state_code TEXT,
        country_code TEXT NOT NULL DEFAULT 'BR',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS shared_job_dispatches (
        request_id TEXT PRIMARY KEY,
        operator_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        owner_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        operator_job_run_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        job_id INTEGER,
        trigger_type TEXT,
        trigger_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS shared_job_dispatches (
        request_id TEXT PRIMARY KEY,
        operator_public_id TEXT NOT NULL,
        owner_public_id TEXT NOT NULL,
        operator_job_run_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        job_id INTEGER,
        trigger_type TEXT,
        trigger_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        acknowledged_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS shared_job_events (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        request_id TEXT NOT NULL,
        operator_public_id UUID,
        owner_public_id UUID,
        operator_job_run_id TEXT,
        segment_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS shared_job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        operator_public_id TEXT,
        owner_public_id TEXT,
        operator_job_run_id TEXT,
        segment_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS workspace_access_invites (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        brand_id TEXT NOT NULL,
        owner_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        invitee_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        permission_profile TEXT NOT NULL DEFAULT 'full_access',
        access_config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS workspace_access_invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id TEXT NOT NULL,
        owner_public_id TEXT NOT NULL,
        invitee_public_id TEXT NOT NULL,
        permission_profile TEXT NOT NULL DEFAULT 'full_access',
        access_config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        revoked_at TEXT,
        updated_at TEXT NOT NULL
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS workspace_host_presence (
        brand_id TEXT NOT NULL,
        owner_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        app_instance_id TEXT NOT NULL,
        connection_policy TEXT NOT NULL DEFAULT 'allow_while_open',
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (brand_id, owner_public_id)
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS workspace_host_presence (
        brand_id TEXT NOT NULL,
        owner_public_id TEXT NOT NULL,
        app_instance_id TEXT NOT NULL,
        connection_policy TEXT NOT NULL DEFAULT 'allow_while_open',
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (brand_id, owner_public_id)
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS workspace_access_sessions (
        session_id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        owner_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        operator_public_id UUID NOT NULL REFERENCES server_users(public_id) ON DELETE CASCADE,
        permission_profile TEXT NOT NULL DEFAULT 'full_access',
        access_config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending_owner',
        requested_by_policy TEXT NOT NULL DEFAULT 'allow_while_open',
        requested_at TEXT NOT NULL,
        approved_at TEXT,
        connected_at TEXT,
        ended_at TEXT,
        ended_reason TEXT,
        updated_at TEXT NOT NULL
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS workspace_access_sessions (
        session_id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        owner_public_id TEXT NOT NULL,
        operator_public_id TEXT NOT NULL,
        permission_profile TEXT NOT NULL DEFAULT 'full_access',
        access_config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending_owner',
        requested_by_policy TEXT NOT NULL DEFAULT 'allow_while_open',
        requested_at TEXT NOT NULL,
        approved_at TEXT,
        connected_at TEXT,
        ended_at TEXT,
        ended_reason TEXT,
        updated_at TEXT NOT NULL
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS workspace_access_audit_logs (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        brand_id TEXT NOT NULL,
        session_id TEXT,
        invite_id BIGINT,
        owner_public_id UUID,
        operator_public_id UUID,
        actor_public_id UUID,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS workspace_access_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brand_id TEXT NOT NULL,
        session_id TEXT,
        invite_id INTEGER,
        owner_public_id TEXT,
        operator_public_id TEXT,
        actor_public_id TEXT,
        action TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    if (isPgLike) {
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN brand_id TEXT NOT NULL DEFAULT ''`
      );
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
      await addColumnIfMissing(
        `ALTER TABLE server_users ADD COLUMN brand_id TEXT NOT NULL DEFAULT ''`
      );
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

    if (isPgLike) {
      await runSchemaChange(
        `ALTER TABLE server_users
         DROP CONSTRAINT IF EXISTS server_users_email_key`
      );
    } else {
      await rebuildSqliteServerUsersTableForBrandRealms(db);
    }

    if (isPgLike) {
      await addColumnIfMissing(
        `ALTER TABLE server_user_secret_recovery ADD COLUMN server_user_public_id UUID`
      );
    } else {
      await addColumnIfMissing(
        `ALTER TABLE server_user_secret_recovery ADD COLUMN server_user_public_id TEXT`
      );
    }
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN question_key TEXT`
    );
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN answer_hash TEXT`
    );
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`
    );
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN locked_until TEXT`
    );
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN configured_at TEXT`
    );
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN created_at TEXT`
    );
    await addColumnIfMissing(
      `ALTER TABLE server_user_secret_recovery ADD COLUMN updated_at TEXT`
    );

    if (isPgLike) {
      await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN owner_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN invitee_public_id UUID`);
    } else {
      await addColumnIfMissing(
        `ALTER TABLE camera_find_shares ADD COLUMN owner_public_id TEXT NOT NULL DEFAULT ''`
      );
      await addColumnIfMissing(
        `ALTER TABLE camera_find_shares ADD COLUMN invitee_public_id TEXT NOT NULL DEFAULT ''`
      );
    }
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN owner_local_camera_id INTEGER NOT NULL DEFAULT 0`
    );
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN origin_brand_id TEXT NOT NULL DEFAULT ''`
    );
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'shared_job_execution'`
    );
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN access_config_json TEXT NOT NULL DEFAULT '{}'`
    );
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN camera_name TEXT NOT NULL DEFAULT ''`
    );
    await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN city TEXT`);
    await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN state_code TEXT`);
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN country_code TEXT NOT NULL DEFAULT 'BR'`
    );
    await addColumnIfMissing(
      `ALTER TABLE camera_find_shares ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`
    );
    await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN created_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN accepted_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN revoked_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE camera_find_shares ADD COLUMN updated_at TEXT`);

    if (isPgLike) {
      await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN operator_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN owner_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN operator_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN owner_public_id UUID`);
    } else {
      await addColumnIfMissing(
        `ALTER TABLE shared_job_dispatches ADD COLUMN operator_public_id TEXT NOT NULL DEFAULT ''`
      );
      await addColumnIfMissing(
        `ALTER TABLE shared_job_dispatches ADD COLUMN owner_public_id TEXT NOT NULL DEFAULT ''`
      );
      await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN operator_public_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN owner_public_id TEXT`);
    }
    await addColumnIfMissing(
      `ALTER TABLE shared_job_dispatches ADD COLUMN operator_job_run_id TEXT NOT NULL DEFAULT ''`
    );
    await addColumnIfMissing(
      `ALTER TABLE shared_job_dispatches ADD COLUMN segment_id TEXT NOT NULL DEFAULT ''`
    );
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN job_id INTEGER`);
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN trigger_type TEXT`);
    await addColumnIfMissing(
      `ALTER TABLE shared_job_dispatches ADD COLUMN trigger_json TEXT NOT NULL DEFAULT '{}'`
    );
    await addColumnIfMissing(
      `ALTER TABLE shared_job_dispatches ADD COLUMN status TEXT NOT NULL DEFAULT 'queued'`
    );
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN last_error TEXT`);
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN created_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN acknowledged_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN completed_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE shared_job_dispatches ADD COLUMN updated_at TEXT`);
    await addColumnIfMissing(
      `ALTER TABLE shared_job_events ADD COLUMN request_id TEXT NOT NULL DEFAULT ''`
    );
    await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN operator_job_run_id TEXT`);
    await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN segment_id TEXT`);
    await addColumnIfMissing(
      `ALTER TABLE shared_job_events ADD COLUMN event_type TEXT NOT NULL DEFAULT ''`
    );
    await addColumnIfMissing(
      `ALTER TABLE shared_job_events ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'`
    );
    await addColumnIfMissing(`ALTER TABLE shared_job_events ADD COLUMN created_at TEXT`);

    await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN brand_id TEXT NOT NULL DEFAULT ''`);
    if (isPgLike) {
      await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN owner_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN invitee_public_id UUID`);
    } else {
      await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN owner_public_id TEXT NOT NULL DEFAULT ''`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN invitee_public_id TEXT NOT NULL DEFAULT ''`);
    }
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_invites ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'full_access'`
    );
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_invites ADD COLUMN access_config_json TEXT NOT NULL DEFAULT '{}'`
    );
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_invites ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`
    );
    await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN created_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN accepted_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN revoked_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_invites ADD COLUMN updated_at TEXT`);

    await addColumnIfMissing(
      `ALTER TABLE workspace_host_presence ADD COLUMN brand_id TEXT NOT NULL DEFAULT ''`
    );
    if (isPgLike) {
      await addColumnIfMissing(`ALTER TABLE workspace_host_presence ADD COLUMN owner_public_id UUID`);
    } else {
      await addColumnIfMissing(`ALTER TABLE workspace_host_presence ADD COLUMN owner_public_id TEXT NOT NULL DEFAULT ''`);
    }
    await addColumnIfMissing(`ALTER TABLE workspace_host_presence ADD COLUMN app_instance_id TEXT NOT NULL DEFAULT ''`);
    await addColumnIfMissing(
      `ALTER TABLE workspace_host_presence ADD COLUMN connection_policy TEXT NOT NULL DEFAULT 'allow_while_open'`
    );
    await addColumnIfMissing(`ALTER TABLE workspace_host_presence ADD COLUMN last_seen_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_host_presence ADD COLUMN updated_at TEXT`);

    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN session_id TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN brand_id TEXT NOT NULL DEFAULT ''`);
    if (isPgLike) {
      await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN owner_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN operator_public_id UUID`);
    } else {
      await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN owner_public_id TEXT NOT NULL DEFAULT ''`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN operator_public_id TEXT NOT NULL DEFAULT ''`);
    }
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_sessions ADD COLUMN permission_profile TEXT NOT NULL DEFAULT 'full_access'`
    );
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_sessions ADD COLUMN access_config_json TEXT NOT NULL DEFAULT '{}'`
    );
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'pending_owner'`
    );
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_sessions ADD COLUMN requested_by_policy TEXT NOT NULL DEFAULT 'allow_while_open'`
    );
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN requested_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN approved_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN connected_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN ended_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN ended_reason TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_sessions ADD COLUMN updated_at TEXT`);

    await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN brand_id TEXT NOT NULL DEFAULT ''`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN session_id TEXT`);
    await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN invite_id INTEGER`);
    if (isPgLike) {
      await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN owner_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN operator_public_id UUID`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN actor_public_id UUID`);
    } else {
      await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN owner_public_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN operator_public_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN actor_public_id TEXT`);
    }
    await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN action TEXT`);
    await addColumnIfMissing(
      `ALTER TABLE workspace_access_audit_logs ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'`
    );
    await addColumnIfMissing(`ALTER TABLE workspace_access_audit_logs ADD COLUMN created_at TEXT`);

    if (isPgLike) {
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ALTER COLUMN owner_public_id TYPE UUID
         USING NULLIF(owner_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ALTER COLUMN invitee_public_id TYPE UUID
         USING NULLIF(invitee_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ALTER COLUMN owner_public_id SET NOT NULL`
      );
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ALTER COLUMN invitee_public_id SET NOT NULL`
      );
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ADD CONSTRAINT chk_camera_find_shares_status
         CHECK (status IN ('pending', 'accepted', 'denied', 'revoked'))`
      );
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ADD CONSTRAINT camera_find_shares_owner_public_id_fkey
         FOREIGN KEY (owner_public_id) REFERENCES server_users(public_id) ON DELETE CASCADE`
      );
      await runSchemaChange(
        `ALTER TABLE camera_find_shares
         ADD CONSTRAINT camera_find_shares_invitee_public_id_fkey
         FOREIGN KEY (invitee_public_id) REFERENCES server_users(public_id) ON DELETE CASCADE`
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_invites
         ALTER COLUMN owner_public_id TYPE UUID
         USING NULLIF(owner_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_invites
         ALTER COLUMN invitee_public_id TYPE UUID
         USING NULLIF(invitee_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_sessions
         ALTER COLUMN owner_public_id TYPE UUID
         USING NULLIF(owner_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_sessions
         ALTER COLUMN operator_public_id TYPE UUID
         USING NULLIF(operator_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_host_presence
         ALTER COLUMN owner_public_id TYPE UUID
         USING NULLIF(owner_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_audit_logs
         ALTER COLUMN owner_public_id TYPE UUID
         USING NULLIF(owner_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_audit_logs
         ALTER COLUMN operator_public_id TYPE UUID
         USING NULLIF(operator_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
      await runSchemaChange(
        `ALTER TABLE workspace_access_audit_logs
         ALTER COLUMN actor_public_id TYPE UUID
         USING NULLIF(actor_public_id::text, '')::uuid`,
        ["is already of type uuid"]
      );
    }

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS hub_items (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        item_type TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        owner_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT,
        cover_image_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        visibility TEXT NOT NULL DEFAULT 'public',
        current_version_id BIGINT,
        download_count INTEGER NOT NULL DEFAULT 0,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS hub_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_type TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        owner_user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        description TEXT,
        cover_image_url TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        visibility TEXT NOT NULL DEFAULT 'public',
        current_version_id INTEGER,
        download_count INTEGER NOT NULL DEFAULT 0,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN item_type TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN slug TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN owner_user_id TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN title TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN summary TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN description TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN cover_image_url TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN current_version_id INTEGER`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN published_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN created_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_items ADD COLUMN updated_at TEXT`);

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS hub_item_versions (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        item_id BIGINT NOT NULL,
        version_number INTEGER NOT NULL,
        schema_version TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        changelog TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS hub_item_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        schema_version TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        snapshot_hash TEXT NOT NULL,
        changelog TEXT,
        created_by_user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1`);
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN schema_version TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN snapshot_json TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN snapshot_hash TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN changelog TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN created_by_user_id TEXT`);
    await addColumnIfMissing(`ALTER TABLE hub_item_versions ADD COLUMN created_at TEXT`);

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS hub_item_tags (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        item_id BIGINT NOT NULL,
        tag TEXT NOT NULL
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS hub_item_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        tag TEXT NOT NULL
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS central_device_sessions (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
        user_public_id UUID NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS central_device_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        public_id TEXT NOT NULL UNIQUE,
        user_public_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        auth_provider TEXT NOT NULL DEFAULT 'local',
        expires_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    if (isPgLike) {
      await addColumnIfMissing(
        `ALTER TABLE central_device_sessions ADD COLUMN public_id UUID NOT NULL DEFAULT gen_random_uuid()`
      );
      await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN user_public_id UUID`);
    } else {
      await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN public_id TEXT`);
      await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN user_public_id TEXT`);
    }
    await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN token_hash TEXT`);
    await addColumnIfMissing(
      `ALTER TABLE central_device_sessions ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'`
    );
    await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN expires_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN last_used_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN revoked_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN created_at TEXT`);
    await addColumnIfMissing(`ALTER TABLE central_device_sessions ADD COLUMN updated_at TEXT`);

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS hub_downloads (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        item_id BIGINT NOT NULL,
        version_id BIGINT NOT NULL,
        user_id TEXT NOT NULL,
        install_target TEXT NOT NULL,
        target_ref_json TEXT,
        created_entity_type TEXT,
        created_entity_id BIGINT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS hub_downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        version_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        install_target TEXT NOT NULL,
        target_ref_json TEXT,
        created_entity_type TEXT,
        created_entity_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS hub_item_assets (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        version_id BIGINT NOT NULL,
        asset_type TEXT NOT NULL,
        asset_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS hub_item_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL,
        asset_type TEXT NOT NULL,
        asset_url TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await db.prepare(
      isPgLike
        ? `
      CREATE TABLE IF NOT EXISTS hub_moderation_events (
        id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        item_id BIGINT NOT NULL,
        version_id BIGINT,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
        : `
      CREATE TABLE IF NOT EXISTS hub_moderation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        version_id INTEGER,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await reconcileServerUserHandles(db);

    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_users_public_id
         ON server_users(public_id)`
      )
      .run();
    await db
      .prepare(`DROP INDEX IF EXISTS idx_server_users_email`)
      .run();
    await db
      .prepare(`DROP INDEX IF EXISTS idx_server_users_handle_unique`)
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_users_brand_email_unique
         ON server_users(brand_id, LOWER(email))`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_users_brand_handle_unique
         ON server_users(brand_id, LOWER(handle))
         WHERE handle IS NOT NULL AND LENGTH(TRIM(handle)) > 0`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_server_user_secret_recovery_public_id
         ON server_user_secret_recovery(server_user_public_id)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_server_user_secret_recovery_locked_until
         ON server_user_secret_recovery(locked_until)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_camera_find_shares_unique
         ON camera_find_shares(owner_public_id, invitee_public_id, owner_local_camera_id)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_camera_find_shares_invitee_permission
         ON camera_find_shares(invitee_public_id, permission_profile, status, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_camera_find_shares_invitee_status
         ON camera_find_shares(invitee_public_id, status, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_camera_find_shares_owner_updated
         ON camera_find_shares(owner_public_id, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_camera_find_shares_invitee_scope
         ON camera_find_shares(invitee_public_id, country_code, state_code, status)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_shared_job_dispatches_owner_status
         ON shared_job_dispatches(owner_public_id, status, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_shared_job_dispatches_operator_run
         ON shared_job_dispatches(operator_public_id, operator_job_run_id, created_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_shared_job_events_request_created
         ON shared_job_events(request_id, created_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_access_invites_unique
         ON workspace_access_invites(brand_id, owner_public_id, invitee_public_id)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_access_invites_invitee_status
         ON workspace_access_invites(brand_id, invitee_public_id, status, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_access_invites_owner_updated
         ON workspace_access_invites(brand_id, owner_public_id, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_host_presence_seen
         ON workspace_host_presence(brand_id, last_seen_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_access_sessions_owner_status
         ON workspace_access_sessions(brand_id, owner_public_id, status, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_access_sessions_operator_status
         ON workspace_access_sessions(brand_id, operator_public_id, status, updated_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_workspace_access_audit_logs_created
         ON workspace_access_audit_logs(brand_id, created_at DESC)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_central_device_sessions_public_id
         ON central_device_sessions(public_id)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_central_device_sessions_token_hash
         ON central_device_sessions(token_hash)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_central_device_sessions_user_expires
         ON central_device_sessions(user_public_id, expires_at)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_hub_items_type_status_updated
         ON hub_items(item_type, status, updated_at DESC)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_hub_items_owner_type_updated
         ON hub_items(owner_user_id, item_type, updated_at DESC)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_item_versions_item_version
         ON hub_item_versions(item_id, version_number)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_item_versions_item_hash
         ON hub_item_versions(item_id, snapshot_hash)`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_item_tags_item_tag
         ON hub_item_tags(item_id, tag)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_hub_item_tags_tag_item
         ON hub_item_tags(tag, item_id)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_hub_downloads_user_item_created
         ON hub_downloads(user_id, item_id, created_at DESC)`
      )
      .run();
    await db
      .prepare(
        `CREATE INDEX IF NOT EXISTS idx_hub_downloads_item_created
         ON hub_downloads(item_id, created_at DESC)`
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
  const brandId = normalizeCentralIdentityBrandId((serverUser as any)?.brand_id);
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
    brand_id: brandId,
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
    brand_id: normalizeCentralIdentityBrandId((payload as any).brand_id),
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

export async function createCentralIdentityDeviceSession(
  env: CentralIdentityEnvLike,
  db: D1Database,
  input: {
    userPublicId: string;
    authProvider?: string | null;
    now?: Date;
  }
): Promise<CentralIdentityDeviceSessionEnvelope> {
  const userPublicId = normalizeText(input.userPublicId);
  if (!userPublicId) {
    throw new Error("Central identity device session requires a user public id.");
  }

  const now = input.now instanceof Date && !Number.isNaN(input.now.getTime()) ? input.now : new Date();
  const nowIso = now.toISOString();
  const sessionId = generateRandomUuid();
  const token = generateOpaqueCentralDeviceSessionToken();
  const tokenHash = await hashCentralDeviceSessionToken(token);
  const expiresAt = getDeviceSessionExpiryIso(env, now);
  const authProvider = normalizeText(input.authProvider) || "local";

  await db
    .prepare(
      `INSERT INTO central_device_sessions (
         public_id,
         user_public_id,
         token_hash,
         auth_provider,
         expires_at,
         last_used_at,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(sessionId, userPublicId, tokenHash, authProvider, expiresAt, nowIso, nowIso, nowIso)
    .run();

  return {
    id: sessionId,
    token,
    expires_at: expiresAt,
  };
}

export async function refreshCentralIdentityDeviceSession(
  env: CentralIdentityEnvLike,
  db: D1Database,
  token: string,
  now: Date = new Date()
): Promise<RefreshedCentralIdentityDeviceSession | null> {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) {
    return null;
  }

  const row = await db
    .prepare(`SELECT * FROM central_device_sessions WHERE token_hash = ? LIMIT 1`)
    .bind(await hashCentralDeviceSessionToken(normalizedToken))
    .first();
  if (!row) {
    return null;
  }

  const sessionId = normalizeText((row as any).public_id);
  const userPublicId = normalizeText((row as any).user_public_id);
  const revokedAt = normalizeText((row as any).revoked_at);
  const expiresAt = normalizeText((row as any).expires_at);
  const expiresAtMs = Date.parse(expiresAt);

  if (!sessionId || !userPublicId || revokedAt) {
    return null;
  }
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    return null;
  }

  const nowIso = now.toISOString();
  const nextExpiresAt = getDeviceSessionExpiryIso(env, now);
  await db
    .prepare(
      `UPDATE central_device_sessions
       SET expires_at = ?,
           last_used_at = ?,
           updated_at = ?
       WHERE public_id = ?`
    )
    .bind(nextExpiresAt, nowIso, nowIso, sessionId)
    .run();

  return {
    id: sessionId,
    token: normalizedToken,
    expires_at: nextExpiresAt,
    user_public_id: userPublicId,
    auth_provider: normalizeText((row as any).auth_provider) || null,
  };
}

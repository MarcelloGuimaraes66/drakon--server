type LocalIdentityRow = Record<string, unknown>;

export type LocalUserIdentityMigrationResult = {
  oldUserId: string;
  newUserId: string;
  migrated: boolean;
  updatedColumns: Array<{
    tableName: string;
    columnName: string;
    changes: number;
  }>;
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  return value.trim();
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const numeric = normalizeInteger(value);
  if (numeric !== null) {
    return numeric !== 0;
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "t", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "f", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function isPgLikeDatabase(db: D1Database): boolean {
  return String((db as any)?.constructor?.name || "")
    .toLowerCase()
    .includes("pgd1");
}

function quoteSqliteIdentifier(value: string): string {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

function buildPragmaTableInfoSql(tableName: string): string {
  return `PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`;
}

function shouldMigrateUserIdColumn(columnName: string, declaredType: string): boolean {
  const normalizedName = normalizeText(columnName).toLowerCase();
  if (!normalizedName) return false;
  if (normalizedName !== "user_id" && !normalizedName.endsWith("_user_id")) {
    return false;
  }

  const normalizedType = normalizeText(declaredType).toLowerCase();
  if (!normalizedType) {
    return normalizedName !== "user_id";
  }
  return normalizedType.includes("text") || normalizedType.includes("char") || normalizedType.includes("clob");
}

async function listSqliteIdentityColumns(
  db: D1Database
): Promise<Array<{ tableName: string; columnName: string }>> {
  const { results } = await db
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC`
    )
    .all();

  const matches: Array<{ tableName: string; columnName: string }> = [];
  for (const tableRow of ((results || []) as Array<{ name?: string }>)) {
    const tableName = normalizeText(tableRow?.name);
    if (!tableName || tableName === "app_users") {
      continue;
    }

    const info = await db.prepare(buildPragmaTableInfoSql(tableName)).all();
    for (const column of ((info.results || []) as Array<{ name?: string; type?: string }>)) {
      const columnName = normalizeText(column?.name);
      const declaredType = normalizeText(column?.type);
      if (!shouldMigrateUserIdColumn(columnName, declaredType)) {
        continue;
      }
      matches.push({ tableName, columnName });
    }
  }

  return matches;
}

async function mergeAppUserRowsForCanonicalId(
  db: D1Database,
  oldUserId: string,
  newUserId: string,
  nowIso: string
): Promise<void> {
  const oldRow = (await db
    .prepare(`SELECT * FROM app_users WHERE id = ? LIMIT 1`)
    .bind(oldUserId)
    .first()) as LocalIdentityRow | null;
  const newRow = (await db
    .prepare(`SELECT * FROM app_users WHERE id = ? LIMIT 1`)
    .bind(newUserId)
    .first()) as LocalIdentityRow | null;

  if (!oldRow && !newRow) {
    return;
  }

  if (oldRow && !newRow) {
    await db
      .prepare(
        `UPDATE app_users
         SET id = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(newUserId, nowIso, oldUserId)
      .run();
    return;
  }

  if (!oldRow || !newRow) {
    return;
  }

  const merged = {
    email: normalizeText(newRow.email) || normalizeText(oldRow.email) || null,
    authProvider:
      normalizeText(newRow.auth_provider) || normalizeText(oldRow.auth_provider) || "local",
    countryCode: normalizeText(newRow.country_code) || normalizeText(oldRow.country_code) || null,
    locale: normalizeText(newRow.locale) || normalizeText(oldRow.locale) || null,
    handle: normalizeText(newRow.handle) || normalizeText(oldRow.handle) || null,
    timezoneIana:
      normalizeText(newRow.timezone_iana) || normalizeText(oldRow.timezone_iana) || "UTC",
    timezoneUpdatedAt:
      normalizeText(newRow.timezone_updated_at) || normalizeText(oldRow.timezone_updated_at) || null,
    timezoneSource:
      normalizeText(newRow.timezone_source) || normalizeText(oldRow.timezone_source) || null,
    createdAt: normalizeText(newRow.created_at) || normalizeText(oldRow.created_at) || nowIso,
  };

  await db
    .prepare(
      `UPDATE app_users
       SET email = ?,
           auth_provider = ?,
           country_code = ?,
           locale = ?,
           handle = ?,
           timezone_iana = ?,
           timezone_updated_at = ?,
           timezone_source = ?,
           created_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      merged.email,
      merged.authProvider,
      merged.countryCode,
      merged.locale,
      merged.handle,
      merged.timezoneIana,
      merged.timezoneUpdatedAt,
      merged.timezoneSource,
      merged.createdAt,
      nowIso,
      newUserId
    )
    .run();

  await db
    .prepare(`DELETE FROM app_users WHERE id = ?`)
    .bind(oldUserId)
    .run();
}

async function insertMigrationAuditRow(
  db: D1Database,
  values: {
    localUserId: number;
    oldUserId: string;
    newUserId: string;
    migratedAt: string;
    status: string;
    error: string | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO user_identity_migrations (
           local_user_id,
           old_user_id,
           new_user_id,
           migrated_at,
           status,
           error
         )
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        values.localUserId,
        values.oldUserId,
        values.newUserId,
        values.migratedAt,
        values.status,
        values.error
      )
      .run();
  } catch (error) {
    console.error("[IDENTITY] Failed to record migration audit row:", error);
  }
}

export function buildLegacyLocalAppUserId(localUserId: unknown): string {
  const normalized = normalizeText(localUserId);
  if (!normalized) {
    throw new Error("Local user id is required to build a canonical fallback id.");
  }
  return `local:${normalized}`;
}

export function resolveCanonicalAppUserIdFromLocalUserRow(
  row: LocalIdentityRow | null | undefined
): string {
  if (!row) {
    throw new Error("Local user row is required to resolve canonical app user id.");
  }

  const localUserId = row.id ?? row.local_user_id;
  const legacyUserId = buildLegacyLocalAppUserId(localUserId);
  const serverPublicId = normalizeText(row.server_public_id);
  const migratedAt = normalizeText(row.identity_migrated_at);

  if (serverPublicId && migratedAt) {
    return serverPublicId;
  }

  return legacyUserId;
}

export function resolvePairingClientIdFromLocalUserRow(
  row: LocalIdentityRow | null | undefined
): string {
  if (!row) {
    throw new Error("Local user row is required to resolve pairing client id.");
  }

  const explicitClientId = normalizeText(row.pairing_client_id);
  if (explicitClientId) {
    return explicitClientId;
  }

  return buildLegacyLocalAppUserId(row.id ?? row.local_user_id);
}

export function localUserRequiresCentralGrant(row: LocalIdentityRow | null | undefined): boolean {
  if (!row) return false;
  return normalizeText(row.server_public_id).length > 0;
}

export function localUserGrantAllowsOfflineLogin(
  row: LocalIdentityRow | null | undefined,
  nowIso: string = new Date().toISOString()
): boolean {
  if (!row) return false;
  if (!localUserRequiresCentralGrant(row)) {
    return true;
  }

  const isActive = normalizeBoolean(row.is_active, true);
  if (!isActive) {
    return false;
  }

  const grantExpiresAt = normalizeText(row.grant_expires_at);
  if (!grantExpiresAt) {
    return false;
  }

  const expiresAtMs = Date.parse(grantExpiresAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs)) {
    return false;
  }

  return expiresAtMs > nowMs;
}

export async function getLocalSessionUserByToken(
  db: D1Database,
  sessionToken: string,
  nowIso: string = new Date().toISOString()
): Promise<LocalIdentityRow | null> {
  return (await db
    .prepare(
      `SELECT
         ls.id AS session_id,
         ls.session_token,
         ls.user_id AS local_user_id,
         ls.expires_at AS session_expires_at,
         ls.created_at AS session_created_at,
         lu.id,
         lu.email,
         lu.country_code,
         lu.locale,
         lu.server_user_id_bigint,
         lu.server_public_id,
         lu.is_active,
         lu.auth_version,
         lu.grant_expires_at,
         lu.last_server_sync_at,
         lu.status_signature,
         lu.identity_source,
         lu.pairing_client_id,
         lu.identity_migrated_at
       FROM local_sessions ls
       JOIN local_users lu ON ls.user_id = lu.id
       WHERE ls.session_token = ?
         AND ls.expires_at > ?
       LIMIT 1`
    )
    .bind(sessionToken, nowIso)
    .first()) as LocalIdentityRow | null;
}

export async function migrateLegacyLocalUserIdToCanonicalId(
  db: D1Database,
  options: {
    localUserId: number | string;
    newUserId: string;
  }
): Promise<LocalUserIdentityMigrationResult> {
  const localUserIdNumber = normalizeInteger(options.localUserId);
  if (localUserIdNumber === null || localUserIdNumber <= 0) {
    throw new Error("Local user id must be a positive integer for identity migration.");
  }

  const newUserId = normalizeText(options.newUserId);
  if (!newUserId) {
    throw new Error("New canonical user id is required for identity migration.");
  }

  const oldUserId = buildLegacyLocalAppUserId(localUserIdNumber);
  if (oldUserId === newUserId) {
    return {
      oldUserId,
      newUserId,
      migrated: false,
      updatedColumns: [],
    };
  }

  if (isPgLikeDatabase(db)) {
    throw new Error(
      "Local identity migration is only supported on the SQLite desktop runtime."
    );
  }

  const nowIso = new Date().toISOString();
  const updatedColumns: Array<{ tableName: string; columnName: string; changes: number }> = [];

  try {
    await db.prepare("BEGIN IMMEDIATE").run();

    const identityColumns = await listSqliteIdentityColumns(db);
    for (const ref of identityColumns) {
      const updateResult = await db
        .prepare(
          `UPDATE ${quoteSqliteIdentifier(ref.tableName)}
           SET ${quoteSqliteIdentifier(ref.columnName)} = ?
           WHERE ${quoteSqliteIdentifier(ref.columnName)} = ?`
        )
        .bind(newUserId, oldUserId)
        .run();

      updatedColumns.push({
        tableName: ref.tableName,
        columnName: ref.columnName,
        changes: Number(updateResult.meta?.changes || 0),
      });
    }

    await mergeAppUserRowsForCanonicalId(db, oldUserId, newUserId, nowIso);

    await db
      .prepare(
        `UPDATE local_users
         SET identity_migrated_at = COALESCE(identity_migrated_at, ?),
             updated_at = ?
         WHERE id = ?`
      )
      .bind(nowIso, nowIso, localUserIdNumber)
      .run();

    await db.prepare("COMMIT").run();
  } catch (error) {
    try {
      await db.prepare("ROLLBACK").run();
    } catch {
      // Ignore rollback failures and preserve the original error.
    }

    await insertMigrationAuditRow(db, {
      localUserId: localUserIdNumber,
      oldUserId,
      newUserId,
      migratedAt: nowIso,
      status: "failed",
      error: error instanceof Error ? error.message : String(error || "Unknown migration error"),
    });
    throw error;
  }

  await insertMigrationAuditRow(db, {
    localUserId: localUserIdNumber,
    oldUserId,
    newUserId,
    migratedAt: nowIso,
    status: "completed",
    error: null,
  });

  return {
    oldUserId,
    newUserId,
    migrated: true,
    updatedColumns,
  };
}

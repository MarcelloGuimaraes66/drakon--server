export type AccountDeletionPreviewSection = {
  key: string;
  count: number;
};

export type AccountDeletionPreviewSummary = {
  total_records: number;
  storage_object_count?: number;
  sections: AccountDeletionPreviewSection[];
};

export type LocalAccountDeletionInput = {
  appUserId: string;
  email?: string | null;
  localUserId?: number | null;
  localServerPublicId?: string | null;
};

export type LocalAccountDeletionResult = {
  deleted_rows_estimate: number;
  deleted_storage_objects: number;
  sections: AccountDeletionPreviewSection[];
};

export type CentralAccountDeletionResult = {
  already_deleted: boolean;
  deleted_rows_estimate: number;
  sections: AccountDeletionPreviewSection[];
};

type DbRow = Record<string, unknown>;

const FACE_TARGET_IMAGE_PREFIX = "/api/face-target-images/";
const NEGATIVE_CONDITION_IMAGE_PREFIX = "/api/negative-condition-images/";

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function sumSections(sections: AccountDeletionPreviewSection[]): number {
  return sections.reduce((total, section) => total + Math.max(0, normalizeInteger(section.count)), 0);
}

function isMissingRelationError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  const code = String((error as any)?.code || "").trim();
  return (
    code === "42703" ||
    code === "42p01" ||
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist")
  );
}

async function queryAll(
  db: D1Database,
  sql: string,
  values: unknown[] = []
): Promise<DbRow[]> {
  try {
    const result = await db.prepare(sql).bind(...values).all();
    return Array.isArray((result as any)?.results)
      ? (((result as any).results || []) as DbRow[])
      : [];
  } catch (error) {
    if (isMissingRelationError(error)) {
      return [];
    }
    throw error;
  }
}

async function queryFirst(
  db: D1Database,
  sql: string,
  values: unknown[] = []
): Promise<DbRow | null> {
  try {
    const row = await db.prepare(sql).bind(...values).first();
    return (row as DbRow) || null;
  } catch (error) {
    if (isMissingRelationError(error)) {
      return null;
    }
    throw error;
  }
}

async function safeRun(
  db: D1Database,
  sql: string,
  values: unknown[] = []
): Promise<void> {
  try {
    await db.prepare(sql).bind(...values).run();
  } catch (error) {
    if (isMissingRelationError(error)) {
      return;
    }
    throw error;
  }
}

async function countWhere(
  db: D1Database,
  tableName: string,
  whereSql: string,
  values: unknown[] = []
): Promise<number> {
  const row = await queryFirst(
    db,
    `SELECT COUNT(*) AS count
       FROM ${tableName}
      WHERE ${whereSql}`,
    values
  );
  return Math.max(0, normalizeInteger(row?.count));
}

function buildInClause(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

async function listIntegerIds(
  db: D1Database,
  sql: string,
  values: unknown[] = []
): Promise<number[]> {
  const rows = await queryAll(db, sql, values);
  const ids = new Set<number>();
  for (const row of rows) {
    const id = normalizeInteger(row.id);
    if (id > 0) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

function toSection(
  key: string,
  count: number
): AccountDeletionPreviewSection | null {
  return count > 0 ? { key, count } : null;
}

function addUniqueStorageKey(bucket: Set<string>, rawValue: unknown, prefix?: string) {
  const value = normalizeText(rawValue);
  if (!value) {
    return;
  }

  if (prefix) {
    bucket.add(`${prefix}/${value}`.replace(/\/{2,}/g, "/"));
    return;
  }

  bucket.add(value);
}

function addDetectionMediaKey(bucket: Set<string>, rawValue: unknown) {
  const value = normalizeText(rawValue);
  if (!value) {
    return;
  }

  if (value.includes("/")) {
    bucket.add(value);
    return;
  }

  bucket.add(`detections/${value}`);
}

function extractStorageKeyFromApiImageUrl(
  imageUrl: unknown,
  expectedPrefix: string
): string | null {
  const normalized = normalizeText(imageUrl);
  if (!normalized) {
    return null;
  }

  let path = normalized;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    try {
      path = new URL(normalized).pathname;
    } catch {
      path = normalized;
    }
  }

  if (!path.startsWith(expectedPrefix)) {
    return null;
  }

  try {
    return decodeURIComponent(path.slice(expectedPrefix.length));
  } catch {
    return null;
  }
}

async function deleteRowsByIds(
  db: D1Database,
  tableName: string,
  idColumn: string,
  ids: readonly number[]
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  const placeholders = buildInClause(ids);
  await safeRun(
    db,
    `DELETE FROM ${tableName}
      WHERE ${idColumn} IN (${placeholders})`,
    [...ids]
  );
}

async function countRowsByIds(
  db: D1Database,
  tableName: string,
  idColumn: string,
  ids: readonly number[]
): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }

  const placeholders = buildInClause(ids);
  return countWhere(
    db,
    tableName,
    `${idColumn} IN (${placeholders})`,
    [...ids]
  );
}

async function loadLocalEntityIds(
  db: D1Database,
  input: LocalAccountDeletionInput
): Promise<{
  cameraIds: number[];
  cameraAlgorithmIds: number[];
  jobIds: number[];
  jobStepIds: number[];
  jobStepAgentIds: number[];
  faceTargetIds: number[];
  drakonTargetIds: number[];
  drakonSearchIds: number[];
  hubItemIds: number[];
  hubItemVersionIds: number[];
  hubCacheItemIds: number[];
}> {
  const appUserId = normalizeText(input.appUserId);

  const cameraIds = await listIntegerIds(
    db,
    `SELECT id FROM cameras WHERE user_id = ?`,
    [appUserId]
  );

  const cameraAlgorithmIds =
    cameraIds.length > 0
      ? await listIntegerIds(
          db,
          `SELECT id
             FROM camera_algorithms
            WHERE camera_id IN (${buildInClause(cameraIds)})`,
          [...cameraIds]
        )
      : [];

  const jobIds = await listIntegerIds(
    db,
    `SELECT id FROM jobs WHERE user_id = ?`,
    [appUserId]
  );

  const jobStepIds =
    jobIds.length > 0
      ? await listIntegerIds(
          db,
          `SELECT id
             FROM job_steps
            WHERE job_id IN (${buildInClause(jobIds)})`,
          [...jobIds]
        )
      : [];

  const jobStepAgentIds =
    jobStepIds.length > 0
      ? await listIntegerIds(
          db,
          `SELECT id
             FROM job_step_agents
            WHERE step_id IN (${buildInClause(jobStepIds)})`,
          [...jobStepIds]
        )
      : [];

  const faceTargetIds = await listIntegerIds(
    db,
    `SELECT id FROM face_targets WHERE user_id = ?`,
    [appUserId]
  );

  const drakonTargetIds = await listIntegerIds(
    db,
    `SELECT id FROM drakon_find_targets WHERE user_id = ?`,
    [appUserId]
  );

  const drakonSearchIds = await listIntegerIds(
    db,
    `SELECT id FROM drakon_find_searches WHERE user_id = ?`,
    [appUserId]
  );

  const hubItemIds = await listIntegerIds(
    db,
    `SELECT id FROM hub_items WHERE owner_user_id = ?`,
    [appUserId]
  );

  const hubItemVersionIds =
    hubItemIds.length > 0
      ? await listIntegerIds(
          db,
          `SELECT id
             FROM hub_item_versions
            WHERE item_id IN (${buildInClause(hubItemIds)})`,
          [...hubItemIds]
        )
      : [];

  const hubCacheItemIds = await listIntegerIds(
    db,
    `SELECT hub_item_id AS id
       FROM hub_items_cache
      WHERE owner_user_id = ?`,
    [appUserId]
  );

  return {
    cameraIds,
    cameraAlgorithmIds,
    jobIds,
    jobStepIds,
    jobStepAgentIds,
    faceTargetIds,
    drakonTargetIds,
    drakonSearchIds,
    hubItemIds,
    hubItemVersionIds,
    hubCacheItemIds,
  };
}

async function loadLocalUserIds(
  db: D1Database,
  input: LocalAccountDeletionInput
): Promise<number[]> {
  if (input.localUserId && input.localUserId > 0) {
    return [input.localUserId];
  }

  const normalizedEmail = normalizeEmail(input.email);
  const localServerPublicId = normalizeText(input.localServerPublicId);
  if (!normalizedEmail && !localServerPublicId) {
    return [];
  }

  const rows = await queryAll(
    db,
    `SELECT id
       FROM local_users
      WHERE ${localServerPublicId ? "(LOWER(email) = LOWER(?) OR server_public_id = ?)" : "LOWER(email) = LOWER(?)"}`,
    localServerPublicId ? [normalizedEmail, localServerPublicId] : [normalizedEmail]
  );

  const ids = new Set<number>();
  for (const row of rows) {
    const id = normalizeInteger(row.id);
    if (id > 0) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

async function collectLocalStorageKeys(
  db: D1Database,
  input: LocalAccountDeletionInput,
  ids: Awaited<ReturnType<typeof loadLocalEntityIds>>
): Promise<string[]> {
  const appUserId = normalizeText(input.appUserId);
  const storageKeys = new Set<string>();

  const cameraRows = await queryAll(
    db,
    `SELECT thumbnail_url
       FROM cameras
      WHERE user_id = ?`,
    [appUserId]
  );
  for (const row of cameraRows) {
    addUniqueStorageKey(storageKeys, row.thumbnail_url, "thumbs");
  }

  const uploadRows = await queryAll(
    db,
    `SELECT storage_key, thumbnail_filename
       FROM video_uploads
      WHERE user_id = ?`,
    [appUserId]
  );
  for (const row of uploadRows) {
    addUniqueStorageKey(storageKeys, row.storage_key);
    addUniqueStorageKey(storageKeys, row.thumbnail_filename, "thumbs");
  }

  const chatHitRows = await queryAll(
    db,
    `SELECT r2_key
       FROM chat_hit_images
      WHERE user_id = ?`,
    [appUserId]
  );
  for (const row of chatHitRows) {
    addUniqueStorageKey(storageKeys, row.r2_key);
  }

  const detectionRows = await queryAll(
    db,
    `SELECT image_key, video_key
       FROM detections
      WHERE user_id = ?`,
    [appUserId]
  );
  for (const row of detectionRows) {
    addDetectionMediaKey(storageKeys, row.image_key);
    addDetectionMediaKey(storageKeys, row.video_key);
  }

  const notificationRows = await queryAll(
    db,
    `SELECT image_key, video_key
       FROM notifications
      WHERE user_id = ?`,
    [appUserId]
  );
  for (const row of notificationRows) {
    addDetectionMediaKey(storageKeys, row.image_key);
    addDetectionMediaKey(storageKeys, row.video_key);
  }

  if (ids.faceTargetIds.length > 0) {
    const faceImageRows = await queryAll(
      db,
      `SELECT image_url
         FROM face_target_images
        WHERE face_target_id IN (${buildInClause(ids.faceTargetIds)})`,
      [...ids.faceTargetIds]
    );
    for (const row of faceImageRows) {
      addUniqueStorageKey(
        storageKeys,
        extractStorageKeyFromApiImageUrl(row.image_url, FACE_TARGET_IMAGE_PREFIX)
      );
    }
  }

  if (ids.cameraAlgorithmIds.length > 0) {
    const negativeRows = await queryAll(
      db,
      `SELECT image_url
         FROM camera_algorithm_negative_images
        WHERE algorithm_id IN (${buildInClause(ids.cameraAlgorithmIds)})`,
      [...ids.cameraAlgorithmIds]
    );
    for (const row of negativeRows) {
      addUniqueStorageKey(
        storageKeys,
        extractStorageKeyFromApiImageUrl(row.image_url, NEGATIVE_CONDITION_IMAGE_PREFIX)
      );
    }
  }

  if (ids.jobStepAgentIds.length > 0) {
    const jobNegativeRows = await queryAll(
      db,
      `SELECT image_url
         FROM job_step_agent_negative_images
        WHERE agent_id IN (${buildInClause(ids.jobStepAgentIds)})`,
      [...ids.jobStepAgentIds]
    );
    for (const row of jobNegativeRows) {
      addUniqueStorageKey(
        storageKeys,
        extractStorageKeyFromApiImageUrl(row.image_url, NEGATIVE_CONDITION_IMAGE_PREFIX)
      );
    }
  }

  if (ids.drakonTargetIds.length > 0) {
    const targetImageRows = await queryAll(
      db,
      `SELECT storage_key
         FROM drakon_find_target_images
        WHERE target_id IN (${buildInClause(ids.drakonTargetIds)})`,
      [...ids.drakonTargetIds]
    );
    for (const row of targetImageRows) {
      addUniqueStorageKey(storageKeys, row.storage_key);
    }
  }

  if (ids.drakonSearchIds.length > 0) {
    const hitRows = await queryAll(
      db,
      `SELECT image_key, video_key
         FROM drakon_find_hits
        WHERE search_id IN (${buildInClause(ids.drakonSearchIds)})`,
      [...ids.drakonSearchIds]
    );
    for (const row of hitRows) {
      addUniqueStorageKey(storageKeys, row.image_key);
      addUniqueStorageKey(storageKeys, row.video_key);
    }
  }

  return Array.from(storageKeys);
}

export async function getLocalAccountDeletionPreview(
  db: D1Database,
  input: LocalAccountDeletionInput
): Promise<AccountDeletionPreviewSummary> {
  const appUserId = normalizeText(input.appUserId);
  const ids = await loadLocalEntityIds(db, input);
  const localUserIds = await loadLocalUserIds(db, input);
  const localUserCount = localUserIds.length;
  const localSessionCount = await countRowsByIds(db, "local_sessions", "user_id", localUserIds);

  const sections = [
    toSection(
      "credentials",
      localUserCount +
        (await countWhere(db, "app_users", "id = ?", [appUserId])) +
        (await countWhere(db, "oauth_identities", "user_id = ?", [appUserId]))
    ),
    toSection(
      "sessions",
      localSessionCount +
        (await countWhere(db, "oauth_sessions", "user_id = ?", [appUserId]))
    ),
    toSection(
      "pairings",
      (await countWhere(db, "exe_pairings", "user_id = ?", [appUserId])) +
        (await countWhere(db, "pair_codes", "user_id = ?", [appUserId]))
    ),
    toSection(
      "cameras",
      ids.cameraIds.length +
        ids.cameraAlgorithmIds.length +
        (await countRowsByIds(db, "reid_targets", "camera_id", ids.cameraIds))
    ),
    toSection(
      "jobs",
      ids.jobIds.length +
        ids.jobStepIds.length +
        ids.jobStepAgentIds.length +
        (await countRowsByIds(db, "job_step_targets", "step_id", ids.jobStepIds)) +
        (await countRowsByIds(db, "job_step_alert_rules", "step_id", ids.jobStepIds)) +
        (await countRowsByIds(db, "job_schedule_days", "job_id", ids.jobIds)) +
        (await countRowsByIds(db, "job_schedule_windows", "job_id", ids.jobIds)) +
        (await countRowsByIds(db, "job_schedule_fires", "job_id", ids.jobIds)) +
        (await countRowsByIds(db, "job_schedule_stops", "job_id", ids.jobIds)) +
        (await countRowsByIds(db, "job_runtime_states", "job_id", ids.jobIds))
    ),
    toSection(
      "chat",
      (await countWhere(db, "chat_sessions", "user_id = ?", [appUserId])) +
        (await countWhere(db, "chat_messages", "user_id = ?", [appUserId])) +
        (await countWhere(db, "chat_session_contexts", "user_id = ?", [appUserId])) +
        (await countWhere(db, "chat_hit_images", "user_id = ?", [appUserId]))
    ),
    toSection(
      "events",
      (await countWhere(db, "events", "user_id = ?", [appUserId])) +
        (await countWhere(db, "commands", "user_id = ?", [appUserId])) +
        (await countWhere(db, "detections", "user_id = ?", [appUserId])) +
        (await countWhere(db, "notifications", "user_id = ?", [appUserId]))
    ),
    toSection(
      "api_keys",
      (await countWhere(db, "telegram_settings", "user_id = ?", [appUserId])) +
        (await countWhere(db, "openai_settings", "user_id = ?", [appUserId])) +
        (await countWhere(db, "zai_settings", "user_id = ?", [appUserId]))
    ),
    toSection(
      "face_targets",
      ids.faceTargetIds.length +
        (await countRowsByIds(db, "face_target_images", "face_target_id", ids.faceTargetIds))
    ),
    toSection(
      "drakon_find",
      ids.drakonTargetIds.length +
        ids.drakonSearchIds.length +
        (await countRowsByIds(db, "drakon_find_target_images", "target_id", ids.drakonTargetIds)) +
        (await countRowsByIds(db, "drakon_find_hits", "search_id", ids.drakonSearchIds)) +
        (await countWhere(db, "drakon_find_audit_logs", "actor_user_id = ?", [appUserId]))
    ),
    toSection(
      "shared_find",
      (await countWhere(db, "shared_find_cameras_cache", "user_id = ?", [appUserId])) +
        (await countWhere(db, "shared_find_invitations_cache", "user_id = ?", [appUserId]))
    ),
    toSection(
      "hub",
      ids.hubItemIds.length +
        ids.hubItemVersionIds.length +
        ids.hubCacheItemIds.length +
        (await countRowsByIds(db, "hub_item_tags", "item_id", ids.hubItemIds)) +
        (await countRowsByIds(db, "hub_item_assets", "version_id", ids.hubItemVersionIds)) +
        (await countWhere(db, "hub_downloads", "user_id = ?", [appUserId])) +
        (await countWhere(db, "hub_moderation_events", "actor_user_id = ?", [appUserId])) +
        (await countRowsByIds(db, "hub_item_tags_cache", "hub_item_id", ids.hubCacheItemIds))
    ),
    toSection(
      "uploads",
      (await countWhere(db, "video_uploads", "user_id = ?", [appUserId]))
    ),
    toSection(
      "billing",
      (await countWhere(db, "payments", "user_id = ?", [appUserId])) +
        (await countWhere(db, "subscriptions", "user_id = ?", [appUserId])) +
        (await countWhere(db, "stripe_customers", "user_id = ?", [appUserId])) +
        (await countWhere(db, "token_balances", "user_id = ?", [appUserId])) +
        (await countWhere(db, "active_cards", "user_id = ?", [appUserId])) +
        (await countWhere(db, "user_preferences", "user_id = ?", [appUserId])) +
        (await countWhere(db, "user_frame_rate", "user_id = ?", [appUserId]))
    ),
    toSection(
      "monitoring",
      (await countWhere(db, "capture_thread_metrics_latest", "user_id = ?", [appUserId])) +
        (await countWhere(db, "open_monitor_host_latest", "user_id = ?", [appUserId])) +
        (await countWhere(db, "open_monitor_process_latest", "user_id = ?", [appUserId])) +
        (await countWhere(db, "open_monitor_job_step_latest", "user_id = ?", [appUserId])) +
        (await countWhere(db, "open_monitor_camera_latest", "user_id = ?", [appUserId])) +
        (await countWhere(db, "open_monitor_thread_latest", "user_id = ?", [appUserId])) +
        (await countWhere(db, "agent_error_logs", "user_id = ?", [appUserId]))
    ),
  ].filter(Boolean) as AccountDeletionPreviewSection[];

  const storageKeys = await collectLocalStorageKeys(db, input, ids);

  return {
    total_records: sumSections(sections),
    storage_object_count: storageKeys.length,
    sections,
  };
}

export async function purgeLocalAccountData(
  db: D1Database,
  bucket: R2Bucket,
  input: LocalAccountDeletionInput
): Promise<LocalAccountDeletionResult> {
  const appUserId = normalizeText(input.appUserId);
  const preview = await getLocalAccountDeletionPreview(db, input);
  const ids = await loadLocalEntityIds(db, input);
  const localUserIds = await loadLocalUserIds(db, input);
  const storageKeys = await collectLocalStorageKeys(db, input, ids);

  for (const storageKey of storageKeys) {
    try {
      await bucket.delete(storageKey);
    } catch (error) {
      console.warn("[ACCOUNT DELETE] Failed to delete local storage object:", storageKey, error);
    }
  }

  await deleteRowsByIds(db, "camera_algorithm_face_targets", "algorithm_id", ids.cameraAlgorithmIds);
  await deleteRowsByIds(db, "camera_algorithm_negative_images", "algorithm_id", ids.cameraAlgorithmIds);
  await deleteRowsByIds(db, "camera_algorithms", "id", ids.cameraAlgorithmIds);
  await deleteRowsByIds(db, "job_step_agent_face_targets", "agent_id", ids.jobStepAgentIds);
  await deleteRowsByIds(db, "job_step_agent_negative_images", "agent_id", ids.jobStepAgentIds);
  await deleteRowsByIds(db, "job_step_alert_rules", "step_id", ids.jobStepIds);
  await deleteRowsByIds(db, "job_step_targets", "step_id", ids.jobStepIds);
  await deleteRowsByIds(db, "job_step_agents", "step_id", ids.jobStepIds);
  await deleteRowsByIds(db, "job_steps", "job_id", ids.jobIds);
  await deleteRowsByIds(db, "job_schedule_windows", "job_id", ids.jobIds);
  await deleteRowsByIds(db, "job_schedule_days", "job_id", ids.jobIds);
  await deleteRowsByIds(db, "job_schedule_fires", "job_id", ids.jobIds);
  await deleteRowsByIds(db, "job_schedule_stops", "job_id", ids.jobIds);
  await deleteRowsByIds(db, "job_runtime_states", "job_id", ids.jobIds);
  await deleteRowsByIds(db, "reid_targets", "camera_id", ids.cameraIds);
  await deleteRowsByIds(db, "face_target_images", "face_target_id", ids.faceTargetIds);
  await deleteRowsByIds(db, "face_targets", "id", ids.faceTargetIds);
  await deleteRowsByIds(db, "drakon_find_hits", "search_id", ids.drakonSearchIds);
  await deleteRowsByIds(db, "drakon_find_target_images", "target_id", ids.drakonTargetIds);
  await deleteRowsByIds(db, "drakon_find_search_cameras", "search_id", ids.drakonSearchIds);
  await deleteRowsByIds(db, "drakon_find_searches", "id", ids.drakonSearchIds);
  await deleteRowsByIds(db, "drakon_find_targets", "id", ids.drakonTargetIds);
  await deleteRowsByIds(db, "hub_item_assets", "version_id", ids.hubItemVersionIds);
  await deleteRowsByIds(db, "hub_item_tags", "item_id", ids.hubItemIds);
  await deleteRowsByIds(db, "hub_item_versions", "id", ids.hubItemVersionIds);
  await deleteRowsByIds(db, "hub_item_tags_cache", "hub_item_id", ids.hubCacheItemIds);

  await safeRun(db, `DELETE FROM cameras WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM jobs WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM chat_hit_images WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM chat_messages WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM chat_session_contexts WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM chat_sessions WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM commands WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM detections WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM notifications WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM events WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM video_uploads WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM telegram_settings WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM openai_settings WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM zai_settings WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM oauth_sessions WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM oauth_identities WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM exe_pairings WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM pair_codes WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM capture_thread_metrics_latest WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM open_monitor_host_latest WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM open_monitor_process_latest WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM open_monitor_job_step_latest WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM open_monitor_camera_latest WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM open_monitor_thread_latest WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM agent_error_logs WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM shared_find_cameras_cache WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM shared_find_invitations_cache WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM hub_downloads WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM hub_moderation_events WHERE actor_user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM hub_items WHERE owner_user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM hub_items_cache WHERE owner_user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM payments WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM subscriptions WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM stripe_customers WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM token_balances WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM active_cards WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM user_preferences WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM user_frame_rate WHERE user_id = ?`, [appUserId]);
  await safeRun(db, `DELETE FROM drakon_find_audit_logs WHERE actor_user_id = ?`, [appUserId]);

  await deleteRowsByIds(db, "local_sessions", "user_id", localUserIds);
  await deleteRowsByIds(db, "local_users", "id", localUserIds);

  if (!input.localUserId && localUserIds.length === 0) {
    const normalizedEmail = normalizeEmail(input.email);
    const localServerPublicId = normalizeText(input.localServerPublicId);
    if (normalizedEmail) {
      if (localServerPublicId) {
        await safeRun(
          db,
          `DELETE FROM local_users
            WHERE LOWER(email) = LOWER(?)
               OR server_public_id = ?`,
          [normalizedEmail, localServerPublicId]
        );
      } else {
        await safeRun(db, `DELETE FROM local_users WHERE LOWER(email) = LOWER(?)`, [normalizedEmail]);
      }
    }
  }

  await safeRun(db, `DELETE FROM app_users WHERE id = ?`, [appUserId]);

  return {
    deleted_rows_estimate: preview.total_records,
    deleted_storage_objects: storageKeys.length,
    sections: preview.sections,
  };
}

async function loadCentralEntityIds(
  db: D1Database,
  publicId: string
): Promise<{
  hubItemIds: number[];
  hubVersionIds: number[];
}> {
  const hubItemIds = await listIntegerIds(
    db,
    `SELECT id FROM hub_items WHERE owner_user_id = ?`,
    [publicId]
  );
  const hubVersionIds =
    hubItemIds.length > 0
      ? await listIntegerIds(
          db,
          `SELECT id
             FROM hub_item_versions
            WHERE item_id IN (${buildInClause(hubItemIds)})`,
          [...hubItemIds]
        )
      : [];

  return { hubItemIds, hubVersionIds };
}

export async function getCentralAccountDeletionPreview(
  db: D1Database,
  publicId: string
): Promise<AccountDeletionPreviewSummary & { already_deleted: boolean }> {
  const normalizedPublicId = normalizeText(publicId);
  const serverUserCount = await countWhere(db, "server_users", "public_id = ?", [normalizedPublicId]);
  const ids = await loadCentralEntityIds(db, normalizedPublicId);

  const sections = [
    toSection("credentials", serverUserCount),
    toSection(
      "device_sessions",
      await countWhere(db, "central_device_sessions", "user_public_id = ?", [normalizedPublicId])
    ),
    toSection(
      "find_shares",
      await countWhere(
        db,
        "camera_find_shares",
        "owner_public_id = ? OR invitee_public_id = ?",
        [normalizedPublicId, normalizedPublicId]
      )
    ),
    toSection(
      "hub",
      ids.hubItemIds.length +
        ids.hubVersionIds.length +
        (await countRowsByIds(db, "hub_item_tags", "item_id", ids.hubItemIds)) +
        (await countRowsByIds(db, "hub_item_assets", "version_id", ids.hubVersionIds)) +
        (await countWhere(db, "hub_downloads", "user_id = ?", [normalizedPublicId])) +
        (await countWhere(db, "hub_moderation_events", "actor_user_id = ?", [normalizedPublicId]))
    ),
  ].filter(Boolean) as AccountDeletionPreviewSection[];

  return {
    already_deleted: serverUserCount === 0,
    total_records: sumSections(sections),
    sections,
  };
}

export async function purgeCentralAccountData(
  db: D1Database,
  publicId: string
): Promise<CentralAccountDeletionResult> {
  const normalizedPublicId = normalizeText(publicId);
  const preview = await getCentralAccountDeletionPreview(db, normalizedPublicId);
  if (preview.already_deleted) {
    return {
      already_deleted: true,
      deleted_rows_estimate: 0,
      sections: [],
    };
  }

  const ids = await loadCentralEntityIds(db, normalizedPublicId);
  const now = new Date().toISOString();

  await safeRun(
    db,
    `UPDATE server_users
        SET is_active = 0,
            auth_version = COALESCE(auth_version, 0) + 1,
            updated_at = ?
      WHERE public_id = ?`,
    [now, normalizedPublicId]
  );

  await deleteRowsByIds(db, "hub_item_assets", "version_id", ids.hubVersionIds);
  await deleteRowsByIds(db, "hub_item_tags", "item_id", ids.hubItemIds);
  await deleteRowsByIds(db, "hub_item_versions", "id", ids.hubVersionIds);

  await safeRun(
    db,
    `DELETE FROM hub_downloads
      WHERE user_id = ?`,
    [normalizedPublicId]
  );
  if (ids.hubItemIds.length > 0) {
    await safeRun(
      db,
      `DELETE FROM hub_downloads
        WHERE item_id IN (${buildInClause(ids.hubItemIds)})`,
      [...ids.hubItemIds]
    );
    await safeRun(
      db,
      `DELETE FROM hub_moderation_events
        WHERE item_id IN (${buildInClause(ids.hubItemIds)})`,
      [...ids.hubItemIds]
    );
  }
  await safeRun(
    db,
    `DELETE FROM hub_moderation_events
      WHERE actor_user_id = ?`,
    [normalizedPublicId]
  );
  await safeRun(
    db,
    `DELETE FROM hub_items
      WHERE owner_user_id = ?`,
    [normalizedPublicId]
  );
  await safeRun(
    db,
    `DELETE FROM camera_find_shares
      WHERE owner_public_id = ? OR invitee_public_id = ?`,
    [normalizedPublicId, normalizedPublicId]
  );
  await safeRun(
    db,
    `DELETE FROM central_device_sessions
      WHERE user_public_id = ?`,
    [normalizedPublicId]
  );
  await safeRun(
    db,
    `DELETE FROM server_users
      WHERE public_id = ?`,
    [normalizedPublicId]
  );

  return {
    already_deleted: false,
    deleted_rows_estimate: preview.total_records,
    sections: preview.sections,
  };
}

type LocalAgentIngressRouteKey =
  | "events"
  | "thumbnails"
  | "capture_thread_metrics"
  | "open_monitor_snapshot";

type LocalAgentReplayContext = {
  userId: string;
  clientId: string;
  exeId: string;
};

type LocalAgentReplayDispatch = (request: Request) => Promise<Response>;

type BaseInboxPayload = {
  db: D1Database;
  userId: string;
  clientId: string;
  exeId: string;
  requestPath: string;
  requestBody: string;
  contentType?: string | null;
  nowIso?: string;
};

type ThumbnailInboxPayload = BaseInboxPayload & {
  cameraId: number;
};

type LatestInboxRouteKey =
  | "thumbnails"
  | "capture_thread_metrics"
  | "open_monitor_snapshot";

type LatestInboxRow = {
  user_id: string;
  client_id: string;
  exe_id: string | null;
  request_path: string;
  request_body: string;
  content_type: string | null;
  created_at: string;
  updated_at: string;
  attempt_count?: number | null;
  last_error?: string | null;
  camera_id?: number | null;
};

type EventInboxRow = {
  id: number;
  user_id: string;
  client_id: string;
  exe_id: string | null;
  request_path: string;
  request_body: string;
  content_type: string | null;
  attempt_count: number | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
};

const LOCAL_AGENT_REPLAY_HEADER = "x-local-agent-replay";
const LOCAL_AGENT_REPLAY_USER_HEADER = "x-local-agent-replay-user-id";
const LOCAL_AGENT_REPLAY_CLIENT_HEADER = "x-local-agent-replay-client-id";
const LOCAL_AGENT_REPLAY_EXE_HEADER = "x-local-agent-replay-exe-id";
const LOCAL_AGENT_REPLAY_QUEUE_HEADER = "x-local-agent-replay-queue";

const DEFAULT_MAX_EVENT_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 400;
const DEFAULT_EVENT_BATCH_SIZE = 6;
const DEFAULT_LATEST_BATCH_SIZE = 3;
const MAX_RECORDED_ERROR_LENGTH = 2000;

let pumpStarted = false;
let pumpTimer: ReturnType<typeof setInterval> | null = null;
let pumpDrainPromise: Promise<void> | null = null;

function readEnvText(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return "";
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeModeText(value: string): string {
  return value.trim().toLowerCase();
}

function truncateErrorText(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > MAX_RECORDED_ERROR_LENGTH
    ? text.slice(0, MAX_RECORDED_ERROR_LENGTH)
    : text;
}

function getNowIso(value?: string | null): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return new Date().toISOString();
}

function readOptionalPositiveIntEnv(env: unknown, key: string, fallback: number): number {
  const raw = readEnvText(env, key);
  if (!raw) return fallback;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function backoffDelayMs(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  return Math.min(30_000, 500 * attempt * attempt);
}

function buildReplayHeaders(
  routeKey: LocalAgentIngressRouteKey,
  replayContext: LocalAgentReplayContext,
  contentType?: string | null
): Headers {
  const headers = new Headers();
  headers.set(LOCAL_AGENT_REPLAY_HEADER, "1");
  headers.set(LOCAL_AGENT_REPLAY_QUEUE_HEADER, routeKey);
  headers.set(LOCAL_AGENT_REPLAY_USER_HEADER, replayContext.userId);
  headers.set(LOCAL_AGENT_REPLAY_CLIENT_HEADER, replayContext.clientId);
  headers.set(LOCAL_AGENT_REPLAY_EXE_HEADER, replayContext.exeId);
  if (contentType && contentType.trim()) {
    headers.set("content-type", contentType);
  }
  return headers;
}

function buildReplayRequest(
  routeKey: LocalAgentIngressRouteKey,
  requestPath: string,
  requestBody: string,
  replayContext: LocalAgentReplayContext,
  contentType?: string | null
): Request {
  return new Request(`http://local${requestPath}`, {
    method: "POST",
    headers: buildReplayHeaders(routeKey, replayContext, contentType),
    body: requestBody,
  });
}

function summarizeReplayFailure(status: number, body: string): string {
  const trimmedBody = String(body || "").trim();
  if (!trimmedBody) {
    return `internal replay failed with status ${status}`;
  }
  return `internal replay failed with status ${status}: ${truncateErrorText(trimmedBody)}`;
}

async function dispatchReplayRequest(
  routeKey: LocalAgentIngressRouteKey,
  row: {
    user_id: string;
    client_id: string;
    exe_id?: string | null;
    request_path: string;
    request_body: string;
    content_type?: string | null;
  },
  dispatch: LocalAgentReplayDispatch
): Promise<{ ok: true } | { ok: false; errorText: string }> {
  try {
    const response = await dispatch(
      buildReplayRequest(
        routeKey,
        row.request_path,
        row.request_body,
        {
          userId: row.user_id,
          clientId: row.client_id,
          exeId: typeof row.exe_id === "string" ? row.exe_id : "",
        },
        typeof row.content_type === "string" ? row.content_type : null
      )
    );

    if (response.ok) {
      return { ok: true };
    }

    const responseText = await response.text().catch(() => "");
    return {
      ok: false,
      errorText: summarizeReplayFailure(response.status, responseText),
    };
  } catch (error) {
    return {
      ok: false,
      errorText: truncateErrorText(error instanceof Error ? error.stack || error.message : error),
    };
  }
}

async function drainEventInbox(
  env: Env,
  dispatch: LocalAgentReplayDispatch
): Promise<void> {
  const batchSize = readOptionalPositiveIntEnv(
    env,
    "LOCAL_AGENT_EVENT_BATCH_SIZE",
    DEFAULT_EVENT_BATCH_SIZE
  );
  const maxAttempts = readOptionalPositiveIntEnv(
    env,
    "LOCAL_AGENT_EVENT_MAX_ATTEMPTS",
    DEFAULT_MAX_EVENT_ATTEMPTS
  );
  const nowIso = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id,
            user_id,
            client_id,
            exe_id,
            request_path,
            request_body,
            content_type,
            attempt_count,
            next_attempt_at,
            created_at,
            updated_at
       FROM agent_event_inbox
      WHERE COALESCE(next_attempt_at, created_at) <= ?
      ORDER BY created_at ASC
      LIMIT ?`
  )
    .bind(nowIso, batchSize)
    .all();

  const rows = (Array.isArray(results) ? results : []) as EventInboxRow[];
  for (const row of rows) {
    const replayResult = await dispatchReplayRequest("events", row, dispatch);
    if (replayResult.ok) {
      await env.DB.prepare(`DELETE FROM agent_event_inbox WHERE id = ?`).bind(row.id).run();
      continue;
    }

    const nextAttemptCount = Math.max(0, Number(row.attempt_count || 0)) + 1;
    if (nextAttemptCount >= maxAttempts) {
      const failedAt = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO agent_ingest_deadletter (
           route_key,
           user_id,
           client_id,
           exe_id,
           request_path,
           request_body,
           content_type,
           error_text,
           attempt_count,
           created_at,
           failed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          "events",
          row.user_id,
          row.client_id,
          row.exe_id || null,
          row.request_path,
          row.request_body,
          row.content_type || null,
          replayResult.errorText,
          nextAttemptCount,
          row.created_at,
          failedAt
        )
        .run();
      await env.DB.prepare(`DELETE FROM agent_event_inbox WHERE id = ?`).bind(row.id).run();
      continue;
    }

    const retryAt = new Date(Date.now() + backoffDelayMs(nextAttemptCount)).toISOString();
    await env.DB.prepare(
      `UPDATE agent_event_inbox
          SET attempt_count = ?,
              next_attempt_at = ?,
              last_error = ?,
              updated_at = ?
        WHERE id = ?`
    )
      .bind(nextAttemptCount, retryAt, replayResult.errorText, nowIso, row.id)
      .run();
  }
}

async function loadLatestRows(
  env: Env,
  routeKey: LatestInboxRouteKey,
  limit: number
): Promise<LatestInboxRow[]> {
  if (routeKey === "thumbnails") {
    const { results } = await env.DB.prepare(
      `SELECT user_id,
              client_id,
              exe_id,
              camera_id,
              request_path,
              request_body,
              content_type,
              created_at,
              updated_at,
              attempt_count,
              last_error
         FROM agent_thumbnail_inbox_latest
        ORDER BY updated_at ASC
        LIMIT ?`
    )
      .bind(limit)
      .all();
    return (Array.isArray(results) ? results : []) as LatestInboxRow[];
  }

  if (routeKey === "capture_thread_metrics") {
    const { results } = await env.DB.prepare(
      `SELECT user_id,
              client_id,
              exe_id,
              request_path,
              request_body,
              content_type,
              created_at,
              updated_at,
              attempt_count,
              last_error
         FROM agent_capture_metrics_inbox_latest
        ORDER BY updated_at ASC
        LIMIT ?`
    )
      .bind(limit)
      .all();
    return (Array.isArray(results) ? results : []) as LatestInboxRow[];
  }

  const { results } = await env.DB.prepare(
    `SELECT user_id,
            client_id,
            exe_id,
            request_path,
            request_body,
            content_type,
            created_at,
            updated_at,
            attempt_count,
            last_error
       FROM agent_open_monitor_inbox_latest
      ORDER BY updated_at ASC
      LIMIT ?`
  )
    .bind(limit)
    .all();
  return (Array.isArray(results) ? results : []) as LatestInboxRow[];
}

async function deleteLatestRowIfUnchanged(
  env: Env,
  routeKey: LatestInboxRouteKey,
  row: LatestInboxRow
): Promise<void> {
  if (routeKey === "thumbnails") {
    await env.DB.prepare(
      `DELETE FROM agent_thumbnail_inbox_latest
        WHERE user_id = ?
          AND client_id = ?
          AND camera_id = ?
          AND updated_at = ?`
    )
      .bind(row.user_id, row.client_id, row.camera_id, row.updated_at)
      .run();
    return;
  }

  if (routeKey === "capture_thread_metrics") {
    await env.DB.prepare(
      `DELETE FROM agent_capture_metrics_inbox_latest
        WHERE user_id = ?
          AND client_id = ?
          AND updated_at = ?`
    )
      .bind(row.user_id, row.client_id, row.updated_at)
      .run();
    return;
  }

  await env.DB.prepare(
    `DELETE FROM agent_open_monitor_inbox_latest
      WHERE user_id = ?
        AND client_id = ?
        AND updated_at = ?`
  )
    .bind(row.user_id, row.client_id, row.updated_at)
    .run();
}

async function markLatestRowFailureIfUnchanged(
  env: Env,
  routeKey: LatestInboxRouteKey,
  row: LatestInboxRow,
  errorText: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const nextAttemptCount = Math.max(0, Number(row.attempt_count || 0)) + 1;
  if (routeKey === "thumbnails") {
    await env.DB.prepare(
      `UPDATE agent_thumbnail_inbox_latest
          SET attempt_count = ?,
              last_error = ?,
              updated_at = ?
        WHERE user_id = ?
          AND client_id = ?
          AND camera_id = ?
          AND updated_at = ?`
    )
      .bind(
        nextAttemptCount,
        errorText,
        nowIso,
        row.user_id,
        row.client_id,
        row.camera_id,
        row.updated_at
      )
      .run();
    return;
  }

  if (routeKey === "capture_thread_metrics") {
    await env.DB.prepare(
      `UPDATE agent_capture_metrics_inbox_latest
          SET attempt_count = ?,
              last_error = ?,
              updated_at = ?
        WHERE user_id = ?
          AND client_id = ?
          AND updated_at = ?`
    )
      .bind(nextAttemptCount, errorText, nowIso, row.user_id, row.client_id, row.updated_at)
      .run();
    return;
  }

  await env.DB.prepare(
    `UPDATE agent_open_monitor_inbox_latest
        SET attempt_count = ?,
            last_error = ?,
            updated_at = ?
      WHERE user_id = ?
        AND client_id = ?
        AND updated_at = ?`
  )
    .bind(nextAttemptCount, errorText, nowIso, row.user_id, row.client_id, row.updated_at)
    .run();
}

async function drainLatestInbox(
  env: Env,
  routeKey: LatestInboxRouteKey,
  dispatch: LocalAgentReplayDispatch
): Promise<void> {
  const batchSize = readOptionalPositiveIntEnv(
    env,
    "LOCAL_AGENT_LATEST_BATCH_SIZE",
    DEFAULT_LATEST_BATCH_SIZE
  );
  const rows = await loadLatestRows(env, routeKey, batchSize);
  for (const row of rows) {
    const replayResult = await dispatchReplayRequest(routeKey, row, dispatch);
    if (replayResult.ok) {
      await deleteLatestRowIfUnchanged(env, routeKey, row);
      continue;
    }

    await markLatestRowFailureIfUnchanged(env, routeKey, row, replayResult.errorText);
  }
}

async function drainLocalAgentIngress(
  env: Env,
  dispatch: LocalAgentReplayDispatch
): Promise<void> {
  if (!isLocalAgentIngressQueueEnabled(env)) {
    return;
  }

  await drainEventInbox(env, dispatch);
  await drainLatestInbox(env, "thumbnails", dispatch);
  await drainLatestInbox(env, "capture_thread_metrics", dispatch);
  await drainLatestInbox(env, "open_monitor_snapshot", dispatch);
}

export function isLocalAgentIngressQueueEnabled(env: Partial<Env> | Record<string, unknown>): boolean {
  const explicitMode = normalizeModeText(readEnvText(env, "LOCAL_AGENT_INGEST_MODE"));
  if (explicitMode === "off" || explicitMode === "disabled" || explicitMode === "false") {
    return false;
  }
  if (explicitMode === "on" || explicitMode === "enabled" || explicitMode === "true") {
    return true;
  }

  return normalizeModeText(readEnvText(env, "APP_SERVER_ROLE")) === "agent";
}

export function readLocalAgentReplayContext(headers: Headers): LocalAgentReplayContext | null {
  if (headers.get(LOCAL_AGENT_REPLAY_HEADER) !== "1") {
    return null;
  }

  const userId = headers.get(LOCAL_AGENT_REPLAY_USER_HEADER)?.trim() || "";
  const clientId = headers.get(LOCAL_AGENT_REPLAY_CLIENT_HEADER)?.trim() || "";
  const exeId = headers.get(LOCAL_AGENT_REPLAY_EXE_HEADER)?.trim() || "";
  if (!userId || !clientId) {
    return null;
  }

  return {
    userId,
    clientId,
    exeId,
  };
}

export async function ensureLocalAgentIngressSchema(
  db: D1Database,
  isPgLike: boolean
): Promise<void> {
  await db.prepare(
    isPgLike
      ? `CREATE TABLE IF NOT EXISTS agent_event_inbox (
           id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
           user_id TEXT NOT NULL,
           client_id TEXT NOT NULL,
           exe_id TEXT,
           request_path TEXT NOT NULL,
           request_body TEXT NOT NULL,
           content_type TEXT,
           attempt_count INTEGER NOT NULL DEFAULT 0,
           next_attempt_at TEXT,
           last_error TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
      : `CREATE TABLE IF NOT EXISTS agent_event_inbox (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           user_id TEXT NOT NULL,
           client_id TEXT NOT NULL,
           exe_id TEXT,
           request_path TEXT NOT NULL,
           request_body TEXT NOT NULL,
           content_type TEXT,
           attempt_count INTEGER NOT NULL DEFAULT 0,
           next_attempt_at TEXT,
           last_error TEXT,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
  ).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_agent_event_inbox_ready
      ON agent_event_inbox(next_attempt_at, created_at)`
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS agent_thumbnail_inbox_latest (
       user_id TEXT NOT NULL,
       client_id TEXT NOT NULL,
       exe_id TEXT,
       camera_id INTEGER NOT NULL,
       request_path TEXT NOT NULL,
       request_body TEXT NOT NULL,
       content_type TEXT,
       attempt_count INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (user_id, client_id, camera_id)
     )`
  ).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_agent_thumbnail_inbox_latest_updated
      ON agent_thumbnail_inbox_latest(updated_at)`
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS agent_capture_metrics_inbox_latest (
       user_id TEXT NOT NULL,
       client_id TEXT NOT NULL,
       exe_id TEXT,
       request_path TEXT NOT NULL,
       request_body TEXT NOT NULL,
       content_type TEXT,
       attempt_count INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (user_id, client_id)
     )`
  ).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_agent_capture_metrics_inbox_latest_updated
      ON agent_capture_metrics_inbox_latest(updated_at)`
  ).run();

  await db.prepare(
    `CREATE TABLE IF NOT EXISTS agent_open_monitor_inbox_latest (
       user_id TEXT NOT NULL,
       client_id TEXT NOT NULL,
       exe_id TEXT,
       request_path TEXT NOT NULL,
       request_body TEXT NOT NULL,
       content_type TEXT,
       attempt_count INTEGER NOT NULL DEFAULT 0,
       last_error TEXT,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (user_id, client_id)
     )`
  ).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_agent_open_monitor_inbox_latest_updated
      ON agent_open_monitor_inbox_latest(updated_at)`
  ).run();

  await db.prepare(
    isPgLike
      ? `CREATE TABLE IF NOT EXISTS agent_ingest_deadletter (
           id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
           route_key TEXT NOT NULL,
           user_id TEXT NOT NULL,
           client_id TEXT NOT NULL,
           exe_id TEXT,
           request_path TEXT NOT NULL,
           request_body TEXT NOT NULL,
           content_type TEXT,
           error_text TEXT,
           attempt_count INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
      : `CREATE TABLE IF NOT EXISTS agent_ingest_deadletter (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           route_key TEXT NOT NULL,
           user_id TEXT NOT NULL,
           client_id TEXT NOT NULL,
           exe_id TEXT,
           request_path TEXT NOT NULL,
           request_body TEXT NOT NULL,
           content_type TEXT,
           error_text TEXT,
           attempt_count INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
           failed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         )`
  ).run();
}

export async function enqueueLocalAgentEventRequest(input: BaseInboxPayload): Promise<void> {
  const nowIso = getNowIso(input.nowIso);
  await input.db.prepare(
    `INSERT INTO agent_event_inbox (
       user_id,
       client_id,
       exe_id,
       request_path,
       request_body,
       content_type,
       attempt_count,
       next_attempt_at,
       last_error,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)`
  )
    .bind(
      input.userId,
      input.clientId,
      input.exeId || null,
      input.requestPath,
      input.requestBody,
      input.contentType || "application/json",
      nowIso,
      nowIso,
      nowIso
    )
    .run();
}

export async function enqueueLocalAgentThumbnailRequest(
  input: ThumbnailInboxPayload
): Promise<void> {
  const nowIso = getNowIso(input.nowIso);
  await input.db.prepare(
    `INSERT INTO agent_thumbnail_inbox_latest (
       user_id,
       client_id,
       exe_id,
       camera_id,
       request_path,
       request_body,
       content_type,
       attempt_count,
       last_error,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(user_id, client_id, camera_id) DO UPDATE SET
       exe_id = excluded.exe_id,
       request_path = excluded.request_path,
       request_body = excluded.request_body,
       content_type = excluded.content_type,
       attempt_count = 0,
       last_error = NULL,
       updated_at = excluded.updated_at`
  )
    .bind(
      input.userId,
      input.clientId,
      input.exeId || null,
      input.cameraId,
      input.requestPath,
      input.requestBody,
      input.contentType || "application/json",
      nowIso,
      nowIso
    )
    .run();
}

async function enqueueLocalAgentLatestRequest(
  routeKey: LatestInboxRouteKey,
  input: BaseInboxPayload
): Promise<void> {
  const nowIso = getNowIso(input.nowIso);
  const tableName =
    routeKey === "capture_thread_metrics"
      ? "agent_capture_metrics_inbox_latest"
      : "agent_open_monitor_inbox_latest";
  await input.db.prepare(
    `INSERT INTO ${tableName} (
       user_id,
       client_id,
       exe_id,
       request_path,
       request_body,
       content_type,
       attempt_count,
       last_error,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
       exe_id = excluded.exe_id,
       request_path = excluded.request_path,
       request_body = excluded.request_body,
       content_type = excluded.content_type,
       attempt_count = 0,
       last_error = NULL,
       updated_at = excluded.updated_at`
  )
    .bind(
      input.userId,
      input.clientId,
      input.exeId || null,
      input.requestPath,
      input.requestBody,
      input.contentType || "application/json",
      nowIso,
      nowIso
    )
    .run();
}

export async function enqueueLocalAgentCaptureMetricsRequest(
  input: BaseInboxPayload
): Promise<void> {
  await enqueueLocalAgentLatestRequest("capture_thread_metrics", input);
}

export async function enqueueLocalAgentOpenMonitorRequest(
  input: BaseInboxPayload
): Promise<void> {
  await enqueueLocalAgentLatestRequest("open_monitor_snapshot", input);
}

export function startLocalAgentIngressPump(options: {
  env: Env;
  dispatch: LocalAgentReplayDispatch;
}): void {
  if (!isLocalAgentIngressQueueEnabled(options.env) || pumpStarted) {
    return;
  }

  pumpStarted = true;
  const pollMs = readOptionalPositiveIntEnv(
    options.env,
    "LOCAL_AGENT_INGEST_POLL_MS",
    DEFAULT_POLL_INTERVAL_MS
  );

  const tick = () => {
    if (pumpDrainPromise) {
      return;
    }

    pumpDrainPromise = drainLocalAgentIngress(options.env, options.dispatch)
      .catch((error) => {
        console.error("[LOCAL AGENT INGRESS] Pump drain failed:", error);
      })
      .finally(() => {
        pumpDrainPromise = null;
      });
  };

  pumpTimer = setInterval(tick, pollMs);
  tick();
}

export function stopLocalAgentIngressPump(): void {
  if (pumpTimer) {
    clearInterval(pumpTimer);
    pumpTimer = null;
  }
  pumpStarted = false;
  pumpDrainPromise = null;
}

export function localAgentReplayHeaders() {
  return {
    replay: LOCAL_AGENT_REPLAY_HEADER,
    userId: LOCAL_AGENT_REPLAY_USER_HEADER,
    clientId: LOCAL_AGENT_REPLAY_CLIENT_HEADER,
    exeId: LOCAL_AGENT_REPLAY_EXE_HEADER,
    queue: LOCAL_AGENT_REPLAY_QUEUE_HEADER,
  };
}

export function buildLocalAgentReplayRequestPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function readReplayQueueKey(headers: Headers): LocalAgentIngressRouteKey | null {
  const value = headers.get(LOCAL_AGENT_REPLAY_QUEUE_HEADER);
  if (
    value === "events" ||
    value === "thumbnails" ||
    value === "capture_thread_metrics" ||
    value === "open_monitor_snapshot"
  ) {
    return value;
  }
  return null;
}

export function coerceQueuedCameraIdFromBody(bodyText: string): number | null {
  try {
    const parsed = JSON.parse(bodyText);
    const rawCameraId =
      typeof parsed?.camera_id === "string"
        ? Number.parseInt(parsed.camera_id, 10)
        : typeof parsed?.camera_id === "number"
        ? parsed.camera_id
        : NaN;
    return Number.isInteger(rawCameraId) && rawCameraId > 0 ? rawCameraId : null;
  } catch {
    return null;
  }
}

import { createServer } from "http";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { webcrypto } from "node:crypto";
import { Pool } from "pg";
import { WebSocketServer } from "ws";
import {
  resolveActiveBrandRuntime,
  resolveDatabaseBackend,
  resolveDefaultSqlitePath,
} from "./brand";
import { loadEnv } from "./env";
import { PgD1Database } from "./pg-d1";
import { LocalR2Bucket } from "./local-r2";
import { runLocalCameraDiscovery } from "./camera-discovery";
import {
  registerSharedFindRelayConnection,
  routeSharedFindRelayClientMessage,
  unregisterSharedFindRelayConnection,
} from "../src/worker/sharedFindRelayState";
import {
  registerWorkspaceRelayConnection,
  routeWorkspaceRelayClientMessage,
  unregisterWorkspaceRelayConnection,
} from "../src/worker/workspaceRelayState";
import { startLocalAgentIngressPump } from "../src/worker/localAgentIngress";

if (!(globalThis as any).crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

loadEnv();

const port = Number(process.env.PORT || 4000);
const runtimeProfile = (process.env.APP_RUNTIME_ENV || "local").toLowerCase();
const isServerRuntime = runtimeProfile === "server";
const storageRoot = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.resolve(process.cwd(), "storage");
const r2Root = path.join(storageRoot, "r2");
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const staticRoot = process.env.APP_STATIC_ROOT
  ? path.resolve(process.env.APP_STATIC_ROOT)
  : "";
const agentBaseUrl = String(process.env.APP_AGENT_BASE_URL || "").trim().replace(/\/+$/, "");
const serverRole = String(process.env.APP_SERVER_ROLE || "ui").trim().toLowerCase();
const isAgentServer = serverRole === "agent";
const activeBrand = resolveActiveBrandRuntime();
const databaseBackend = resolveDatabaseBackend(activeBrand);
const runtimeHealthRoute = "/api/runtime/health";
const runtimeAgentHealthRoute = "/api/runtime/agent-health";
const legacyHealthRoute = "/__perceptrum/health";

function resolveSecretValue(
  inlineValue: string | undefined,
  filePathValue: string | undefined
) {
  const secretPath = filePathValue?.trim();
  if (secretPath) {
    const resolvedPath = path.isAbsolute(secretPath)
      ? secretPath
      : path.resolve(process.cwd(), secretPath);
    try {
      return fs.readFileSync(resolvedPath, "utf8").trim();
    } catch (error) {
      throw new Error(`Failed to read secret file at ${resolvedPath}: ${String(error)}`);
    }
  }

  return (inlineValue || "").replace(/\\n/g, "\n").trim();
}

type ClosableDatabase = {
  close: () => void;
};

let pool: Pool | null = null;
let sqliteDb: ClosableDatabase | null = null;
const R2_BUCKET = new LocalR2Bucket(r2Root);

async function createDatabase() {
  if (databaseBackend === "sqlite") {
    const sqlitePath = resolveDefaultSqlitePath(activeBrand, storageRoot);
    const { SqliteD1Database } = await import("./sqlite-d1");
    sqliteDb = new SqliteD1Database(sqlitePath);
    console.log(`[local-server] SQLite database: ${sqlitePath}`);
    return sqliteDb;
  }

  pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5433),
    database: process.env.PGDATABASE || "perceptrum_site",
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "1234",
  });
  return new PgD1Database(pool);
}

function isAgentRequestPath(pathname: string) {
  return pathname === "/api/agent" || pathname.startsWith("/api/agent/");
}

function normalizeProxyHeaderValue(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value || "";
  return normalized.split(",")[0]?.trim() || "";
}

function resolveRequestBaseUrl(req: any): string {
  const forwardedProto = normalizeProxyHeaderValue(req.headers["x-forwarded-proto"]).toLowerCase();
  const forwardedHost =
    normalizeProxyHeaderValue(req.headers["x-forwarded-host"]) ||
    normalizeProxyHeaderValue(req.headers.host) ||
    "localhost";
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? forwardedProto
    : "http";
  return `${protocol}://${forwardedHost}`;
}

async function forwardHttpRequest(req: any, targetUrl: URL) {
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: req.headers as any,
    body,
  };

  if (body) {
    init.duplex = "half";
  }

  return fetch(new Request(targetUrl.toString(), init));
}

async function writeForwardedResponse(res: any, response: Response) {
  res.statusCode = response.status;

  const getSetCookie =
    typeof (response.headers as any).getSetCookie === "function"
      ? (response.headers as any).getSetCookie()
      : null;
  const setCookieValues: string[] = Array.isArray(getSetCookie)
    ? getSetCookie
    : (() => {
        const single = response.headers.get("set-cookie");
        return single ? [single] : [];
      })();

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });

  if (setCookieValues.length > 0) {
    res.setHeader(
      "set-cookie",
      setCookieValues.map((value) => rewriteSetCookie(value))
    );
  }

  if (response.body) {
    Readable.fromWeb(response.body as any).pipe(res);
  } else {
    res.end();
  }
}

async function startServer() {
  const { default: worker } = await import("../src/worker/index");
  const DB = await createDatabase();
  const centralAuthPublicKey = resolveSecretValue(
    process.env.CENTRAL_AUTH_PUBLIC_KEY,
    process.env.CENTRAL_AUTH_PUBLIC_KEY_PATH
  );
  const centralAuthPrivateKey = resolveSecretValue(
    process.env.CENTRAL_AUTH_PRIVATE_KEY,
    process.env.CENTRAL_AUTH_PRIVATE_KEY_PATH
  );
  const env = {
    DB,
    R2_BUCKET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    DESKTOP_GOOGLE_OAUTH_CLIENT_ID: process.env.DESKTOP_GOOGLE_OAUTH_CLIENT_ID || "",
    DESKTOP_GOOGLE_OAUTH_CLIENT_SECRET:
      process.env.DESKTOP_GOOGLE_OAUTH_CLIENT_SECRET || "",
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI || "",
    DESKTOP_GOOGLE_OAUTH_REDIRECT_URI:
      process.env.DESKTOP_GOOGLE_OAUTH_REDIRECT_URI || "",
    GOOGLE_GEOCODING_API_KEY: process.env.GOOGLE_GEOCODING_API_KEY || "",
    CHAT_V2_ENABLED: process.env.CHAT_V2_ENABLED || "",
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
    STRIPE_CHAT_PAYG_PRICE_ID: process.env.STRIPE_CHAT_PAYG_PRICE_ID || "",
    R2_PUBLIC_BASE_URL:
      process.env.R2_PUBLIC_BASE_URL || `${appBaseUrl}/media`,
    APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS || "",
    APP_AGENT_BASE_URL: process.env.APP_AGENT_BASE_URL || "",
    APP_SERVER_ROLE: process.env.APP_SERVER_ROLE || "",
    USD_TO_BRL: process.env.USD_TO_BRL || "",
    SCHEDULER_TICK_SECRET: process.env.SCHEDULER_TICK_SECRET || "",
    LOCAL_AGENT_INGEST_MODE: process.env.LOCAL_AGENT_INGEST_MODE || "",
    LOCAL_AGENT_INGEST_POLL_MS: process.env.LOCAL_AGENT_INGEST_POLL_MS || "",
    LOCAL_AGENT_EVENT_BATCH_SIZE: process.env.LOCAL_AGENT_EVENT_BATCH_SIZE || "",
    LOCAL_AGENT_LATEST_BATCH_SIZE: process.env.LOCAL_AGENT_LATEST_BATCH_SIZE || "",
    LOCAL_AGENT_EVENT_MAX_ATTEMPTS: process.env.LOCAL_AGENT_EVENT_MAX_ATTEMPTS || "",
    APP_SCHEMA_SCOPE: process.env.APP_SCHEMA_SCOPE || "",
    CENTRAL_AUTH_BASE_URL: process.env.CENTRAL_AUTH_BASE_URL || "",
    CENTRAL_AUTH_PUBLIC_KEY: centralAuthPublicKey,
    CENTRAL_AUTH_PRIVATE_KEY: centralAuthPrivateKey,
    CENTRAL_AUTH_GRANT_TTL_HOURS: process.env.CENTRAL_AUTH_GRANT_TTL_HOURS || "",
    CENTRAL_AUTH_KEY_ID: process.env.CENTRAL_AUTH_KEY_ID || "",
  };
  if (isAgentServer) {
    startLocalAgentIngressPump({
      env: env as any,
      dispatch: (request) =>
        worker.fetch(request, env as any, { waitUntil: () => {} } as any),
    });
  }
  const relayWss = new WebSocketServer({ noServer: true });
  const workspaceRelayWss = new WebSocketServer({ noServer: true });
  const chatWss = new WebSocketServer({ noServer: true });

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const url = new URL(req.url, resolveRequestBaseUrl(req));

    if (url.pathname === legacyHealthRoute) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ok: true,
          brand: activeBrand.id,
          backend: databaseBackend,
          staticRoot: staticRoot || null,
          staticReady: Boolean(staticRoot && fs.existsSync(path.join(staticRoot, "index.html"))),
        })
      );
      return;
    }

    if (url.pathname === runtimeHealthRoute) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          ready: true,
          fatal: false,
          summary: "Backend warm-up completed successfully.",
          details: {
            backend: databaseBackend,
            brand: activeBrand.id,
            port,
            staticRoot: staticRoot || null,
            staticReady: Boolean(staticRoot && fs.existsSync(path.join(staticRoot, "index.html"))),
            serverRole,
            agentProxyEnabled: Boolean(!isAgentServer && agentBaseUrl),
          },
        })
      );
      return;
    }

    if (url.pathname === runtimeAgentHealthRoute) {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(await buildRuntimeAgentHealthPayload(env)));
      return;
    }

    if (url.pathname === "/api/auth/country" && req.method === "GET") {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          detectedCountryCode: detectCountryFromHeaders(req),
        })
      );
      return;
    }

    if (url.pathname === "/api/runtime/local-session" && req.method === "POST") {
      await handleRuntimeLocalSession(req, res, env);
      return;
    }

    if (url.pathname === "/api/runtime/camera-discovery" && req.method === "POST") {
      await handleRuntimeCameraDiscovery(req, res);
      return;
    }

    if (url.pathname.startsWith("/media/")) {
      await serveMedia(res, url.pathname);
      return;
    }

    if (isAgentServer && !isAgentRequestPath(url.pathname)) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    if (!isAgentServer && agentBaseUrl && isAgentRequestPath(url.pathname)) {
      const forwarded = await forwardHttpRequest(
        req,
        new URL(
          `${url.pathname}${url.search}`,
          agentBaseUrl.endsWith("/") ? agentBaseUrl : `${agentBaseUrl}/`
        )
      );
      await writeForwardedResponse(res, forwarded);
      return;
    }

    if (url.pathname.startsWith("/ws/")) {
      res.statusCode = 501;
      res.end("WebSocket not supported in local server");
      return;
    }

    if (staticRoot && shouldServeStaticRoute(url.pathname, req.method || "GET")) {
      await serveStaticAsset(res, url.pathname, req.method || "GET");
      return;
    }

    const method = req.method || "GET";
    const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
    const init: RequestInit & { duplex?: "half" } = {
      method,
      headers: req.headers as any,
      body,
    };

    if (body) {
      init.duplex = "half";
    }

    let response: Response;
    try {
      response = await worker.fetch(
        new Request(url.toString(), init),
        env as any,
        { waitUntil: () => {} } as any
      );
    } catch (error) {
      console.error("[local-server] worker request failed", {
        method,
        path: url.pathname,
        error,
      });
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Local backend request failed." }));
      return;
    }

    await writeForwardedResponse(res, response);
  });

  relayWss.on("connection", (ws, request) => {
    const requestUrl = new URL(request.url || "/", resolveRequestBaseUrl(request));
    const token = requestUrl.searchParams.get("token") || "";
    const registered = registerSharedFindRelayConnection(token, ws as any);

    if (!registered) {
      try {
        ws.send(JSON.stringify({ type: "relay_error", error: "invalid_or_expired_session" }));
      } catch {
        // ignore send errors during close
      }
      ws.close(1008, "invalid_or_expired_session");
      return;
    }

    const { publicId, expiresAt } = registered;
    try {
      ws.send(
        JSON.stringify({
          type: "relay_ready",
          public_id: publicId,
          expires_at: expiresAt,
        })
      );
    } catch {
      ws.close(1011, "relay_ready_failed");
      return;
    }

    ws.on("message", (rawData) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(String(rawData || "{}"));
      } catch {
        try {
          ws.send(JSON.stringify({ type: "relay_error", error: "invalid_json" }));
        } catch {
          // ignore send errors
        }
        return;
      }

      const routed = routeSharedFindRelayClientMessage(publicId, payload);
      if (!routed.ok && routed.error) {
        try {
          ws.send(JSON.stringify({ type: "relay_error", error: routed.error }));
        } catch {
          // ignore send errors
        }
      }
    });

    ws.on("close", () => {
      unregisterSharedFindRelayConnection(publicId, ws as any);
    });
  });

  workspaceRelayWss.on("connection", (ws, request) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const token = requestUrl.searchParams.get("token") || "";
    const registered = registerWorkspaceRelayConnection(token, ws as any);

    if (!registered) {
      try {
        ws.send(JSON.stringify({ type: "relay_error", error: "invalid_or_expired_session" }));
      } catch {
        // ignore send errors during close
      }
      ws.close(1008, "invalid_or_expired_session");
      return;
    }

    const { publicId, expiresAt } = registered;
    try {
      ws.send(
        JSON.stringify({
          type: "relay_ready",
          public_id: publicId,
          expires_at: expiresAt,
        })
      );
    } catch {
      ws.close(1011, "relay_ready_failed");
      return;
    }

    ws.on("message", (rawData) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(String(rawData || "{}"));
      } catch {
        try {
          ws.send(JSON.stringify({ type: "relay_error", error: "invalid_json" }));
        } catch {
          // ignore send errors
        }
        return;
      }

      const routed = routeWorkspaceRelayClientMessage(publicId, payload);
      if (!routed.ok && routed.error) {
        try {
          ws.send(JSON.stringify({ type: "relay_error", error: routed.error }));
        } catch {
          // ignore send errors
        }
      }
    });

    ws.on("close", () => {
      unregisterWorkspaceRelayConnection(publicId, ws as any);
    });
  });

  chatWss.on("connection", (ws, request) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const rawSessionId = requestUrl.pathname.replace(/^\/ws\/chat\//, "").split("/")[0] || "";
    const sessionId = Number.parseInt(rawSessionId, 10);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      ws.close(1008, "invalid_session");
      return;
    }

    let closed = false;
    let lastSignature = "";
    const sendCurrentMessages = async () => {
      if (closed) return;
      try {
        const { results } = await (env.DB as any)
          .prepare("SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC")
          .bind(sessionId)
          .all();
        const messages = results || [];
        const signature = JSON.stringify(
          messages.map((message: any) => [
            message.id,
            message.updated_at,
            message.is_pending,
            message.content,
          ])
        );
        if (signature === lastSignature) {
          return;
        }
        lastSignature = signature;
        ws.send(JSON.stringify({ type: "message_update", messages }));
      } catch (error) {
        console.error("[local-server] chat websocket poll failed", error);
      }
    };

    const timer = setInterval(() => {
      void sendCurrentMessages();
    }, 1000);
    void sendCurrentMessages();

    ws.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/ws/find-relay") {
      relayWss.handleUpgrade(req, socket, head, (ws) => {
        relayWss.emit("connection", ws, req);
      });
      return;
    }

    if (requestUrl.pathname === "/ws/workspace-relay") {
      workspaceRelayWss.handleUpgrade(req, socket, head, (ws) => {
        workspaceRelayWss.emit("connection", ws, req);
      });
      return;
    }

    if (requestUrl.pathname.startsWith("/ws/chat/")) {
      chatWss.handleUpgrade(req, socket, head, (ws) => {
        chatWss.emit("connection", ws, req);
      });
      return;
    }

    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  });

  server.listen(port, () => {
    console.log(
      `[local-server] role=${serverRole} brand=${activeBrand.id} profile=${runtimeProfile} backend=${databaseBackend} listening on http://localhost:${port}${
        !isAgentServer && agentBaseUrl ? ` agentProxy=${agentBaseUrl}` : ""
      }`
    );
  });
}

void startServer().catch(async (error) => {
  console.error("[local-server] failed to start", error);
  sqliteDb?.close();
  if (pool) {
    await pool.end().catch(() => {});
  }
  process.exit(1);
});

process.on("exit", () => {
  sqliteDb?.close();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    try {
      sqliteDb?.close();
      if (pool) {
        await pool.end();
      }
    } finally {
      process.exit(0);
    }
  });
}

async function readJsonBody(req: any) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  return JSON.parse(text);
}

function buildForwardHeaders(req: any, extra: Record<string, string> = {}) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "host" || normalizedKey === "content-length") {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value);
  }
  return headers;
}

function detectCountryFromHeaders(req: any) {
  const value = String(
    req.headers["cf-ipcountry"] ||
      req.headers["x-country-code"] ||
      req.headers["x-app-country-code"] ||
      ""
  )
    .trim()
    .toUpperCase();

  if (!value || value === "XX") {
    return null;
  }

  return value;
}

function selectedRuntimeEnvironment() {
  return {
    SQLITE_DB_PATH: process.env.SQLITE_DB_PATH
      ? path.resolve(process.env.SQLITE_DB_PATH)
      : null,
    STORAGE_ROOT: storageRoot,
    APP_RUNTIME_DATA_ROOT: process.env.APP_RUNTIME_DATA_ROOT
      ? path.resolve(process.env.APP_RUNTIME_DATA_ROOT)
      : null,
    APP_RUNTIME_CONFIG_ROOT: process.env.APP_RUNTIME_CONFIG_ROOT
      ? path.resolve(process.env.APP_RUNTIME_CONFIG_ROOT)
      : null,
    APP_RUNTIME_CACHE_ROOT: process.env.APP_RUNTIME_CACHE_ROOT
      ? path.resolve(process.env.APP_RUNTIME_CACHE_ROOT)
      : null,
    APP_RUNTIME_STATE_ROOT: process.env.APP_RUNTIME_STATE_ROOT
      ? path.resolve(process.env.APP_RUNTIME_STATE_ROOT)
      : null,
    APP_RUNTIME_LOG_ROOT: process.env.APP_RUNTIME_LOG_ROOT
      ? path.resolve(process.env.APP_RUNTIME_LOG_ROOT)
      : null,
    APP_BASE_URL: appBaseUrl,
    APP_SERVER_ROLE: serverRole,
    PORT: port,
  };
}

function readAgentHealthSnapshot() {
  const dataRoot = process.env.APP_RUNTIME_DATA_ROOT
    ? path.resolve(process.env.APP_RUNTIME_DATA_ROOT)
    : storageRoot;
  const snapshotPath = path.join(dataRoot, "agent_health.json");
  try {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const heartbeatMs = Number(snapshot?.heartbeat_unix_ms || 0);
    const ageMs = heartbeatMs > 0 ? Math.max(0, Date.now() - heartbeatMs) : null;
    const staleAfterMs = Number(process.env.PERCEPTRUM_AGENT_HEALTH_STALE_SECONDS || 30) * 1000;
    return {
      path: snapshotPath,
      exists: true,
      stale: ageMs === null || ageMs > staleAfterMs,
      heartbeat_age_seconds: ageMs === null ? null : Math.floor(ageMs / 1000),
      status: typeof snapshot?.status === "string" ? snapshot.status : null,
      pid: Number.isFinite(Number(snapshot?.pid)) ? Number(snapshot.pid) : null,
      client_id: typeof snapshot?.client_id === "string" ? snapshot.client_id : "",
      exe_id: typeof snapshot?.exe_id === "string" ? snapshot.exe_id : "",
      agent_runtime: typeof snapshot?.agent_runtime === "string" ? snapshot.agent_runtime : "",
      runtime_mode: typeof snapshot?.runtime_mode === "string" ? snapshot.runtime_mode : "",
      job_runtime_enabled: Boolean(snapshot?.job_runtime_enabled),
      job_runtime_commands_polled: Number(snapshot?.job_runtime_commands_polled || 0),
      job_runtime_commands_completed: Number(snapshot?.job_runtime_commands_completed || 0),
      job_runtime_commands_failed: Number(snapshot?.job_runtime_commands_failed || 0),
      last_command_type:
        typeof snapshot?.job_runtime_last_command_type === "string"
          ? snapshot.job_runtime_last_command_type
          : "",
      last_error:
        typeof snapshot?.job_runtime_last_error === "string"
          ? snapshot.job_runtime_last_error
          : "",
      active_camera_sessions: Array.isArray(snapshot?.active_camera_sessions)
        ? snapshot.active_camera_sessions
        : [],
      camera_session_last_errors:
        snapshot?.camera_session_last_errors &&
        typeof snapshot.camera_session_last_errors === "object"
          ? snapshot.camera_session_last_errors
          : {},
      camera_session_last_thumbnails:
        snapshot?.camera_session_last_thumbnails &&
        typeof snapshot.camera_session_last_thumbnails === "object"
          ? snapshot.camera_session_last_thumbnails
          : {},
      camera_session_clip_directories:
        snapshot?.camera_session_clip_directories &&
        typeof snapshot.camera_session_clip_directories === "object"
          ? snapshot.camera_session_clip_directories
          : {},
      camera_session_ffmpeg_child_pids:
        snapshot?.camera_session_ffmpeg_child_pids &&
        typeof snapshot.camera_session_ffmpeg_child_pids === "object"
          ? snapshot.camera_session_ffmpeg_child_pids
          : {},
    };
  } catch (error) {
    return {
      path: snapshotPath,
      exists: false,
      stale: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readAgentCommandCounts(env: unknown) {
  const db = (env as any)?.DB;
  if (!db || typeof db.prepare !== "function") {
    return {
      pending: 0,
      sent: 0,
      failed: 0,
      completed: 0,
    };
  }

  try {
    const { results } = await db
      .prepare(
        `SELECT COALESCE(status, 'pending') AS status, COUNT(*) AS count
         FROM commands
         WHERE command_type IN ('start_camera', 'stop_camera')
         GROUP BY COALESCE(status, 'pending')`
      )
      .all();
    const counts = {
      pending: 0,
      sent: 0,
      failed: 0,
      completed: 0,
    };
    for (const row of results || []) {
      const status = String((row as any)?.status || "pending").trim().toLowerCase();
      const count = Number((row as any)?.count || 0);
      if (status === "pending" || status === "sent" || status === "failed" || status === "completed") {
        (counts as Record<string, number>)[status] = count;
      }
    }
    return counts;
  } catch {
    return {
      pending: 0,
      sent: 0,
      failed: 0,
      completed: 0,
    };
  }
}

async function buildRuntimeAgentHealthPayload(envInput?: unknown) {
  const env = selectedRuntimeEnvironment();
  const sqlitePath =
    env.SQLITE_DB_PATH || resolveDefaultSqlitePath(activeBrand, storageRoot);
  const snapshot = readAgentHealthSnapshot();
  const commandCounts = await readAgentCommandCounts(envInput);
  return {
    ok: snapshot.exists && !snapshot.stale,
    backend: {
      pid: process.pid,
      sqlite_path: sqlitePath,
      storage_root: storageRoot,
      runtime_ready: true,
    },
    env,
    agent: snapshot,
    commands: commandCounts,
  };
}

async function invokeWorkerFetch(
  requestUrl: string,
  method: string,
  headers: Headers,
  body: string | undefined,
  env: unknown
) {
  return worker.fetch(
    new Request(requestUrl, {
      method,
      headers,
      body,
    }),
    env as any,
    { waitUntil: () => {} } as any
  );
}

async function writeWorkerFetchResponse(res: any, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body) {
    Readable.fromWeb(response.body as any).pipe(res);
  } else {
    res.end();
  }
}

function resolveLocalSessionExeId(value: unknown) {
  const explicit = typeof value === "string" ? value.trim() : "";
  if (explicit) {
    return explicit;
  }
  return `exe-${Date.now()}`;
}

async function handleRuntimeLocalSession(req: any, res: any, env: unknown) {
  try {
    const body = await readJsonBody(req);
    const exeId = resolveLocalSessionExeId(body?.exe_id);
    const timezoneIana =
      typeof body?.timezone_iana === "string" ? body.timezone_iana.trim() : "";

    const generateResponse = await invokeWorkerFetch(
      `${appBaseUrl}/api/pairing/generate`,
      "POST",
      buildForwardHeaders(req),
      undefined,
      env
    );

    if (!generateResponse.ok) {
      await writeWorkerFetchResponse(res, generateResponse);
      return;
    }

    const generatePayload = await generateResponse.json();
    const pairCode = String((generatePayload as any)?.pair_code || "").trim();
    if (!pairCode) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Unable to generate local pair code." }));
      return;
    }

    const pairResponse = await invokeWorkerFetch(
      `${appBaseUrl}/api/pairing/pair`,
      "POST",
      buildForwardHeaders(req, {
        "content-type": "application/json; charset=utf-8",
      }),
      JSON.stringify({
        pair_code: pairCode,
        exe_id: exeId,
        timezone_iana: timezoneIana,
      }),
      env
    );

    await writeWorkerFetchResponse(res, pairResponse);
  } catch (error) {
    console.error("[local-server] local-session failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Unable to provision local session.",
      })
    );
  }
}

async function handleRuntimeCameraDiscovery(req: any, res: any) {
  try {
    const body = await readJsonBody(req);
    const payload = await runLocalCameraDiscovery(body?.timeout_ms);
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  } catch (error) {
    console.error("[local-server] camera discovery failed", error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Unable to scan the local network for cameras.",
      })
    );
  }
}

function shouldServeStaticRoute(pathname: string, method: string) {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
    return false;
  }

  return !(
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/media" ||
    pathname.startsWith("/media/") ||
    pathname === "/ws" ||
    pathname.startsWith("/ws/")
  );
}

async function serveStaticAsset(res: any, pathname: string, method: string) {
  const safeRoot = path.resolve(staticRoot);
  const indexPath = path.join(safeRoot, "index.html");
  let relativePath = "";

  try {
    relativePath = decodeURIComponent(pathname);
  } catch {
    res.statusCode = 400;
    res.end("Invalid path");
    return;
  }

  if (relativePath === "/" || !relativePath.trim()) {
    relativePath = "/index.html";
  }

  const candidatePath = path.resolve(path.join(safeRoot, relativePath.replace(/^\/+/, "")));
  if (!candidatePath.startsWith(`${safeRoot}${path.sep}`) && candidatePath !== safeRoot) {
    res.statusCode = 400;
    res.end("Invalid path");
    return;
  }

  let filePath = candidatePath;
  let spaFallback = false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (path.extname(candidatePath)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    filePath = indexPath;
    spaFallback = true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end("Static web build not found");
    return;
  }

  const contentType = guessContentType(filePath);
  if (contentType) {
    res.setHeader("content-type", contentType);
  }
  res.setHeader(
    "cache-control",
    spaFallback || path.basename(filePath) === "index.html"
      ? "no-cache"
      : "public, max-age=31536000, immutable"
  );

  if (method.toUpperCase() === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function serveMedia(res: any, pathname: string) {
  const key = decodeURIComponent(pathname.replace(/^\/media\//, ""));
  const safeRoot = path.resolve(r2Root);
  const filePath = path.resolve(path.join(r2Root, key));

  if (!filePath.startsWith(safeRoot)) {
    res.statusCode = 400;
    res.end("Invalid path");
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const meta = readMeta(filePath);
  const contentType = meta?.contentType || guessContentType(filePath);

  if (contentType) {
    res.setHeader("content-type", contentType);
  }
  res.setHeader("cache-control", "public, max-age=31536000, immutable");

  fs.createReadStream(filePath).pipe(res);
}

function readMeta(filePath: string): { contentType?: string } | null {
  const metaPath = `${filePath}.meta.json`;
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    return JSON.parse(raw) as { contentType?: string };
  } catch {
    return null;
  }
}

function guessContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

function rewriteSetCookie(value: string) {
  if (isServerRuntime) {
    return value;
  }

  return value
    .replace(/;\s*Secure/gi, "")
    .replace(/SameSite=None/gi, "SameSite=Lax");
}

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
const agentBaseUrl = String(process.env.APP_AGENT_BASE_URL || "").trim().replace(/\/+$/, "");
const serverRole = String(process.env.APP_SERVER_ROLE || "ui").trim().toLowerCase();
const isAgentServer = serverRole === "agent";
const activeBrand = resolveActiveBrandRuntime();
const databaseBackend = resolveDatabaseBackend(activeBrand);

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

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const url = new URL(req.url, resolveRequestBaseUrl(req));

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

    const response = await worker.fetch(
      new Request(url.toString(), init),
      env as any,
      { waitUntil: () => {} } as any
    );

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

    if (requestUrl.pathname !== "/ws/find-relay") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
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

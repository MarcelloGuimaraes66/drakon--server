import { createServer } from "http";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { webcrypto } from "node:crypto";
import { Pool } from "pg";
import worker from "../src/worker/index";
import {
  resolveActiveBrandRuntime,
  resolveDatabaseBackend,
  resolveDefaultSqlitePath,
} from "./brand";
import { loadEnv } from "./env";
import { PgD1Database } from "./pg-d1";
import { LocalR2Bucket } from "./local-r2";

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
const activeBrand = resolveActiveBrandRuntime();
const databaseBackend = resolveDatabaseBackend(activeBrand);

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

async function startServer() {
  const DB = await createDatabase();
  const env = {
    DB,
    R2_BUCKET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
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
    USD_TO_BRL: process.env.USD_TO_BRL || "",
    SCHEDULER_TICK_SECRET: process.env.SCHEDULER_TICK_SECRET || "",
  };

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/media/")) {
      await serveMedia(res, url.pathname);
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
  });

  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  server.listen(port, () => {
    console.log(
      `[local-server] brand=${activeBrand.id} profile=${runtimeProfile} backend=${databaseBackend} listening on http://localhost:${port}`
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

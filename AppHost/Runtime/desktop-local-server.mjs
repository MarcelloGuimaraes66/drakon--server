import { createServer } from "http";
import { Readable } from "stream";
import fs from "fs";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = resolveWorkspaceRoot();
const drakonSiteRoot = resolveDrakonSiteRoot(workspaceRoot);
const requireFromDrakonSite = createRequire(path.join(drakonSiteRoot, "package.json"));

function moduleUrl(...segments) {
  return pathToFileURL(path.join(drakonSiteRoot, ...segments)).href;
}

const {
  resolveActiveBrandRuntime,
  resolveDatabaseBackend,
  resolveDefaultSqlitePath,
} = await import(moduleUrl("server", "brand.ts"));
const { loadEnv } = await import(moduleUrl("server", "env.ts"));
const { PgD1Database } = await import(moduleUrl("server", "pg-d1.ts"));
const { LocalR2Bucket } = await import(moduleUrl("server", "local-r2.ts"));

loadEnv();

const port = Number(process.env.PORT || 4000);
const bindHost = process.env.APP_BIND_HOST || "127.0.0.1";
const runtimeProfile = (process.env.APP_RUNTIME_ENV || "local").toLowerCase();
const isServerRuntime = runtimeProfile === "server";
const storageRoot = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.resolve(drakonSiteRoot, "storage");
const staticRoot = process.env.APP_STATIC_ROOT
  ? path.resolve(process.env.APP_STATIC_ROOT)
  : "";
const r2Root = path.join(storageRoot, "r2");
const appBaseUrl = process.env.APP_BASE_URL || `http://${bindHost}:${port}`;
const serviceSessionDir = process.env.APP_SERVICE_SESSION_DIR
  ? path.resolve(process.env.APP_SERVICE_SESSION_DIR)
  : path.resolve(storageRoot, "desktop-session");
const activeBrand = resolveActiveBrandRuntime();
const databaseBackend = resolveDatabaseBackend(activeBrand);

const { default: worker } = await import(moduleUrl("src", "worker", "index.ts"));

fs.mkdirSync(serviceSessionDir, { recursive: true });

let pool = null;
let sqliteDb = null;
const R2_BUCKET = new LocalR2Bucket(r2Root);

async function createDatabase() {
  if (databaseBackend === "sqlite") {
    const sqlitePath = resolveDefaultSqlitePath(activeBrand, storageRoot);
    const { SqliteD1Database } = await import(moduleUrl("server", "sqlite-d1.ts"));
    sqliteDb = new SqliteD1Database(sqlitePath);
    console.log(`[desktop-server] SQLite database: ${sqlitePath}`);
    return sqliteDb;
  }

  const { Pool } = requireFromDrakonSite("pg");
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

    if (url.pathname === "/api/runtime/local-session" && req.method === "POST") {
      await handleRuntimeLocalSession(req, res, env);
      return;
    }

    if (url.pathname.startsWith("/media/")) {
      await serveMedia(res, url.pathname);
      return;
    }

    if (url.pathname.startsWith("/ws/")) {
      res.statusCode = 501;
      res.end("WebSocket not supported in local server");
      return;
    }

    if (await tryServeStatic(res, url.pathname)) {
      return;
    }

    const response = await proxyWorkerRequest(req, url, env);
    await writeWorkerResponse(res, response);
  });

  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  server.listen(port, bindHost, () => {
    console.log(
      `[desktop-server] brand=${activeBrand.id} profile=${runtimeProfile} backend=${databaseBackend} listening on http://${bindHost}:${port} static=${staticRoot || "<none>"} sessionDir=${serviceSessionDir}`
    );
  });
}

async function handleRuntimeLocalSession(req, res, env) {
  try {
    const body = await readJsonBody(req);
    const exeId = resolveOrCreateExeId(body?.exe_id);
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
      await writeWorkerResponse(res, generateResponse);
      return;
    }

    const generatePayload = await generateResponse.json();
    const pairCode = String(generatePayload?.pair_code || "").trim();
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

    if (!pairResponse.ok) {
      await writeWorkerResponse(res, pairResponse);
      return;
    }

    const pairPayload = await pairResponse.clone().json();
    persistServiceSession(pairPayload);
    await writeWorkerResponse(res, pairResponse);
  } catch (error) {
    console.error("[desktop-server] local-session failed", error);
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

function resolveWorkspaceRoot() {
  const fromEnv = process.env.DRAKON_WORKSPACE_ROOT
    ? path.resolve(process.env.DRAKON_WORKSPACE_ROOT)
    : "";
  const candidates = [
    fromEnv,
    path.resolve(__dirname, "..", ".."),
    path.resolve(__dirname, "..", "..", ".."),
    path.resolve(__dirname, "..", "..", "..", ".."),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "brand.config.json"))) {
      return candidate;
    }
  }

  return path.resolve(__dirname, "..", "..");
}

function resolveDrakonSiteRoot(rootDir) {
  const candidates = [
    path.join(rootDir, "DrakonSite"),
    path.join(__dirname, "drakonsite"),
    path.resolve(__dirname, "..", "runtime", "drakonsite"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "src", "worker", "index.ts"))) {
      return candidate;
    }
  }

  throw new Error(
    `[desktop-server] Unable to resolve DrakonSite root. Candidates: ${candidates.join(", ")}`
  );
}

function resolveOrCreateExeId(candidate) {
  const direct = typeof candidate === "string" ? candidate.trim() : "";
  if (direct) {
    fs.writeFileSync(path.join(serviceSessionDir, "exe_id.txt"), `${direct}\n`, "utf8");
    return direct;
  }

  const filePath = path.join(serviceSessionDir, "exe_id.txt");
  if (fs.existsSync(filePath)) {
    const saved = String(fs.readFileSync(filePath, "utf8")).trim();
    if (saved) {
      return saved;
    }
  }

  const generated = `desktop-${Date.now()}`;
  fs.writeFileSync(filePath, `${generated}\n`, "utf8");
  return generated;
}

function persistServiceSession(payload) {
  const exeToken = String(payload?.exe_token || "").trim();
  const clientId = String(payload?.client_id || "").trim();
  const exeId = String(payload?.exe_id || "").trim();
  const timezoneIana = String(payload?.timezone_iana || "").trim();

  if (!exeToken || !clientId || !exeId) {
    throw new Error("Provisioned session is missing exe_token, client_id, or exe_id.");
  }

  writeSessionFile("exe_token.txt", exeToken);
  writeSessionFile("client_id.txt", clientId);
  writeSessionFile("exe_id.txt", exeId);
  if (timezoneIana) {
    writeSessionFile("paired_timezone.txt", timezoneIana);
  }

  writeSessionFile("drakon_base_url.txt", appBaseUrl);
  writeSessionFile("perceptrum_base_url.txt", appBaseUrl);
}

function writeSessionFile(fileName, value) {
  fs.writeFileSync(path.join(serviceSessionDir, fileName), `${value}\n`, "utf8");
}

function buildForwardHeaders(req, overrides = {}) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          headers.append(key, item);
        }
      }
      continue;
    }

    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    headers.set(key, value);
  }

  return headers;
}

async function proxyWorkerRequest(req, url, env) {
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
  const init = {
    method,
    headers: req.headers,
    body,
  };

  if (body) {
    init.duplex = "half";
  }

  return worker.fetch(
    new Request(url.toString(), init),
    env,
    { waitUntil: () => {} }
  );
}

function invokeWorkerFetch(url, method, headers, body, env) {
  const init = {
    method,
    headers,
    body,
  };

  if (body) {
    init.duplex = "half";
  }

  return worker.fetch(
    new Request(url, init),
    env,
    { waitUntil: () => {} }
  );
}

async function writeWorkerResponse(res, response) {
  res.statusCode = response.status;

  const getSetCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : null;
  const setCookieValues = Array.isArray(getSetCookie)
    ? getSetCookie
    : (() => {
        const single = response.headers.get("set-cookie");
        return single ? [single] : [];
      })();

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    res.setHeader(key, value);
  });

  if (setCookieValues.length > 0) {
    res.setHeader(
      "set-cookie",
      setCookieValues.map((value) => rewriteSetCookie(value))
    );
  }

  if (response.body) {
    await new Promise((resolve, reject) => {
      Readable.fromWeb(response.body).on("error", reject).on("end", resolve).pipe(res);
    }).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Unable to proxy worker response");
      }
    });
    return;
  }

  res.end();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function tryServeStatic(res, pathname) {
  if (!staticRoot || pathname.startsWith("/api/") || pathname.startsWith("/runtime/")) {
    return false;
  }

  const safeRoot = path.resolve(staticRoot);
  let requestedPath = pathname === "/" ? "/index.html" : pathname;
  const cleanRelativePath = requestedPath.replace(/^\/+/, "");
  let filePath = path.resolve(path.join(safeRoot, cleanRelativePath));

  if (!filePath.startsWith(safeRoot)) {
    res.statusCode = 400;
    res.end("Invalid path");
    return true;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    await serveFile(res, filePath, requestedPath);
    return true;
  }

  if (path.extname(cleanRelativePath)) {
    res.statusCode = 404;
    res.end("Not found");
    return true;
  }

  const spaFallback = path.join(safeRoot, "index.html");
  if (fs.existsSync(spaFallback)) {
    await serveFile(res, spaFallback, "/index.html");
    return true;
  }

  return false;
}

async function serveFile(res, filePath, requestPath = "") {
  const contentType = guessContentType(filePath);
  if (contentType) {
    res.setHeader("content-type", contentType);
  }

  const normalizedRequestPath = String(requestPath).replace(/\\/g, "/").toLowerCase();
  const isBrandingAsset = normalizedRequestPath.includes("/branding/current/");

  if (
    isBrandingAsset ||
    (contentType && (contentType.startsWith("text/") || contentType.includes("javascript")))
  ) {
    res.setHeader("cache-control", "no-cache");
  } else {
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
  }

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("end", resolve);
    stream.pipe(res);
  }).catch(() => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Unable to read file");
    }
  });
}

async function serveMedia(res, pathname) {
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

function readMeta(filePath) {
  const metaPath = `${filePath}.meta.json`;
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
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

function rewriteSetCookie(value) {
  if (isServerRuntime) {
    return value;
  }

  return value
    .replace(/;\s*Secure/gi, "")
    .replace(/SameSite=None/gi, "SameSite=Lax");
}

void startServer().catch(async (error) => {
  console.error("[desktop-server] failed to start", error);
  sqliteDb?.close();
  if (pool) {
    await pool.end().catch(() => {});
  }
  process.exit(1);
});

process.on("exit", () => {
  sqliteDb?.close();
});

for (const signal of ["SIGINT", "SIGTERM"]) {
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

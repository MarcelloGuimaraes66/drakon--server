import { createServer } from "http";
import { Readable } from "stream";
import fs from "fs";
import path from "path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "../../DrakonSite/node_modules/pg/esm/index.mjs";
import { discoverCameraDevices } from "./camera-discovery.mjs";

import {
  resolveActiveBrandRuntime,
  resolveDatabaseBackend,
  resolveDefaultSqlitePath,
} from "../../DrakonSite/server/brand.ts";
import { loadEnv } from "../../DrakonSite/server/env.ts";
import { LocalR2Bucket } from "../../DrakonSite/server/local-r2.ts";
import { PgD1Database } from "../../DrakonSite/server/pg-d1.ts";
import { SqliteD1Database } from "../../DrakonSite/server/sqlite-d1.ts";
import {
  checkpointPlaintextSqlite,
  createDesktopSqliteDatabase,
  encryptPlaintextSqliteInPlace,
  hasPlaintextSqliteHeader,
  isDesktopSqliteEncryptionRequired,
  resolveDesktopSqliteEncryptionConfig,
} from "../../DrakonSite/server/sqlite-encryption.ts";
import worker from "../../DrakonSite/src/worker/index.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

loadEnv();

const port = Number(process.env.PORT || 4000);
const bindHost = process.env.APP_BIND_HOST || "127.0.0.1";
const runtimeProfile = (process.env.APP_RUNTIME_ENV || "local").toLowerCase();
const isServerRuntime = runtimeProfile === "server";
const runtimeRoot = process.env.APP_RUNTIME_ROOT
  ? path.resolve(process.env.APP_RUNTIME_ROOT)
  : path.dirname(fileURLToPath(import.meta.url));
const storageRoot = process.env.STORAGE_ROOT
  ? path.resolve(process.env.STORAGE_ROOT)
  : path.resolve(process.cwd(), "storage");
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
let sqliteEncryptionConfig = null;
let sqliteEncryptionConfigError = null;
try {
  sqliteEncryptionConfig = resolveDesktopSqliteEncryptionConfig(process.env);
} catch (error) {
  sqliteEncryptionConfigError = summarizeError(error);
}
const runtimeHealthRoute = "/api/runtime/health";
const sqliteCriticalTables = [
  "app_users",
  "cameras",
  "commands",
  "events",
  "local_sessions",
  "local_users",
];

let cachedExeId = String(process.env.APP_PROVISIONED_EXE_ID || "").trim();
let activeCameraDiscoveryPromise = null;

fs.mkdirSync(serviceSessionDir, { recursive: true });

let pool = null;
let sqliteDb = null;
const R2_BUCKET = new LocalR2Bucket(r2Root);
let runtimeState = createRuntimeState({
  summary: "Local runtime is initializing.",
  details: {
    backend: databaseBackend,
    brand: activeBrand.id,
  },
});

function createRuntimeState(overrides = {}) {
  const baseState = {
    ready: false,
    fatal: false,
    summary: "Local runtime is not ready.",
    details: {
      backend: databaseBackend,
      brand: activeBrand.id,
      port,
      staticRoot: staticRoot || null,
      sqliteEncryption:
        databaseBackend === "sqlite"
          ? sqliteEncryptionConfig?.mode || (sqliteEncryptionConfigError ? "invalid" : "off")
          : "off",
      sqliteKeyVersion:
        databaseBackend === "sqlite" && sqliteEncryptionConfig
          ? sqliteEncryptionConfig.keyVersion
          : null,
    },
    env: null,
  };

  return {
    ...baseState,
    ...overrides,
    details: {
      ...baseState.details,
      ...(overrides.details || {}),
    },
  };
}

function summarizeError(error) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error || "Unknown error");
}

function resolveOptionalEnvSecretValue(inlineValue, filePathValue) {
  const secretPath = String(filePathValue || "").trim();
  if (secretPath) {
    const resolvedPath = path.isAbsolute(secretPath)
      ? secretPath
      : path.resolve(process.cwd(), secretPath);

    try {
      return fs.readFileSync(resolvedPath, "utf8").trim();
    } catch (error) {
      throw new Error(
        `Failed to read desktop runtime secret file at ${resolvedPath}: ${String(error)}`
      );
    }
  }

  return String(inlineValue || "").replace(/\\n/g, "\n").trim();
}

function buildDesktopGoogleRedirectUri(baseUrl) {
  try {
    const normalizedBaseUrl = String(baseUrl || "").trim();
    if (normalizedBaseUrl) {
      return new URL(
        "/auth/callback",
        normalizedBaseUrl.endsWith("/") ? normalizedBaseUrl : `${normalizedBaseUrl}/`
      ).toString();
    }
  } catch {
  }

  return `http://${bindHost}:${port}/auth/callback`;
}

function createWorkerEnv(DB) {
  const configuredGoogleRedirectUri = String(
    process.env.GOOGLE_OAUTH_REDIRECT_URI || ""
  ).trim();
  const configuredDesktopGoogleRedirectUri = String(
    process.env.DESKTOP_GOOGLE_OAUTH_REDIRECT_URI || ""
  ).trim();
  const effectiveDesktopGoogleRedirectUri =
    configuredDesktopGoogleRedirectUri || buildDesktopGoogleRedirectUri(appBaseUrl);
  const centralAuthPublicKey = resolveOptionalEnvSecretValue(
    process.env.CENTRAL_AUTH_PUBLIC_KEY,
    process.env.CENTRAL_AUTH_PUBLIC_KEY_PATH
  );

  return {
    DB,
    R2_BUCKET,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    GOOGLE_OAUTH_REDIRECT_URI: configuredGoogleRedirectUri,
    DESKTOP_GOOGLE_OAUTH_REDIRECT_URI: effectiveDesktopGoogleRedirectUri,
    GOOGLE_GEOCODING_API_KEY: process.env.GOOGLE_GEOCODING_API_KEY || "",
    GEONAMES_USERNAME: process.env.GEONAMES_USERNAME || "",
    CHAT_V2_ENABLED: process.env.CHAT_V2_ENABLED || "",
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
    STRIPE_CHAT_PAYG_PRICE_ID: process.env.STRIPE_CHAT_PAYG_PRICE_ID || "",
    R2_PUBLIC_BASE_URL:
      process.env.R2_PUBLIC_BASE_URL || `${appBaseUrl}/media`,
    APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS || "",
    USD_TO_BRL: process.env.USD_TO_BRL || "",
    SCHEDULER_TICK_SECRET: process.env.SCHEDULER_TICK_SECRET || "",
    CENTRAL_AUTH_BASE_URL: process.env.CENTRAL_AUTH_BASE_URL || "",
    CENTRAL_AUTH_PUBLIC_KEY: centralAuthPublicKey,
    CENTRAL_AUTH_GRANT_TTL_HOURS: process.env.CENTRAL_AUTH_GRANT_TTL_HOURS || "",
    CENTRAL_AUTH_KEY_ID: process.env.CENTRAL_AUTH_KEY_ID || "",
  };
}

function resolveBundledSqliteSeedPath(brand) {
  return path.join(runtimeRoot, "bootstrap", `${brand.id}_site.seed.sqlite`);
}

async function closeDatabaseHandles() {
  sqliteDb?.close();
  sqliteDb = null;

  if (pool) {
    const activePool = pool;
    pool = null;
    await activePool.end().catch(() => {});
  }
}

function sqliteArtifactPaths(sqlitePath) {
  return [
    sqlitePath,
    `${sqlitePath}-wal`,
    `${sqlitePath}-shm`,
    `${sqlitePath}-journal`,
  ];
}

function backupSqliteArtifacts(sqlitePath, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const artifactPath of sqliteArtifactPaths(sqlitePath)) {
    if (!fs.existsSync(artifactPath)) {
      continue;
    }

    const backupPath = `${artifactPath}.${reason}.${stamp}.bak`;
    fs.renameSync(artifactPath, backupPath);
  }
}

function snapshotSqliteArtifacts(sqlitePath, reason) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const artifactPath of sqliteArtifactPaths(sqlitePath)) {
    if (!fs.existsSync(artifactPath)) {
      continue;
    }

    const backupPath = `${artifactPath}.${reason}.${stamp}.bak`;
    fs.copyFileSync(artifactPath, backupPath);
  }
}

function removeSqliteSidecars(sqlitePath) {
  for (const artifactPath of sqliteArtifactPaths(sqlitePath).slice(1)) {
    if (fs.existsSync(artifactPath)) {
      fs.rmSync(artifactPath, { force: true });
    }
  }
}

function removeSqliteArtifacts(sqlitePath) {
  for (const artifactPath of sqliteArtifactPaths(sqlitePath)) {
    if (fs.existsSync(artifactPath)) {
      fs.rmSync(artifactPath, { force: true });
    }
  }
}

function copyBundledSqliteSeed(seedPath, sqlitePath) {
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  removeSqliteSidecars(sqlitePath);
  fs.copyFileSync(seedPath, sqlitePath);
}

function sqliteEncryptionRequired() {
  return Boolean(
    sqliteEncryptionConfig && isDesktopSqliteEncryptionRequired(sqliteEncryptionConfig)
  );
}

function openSqliteForInspection(sqlitePath) {
  if (hasPlaintextSqliteHeader(sqlitePath)) {
    return new SqliteD1Database(sqlitePath);
  }

  if (!sqliteEncryptionRequired()) {
    throw new Error(
      "SQLite database appears encrypted or unreadable, but desktop encryption is disabled for this runtime."
    );
  }

  return createDesktopSqliteDatabase(sqlitePath, sqliteEncryptionConfig);
}

async function createEncryptedSqliteTempFromSource(sourcePath, tempPath) {
  if (!sqliteEncryptionRequired()) {
    throw new Error("Desktop SQLite encryption is required, but no encryption config is loaded.");
  }

  removeSqliteArtifacts(tempPath);
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.copyFileSync(sourcePath, tempPath);
  await encryptPlaintextSqliteInPlace(tempPath, sqliteEncryptionConfig);
}

async function inspectSqliteSchema(sqlitePath) {
  if (!fs.existsSync(sqlitePath)) {
    return {
      ok: false,
      missingCriticalTables: [...sqliteCriticalTables],
      tableNames: [],
      error: `SQLite database file was not found at ${sqlitePath}`,
    };
  }

  let db = null;
  try {
    db = openSqliteForInspection(sqlitePath);
    const { results = [] } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all();
    const tableNames = results
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean);
    const existingTables = new Set(tableNames.map((name) => name.toLowerCase()));
    const missingCriticalTables = sqliteCriticalTables.filter(
      (name) => !existingTables.has(name)
    );

    return {
      ok: missingCriticalTables.length === 0,
      missingCriticalTables,
      tableNames,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      missingCriticalTables: [...sqliteCriticalTables],
      tableNames: [],
      error: summarizeError(error),
    };
  } finally {
    db?.close();
  }
}

async function provisionSqliteDatabase(sqlitePath, seedPath) {
  const actions = [];
  const seedExists = fs.existsSync(seedPath);
  const encryptionRequired = sqliteEncryptionRequired();

  if (sqliteEncryptionConfigError) {
    return {
      ready: false,
      summary: sqliteEncryptionConfigError,
      details: {
        sqlitePath,
        seedPath: seedExists ? seedPath : null,
        actions,
        missingCriticalTables: [...sqliteCriticalTables],
      },
    };
  }

  if (!fs.existsSync(sqlitePath)) {
    if (!seedExists) {
      return {
        ready: false,
        summary: `Bundled SQLite seed was not found at ${seedPath}.`,
        details: {
          sqlitePath,
          seedPath,
          actions,
          missingCriticalTables: [...sqliteCriticalTables],
        },
      };
    }

    if (encryptionRequired) {
      const tempPath = `${sqlitePath}.provisioning`;
      try {
        await createEncryptedSqliteTempFromSource(seedPath, tempPath);
        removeSqliteArtifacts(sqlitePath);
        fs.renameSync(tempPath, sqlitePath);
      } catch (error) {
        removeSqliteArtifacts(tempPath);
        return {
          ready: false,
          summary: "Failed to create the encrypted local SQLite database from the bundled seed.",
          details: {
            sqlitePath,
            seedPath,
            actions,
            missingCriticalTables: [...sqliteCriticalTables],
            encryptionError: summarizeError(error),
          },
        };
      }
      actions.push("created the local SQLite database from the bundled seed");
      actions.push("encrypted the local SQLite database with the desktop installation key");
    } else {
      copyBundledSqliteSeed(seedPath, sqlitePath);
      actions.push("copied bundled SQLite seed because the local database was missing");
    }
  } else if (encryptionRequired && hasPlaintextSqliteHeader(sqlitePath)) {
    const tempPath = `${sqlitePath}.encrypting`;
    try {
      await checkpointPlaintextSqlite(sqlitePath);
      await createEncryptedSqliteTempFromSource(sqlitePath, tempPath);
      const tempInspection = await inspectSqliteSchema(tempPath);
      if (!tempInspection.ok) {
        throw new Error(
          tempInspection.error ||
            `Encrypted SQLite temp database is missing required tables: ${tempInspection.missingCriticalTables.join(", ")}`
        );
      }
      snapshotSqliteArtifacts(sqlitePath, "plaintext-backup");
      removeSqliteArtifacts(sqlitePath);
      fs.renameSync(tempPath, sqlitePath);
      actions.push("encrypted the existing local SQLite database with the desktop installation key");
    } catch (error) {
      removeSqliteArtifacts(tempPath);
      return {
        ready: false,
        summary: "Failed to migrate the existing local SQLite database to encrypted storage.",
        details: {
          sqlitePath,
          seedPath: seedExists ? seedPath : null,
          actions,
          missingCriticalTables: [...sqliteCriticalTables],
          migrationError: summarizeError(error),
        },
      };
    }
  }

  const sqliteLooksPlaintext = hasPlaintextSqliteHeader(sqlitePath);
  let inspection = await inspectSqliteSchema(sqlitePath);
  if (!inspection.ok) {
    if (!sqliteLooksPlaintext) {
      return {
        ready: false,
        summary:
          inspection.error ||
          "Encrypted SQLite database could not be opened with the current desktop key.",
        details: {
          sqlitePath,
          seedPath: seedExists ? seedPath : null,
          actions,
          missingCriticalTables: inspection.missingCriticalTables,
          inspectionError: inspection.error,
        },
      };
    }

    if (!seedExists) {
      return {
        ready: false,
        summary:
          inspection.error ||
          `SQLite database is missing required tables: ${inspection.missingCriticalTables.join(", ")}`,
        details: {
          sqlitePath,
          seedPath,
          actions,
          missingCriticalTables: inspection.missingCriticalTables,
          inspectionError: inspection.error,
        },
      };
    }

    backupSqliteArtifacts(sqlitePath, "invalid-schema");
    if (encryptionRequired) {
      const tempPath = `${sqlitePath}.reseed`;
      try {
        await createEncryptedSqliteTempFromSource(seedPath, tempPath);
        removeSqliteArtifacts(sqlitePath);
        fs.renameSync(tempPath, sqlitePath);
      } catch (error) {
        removeSqliteArtifacts(tempPath);
        return {
          ready: false,
          summary: "Failed to rebuild the encrypted local SQLite database from the bundled seed.",
          details: {
            sqlitePath,
            seedPath,
            actions,
            missingCriticalTables: inspection.missingCriticalTables,
            inspectionError: inspection.error,
            encryptionError: summarizeError(error),
          },
        };
      }
    } else {
      copyBundledSqliteSeed(seedPath, sqlitePath);
    }
    actions.push(
      "replaced the local SQLite database with the bundled seed after schema validation failed"
    );
    if (encryptionRequired) {
      actions.push("encrypted the rebuilt local SQLite database with the desktop installation key");
    }
    inspection = await inspectSqliteSchema(sqlitePath);
  }

  if (!inspection.ok) {
    return {
      ready: false,
      summary:
        inspection.error ||
        `SQLite database is still missing required tables: ${inspection.missingCriticalTables.join(", ")}`,
      details: {
        sqlitePath,
        seedPath,
        actions,
        missingCriticalTables: inspection.missingCriticalTables,
        inspectionError: inspection.error,
      },
    };
  }

  return {
    ready: true,
    summary:
      actions.length > 0
        ? "SQLite database prepared for the local runtime."
        : "SQLite database schema already available.",
    details: {
      sqlitePath,
      seedPath: seedExists ? seedPath : null,
      actions,
      tableCount: inspection.tableNames.length,
      sqliteEncryption:
        sqliteEncryptionConfig?.mode || (sqliteEncryptionConfigError ? "invalid" : "off"),
    },
  };
}

async function warmWorkerBootstrap(env) {
  const response = await invokeWorkerFetch(
    `${appBaseUrl}/api/auth/me`,
    "GET",
    new Headers({
      accept: "application/json",
    }),
    undefined,
    env
  );

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  throw new Error(
    `Worker warm-up failed with HTTP ${response.status}${
      body ? `: ${body.trim()}` : ""
    }`
  );
}

async function initializeRuntimeState() {
  if (databaseBackend === "sqlite") {
    const sqlitePath = resolveDefaultSqlitePath(activeBrand, storageRoot);
    const seedPath = resolveBundledSqliteSeedPath(activeBrand);
    const provision = await provisionSqliteDatabase(sqlitePath, seedPath);

    if (!provision.ready) {
      return createRuntimeState({
        fatal: true,
        summary: provision.summary,
        details: provision.details,
      });
    }

    try {
      const DB = await createDatabase(sqlitePath);
      const env = createWorkerEnv(DB);
      await warmWorkerBootstrap(env);

      return createRuntimeState({
        ready: true,
        summary: provision.summary,
        details: provision.details,
        env,
      });
    } catch (error) {
      await closeDatabaseHandles();
      return createRuntimeState({
        fatal: true,
        summary: "SQLite database is present, but backend warm-up failed.",
        details: {
          ...provision.details,
          warmupError: summarizeError(error),
        },
      });
    }
  }

  try {
    const DB = await createDatabase();
    const env = createWorkerEnv(DB);
    await warmWorkerBootstrap(env);
    return createRuntimeState({
      ready: true,
      summary: "Backend warm-up completed successfully.",
      env,
    });
  } catch (error) {
    await closeDatabaseHandles();
    return createRuntimeState({
      fatal: true,
      summary: "Backend warm-up failed.",
      details: {
        warmupError: summarizeError(error),
      },
    });
  }
}

async function createDatabase(sqlitePathOverride = null) {
  if (databaseBackend === "sqlite") {
    const sqlitePath =
      sqlitePathOverride || resolveDefaultSqlitePath(activeBrand, storageRoot);
    sqliteDb = createDesktopSqliteDatabase(
      sqlitePath,
      sqliteEncryptionConfig || resolveDesktopSqliteEncryptionConfig(process.env)
    );
    console.log(
      `[desktop-server] SQLite database: ${sqlitePath} (encryption=${sqliteEncryptionConfig?.mode || "off"})`
    );
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
  runtimeState = await initializeRuntimeState();
  if (runtimeState.ready) {
    console.log(`[desktop-server] preflight ready: ${runtimeState.summary}`);
  } else {
    console.error(`[desktop-server] preflight failed: ${runtimeState.summary}`);
    if (runtimeState.details?.warmupError) {
      console.error(runtimeState.details.warmupError);
    }
  }

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("Bad Request");
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === runtimeHealthRoute) {
      writeJson(res, runtimeState.ready ? 200 : runtimeState.fatal ? 503 : 202, {
        ready: runtimeState.ready,
        fatal: runtimeState.fatal,
        summary: runtimeState.summary,
        details: runtimeState.details,
      });
      return;
    }

    if (url.pathname === "/api/auth/country" && req.method === "GET") {
      writeJson(res, 200, {
        detectedCountryCode: detectCountryFromHeaders(req),
      });
      return;
    }

    if (url.pathname === "/api/runtime/local-session" && req.method === "POST") {
      if (!runtimeState.ready || !runtimeState.env) {
        writeRuntimeUnavailable(res, url.pathname);
        return;
      }

      await handleRuntimeLocalSession(req, res, runtimeState.env);
      return;
    }

    if (url.pathname === "/api/runtime/camera-discovery" && req.method === "POST") {
      await handleCameraDiscovery(req, res);
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

    if (!runtimeState.ready || !runtimeState.env) {
      writeRuntimeUnavailable(res, url.pathname);
      return;
    }

    const response = await proxyWorkerRequest(req, url, runtimeState.env);
    await writeWorkerResponse(res, response);
  });

  server.on("upgrade", (_req, socket) => {
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  server.listen(port, bindHost, () => {
    console.log(
      `[desktop-server] brand=${activeBrand.id} profile=${runtimeProfile} backend=${databaseBackend} listening on http://${bindHost}:${port} static=${staticRoot || "<none>"} sessionDir=${serviceSessionDir} health=${runtimeState.ready ? "ready" : "error"}`
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

async function handleCameraDiscovery(req, res) {
  let body = {};

  try {
    body = await readJsonBody(req);
  } catch (error) {
    writeJson(res, 400, {
      error:
        error instanceof Error ? error.message : "Invalid JSON body for camera discovery.",
    });
    return;
  }

  try {
    if (!activeCameraDiscoveryPromise) {
      activeCameraDiscoveryPromise = discoverCameraDevices(body).finally(() => {
        activeCameraDiscoveryPromise = null;
      });
    }

    const payload = await activeCameraDiscoveryPromise;
    writeJson(res, 200, payload);
  } catch (error) {
    console.error("[desktop-server] camera discovery failed", error);
    writeJson(res, 500, {
      error:
        error instanceof Error ? error.message : "Failed to scan the local network for cameras.",
    });
  }
}

function resolveOrCreateExeId(candidate) {
  const direct = typeof candidate === "string" ? candidate.trim() : "";
  if (direct) {
    cachedExeId = direct;
    return direct;
  }

  if (cachedExeId) {
    return cachedExeId;
  }

  cachedExeId = `desktop-${Date.now()}`;
  return cachedExeId;
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

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function detectCountryFromHeaders(req) {
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

function writeRuntimeUnavailable(res, pathname) {
  writeJson(res, 503, {
    error: runtimeState.summary,
    ready: runtimeState.ready,
    fatal: runtimeState.fatal,
    path: pathname,
    details: runtimeState.details,
  });
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
  await closeDatabaseHandles();
  process.exit(1);
});

process.on("exit", () => {
  sqliteDb?.close();
  sqliteDb = null;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    try {
      await closeDatabaseHandles();
    } finally {
      process.exit(0);
    }
  });
}

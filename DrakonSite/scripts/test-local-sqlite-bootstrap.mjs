#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForHttp(url, childState, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (childState.exited) {
      throw new Error(`Local server exited before ${url} was ready: ${childState.exitSummary}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the local server is listening.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  const text = await response.text();
  return { status: response.status, text };
}

function parseJson(text, path) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON: ${text.slice(0, 200)}`);
  }
}

function extractCookieHeader(response) {
  const rawCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return rawCookies.map((value) => String(value).split(";")[0]).filter(Boolean).join("; ");
}

async function fetchJsonWithCookie(baseUrl, path, cookieHeader, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
  });
  const text = await response.text();
  return {
    response,
    text,
    json: parseJson(text, path),
  };
}

function hashExeToken(token) {
  return createHash("sha256")
    .update(`${token}mocha-exe-pairing-salt-v1`)
    .digest("hex");
}

function seedAgentPairing(sqlitePath) {
  const db = new DatabaseSync(sqlitePath);
  const now = new Date().toISOString();
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `INSERT INTO app_users (
         id,
         email,
         auth_provider,
         country_code,
         created_at,
         updated_at
       ) VALUES (?, ?, 'local', 'BR', ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    ).run("test-user", "local-agent-test@example.invalid", now, now);
    db.prepare(
      `INSERT INTO exe_pairings (
         user_id,
         client_id,
         exe_id,
         exe_token_hash,
         paired_at,
         last_seen_at,
         status,
         timezone_iana,
         timezone_updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'connected', 'America/Manaus', ?)
       ON CONFLICT(user_id, client_id) DO UPDATE SET
         exe_id = excluded.exe_id,
         exe_token_hash = excluded.exe_token_hash,
         last_seen_at = excluded.last_seen_at,
         status = 'connected',
         timezone_iana = excluded.timezone_iana,
         timezone_updated_at = excluded.timezone_updated_at`
    ).run(
      "test-user",
      "test-client",
      "test-exe",
      hashExeToken("test-token"),
      now,
      now,
      now
    );
  } finally {
    db.close();
  }
}

function readAgentIngressQueue(sqlitePath) {
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return db
      .prepare(
        `SELECT user_id,
                client_id,
                exe_id,
                request_path,
                request_body,
                content_type
           FROM agent_capture_metrics_inbox_latest
          WHERE user_id = ? AND client_id = ?
          LIMIT 1`
      )
      .get("test-user", "test-client");
  } finally {
    db.close();
  }
}

function readSqliteSchemaObjects(sqlitePath, names) {
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return Object.fromEntries(
      names.map((name) => [
        name,
        db
          .prepare(
            `SELECT type, name
               FROM sqlite_master
              WHERE name = ?
              LIMIT 1`
          )
          .get(name),
      ])
    );
  } finally {
    db.close();
  }
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Best effort cleanup.
    }
  }
}

async function main() {
  const tempRoot = await mkdtemp(join(tmpdir(), "perceptrum-sqlite-bootstrap-"));
  const storageRoot = join(tempRoot, "storage");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tsxCli = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const childState = { exited: false, exitSummary: "" };
  let logs = "";
  let child = null;

  try {
    child = spawn(
      process.execPath,
      [tsxCli, "--tsconfig", "tsconfig.worker.json", "server/index.ts"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          APP_BASE_URL: baseUrl,
          APP_DB_BACKEND: "sqlite",
          APP_STATIC_ROOT: "",
          LOCAL_DB_BACKEND: "sqlite",
          NODE_ENV: "test",
          PORT: String(port),
          SQLITE_DB_PATH: "",
          STORAGE_ROOT: storageRoot,
          LOCAL_AGENT_INGEST_MODE: "on",
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      }
    );

    child.stdout.on("data", (chunk) => {
      logs += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      logs += chunk.toString();
    });
    child.on("exit", (code, signal) => {
      childState.exited = true;
      childState.exitSummary = `code=${code} signal=${signal}`;
    });

    await waitForHttp(`${baseUrl}/__perceptrum/health`, childState, 30000);

    const sqliteLine = logs
      .split(/\r?\n/)
      .find((line) => line.includes("[local-server] SQLite database:"));
    assert(sqliteLine, `Server did not log the SQLite database path.\n${logs}`);

    const sqlitePath = sqliteLine.split("SQLite database:").pop()?.trim() || "";
    assert(sqlitePath, `Could not parse SQLite database path from: ${sqliteLine}`);

    if (process.platform !== "win32") {
      const resolvedSqlitePath = resolve(sqlitePath);
      const resolvedStorageRoot = resolve(storageRoot);
      assert(
        resolvedSqlitePath === resolvedStorageRoot ||
          resolvedSqlitePath.startsWith(`${resolvedStorageRoot}${sep}`),
        `SQLite default path must stay under STORAGE_ROOT on Linux. Got ${sqlitePath}`
      );
      assert(
        !/[A-Za-z]:\\/.test(sqlitePath),
        `SQLite default path must not use a Windows drive on Linux. Got ${sqlitePath}`
      );
      assert(existsSync(sqlitePath), `SQLite database was not created at ${sqlitePath}`);
    }

    const auth = await fetchText(`${baseUrl}/api/auth/me`);
    assert(auth.status === 200, `/api/auth/me expected 200, got ${auth.status}: ${auth.text}`);
    const authJson = parseJson(auth.text, "/api/auth/me");
    assert(
      authJson?.isAuthenticated === false,
      `/api/auth/me expected unauthenticated JSON, got ${auth.text}`
    );

    const runtimeHealth = await fetchText(`${baseUrl}/api/runtime/health`);
    assert(
      runtimeHealth.status === 200,
      `/api/runtime/health expected 200, got ${runtimeHealth.status}: ${runtimeHealth.text}`
    );
    const runtimeHealthJson = parseJson(runtimeHealth.text, "/api/runtime/health");
    assert(
      runtimeHealthJson?.ready === true &&
        runtimeHealthJson?.fatal === false &&
        runtimeHealthJson?.details?.backend === "sqlite",
      `/api/runtime/health returned unexpected payload: ${runtimeHealth.text}`
    );
    assert(
      !runtimeHealth.text.includes("test-token") && !runtimeHealth.text.includes("SECRET"),
      "/api/runtime/health must not expose local secrets"
    );

    const countryResponse = await fetch(`${baseUrl}/api/auth/country`, {
      headers: {
        "x-country-code": "BR",
      },
    }).catch((error) => {
      throw new Error(
        `/api/auth/country request failed: ${
          error instanceof Error ? error.stack || error.message : String(error)
        }\n${logs}`
      );
    });
    const countryText = await countryResponse.text();
    assert(
      countryResponse.status === 200,
      `/api/auth/country expected 200, got ${countryResponse.status}: ${countryText}`
    );
    const countryJson = parseJson(countryText, "/api/auth/country");
    assert(
      countryJson?.detectedCountryCode === "BR",
      `/api/auth/country returned unexpected payload: ${countryText}`
    );

    const protectedPaths = [
      "/api/dashboard",
      "/api/cameras",
      "/api/events",
      "/api/chat/sessions",
      "/api/jobs",
      "/api/openai-settings",
      "/api/pairing/status",
    ];

    for (const path of protectedPaths) {
      const response = await fetchText(`${baseUrl}${path}`);
      assert(
        response.status === 401,
        `${path} expected 401 for anonymous user, got ${response.status}: ${response.text}`
      );
      assert(
        !response.text.includes("Local backend request failed"),
        `${path} hit the local server worker error fallback.`
      );
    }

    seedAgentPairing(sqlitePath);
    const agentIngressResponse = await fetch(
      `${baseUrl}/api/agent/capture-thread-metrics?client_id=test-client`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          samples: [
            {
              camera_id: 7,
              thread_name: "capture-main",
              cpu_percent: 12.5,
              capture_mem_estimated_bytes: 123456,
              sampled_at: "2026-05-25T12:00:00.000Z",
            },
          ],
        }),
      }
    );
    const agentIngressText = await agentIngressResponse.text();
    assert(
      agentIngressResponse.status === 202,
      `/api/agent/capture-thread-metrics expected queued 202, got ${agentIngressResponse.status}: ${agentIngressText}`
    );
    const agentIngressJson = parseJson(agentIngressText, "/api/agent/capture-thread-metrics");
    assert(
      agentIngressJson?.ok === true && agentIngressJson?.queued === true,
      `/api/agent/capture-thread-metrics returned unexpected payload: ${agentIngressText}`
    );
    const queuedIngress = readAgentIngressQueue(sqlitePath);
    assert(queuedIngress, "Local agent ingress request was not persisted to SQLite.");
    assert(
      queuedIngress.user_id === "test-user" &&
        queuedIngress.client_id === "test-client" &&
        queuedIngress.exe_id === "test-exe",
      `Queued local agent ingress used the wrong pairing context: ${JSON.stringify(queuedIngress)}`
    );
    assert(
      String(queuedIngress.request_path || "").startsWith(
        "/api/agent/capture-thread-metrics?client_id=test-client"
      ),
      `Queued local agent ingress stored the wrong request path: ${queuedIngress.request_path}`
    );
    assert(
      !JSON.stringify(queuedIngress).includes("test-token"),
      "Queued local agent ingress must not persist bearer tokens."
    );

    const schemaObjects = readSqliteSchemaObjects(sqlitePath, [
      "account_memberships",
      "account_membership_resource_grants",
      "idx_account_membership_resource_grants_member_type",
      "idx_account_membership_resource_grants_type_resource",
      "workspace_access_settings",
      "idx_workspace_access_settings_user",
      "shared_find_cameras_cache",
      "shared_find_invitations_cache",
      "idx_shared_find_cameras_cache_user_scope",
      "idx_shared_find_invitations_cache_user_direction_status",
    ]);
    for (const [name, row] of Object.entries(schemaObjects)) {
      assert(row, `SQLite bootstrap did not create required workspace/access schema object: ${name}`);
    }

    const signupResponse = await fetch(`${baseUrl}/api/auth/local/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: "workspace-local@example.invalid",
        password: "workspace-local-password",
        country_code: "BR",
      }),
    });
    const signupText = await signupResponse.text();
    assert(
      signupResponse.status === 201,
      `/api/auth/local/signup expected 201, got ${signupResponse.status}: ${signupText}`
    );
    const cookieHeader = extractCookieHeader(signupResponse);
    assert(cookieHeader, "Local signup did not return an auth cookie.");

    const accountUsers = await fetchJsonWithCookie(baseUrl, "/api/account-users", cookieHeader, {
      headers: {
        accept: "application/json",
      },
    });
    assert(
      accountUsers.response.status === 200,
      `/api/account-users expected 200, got ${accountUsers.response.status}: ${accountUsers.text}`
    );
    assert(
      Array.isArray(accountUsers.json.users) &&
        accountUsers.json.users.some((user) => user.is_owner === true),
      `/api/account-users did not return the local owner membership: ${accountUsers.text}`
    );
    assert(
      accountUsers.json.resource_catalog &&
        Array.isArray(accountUsers.json.resource_catalog.cameras) &&
        Array.isArray(accountUsers.json.resource_catalog.jobs) &&
        Array.isArray(accountUsers.json.resource_catalog.agents),
      `/api/account-users did not include the local resource catalog: ${accountUsers.text}`
    );

    const workspaceSettings = await fetchJsonWithCookie(
      baseUrl,
      "/api/desktop-workspace-access/settings",
      cookieHeader
    );
    assert(
      workspaceSettings.response.status === 200 &&
        workspaceSettings.json.settings?.connection_policy === "allow_while_open",
      `/api/desktop-workspace-access/settings returned unexpected payload: ${workspaceSettings.text}`
    );

    for (const path of [
      "/api/desktop-workspace-access/invites/incoming",
      "/api/desktop-workspace-access/invites/outgoing",
    ]) {
      const result = await fetchJsonWithCookie(baseUrl, path, cookieHeader);
      assert(result.response.status === 200, `${path} expected 200, got ${result.response.status}: ${result.text}`);
      assert(Array.isArray(result.json.invites), `${path} did not return an invites array: ${result.text}`);
      assert(result.json.degraded === true, `${path} should report local degraded state without central auth: ${result.text}`);
      assert(!result.text.includes("workspace-local-password"), `${path} leaked a local auth secret.`);
    }

    const availableWorkspaces = await fetchJsonWithCookie(
      baseUrl,
      "/api/desktop-workspace-access/available",
      cookieHeader
    );
    assert(
      availableWorkspaces.response.status === 200 &&
        Array.isArray(availableWorkspaces.json.accesses) &&
        availableWorkspaces.json.degraded === true,
      `/api/desktop-workspace-access/available did not return degraded empty state: ${availableWorkspaces.text}`
    );

    const activeSessions = await fetchJsonWithCookie(
      baseUrl,
      "/api/desktop-workspace-access/active-sessions",
      cookieHeader
    );
    assert(
      activeSessions.response.status === 200 &&
        Array.isArray(activeSessions.json.sessions) &&
        activeSessions.json.degraded === true,
      `/api/desktop-workspace-access/active-sessions did not return degraded empty state: ${activeSessions.text}`
    );

    const pendingRequests = await fetchJsonWithCookie(
      baseUrl,
      "/api/desktop-workspace-access/pending-requests",
      cookieHeader
    );
    assert(
      pendingRequests.response.status === 200 && Array.isArray(pendingRequests.json.requests),
      `/api/desktop-workspace-access/pending-requests returned unexpected payload: ${pendingRequests.text}`
    );

    const workspaceCatalog = await fetchJsonWithCookie(
      baseUrl,
      "/api/desktop-workspace-access/resource-catalog",
      cookieHeader
    );
    assert(
      workspaceCatalog.response.status === 200 &&
        Array.isArray(workspaceCatalog.json.resource_catalog?.cameras) &&
        Array.isArray(workspaceCatalog.json.resource_catalog?.jobs) &&
        Array.isArray(workspaceCatalog.json.resource_catalog?.agents),
      `/api/desktop-workspace-access/resource-catalog returned unexpected payload: ${workspaceCatalog.text}`
    );

    const workspaceHeartbeat = await fetchJsonWithCookie(
      baseUrl,
      "/api/desktop-workspace-access/heartbeat",
      cookieHeader,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          app_instance_id: "sqlite-bootstrap-test",
        }),
      }
    );
    assert(
      workspaceHeartbeat.response.status === 200 &&
        workspaceHeartbeat.json.degraded === true &&
        workspaceHeartbeat.json.remote?.relay_available === false,
      `/api/desktop-workspace-access/heartbeat did not report relay unavailable degraded state: ${workspaceHeartbeat.text}`
    );
    assert(
      !workspaceHeartbeat.text.includes("workspace-local-password") &&
        !workspaceHeartbeat.text.includes(cookieHeader),
      "/api/desktop-workspace-access/heartbeat leaked local credentials."
    );

    assert(!childState.exited, `Local server exited during bootstrap test: ${childState.exitSummary}`);
    assert(
      !logs.includes("[local-server] worker request failed"),
      `Worker request failed during SQLite bootstrap test.\n${logs}`
    );

    console.log("Local SQLite bootstrap OK.");
  } finally {
    stopProcess(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  if (error instanceof Error && error.cause) {
    console.error("Cause:", error.cause);
  }
  process.exit(1);
});

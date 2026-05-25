#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
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
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

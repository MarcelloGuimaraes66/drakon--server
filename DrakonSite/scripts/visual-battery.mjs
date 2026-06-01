#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const workspaceRoot = resolve(projectRoot, "..");
const artifactsRoot = resolve(projectRoot, "visual-artifacts");

const transparentPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lvCMGQAAAABJRU5ErkJggg==";

function readArg(name, fallback = null) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function splitList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync("sh", ["-lc", `command -v ${candidate}`], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      const resolvedPath = result.stdout.trim();
      if (resolvedPath) return resolvedPath;
    }
  }
  return null;
}

function chooseFreePort(base) {
  return base + Math.floor(Math.random() * 1000);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startVite(port) {
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));

  await waitForHttp(`http://127.0.0.1:${port}`, 30000);
  return child;
}

async function startChrome(debugPort, width, height) {
  const chromePath =
    process.env.CHROME_PATH ||
    findExecutable(["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]);
  if (!chromePath) {
    throw new Error("Chrome/Chromium was not found. Set CHROME_PATH to run visual screenshots.");
  }

  const userDataDir = resolve(projectRoot, ".visual-chrome-profile");
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });

  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-extensions-with-background-pages",
      "--disable-extensions",
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }
  );

  child.stderr.on("data", (chunk) => process.stderr.write(`[chrome] ${chunk}`));
  child.userDataDir = userDataDir;
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 15000);
  return child;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.waiters = new Map();

    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : event.data.toString();
      const message = JSON.parse(text);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: resolvePending, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolvePending(message.result || {});
        return;
      }

      const handlers = this.handlers.get(message.method) || [];
      handlers.forEach((handler) => handler(message.params || {}));

      const waiters = this.waiters.get(message.method) || [];
      if (waiters.length > 0) {
        this.waiters.delete(message.method);
        waiters.forEach((waiter) => waiter(message.params || {}));
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolvePending, reject) => {
      this.pending.set(id, { resolve: resolvePending, reject });
      this.socket.send(payload);
    });
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  waitFor(method, timeoutMs) {
    return new Promise((resolveWaiter, reject) => {
      const waiters = this.waiters.get(method) || [];
      waiters.push(resolveWaiter);
      this.waiters.set(method, waiters);
      setTimeout(() => reject(new Error(`Timed out waiting for CDP event ${method}`)), timeoutMs);
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Best effort.
    }
  }
}

async function connectCdp(webSocketDebuggerUrl) {
  if (typeof WebSocket === "undefined") {
    throw new Error("This Node runtime does not expose WebSocket. Use Node 22+.");
  }

  return new Promise((resolveConnect, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    socket.addEventListener("open", () => resolveConnect(new CdpClient(socket)));
    socket.addEventListener("error", () => reject(new Error("Failed to connect to Chrome CDP.")));
  });
}

async function createPage(debugPort) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(`Failed to create Chrome target: HTTP ${response.status}`);
  }
  const target = await response.json();
  return connectCdp(target.webSocketDebuggerUrl);
}

const now = new Date().toISOString();
const fixtureCameras = [
  {
    id: 1,
    name: "Front Gate",
    ip_address: "192.168.10.21",
    manufacturer: "Perceptrum Lab",
    description: "Primary entry camera",
    is_service_running: 1,
    is_online: 1,
    thumbnail_url: null,
  },
  {
    id: 2,
    name: "Warehouse Aisle",
    ip_address: "192.168.10.42",
    manufacturer: "Perceptrum Lab",
    description: "Inventory corridor",
    is_service_running: 0,
    is_online: 0,
    thumbnail_url: null,
  },
  {
    id: 3,
    name: "Shared Loading Dock",
    ip_address: "remote-workspace",
    manufacturer: "Shared Find",
    description: "Camera shared from another workspace",
    is_service_running: 0,
    is_online: 1,
    thumbnail_url: null,
    origin_type: "shared_find",
    shared_status: "accepted",
    shared_permission_profile: "find_only",
    shared_owner_display_label: "North Plant",
    shared_owner_handle: "north-plant",
    shared_owner_email: "owner@example.test",
    shared_origin_brand_id: "perceptrum",
  },
];

const fixtureResourceCatalog = {
  cameras: fixtureCameras.map((camera) => ({
    id: camera.id,
    name: camera.name,
    description: camera.description,
    is_service_running: Boolean(camera.is_service_running),
    is_online: Boolean(camera.is_online),
    updated_at: now,
  })),
  jobs: [
    {
      id: 11,
      name: "After-hours guard",
      status: "running",
      schedule_mode: "nightly",
      step_count: 2,
      updated_at: now,
    },
  ],
  agents: [
    {
      key: "camera_algorithm:1",
      agent_kind: "camera_algorithm",
      agent_id: 1,
      display_name: "Person detection",
      summary: "Detects people near entry zones",
      parent_camera_id: 1,
      parent_camera_name: "Front Gate",
      is_active: true,
      updated_at: now,
    },
  ],
};

const fixtureWorkspacePermissions = {
  view_cameras: true,
  execute_cameras: true,
  view_tasks: true,
  execute_tasks: false,
  view_agents: true,
  execute_agents: false,
};

const fixtureWorkspaceResourceScopes = {
  cameras: { view: "all", execute: "selected" },
  jobs: { view: "all", execute: "selected" },
  agents: { view: "all", execute: "selected" },
};

const fixtureWorkspaceResourceGrants = {
  cameras: { viewIds: [], executeIds: [1] },
  jobs: { viewIds: [], executeIds: [] },
  agents: { viewIds: [], executeIds: [] },
};

const fixtureAccountUsers = [
  {
    member_user_id: "visual-user",
    account_user_id: "account-owner",
    email: "visual@example.test",
    role: "owner",
    status: "active",
    password_management_mode: "self_service",
    is_owner: true,
    is_admin: true,
    can_manage_settings: true,
    full_access: true,
    permissions: {
      ...fixtureWorkspacePermissions,
      execute_tasks: true,
      execute_agents: true,
      chat: true,
    },
    resource_scopes: fixtureWorkspaceResourceScopes,
    resource_grants: fixtureWorkspaceResourceGrants,
    created_at: now,
    updated_at: now,
  },
  {
    member_user_id: "visual-member",
    account_user_id: "account-member",
    email: "operator@example.test",
    role: "member",
    status: "active",
    password_management_mode: "admin_managed",
    is_owner: false,
    is_admin: false,
    can_manage_settings: false,
    full_access: false,
    permissions: {
      ...fixtureWorkspacePermissions,
      chat: true,
    },
    resource_scopes: fixtureWorkspaceResourceScopes,
    resource_grants: fixtureWorkspaceResourceGrants,
    created_at: now,
    updated_at: now,
  },
];

function dashboardFixture() {
  return {
    cameras: fixtureCameras,
    unreadCount: 0,
    tokenBalance: {
      user_id: "visual-user",
      balance: 120000,
      input_balance: 80000,
      output_balance: 40000,
      total_spent: 0,
    },
    tokenUsageMonth: {
      timezone_iana: "America/Manaus",
      local_month: "2026-05",
      local_month_start: "2026-05-01T00:00:00-04:00",
      next_local_month_start: "2026-06-01T00:00:00-04:00",
      start_utc: "2026-05-01T04:00:00Z",
      end_utc: "2026-06-01T04:00:00Z",
      input_tokens: 18000,
      output_tokens: 9000,
      total_tokens: 27000,
    },
    dashboard: {
      stats: {
        cameras_total: 3,
        cameras_running: 1,
        cameras_online: 1,
        agents_enabled_total: 3,
        detections_24h_total: 4,
        unread_alerts: 0,
        pending_commands: 0,
        last_event_id: 10,
        last_detection_at: now,
        last_job_fire_at: now,
        jobs_total: 1,
        jobs_running: 0,
        steps_running: 0,
      },
      perCamera: {
        1: {
          enabled_agents_count: 2,
          enabled_agents_types: ["person", "vehicle"],
          enabled_agents: [],
          last_started_at: now,
          last_error_at: null,
          detections_24h: 3,
          last_detected_at: now,
        },
        2: {
          enabled_agents_count: 1,
          enabled_agents_types: ["object"],
          enabled_agents: [],
          last_started_at: null,
          last_error_at: null,
          detections_24h: 1,
          last_detected_at: now,
        },
      },
      jobs: {
        recentFires: [],
        recentCommands: [],
        runningJobs: [],
        stepLogs: {},
        runningJobSteps: {},
        scheduledJobs: [],
      },
      activity: {
        recentEvents: [],
        recentDetections: [],
        recentAlerts: [],
      },
      captureThreads: [],
      runningJobTargets: {},
      desktopRuntime: {
        pairing: {
          status: "connected",
          effective_status: "connected",
          chat_effective_status: "connected",
          is_available_for_chat: true,
          is_heartbeat_fresh: true,
          client_id: "visual-client",
          exe_id: "visual-exe",
          paired_at: now,
          last_seen_at: now,
          last_seen_age_seconds: 2,
        },
        process: null,
      },
      etagHints: {
        camerasUpdatedAtMax: 1,
        camerasCount: 3,
        camerasDigest: "visual",
        lastEventId: 10,
        lastDetectionId: 5,
        lastJobFireId: 1,
        pendingCommandsCount: 0,
        unreadCount: 0,
        inputBalance: 80000,
        outputBalance: 40000,
        monthlyUsageLocalMonth: "2026-05",
        monthlyUsageInputTokens: 18000,
        monthlyUsageOutputTokens: 9000,
        jobsUpdatedAtMax: 1,
        captureMetricsUpdatedAtMax: 1,
      },
    },
  };
}

function jsonForApi(pathname, theme) {
  if (pathname === "/api/auth/me") {
    return {
      isAuthenticated: true,
      user: {
        id: "visual-user",
        email: "visual@example.test",
        handle: "visual",
        auth_provider: "local",
        requires_secret_recovery_setup: false,
        secret_recovery_configured: true,
        account_access: {
          account_user_id: "account-owner",
          actor_user_id: "visual-user",
          role: "owner",
          status: "active",
          is_owner: true,
          is_admin: true,
          can_manage_settings: true,
          full_access: true,
          permissions: {
            ...fixtureWorkspacePermissions,
            execute_tasks: true,
            execute_agents: true,
            chat: true,
          },
          resource_scopes: fixtureWorkspaceResourceScopes,
        },
      },
    };
  }
  if (pathname === "/api/preferences") return { theme, language: "en" };
  if (pathname === "/api/dashboard") return dashboardFixture();
  if (pathname === "/api/cameras") return fixtureCameras;
  if (pathname === "/api/jobs") return { jobs: [] };
  if (pathname.startsWith("/api/jobs/") && pathname.endsWith("/steps")) return { steps: [] };
  if (pathname.startsWith("/api/job-steps/") && pathname.endsWith("/targets")) return { targets: [] };
  if (pathname.startsWith("/api/job-steps/") && pathname.endsWith("/agents")) return { agents: [] };
  if (pathname.startsWith("/api/job-steps/") && pathname.endsWith("/alerts")) return { alerts: [] };
  if (pathname === "/api/chat/sessions") {
    return [
      {
        id: 1,
        title: "Visual smoke session",
        created_at: now,
        updated_at: now,
      },
    ];
  }
  if (pathname === "/api/chat/sessions/1/messages") {
    return [
      {
        id: 1,
        role: "assistant",
        content: "Visual smoke fixture: dashboard and camera context are available.",
        created_at: now,
      },
    ];
  }
  if (pathname === "/api/pairing/status") {
    return {
      paired: true,
      provisioned: true,
      status: "connected",
      effective_status: "connected",
      timezone_iana: "America/Manaus",
      client_id: "visual-client",
      exe_id: "visual-exe",
    };
  }
  if (pathname === "/api/notifications") return { notifications: [], unreadCount: 0 };
  if (pathname === "/api/events") return [];
  if (pathname === "/api/detections") return [];
  if (pathname === "/api/openai-settings") return { has_key: true, masked_key: "sk-visual" };
  if (pathname === "/api/zai-settings") return { has_key: true, masked_key: "zai-visual" };
  if (pathname === "/api/telegram-settings") return {};
  if (pathname === "/api/user-profile") return { handle: "visual", country_code: "US" };
  if (pathname === "/api/account/deletion-preview") return { can_delete: true, counts: {} };
  if (pathname === "/api/billing/status") return { active: true, plan: "visual" };
  if (pathname === "/api/payments") return [];
  if (pathname === "/api/subscriptions/me") return null;
  if (pathname === "/api/drakon-find/targets") return { targets: [] };
  if (pathname === "/api/drakon-find/searches") return { searches: [] };
  if (pathname === "/api/drakon-find/audit") return { audit: [] };
  if (pathname === "/api/drakon-find/hits") return { hits: [] };
  if (pathname === "/api/shared-find/sync") return { ok: true };
  if (pathname === "/api/shared-find/incoming") {
    return {
      invitations: [
        {
          id: 21,
          camera_id: 3,
          camera_name: "Shared Loading Dock",
          owner_handle: "north-plant",
          owner_email: "owner@example.test",
          status: "accepted",
          permission_profile: "find_only",
          created_at: now,
          updated_at: now,
        },
      ],
    };
  }
  if (pathname === "/api/shared-find/outgoing") return { invitations: [] };
  if (pathname === "/api/shared-find/cameras") return { cameras: [fixtureCameras[2]] };
  if (pathname === "/api/account-users") {
    return {
      success: true,
      actor_user_id: "visual-user",
      account_user_id: "account-owner",
      role: "owner",
      users: fixtureAccountUsers,
      can_assign_admin: true,
      resource_catalog: fixtureResourceCatalog,
    };
  }
  if (pathname === "/api/desktop-workspace-access/settings") {
    return { settings: { connection_policy: "allow_while_open" } };
  }
  if (pathname === "/api/desktop-workspace-access/invites/incoming") {
    return {
      invites: [
        {
          id: 101,
          permission_profile: "shared_job_execution",
          full_access: false,
          permissions: fixtureWorkspacePermissions,
          resource_scopes: fixtureWorkspaceResourceScopes,
          resource_grants: fixtureWorkspaceResourceGrants,
          status: "pending",
          owner_handle: "north-plant",
          owner_email: "owner@example.test",
          invitee_handle: "visual",
          invitee_email: "visual@example.test",
          created_at: now,
          updated_at: now,
        },
      ],
    };
  }
  if (pathname === "/api/desktop-workspace-access/invites/outgoing") {
    return {
      invites: [
        {
          id: 102,
          permission_profile: "find_only",
          full_access: false,
          permissions: fixtureWorkspacePermissions,
          resource_scopes: fixtureWorkspaceResourceScopes,
          resource_grants: fixtureWorkspaceResourceGrants,
          status: "accepted",
          owner_handle: "visual",
          owner_email: "visual@example.test",
          invitee_handle: "remote-operator",
          invitee_email: "operator@example.test",
          created_at: now,
          updated_at: now,
        },
      ],
    };
  }
  if (pathname === "/api/desktop-workspace-access/available") {
    return {
      accesses: [
        {
          id: 103,
          permission_profile: "shared_job_execution",
          full_access: false,
          permissions: fixtureWorkspacePermissions,
          resource_scopes: fixtureWorkspaceResourceScopes,
          resource_grants: fixtureWorkspaceResourceGrants,
          status: "accepted",
          owner_handle: "north-plant",
          owner_email: "owner@example.test",
          invitee_handle: "visual",
          invitee_email: "visual@example.test",
          owner_online: true,
          owner_last_seen_at: now,
          owner_connection_policy: "allow_while_open",
          display_label: "North Plant",
          created_at: now,
          updated_at: now,
        },
      ],
    };
  }
  if (pathname === "/api/desktop-workspace-access/resource-catalog") {
    return { resource_catalog: fixtureResourceCatalog };
  }
  if (pathname === "/api/hub/cache/items") return { items: [] };
  if (pathname === "/api/hub/cache/sync") return { ok: true };
  if (pathname === "/api/face-targets") return { targets: [] };
  return {};
}

function isImageApi(pathname) {
  return (
    pathname.startsWith("/api/detections/") ||
    pathname.startsWith("/api/thumbnails/") ||
    pathname.startsWith("/api/job-clips/") ||
    pathname.startsWith("/api/job-images/") ||
    pathname.startsWith("/api/media-download/")
  );
}

async function fulfillJson(cdp, requestId, statusCode, payload) {
  await cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: statusCode,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
  });
}

async function setupApiFixtures(cdp, theme) {
  cdp.on("Fetch.requestPaused", async (params) => {
    const { requestId, request } = params;
    try {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) {
        await cdp.send("Fetch.continueRequest", { requestId });
        return;
      }

      if (isImageApi(url.pathname)) {
        await cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "image/png" }],
          body: transparentPngBase64,
        });
        return;
      }

      await fulfillJson(cdp, requestId, 200, jsonForApi(url.pathname, theme));
    } catch (error) {
      await fulfillJson(cdp, requestId, 500, { error: String(error) });
    }
  });

  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }],
  });
}

function parsePngStats(buffer) {
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Screenshot is not a PNG.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const bytesPerPixelByColorType = new Map([
    [0, 1],
    [2, 3],
    [6, 4],
  ]);
  const bytesPerPixel = bytesPerPixelByColorType.get(colorType);
  if (bitDepth !== 8 || !bytesPerPixel || !width || !height) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth} colorType=${colorType}`);
  }

  const inflated = inflateSync(Buffer.concat(idatChunks));
  const stride = width * bytesPerPixel;
  const rows = Buffer.alloc(width * height * bytesPerPixel);
  const previous = Buffer.alloc(stride);
  let inputOffset = 0;
  let outputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.from(inflated.subarray(inputOffset, inputOffset + stride));
    inputOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 1) {
        row[x] = (row[x] + left) & 0xff;
      } else if (filter === 2) {
        row[x] = (row[x] + up) & 0xff;
      } else if (filter === 3) {
        row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + predictor) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter: ${filter}`);
      }
    }

    row.copy(rows, outputOffset);
    row.copy(previous);
    outputOffset += stride;
  }

  const distinct = new Set();
  const sampleStep = Math.max(bytesPerPixel, Math.floor(rows.length / 4000 / bytesPerPixel) * bytesPerPixel);
  for (let index = 0; index < rows.length; index += sampleStep) {
    distinct.add(`${rows[index]},${rows[index + 1] || 0},${rows[index + 2] || 0}`);
    if (distinct.size > 64) break;
  }

  return { width, height, distinctColors: distinct.size };
}

async function captureRoute({ baseUrl, debugPort, target, theme, route, width, height }) {
  const cdp = await createPage(debugPort);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });
    await setupApiFixtures(cdp, theme);

    const exceptions = [];
    cdp.on("Runtime.exceptionThrown", (params) => {
      exceptions.push(params.exceptionDetails?.text || "Runtime exception");
    });

    const pageUrl = new URL(route, baseUrl).toString();
    const loadEvent = cdp.waitFor("Page.loadEventFired", 15000).catch(() => null);
    await cdp.send("Page.navigate", { url: pageUrl });
    await loadEvent;
    await delay(1800);

    let image = null;
    let stats = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const screenshot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        fromSurface: true,
      });
      image = Buffer.from(screenshot.data, "base64");
      stats = parsePngStats(image);
      if (stats.width >= width && stats.height >= height && stats.distinctColors >= 4) {
        break;
      }
      await delay(900);
    }

    if (stats.width < width || stats.height < height || stats.distinctColors < 4) {
      throw new Error(
        `Screenshot check failed for ${target}/${theme}${route}: ${JSON.stringify(stats)}`
      );
    }

    const routeName = route.replace(/^\/+/, "").replace(/[^a-z0-9_-]+/gi, "-") || "root";
    const fileName = `${target}-${theme}-${width}x${height}-${routeName}.png`;
    await writeFile(resolve(artifactsRoot, fileName), image);

    return {
      target,
      theme,
      route,
      fileName,
      stats,
      exceptions,
    };
  } finally {
    try {
      await cdp.send("Page.close");
    } catch {
      // The target may already be gone after navigation failures.
    }
    cdp.close();
  }
}

function stopProcessTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform !== "win32") {
      process.kill(-child.pid, "SIGTERM");
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Best effort.
    }
  }
}

async function runLinuxHostPreflight() {
  const binary =
    process.env.PERCEPTRUM_LINUX_DESKTOP ||
    resolve(workspaceRoot, "Perceptrum", "out", "build", "linux-debug", "perceptrum-desktop");
  if (!existsSync(binary)) {
    return { skipped: true, reason: `Linux host binary not found at ${binary}` };
  }

  const result = spawnSync(binary, ["--print-web-root", "--no-open"], {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      APP_STATIC_ROOT: process.env.APP_STATIC_ROOT || resolve(projectRoot, "dist"),
    },
    encoding: "utf8",
  });

  return {
    skipped: false,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function main() {
  const targetArg = readArg("--target", "browser");
  const targets = targetArg === "all" ? ["browser", "linux-host", "windows-webview2"] : [targetArg];
  const themes = splitList(readArg("--themes"), ["dark", "light"]);
  const routes = splitList(readArg("--routes"), [
    "/dashboard",
    "/cameras",
    "/ai-agents",
    "/jobs",
    "/drakon-find",
    "/chat",
    "/settings",
    "/settings?tab=users",
    "/settings?tab=workspace-access",
    "/events",
    "/billing",
  ]);
  const width = Number(readArg("--width", "1440"));
  const height = Number(readArg("--height", "1000"));
  const port = Number(readArg("--port", String(chooseFreePort(5200))));
  const debugPort = Number(readArg("--debug-port", String(chooseFreePort(9300))));

  await mkdir(artifactsRoot, { recursive: true });

  if (targets.every((target) => target === "windows-webview2") && !process.env.VISUAL_WINDOWS_WEBVIEW2_URL) {
    const summaryPath = resolve(artifactsRoot, "summary.json");
    await writeFile(
      summaryPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summaries: [],
          skipped: [
            {
              target: "windows-webview2",
              reason: "Set VISUAL_WINDOWS_WEBVIEW2_URL on a Windows/WebView2 run to capture this target.",
            },
          ],
        },
        null,
        2
      )
    );
    console.warn("[visual] windows-webview2 skipped: set VISUAL_WINDOWS_WEBVIEW2_URL to capture it.");
    return;
  }

  let vite = null;
  let chrome = null;
  const summaries = [];

  try {
    const explicitBaseUrl = process.env.VISUAL_BASE_URL;
    const baseUrl = explicitBaseUrl || `http://127.0.0.1:${port}`;
    if (!explicitBaseUrl) {
      vite = await startVite(port);
    }

    chrome = await startChrome(debugPort, width, height);

    for (const target of targets) {
      if (target === "linux-host") {
        const preflight = await runLinuxHostPreflight();
        if (preflight.skipped) {
          console.warn(`[visual] linux-host skipped: ${preflight.reason}`);
        } else if (preflight.status !== 0) {
          throw new Error(`Linux host preflight failed:\n${preflight.stderr || preflight.stdout}`);
        }
      }

      if (target === "windows-webview2" && !process.env.VISUAL_WINDOWS_WEBVIEW2_URL) {
        console.warn("[visual] windows-webview2 skipped: set VISUAL_WINDOWS_WEBVIEW2_URL to capture it.");
        continue;
      }

      const targetBaseUrl =
        target === "windows-webview2" ? process.env.VISUAL_WINDOWS_WEBVIEW2_URL : baseUrl;

      for (const theme of themes) {
        for (const route of routes) {
          summaries.push(
            await captureRoute({
              baseUrl: targetBaseUrl,
              debugPort,
              target,
              theme,
              route,
              width,
              height,
            })
          );
        }
      }
    }
  } finally {
    stopProcessTree(chrome);
    stopProcessTree(vite);
    if (chrome?.userDataDir) {
      await delay(500);
      await rm(chrome.userDataDir, { recursive: true, force: true });
    }
  }

  const summaryPath = resolve(artifactsRoot, "summary.json");
  await writeFile(summaryPath, JSON.stringify({ generatedAt: new Date().toISOString(), summaries }, null, 2));

  if (hasFlag("--strict-console")) {
    const exceptions = summaries.flatMap((summary) => summary.exceptions);
    if (exceptions.length > 0) {
      throw new Error(`Runtime exceptions captured:\n${exceptions.join("\n")}`);
    }
  }

  console.log(`[visual] wrote ${summaries.length} screenshots to ${artifactsRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

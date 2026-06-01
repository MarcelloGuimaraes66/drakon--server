import { buildCentralIdentityEndpointUrl } from "./centralIdentity";

export type WorkspaceRelayClientContext = {
  env: Env;
  appUserId: string;
  publicId: string;
};

type WorkspaceRelayClientHandler = (
  context: WorkspaceRelayClientContext,
  message: Record<string, unknown>
) => void | Promise<void>;

type WorkspaceRelayConnectionState = {
  publicId: string;
  appUserId: string;
  env: Env;
  grantToken: string;
  socket: WebSocket | null;
  connectPromise: Promise<void> | null;
  onMessage: WorkspaceRelayClientHandler;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

const WORKSPACE_RELAY_HEARTBEAT_MS = 15_000;
const WORKSPACE_RELAY_RECONNECT_MS = 5_000;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  return value.trim();
}

function buildRedactedRelayErrorSummary(message: Record<string, unknown>) {
  return {
    type: normalizeText(message.type) || "relay_error",
    code: normalizeText(message.code) || null,
    error: normalizeText(message.error) || normalizeText(message.message) || "relay_error",
  };
}

function getWorkspaceRelayConnectionMap() {
  const globalKey = "__workspaceRelayConnectionMap";
  const root = globalThis as any;
  if (!root[globalKey]) {
    root[globalKey] = new Map<string, WorkspaceRelayConnectionState>();
  }
  return root[globalKey] as Map<string, WorkspaceRelayConnectionState>;
}

function isSocketOpen(socket: WebSocket | null | undefined) {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function clearWorkspaceRelayHeartbeat(state: WorkspaceRelayConnectionState) {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

function clearWorkspaceRelayReconnect(state: WorkspaceRelayConnectionState) {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleWorkspaceRelayReconnect(state: WorkspaceRelayConnectionState) {
  if (state.reconnectTimer) {
    return;
  }

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (isSocketOpen(state.socket) || state.connectPromise) {
      return;
    }
    state.connectPromise = openWorkspaceRelaySocket(state)
      .catch((error) => {
        console.error("[WORKSPACE RELAY] Automatic reconnect failed:", error);
      })
      .finally(() => {
        if (!isSocketOpen(state.socket)) {
          state.connectPromise = null;
          scheduleWorkspaceRelayReconnect(state);
        }
      });
  }, WORKSPACE_RELAY_RECONNECT_MS);
}

async function requestWorkspaceRelaySession(env: Env, grantToken: string) {
  const response = await fetch(buildCentralIdentityEndpointUrl(env, "/api/workspace-relay/session"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${grantToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(data?.error || "Failed to create a workspace relay session."));
  }

  const wsUrl = normalizeText(data?.ws_url);
  if (!wsUrl) {
    throw new Error("The central relay session did not return a WebSocket URL.");
  }

  return {
    wsUrl,
  };
}

async function openWorkspaceRelaySocket(state: WorkspaceRelayConnectionState) {
  const { wsUrl } = await requestWorkspaceRelaySession(state.env, state.grantToken);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(wsUrl);

    socket.addEventListener("open", () => {
      clearWorkspaceRelayReconnect(state);
      clearWorkspaceRelayHeartbeat(state);
      state.socket = socket;
      state.heartbeatTimer = setInterval(() => {
        if (!isSocketOpen(state.socket)) {
          clearWorkspaceRelayHeartbeat(state);
          return;
        }
        try {
          state.socket!.send(JSON.stringify({ type: "ping" }));
        } catch (error) {
          console.error("[WORKSPACE RELAY] Failed to send heartbeat ping:", error);
          try {
            state.socket?.close();
          } catch {
            // ignore close errors
          }
        }
      }, WORKSPACE_RELAY_HEARTBEAT_MS);
      settled = true;
      resolve();
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data || "{}")) as Record<string, unknown>;
        if (normalizeText(message.type) === "relay_error") {
          console.error(
            "[WORKSPACE RELAY] Central relay error:",
            buildRedactedRelayErrorSummary(message)
          );
        }
        void state.onMessage(
          {
            env: state.env,
            appUserId: state.appUserId,
            publicId: state.publicId,
          },
          message
        );
      } catch (error) {
        console.error("[WORKSPACE RELAY] Failed to parse inbound relay message:", error);
      }
    });

    socket.addEventListener("close", () => {
      clearWorkspaceRelayHeartbeat(state);
      state.socket = null;
      state.connectPromise = null;
      if (!settled) {
        settled = true;
        reject(new Error("The workspace relay socket closed before opening."));
        return;
      }
      scheduleWorkspaceRelayReconnect(state);
    });

    socket.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        reject(new Error("The workspace relay socket failed to connect."));
      }
    });
  });
}

export async function ensureWorkspaceRelayClientConnected(input: {
  env: Env;
  publicId: string;
  appUserId: string;
  grantToken: string;
  onMessage: WorkspaceRelayClientHandler;
}) {
  const publicId = normalizeText(input.publicId);
  const appUserId = normalizeText(input.appUserId);
  const grantToken = normalizeText(input.grantToken);
  if (!publicId || !appUserId || !grantToken) {
    throw new Error("A valid central user context is required to open the workspace relay.");
  }

  const map = getWorkspaceRelayConnectionMap();
  let state = map.get(publicId);
  if (!state) {
    state = {
      publicId,
      appUserId,
      env: input.env,
      grantToken,
      socket: null,
      connectPromise: null,
      onMessage: input.onMessage,
      heartbeatTimer: null,
      reconnectTimer: null,
    };
    map.set(publicId, state);
  } else {
    state.env = input.env;
    state.appUserId = appUserId;
    state.grantToken = grantToken;
    state.onMessage = input.onMessage;
  }

  if (isSocketOpen(state.socket)) {
    return;
  }

  if (!state.connectPromise) {
    state.connectPromise = openWorkspaceRelaySocket(state).finally(() => {
      if (!isSocketOpen(state.socket)) {
        state!.connectPromise = null;
      }
    });
  }

  await state.connectPromise;
}

export function sendWorkspaceRelayClientMessage(
  publicId: string,
  message: Record<string, unknown>
) {
  const normalizedPublicId = normalizeText(publicId);
  if (!normalizedPublicId) return false;

  const state = getWorkspaceRelayConnectionMap().get(normalizedPublicId);
  if (!state || !isSocketOpen(state.socket)) {
    return false;
  }

  try {
    state.socket!.send(JSON.stringify(message));
    return true;
  } catch (error) {
    console.error("[WORKSPACE RELAY] Failed to send outbound relay message:", error);
    try {
      state.socket?.close();
    } catch {
      // ignore close errors
    }
    state.socket = null;
    state.connectPromise = null;
    clearWorkspaceRelayHeartbeat(state);
    scheduleWorkspaceRelayReconnect(state);
    return false;
  }
}

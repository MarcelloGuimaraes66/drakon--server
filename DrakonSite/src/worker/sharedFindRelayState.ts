type SharedFindRelaySocket = {
  send(data: string): void;
  readyState?: number;
  close?: (code?: number, reason?: string) => void;
};

type SharedFindRelaySession = {
  token: string;
  publicId: string;
  expiresAtMs: number;
};

type SharedFindRelayConnectionBucket = {
  sockets: Set<SharedFindRelaySocket>;
  lastSeenMs: number;
};

type SharedFindRelayDispatchAckResult = {
  ok: boolean;
  error?: string;
};

type SharedJobRelayAckResult = {
  ok: boolean;
  error?: string;
};

type SharedFindRelayPendingDispatchAck = {
  key: string;
  ownerPublicId: string;
  operatorPublicId: string;
  operatorSearchId: number;
  requestId: string;
  expiresAtMs: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  resolve: (result: SharedFindRelayDispatchAckResult) => void;
};

type SharedJobRelayPendingAck = {
  key: string;
  ownerPublicId: string;
  operatorPublicId: string;
  operatorJobRunId: string;
  requestId: string;
  action: "start" | "stop";
  expiresAtMs: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  resolve: (result: SharedJobRelayAckResult) => void;
};

type SharedFindRelayState = {
  sessions: Map<string, SharedFindRelaySession>;
  connectionsByPublicId: Map<string, SharedFindRelayConnectionBucket>;
  pendingDispatchAcks: Map<string, SharedFindRelayPendingDispatchAck>;
  pendingJobAcks: Map<string, SharedJobRelayPendingAck>;
};

const SHARED_FIND_RELAY_CONNECTION_LEASE_MS = 45_000;
const SHARED_FIND_RELAY_DISPATCH_ACK_TIMEOUT_MS = 8_000;
const SHARED_JOB_RELAY_ACK_TIMEOUT_MS = 12_000;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  return value.trim();
}

function clampInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function generateRelaySessionToken() {
  const cryptoApi = (globalThis as any).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function getSharedFindRelayState(): SharedFindRelayState {
  const globalKey = "__sharedFindRelayState";
  const root = globalThis as any;
  if (!root[globalKey]) {
    root[globalKey] = {
      sessions: new Map<string, SharedFindRelaySession>(),
      connectionsByPublicId: new Map<string, SharedFindRelayConnectionBucket>(),
      pendingDispatchAcks: new Map<string, SharedFindRelayPendingDispatchAck>(),
      pendingJobAcks: new Map<string, SharedJobRelayPendingAck>(),
    } satisfies SharedFindRelayState;
  }
  return root[globalKey] as SharedFindRelayState;
}

function pruneExpiredSessions(state: SharedFindRelayState, nowMs = Date.now()) {
  for (const [token, session] of state.sessions.entries()) {
    if (session.expiresAtMs <= nowMs) {
      state.sessions.delete(token);
    }
  }
}

function isSocketOpen(socket: SharedFindRelaySocket) {
  return socket.readyState === undefined || socket.readyState === 1;
}

function closeSocketQuietly(socket: SharedFindRelaySocket, code: number, reason: string) {
  try {
    socket.close?.(code, reason);
  } catch {
    // ignore close errors
  }
}

function pruneStaleConnections(state: SharedFindRelayState, nowMs = Date.now()) {
  for (const [publicId, bucket] of state.connectionsByPublicId.entries()) {
    for (const socket of [...bucket.sockets]) {
      if (!isSocketOpen(socket)) {
        bucket.sockets.delete(socket);
      }
    }

    const isFresh = nowMs - bucket.lastSeenMs <= SHARED_FIND_RELAY_CONNECTION_LEASE_MS;
    if (!isFresh) {
      for (const socket of [...bucket.sockets]) {
        closeSocketQuietly(socket, 1001, "relay_presence_expired");
        bucket.sockets.delete(socket);
      }
    }

    if (bucket.sockets.size === 0) {
      state.connectionsByPublicId.delete(publicId);
    }
  }
}

function touchSharedFindRelayConnection(publicId: string, nowMs = Date.now()) {
  const normalizedPublicId = normalizeText(publicId);
  if (!normalizedPublicId) return;

  const state = getSharedFindRelayState();
  const bucket = state.connectionsByPublicId.get(normalizedPublicId);
  if (!bucket) return;
  bucket.lastSeenMs = nowMs;
}

function buildSharedFindRelayDispatchAckKey(input: {
  ownerPublicId: string;
  operatorPublicId: string;
  operatorSearchId: number;
  requestId: string;
}) {
  return [
    normalizeText(input.ownerPublicId),
    normalizeText(input.operatorPublicId),
    String(Math.max(0, clampInteger(input.operatorSearchId))),
    normalizeText(input.requestId),
  ].join("::");
}

function clearPendingDispatchAck(
  state: SharedFindRelayState,
  key: string
): SharedFindRelayPendingDispatchAck | null {
  const pending = state.pendingDispatchAcks.get(key) || null;
  if (!pending) return null;
  state.pendingDispatchAcks.delete(key);
  if (pending.timeoutHandle) {
    clearTimeout(pending.timeoutHandle);
    pending.timeoutHandle = null;
  }
  return pending;
}

function buildSharedJobRelayAckKey(input: {
  ownerPublicId: string;
  operatorPublicId: string;
  operatorJobRunId: string;
  requestId: string;
  action: "start" | "stop";
}) {
  return [
    normalizeText(input.ownerPublicId),
    normalizeText(input.operatorPublicId),
    normalizeText(input.operatorJobRunId),
    normalizeText(input.requestId),
    input.action,
  ].join("::");
}

function clearPendingSharedJobAck(
  state: SharedFindRelayState,
  key: string
): SharedJobRelayPendingAck | null {
  const pending = state.pendingJobAcks.get(key) || null;
  if (!pending) return null;
  state.pendingJobAcks.delete(key);
  if (pending.timeoutHandle) {
    clearTimeout(pending.timeoutHandle);
    pending.timeoutHandle = null;
  }
  return pending;
}

function settleSharedFindRelayDispatchAck(
  ownerPublicId: string,
  message: Record<string, unknown>
): SharedFindRelayDispatchAckResult | null {
  const type = normalizeText(message.type);
  if (type !== "search_ack" && type !== "search_error") {
    return null;
  }

  const operatorPublicId = normalizeText(message.operator_public_id);
  const operatorSearchId = clampInteger(message.operator_search_id);
  const requestId = normalizeText(message.request_id);
  if (!operatorPublicId || operatorSearchId <= 0 || !requestId) {
    return null;
  }

  const state = getSharedFindRelayState();
  const key = buildSharedFindRelayDispatchAckKey({
    ownerPublicId,
    operatorPublicId,
    operatorSearchId,
    requestId,
  });
  const pending = clearPendingDispatchAck(state, key);
  if (!pending) {
    return null;
  }

  const result =
    type === "search_ack"
      ? { ok: true }
      : {
          ok: false,
          error:
            normalizeText(message.error) ||
            "The owner runtime rejected the shared Drakon Find dispatch.",
        };
  pending.resolve(result);
  return result;
}

function settleSharedJobRelayAck(
  ownerPublicId: string,
  message: Record<string, unknown>
): SharedJobRelayAckResult | null {
  const type = normalizeText(message.type);
  if (
    type !== "shared_job_start_ack" &&
    type !== "shared_job_stop_ack" &&
    type !== "shared_job_error"
  ) {
    return null;
  }

  const operatorPublicId = normalizeText(message.operator_public_id);
  const operatorJobRunId = normalizeText(
    message.operator_job_run_id ?? message.job_run_id
  );
  const requestId = normalizeText(message.request_id);
  if (!operatorPublicId || !operatorJobRunId || !requestId) {
    return null;
  }

  const action =
    type === "shared_job_stop_ack"
      ? "stop"
      : type === "shared_job_start_ack"
        ? "start"
        : normalizeText(message.ack_kind).toLowerCase() === "stop"
          ? "stop"
          : "start";

  const state = getSharedFindRelayState();
  const key = buildSharedJobRelayAckKey({
    ownerPublicId,
    operatorPublicId,
    operatorJobRunId,
    requestId,
    action,
  });
  const pending = clearPendingSharedJobAck(state, key);
  if (!pending) {
    return null;
  }

  const result =
    type === "shared_job_error"
      ? {
          ok: false,
          error:
            normalizeText(message.error) ||
            "The owner runtime rejected the shared job dispatch.",
        }
      : { ok: true };
  pending.resolve(result);
  return result;
}

export function issueSharedFindRelaySession(publicId: string, ttlMs = 60_000) {
  const normalizedPublicId = normalizeText(publicId);
  if (!normalizedPublicId) {
    throw new Error("A valid central public id is required to issue a relay session.");
  }

  const state = getSharedFindRelayState();
  pruneExpiredSessions(state);

  const token = generateRelaySessionToken();
  const expiresAtMs = Date.now() + Math.max(10_000, ttlMs);
  state.sessions.set(token, {
    token,
    publicId: normalizedPublicId,
    expiresAtMs,
  });

  return {
    token,
    public_id: normalizedPublicId,
    expires_at: new Date(expiresAtMs).toISOString(),
  };
}

export function registerSharedFindRelayConnection(
  token: string,
  socket: SharedFindRelaySocket
): { publicId: string; expiresAt: string } | null {
  const normalizedToken = normalizeText(token);
  if (!normalizedToken) return null;

  const state = getSharedFindRelayState();
  pruneExpiredSessions(state);
  pruneStaleConnections(state);

  const session = state.sessions.get(normalizedToken);
  if (!session) {
    return null;
  }

  state.sessions.delete(normalizedToken);

  let bucket = state.connectionsByPublicId.get(session.publicId);
  if (!bucket) {
    bucket = {
      sockets: new Set<SharedFindRelaySocket>(),
      lastSeenMs: Date.now(),
    };
    state.connectionsByPublicId.set(session.publicId, bucket);
  }
  bucket.lastSeenMs = Date.now();
  bucket.sockets.add(socket);

  return {
    publicId: session.publicId,
    expiresAt: new Date(session.expiresAtMs).toISOString(),
  };
}

export function unregisterSharedFindRelayConnection(publicId: string, socket: SharedFindRelaySocket) {
  const normalizedPublicId = normalizeText(publicId);
  if (!normalizedPublicId) return;

  const state = getSharedFindRelayState();
  const bucket = state.connectionsByPublicId.get(normalizedPublicId);
  if (!bucket) return;

  bucket.sockets.delete(socket);
  if (bucket.sockets.size === 0) {
    state.connectionsByPublicId.delete(normalizedPublicId);
  }
}

export function countSharedFindRelayConnections(publicId: string): number {
  const normalizedPublicId = normalizeText(publicId);
  if (!normalizedPublicId) return 0;

  const state = getSharedFindRelayState();
  pruneStaleConnections(state);

  const bucket = state.connectionsByPublicId.get(normalizedPublicId);
  if (!bucket) return 0;
  if (Date.now() - bucket.lastSeenMs > SHARED_FIND_RELAY_CONNECTION_LEASE_MS) {
    return 0;
  }

  let count = 0;
  for (const socket of bucket.sockets) {
    if (isSocketOpen(socket)) {
      count += 1;
    }
  }
  return count;
}

export function sendSharedFindRelayMessage(publicId: string, message: Record<string, unknown>) {
  const normalizedPublicId = normalizeText(publicId);
  if (!normalizedPublicId) return 0;

  const state = getSharedFindRelayState();
  pruneStaleConnections(state);

  const bucket = state.connectionsByPublicId.get(normalizedPublicId);
  if (!bucket || bucket.sockets.size === 0) {
    return 0;
  }
  if (Date.now() - bucket.lastSeenMs > SHARED_FIND_RELAY_CONNECTION_LEASE_MS) {
    return 0;
  }

  const serialized = JSON.stringify(message);
  let sent = 0;

  for (const socket of [...bucket.sockets]) {
    if (!isSocketOpen(socket)) {
      bucket.sockets.delete(socket);
      continue;
    }

    try {
      socket.send(serialized);
      sent += 1;
    } catch (error) {
      console.error("[SHARED FIND RELAY] Failed to send WebSocket message:", error);
      bucket.sockets.delete(socket);
      closeSocketQuietly(socket, 1011, "relay_send_failed");
    }
  }

  if (bucket.sockets.size === 0) {
    state.connectionsByPublicId.delete(normalizedPublicId);
  }

  return sent;
}

export async function waitForSharedFindRelayDispatchAck(input: {
  ownerPublicId: string;
  operatorPublicId: string;
  operatorSearchId: number;
  requestId: string;
  timeoutMs?: number;
}): Promise<SharedFindRelayDispatchAckResult> {
  const ownerPublicId = normalizeText(input.ownerPublicId);
  const operatorPublicId = normalizeText(input.operatorPublicId);
  const operatorSearchId = clampInteger(input.operatorSearchId);
  const requestId = normalizeText(input.requestId);
  if (!ownerPublicId || !operatorPublicId || operatorSearchId <= 0 || !requestId) {
    return { ok: false, error: "A valid shared relay dispatch ack context is required." };
  }

  const state = getSharedFindRelayState();
  const key = buildSharedFindRelayDispatchAckKey({
    ownerPublicId,
    operatorPublicId,
    operatorSearchId,
    requestId,
  });

  clearPendingDispatchAck(state, key);

  return await new Promise<SharedFindRelayDispatchAckResult>((resolve) => {
    const timeoutMs = Math.max(1_000, clampInteger(input.timeoutMs) || SHARED_FIND_RELAY_DISPATCH_ACK_TIMEOUT_MS);
    const pending: SharedFindRelayPendingDispatchAck = {
      key,
      ownerPublicId,
      operatorPublicId,
      operatorSearchId,
      requestId,
      expiresAtMs: Date.now() + timeoutMs,
      timeoutHandle: null,
      resolve,
    };

    pending.timeoutHandle = setTimeout(() => {
      const settled = clearPendingDispatchAck(state, key);
      if (!settled) return;
      settled.resolve({
        ok: false,
        error: "The owner runtime did not acknowledge the shared Drakon Find dispatch in time.",
      });
    }, timeoutMs);

    state.pendingDispatchAcks.set(key, pending);
  });
}

export function cancelSharedFindRelayDispatchAckWait(input: {
  ownerPublicId: string;
  operatorPublicId: string;
  operatorSearchId: number;
  requestId: string;
}) {
  const key = buildSharedFindRelayDispatchAckKey({
    ownerPublicId: input.ownerPublicId,
    operatorPublicId: input.operatorPublicId,
    operatorSearchId: input.operatorSearchId,
    requestId: input.requestId,
  });
  clearPendingDispatchAck(getSharedFindRelayState(), key);
}

export async function waitForSharedJobRelayAck(input: {
  ownerPublicId: string;
  operatorPublicId: string;
  operatorJobRunId: string;
  requestId: string;
  action: "start" | "stop";
  timeoutMs?: number;
}): Promise<SharedJobRelayAckResult> {
  const ownerPublicId = normalizeText(input.ownerPublicId);
  const operatorPublicId = normalizeText(input.operatorPublicId);
  const operatorJobRunId = normalizeText(input.operatorJobRunId);
  const requestId = normalizeText(input.requestId);
  const action = input.action === "stop" ? "stop" : "start";
  if (!ownerPublicId || !operatorPublicId || !operatorJobRunId || !requestId) {
    return { ok: false, error: "A valid shared job relay ack context is required." };
  }

  const state = getSharedFindRelayState();
  const key = buildSharedJobRelayAckKey({
    ownerPublicId,
    operatorPublicId,
    operatorJobRunId,
    requestId,
    action,
  });
  clearPendingSharedJobAck(state, key);

  return await new Promise<SharedJobRelayAckResult>((resolve) => {
    const timeoutMs = Math.max(1_000, clampInteger(input.timeoutMs) || SHARED_JOB_RELAY_ACK_TIMEOUT_MS);
    const pending: SharedJobRelayPendingAck = {
      key,
      ownerPublicId,
      operatorPublicId,
      operatorJobRunId,
      requestId,
      action,
      expiresAtMs: Date.now() + timeoutMs,
      timeoutHandle: null,
      resolve,
    };

    pending.timeoutHandle = setTimeout(() => {
      const settled = clearPendingSharedJobAck(state, key);
      if (!settled) return;
      settled.resolve({
        ok: false,
        error:
          action === "stop"
            ? "The owner runtime did not acknowledge the shared job stop in time."
            : "The owner runtime did not acknowledge the shared job dispatch in time.",
      });
    }, timeoutMs);

    state.pendingJobAcks.set(key, pending);
  });
}

export function cancelSharedJobRelayAckWait(input: {
  ownerPublicId: string;
  operatorPublicId: string;
  operatorJobRunId: string;
  requestId: string;
  action: "start" | "stop";
}) {
  const key = buildSharedJobRelayAckKey({
    ownerPublicId: input.ownerPublicId,
    operatorPublicId: input.operatorPublicId,
    operatorJobRunId: input.operatorJobRunId,
    requestId: input.requestId,
    action: input.action,
  });
  clearPendingSharedJobAck(getSharedFindRelayState(), key);
}

export function routeSharedFindRelayClientMessage(
  senderPublicId: string,
  payload: unknown
): {
  ok: boolean;
  forwarded: number;
  error?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { ok: false, forwarded: 0, error: "invalid_payload" };
  }

  const normalizedSender = normalizeText(senderPublicId);
  if (!normalizedSender) {
    return { ok: false, forwarded: 0, error: "missing_sender_public_id" };
  }
  touchSharedFindRelayConnection(normalizedSender);

  const message = payload as Record<string, unknown>;
  const type = normalizeText(message.type);
  if (!type) {
    return { ok: false, forwarded: 0, error: "missing_type" };
  }

  if (type === "ping" || type === "pong") {
    return { ok: true, forwarded: 0 };
  }

  settleSharedFindRelayDispatchAck(normalizedSender, message);
  settleSharedJobRelayAck(normalizedSender, message);

  const operatorPublicId = normalizeText(message.operator_public_id);
  if (!operatorPublicId) {
    return { ok: false, forwarded: 0, error: "missing_operator_public_id" };
  }

  const forwarded = sendSharedFindRelayMessage(operatorPublicId, {
    ...message,
    sender_public_id: normalizedSender,
  });

  return {
    ok: forwarded > 0,
    forwarded,
    error: forwarded > 0 ? undefined : "operator_offline",
  };
}

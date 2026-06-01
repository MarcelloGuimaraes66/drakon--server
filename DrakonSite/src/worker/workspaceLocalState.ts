type PendingWorkspaceApproval = {
  appUserId: string;
  sessionId: string;
  ownerPublicId: string;
  operatorPublicId: string;
  operatorDisplayLabel: string;
  permissionProfile: string;
  requestedAt: string;
  requestedByPolicy: string;
};

type PendingWorkspaceProxyResponse = {
  key: string;
  expiresAtMs: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  resolve: (payload: Record<string, unknown>) => void;
};

const WORKSPACE_PROXY_RESPONSE_TIMEOUT_MS = 30_000;

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }
  return value.trim();
}

function getPendingWorkspaceApprovalMap() {
  const globalKey = "__pendingWorkspaceApprovalMap";
  const root = globalThis as any;
  if (!root[globalKey]) {
    root[globalKey] = new Map<string, Map<string, PendingWorkspaceApproval>>();
  }
  return root[globalKey] as Map<string, Map<string, PendingWorkspaceApproval>>;
}

function getPendingWorkspaceProxyResponseMap() {
  const globalKey = "__pendingWorkspaceProxyResponseMap";
  const root = globalThis as any;
  if (!root[globalKey]) {
    root[globalKey] = new Map<string, PendingWorkspaceProxyResponse>();
  }
  return root[globalKey] as Map<string, PendingWorkspaceProxyResponse>;
}

function buildWorkspaceProxyResponseKey(sessionId: string, requestId: string) {
  return `${normalizeText(sessionId)}::${normalizeText(requestId)}`;
}

export function upsertPendingWorkspaceApproval(input: PendingWorkspaceApproval) {
  const appUserId = normalizeText(input.appUserId);
  const sessionId = normalizeText(input.sessionId);
  if (!appUserId || !sessionId) return;

  const approvalMap = getPendingWorkspaceApprovalMap();
  let bucket = approvalMap.get(appUserId);
  if (!bucket) {
    bucket = new Map<string, PendingWorkspaceApproval>();
    approvalMap.set(appUserId, bucket);
  }

  bucket.set(sessionId, {
    ...input,
    appUserId,
    sessionId,
  });
}

export function listPendingWorkspaceApprovals(appUserId: string) {
  const normalizedAppUserId = normalizeText(appUserId);
  if (!normalizedAppUserId) return [] as PendingWorkspaceApproval[];

  const bucket = getPendingWorkspaceApprovalMap().get(normalizedAppUserId);
  if (!bucket) return [] as PendingWorkspaceApproval[];

  return [...bucket.values()].sort((left, right) =>
    left.requestedAt.localeCompare(right.requestedAt)
  );
}

export function clearPendingWorkspaceApproval(appUserId: string, sessionId: string) {
  const normalizedAppUserId = normalizeText(appUserId);
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedAppUserId || !normalizedSessionId) return;

  const approvalMap = getPendingWorkspaceApprovalMap();
  const bucket = approvalMap.get(normalizedAppUserId);
  if (!bucket) return;

  bucket.delete(normalizedSessionId);
  if (bucket.size === 0) {
    approvalMap.delete(normalizedAppUserId);
  }
}

export function waitForWorkspaceProxyResponse(input: {
  sessionId: string;
  requestId: string;
  timeoutMs?: number;
}) {
  const sessionId = normalizeText(input.sessionId);
  const requestId = normalizeText(input.requestId);
  if (!sessionId || !requestId) {
    return Promise.resolve({
      type: "proxy_response",
      error: "A valid workspace proxy response context is required.",
    } as Record<string, unknown>);
  }

  const key = buildWorkspaceProxyResponseKey(sessionId, requestId);
  const map = getPendingWorkspaceProxyResponseMap();
  const existing = map.get(key);
  if (existing) {
    map.delete(key);
    if (existing.timeoutHandle) {
      clearTimeout(existing.timeoutHandle);
    }
  }

  return new Promise<Record<string, unknown>>((resolve) => {
    const timeoutMs = Math.max(1_000, Number(input.timeoutMs) || WORKSPACE_PROXY_RESPONSE_TIMEOUT_MS);
    const pending: PendingWorkspaceProxyResponse = {
      key,
      expiresAtMs: Date.now() + timeoutMs,
      timeoutHandle: null,
      resolve,
    };

    pending.timeoutHandle = setTimeout(() => {
      const settled = map.get(key);
      if (!settled) return;
      map.delete(key);
      settled.resolve({
        type: "proxy_response",
        session_id: sessionId,
        request_id: requestId,
        error: "The remote workspace request timed out.",
      });
    }, timeoutMs);

    map.set(key, pending);
  });
}

export function settleWorkspaceProxyResponse(message: Record<string, unknown>) {
  const sessionId = normalizeText(message.session_id);
  const requestId = normalizeText(message.request_id);
  if (!sessionId || !requestId) {
    return false;
  }

  const key = buildWorkspaceProxyResponseKey(sessionId, requestId);
  const map = getPendingWorkspaceProxyResponseMap();
  const pending = map.get(key);
  if (!pending) {
    return false;
  }

  map.delete(key);
  if (pending.timeoutHandle) {
    clearTimeout(pending.timeoutHandle);
    pending.timeoutHandle = null;
  }

  pending.resolve(message);
  return true;
}

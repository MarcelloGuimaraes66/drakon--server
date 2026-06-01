import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@getmocha/users-service/react";

type RemoteWorkspaceSession = {
  session_id: string;
  permission_profile: string;
  status: string;
  owner_handle: string | null;
  owner_email: string;
  operator_handle: string | null;
  operator_email: string;
  owner_online: boolean;
  owner_last_seen_at: string | null;
  owner_connection_policy: string;
};

type RemoteWorkspaceUser = {
  id: string;
  email: string;
  auth_provider?: "local" | "google";
  country_code?: string | null;
  created_at?: string | null;
  handle?: string | null;
  requires_secret_recovery_setup?: boolean;
  secret_recovery_configured?: boolean;
  secret_recovery_question_key?: string | null;
  secret_recovery_storage_scope?: "local" | "server" | null;
  has_password?: boolean;
  google_user_data?: {
    name?: string | null;
    email?: string | null;
  } | null;
  account_access?: Record<string, unknown> | null;
};

type RemoteWorkspaceContextValue = {
  isRemote: boolean;
  sessionId: string | null;
  session: RemoteWorkspaceSession | null;
  remoteUser: RemoteWorkspaceUser | null;
  ownerDisplayLabel: string;
  operatorDisplayLabel: string;
  error: string;
  refresh: () => Promise<void>;
  endSession: (reason?: string) => Promise<void>;
};

const REMOTE_WORKSPACE_SESSION_QUERY_KEY = "remote_workspace_session";
const REMOTE_WORKSPACE_OWNER_QUERY_KEY = "remote_workspace_owner";
const REMOTE_WORKSPACE_OPERATOR_QUERY_KEY = "remote_workspace_operator";
const LOCAL_WORKSPACE_ACCESS_API_PREFIX = "/api/desktop-workspace-access";
const ESCAPED_LOCAL_WORKSPACE_ACCESS_API_PREFIX = LOCAL_WORKSPACE_ACCESS_API_PREFIX.replace(
  /\//g,
  "\\/"
);
const LOCAL_WORKSPACE_BOOTSTRAP_PATH_PATTERN = new RegExp(
  `^${ESCAPED_LOCAL_WORKSPACE_ACCESS_API_PREFIX}\\/sessions\\/[^/]+\\/bootstrap$`,
  "i"
);
const LOCAL_WORKSPACE_END_PATH_PATTERN = new RegExp(
  `^${ESCAPED_LOCAL_WORKSPACE_ACCESS_API_PREFIX}\\/sessions\\/[^/]+\\/end$`,
  "i"
);

const RemoteWorkspaceContext = createContext<RemoteWorkspaceContextValue>({
  isRemote: false,
  sessionId: null,
  session: null,
  remoteUser: null,
  ownerDisplayLabel: "",
  operatorDisplayLabel: "",
  error: "",
  refresh: async () => {},
  endSession: async () => {},
});

function readInitialRemoteWorkspaceState() {
  if (typeof window === "undefined") {
    return {
      sessionId: null,
      ownerDisplayLabel: "",
      operatorDisplayLabel: "",
    };
  }

  const searchParams = new URLSearchParams(window.location.search);
  return {
    sessionId: searchParams.get(REMOTE_WORKSPACE_SESSION_QUERY_KEY),
    ownerDisplayLabel: searchParams.get(REMOTE_WORKSPACE_OWNER_QUERY_KEY) || "",
    operatorDisplayLabel: searchParams.get(REMOTE_WORKSPACE_OPERATOR_QUERY_KEY) || "",
  };
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function shouldProxyRemoteFetch(url: URL): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  if (url.origin !== window.location.origin) {
    return false;
  }

  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  if (url.pathname === `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/remote-proxy`) {
    return false;
  }

  if (url.pathname === `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/asset`) {
    return false;
  }

  if (url.pathname === `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/heartbeat`) {
    return false;
  }

  if (url.pathname === `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/pending-requests`) {
    return false;
  }

  if (LOCAL_WORKSPACE_BOOTSTRAP_PATH_PATTERN.test(url.pathname)) {
    return false;
  }

  if (LOCAL_WORKSPACE_END_PATH_PATTERN.test(url.pathname)) {
    return false;
  }

  if (url.pathname.startsWith("/api/runtime/")) {
    return false;
  }

  return true;
}

export function RemoteWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, isPending } = useAuth();
  const initialStateRef = useRef(readInitialRemoteWorkspaceState());
  const closeSignalSentRef = useRef(false);
  const [session, setSession] = useState<RemoteWorkspaceSession | null>(null);
  const [remoteUser, setRemoteUser] = useState<RemoteWorkspaceUser | null>(null);
  const [ownerDisplayLabel, setOwnerDisplayLabel] = useState(
    initialStateRef.current.ownerDisplayLabel
  );
  const [operatorDisplayLabel, setOperatorDisplayLabel] = useState(
    initialStateRef.current.operatorDisplayLabel
  );
  const [error, setError] = useState("");

  const sessionId = initialStateRef.current.sessionId;
  const isRemote = Boolean(sessionId);

  useEffect(() => {
    closeSignalSentRef.current = false;
  }, [sessionId]);

  const dispatchSessionEndSignal = (reason: string) => {
    if (!sessionId || closeSignalSentRef.current) {
      return;
    }

    closeSignalSentRef.current = true;
    const endpoint = `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/end`;
    const payload = JSON.stringify({ reason });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const requestBody = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon(endpoint, requestBody)) {
          return;
        }
      } catch {
        // Fall back to keepalive fetch below.
      }
    }

    void fetch(endpoint, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: {
        "content-type": "application/json",
      },
      body: payload,
    }).catch(() => null);
  };

  const refresh = async () => {
    if (!sessionId || isPending || !user) {
      return;
    }

    try {
      const response = await fetch(
        `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/bootstrap`,
        {
          credentials: "include",
          cache: "no-store",
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || "Failed to load the remote workspace session."));
      }

      setSession((payload?.session || null) as RemoteWorkspaceSession | null);
      setRemoteUser(
        payload?.permission_user && typeof payload.permission_user === "object"
          ? (payload.permission_user as RemoteWorkspaceUser)
          : null
      );
      setOwnerDisplayLabel(
        String(payload?.remote_context?.owner_display_label || ownerDisplayLabel || "")
      );
      setOperatorDisplayLabel(
        String(payload?.remote_context?.operator_display_label || operatorDisplayLabel || "")
      );
      setError("");
    } catch (fetchError) {
      setError(
        fetchError instanceof Error && fetchError.message
          ? fetchError.message
          : "Failed to load the remote workspace session."
      );
      setRemoteUser(null);
    }
  };

  useEffect(() => {
    if (!isRemote || isPending || !user) {
      return;
    }

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isPending, isRemote, user]);

  useEffect(() => {
    if (!isRemote || !sessionId || !user) {
      return;
    }

    const handleWindowClose = () => {
      dispatchSessionEndSignal("window_closed");
    };

    window.addEventListener("beforeunload", handleWindowClose);
    window.addEventListener("pagehide", handleWindowClose);

    return () => {
      window.removeEventListener("beforeunload", handleWindowClose);
      window.removeEventListener("pagehide", handleWindowClose);
    };
  }, [isRemote, sessionId, user]);

  useEffect(() => {
    if (!sessionId || !user) {
      return;
    }

    const originalFetch = globalThis.fetch.bind(globalThis);
    const remoteSessionId = sessionId;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url, window.location.origin);

      if (!shouldProxyRemoteFetch(url)) {
        return originalFetch(input as RequestInfo, init);
      }

      const requestClone = request.clone();
      const method = (requestClone.method || "GET").toUpperCase();
      const outboundHeaders: Record<string, string> = {};
      requestClone.headers.forEach((value, key) => {
        outboundHeaders[key] = value;
      });

      const bodyBase64 =
        method === "GET" || method === "HEAD"
          ? ""
          : arrayBufferToBase64(await requestClone.arrayBuffer());

      return originalFetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/remote-proxy`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          session_id: remoteSessionId,
          path: `${url.pathname}${url.search}`,
          method,
          headers: outboundHeaders,
          body_base64: bodyBase64,
        }),
      });
    }) as typeof fetch;

    return () => {
      globalThis.fetch = originalFetch;
    };
  }, [sessionId, user]);

  const endSession = async (reason = "closed_by_user") => {
    if (!sessionId) return;

    closeSignalSentRef.current = true;

    await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
  };

  return (
    <RemoteWorkspaceContext.Provider
      value={{
        isRemote,
        sessionId,
        session,
        remoteUser,
        ownerDisplayLabel,
        operatorDisplayLabel,
        error,
        refresh,
        endSession,
      }}
    >
      {children}
    </RemoteWorkspaceContext.Provider>
  );
}

export function useRemoteWorkspace() {
  return useContext(RemoteWorkspaceContext);
}

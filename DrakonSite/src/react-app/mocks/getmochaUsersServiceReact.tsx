import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type AuthUser = {
  id: string;
  email: string;
  auth_provider?: "local" | "google";
  country_code?: string | null;
  created_at?: string | null;
  handle?: string | null;
  google_user_data?: any;
};

type GoogleAuthIntent = "login" | "signup";

type GoogleAuthRedirectOptions = {
  intent?: GoogleAuthIntent;
  countryCode?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  isPending: boolean;
  redirectToLogin: (options?: GoogleAuthRedirectOptions) => Promise<void>;
  exchangeCodeForSessionToken: () => Promise<AuthUser | null>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isDesktopHostedShell(): boolean {
  const desktopWindow =
    typeof window !== "undefined"
      ? (window as Window & {
          chrome?: { webview?: unknown };
          __drakonDesktopShell?: boolean;
        })
      : null;
  return (
    desktopWindow?.__drakonDesktopShell === true ||
    (Boolean(desktopWindow?.chrome) &&
      typeof desktopWindow?.chrome?.webview !== "undefined")
  );
}

async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch("/api/auth/me", { credentials: "include" });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    if (data?.isAuthenticated && data.user) {
      return data.user as AuthUser;
    }
  } catch (error) {
    console.error("Failed to fetch auth state:", error);
  }
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isPending, setIsPending] = useState(true);
  const exchangeRef = useRef<Promise<AuthUser | null> | null>(null);

  const loadUser = useCallback(async (): Promise<AuthUser | null> => {
    setIsPending(true);
    const currentUser = await fetchCurrentUser();
    setUser(currentUser);
    setIsPending(false);
    return currentUser;
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const redirectToLogin = useCallback(async (options?: GoogleAuthRedirectOptions) => {
    const isDesktopHosted = isDesktopHostedShell();
    const params = new URLSearchParams();
    const normalizedIntent: GoogleAuthIntent =
      options?.intent === "signup" ? "signup" : "login";
    const normalizedCountryCode =
      normalizedIntent === "signup"
        ? options?.countryCode?.trim().toUpperCase() || ""
        : "";
    if (isDesktopHosted) {
      params.set("desktop_host", "1");
    }
    params.set("intent", normalizedIntent);
    if (normalizedCountryCode) {
      params.set("country_code", normalizedCountryCode);
    }
    const query = params.toString();
    const endpoint = query
      ? `/api/oauth/google/redirect_url?${query}`
      : "/api/oauth/google/redirect_url";

    const response = await fetch(endpoint, {
      credentials: "include",
      headers: isDesktopHosted
        ? {
            "X-Drakon-Desktop-Host": "1",
          }
        : undefined,
    });

    let payload: { redirectUrl?: string; error?: string } | null = null;
    try {
      payload = (await response.json()) as { redirectUrl?: string; error?: string };
    } catch {
      payload = null;
    }

    if (!response.ok || !payload?.redirectUrl) {
      throw new Error(payload?.error || "Failed to start Google login.");
    }

    window.location.href = payload.redirectUrl;
  }, []);

  const exchangeCodeForSessionToken = useCallback(async () => {
    if (exchangeRef.current) {
      return exchangeRef.current;
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const errorDescription = params.get("error_description");
    const errorCode = params.get("error");
    if (!code) {
      const authErrorMessage =
        errorDescription?.trim() ||
        errorCode?.trim()?.replace(/_/g, " ") ||
        "";
      if (authErrorMessage) {
        throw new Error(authErrorMessage);
      }
      return null;
    }

    exchangeRef.current = (async () => {
      let payload: { error?: string; user?: AuthUser } | null = null;
      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code, state }),
        });

        try {
          payload = (await response.json()) as { error?: string; user?: AuthUser };
        } catch {
          payload = null;
        }

        if (!response.ok) {
          throw new Error(payload?.error || "Failed to exchange auth code.");
        }
      } catch (error) {
        console.error("Failed to exchange auth code:", error);
        throw error;
      }

      if (payload?.user) {
        setUser(payload.user);
        setIsPending(false);
        return payload.user;
      }

      return loadUser();
    })();

    return exchangeRef.current;
  }, [loadUser]);

  const logout = useCallback(async () => {
    try {
      await Promise.allSettled([
        fetch("/api/auth/local/logout", {
          method: "POST",
          credentials: "include",
        }),
        fetch("/api/logout", {
          credentials: "include",
        }),
      ]);
    } catch (error) {
      console.error("Failed to logout:", error);
    } finally {
      setUser(null);
      window.location.href = "/login";
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isPending,
      redirectToLogin,
      exchangeCodeForSessionToken,
      logout,
    }),
    [user, isPending, redirectToLogin, exchangeCodeForSessionToken, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

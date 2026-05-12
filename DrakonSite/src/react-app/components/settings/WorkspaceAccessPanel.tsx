import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { brand } from "@/shared/brand";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  RefreshCcw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type WorkspaceAccessSettingsPayload = {
  settings?: {
    connection_policy?: string;
  };
};

type WorkspaceInvite = {
  id: number;
  permission_profile: string;
  status: string;
  owner_handle: string | null;
  owner_email: string;
  invitee_handle: string | null;
  invitee_email: string;
  created_at: string;
  updated_at: string;
};

type WorkspaceAvailableAccess = WorkspaceInvite & {
  owner_online: boolean;
  owner_last_seen_at: string | null;
  owner_connection_policy: string;
  display_label: string;
};

type WorkspaceSession = {
  session_id: string;
  status: string;
  owner_handle: string | null;
  owner_email: string;
  operator_handle: string | null;
  operator_email: string;
  permission_profile: string;
};

type DesktopWebViewBridge = {
  postMessage?: (message: unknown) => void;
};

type DesktopShellWindow = Window & {
  chrome?: {
    webview?: DesktopWebViewBridge;
  };
  __drakonDesktopShell?: boolean;
};

const LOCAL_WORKSPACE_ACCESS_API_PREFIX = "/api/desktop-workspace-access";

function isDesktopShell(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const desktopWindow = window as DesktopShellWindow;
  return (
    desktopWindow.__drakonDesktopShell === true ||
    Boolean(desktopWindow.chrome?.webview)
  );
}

function buildDisplayLabel(handle?: string | null, email?: string | null): string {
  const normalizedHandle = typeof handle === "string" ? handle.trim() : "";
  if (normalizedHandle) {
    return `@${normalizedHandle.replace(/^@+/, "")}`;
  }
  return typeof email === "string" ? email.trim() : "";
}

function requestRemoteWorkspaceWindowOpen(input: {
  sessionId: string;
  ownerDisplayLabel: string;
  operatorDisplayLabel?: string;
}): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const desktopWindow = window as DesktopShellWindow;
  const webview = desktopWindow.chrome?.webview;
  if (desktopWindow.__drakonDesktopShell === true && webview && typeof webview.postMessage === "function") {
    try {
      webview.postMessage({
        type: "open-remote-workspace",
        session_id: input.sessionId,
        owner_display_label: input.ownerDisplayLabel,
        operator_display_label: input.operatorDisplayLabel || "",
      });
      return true;
    } catch {
      return false;
    }
  }

  const nextUrl = new URL("/dashboard", window.location.origin);
  nextUrl.searchParams.set("remote_workspace_session", input.sessionId);
  if (input.ownerDisplayLabel) {
    nextUrl.searchParams.set("remote_workspace_owner", input.ownerDisplayLabel);
  }
  if (input.operatorDisplayLabel) {
    nextUrl.searchParams.set("remote_workspace_operator", input.operatorDisplayLabel);
  }
  window.open(nextUrl.toString(), "_blank", "noopener,noreferrer");
  return true;
}

export default function WorkspaceAccessPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [connectionPolicy, setConnectionPolicy] = useState("allow_while_open");
  const [incomingInvites, setIncomingInvites] = useState<WorkspaceInvite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<WorkspaceInvite[]>([]);
  const [availableAccesses, setAvailableAccesses] = useState<WorkspaceAvailableAccess[]>([]);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "neutral">("neutral");
  const [waitingSessionId, setWaitingSessionId] = useState<string | null>(null);
  const [waitingOwnerLabel, setWaitingOwnerLabel] = useState("");
  const [actionKey, setActionKey] = useState("");
  const workspaceAccessLabel = t("settings.tabs.workspaceAccess");

  const translateInviteStatus = (status: string): string => {
    switch (status) {
      case "accepted":
        return t("settings.workspaceAccess.status.accepted");
      case "pending":
        return t("settings.workspaceAccess.status.pending");
      case "denied":
        return t("settings.workspaceAccess.status.denied");
      case "revoked":
        return t("settings.workspaceAccess.status.revoked");
      case "approved":
        return t("settings.workspaceAccess.status.approved");
      case "active":
        return t("settings.workspaceAccess.status.active");
      case "ended":
        return t("settings.workspaceAccess.status.ended");
      default:
        return status;
    }
  };

  const translatePermissionProfile = (permissionProfile: string): string => {
    switch (permissionProfile) {
      case "full_access":
        return t("settings.workspaceAccess.permission.fullAccess");
      default:
        return permissionProfile;
    }
  };

  const loadWorkspaceAccessState = async (showRefreshState = false) => {
    if (showRefreshState) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [settingsResponse, incomingResponse, outgoingResponse, availableResponse] =
        await Promise.all([
          fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/settings`, {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/invites/incoming`, {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/invites/outgoing`, {
            credentials: "include",
            cache: "no-store",
          }),
          fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/available`, {
            credentials: "include",
            cache: "no-store",
          }),
        ]);

      const [settingsPayload, incomingPayload, outgoingPayload, availablePayload] =
        await Promise.all([
          settingsResponse.json().catch(() => ({})) as Promise<WorkspaceAccessSettingsPayload>,
          incomingResponse.json().catch(() => ({})),
          outgoingResponse.json().catch(() => ({})),
          availableResponse.json().catch(() => ({})),
        ]);

      if (!settingsResponse.ok) {
        throw new Error(
          String((settingsPayload as any)?.error || t("settings.workspaceAccess.errors.loadSettings"))
        );
      }
      if (!incomingResponse.ok) {
        throw new Error(
          String((incomingPayload as any)?.error || t("settings.workspaceAccess.errors.loadIncoming"))
        );
      }
      if (!outgoingResponse.ok) {
        throw new Error(
          String((outgoingPayload as any)?.error || t("settings.workspaceAccess.errors.loadOutgoing"))
        );
      }
      if (!availableResponse.ok) {
        throw new Error(
          String((availablePayload as any)?.error || t("settings.workspaceAccess.errors.loadAvailable"))
        );
      }

      setConnectionPolicy(settingsPayload.settings?.connection_policy || "allow_while_open");
      setIncomingInvites(Array.isArray((incomingPayload as any)?.invites) ? (incomingPayload as any).invites : []);
      setOutgoingInvites(Array.isArray((outgoingPayload as any)?.invites) ? (outgoingPayload as any).invites : []);
      setAvailableAccesses(
        Array.isArray((availablePayload as any)?.accesses) ? (availablePayload as any).accesses : []
      );
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : t("settings.workspaceAccess.errors.loadData")
      );
      setMessageTone("error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadWorkspaceAccessState();
    const intervalId = window.setInterval(() => {
      void loadWorkspaceAccessState(true);
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!waitingSessionId) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await fetch(
          `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions/${encodeURIComponent(waitingSessionId)}`,
          {
            credentials: "include",
            cache: "no-store",
          }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            String(payload?.error || t("settings.workspaceAccess.errors.refreshSession"))
          );
        }

        const session = (payload?.session || null) as WorkspaceSession | null;
        if (!session) {
          return;
        }

        if (session.status === "approved" || session.status === "active") {
          const ownerDisplayLabel =
            buildDisplayLabel(session.owner_handle, session.owner_email) || waitingOwnerLabel;
          requestRemoteWorkspaceWindowOpen({
            sessionId: session.session_id,
            ownerDisplayLabel,
            operatorDisplayLabel: buildDisplayLabel(
              session.operator_handle,
              session.operator_email
            ),
          });
          setWaitingSessionId(null);
          setWaitingOwnerLabel("");
          setMessage(
            t("settings.workspaceAccess.messages.sessionReady", { owner: ownerDisplayLabel })
          );
          setMessageTone("success");
        } else if (["denied", "revoked", "ended"].includes(session.status)) {
          setWaitingSessionId(null);
          setWaitingOwnerLabel("");
          setMessage(t("settings.workspaceAccess.messages.sessionUnavailable"));
          setMessageTone("error");
        }
      } catch (error) {
        setWaitingSessionId(null);
        setWaitingOwnerLabel("");
        setMessage(
          error instanceof Error && error.message
            ? error.message
            : t("settings.workspaceAccess.errors.refreshSession")
        );
        setMessageTone("error");
      }
    }, 3_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [waitingOwnerLabel, waitingSessionId]);

  const handlePolicyChange = async (nextPolicy: string) => {
    const previousPolicy = connectionPolicy;
    setSavingPolicy(true);
    setConnectionPolicy(nextPolicy);

    try {
      const response = await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          connection_policy: nextPolicy,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || t("settings.workspaceAccess.errors.savePolicy")));
      }

      setMessage(t("settings.workspaceAccess.messages.policySaved"));
      setMessageTone("success");
    } catch (error) {
      setConnectionPolicy(previousPolicy);
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : t("settings.workspaceAccess.errors.savePolicy")
      );
      setMessageTone("error");
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleInviteCreate = async () => {
    const query = inviteQuery.trim();
    if (!query) {
      setMessage(t("settings.workspaceAccess.messages.inviteQueryRequired"));
      setMessageTone("error");
      return;
    }

    setInviteSending(true);
    try {
      const response = await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/invites`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          permission_profile: "full_access",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || t("settings.workspaceAccess.errors.createInvite")));
      }

      setInviteQuery("");
      setMessage(t("settings.workspaceAccess.messages.inviteSent"));
      setMessageTone("success");
      await loadWorkspaceAccessState(true);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : t("settings.workspaceAccess.errors.createInvite")
      );
      setMessageTone("error");
    } finally {
      setInviteSending(false);
    }
  };

  const handleInviteAction = async (inviteId: number, action: "accept" | "deny" | "revoke") => {
    const fallbackErrorMessage =
      action === "accept"
        ? t("settings.workspaceAccess.errors.acceptInvite")
        : action === "deny"
        ? t("settings.workspaceAccess.errors.denyInvite")
        : t("settings.workspaceAccess.errors.revokeInvite");

    setActionKey(`${action}:${inviteId}`);
    try {
      const response = await fetch(
        `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/invites/${inviteId}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || fallbackErrorMessage));
      }

      setMessage(
        action === "accept"
          ? t("settings.workspaceAccess.messages.inviteAccepted")
          : action === "deny"
          ? t("settings.workspaceAccess.messages.inviteDenied")
          : t("settings.workspaceAccess.messages.inviteRevoked")
      );
      setMessageTone("success");
      await loadWorkspaceAccessState(true);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : fallbackErrorMessage
      );
      setMessageTone("error");
    } finally {
      setActionKey("");
    }
  };

  const handleOpenWorkspace = async (access: WorkspaceAvailableAccess) => {
    if (!access.owner_online) {
      setMessage(t("settings.workspaceAccess.messages.workspaceOffline"));
      setMessageTone("error");
      return;
    }

    setActionKey(`open:${access.id}`);
    try {
      const response = await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          invite_id: access.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(payload?.error || t("settings.workspaceAccess.errors.createSession"))
        );
      }

      const session = (payload?.session || null) as WorkspaceSession | null;
      if (!session) {
        throw new Error(t("settings.workspaceAccess.errors.invalidSession"));
      }

      const ownerDisplayLabel =
        access.display_label || buildDisplayLabel(session.owner_handle, session.owner_email);

      if (session.status === "approved" || session.status === "active") {
        requestRemoteWorkspaceWindowOpen({
          sessionId: session.session_id,
          ownerDisplayLabel,
          operatorDisplayLabel: buildDisplayLabel(session.operator_handle, session.operator_email),
        });
        setMessage(
          t("settings.workspaceAccess.messages.openingWorkspace", { owner: ownerDisplayLabel })
        );
        setMessageTone("success");
        return;
      }

      setWaitingSessionId(session.session_id);
      setWaitingOwnerLabel(ownerDisplayLabel);
      setMessage(
        t("settings.workspaceAccess.messages.requestingApproval", { owner: ownerDisplayLabel })
      );
      setMessageTone("neutral");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : t("settings.workspaceAccess.errors.openWorkspace")
      );
      setMessageTone("error");
    } finally {
      setActionKey("");
    }
  };

  const messageClassName =
    messageTone === "error"
      ? "border-red-500/20 bg-red-500/10 text-red-100"
      : messageTone === "success"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
      : "border-blue-500/20 bg-blue-500/10 text-blue-100";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-slate-900/50 to-blue-500/10 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
              <MonitorSmartphone className="h-3.5 w-3.5" />
              {workspaceAccessLabel}
            </div>
            <h2 className="text-lg font-semibold text-gray-100">
              {t("settings.workspaceAccess.title", { brand: brand.displayName })}
            </h2>
            <p className="max-w-2xl text-sm text-gray-300">
              {t("settings.workspaceAccess.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadWorkspaceAccessState(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-gray-100 transition-colors hover:bg-white/[0.08]"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw className="h-4 w-4" />
            )}
            {t("settings.workspaceAccess.actions.refresh")}
          </button>
        </div>
      </div>

      {message ? (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${messageClassName}`}>{message}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-gray-800/60 bg-gray-900/50 p-5">
          <div className="mb-4 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-cyan-200" />
            <div>
              <h3 className="text-base font-semibold text-gray-100">
                {t("settings.workspaceAccess.myApp.title")}
              </h3>
              <p className="text-sm text-gray-400">
                {t("settings.workspaceAccess.myApp.description")}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <input
                type="radio"
                name="workspace-access-policy"
                checked={connectionPolicy === "confirm_each_time"}
                onChange={() => void handlePolicyChange("confirm_each_time")}
                disabled={savingPolicy}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-100">
                  {t("settings.workspaceAccess.policy.confirm.title")}
                </span>
                <span className="mt-1 block text-sm text-gray-400">
                  {t("settings.workspaceAccess.policy.confirm.description")}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <input
                type="radio"
                name="workspace-access-policy"
                checked={connectionPolicy === "allow_while_open"}
                onChange={() => void handlePolicyChange("allow_while_open")}
                disabled={savingPolicy}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-100">
                  {t("settings.workspaceAccess.policy.allow.title")}
                </span>
                <span className="mt-1 block text-sm text-gray-400">
                  {t("settings.workspaceAccess.policy.allow.description")}
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800/60 bg-gray-900/50 p-5">
          <div className="mb-4 flex items-center gap-3">
            <Send className="h-5 w-5 text-cyan-200" />
            <div>
              <h3 className="text-base font-semibold text-gray-100">
                {t("settings.workspaceAccess.share.title")}
              </h3>
              <p className="text-sm text-gray-400">
                {t("settings.workspaceAccess.share.description")}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={inviteQuery}
              onChange={(event) => setInviteQuery(event.target.value)}
              placeholder={t("settings.workspaceAccess.share.placeholder")}
              className="min-h-[44px] flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 text-sm text-gray-100 outline-none transition-colors focus:border-cyan-400/40"
            />
            <button
              type="button"
              onClick={() => void handleInviteCreate()}
              disabled={inviteSending}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {inviteSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("settings.workspaceAccess.actions.sendInvite")}
            </button>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-gray-800/60 bg-gray-900/50 p-5 xl:col-span-1">
          <h3 className="text-base font-semibold text-gray-100">
            {t("settings.workspaceAccess.sections.incoming")}
          </h3>
          <div className="mt-4 space-y-3">
            {!loading && incomingInvites.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-500">
                {t("settings.workspaceAccess.empty.incoming")}
              </div>
            ) : null}

            {incomingInvites.map((invite) => {
              const label = buildDisplayLabel(invite.owner_handle, invite.owner_email);
              const busy = actionKey === `accept:${invite.id}` || actionKey === `deny:${invite.id}`;
              return (
                <div
                  key={invite.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-100">{label}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                        {translatePermissionProfile(invite.permission_profile)}
                      </p>
                    </div>
                    {invite.status === "accepted" ? (
                      <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                        {t("settings.workspaceAccess.status.accepted")}
                      </span>
                    ) : invite.status === "pending" ? (
                      <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100">
                        {t("settings.workspaceAccess.status.pending")}
                      </span>
                    ) : (
                      <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-semibold text-gray-300">
                        {translateInviteStatus(invite.status)}
                      </span>
                    )}
                  </div>

                  {invite.status === "pending" ? (
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleInviteAction(invite.id, "accept")}
                        disabled={busy}
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 disabled:opacity-70"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {t("settings.workspaceAccess.actions.accept")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleInviteAction(invite.id, "deny")}
                        disabled={busy}
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-gray-100 transition-colors hover:bg-white/[0.08] disabled:opacity-70"
                      >
                        <XCircle className="h-4 w-4" />
                        {t("settings.workspaceAccess.actions.deny")}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800/60 bg-gray-900/50 p-5 xl:col-span-1">
          <h3 className="text-base font-semibold text-gray-100">
            {t("settings.workspaceAccess.sections.outgoing")}
          </h3>
          <div className="mt-4 space-y-3">
            {!loading && outgoingInvites.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-500">
                {t("settings.workspaceAccess.empty.outgoing")}
              </div>
            ) : null}

            {outgoingInvites.map((invite) => {
              const label = buildDisplayLabel(invite.invitee_handle, invite.invitee_email);
              const busy = actionKey === `revoke:${invite.id}`;
              return (
                <div
                  key={invite.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-100">{label}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                        {translateInviteStatus(invite.status)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleInviteAction(invite.id, "revoke")}
                      disabled={busy}
                      className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-gray-100 transition-colors hover:bg-white/[0.08] disabled:opacity-70"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("settings.workspaceAccess.actions.revoke")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-800/60 bg-gray-900/50 p-5 xl:col-span-1">
          <h3 className="text-base font-semibold text-gray-100">
            {t("settings.workspaceAccess.sections.available")}
          </h3>
          <div className="mt-4 space-y-3">
            {!loading && availableAccesses.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-500">
                {t("settings.workspaceAccess.empty.available")}
              </div>
            ) : null}

            {availableAccesses.map((access) => {
              const busy = actionKey === `open:${access.id}` && !waitingSessionId;
              const waiting = waitingSessionId !== null && waitingSessionId.length > 0 && waitingOwnerLabel === access.display_label;
              const availabilityClassName = access.owner_online
                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                : "border-red-400/20 bg-red-500/10 text-red-100";
              const availabilityDotClassName = access.owner_online
                ? "bg-emerald-400 shadow-[0_0_16px_rgba(74,222,128,0.95)]"
                : "bg-red-400 shadow-[0_0_16px_rgba(248,113,113,0.95)]";
              return (
                <div
                  key={access.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-sm font-semibold text-gray-100">
                        {access.display_label}
                      </p>
                      <div
                        className={`mt-2 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${availabilityClassName}`}
                      >
                        <span
                          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${availabilityDotClassName}`}
                        />
                        <span className="truncate">
                          {access.owner_online
                            ? t("settings.workspaceAccess.availability.online")
                            : t("settings.workspaceAccess.availability.offline")}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenWorkspace(access)}
                      disabled={!access.owner_online || busy || waiting}
                      className="inline-flex min-h-[40px] w-full max-w-full flex-none items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-center text-sm font-semibold leading-5 text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[11.5rem]"
                    >
                      {busy || waiting ? (
                        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                      ) : (
                        <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      )}
                      {waiting
                        ? t("settings.workspaceAccess.actions.waiting")
                        : t("settings.workspaceAccess.actions.open")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-gray-300">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.workspaceAccess.loading")}
          </div>
        </div>
      ) : null}

      {!isDesktopShell() ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {t("settings.workspaceAccess.browserNotice")}
        </div>
      ) : null}
    </div>
  );
}

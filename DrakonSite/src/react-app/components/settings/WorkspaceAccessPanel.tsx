import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { brand } from "@/shared/brand";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MonitorSmartphone,
  RefreshCcw,
  Send,
  ShieldCheck,
  X,
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
  full_access: boolean;
  permissions?: {
    view_cameras?: boolean;
    execute_cameras?: boolean;
    view_tasks?: boolean;
    execute_tasks?: boolean;
    view_agents?: boolean;
    execute_agents?: boolean;
  };
  resource_scopes?: Partial<ResourceScopeState> | null;
  resource_grants?: Partial<ResourceGrantState> | null;
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

type PermissionState = {
  view_cameras: boolean;
  execute_cameras: boolean;
  view_tasks: boolean;
  execute_tasks: boolean;
  view_agents: boolean;
  execute_agents: boolean;
};

type ResourceScopeMode = "all" | "selected";
type ResourceScopeSet = {
  view: ResourceScopeMode;
  execute: ResourceScopeMode;
};

type ResourceScopeState = {
  cameras: ResourceScopeSet;
  jobs: ResourceScopeSet;
  agents: ResourceScopeSet;
};

type NumericGrantState = {
  viewIds: number[];
  executeIds: number[];
};

type AgentGrantState = {
  viewIds: string[];
  executeIds: string[];
};

type ResourceGrantState = {
  cameras: NumericGrantState;
  jobs: NumericGrantState;
  agents: AgentGrantState;
};

type CameraCatalogItem = {
  id: number;
  name: string;
  description?: string | null;
  is_service_running?: boolean;
  is_online?: boolean;
};

type JobCatalogItem = {
  id: number;
  name: string;
  status?: string | null;
  schedule_mode?: string | null;
  step_count?: number;
};

type AgentCatalogItem = {
  key: string;
  agent_kind: "camera_algorithm" | "job_step_agent";
  agent_id: number;
  display_name: string;
  summary?: string | null;
  parent_camera_name?: string | null;
  parent_job_name?: string | null;
  parent_step_name?: string | null;
  is_active?: boolean;
};

type ResourceCatalog = {
  cameras: CameraCatalogItem[];
  jobs: JobCatalogItem[];
  agents: AgentCatalogItem[];
};

type ResolvedWorkspaceAccessUser = {
  public_id: string;
  email: string;
  handle: string | null;
  display_label: string;
};

type ResourceOption = {
  id: number | string;
  title: string;
  subtitle: string;
  inactive: boolean;
};

type ModuleKey = "cameras" | "jobs" | "agents";

type InviteDraftState = {
  fullAccess: boolean;
  permissions: PermissionState;
  resourceScopes: ResourceScopeState;
  resourceGrants: ResourceGrantState;
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

function buildEmptyPermissions(): PermissionState {
  return {
    view_cameras: false,
    execute_cameras: false,
    view_tasks: false,
    execute_tasks: false,
    view_agents: false,
    execute_agents: false,
  };
}

function buildAllResourceScopes(): ResourceScopeState {
  return {
    cameras: { view: "all", execute: "all" },
    jobs: { view: "all", execute: "all" },
    agents: { view: "all", execute: "all" },
  };
}

function buildEmptyResourceGrants(): ResourceGrantState {
  return {
    cameras: { viewIds: [], executeIds: [] },
    jobs: { viewIds: [], executeIds: [] },
    agents: { viewIds: [], executeIds: [] },
  };
}

function buildEmptyResourceCatalog(): ResourceCatalog {
  return {
    cameras: [],
    jobs: [],
    agents: [],
  };
}

function buildDefaultInviteDraft(): InviteDraftState {
  return {
    fullAccess: true,
    permissions: buildEmptyPermissions(),
    resourceScopes: buildAllResourceScopes(),
    resourceGrants: buildEmptyResourceGrants(),
  };
}

function normalizeResourceCatalog(value?: Partial<ResourceCatalog> | null): ResourceCatalog {
  const source = value && typeof value === "object" ? value : {};

  return {
    cameras: Array.isArray(source.cameras)
      ? source.cameras
          .map((item) => ({
            id: Number((item as CameraCatalogItem)?.id || 0),
            name: String((item as CameraCatalogItem)?.name || "").trim(),
            description:
              typeof (item as CameraCatalogItem)?.description === "string"
                ? (item as CameraCatalogItem).description
                : null,
            is_service_running: Boolean((item as CameraCatalogItem)?.is_service_running),
            is_online: Boolean((item as CameraCatalogItem)?.is_online),
          }))
          .filter((item) => Number.isInteger(item.id) && item.id > 0)
      : [],
    jobs: Array.isArray(source.jobs)
      ? source.jobs
          .map((item) => ({
            id: Number((item as JobCatalogItem)?.id || 0),
            name: String((item as JobCatalogItem)?.name || "").trim(),
            status:
              typeof (item as JobCatalogItem)?.status === "string"
                ? (item as JobCatalogItem).status
                : null,
            schedule_mode:
              typeof (item as JobCatalogItem)?.schedule_mode === "string"
                ? (item as JobCatalogItem).schedule_mode
                : null,
            step_count: Number((item as JobCatalogItem)?.step_count || 0),
          }))
          .filter((item) => Number.isInteger(item.id) && item.id > 0)
      : [],
    agents: Array.isArray(source.agents)
      ? source.agents
          .map<AgentCatalogItem>((item) => ({
            key: String((item as AgentCatalogItem)?.key || "").trim(),
            agent_kind:
              (item as AgentCatalogItem)?.agent_kind === "job_step_agent"
                ? "job_step_agent"
                : "camera_algorithm",
            agent_id: Number((item as AgentCatalogItem)?.agent_id || 0),
            display_name: String((item as AgentCatalogItem)?.display_name || "").trim(),
            summary:
              typeof (item as AgentCatalogItem)?.summary === "string"
                ? (item as AgentCatalogItem).summary
                : null,
            parent_camera_name:
              typeof (item as AgentCatalogItem)?.parent_camera_name === "string"
                ? (item as AgentCatalogItem).parent_camera_name
                : null,
            parent_job_name:
              typeof (item as AgentCatalogItem)?.parent_job_name === "string"
                ? (item as AgentCatalogItem).parent_job_name
                : null,
            parent_step_name:
              typeof (item as AgentCatalogItem)?.parent_step_name === "string"
                ? (item as AgentCatalogItem).parent_step_name
                : null,
            is_active:
              (item as AgentCatalogItem)?.is_active === undefined
                ? true
                : Boolean((item as AgentCatalogItem)?.is_active),
          }))
          .filter((item) => item.key.length > 0 && Number.isInteger(item.agent_id) && item.agent_id > 0)
      : [],
  };
}

function toggleArrayValue<T extends string | number>(values: T[], value: T, checked: boolean): T[] {
  const next = new Set(values);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return Array.from(next).sort((left, right) => {
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left).localeCompare(String(right));
  });
}

function hasAnyWorkspaceInvitePermission(permissions: PermissionState): boolean {
  return Object.values(permissions).some(Boolean);
}

function buildWorkspaceInviteSummary(invite: WorkspaceInvite, t: any): string {
  if (invite.full_access) {
    return t("settings.workspaceAccess.permission.fullAccess");
  }

  const labels: string[] = [];
  if (invite.permissions?.view_cameras || invite.permissions?.execute_cameras) {
    labels.push(t("settings.usersRights.permissions.cameras"));
  }
  if (invite.permissions?.view_tasks || invite.permissions?.execute_tasks) {
    labels.push(t("settings.usersRights.permissions.tasks"));
  }
  if (invite.permissions?.view_agents || invite.permissions?.execute_agents) {
    labels.push(t("settings.usersRights.permissions.agents"));
  }

  if (labels.length === 0) {
    return t("settings.workspaceAccess.permission.scopedAccess");
  }

  return `${t("settings.workspaceAccess.permission.scopedAccess")} · ${labels.join(", ")}`;
}

type ScopeSelectorProps = {
  title: string;
  mode: ResourceScopeMode;
  selectedIds: Array<number | string>;
  items: ResourceOption[];
  disabled: boolean;
  t: any;
  onModeChange: (mode: ResourceScopeMode) => void;
  onToggle: (id: number | string, checked: boolean) => void;
};

function ScopeSelector({
  title,
  mode,
  selectedIds,
  items,
  disabled,
  t,
  onModeChange,
  onToggle,
}: ScopeSelectorProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
          {title}
        </span>
        {mode === "selected" ? (
          <span className="text-xs text-gray-500">
            {t("settings.usersRights.scope.selectedCount", {
              count: selectedIds.length,
              defaultValue: "{{count}} selected",
            })}
          </span>
        ) : null}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onModeChange("all")}
          disabled={disabled}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            mode === "all"
              ? "bg-cyan-500 text-slate-950"
              : "border border-white/10 bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]"
          }`}
        >
          {t("settings.usersRights.scope.all")}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("selected")}
          disabled={disabled}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
            mode === "selected"
              ? "bg-cyan-500 text-slate-950"
              : "border border-white/10 bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]"
          }`}
        >
          {t("settings.usersRights.scope.selected")}
        </button>
      </div>

      {mode === "selected" ? (
        <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-sm text-gray-500">
              {t("settings.usersRights.scope.noneAvailable")}
            </div>
          ) : null}
          {items.map((item) => (
            <label
              key={String(item.id)}
              className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(item.id)}
                disabled={disabled}
                onChange={(event) => onToggle(item.id, event.target.checked)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-100">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-gray-400">{item.subtitle}</span>
                {item.inactive ? (
                  <span className="mt-1 inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-400">
                    {t("settings.usersRights.scope.inactive")}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function WorkspaceAccessPanel() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [inviteResolving, setInviteResolving] = useState(false);
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteDialogError, setInviteDialogError] = useState("");
  const [resolvedInvitee, setResolvedInvitee] = useState<ResolvedWorkspaceAccessUser | null>(null);
  const [inviteDraft, setInviteDraft] = useState<InviteDraftState>(buildDefaultInviteDraft());
  const [connectionPolicy, setConnectionPolicy] = useState("allow_while_open");
  const [incomingInvites, setIncomingInvites] = useState<WorkspaceInvite[]>([]);
  const [outgoingInvites, setOutgoingInvites] = useState<WorkspaceInvite[]>([]);
  const [availableAccesses, setAvailableAccesses] = useState<WorkspaceAvailableAccess[]>([]);
  const [resourceCatalog, setResourceCatalog] = useState<ResourceCatalog>(buildEmptyResourceCatalog());
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success" | "neutral">("neutral");
  const [waitingSessionId, setWaitingSessionId] = useState<string | null>(null);
  const [waitingOwnerLabel, setWaitingOwnerLabel] = useState("");
  const [actionKey, setActionKey] = useState("");
  const workspaceAccessLabel = t("settings.tabs.workspaceAccess");

  const resourceOptions = useMemo(
    () => ({
      cameras: resourceCatalog.cameras.map((camera) => ({
        id: camera.id,
        title: camera.name,
        subtitle: [camera.description].filter(Boolean).join(" - "),
        inactive: camera.is_online === false && camera.is_service_running === false,
      })),
      jobs: resourceCatalog.jobs.map((job) => ({
        id: job.id,
        title: job.name,
        subtitle: [job.status, job.schedule_mode].filter(Boolean).join(" - "),
        inactive: typeof job.status === "string" && job.status.trim().toLowerCase() === "stopped",
      })),
      agents: resourceCatalog.agents.map((agent) => ({
        id: agent.key,
        title: agent.display_name,
        subtitle:
          [
            agent.summary,
            agent.parent_camera_name,
            agent.parent_job_name,
            agent.parent_step_name,
          ]
            .filter(Boolean)
            .join(" - ") || agent.agent_kind,
        inactive: agent.is_active === false,
      })),
    }),
    [resourceCatalog]
  );

  const permissionEntries = useMemo(
    () => [
      {
        key: "cameras" as ModuleKey,
        label: t("settings.usersRights.permissions.cameras"),
        viewKey: "view_cameras" as const,
        executeKey: "execute_cameras" as const,
        items: resourceOptions.cameras,
      },
      {
        key: "jobs" as ModuleKey,
        label: t("settings.usersRights.permissions.tasks"),
        viewKey: "view_tasks" as const,
        executeKey: "execute_tasks" as const,
        items: resourceOptions.jobs,
      },
      {
        key: "agents" as ModuleKey,
        label: t("settings.usersRights.permissions.agents"),
        viewKey: "view_agents" as const,
        executeKey: "execute_agents" as const,
        items: resourceOptions.agents,
      },
    ],
    [resourceOptions, t]
  );

  const resetInviteDialog = () => {
    setInviteDialogOpen(false);
    setInviteDialogError("");
    setResolvedInvitee(null);
    setInviteDraft(buildDefaultInviteDraft());
  };

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

  const loadWorkspaceAccessState = async (showRefreshState = false) => {
    if (showRefreshState) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const [settingsResponse, incomingResponse, outgoingResponse, availableResponse, catalogResponse] =
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
          fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/resource-catalog`, {
            credentials: "include",
            cache: "no-store",
          }).catch(() => null),
        ]);

      const [settingsPayload, incomingPayload, outgoingPayload, availablePayload, catalogPayload] =
        await Promise.all([
          settingsResponse.json().catch(() => ({})) as Promise<WorkspaceAccessSettingsPayload>,
          incomingResponse.json().catch(() => ({})),
          outgoingResponse.json().catch(() => ({})),
          availableResponse.json().catch(() => ({})),
          catalogResponse
            ? catalogResponse.json().catch(() => ({}))
            : Promise.resolve({}),
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
      setResourceCatalog(
        catalogResponse?.ok
          ? normalizeResourceCatalog((catalogPayload as any)?.resource_catalog)
          : buildEmptyResourceCatalog()
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

  const handleInvitePrepare = async () => {
    const query = inviteQuery.trim();
    if (!query) {
      setMessage(t("settings.workspaceAccess.messages.inviteQueryRequired"));
      setMessageTone("error");
      return;
    }

    setInviteResolving(true);
    try {
      const response = await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/users/resolve`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(payload?.error || t("settings.workspaceAccess.errors.resolveInvitee"))
        );
      }

      const user = (payload as any)?.user;
      if (!user || typeof user !== "object") {
        throw new Error(t("settings.workspaceAccess.errors.resolveInvitee"));
      }

      setResolvedInvitee({
        public_id: String((user as any)?.public_id || "").trim(),
        email: String((user as any)?.email || "").trim(),
        handle: typeof (user as any)?.handle === "string" ? (user as any).handle : null,
        display_label:
          String((user as any)?.display_label || "").trim() ||
          buildDisplayLabel((user as any)?.handle, (user as any)?.email),
      });
      setInviteDraft(buildDefaultInviteDraft());
      setInviteDialogError("");
      setInviteDialogOpen(true);
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : t("settings.workspaceAccess.errors.resolveInvitee")
      );
      setMessageTone("error");
    } finally {
      setInviteResolving(false);
    }
  };

  const handleInvitePermissionToggle = (
    key: keyof PermissionState,
    checked: boolean
  ) => {
    setInviteDraft((current) => {
      const nextPermissions = { ...current.permissions, [key]: checked };

      if (key === "view_cameras" && !checked) {
        nextPermissions.execute_cameras = false;
      } else if (key === "execute_cameras" && checked) {
        nextPermissions.view_cameras = true;
      } else if (key === "view_tasks" && !checked) {
        nextPermissions.execute_tasks = false;
      } else if (key === "execute_tasks" && checked) {
        nextPermissions.view_tasks = true;
      } else if (key === "view_agents" && !checked) {
        nextPermissions.execute_agents = false;
      } else if (key === "execute_agents" && checked) {
        nextPermissions.view_agents = true;
      }

      return {
        ...current,
        permissions: nextPermissions,
      };
    });
  };

  const handleInviteScopeModeChange = (
    module: ModuleKey,
    action: "view" | "execute",
    mode: ResourceScopeMode
  ) => {
    setInviteDraft((current) => ({
      ...current,
      resourceScopes: {
        ...current.resourceScopes,
        [module]: {
          ...current.resourceScopes[module],
          [action]: mode,
        },
      },
    }));
  };

  const handleInviteGrantToggle = (
    module: ModuleKey,
    action: "view" | "execute",
    value: number | string,
    checked: boolean
  ) => {
    setInviteDraft((current) => {
      const next = {
        ...current,
        resourceGrants: {
          cameras: { ...current.resourceGrants.cameras },
          jobs: { ...current.resourceGrants.jobs },
          agents: { ...current.resourceGrants.agents },
        },
      };

      if (module === "cameras" || module === "jobs") {
        const target = next.resourceGrants[module];
        const numericValue = Number(value);
        if (!Number.isInteger(numericValue) || numericValue <= 0) {
          return current;
        }
        target[`${action}Ids` as "viewIds" | "executeIds"] = toggleArrayValue(
          target[`${action}Ids` as "viewIds" | "executeIds"],
          numericValue,
          checked
        );
        if (action === "execute" && checked) {
          target.viewIds = toggleArrayValue(target.viewIds, numericValue, true);
        }
      } else {
        const stringValue = String(value || "").trim();
        if (!stringValue) {
          return current;
        }
        const target = next.resourceGrants.agents;
        target[`${action}Ids` as "viewIds" | "executeIds"] = toggleArrayValue(
          target[`${action}Ids` as "viewIds" | "executeIds"],
          stringValue,
          checked
        );
        if (action === "execute" && checked) {
          target.viewIds = toggleArrayValue(target.viewIds, stringValue, true);
        }
      }

      return next;
    });
  };

  const handleInviteSubmit = async () => {
    if (!resolvedInvitee?.public_id) {
      setInviteDialogError(t("settings.workspaceAccess.errors.resolveInvitee"));
      return;
    }

    if (!inviteDraft.fullAccess && !hasAnyWorkspaceInvitePermission(inviteDraft.permissions)) {
      setInviteDialogError(t("settings.workspaceAccess.messages.permissionRequired"));
      return;
    }

    setInviteSending(true);
    setInviteDialogError("");
    try {
      const response = await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/invites`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: inviteQuery.trim(),
          invitee_public_id: resolvedInvitee.public_id,
          permission_profile: inviteDraft.fullAccess ? "full_access" : "scoped_access",
          full_access: inviteDraft.fullAccess,
          permissions: inviteDraft.permissions,
          resource_scopes: inviteDraft.resourceScopes,
          resource_grants: inviteDraft.resourceGrants,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || t("settings.workspaceAccess.errors.createInvite")));
      }

      setInviteQuery("");
      resetInviteDialog();
      setMessage(t("settings.workspaceAccess.messages.inviteSent"));
      setMessageTone("success");
      await loadWorkspaceAccessState(true);
    } catch (error) {
      const nextMessage =
        error instanceof Error && error.message
          ? error.message
          : t("settings.workspaceAccess.errors.createInvite");
      setInviteDialogError(nextMessage);
      setMessage(nextMessage);
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
              onClick={() => void handleInvitePrepare()}
              disabled={inviteSending || inviteResolving}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {inviteResolving || inviteSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
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
                      <p className="mt-1 text-xs leading-5 text-cyan-200/80">
                        {buildWorkspaceInviteSummary(invite, t).replace("Â·", "-")}
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
                      <p className="mt-1 text-xs leading-5 text-cyan-200/80">
                        {buildWorkspaceInviteSummary(invite, t).replace("Â·", "-")}
                      </p>
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
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        title={access.display_label}
                        className="truncate whitespace-nowrap text-sm font-semibold text-gray-100"
                      >
                        {access.display_label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-cyan-200/80">
                        {buildWorkspaceInviteSummary(access, t).replace("Â·", "-")}
                      </p>
                      <div
                        className={`mt-2 inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${availabilityClassName}`}
                      >
                        <span
                          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${availabilityDotClassName}`}
                        />
                        <span className="whitespace-nowrap">
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
                      className="inline-flex min-h-[40px] w-full max-w-full flex-none items-center justify-center gap-2 self-start rounded-xl bg-cyan-500 px-4 py-2 text-center text-sm font-semibold leading-5 text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[11.5rem]"
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

      {inviteDialogOpen ? (
        <div className="fixed inset-0 z-[140]">
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => {
              if (!inviteSending) {
                resetInviteDialog();
              }
            }}
          />
          <div className="relative flex min-h-full items-center justify-center px-4 py-6">
            <div className="w-full max-w-5xl rounded-[28px] border border-white/10 bg-[#06080d] shadow-[0_48px_120px_-48px_rgba(0,0,0,0.95)]">
              <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
                    {workspaceAccessLabel}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-gray-100">
                    {t("settings.workspaceAccess.inviteDialog.title")}
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                    {t("settings.workspaceAccess.inviteDialog.description")}
                  </p>
                  {resolvedInvitee ? (
                    <p className="mt-3 text-sm text-gray-200">
                      <span className="text-gray-500">
                        {t("settings.workspaceAccess.inviteDialog.inviteeLabel")}
                      </span>{" "}
                      {resolvedInvitee.display_label || buildDisplayLabel(resolvedInvitee.handle, resolvedInvitee.email)}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => resetInviteDialog()}
                  disabled={inviteSending}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="grid gap-3 lg:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInviteDraft((current) => ({ ...current, fullAccess: true }));
                      setInviteDialogError("");
                    }}
                    disabled={inviteSending}
                    className={`rounded-2xl border p-4 text-left transition-colors ${
                      inviteDraft.fullAccess
                        ? "border-cyan-400/40 bg-cyan-500/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-100">
                      {t("settings.workspaceAccess.permission.fullAccess")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-gray-400">
                      {t("settings.workspaceAccess.inviteDialog.fullAccessDescription")}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setInviteDraft((current) => ({ ...current, fullAccess: false }));
                      setInviteDialogError("");
                    }}
                    disabled={inviteSending}
                    className={`rounded-2xl border p-4 text-left transition-colors ${
                      !inviteDraft.fullAccess
                        ? "border-cyan-400/40 bg-cyan-500/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-100">
                      {t("settings.workspaceAccess.permission.scopedAccess")}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-gray-400">
                      {t("settings.workspaceAccess.inviteDialog.scopedAccessDescription")}
                    </p>
                  </button>
                </div>

                {!inviteDraft.fullAccess ? (
                  <div className="grid gap-4 xl:grid-cols-3">
                    {permissionEntries.map((entry) => {
                      const viewEnabled = inviteDraft.permissions[entry.viewKey];
                      const executeEnabled = inviteDraft.permissions[entry.executeKey];
                      const selectedViewIds =
                        entry.key === "cameras"
                          ? inviteDraft.resourceGrants.cameras.viewIds
                          : entry.key === "jobs"
                          ? inviteDraft.resourceGrants.jobs.viewIds
                          : inviteDraft.resourceGrants.agents.viewIds;
                      const selectedExecuteIds =
                        entry.key === "cameras"
                          ? inviteDraft.resourceGrants.cameras.executeIds
                          : entry.key === "jobs"
                          ? inviteDraft.resourceGrants.jobs.executeIds
                          : inviteDraft.resourceGrants.agents.executeIds;

                      return (
                        <div
                          key={entry.key}
                          className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                        >
                          <p className="text-base font-semibold text-gray-100">{entry.label}</p>
                          <div className="mt-4 space-y-4">
                            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                              <label className="flex items-center gap-3 text-sm text-gray-100">
                                <input
                                  type="checkbox"
                                  checked={viewEnabled}
                                  disabled={inviteSending}
                                  onChange={(event) =>
                                    handleInvitePermissionToggle(entry.viewKey, event.target.checked)
                                  }
                                />
                                {t("settings.usersRights.permissions.view")}
                              </label>
                              {viewEnabled ? (
                                <div className="mt-3">
                                  <ScopeSelector
                                    title={t("settings.usersRights.scope.viewTitle")}
                                    mode={inviteDraft.resourceScopes[entry.key].view}
                                    selectedIds={selectedViewIds}
                                    items={entry.items}
                                    disabled={inviteSending}
                                    t={t}
                                    onModeChange={(mode) =>
                                      handleInviteScopeModeChange(entry.key, "view", mode)
                                    }
                                    onToggle={(id, checked) =>
                                      handleInviteGrantToggle(entry.key, "view", id, checked)
                                    }
                                  />
                                </div>
                              ) : null}
                            </div>

                            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                              <label className="flex items-center gap-3 text-sm text-gray-100">
                                <input
                                  type="checkbox"
                                  checked={executeEnabled}
                                  disabled={inviteSending}
                                  onChange={(event) =>
                                    handleInvitePermissionToggle(entry.executeKey, event.target.checked)
                                  }
                                />
                                {t("settings.usersRights.permissions.execute")}
                              </label>
                              {executeEnabled ? (
                                <div className="mt-3">
                                  <ScopeSelector
                                    title={t("settings.usersRights.scope.executeTitle")}
                                    mode={inviteDraft.resourceScopes[entry.key].execute}
                                    selectedIds={selectedExecuteIds}
                                    items={entry.items}
                                    disabled={inviteSending}
                                    t={t}
                                    onModeChange={(mode) =>
                                      handleInviteScopeModeChange(entry.key, "execute", mode)
                                    }
                                    onToggle={(id, checked) =>
                                      handleInviteGrantToggle(entry.key, "execute", id, checked)
                                    }
                                  />
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                    {t("settings.workspaceAccess.inviteDialog.fullAccessNotice")}
                  </div>
                )}

                {inviteDialogError ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    <div className="inline-flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{inviteDialogError}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 border-t border-white/10 px-6 py-5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => resetInviteDialog()}
                  disabled={inviteSending}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-gray-200 transition-colors hover:bg-white/[0.08] disabled:opacity-60"
                >
                  {t("settings.workspaceAccess.actions.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleInviteSubmit()}
                  disabled={inviteSending || inviteResolving}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-cyan-500 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {inviteSending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {t("settings.workspaceAccess.actions.sendInvite")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

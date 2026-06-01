import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Shield,
  UserPlus,
  Users,
} from "lucide-react";

type PermissionState = {
  view_cameras: boolean;
  execute_cameras: boolean;
  view_tasks: boolean;
  execute_tasks: boolean;
  view_agents: boolean;
  execute_agents: boolean;
  chat: boolean;
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
  updated_at?: string | null;
};

type JobCatalogItem = {
  id: number;
  name: string;
  status?: string | null;
  schedule_mode?: string | null;
  step_count?: number;
  updated_at?: string | null;
};

type AgentCatalogItem = {
  key: string;
  agent_kind: "camera_algorithm" | "job_step_agent";
  agent_id: number;
  display_name: string;
  summary?: string | null;
  agent_key?: string | null;
  parent_camera_id?: number | null;
  parent_camera_name?: string | null;
  parent_job_id?: number | null;
  parent_job_name?: string | null;
  parent_step_id?: number | null;
  parent_step_name?: string | null;
  is_active?: boolean;
  updated_at?: string | null;
};

type ResourceCatalog = {
  cameras: CameraCatalogItem[];
  jobs: JobCatalogItem[];
  agents: AgentCatalogItem[];
};

type AccountUserRecord = {
  member_user_id: string;
  account_user_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "disabled";
  password_management_mode: "self_service" | "admin_managed";
  is_owner: boolean;
  is_admin: boolean;
  can_manage_settings: boolean;
  full_access: boolean;
  permissions: PermissionState;
  resource_scopes?: Partial<ResourceScopeState> | null;
  resource_grants?: Partial<ResourceGrantState> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type AccountUsersResponse = {
  success?: boolean;
  actor_user_id?: string;
  account_user_id?: string;
  role?: string;
  users?: AccountUserRecord[];
  can_assign_admin?: boolean;
  resource_catalog?: Partial<ResourceCatalog> | null;
};

type EditorState = {
  role: "admin" | "member";
  status: "active" | "disabled";
  fullAccess: boolean;
  permissions: PermissionState;
  resourceScopes: ResourceScopeState;
  resourceGrants: ResourceGrantState;
  password: string;
  saveMessage: string;
  saveMessageType: "success" | "error" | null;
  passwordMessage: string;
  passwordMessageType: "success" | "error" | null;
  isSaving: boolean;
  isResettingPassword: boolean;
};

type CreateFormState = {
  email: string;
  password: string;
  role: "admin" | "member";
  fullAccess: boolean;
  permissions: PermissionState;
  resourceScopes: ResourceScopeState;
  resourceGrants: ResourceGrantState;
};

type ModuleKey = "cameras" | "jobs" | "agents";
type ModuleAction = "view" | "execute";

type ResourceOption = {
  id: number | string;
  title: string;
  subtitle: string;
  inactive: boolean;
};

type PermissionEntry = {
  key: ModuleKey;
  label: string;
  viewKey: keyof PermissionState;
  executeKey: keyof PermissionState;
  viewValue: boolean;
  executeValue: boolean;
  items: ResourceOption[];
};

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

function buildEmptyPermissions(): PermissionState {
  return {
    view_cameras: false,
    execute_cameras: false,
    view_tasks: false,
    execute_tasks: false,
    view_agents: false,
    execute_agents: false,
    chat: false,
  };
}

function buildFullPermissions(): PermissionState {
  return {
    view_cameras: true,
    execute_cameras: true,
    view_tasks: true,
    execute_tasks: true,
    view_agents: true,
    execute_agents: true,
    chat: true,
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

function normalizeResourceScopeMode(value: unknown): ResourceScopeMode {
  return value === "selected" ? "selected" : "all";
}

function normalizeResourceScopes(value?: Partial<ResourceScopeState> | null): ResourceScopeState {
  const source = value && typeof value === "object" ? value : {};
  return {
    cameras: {
      view: normalizeResourceScopeMode(source.cameras?.view),
      execute: normalizeResourceScopeMode(source.cameras?.execute),
    },
    jobs: {
      view: normalizeResourceScopeMode(source.jobs?.view),
      execute: normalizeResourceScopeMode(source.jobs?.execute),
    },
    agents: {
      view: normalizeResourceScopeMode(source.agents?.view),
      execute: normalizeResourceScopeMode(source.agents?.execute),
    },
  };
}

function normalizeNumberArray(values: unknown): number[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  ).sort((left, right) => left - right);
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : String(value ?? "").trim()))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeNumericGrantState(value: Partial<NumericGrantState> | null | undefined): NumericGrantState {
  const executeIds = normalizeNumberArray(value?.executeIds);
  const viewIds = normalizeNumberArray([...(value?.viewIds || []), ...executeIds]);
  return {
    viewIds,
    executeIds,
  };
}

function normalizeAgentGrantState(value: Partial<AgentGrantState> | null | undefined): AgentGrantState {
  const executeIds = normalizeStringArray(value?.executeIds);
  const viewIds = normalizeStringArray([...(value?.viewIds || []), ...executeIds]);
  return {
    viewIds,
    executeIds,
  };
}

function normalizeResourceGrants(value?: Partial<ResourceGrantState> | null): ResourceGrantState {
  return {
    cameras: normalizeNumericGrantState(value?.cameras),
    jobs: normalizeNumericGrantState(value?.jobs),
    agents: normalizeAgentGrantState(value?.agents),
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
            updated_at:
              typeof (item as CameraCatalogItem)?.updated_at === "string"
                ? (item as CameraCatalogItem).updated_at
                : null,
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
            updated_at:
              typeof (item as JobCatalogItem)?.updated_at === "string"
                ? (item as JobCatalogItem).updated_at
                : null,
          }))
          .filter((item) => Number.isInteger(item.id) && item.id > 0)
      : [],
    agents: Array.isArray(source.agents)
      ? source.agents
          .map((item) => ({
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
            agent_key:
              typeof (item as AgentCatalogItem)?.agent_key === "string"
                ? (item as AgentCatalogItem).agent_key
                : null,
            parent_camera_id:
              (item as AgentCatalogItem)?.parent_camera_id === null ||
              (item as AgentCatalogItem)?.parent_camera_id === undefined
                ? null
                : Number((item as AgentCatalogItem).parent_camera_id),
            parent_camera_name:
              typeof (item as AgentCatalogItem)?.parent_camera_name === "string"
                ? (item as AgentCatalogItem).parent_camera_name
                : null,
            parent_job_id:
              (item as AgentCatalogItem)?.parent_job_id === null ||
              (item as AgentCatalogItem)?.parent_job_id === undefined
                ? null
                : Number((item as AgentCatalogItem).parent_job_id),
            parent_job_name:
              typeof (item as AgentCatalogItem)?.parent_job_name === "string"
                ? (item as AgentCatalogItem).parent_job_name
                : null,
            parent_step_id:
              (item as AgentCatalogItem)?.parent_step_id === null ||
              (item as AgentCatalogItem)?.parent_step_id === undefined
                ? null
                : Number((item as AgentCatalogItem).parent_step_id),
            parent_step_name:
              typeof (item as AgentCatalogItem)?.parent_step_name === "string"
                ? (item as AgentCatalogItem).parent_step_name
                : null,
            is_active:
              (item as AgentCatalogItem)?.is_active === undefined
                ? true
                : Boolean((item as AgentCatalogItem)?.is_active),
            updated_at:
              typeof (item as AgentCatalogItem)?.updated_at === "string"
                ? (item as AgentCatalogItem).updated_at
                : null,
          }) as AgentCatalogItem)
          .filter(
            (item) =>
              Number.isInteger(item.agent_id) &&
              item.agent_id > 0 &&
              item.key.trim().length > 0
          )
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

function updateGrantSet<T extends string | number>(
  current: { viewIds: T[]; executeIds: T[] },
  value: T,
  action: ModuleAction,
  checked: boolean
): { viewIds: T[]; executeIds: T[] } {
  const nextViewIds =
    action === "view"
      ? toggleArrayValue(current.viewIds, value, checked)
      : current.viewIds;
  const nextExecuteIds =
    action === "execute"
      ? toggleArrayValue(current.executeIds, value, checked)
      : checked
      ? current.executeIds
      : current.executeIds.filter((entry) => entry !== value);

  return {
    viewIds: nextViewIds,
    executeIds: nextExecuteIds,
  };
}

function updateResourceGrantState(
  grants: ResourceGrantState,
  module: ModuleKey,
  action: ModuleAction,
  value: number | string,
  checked: boolean
): ResourceGrantState {
  if (module === "cameras") {
    return {
      ...grants,
      cameras: normalizeNumericGrantState(
        updateGrantSet(grants.cameras, Number(value), action, checked)
      ),
    };
  }
  if (module === "jobs") {
    return {
      ...grants,
      jobs: normalizeNumericGrantState(
        updateGrantSet(grants.jobs, Number(value), action, checked)
      ),
    };
  }
  return {
    ...grants,
    agents: normalizeAgentGrantState(
      updateGrantSet(grants.agents, String(value), action, checked)
    ),
  };
}

function updateResourceScopeState(
  scopes: ResourceScopeState,
  module: ModuleKey,
  action: ModuleAction,
  mode: ResourceScopeMode
): ResourceScopeState {
  return {
    ...scopes,
    [module]: {
      ...scopes[module],
      [action]: mode,
    },
  };
}

function normalizePermissionsForUi(
  permissions: PermissionState,
  role: "admin" | "member",
  fullAccess: boolean
): PermissionState {
  if (role === "admin" || fullAccess) {
    return buildFullPermissions();
  }

  return {
    view_cameras: permissions.view_cameras || permissions.execute_cameras,
    execute_cameras: permissions.execute_cameras,
    view_tasks: permissions.view_tasks || permissions.execute_tasks,
    execute_tasks: permissions.execute_tasks,
    view_agents: permissions.view_agents || permissions.execute_agents,
    execute_agents: permissions.execute_agents,
    chat: permissions.chat,
  };
}

function buildEditorState(user: AccountUserRecord): EditorState {
  return {
    role: user.role === "admin" ? "admin" : "member",
    status: user.status,
    fullAccess: user.full_access,
    permissions: normalizePermissionsForUi(
      user.full_access ? buildFullPermissions() : { ...user.permissions },
      user.role === "admin" ? "admin" : "member",
      user.full_access
    ),
    resourceScopes: normalizeResourceScopes(user.resource_scopes),
    resourceGrants: normalizeResourceGrants(user.resource_grants),
    password: "",
    saveMessage: "",
    saveMessageType: null,
    passwordMessage: "",
    passwordMessageType: null,
    isSaving: false,
    isResettingPassword: false,
  };
}

function formatRole(role: string, t: any) {
  if (role === "owner") {
    return t("settings.usersRights.role.owner");
  }
  if (role === "admin") {
    return t("settings.usersRights.role.admin");
  }
  return t("settings.usersRights.role.member");
}

function formatStatus(status: string, t: any) {
  return status === "disabled"
    ? t("settings.usersRights.status.disabled")
    : t("settings.usersRights.status.active");
}

function buildCameraOptions(cameras: CameraCatalogItem[]): ResourceOption[] {
  return cameras
    .map((camera) => ({
      id: camera.id,
      title: camera.name || `Camera ${camera.id}`,
      subtitle: camera.description || "",
      inactive: false,
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function buildJobOptions(jobs: JobCatalogItem[]): ResourceOption[] {
  return jobs
    .map((job) => ({
      id: job.id,
      title: job.name || `Job ${job.id}`,
      subtitle: typeof job.status === "string" && job.status.trim() ? job.status.trim() : "",
      inactive: false,
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function buildAgentOptions(agents: AgentCatalogItem[]): ResourceOption[] {
  return agents
    .map((agent) => {
      const subtitleParts = agent.agent_kind === "camera_algorithm"
        ? [agent.parent_camera_name]
        : [agent.parent_job_name, agent.parent_step_name, agent.parent_camera_name];

      return {
        id: agent.key,
        title: agent.display_name || agent.agent_key || `Agent ${agent.agent_id}`,
        subtitle: subtitleParts.filter(Boolean).join(" / "),
        inactive: agent.is_active === false,
      };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function buildPermissionEntries(
  permissions: PermissionState,
  resourceCatalog: ResourceCatalog,
  t: any
): PermissionEntry[] {
  return [
    {
      key: "cameras",
      label: t("settings.usersRights.permissions.cameras"),
      viewKey: "view_cameras",
      executeKey: "execute_cameras",
      viewValue: permissions.view_cameras,
      executeValue: permissions.execute_cameras,
      items: buildCameraOptions(resourceCatalog.cameras),
    },
    {
      key: "jobs",
      label: t("settings.usersRights.permissions.tasks"),
      viewKey: "view_tasks",
      executeKey: "execute_tasks",
      viewValue: permissions.view_tasks,
      executeValue: permissions.execute_tasks,
      items: buildJobOptions(resourceCatalog.jobs),
    },
    {
      key: "agents",
      label: t("settings.usersRights.permissions.agents"),
      viewKey: "view_agents",
      executeKey: "execute_agents",
      viewValue: permissions.view_agents,
      executeValue: permissions.execute_agents,
      items: buildAgentOptions(resourceCatalog.agents),
    },
  ];
}

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
  const selectedSet = new Set(selectedIds);

  return (
    <div className="fluent-card mt-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
          {title}
        </p>
        {mode === "selected" ? (
          <span className="text-xs text-gray-500">
            {t("settings.usersRights.scope.selectedCount", {
              count: selectedIds.length,
            })}
          </span>
        ) : null}
      </div>

      <div className="fluent-segmented mt-3 inline-flex rounded-lg border p-1">
        <button
          type="button"
          onClick={() => onModeChange("all")}
          disabled={disabled}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "all"
              ? "bg-blue-600 text-white"
              : "text-gray-300 hover:bg-white/[0.04]"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {t("settings.usersRights.scope.all")}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("selected")}
          disabled={disabled}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "selected"
              ? "bg-blue-600 text-white"
              : "text-gray-300 hover:bg-white/[0.04]"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {t("settings.usersRights.scope.selected")}
        </button>
      </div>

      {mode === "selected" ? (
        <div className="fluent-card mt-3 rounded-lg border">
          {items.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-500">
              {t("settings.usersRights.scope.noneAvailable")}
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {items.map((item, index) => (
                <label
                  key={`${title}-${String(item.id)}`}
                  className={`flex cursor-pointer items-start gap-3 px-3 py-3 text-sm text-gray-200 ${
                    index > 0 ? "border-t border-gray-800/70" : ""
                  } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(item.id)}
                    onChange={(event) => onToggle(item.id, event.target.checked)}
                    disabled={disabled}
                    className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-gray-100">
                      {item.title}
                    </span>
                    {item.subtitle ? (
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {item.subtitle}
                      </span>
                    ) : null}
                    {item.inactive ? (
                      <span className="mt-1 inline-flex rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200">
                        {t("settings.usersRights.scope.inactive")}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type PermissionModuleCardProps = {
  entry: PermissionEntry;
  role: "admin" | "member";
  fullAccess: boolean;
  disabled: boolean;
  resourceScopes: ResourceScopeState;
  resourceGrants: ResourceGrantState;
  t: any;
  onPermissionChange: (key: keyof PermissionState, value: boolean) => void;
  onScopeChange: (module: ModuleKey, action: ModuleAction, mode: ResourceScopeMode) => void;
  onGrantToggle: (
    module: ModuleKey,
    action: ModuleAction,
    id: number | string,
    checked: boolean
  ) => void;
};

function PermissionModuleCard({
  entry,
  role,
  fullAccess,
  disabled,
  resourceScopes,
  resourceGrants,
  t,
  onPermissionChange,
  onScopeChange,
  onGrantToggle,
}: PermissionModuleCardProps) {
  const isLocked = disabled || fullAccess || role === "admin";
  const scopeSet = resourceScopes[entry.key];
  const grantSet = resourceGrants[entry.key];

  return (
    <div className="fluent-card rounded-lg border p-3">
      <p className="text-sm font-semibold text-gray-100">{entry.label}</p>
      <div className="mt-3 space-y-3 text-sm text-gray-300">
        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={entry.viewValue}
              onChange={(event) => onPermissionChange(entry.viewKey, event.target.checked)}
              disabled={isLocked}
              className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
            />
            {t("settings.usersRights.permissions.view")}
          </label>

          {entry.viewValue && !isLocked ? (
            <ScopeSelector
              title={t("settings.usersRights.scope.viewTitle")}
              mode={scopeSet.view}
              selectedIds={grantSet.viewIds}
              items={entry.items}
              disabled={isLocked}
              t={t}
              onModeChange={(mode) => onScopeChange(entry.key, "view", mode)}
              onToggle={(id, checked) => onGrantToggle(entry.key, "view", id, checked)}
            />
          ) : null}
        </div>

        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={entry.executeValue}
              onChange={(event) => onPermissionChange(entry.executeKey, event.target.checked)}
              disabled={isLocked}
              className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
            />
            {t("settings.usersRights.permissions.execute")}
          </label>

          {entry.executeValue && !isLocked ? (
            <ScopeSelector
              title={t("settings.usersRights.scope.executeTitle")}
              mode={scopeSet.execute}
              selectedIds={grantSet.executeIds}
              items={entry.items}
              disabled={isLocked}
              t={t}
              onModeChange={(mode) => onScopeChange(entry.key, "execute", mode)}
              onToggle={(id, checked) => onGrantToggle(entry.key, "execute", id, checked)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function AccountUsersPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AccountUserRecord[]>([]);
  const [resourceCatalog, setResourceCatalog] = useState<ResourceCatalog>(
    buildEmptyResourceCatalog()
  );
  const [canAssignAdmin, setCanAssignAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");
  const [createMessage, setCreateMessage] = useState("");
  const [createMessageType, setCreateMessageType] = useState<"success" | "error" | null>(null);
  const [editors, setEditors] = useState<Record<string, EditorState>>({});
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [createForm, setCreateForm] = useState<CreateFormState>({
    email: "",
    password: "",
    role: "member",
    fullAccess: false,
    permissions: buildEmptyPermissions(),
    resourceScopes: buildAllResourceScopes(),
    resourceGrants: buildEmptyResourceGrants(),
  });

  const sortedUsers = useMemo(
    () =>
      [...users].sort((left, right) => {
        if (left.is_owner && !right.is_owner) return -1;
        if (!left.is_owner && right.is_owner) return 1;
        if (left.role === "admin" && right.role !== "admin") return -1;
        if (left.role !== "admin" && right.role === "admin") return 1;
        return left.email.localeCompare(right.email);
      }),
    [users]
  );

  const createPermissionEntries = useMemo(
    () => buildPermissionEntries(createForm.permissions, resourceCatalog, t),
    [createForm.permissions, resourceCatalog, t]
  );

  const loadUsers = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/account-users", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as AccountUsersResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : t("settings.usersRights.messages.loadFailed")
        );
      }

      const nextUsers = Array.isArray(payload.users) ? payload.users : [];
      setUsers(nextUsers);
      setResourceCatalog(normalizeResourceCatalog(payload.resource_catalog));
      setCanAssignAdmin(payload.can_assign_admin === true);
      setEditors(
        Object.fromEntries(
          nextUsers.map((user) => [user.member_user_id, buildEditorState(user)])
        )
      );
      setExpandedUsers((current) =>
        Object.fromEntries(
          nextUsers.map((user) => [user.member_user_id, current[user.member_user_id] === true])
        )
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error && loadError.message.trim()
          ? loadError.message
          : t("settings.usersRights.messages.loadFailed")
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const updateCreateForm = (patch: Partial<CreateFormState>) => {
    setCreateForm((current) => {
      const next = {
        ...current,
        ...patch,
      };
      if (patch.role === "admin") {
        next.fullAccess = true;
      }
      next.permissions = normalizePermissionsForUi(
        next.permissions,
        next.role,
        next.fullAccess
      );
      next.resourceScopes = normalizeResourceScopes(next.resourceScopes);
      next.resourceGrants = normalizeResourceGrants(next.resourceGrants);
      return next;
    });
  };

  const updateCreatePermission = (key: keyof PermissionState, value: boolean) => {
    setCreateForm((current) => {
      const nextPermissions = { ...current.permissions, [key]: value };
      if (key === "view_cameras" && !value) nextPermissions.execute_cameras = false;
      if (key === "view_tasks" && !value) nextPermissions.execute_tasks = false;
      if (key === "view_agents" && !value) nextPermissions.execute_agents = false;
      if (key === "execute_cameras" && value) nextPermissions.view_cameras = true;
      if (key === "execute_tasks" && value) nextPermissions.view_tasks = true;
      if (key === "execute_agents" && value) nextPermissions.view_agents = true;

      return {
        ...current,
        permissions: normalizePermissionsForUi(
          nextPermissions,
          current.role,
          current.fullAccess
        ),
      };
    });
  };

  const updateCreateScope = (
    module: ModuleKey,
    action: ModuleAction,
    mode: ResourceScopeMode
  ) => {
    setCreateForm((current) => ({
      ...current,
      resourceScopes: updateResourceScopeState(current.resourceScopes, module, action, mode),
    }));
  };

  const updateCreateGrant = (
    module: ModuleKey,
    action: ModuleAction,
    id: number | string,
    checked: boolean
  ) => {
    setCreateForm((current) => ({
      ...current,
      resourceGrants: updateResourceGrantState(current.resourceGrants, module, action, id, checked),
    }));
  };

  const updateEditor = (memberUserId: string, patch: Partial<EditorState>) => {
    setEditors((current) => {
      const existing = current[memberUserId];
      if (!existing) {
        return current;
      }
      const next = {
        ...existing,
        ...patch,
      };
      if (patch.role === "admin") {
        next.fullAccess = true;
      }
      next.permissions = normalizePermissionsForUi(next.permissions, next.role, next.fullAccess);
      next.resourceScopes = normalizeResourceScopes(next.resourceScopes);
      next.resourceGrants = normalizeResourceGrants(next.resourceGrants);
      return {
        ...current,
        [memberUserId]: next,
      };
    });
  };

  const updateEditorPermission = (
    memberUserId: string,
    key: keyof PermissionState,
    value: boolean
  ) => {
    setEditors((current) => {
      const existing = current[memberUserId];
      if (!existing) {
        return current;
      }

      const nextPermissions = { ...existing.permissions, [key]: value };
      if (key === "view_cameras" && !value) nextPermissions.execute_cameras = false;
      if (key === "view_tasks" && !value) nextPermissions.execute_tasks = false;
      if (key === "view_agents" && !value) nextPermissions.execute_agents = false;
      if (key === "execute_cameras" && value) nextPermissions.view_cameras = true;
      if (key === "execute_tasks" && value) nextPermissions.view_tasks = true;
      if (key === "execute_agents" && value) nextPermissions.view_agents = true;

      return {
        ...current,
        [memberUserId]: {
          ...existing,
          permissions: normalizePermissionsForUi(
            nextPermissions,
            existing.role,
            existing.fullAccess
          ),
        },
      };
    });
  };

  const updateEditorScope = (
    memberUserId: string,
    module: ModuleKey,
    action: ModuleAction,
    mode: ResourceScopeMode
  ) => {
    updateEditor(memberUserId, {
      resourceScopes: updateResourceScopeState(
        editors[memberUserId]?.resourceScopes || buildAllResourceScopes(),
        module,
        action,
        mode
      ),
    });
  };

  const updateEditorGrant = (
    memberUserId: string,
    module: ModuleKey,
    action: ModuleAction,
    id: number | string,
    checked: boolean
  ) => {
    updateEditor(memberUserId, {
      resourceGrants: updateResourceGrantState(
        editors[memberUserId]?.resourceGrants || buildEmptyResourceGrants(),
        module,
        action,
        id,
        checked
      ),
    });
  };

  const toggleExpandedUser = (memberUserId: string) => {
    setExpandedUsers((current) => ({
      ...current,
      [memberUserId]: !current[memberUserId],
    }));
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createForm.email.trim()) {
      setCreateMessage(t("settings.usersRights.validation.emailRequired"));
      setCreateMessageType("error");
      return;
    }
    if (createForm.password.length < 8) {
      setCreateMessage(t("settings.usersRights.validation.passwordMin", { min: 8 }));
      setCreateMessageType("error");
      return;
    }

    setIsCreating(true);
    setCreateMessage("");
    setCreateMessageType(null);

    try {
      const response = await fetch("/api/account-users", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: createForm.email.trim(),
          password: createForm.password,
          role: createForm.role,
          full_access: createForm.fullAccess,
          permissions: createForm.permissions,
          resource_scopes: createForm.resourceScopes,
          resource_grants: createForm.resourceGrants,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : t("settings.usersRights.messages.createFailed")
        );
      }

      setCreateForm({
        email: "",
        password: "",
        role: "member",
        fullAccess: false,
        permissions: buildEmptyPermissions(),
        resourceScopes: buildAllResourceScopes(),
        resourceGrants: buildEmptyResourceGrants(),
      });
      setCreateMessage(t("settings.usersRights.messages.createSuccess"));
      setCreateMessageType("success");
      await loadUsers();
    } catch (createError) {
      setCreateMessage(
        createError instanceof Error && createError.message.trim()
          ? createError.message
          : t("settings.usersRights.messages.createFailed")
      );
      setCreateMessageType("error");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveUser = async (user: AccountUserRecord) => {
    const editor = editors[user.member_user_id];
    if (!editor) {
      return;
    }

    updateEditor(user.member_user_id, {
      isSaving: true,
      saveMessage: "",
      saveMessageType: null,
    });

    try {
      const response = await fetch(`/api/account-users/${encodeURIComponent(user.member_user_id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          role: editor.role,
          status: editor.status,
          full_access: editor.fullAccess,
          permissions: editor.permissions,
          resource_scopes: editor.resourceScopes,
          resource_grants: editor.resourceGrants,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : t("settings.usersRights.messages.saveFailed")
        );
      }

      updateEditor(user.member_user_id, {
        isSaving: false,
        saveMessage: t("settings.usersRights.messages.saveSuccess"),
        saveMessageType: "success",
      });
      await loadUsers();
    } catch (saveError) {
      updateEditor(user.member_user_id, {
        isSaving: false,
        saveMessage:
          saveError instanceof Error && saveError.message.trim()
            ? saveError.message
            : t("settings.usersRights.messages.saveFailed"),
        saveMessageType: "error",
      });
    }
  };

  const handleResetPassword = async (user: AccountUserRecord) => {
    const editor = editors[user.member_user_id];
    if (!editor) {
      return;
    }
    if (editor.password.length < 8) {
      updateEditor(user.member_user_id, {
        passwordMessage: t("settings.usersRights.validation.passwordMin", { min: 8 }),
        passwordMessageType: "error",
      });
      return;
    }

    updateEditor(user.member_user_id, {
      isResettingPassword: true,
      passwordMessage: "",
      passwordMessageType: null,
    });

    try {
      const response = await fetch(
        `/api/account-users/${encodeURIComponent(user.member_user_id)}/password`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            password: editor.password,
          }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : t("settings.usersRights.messages.passwordFailed")
        );
      }

      updateEditor(user.member_user_id, {
        isResettingPassword: false,
        password: "",
        passwordMessage: t("settings.usersRights.messages.passwordSuccess"),
        passwordMessageType: "success",
      });
    } catch (passwordError) {
      updateEditor(user.member_user_id, {
        isResettingPassword: false,
        passwordMessage:
          passwordError instanceof Error && passwordError.message.trim()
            ? passwordError.message
            : t("settings.usersRights.messages.passwordFailed"),
        passwordMessageType: "error",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="fluent-card rounded-lg border p-4 md:p-6">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-blue-200">
            <Users className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-100">
              {t("settings.usersRights.title")}
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              {t("settings.usersRights.description")}
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleCreateUser}
        className="fluent-card rounded-lg border p-4 md:p-6"
      >
        <div className="mb-5 flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-200">
            <UserPlus className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-100">
              {t("settings.usersRights.create.title")}
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              {t("settings.usersRights.create.description")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {t("settings.usersRights.fields.email")}
            </label>
            <input
              type="email"
              value={createForm.email}
              onChange={(event) => {
                setCreateMessage("");
                setCreateMessageType(null);
                updateCreateForm({ email: event.target.value });
              }}
              disabled={isCreating}
              className="fluent-input w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {t("settings.usersRights.fields.initialPassword")}
            </label>
            <input
              type="password"
              value={createForm.password}
              onChange={(event) => {
                setCreateMessage("");
                setCreateMessageType(null);
                updateCreateForm({ password: event.target.value });
              }}
              disabled={isCreating}
              className="fluent-input w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,220px),1fr]">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-300">
              {t("settings.usersRights.fields.role")}
            </label>
            <select
              value={createForm.role}
              onChange={(event) =>
                updateCreateForm({
                  role: event.target.value === "admin" ? "admin" : "member",
                })
              }
              disabled={isCreating}
              className="fluent-input w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
            >
              <option value="member">{t("settings.usersRights.role.member")}</option>
              {canAssignAdmin ? (
                <option value="admin">{t("settings.usersRights.role.admin")}</option>
              ) : null}
            </select>
            <p className="mt-2 text-xs text-gray-500">
              {t("settings.usersRights.role.adminHint")}
            </p>
          </div>

          <div className="fluent-card rounded-lg border p-4">
            <label className="inline-flex items-center gap-3 text-sm font-medium text-gray-200">
              <input
                type="checkbox"
                checked={createForm.fullAccess}
                onChange={(event) =>
                  updateCreateForm({
                    fullAccess: event.target.checked,
                  })
                }
                disabled={isCreating || createForm.role === "admin"}
                className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
              />
              {t("settings.usersRights.fullAccess")}
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {createPermissionEntries.map((entry) => (
            <PermissionModuleCard
              key={entry.key}
              entry={entry}
              role={createForm.role}
              fullAccess={createForm.fullAccess}
              disabled={isCreating}
              resourceScopes={createForm.resourceScopes}
              resourceGrants={createForm.resourceGrants}
              t={t}
              onPermissionChange={updateCreatePermission}
              onScopeChange={updateCreateScope}
              onGrantToggle={updateCreateGrant}
            />
          ))}

          <div className="fluent-card rounded-lg border p-3">
            <p className="text-sm font-semibold text-gray-100">
              {t("settings.usersRights.permissions.chat")}
            </p>
            <div className="mt-3 text-sm text-gray-300">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={createForm.permissions.chat}
                  onChange={(event) => updateCreatePermission("chat", event.target.checked)}
                  disabled={isCreating || createForm.fullAccess || createForm.role === "admin"}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                />
                {t("settings.usersRights.permissions.useChat")}
              </label>
            </div>
          </div>
        </div>

        {createMessage ? (
          <div
            className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
              createMessageType === "success"
                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                : "border-rose-400/20 bg-rose-500/10 text-rose-200"
            }`}
          >
            {createMessage}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={isCreating}
            className="fluent-primary-button inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t("settings.usersRights.actions.create")}
          </button>
        </div>
      </form>

      <div className="fluent-card rounded-lg border p-4 md:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-100">
              {t("settings.usersRights.existing.title")}
            </h3>
            <p className="mt-1 text-sm text-gray-400">
              {t("settings.usersRights.existing.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={isLoading}
            className="fluent-toolbar-button inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("settings.usersRights.actions.refresh")}
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="fluent-card flex items-center gap-3 rounded-lg border px-4 py-4 text-sm text-gray-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.usersRights.loading")}
          </div>
        ) : null}

        {!isLoading && sortedUsers.length === 0 ? (
          <div className="fluent-card rounded-lg border px-4 py-4 text-sm text-gray-400">
            {t("settings.usersRights.empty")}
          </div>
        ) : null}

        <div className="space-y-4">
          {sortedUsers.map((user) => {
            const editor = editors[user.member_user_id];
            if (!editor) {
              return null;
            }

            const canEditRole = canAssignAdmin || !user.is_admin;
            const roleLocked = user.is_owner || !canEditRole;
            const passwordLocked = user.is_owner || !canEditRole;
            const isExpanded = expandedUsers[user.member_user_id] === true;
            const permissionEntries = buildPermissionEntries(editor.permissions, resourceCatalog, t);

            return (
              <div
                key={user.member_user_id}
                className="fluent-card rounded-lg border p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-100">{user.email}</p>
                      <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-200">
                        {formatRole(user.role, t)}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                          user.status === "active"
                            ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                            : "border-rose-400/20 bg-rose-500/10 text-rose-200"
                        }`}
                      >
                        {formatStatus(user.status, t)}
                      </span>
                      {user.full_access ? (
                        <span className="rounded-full border border-purple-400/20 bg-purple-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-purple-200">
                          {t("settings.usersRights.fullAccess")}
                        </span>
                      ) : null}
                    </div>

                    {user.is_owner ? (
                      <p className="mt-2 text-sm text-gray-400">
                        {t("settings.usersRights.ownerDescription")}
                      </p>
                    ) : !canEditRole && user.is_admin ? (
                      <p className="mt-2 flex items-center gap-2 text-sm text-amber-200">
                        <Shield className="h-4 w-4" />
                        {t("settings.usersRights.adminLockedDescription")}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-gray-400">
                        {t("settings.usersRights.managedPasswordDescription")}
                      </p>
                    )}
                  </div>

                  <div className="text-xs text-gray-500">
                    {t("settings.usersRights.updatedAt", {
                      value: user.updated_at
                        ? user.updated_at.slice(0, 19).replace("T", " ")
                        : t("settings.usersRights.notAvailable"),
                    })}
                  </div>
                </div>

                {!user.is_owner ? (
                  <div className="fluent-card mt-5 overflow-hidden rounded-lg border">
                    <button
                      type="button"
                      onClick={() => toggleExpandedUser(user.member_user_id)}
                      aria-expanded={isExpanded}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                    >
                      <span className="text-sm font-medium text-gray-200">
                        {isExpanded
                          ? t("settings.usersRights.actions.hideDetails")
                          : t("settings.usersRights.actions.showDetails")}
                      </span>
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-800 bg-gray-900/80 text-gray-300">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="space-y-4 border-t border-gray-800/80 px-4 pb-4 pt-4">
                        <div className="grid gap-4 md:grid-cols-[minmax(0,220px),minmax(0,220px),1fr]">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-gray-300">
                              {t("settings.usersRights.fields.role")}
                            </label>
                            <select
                              value={editor.role}
                              onChange={(event) =>
                                updateEditor(user.member_user_id, {
                                  role: event.target.value === "admin" ? "admin" : "member",
                                })
                              }
                              disabled={roleLocked || editor.isSaving}
                              className="fluent-input w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                            >
                              <option value="member">{t("settings.usersRights.role.member")}</option>
                              {canAssignAdmin ? (
                                <option value="admin">{t("settings.usersRights.role.admin")}</option>
                              ) : null}
                            </select>
                          </div>

                          <div>
                            <label className="mb-2 block text-sm font-medium text-gray-300">
                              {t("settings.usersRights.fields.status")}
                            </label>
                            <select
                              value={editor.status}
                              onChange={(event) =>
                                updateEditor(user.member_user_id, {
                                  status:
                                    event.target.value === "disabled" ? "disabled" : "active",
                                })
                              }
                              disabled={editor.isSaving}
                              className="fluent-input w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                            >
                              <option value="active">{t("settings.usersRights.status.active")}</option>
                              <option value="disabled">
                                {t("settings.usersRights.status.disabled")}
                              </option>
                            </select>
                          </div>

                          <div className="fluent-card rounded-lg border p-4">
                            <label className="inline-flex items-center gap-3 text-sm font-medium text-gray-200">
                              <input
                                type="checkbox"
                                checked={editor.fullAccess}
                                onChange={(event) =>
                                  updateEditor(user.member_user_id, {
                                    fullAccess: event.target.checked,
                                  })
                                }
                                disabled={editor.isSaving || editor.role === "admin"}
                                className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                              />
                              {t("settings.usersRights.fullAccess")}
                            </label>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          {permissionEntries.map((entry) => (
                            <PermissionModuleCard
                              key={entry.key}
                              entry={entry}
                              role={editor.role}
                              fullAccess={editor.fullAccess}
                              disabled={editor.isSaving}
                              resourceScopes={editor.resourceScopes}
                              resourceGrants={editor.resourceGrants}
                              t={t}
                              onPermissionChange={(key, value) =>
                                updateEditorPermission(user.member_user_id, key, value)
                              }
                              onScopeChange={(module, action, mode) =>
                                updateEditorScope(user.member_user_id, module, action, mode)
                              }
                              onGrantToggle={(module, action, id, checked) =>
                                updateEditorGrant(user.member_user_id, module, action, id, checked)
                              }
                            />
                          ))}

                          <div className="fluent-card rounded-lg border p-3">
                            <p className="text-sm font-semibold text-gray-100">
                              {t("settings.usersRights.permissions.chat")}
                            </p>
                            <div className="mt-3 text-sm text-gray-300">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={editor.permissions.chat}
                                  onChange={(event) =>
                                    updateEditorPermission(
                                      user.member_user_id,
                                      "chat",
                                      event.target.checked
                                    )
                                  }
                                  disabled={editor.isSaving || editor.fullAccess || editor.role === "admin"}
                                  className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                                />
                                {t("settings.usersRights.permissions.useChat")}
                              </label>
                            </div>
                          </div>
                        </div>

                        {editor.saveMessage ? (
                          <div
                            className={`rounded-xl border px-4 py-3 text-sm ${
                              editor.saveMessageType === "success"
                                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                                : "border-rose-400/20 bg-rose-500/10 text-rose-200"
                            }`}
                          >
                            {editor.saveMessage}
                          </div>
                        ) : null}

                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleSaveUser(user)}
                            disabled={editor.isSaving}
                            className="fluent-primary-button inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {editor.isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {t("settings.usersRights.actions.saveChanges")}
                          </button>
                        </div>

                        <div className="fluent-card rounded-lg border p-4">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="mt-0.5 h-4 w-4 text-gray-500" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-100">
                                {t("settings.usersRights.password.title")}
                              </p>
                              <p className="mt-1 text-sm text-gray-400">
                                {t("settings.usersRights.password.description")}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-col gap-3 md:flex-row">
                            <input
                              type="password"
                              value={editor.password}
                              onChange={(event) =>
                                updateEditor(user.member_user_id, {
                                  password: event.target.value,
                                  passwordMessage: "",
                                  passwordMessageType: null,
                                })
                              }
                              disabled={passwordLocked || editor.isResettingPassword}
                              placeholder={t("settings.usersRights.password.placeholder")}
                              className="fluent-input w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                            />
                            <button
                              type="button"
                              onClick={() => void handleResetPassword(user)}
                              disabled={passwordLocked || editor.isResettingPassword}
                              className="fluent-toolbar-button inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {editor.isResettingPassword ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {t("settings.usersRights.actions.updatePassword")}
                            </button>
                          </div>

                          {editor.passwordMessage ? (
                            <div
                              className={`mt-3 rounded-xl border px-4 py-3 text-sm ${
                                editor.passwordMessageType === "success"
                                  ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                                  : "border-rose-400/20 bg-rose-500/10 text-rose-200"
                              }`}
                            >
                              {editor.passwordMessage}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

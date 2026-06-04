export type AccountRole = "owner" | "admin" | "member";
export type AccountMembershipStatus = "active" | "disabled";
export type PasswordManagementMode = "self_service" | "admin_managed";
export type AccountResourceScopeMode = "all" | "selected";
export type AccountScopedAction = "view" | "execute";
export type AccountScopedModule = "cameras" | "jobs" | "agents";
export type AccountScopedResourceType =
  | "camera"
  | "job"
  | "camera_algorithm"
  | "job_step_agent";

export type AccountResourceScopeSet = {
  view: AccountResourceScopeMode;
  execute: AccountResourceScopeMode;
};

export type AccountResourceScopes = {
  cameras: AccountResourceScopeSet;
  jobs: AccountResourceScopeSet;
  agents: AccountResourceScopeSet;
};

export type AccountMembershipResourceGrantPayload = {
  cameras: {
    viewIds: number[];
    executeIds: number[];
  };
  jobs: {
    viewIds: number[];
    executeIds: number[];
  };
  agents: {
    viewIds: string[];
    executeIds: string[];
  };
};

export type AccountMembershipResourceGrantRow = {
  memberUserId: string;
  resourceType: AccountScopedResourceType;
  resourceId: number;
  canView: boolean;
  canExecute: boolean;
};

export type AccountPermissions = {
  can_view_cameras: boolean;
  can_execute_cameras: boolean;
  can_view_tasks: boolean;
  can_execute_tasks: boolean;
  can_view_agents: boolean;
  can_execute_agents: boolean;
  can_use_chat: boolean;
};

export type AccountAccessContext = {
  actorUserId: string;
  accountUserId: string;
  role: AccountRole;
  status: AccountMembershipStatus;
  passwordManagementMode: PasswordManagementMode;
  permissions: AccountPermissions;
  resourceScopes: AccountResourceScopes;
  canManageSettings: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isFullAccess: boolean;
};

export type AccountMembershipSummary = AccountAccessContext & {
  memberEmail: string | null;
  memberHandle: string | null;
  memberCreatedAt: string | null;
  accountEmail: string | null;
  accountHandle: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
};

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value !== null && value !== undefined && String(value).trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric !== 0;
    }
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return fallback;
  if (["true", "t", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "f", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizePositiveIntegerArray(value: unknown, fallback: number[] = []): number[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(
    new Set(
      source
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0)
    )
  ).sort((left, right) => left - right);
}

function normalizeStringArray(value: unknown, fallback: string[] = []): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return Array.from(
    new Set(
      source
        .map((entry) => normalizeText(entry))
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function isPgLikeDatabase(db: D1Database): boolean {
  return String((db as any)?.constructor?.name || "")
    .toLowerCase()
    .includes("pgd1");
}

export function normalizeAccountRole(value: unknown): AccountRole {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "admin") return "admin";
  if (normalized === "member") return "member";
  return "owner";
}

export function normalizeAccountMembershipStatus(value: unknown): AccountMembershipStatus {
  return normalizeText(value).toLowerCase() === "disabled" ? "disabled" : "active";
}

export function normalizePasswordManagementMode(value: unknown): PasswordManagementMode {
  return normalizeText(value).toLowerCase() === "admin_managed"
    ? "admin_managed"
    : "self_service";
}

export function buildNoAccountPermissions(): AccountPermissions {
  return {
    can_view_cameras: false,
    can_execute_cameras: false,
    can_view_tasks: false,
    can_execute_tasks: false,
    can_view_agents: false,
    can_execute_agents: false,
    can_use_chat: false,
  };
}

export function buildFullAccountPermissions(): AccountPermissions {
  return {
    can_view_cameras: true,
    can_execute_cameras: true,
    can_view_tasks: true,
    can_execute_tasks: true,
    can_view_agents: true,
    can_execute_agents: true,
    can_use_chat: true,
  };
}

export function normalizeAccountPermissions(
  value: Partial<Record<keyof AccountPermissions, unknown>> | null | undefined,
  role: AccountRole = "member"
): AccountPermissions {
  if (role === "owner" || role === "admin") {
    return buildFullAccountPermissions();
  }

  const permissions: AccountPermissions = {
    can_view_cameras: normalizeBoolean(value?.can_view_cameras),
    can_execute_cameras: normalizeBoolean(value?.can_execute_cameras),
    can_view_tasks: normalizeBoolean(value?.can_view_tasks),
    can_execute_tasks: normalizeBoolean(value?.can_execute_tasks),
    can_view_agents: normalizeBoolean(value?.can_view_agents),
    can_execute_agents: normalizeBoolean(value?.can_execute_agents),
    can_use_chat: normalizeBoolean(value?.can_use_chat),
  };

  if (permissions.can_execute_cameras) permissions.can_view_cameras = true;
  if (permissions.can_execute_tasks) permissions.can_view_tasks = true;
  if (permissions.can_execute_agents) permissions.can_view_agents = true;

  return permissions;
}

export function permissionsAreFullAccess(permissions: AccountPermissions): boolean {
  return Object.values(permissions).every(Boolean);
}

export function buildAllAccountResourceScopes(): AccountResourceScopes {
  return {
    cameras: {
      view: "all",
      execute: "all",
    },
    jobs: {
      view: "all",
      execute: "all",
    },
    agents: {
      view: "all",
      execute: "all",
    },
  };
}

export function normalizeAccountResourceScopeMode(
  value: unknown,
  fallback: AccountResourceScopeMode = "all"
): AccountResourceScopeMode {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "selected") {
    return "selected";
  }
  if (normalized === "all") {
    return "all";
  }
  return fallback;
}

export function normalizeAccountResourceScopes(
  value: Record<string, unknown> | null | undefined,
  role: AccountRole = "member",
  permissions: AccountPermissions = buildNoAccountPermissions(),
  fallback: AccountResourceScopes = buildAllAccountResourceScopes()
): AccountResourceScopes {
  if (role === "owner" || role === "admin" || permissionsAreFullAccess(permissions)) {
    return buildAllAccountResourceScopes();
  }

  const scopes: AccountResourceScopes = {
    cameras: {
      view: normalizeAccountResourceScopeMode(
        value?.camera_view_scope ??
          (value?.cameras as Record<string, unknown> | undefined)?.view,
        fallback.cameras.view
      ),
      execute: normalizeAccountResourceScopeMode(
        value?.camera_execute_scope ??
          (value?.cameras as Record<string, unknown> | undefined)?.execute,
        fallback.cameras.execute
      ),
    },
    jobs: {
      view: normalizeAccountResourceScopeMode(
        value?.task_view_scope ??
          value?.job_view_scope ??
          (value?.jobs as Record<string, unknown> | undefined)?.view,
        fallback.jobs.view
      ),
      execute: normalizeAccountResourceScopeMode(
        value?.task_execute_scope ??
          value?.job_execute_scope ??
          (value?.jobs as Record<string, unknown> | undefined)?.execute,
        fallback.jobs.execute
      ),
    },
    agents: {
      view: normalizeAccountResourceScopeMode(
        value?.agent_view_scope ??
          (value?.agents as Record<string, unknown> | undefined)?.view,
        fallback.agents.view
      ),
      execute: normalizeAccountResourceScopeMode(
        value?.agent_execute_scope ??
          (value?.agents as Record<string, unknown> | undefined)?.execute,
        fallback.agents.execute
      ),
    },
  };

  if (!permissions.can_view_cameras) scopes.cameras.view = "all";
  if (!permissions.can_execute_cameras) scopes.cameras.execute = "all";
  if (!permissions.can_view_tasks) scopes.jobs.view = "all";
  if (!permissions.can_execute_tasks) scopes.jobs.execute = "all";
  if (!permissions.can_view_agents) scopes.agents.view = "all";
  if (!permissions.can_execute_agents) scopes.agents.execute = "all";

  return scopes;
}

export function serializeAccountAgentGrantKey(
  resourceType: "camera_algorithm" | "job_step_agent",
  resourceId: number
): string {
  return `${resourceType}:${resourceId}`;
}

export function parseAccountAgentGrantKey(
  value: unknown
): { resourceType: "camera_algorithm" | "job_step_agent"; resourceId: number } | null {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const resourceType = normalizeText(normalized.slice(0, separatorIndex));
  const resourceId = Number(normalized.slice(separatorIndex + 1));
  if (
    (resourceType !== "camera_algorithm" && resourceType !== "job_step_agent") ||
    !Number.isInteger(resourceId) ||
    resourceId <= 0
  ) {
    return null;
  }

  return {
    resourceType,
    resourceId,
  };
}

export function buildEmptyAccountMembershipResourceGrantPayload(): AccountMembershipResourceGrantPayload {
  return {
    cameras: {
      viewIds: [],
      executeIds: [],
    },
    jobs: {
      viewIds: [],
      executeIds: [],
    },
    agents: {
      viewIds: [],
      executeIds: [],
    },
  };
}

export function normalizeAccountMembershipResourceGrantPayload(
  value: Record<string, unknown> | null | undefined,
  fallback: AccountMembershipResourceGrantPayload = buildEmptyAccountMembershipResourceGrantPayload()
): AccountMembershipResourceGrantPayload {
  const camerasSource =
    value?.cameras && typeof value.cameras === "object"
      ? (value.cameras as Record<string, unknown>)
      : {};
  const jobsSource =
    value?.jobs && typeof value.jobs === "object"
      ? (value.jobs as Record<string, unknown>)
      : {};
  const agentsSource =
    value?.agents && typeof value.agents === "object"
      ? (value.agents as Record<string, unknown>)
      : {};

  const normalizeAgentKeys = (input: unknown, defaultValue: string[]) =>
    normalizeStringArray(input, defaultValue)
      .map((entry) => parseAccountAgentGrantKey(entry))
      .filter((entry): entry is { resourceType: "camera_algorithm" | "job_step_agent"; resourceId: number } => Boolean(entry))
      .map((entry) => serializeAccountAgentGrantKey(entry.resourceType, entry.resourceId));

  return {
    cameras: {
      viewIds: normalizePositiveIntegerArray(
        camerasSource.view_ids ?? camerasSource.viewIds,
        fallback.cameras.viewIds
      ),
      executeIds: normalizePositiveIntegerArray(
        camerasSource.execute_ids ?? camerasSource.executeIds,
        fallback.cameras.executeIds
      ),
    },
    jobs: {
      viewIds: normalizePositiveIntegerArray(
        jobsSource.view_ids ?? jobsSource.viewIds,
        fallback.jobs.viewIds
      ),
      executeIds: normalizePositiveIntegerArray(
        jobsSource.execute_ids ?? jobsSource.executeIds,
        fallback.jobs.executeIds
      ),
    },
    agents: {
      viewIds: normalizeAgentKeys(
        agentsSource.view_ids ?? agentsSource.viewIds,
        fallback.agents.viewIds
      ),
      executeIds: normalizeAgentKeys(
        agentsSource.execute_ids ?? agentsSource.executeIds,
        fallback.agents.executeIds
      ),
    },
  };
}

function mapSummaryRow(value: unknown): AccountMembershipSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const actorUserId = normalizeText(row.member_user_id ?? row.actorUserId);
  const accountUserId =
    normalizeText(row.account_user_id ?? row.accountUserId) || actorUserId;
  const role = normalizeAccountRole(row.role);
  const status = normalizeAccountMembershipStatus(row.status);
  const passwordManagementMode = normalizePasswordManagementMode(
    row.password_management_mode ?? row.passwordManagementMode
  );
  const permissions = normalizeAccountPermissions(
    {
      can_view_cameras: row.can_view_cameras,
      can_execute_cameras: row.can_execute_cameras,
      can_view_tasks: row.can_view_tasks,
      can_execute_tasks: row.can_execute_tasks,
      can_view_agents: row.can_view_agents,
      can_execute_agents: row.can_execute_agents,
      can_use_chat: row.can_use_chat,
    },
    role
  );
  const resourceScopes = normalizeAccountResourceScopes(row, role, permissions);
  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const canManageSettings = isOwner || isAdmin;

  return {
    actorUserId,
    accountUserId,
    role,
    status,
    passwordManagementMode,
    permissions,
    resourceScopes,
    canManageSettings,
    isOwner,
    isAdmin,
    isFullAccess: permissionsAreFullAccess(permissions),
    memberEmail: normalizeText(row.member_email) || null,
    memberHandle: normalizeText(row.member_handle) || null,
    memberCreatedAt: normalizeText(row.member_created_at) || null,
    accountEmail: normalizeText(row.account_email) || null,
    accountHandle: normalizeText(row.account_handle) || null,
    createdAt: normalizeText(row.created_at) || null,
    updatedAt: normalizeText(row.updated_at) || null,
    createdByUserId: normalizeText(row.created_by_user_id) || null,
    updatedByUserId: normalizeText(row.updated_by_user_id) || null,
  };
}

function selectMembershipBaseSql() {
  return `SELECT
    am.member_user_id,
    am.account_user_id,
    am.role,
    am.status,
    am.password_management_mode,
    am.can_view_cameras,
    am.can_execute_cameras,
    am.can_view_tasks,
    am.can_execute_tasks,
    am.can_view_agents,
    am.can_execute_agents,
    am.can_use_chat,
    am.camera_view_scope,
    am.camera_execute_scope,
    am.task_view_scope,
    am.task_execute_scope,
    am.agent_view_scope,
    am.agent_execute_scope,
    am.created_by_user_id,
    am.updated_by_user_id,
    am.created_at,
    am.updated_at,
    member.email AS member_email,
    member.handle AS member_handle,
    member.created_at AS member_created_at,
    account_user.email AS account_email,
    account_user.handle AS account_handle
  FROM account_memberships am
  LEFT JOIN app_users member ON member.id = am.member_user_id
  LEFT JOIN app_users account_user ON account_user.id = am.account_user_id`;
}

async function getMembershipSummaryRow(
  db: D1Database,
  memberUserId: string
): Promise<AccountMembershipSummary | null> {
  const normalizedMemberUserId = normalizeText(memberUserId);
  if (!normalizedMemberUserId) {
    return null;
  }

  const row = await db
    .prepare(
      `${selectMembershipBaseSql()}
       WHERE am.member_user_id = ?
       LIMIT 1`
    )
    .bind(normalizedMemberUserId)
    .first();

  return mapSummaryRow(row);
}

export async function ensureSelfAccountMembership(
  db: D1Database,
  actorUserId: string
): Promise<void> {
  const normalizedActorUserId = normalizeText(actorUserId);
  if (!normalizedActorUserId) {
    throw new Error("Actor user id is required to ensure self account membership.");
  }

  const nowIso = new Date().toISOString();
  if (isPgLikeDatabase(db)) {
    await db
      .prepare(
        `INSERT INTO account_memberships (
           member_user_id,
           account_user_id,
           role,
           status,
           password_management_mode,
           can_view_cameras,
           can_execute_cameras,
           can_view_tasks,
           can_execute_tasks,
           can_view_agents,
           can_execute_agents,
           can_use_chat,
           camera_view_scope,
           camera_execute_scope,
           task_view_scope,
           task_execute_scope,
           agent_view_scope,
           agent_execute_scope,
           created_by_user_id,
           updated_by_user_id,
           created_at,
           updated_at
         )
         VALUES (?, ?, 'owner', 'active', 'self_service', 1, 1, 1, 1, 1, 1, 1, 'all', 'all', 'all', 'all', 'all', 'all', ?, ?, ?, ?)
         ON CONFLICT (member_user_id) DO NOTHING`
      )
      .bind(
        normalizedActorUserId,
        normalizedActorUserId,
        normalizedActorUserId,
        normalizedActorUserId,
        nowIso,
        nowIso
      )
      .run();
    return;
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO account_memberships (
         member_user_id,
         account_user_id,
         role,
         status,
         password_management_mode,
         can_view_cameras,
         can_execute_cameras,
         can_view_tasks,
         can_execute_tasks,
         can_view_agents,
         can_execute_agents,
         can_use_chat,
         camera_view_scope,
         camera_execute_scope,
         task_view_scope,
         task_execute_scope,
         agent_view_scope,
         agent_execute_scope,
         created_by_user_id,
         updated_by_user_id,
         created_at,
         updated_at
       )
       VALUES (?, ?, 'owner', 'active', 'self_service', 1, 1, 1, 1, 1, 1, 1, 'all', 'all', 'all', 'all', 'all', 'all', ?, ?, ?, ?)`
    )
    .bind(
      normalizedActorUserId,
      normalizedActorUserId,
      normalizedActorUserId,
      normalizedActorUserId,
      nowIso,
      nowIso
    )
    .run();
}

export async function resolveAccountAccessContext(
  db: D1Database,
  actorUserId: string
): Promise<AccountAccessContext> {
  const normalizedActorUserId = normalizeText(actorUserId);
  if (!normalizedActorUserId) {
    throw new Error("Actor user id is required to resolve account access.");
  }

  let membership = await getMembershipSummaryRow(db, normalizedActorUserId);
  if (!membership) {
    await ensureSelfAccountMembership(db, normalizedActorUserId);
    membership = await getMembershipSummaryRow(db, normalizedActorUserId);
  }

  if (!membership) {
    throw new Error("Failed to resolve account membership for the authenticated user.");
  }

  return {
    actorUserId: membership.actorUserId,
    accountUserId: membership.accountUserId,
    role: membership.role,
    status: membership.status,
    passwordManagementMode: membership.passwordManagementMode,
    permissions: membership.permissions,
    resourceScopes: membership.resourceScopes,
    canManageSettings: membership.canManageSettings,
    isOwner: membership.isOwner,
    isAdmin: membership.isAdmin,
    isFullAccess: membership.isFullAccess,
  };
}

export async function listAccountMemberships(
  db: D1Database,
  accountUserId: string
): Promise<AccountMembershipSummary[]> {
  const normalizedAccountUserId = normalizeText(accountUserId);
  if (!normalizedAccountUserId) {
    return [];
  }

  const { results } = await db
    .prepare(
      `${selectMembershipBaseSql()}
       WHERE am.account_user_id = ?
       ORDER BY
         CASE am.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         LOWER(COALESCE(member.email, '')) ASC`
    )
    .bind(normalizedAccountUserId)
    .all();

  return ((results || []) as unknown[])
    .map((row) => mapSummaryRow(row))
    .filter((row): row is AccountMembershipSummary => Boolean(row));
}

export async function getAccountMembership(
  db: D1Database,
  memberUserId: string
): Promise<AccountMembershipSummary | null> {
  return getMembershipSummaryRow(db, memberUserId);
}

export async function findAccountMembershipByEmail(
  db: D1Database,
  email: string
): Promise<AccountMembershipSummary | null> {
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const row = await db
    .prepare(
      `${selectMembershipBaseSql()}
       WHERE LOWER(COALESCE(member.email, '')) = LOWER(?)
       LIMIT 1`
    )
    .bind(normalizedEmail)
    .first();

  return mapSummaryRow(row);
}

export async function createAccountMembership(
  db: D1Database,
  input: {
    memberUserId: string;
    accountUserId: string;
    role: AccountRole;
    status?: AccountMembershipStatus;
    passwordManagementMode?: PasswordManagementMode;
    permissions?: Partial<AccountPermissions> | null;
    resourceScopes?: Record<string, unknown> | null;
    createdByUserId?: string | null;
    updatedByUserId?: string | null;
  }
): Promise<void> {
  const memberUserId = normalizeText(input.memberUserId);
  const accountUserId = normalizeText(input.accountUserId);
  if (!memberUserId || !accountUserId) {
    throw new Error("Both member and account user ids are required to create account access.");
  }

  const role = normalizeAccountRole(input.role);
  const status = normalizeAccountMembershipStatus(input.status);
  const passwordManagementMode = normalizePasswordManagementMode(input.passwordManagementMode);
  const permissions = normalizeAccountPermissions(input.permissions || null, role);
  const resourceScopes = normalizeAccountResourceScopes(
    input.resourceScopes || null,
    role,
    permissions
  );
  const nowIso = new Date().toISOString();
  const createdByUserId = normalizeText(input.createdByUserId) || null;
  const updatedByUserId = normalizeText(input.updatedByUserId) || createdByUserId;

  await db
    .prepare(
      `INSERT INTO account_memberships (
         member_user_id,
         account_user_id,
         role,
         status,
         password_management_mode,
         can_view_cameras,
         can_execute_cameras,
         can_view_tasks,
         can_execute_tasks,
         can_view_agents,
         can_execute_agents,
         can_use_chat,
         camera_view_scope,
         camera_execute_scope,
         task_view_scope,
         task_execute_scope,
         agent_view_scope,
         agent_execute_scope,
         created_by_user_id,
         updated_by_user_id,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      memberUserId,
      accountUserId,
      role,
      status,
      passwordManagementMode,
      permissions.can_view_cameras ? 1 : 0,
      permissions.can_execute_cameras ? 1 : 0,
      permissions.can_view_tasks ? 1 : 0,
      permissions.can_execute_tasks ? 1 : 0,
      permissions.can_view_agents ? 1 : 0,
      permissions.can_execute_agents ? 1 : 0,
      permissions.can_use_chat ? 1 : 0,
      resourceScopes.cameras.view,
      resourceScopes.cameras.execute,
      resourceScopes.jobs.view,
      resourceScopes.jobs.execute,
      resourceScopes.agents.view,
      resourceScopes.agents.execute,
      createdByUserId,
      updatedByUserId,
      nowIso,
      nowIso
    )
    .run();
}

export async function updateAccountMembership(
  db: D1Database,
  input: {
    memberUserId: string;
    role: AccountRole;
    status: AccountMembershipStatus;
    passwordManagementMode?: PasswordManagementMode;
    permissions?: Partial<AccountPermissions> | null;
    resourceScopes?: Record<string, unknown> | null;
    updatedByUserId?: string | null;
  }
): Promise<void> {
  const memberUserId = normalizeText(input.memberUserId);
  if (!memberUserId) {
    throw new Error("Member user id is required to update account access.");
  }

  const role = normalizeAccountRole(input.role);
  const status = normalizeAccountMembershipStatus(input.status);
  const passwordManagementMode = normalizePasswordManagementMode(input.passwordManagementMode);
  const permissions = normalizeAccountPermissions(input.permissions || null, role);
  const resourceScopes = normalizeAccountResourceScopes(
    input.resourceScopes || null,
    role,
    permissions
  );
  const updatedByUserId = normalizeText(input.updatedByUserId) || null;
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `UPDATE account_memberships
       SET role = ?,
           status = ?,
           password_management_mode = ?,
           can_view_cameras = ?,
           can_execute_cameras = ?,
           can_view_tasks = ?,
           can_execute_tasks = ?,
           can_view_agents = ?,
           can_execute_agents = ?,
           can_use_chat = ?,
           camera_view_scope = ?,
           camera_execute_scope = ?,
           task_view_scope = ?,
           task_execute_scope = ?,
           agent_view_scope = ?,
           agent_execute_scope = ?,
           updated_by_user_id = ?,
           updated_at = ?
       WHERE member_user_id = ?`
    )
    .bind(
      role,
      status,
      passwordManagementMode,
      permissions.can_view_cameras ? 1 : 0,
      permissions.can_execute_cameras ? 1 : 0,
      permissions.can_view_tasks ? 1 : 0,
      permissions.can_execute_tasks ? 1 : 0,
      permissions.can_view_agents ? 1 : 0,
      permissions.can_execute_agents ? 1 : 0,
      permissions.can_use_chat ? 1 : 0,
      resourceScopes.cameras.view,
      resourceScopes.cameras.execute,
      resourceScopes.jobs.view,
      resourceScopes.jobs.execute,
      resourceScopes.agents.view,
      resourceScopes.agents.execute,
      updatedByUserId,
      nowIso,
      memberUserId
    )
    .run();
}

export function buildAccountAccessPayload(context: AccountAccessContext) {
  return {
    account_user_id: context.accountUserId,
    role: context.role,
    status: context.status,
    password_management_mode: context.passwordManagementMode,
    is_owner: context.isOwner,
    is_admin: context.isAdmin,
    can_manage_settings: context.canManageSettings,
    full_access: context.isFullAccess,
    permissions: {
      view_cameras: context.permissions.can_view_cameras,
      execute_cameras: context.permissions.can_execute_cameras,
      view_tasks: context.permissions.can_view_tasks,
      execute_tasks: context.permissions.can_execute_tasks,
      view_agents: context.permissions.can_view_agents,
      execute_agents: context.permissions.can_execute_agents,
      chat: context.permissions.can_use_chat,
    },
    resource_scopes: {
      cameras: {
        view: context.resourceScopes.cameras.view,
        execute: context.resourceScopes.cameras.execute,
      },
      jobs: {
        view: context.resourceScopes.jobs.view,
        execute: context.resourceScopes.jobs.execute,
      },
      agents: {
        view: context.resourceScopes.agents.view,
        execute: context.resourceScopes.agents.execute,
      },
    },
  };
}

function normalizeAccountScopedResourceType(value: unknown): AccountScopedResourceType | null {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "camera" ||
    normalized === "job" ||
    normalized === "camera_algorithm" ||
    normalized === "job_step_agent"
  ) {
    return normalized;
  }
  return null;
}

function mapGrantRow(value: unknown): AccountMembershipResourceGrantRow | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const memberUserId = normalizeText(row.member_user_id ?? row.memberUserId);
  const resourceType = normalizeAccountScopedResourceType(
    row.resource_type ?? row.resourceType
  );
  const resourceId = Number(row.resource_id ?? row.resourceId);
  if (!memberUserId || !resourceType || !Number.isInteger(resourceId) || resourceId <= 0) {
    return null;
  }

  return {
    memberUserId,
    resourceType,
    resourceId,
    canView: normalizeBoolean(row.can_view ?? row.canView),
    canExecute: normalizeBoolean(row.can_execute ?? row.canExecute),
  };
}

export function buildAccountMembershipResourceGrantPayload(
  rows: AccountMembershipResourceGrantRow[]
): AccountMembershipResourceGrantPayload {
  const payload = buildEmptyAccountMembershipResourceGrantPayload();
  for (const row of rows) {
    if (!row || row.resourceId <= 0) {
      continue;
    }

    if (row.resourceType === "camera") {
      if (row.canView) payload.cameras.viewIds.push(row.resourceId);
      if (row.canExecute) payload.cameras.executeIds.push(row.resourceId);
      continue;
    }

    if (row.resourceType === "job") {
      if (row.canView) payload.jobs.viewIds.push(row.resourceId);
      if (row.canExecute) payload.jobs.executeIds.push(row.resourceId);
      continue;
    }

    const key = serializeAccountAgentGrantKey(
      row.resourceType,
      row.resourceId
    );
    if (row.canView) payload.agents.viewIds.push(key);
    if (row.canExecute) payload.agents.executeIds.push(key);
  }

  return normalizeAccountMembershipResourceGrantPayload(payload);
}

export async function listAccountMembershipResourceGrants(
  db: D1Database,
  memberUserId: string,
  resourceType?: AccountScopedResourceType
): Promise<AccountMembershipResourceGrantRow[]> {
  const normalizedMemberUserId = normalizeText(memberUserId);
  if (!normalizedMemberUserId) {
    return [];
  }

  const normalizedResourceType = resourceType
    ? normalizeAccountScopedResourceType(resourceType)
    : null;
  const statement = normalizedResourceType
    ? db.prepare(
        `SELECT member_user_id, resource_type, resource_id, can_view, can_execute
         FROM account_membership_resource_grants
         WHERE member_user_id = ?
           AND resource_type = ?
         ORDER BY resource_type ASC, resource_id ASC`
      ).bind(normalizedMemberUserId, normalizedResourceType)
    : db.prepare(
        `SELECT member_user_id, resource_type, resource_id, can_view, can_execute
         FROM account_membership_resource_grants
         WHERE member_user_id = ?
         ORDER BY resource_type ASC, resource_id ASC`
      ).bind(normalizedMemberUserId);

  const { results } = await statement.all();
  return ((results || []) as unknown[])
    .map((row) => mapGrantRow(row))
    .filter((row): row is AccountMembershipResourceGrantRow => Boolean(row));
}

export async function listGrantedAccountResourceIds(
  db: D1Database,
  memberUserId: string,
  resourceType: AccountScopedResourceType,
  action: AccountScopedAction
): Promise<number[]> {
  const normalizedMemberUserId = normalizeText(memberUserId);
  const normalizedResourceType = normalizeAccountScopedResourceType(resourceType);
  if (!normalizedMemberUserId || !normalizedResourceType) {
    return [];
  }

  const column = action === "execute" ? "can_execute" : "can_view";
  const { results } = await db
    .prepare(
      `SELECT resource_id
       FROM account_membership_resource_grants
       WHERE member_user_id = ?
         AND resource_type = ?
         AND ${column} = 1
       ORDER BY resource_id ASC`
    )
    .bind(normalizedMemberUserId, normalizedResourceType)
    .all();

  return Array.from(
    new Set(
      ((results || []) as Array<Record<string, unknown>>)
        .map((row) => Number(row?.resource_id))
        .filter((row) => Number.isInteger(row) && row > 0)
    )
  ).sort((left, right) => left - right);
}

export async function replaceAccountMembershipResourceGrants(
  db: D1Database,
  input: {
    memberUserId: string;
    resourceScopes: AccountResourceScopes;
    grants: AccountMembershipResourceGrantPayload;
  }
): Promise<void> {
  const memberUserId = normalizeText(input.memberUserId);
  if (!memberUserId) {
    throw new Error("Member user id is required to replace resource grants.");
  }

  const resourceScopes = input.resourceScopes;
  const grants = normalizeAccountMembershipResourceGrantPayload(input.grants);
  const nowIso = new Date().toISOString();
  const rowMap = new Map<string, AccountMembershipResourceGrantRow>();

  const upsertRow = (
    resourceType: AccountScopedResourceType,
    resourceId: number,
    action: AccountScopedAction
  ) => {
    if (!Number.isInteger(resourceId) || resourceId <= 0) {
      return;
    }
    const key = `${resourceType}:${resourceId}`;
    const existing = rowMap.get(key) || {
      memberUserId,
      resourceType,
      resourceId,
      canView: false,
      canExecute: false,
    };
    if (action === "view") {
      existing.canView = true;
    } else {
      existing.canExecute = true;
      existing.canView = true;
    }
    rowMap.set(key, existing);
  };

  const applyNumericResource = (
    resourceType: "camera" | "job",
    scopeSet: AccountResourceScopeSet,
    grantSet: { viewIds: number[]; executeIds: number[] }
  ) => {
    if (scopeSet.view === "selected") {
      for (const resourceId of grantSet.viewIds) {
        upsertRow(resourceType, resourceId, "view");
      }
    }
    if (scopeSet.execute === "selected") {
      for (const resourceId of grantSet.executeIds) {
        upsertRow(resourceType, resourceId, "execute");
      }
    }
  };

  applyNumericResource("camera", resourceScopes.cameras, grants.cameras);
  applyNumericResource("job", resourceScopes.jobs, grants.jobs);

  if (resourceScopes.agents.view === "selected") {
    for (const key of grants.agents.viewIds) {
      const parsed = parseAccountAgentGrantKey(key);
      if (!parsed) continue;
      upsertRow(parsed.resourceType, parsed.resourceId, "view");
    }
  }
  if (resourceScopes.agents.execute === "selected") {
    for (const key of grants.agents.executeIds) {
      const parsed = parseAccountAgentGrantKey(key);
      if (!parsed) continue;
      upsertRow(parsed.resourceType, parsed.resourceId, "execute");
    }
  }

  await db
    .prepare(`DELETE FROM account_membership_resource_grants WHERE member_user_id = ?`)
    .bind(memberUserId)
    .run();

  for (const row of rowMap.values()) {
    await db
      .prepare(
        `INSERT INTO account_membership_resource_grants (
           member_user_id,
           resource_type,
           resource_id,
           can_view,
           can_execute,
           created_at,
           updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.memberUserId,
        row.resourceType,
        row.resourceId,
        row.canView ? 1 : 0,
        row.canExecute ? 1 : 0,
        nowIso,
        nowIso
      )
      .run();
  }
}

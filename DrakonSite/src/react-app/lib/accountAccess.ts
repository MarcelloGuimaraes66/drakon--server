type AccountPermissions = {
  view_cameras?: boolean;
  execute_cameras?: boolean;
  view_tasks?: boolean;
  execute_tasks?: boolean;
  view_agents?: boolean;
  execute_agents?: boolean;
  chat?: boolean;
};

type AccountResourceScopeMode = "all" | "selected";

type AccountResourceScopeSet = {
  view?: AccountResourceScopeMode;
  execute?: AccountResourceScopeMode;
};

type AccountResourceScopes = {
  cameras?: AccountResourceScopeSet;
  jobs?: AccountResourceScopeSet;
  agents?: AccountResourceScopeSet;
};

type AccountAccess = {
  account_user_id?: string;
  actor_user_id?: string;
  role?: string;
  status?: string;
  is_owner?: boolean;
  is_admin?: boolean;
  can_manage_settings?: boolean;
  managed_password?: boolean;
  full_access?: boolean;
  permissions?: AccountPermissions;
  resource_scopes?: AccountResourceScopes;
};

type AccountAwareUser = {
  account_access?: AccountAccess | null;
};

type PreferredRouteOptions = {
  billingEnabled?: boolean;
  drakonFindEnabled?: boolean;
};

function readAccess(user: unknown): AccountAccess | null {
  if (!user || typeof user !== "object") {
    return null;
  }

  const access = (user as AccountAwareUser).account_access;
  return access && typeof access === "object" ? access : null;
}

function isLegacyFullAccessUser(user: unknown): boolean {
  return !!user && !readAccess(user);
}

function isActive(user: unknown): boolean {
  const access = readAccess(user);
  if (!access) {
    return !!user;
  }
  return String(access.status || "active").trim().toLowerCase() !== "disabled";
}

function hasFullAccess(user: unknown): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  return access.full_access === true || access.is_owner === true || access.is_admin === true;
}

function hasPermission(user: unknown, key: keyof AccountPermissions): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  if (!isActive(user)) {
    return false;
  }
  if (access.full_access === true || access.is_owner === true || access.is_admin === true) {
    return true;
  }
  return access.permissions?.[key] === true;
}

function hasCreateScope(user: unknown, module: keyof AccountResourceScopes): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  if (!isActive(user)) {
    return false;
  }
  if (access.full_access === true || access.is_owner === true || access.is_admin === true) {
    return true;
  }
  const scope = access.resource_scopes?.[module]?.execute;
  return (scope || "all") === "all";
}

export function canViewCameras(user: unknown): boolean {
  return hasPermission(user, "view_cameras");
}

export function canExecuteCameras(user: unknown): boolean {
  return hasPermission(user, "execute_cameras");
}

export function canCreateCameras(user: unknown): boolean {
  return canExecuteCameras(user) && hasCreateScope(user, "cameras");
}

export function canViewTasks(user: unknown): boolean {
  return hasPermission(user, "view_tasks");
}

export function canExecuteTasks(user: unknown): boolean {
  return hasPermission(user, "execute_tasks");
}

export function canCreateTasks(user: unknown): boolean {
  return canExecuteTasks(user) && hasCreateScope(user, "jobs");
}

export function canViewAgents(user: unknown): boolean {
  return hasPermission(user, "view_agents");
}

export function canExecuteAgents(user: unknown): boolean {
  return hasPermission(user, "execute_agents");
}

export function canCreateAgents(user: unknown): boolean {
  return canExecuteAgents(user) && hasCreateScope(user, "agents");
}

export function canUseChat(user: unknown): boolean {
  return hasPermission(user, "chat");
}

export function canManageSettings(user: unknown): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  if (!isActive(user)) {
    return false;
  }
  return access.can_manage_settings === true || access.is_owner === true || access.is_admin === true;
}

export function canAccessBilling(user: unknown): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  if (!isActive(user)) {
    return false;
  }
  return access.is_owner === true;
}

export function isAccountOwner(user: unknown): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  return isActive(user) && access.is_owner === true;
}

export function isAccountAdmin(user: unknown): boolean {
  const access = readAccess(user);
  if (!access) {
    return isLegacyFullAccessUser(user);
  }
  return isActive(user) && access.is_admin === true;
}

export function canViewDashboard(user: unknown): boolean {
  return hasFullAccess(user);
}

export function canViewEvents(user: unknown): boolean {
  return hasFullAccess(user);
}

export function canAccessHub(user: unknown): boolean {
  return canViewAgents(user) || canViewTasks(user);
}

export function isManagedPasswordUser(user: unknown): boolean {
  const access = readAccess(user);
  return access?.managed_password === true;
}

export function getDefaultAuthorizedRoute(
  user: unknown,
  options: PreferredRouteOptions = {}
): string {
  if (!user || !isActive(user)) {
    return "/login";
  }

  if (canViewDashboard(user)) {
    return "/dashboard";
  }
  if (canViewAgents(user)) {
    return "/ai-agents";
  }
  if (options.drakonFindEnabled && canViewAgents(user)) {
    return "/drakon-find";
  }
  if (canViewCameras(user)) {
    return "/cameras";
  }
  if (canViewTasks(user)) {
    return "/jobs";
  }
  if (canUseChat(user)) {
    return "/chat";
  }
  if (canManageSettings(user)) {
    return "/settings";
  }
  if (options.billingEnabled && canAccessBilling(user)) {
    return "/billing";
  }
  return "/login";
}

export function canAccessRoute(
  user: unknown,
  pathname: string,
  options: PreferredRouteOptions = {}
): boolean {
  if (!user || !isActive(user)) {
    return false;
  }

  if (pathname === "/" || pathname === "") {
    return true;
  }
  if (pathname.startsWith("/dashboard")) {
    return canViewDashboard(user);
  }
  if (pathname.startsWith("/ai-agents") || pathname.startsWith("/algorithms/")) {
    return canViewAgents(user);
  }
  if (pathname.startsWith("/hub")) {
    return canAccessHub(user);
  }
  if (pathname.startsWith("/drakon-find")) {
    return options.drakonFindEnabled ? canViewAgents(user) : false;
  }
  if (pathname.startsWith("/cameras")) {
    return canViewCameras(user);
  }
  if (pathname.startsWith("/jobs")) {
    return canViewTasks(user);
  }
  if (pathname.startsWith("/chat")) {
    return canUseChat(user);
  }
  if (pathname.startsWith("/events")) {
    return canViewEvents(user);
  }
  if (pathname.startsWith("/billing")) {
    return options.billingEnabled ? canAccessBilling(user) : false;
  }
  if (pathname.startsWith("/settings")) {
    return canManageSettings(user);
  }

  return true;
}

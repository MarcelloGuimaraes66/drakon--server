import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "@getmocha/users-service/react";
import { useTranslation } from "react-i18next";
import NotificationsDropdown from "@/react-app/components/NotificationsDropdown";
import FloatingChatButton from "@/react-app/components/FloatingChatButton";
import QuickChatOverlay from "@/react-app/components/QuickChatOverlay";
import MinimizedChatTabs from "@/react-app/components/MinimizedChatTabs";
import LanguageSelector from "@/react-app/components/LanguageSelector";
import BrandLogo from "@/react-app/components/BrandLogo";
import SystemActivityModal from "@/react-app/components/SystemActivityModal";
import TutorialOverlay from "@/react-app/components/TutorialOverlay";
import { useRemoteWorkspace } from "@/react-app/contexts/RemoteWorkspaceContext";
import { useDashboardSummary } from "@/react-app/hooks/useDashboardSummary";
import { useEffectiveUser } from "@/react-app/hooks/useEffectiveUser";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { useTheme } from "@/react-app/hooks/useTheme";
import {
  canAccessBilling,
  canAccessHub,
  canManageSettings,
  canUseChat,
  canViewAgents,
  canViewCameras,
  canViewDashboard,
  canViewEvents,
  canViewTasks,
} from "@/react-app/lib/accountAccess";
import type { OnboardingTutorialKind } from "@/react-app/lib/onboarding";
import { brand, getBrandStorageKey, getBrandWindowEventName } from "@/shared/brand";
import {
  Activity,
  CheckCircle2,
  LayoutDashboard,
  Camera,
  MessageSquare,
  FileText,
  CreditCard,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Briefcase,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  Moon,
  MonitorSmartphone,
  Sun,
  Radar,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

interface LayoutProps {
  children: ReactNode;
}

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type SidebarNavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  description: string;
  badgeCount?: number;
};

type SidebarNavGroup = {
  id: "primary" | "system";
  label: string;
  items: SidebarNavItem[];
};

type SidebarHoverHint = {
  name: string;
  description: string;
  top: number;
  left: number;
};

const CHAT_AUTO_COLLAPSE_DELAY_MS = 260;
const CHAT_AUTO_EXPAND_DELAY_MS = 1000;
const SIDEBAR_DESCRIPTION_HOVER_DELAY_MS = 2000;
const LOCAL_WORKSPACE_ACCESS_API_PREFIX = "/api/desktop-workspace-access";

function getSidebarSectionLabels(language: string) {
  if (language.startsWith("pt") || language.startsWith("es")) {
    return { primary: "Principal", system: "Sistema" };
  }

  if (language.startsWith("fr")) {
    return { primary: "Principal", system: "Systeme" };
  }

  return { primary: "Primary", system: "System" };
}

function formatSidebarBadgeCount(count?: number) {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(count);
}

function getStandaloneTutorialCamera(
  cameras: Array<{ id?: unknown; name?: unknown }>
): { id: number; name: string } | null {
  const availableCameras = cameras
    .map((camera) => ({
      id: typeof camera.id === "number" && Number.isInteger(camera.id) && camera.id > 0
        ? camera.id
        : null,
      name: typeof camera.name === "string" ? camera.name.trim().toLowerCase() : "",
    }))
    .filter((camera): camera is { id: number; name: string } => camera.id !== null);

  const matchedCamera = availableCameras.find((camera) => camera.name.includes("tutorial"));
  return matchedCamera ?? null;
}

type ApiKeyPromptStatus = {
  hasOpenAiKey: boolean | null;
  hasZAiKey: boolean | null;
  hasAnyApiKey: boolean | null;
  hasConfirmedNoApiKeys: boolean;
};

type PendingWorkspaceAccessRequest = {
  sessionId: string;
  operatorDisplayLabel: string;
  permissionProfile: string;
  requestedAt: string;
};

type ActiveWorkspaceAccessSession = {
  sessionId: string;
  operatorDisplayLabel: string;
  permissionProfile: string;
  connectedAt: string | null;
  updatedAt: string;
};

type DesktopShellWindow = Window & {
  chrome?: {
    webview?: {
      postMessage?: (message: unknown) => void;
    };
  };
  __drakonDesktopShell?: boolean;
};

function isDesktopShellWindow(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const desktopWindow = window as DesktopShellWindow;
  return (
    desktopWindow.__drakonDesktopShell === true ||
    Boolean(desktopWindow.chrome?.webview)
  );
}

function describeWorkspacePermissionProfile(
  permissionProfile: string,
  translate: (key: string) => string
) {
  if (permissionProfile === "full_access") {
    return translate("settings.workspaceAccess.permission.fullAccess");
  }
  if (permissionProfile === "scoped_access") {
    return translate("settings.workspaceAccess.permission.scopedAccess");
  }
  return permissionProfile || translate("settings.workspaceAccess.permission.remoteAccess");
}

function formatWorkspaceAccessStartedAt(value: string | null | undefined) {
  const parsedAt = Date.parse(String(value || "").trim());
  if (!Number.isFinite(parsedAt)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsedAt));
}

async function readApiKeyPromptStatus(): Promise<ApiKeyPromptStatus | null> {
  const readHasKey = async (url: string): Promise<boolean | null> => {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        return null;
      }

      const data = await response.json().catch(() => ({}));
      return Boolean((data as { has_key?: unknown }).has_key);
    } catch {
      return null;
    }
  };

  const [hasOpenAiKey, hasZAiKey] = await Promise.all([
    readHasKey("/api/openai-settings"),
    readHasKey("/api/zai-settings"),
  ]);

  if (hasOpenAiKey === null && hasZAiKey === null) {
    return null;
  }

  const hasAnyApiKey =
    hasOpenAiKey === true || hasZAiKey === true
      ? true
      : hasOpenAiKey === false && hasZAiKey === false
      ? false
      : null;

  return {
    hasOpenAiKey,
    hasZAiKey,
    hasAnyApiKey,
    hasConfirmedNoApiKeys: hasOpenAiKey === false && hasZAiKey === false,
  };
}

export default function Layout({ children }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { effectiveUser } = useEffectiveUser();
  const {
    isRemote: isRemoteWorkspace,
    session: remoteWorkspaceSession,
    remoteUser,
    ownerDisplayLabel,
    operatorDisplayLabel,
    error: remoteWorkspaceError,
    endSession: endRemoteWorkspaceSession,
  } = useRemoteWorkspace();
  const { startTutorial, status: onboardingStatus } = useOnboarding();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [isSidebarCollapsedDesktop, setIsSidebarCollapsedDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(getBrandStorageKey("sidebarCollapsed")) === "1";
  });
  const [isChatAutoCollapsedDesktop, setIsChatAutoCollapsedDesktop] = useState(false);
  const [showSidebarCollapseCue, setShowSidebarCollapseCue] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isNotificationsBadgeDismissed, setIsNotificationsBadgeDismissed] = useState(false);
  const [isSystemActivityOpen, setIsSystemActivityOpen] = useState(false);
  const [showOpenAiKeyPrompt, setShowOpenAiKeyPrompt] = useState(false);
  const [showZAiKeyPrompt, setShowZAiKeyPrompt] = useState(false);
  const [isTutorialMenuOpen, setIsTutorialMenuOpen] = useState(false);
  const [sidebarHoverHint, setSidebarHoverHint] = useState<SidebarHoverHint | null>(null);
  const [pendingWorkspaceRequests, setPendingWorkspaceRequests] = useState<
    PendingWorkspaceAccessRequest[]
  >([]);
  const [activeWorkspaceSessions, setActiveWorkspaceSessions] = useState<
    ActiveWorkspaceAccessSession[]
  >([]);
  const [workspaceRequestAction, setWorkspaceRequestAction] = useState("");
  const [activeWorkspaceSessionAction, setActiveWorkspaceSessionAction] = useState("");
  const [isRemoteAccessIndicatorOpen, setIsRemoteAccessIndicatorOpen] = useState(false);
  const previousPathnameRef = useRef("");
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarHoverHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUnreadCountRef = useRef(0);
  const workspaceHeartbeatInstanceIdRef = useRef(
    `desktop_${Math.random().toString(36).slice(2, 10)}`
  );
  const notificationsContainerRef = useRef<HTMLDivElement>(null);
  const tutorialMenuRef = useRef<HTMLDivElement>(null);
  const remoteAccessIndicatorRef = useRef<HTMLDivElement>(null);
  const isSettingsRoute = /(^|\/)settings(\/|$)/.test(location.pathname);
  const isSidebarCollapsed = isDesktop && (isSidebarCollapsedDesktop || isChatAutoCollapsedDesktop);
  const currentBrandId = brand.id.toLowerCase();
  const isPerceptrumBrand = currentBrandId === "perceptrum";
  const isDrakonBrand = currentBrandId === "drakon";
  const billingEnabled = brand.features.billingEnabled;
  const drakonFindEnabled = brand.features.drakonFindEnabled;
  const canOpenDashboard = canViewDashboard(effectiveUser);
  const canOpenAgents = canViewAgents(effectiveUser);
  const canOpenHub = canAccessHub(effectiveUser);
  const canOpenDrakonFind = drakonFindEnabled && canViewAgents(effectiveUser);
  const canOpenJobs = canViewTasks(effectiveUser);
  const canOpenChat = canUseChat(effectiveUser);
  const canOpenCameras = canViewCameras(effectiveUser);
  const canOpenEvents = canViewEvents(effectiveUser);
  const canOpenBilling = billingEnabled && canAccessBilling(effectiveUser);
  const canOpenSettings = canManageSettings(effectiveUser);
  const collapsedBrandIconClassName =
    isPerceptrumBrand
      ? "h-10 w-14 object-contain"
      : "h-8 w-8 object-contain rounded-md";
  const expandedSidebarWidthClass = "md:w-[17.5rem]";
  const collapsedSidebarWidthClass = "md:w-[5rem]";
  const mobileSidebarWidthClass = "w-[min(17.5rem,88vw)]";
  const sidebarScrollToneClass = isDrakonBrand
    ? "sidebar-nav-scroll-neutral"
    : "sidebar-nav-scroll-accent";
  const sidebarEdgeLineClass = isDrakonBrand
    ? "bg-white/10"
    : "bg-blue-400/35";
  const sidebarEdgeGlowClass = "-right-px w-px bg-transparent";
  const sidebarActiveCardClass = "fluent-nav-item-active";
  const sidebarIdleCardClass = "fluent-nav-item-idle";
  const sidebarActiveOverlayClass = "opacity-0";
  const sidebarHoverOverlayClass = "opacity-0";
  const sidebarActiveRailClass = "w-[3px] bg-blue-500 opacity-100";
  const sidebarIdleRailClass = "w-px bg-transparent opacity-0";
  const sidebarActiveIconClass = "fluent-nav-icon-active";
  const sidebarIdleIconClass = "fluent-nav-icon-idle";
  const sidebarActiveIconOverlayClass = "opacity-0";
  const sidebarHoverIconOverlayClass = "opacity-0";
  const sidebarActiveDescriptionClass = "text-gray-400";
  const sidebarActiveDotClass = "bg-blue-500";
  const sidebarBadgeToneClass = "border-blue-500/30 bg-blue-600";
  const sidebarTooltipToneClass = "fluent-flyout";
  const sidebarTooltipTitleClass = "text-gray-500";
  const sidebarTooltipBodyClass = "text-gray-200";
  const sidebarSectionLabels = useMemo(
    () => getSidebarSectionLabels((i18n.resolvedLanguage || i18n.language || "en").toLowerCase()),
    [i18n.language, i18n.resolvedLanguage]
  );
  const localSidebarPrimaryLabel =
    (typeof user?.google_user_data?.name === "string" && user.google_user_data.name.trim()) ||
    (typeof user?.email === "string" ? user.email.trim() : "") ||
    "";
  const localSidebarSecondaryLabel =
    typeof user?.email === "string" &&
    user.email.trim() &&
    user.email.trim() !== localSidebarPrimaryLabel
      ? user.email.trim()
      : "";
  const remoteSidebarHandleLabel =
    (typeof remoteUser?.handle === "string" && remoteUser.handle.trim()
      ? `@${remoteUser.handle.trim().replace(/^@+/, "")}`
      : "") ||
    ownerDisplayLabel ||
    (typeof remoteWorkspaceSession?.owner_handle === "string" &&
    remoteWorkspaceSession.owner_handle.trim()
      ? `@${remoteWorkspaceSession.owner_handle.trim().replace(/^@+/, "")}`
      : "") ||
    "";
  const remoteSidebarEmail =
    (typeof remoteUser?.email === "string" && remoteUser.email.trim()) ||
    (typeof remoteWorkspaceSession?.owner_email === "string"
      ? remoteWorkspaceSession.owner_email.trim()
      : "") ||
    "";
  const remoteSidebarName =
    typeof remoteUser?.google_user_data?.name === "string"
      ? remoteUser.google_user_data.name.trim()
      : "";
  const remoteSidebarPrimaryLabel =
    remoteSidebarName || remoteSidebarHandleLabel || remoteSidebarEmail;
  const remoteSidebarSecondaryLabel =
    remoteSidebarHandleLabel && remoteSidebarHandleLabel !== remoteSidebarPrimaryLabel
      ? remoteSidebarHandleLabel
      : remoteSidebarEmail && remoteSidebarEmail !== remoteSidebarPrimaryLabel
      ? remoteSidebarEmail
      : "";
  const remoteWindowOwnerLabel =
    remoteSidebarName ||
    ownerDisplayLabel ||
    remoteSidebarHandleLabel ||
    remoteSidebarEmail ||
    "Outro usuario";
  const remoteWindowOwnerMetaLabel =
    remoteSidebarHandleLabel && remoteSidebarHandleLabel !== remoteWindowOwnerLabel
      ? remoteSidebarHandleLabel
      : remoteSidebarEmail && remoteSidebarEmail !== remoteWindowOwnerLabel
      ? remoteSidebarEmail
      : "";
  const sidebarProfilePrimaryLabel = isRemoteWorkspace
    ? remoteSidebarPrimaryLabel
    : localSidebarPrimaryLabel;
  const sidebarProfileSecondaryLabel = isRemoteWorkspace
    ? remoteSidebarSecondaryLabel
    : localSidebarSecondaryLabel;
  const sidebarProfileAvatarSeed =
    sidebarProfilePrimaryLabel || sidebarProfileSecondaryLabel || "U";
  
  // Use unified dashboard summary hook
  const { cameras, dashboard, unreadCount, tokenUsageMonth } = useDashboardSummary();
  const hasUnreadNotifications = unreadCount > 0 && !isNotificationsBadgeDismissed;

  // Auto-close drawer on route change
  useEffect(() => {
    setIsSidebarOpen(false);
    setSidebarHoverHint(null);
    setIsTutorialMenuOpen(false);
    setIsRemoteAccessIndicatorOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      if (sidebarHoverHintTimeoutRef.current) {
        clearTimeout(sidebarHoverHintTimeoutRef.current);
        sidebarHoverHintTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const onChange = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches);
      if (event.matches) {
        setIsSidebarOpen(false);
      }
    };
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      getBrandStorageKey("sidebarCollapsed"),
      isSidebarCollapsedDesktop ? "1" : "0"
    );
  }, [isSidebarCollapsedDesktop]);

  useEffect(() => {
    const clearTimers = () => {
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      if (clearCueTimeoutRef.current) {
        clearTimeout(clearCueTimeoutRef.current);
        clearCueTimeoutRef.current = null;
      }
      if (expandTimeoutRef.current) {
        clearTimeout(expandTimeoutRef.current);
        expandTimeoutRef.current = null;
      }
    };

    const previousPathname = previousPathnameRef.current;
    const isChatRoute = location.pathname.startsWith("/chat");
    const wasChatRoute = previousPathname.startsWith("/chat");

    if (!isDesktop) {
      previousPathnameRef.current = location.pathname;
      return () => clearTimers();
    }

    if (isChatRoute && !wasChatRoute && !isSidebarCollapsedDesktop && !isChatAutoCollapsedDesktop) {
      clearTimers();
      setShowSidebarCollapseCue(true);
      collapseTimeoutRef.current = setTimeout(() => {
        setIsChatAutoCollapsedDesktop(true);
        clearCueTimeoutRef.current = setTimeout(() => {
          setShowSidebarCollapseCue(false);
        }, 220);
      }, CHAT_AUTO_COLLAPSE_DELAY_MS);
    } else if (!isChatRoute && wasChatRoute && isChatAutoCollapsedDesktop) {
      clearTimers();
      setShowSidebarCollapseCue(false);
      expandTimeoutRef.current = setTimeout(() => {
        setIsChatAutoCollapsedDesktop(false);
        expandTimeoutRef.current = null;
      }, CHAT_AUTO_EXPAND_DELAY_MS);
    }

    previousPathnameRef.current = location.pathname;

    return () => {
      if (!location.pathname.startsWith("/chat")) {
        clearTimers();
        setShowSidebarCollapseCue(false);
      }
    };
  }, [location.pathname, isDesktop, isSidebarCollapsedDesktop, isChatAutoCollapsedDesktop]);

  useEffect(() => {
    const previousUnreadCount = previousUnreadCountRef.current;
    if (unreadCount <= 0) {
      setIsNotificationsBadgeDismissed(false);
    } else if (unreadCount > previousUnreadCount) {
      setIsNotificationsBadgeDismissed(false);
    }
    previousUnreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (!isNotificationsOpen) return;

    const closeNotifications = () => {
      setIsNotificationsBadgeDismissed(true);
      setIsNotificationsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNotifications();
      }
    };

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (!isTutorialMenuOpen) return;

    const closeTutorialMenu = () => setIsTutorialMenuOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      if (tutorialMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      closeTutorialMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTutorialMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isTutorialMenuOpen]);

  useEffect(() => {
    if (activeWorkspaceSessions.length === 0) {
      setIsRemoteAccessIndicatorOpen(false);
    }
  }, [activeWorkspaceSessions.length]);

  useEffect(() => {
    if (!isRemoteAccessIndicatorOpen) return;

    const closeRemoteAccessIndicator = () => setIsRemoteAccessIndicatorOpen(false);
    const handlePointerDown = (event: PointerEvent) => {
      if (remoteAccessIndicatorRef.current?.contains(event.target as Node)) {
        return;
      }

      closeRemoteAccessIndicator();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRemoteAccessIndicator();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isRemoteAccessIndicatorOpen]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);

  useEffect(() => {
    if (isSettingsRoute || !canOpenSettings) {
      setShowOpenAiKeyPrompt(false);
      setShowZAiKeyPrompt(false);
      return;
    }

    let cancelled = false;

    const syncApiKeyPrompts = async () => {
      const promptStatus = await readApiKeyPromptStatus();
      if (cancelled || !promptStatus) return;

      if (promptStatus.hasAnyApiKey) {
        setShowOpenAiKeyPrompt(false);
        setShowZAiKeyPrompt(false);
        return;
      }

      if (!promptStatus.hasConfirmedNoApiKeys) {
        return;
      }

      // Keep a single initial prompt visible when no providers are configured.
      setShowOpenAiKeyPrompt(true);
      setShowZAiKeyPrompt(false);
    };

    void syncApiKeyPrompts();
    return () => {
      cancelled = true;
    };
  }, [canOpenSettings, isSettingsRoute, user?.id]);

  useEffect(() => {
    let cancelled = false;

    const syncPromptForMissingProvider = async (provider: "openai" | "zai") => {
      if (isSettingsRoute || !canOpenSettings) {
        setShowOpenAiKeyPrompt(false);
        setShowZAiKeyPrompt(false);
        return;
      }

      const promptStatus = await readApiKeyPromptStatus();
      if (cancelled || !promptStatus) return;

      if (promptStatus.hasAnyApiKey) {
        setShowOpenAiKeyPrompt(false);
        setShowZAiKeyPrompt(false);
        return;
      }

      if (!promptStatus.hasConfirmedNoApiKeys) {
        return;
      }

      if (provider === "openai") {
        setShowOpenAiKeyPrompt(true);
        setShowZAiKeyPrompt(false);
        return;
      }

      setShowOpenAiKeyPrompt(false);
      setShowZAiKeyPrompt(true);
    };

    const onOpenAiKeyRequired = () => {
      if (isSettingsRoute || !canOpenSettings) {
        setShowOpenAiKeyPrompt(false);
        setShowZAiKeyPrompt(false);
        return;
      }
      void syncPromptForMissingProvider("openai");
    };
    const onZAiKeyRequired = () => {
      if (isSettingsRoute || !canOpenSettings) {
        setShowOpenAiKeyPrompt(false);
        setShowZAiKeyPrompt(false);
        return;
      }
      void syncPromptForMissingProvider("zai");
    };
    window.addEventListener(
      getBrandWindowEventName("openAiKeyRequired"),
      onOpenAiKeyRequired as EventListener
    );
    window.addEventListener(
      getBrandWindowEventName("zAiKeyRequired"),
      onZAiKeyRequired as EventListener
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        getBrandWindowEventName("openAiKeyRequired"),
        onOpenAiKeyRequired as EventListener
      );
      window.removeEventListener(
        getBrandWindowEventName("zAiKeyRequired"),
        onZAiKeyRequired as EventListener
      );
    };
  }, [canOpenSettings, isSettingsRoute]);

  useEffect(() => {
    if (
      !brand.features.workspaceAccessEnabled ||
      !user?.id ||
      !canOpenSettings ||
      !isDesktopShellWindow() ||
      isRemoteWorkspace
    ) {
      return;
    }

    const sendWorkspaceHeartbeat = async () => {
      await fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/heartbeat`, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          app_instance_id: workspaceHeartbeatInstanceIdRef.current,
        }),
      }).catch(() => null);
    };

    void sendWorkspaceHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendWorkspaceHeartbeat();
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [canOpenSettings, isRemoteWorkspace, user?.id]);

  useEffect(() => {
    if (
      !brand.features.workspaceAccessEnabled ||
      !user?.id ||
      !canOpenSettings ||
      !isDesktopShellWindow()
    ) {
      return;
    }

    const loadWorkspaceAccessState = async () => {
      const [pendingResult, activeResult] = await Promise.allSettled([
        fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/pending-requests`, {
          credentials: "include",
          cache: "no-store",
        }),
        fetch(`${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/active-sessions`, {
          credentials: "include",
          cache: "no-store",
        }),
      ]);

      if (pendingResult.status === "fulfilled") {
        try {
          const payload = await pendingResult.value.json().catch(() => ({}));
          if (pendingResult.value.ok) {
            const requests = Array.isArray((payload as any)?.requests)
              ? ((payload as any).requests as Array<Record<string, unknown>>).map((request) => ({
                  sessionId: String(request.sessionId || request.session_id || ""),
                  operatorDisplayLabel: String(
                    request.operatorDisplayLabel || request.operator_display_label || ""
                  ),
                  permissionProfile: String(
                    request.permissionProfile || request.permission_profile || "full_access"
                  ),
                  requestedAt: String(request.requestedAt || request.requested_at || ""),
                }))
              : [];
            setPendingWorkspaceRequests(requests.filter((request) => request.sessionId));
          }
        } catch {
          // keep the previous request list when polling fails
        }
      }

      if (activeResult.status === "fulfilled") {
        try {
          const payload = await activeResult.value.json().catch(() => ({}));
          if (activeResult.value.ok) {
            const sessions = Array.isArray((payload as any)?.sessions)
              ? ((payload as any).sessions as Array<Record<string, unknown>>).map((session) => ({
                  sessionId: String(session.sessionId || session.session_id || ""),
                  operatorDisplayLabel: String(
                    session.operatorDisplayLabel || session.operator_display_label || ""
                  ),
                  permissionProfile: String(
                    session.permissionProfile || session.permission_profile || "full_access"
                  ),
                  connectedAt:
                    typeof (session.connectedAt || session.connected_at) === "string"
                      ? String(session.connectedAt || session.connected_at)
                      : null,
                  updatedAt: String(session.updatedAt || session.updated_at || ""),
                }))
              : [];
            setActiveWorkspaceSessions(
              sessions.filter(
                (session): session is ActiveWorkspaceAccessSession =>
                  Boolean(session.sessionId)
              )
            );
          }
        } catch {
          // keep the previous active session list when polling fails
        }
      }
    };

    void loadWorkspaceAccessState();
    const intervalId = window.setInterval(() => {
      void loadWorkspaceAccessState();
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [canOpenSettings, user?.id]);

  const handleNotificationClick = () => {
    setIsNotificationsOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsNotificationsBadgeDismissed(true);
      }
      return next;
    });
  };

  const handleNotificationsClose = () => {
    setIsNotificationsBadgeDismissed(true);
    setIsNotificationsOpen(false);
  };

  const handleSidebarToggle = () => {
    setShowSidebarCollapseCue(false);
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
    if (clearCueTimeoutRef.current) {
      clearTimeout(clearCueTimeoutRef.current);
      clearCueTimeoutRef.current = null;
    }
    if (expandTimeoutRef.current) {
      clearTimeout(expandTimeoutRef.current);
      expandTimeoutRef.current = null;
    }
    if (isDesktop) {
      if (isChatAutoCollapsedDesktop) {
        setIsChatAutoCollapsedDesktop(false);
        return;
      }
      setIsSidebarCollapsedDesktop((prev) => !prev);
      return;
    }
    setIsSidebarOpen((prev) => !prev);
  };

  const handleNavigationClick = () => {
    if (sidebarHoverHintTimeoutRef.current) {
      clearTimeout(sidebarHoverHintTimeoutRef.current);
      sidebarHoverHintTimeoutRef.current = null;
    }
    setSidebarHoverHint(null);
    setIsSidebarOpen(false);
  };

  const hideSidebarHoverHint = () => {
    if (sidebarHoverHintTimeoutRef.current) {
      clearTimeout(sidebarHoverHintTimeoutRef.current);
      sidebarHoverHintTimeoutRef.current = null;
    }
    setSidebarHoverHint(null);
  };

  const handleSidebarItemMouseEnter = (target: HTMLAnchorElement, item: SidebarNavItem) => {
    if (typeof window === "undefined" || !item.description) return;

    hideSidebarHoverHint();

    sidebarHoverHintTimeoutRef.current = setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const tooltipWidth = 252;
      const maxLeft = window.innerWidth - tooltipWidth - 16;
      const left = Math.max(12, Math.min(rect.right + 14, maxLeft));
      const top = Math.max(54, Math.min(rect.top + rect.height / 2, window.innerHeight - 54));

      setSidebarHoverHint({
        name: item.name,
        description: item.description,
        top,
        left,
      });
      sidebarHoverHintTimeoutRef.current = null;
    }, SIDEBAR_DESCRIPTION_HOVER_DELAY_MS);
  };

  const unreadAlertsBadgeCount = unreadCount > 0 ? unreadCount : undefined;
  const runningJobsBadgeCount =
    (dashboard?.stats?.jobs_running ?? dashboard?.jobs?.runningJobs?.length ?? 0) > 0
      ? dashboard?.stats?.jobs_running ?? dashboard?.jobs?.runningJobs?.length ?? 0
      : undefined;
  const navigationGroups = useMemo<SidebarNavGroup[]>(
    () => {
      const primaryItems: SidebarNavItem[] = [
        ...(canOpenDashboard
          ? [
              {
                name: t("nav.dashboard"),
                href: "/dashboard",
                icon: LayoutDashboard,
                description: t("dashboard.pageSubtitle", { defaultValue: t("dashboard.subtitle") }),
                badgeCount: unreadAlertsBadgeCount,
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenAgents
          ? [
              {
                name: t("nav.aiAgents"),
                href: "/ai-agents",
                icon: Bot,
                description: t("aiAgents.subtitle"),
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenHub
          ? [
              {
                name: "Hub",
                href: "/hub",
                icon: Sparkles,
                description: "Reusable agents and task templates",
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenDrakonFind
          ? [
              {
                name: "Drakon Find",
                href: "/drakon-find",
                icon: Radar,
                description: t("drakonFind.operations.subtitle", {
                  defaultValue: "Status, clients, and hits per search.",
                }),
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenJobs
          ? [
              {
                name: t("nav.jobs"),
                href: "/jobs",
                icon: Briefcase,
                description: t("jobs.subtitle"),
                badgeCount: runningJobsBadgeCount,
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenChat
          ? [
              {
                name: t("nav.aiAssistant"),
                href: "/chat",
                icon: MessageSquare,
                description: t("quickChat.subtitle", { defaultValue: t("chat.subtitle") }),
              } satisfies SidebarNavItem,
            ]
          : []),
      ];
      const systemItems: SidebarNavItem[] = [
        ...(canOpenCameras
          ? [
              {
                name: t("nav.cameras"),
                href: "/cameras",
                icon: Camera,
                description: t("cameras.subtitle"),
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenEvents
          ? [
              {
                name: t("nav.logsEvents"),
                href: "/events",
                icon: FileText,
                description: t("events.subtitle"),
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenBilling
          ? [
              {
                name: t("nav.billing"),
                href: "/billing",
                icon: CreditCard,
                description: t("billing.subtitle"),
              } satisfies SidebarNavItem,
            ]
          : []),
        ...(canOpenSettings
          ? [
              {
                name: t("nav.settings"),
                href: "/settings",
                icon: Settings,
                description: t("settings.subtitle"),
              } satisfies SidebarNavItem,
            ]
          : []),
      ];

      return [
        { id: "primary", label: sidebarSectionLabels.primary, items: primaryItems },
        { id: "system", label: sidebarSectionLabels.system, items: systemItems },
      ].filter((group): group is SidebarNavGroup => group.items.length > 0);
    },
    [
      canOpenAgents,
      canOpenBilling,
      canOpenCameras,
      canOpenChat,
      canOpenDashboard,
      canOpenDrakonFind,
      canOpenEvents,
      canOpenHub,
      canOpenJobs,
      canOpenSettings,
      runningJobsBadgeCount,
      sidebarSectionLabels.primary,
      sidebarSectionLabels.system,
      t,
      unreadAlertsBadgeCount,
    ]
  );

  const isActive = (href: string) => {
    if (href === "/ai-agents" && location.pathname.startsWith("/algorithms/")) {
      return true;
    }
    return location.pathname.startsWith(href);
  };

  const breadcrumbs = useMemo<BreadcrumbItem[]>(() => {
    const items: BreadcrumbItem[] = [];
    const pathname = location.pathname;
    const searchParams = new URLSearchParams(location.search);

    const pushItem = (label: string, href?: string) => {
      if (!label) return;
      items.push({ label, href });
    };

    if (pathname.startsWith("/algorithms/")) {
      const cameraId = pathname.split("/")[2];
      pushItem(t("nav.aiAgents"), "/ai-agents");
      pushItem(t("algorithms.title"));
      if (cameraId && /^\d+$/.test(cameraId)) {
        pushItem(`Camera #${cameraId}`);
      }
    } else if (pathname.startsWith("/dashboard")) {
      pushItem(t("nav.dashboard"), "/dashboard");
    } else if (pathname.startsWith("/ai-agents")) {
      pushItem(t("nav.aiAgents"), "/ai-agents");
    } else if (pathname.startsWith("/hub")) {
      pushItem("Hub", "/hub");
      const hubType = searchParams.get("type");
      if (hubType === "task") {
        pushItem("Tasks");
      } else if (hubType === "agent") {
        pushItem("Agents");
      }
    } else if (drakonFindEnabled && pathname.startsWith("/drakon-find")) {
      pushItem("Drakon Find", "/drakon-find");
    } else if (pathname.startsWith("/cameras")) {
      pushItem(t("nav.cameras"), "/cameras");
    } else if (pathname.startsWith("/jobs")) {
      pushItem(t("nav.jobs"), "/jobs");
    } else if (pathname.startsWith("/chat")) {
      pushItem(t("nav.aiAssistant"), "/chat");
    } else if (pathname.startsWith("/events")) {
      pushItem(t("nav.logsEvents"), "/events");
    } else if (billingEnabled && pathname.startsWith("/billing")) {
      pushItem(t("nav.billing"), "/billing");
    } else if (pathname.startsWith("/settings")) {
      pushItem(t("nav.settings"), "/settings");
    }

    if (pathname.startsWith("/cameras")) {
      const editCameraId = searchParams.get("edit");
      if (editCameraId && /^\d+$/.test(editCameraId)) {
        pushItem(`Edit Camera #${editCameraId}`);
      }
    }

    if (pathname.startsWith("/jobs")) {
      const jobId = searchParams.get("job");
      if (jobId && /^\d+$/.test(jobId)) {
        pushItem(`Job #${jobId}`);
      }
    }

    if (pathname.startsWith("/chat")) {
      const sessionId = searchParams.get("session");
      if (sessionId && /^\d+$/.test(sessionId)) {
        pushItem(`Session #${sessionId}`);
      }
    }

    if (pathname.startsWith("/events")) {
      const eventType = searchParams.get("type");
      const eventId = searchParams.get("eventId");

      if (eventType === "detection") {
        pushItem("Detections");
      }

      if (eventId && /^\d+$/.test(eventId)) {
        pushItem(`Event #${eventId}`);
      }
    }

    if (items.length === 0) {
      pushItem(t("nav.dashboard"), "/dashboard");
    }

    const lastIndex = items.length - 1;
    if (lastIndex >= 0) {
      items[lastIndex] = { ...items[lastIndex], href: undefined };
    }

    return items;
  }, [billingEnabled, drakonFindEnabled, location.pathname, location.search, t]);

  const currentBreadcrumb = breadcrumbs[breadcrumbs.length - 1]?.label || "";
  const tutorialButtonLabel =
    onboardingStatus === "never_started"
      ? t("tutorial.entry.getStarted")
      : t("tutorial.entry.tutorial");
  const standaloneTutorialCamera = getStandaloneTutorialCamera(cameras);
  const standaloneAgentTutorialCameraId = standaloneTutorialCamera?.id ?? null;
  const tutorialMenuItems: Array<{
    kind: OnboardingTutorialKind;
    label: string;
    description: string;
  }> = [
    {
      kind: "intro",
      label: t("tutorial.entry.menu.intro.label"),
      description: t("tutorial.entry.menu.intro.description"),
    },
    {
      kind: "api-key",
      label: t("tutorial.entry.menu.apiKey.label"),
      description: t("tutorial.entry.menu.apiKey.description"),
    },
    {
      kind: "camera",
      label: t("tutorial.entry.menu.camera.label"),
      description: t("tutorial.entry.menu.camera.description"),
    },
    {
      kind: "agent",
      label: t("tutorial.entry.menu.agent.label"),
      description: standaloneAgentTutorialCameraId
        ? t("tutorial.entry.menu.agent.description")
        : t("tutorial.entry.menu.agent.noCameraDescription"),
    },
    {
      kind: "chat",
      label: t("tutorial.entry.menu.chat.label"),
      description: t("tutorial.entry.menu.chat.description"),
    },
  ];

  const handleTutorialMenuSelect = (kind: OnboardingTutorialKind) => {
    setIsTutorialMenuOpen(false);
    startTutorial(
      kind,
      kind === "agent" || kind === "chat"
        ? {
            cameraId: standaloneTutorialCamera?.id ?? null,
            cameraName: standaloneTutorialCamera?.name ?? null,
          }
        : undefined
    );
  };

  const activeWorkspaceRequest = pendingWorkspaceRequests[0] || null;
  const showRemoteAccessIndicator =
    !isRemoteWorkspace &&
    brand.features.workspaceAccessEnabled &&
    isDesktopShellWindow() &&
    activeWorkspaceSessions.length > 0;
  const primaryActiveWorkspaceSession = activeWorkspaceSessions[0] || null;
  const primaryActiveWorkspaceOperatorLabel =
    primaryActiveWorkspaceSession?.operatorDisplayLabel || "Outro usuario";
  const remoteAccessIndicatorSummaryLabel =
    activeWorkspaceSessions.length > 1
      ? `${primaryActiveWorkspaceOperatorLabel} +${activeWorkspaceSessions.length - 1}`
      : primaryActiveWorkspaceOperatorLabel;

  const handleWorkspaceRequestDecision = async (
    sessionId: string,
    action: "approve" | "deny"
  ) => {
    setWorkspaceRequestAction(`${action}:${sessionId}`);
    try {
      const response = await fetch(
        `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );
      if (!response.ok) {
        return;
      }
      setPendingWorkspaceRequests((current) =>
        current.filter((request) => request.sessionId !== sessionId)
      );
    } catch {
      // keep the request visible and let the next poll reconcile the state
    } finally {
      setWorkspaceRequestAction("");
    }
  };

  const handleEndActiveWorkspaceSession = async (sessionId: string) => {
    setActiveWorkspaceSessionAction(sessionId);
    try {
      const response = await fetch(
        `${LOCAL_WORKSPACE_ACCESS_API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/end`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            reason: "closed_by_owner",
          }),
        }
      );
      if (!response.ok) {
        return;
      }

      setActiveWorkspaceSessions((current) =>
        current.filter((session) => session.sessionId !== sessionId)
      );
    } catch {
      // keep the active session visible and let the next poll reconcile the state
    } finally {
      setActiveWorkspaceSessionAction("");
    }
  };

  return (
    <div className="fluent-shell h-screen flex overflow-hidden">
      {isRemoteWorkspace ? (
        <div className="pointer-events-none fixed inset-0 z-[120] border border-red-500/80 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.22)]" />
      ) : null}

      {/* Mobile backdrop overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/45 z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:relative z-50 md:z-auto ${mobileSidebarWidthClass} ${
          isSidebarCollapsed ? collapsedSidebarWidthClass : expandedSidebarWidthClass
        } fluent-sidebar border-r transition-[transform,width] duration-200 h-screen flex-shrink-0 overflow-hidden`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className={`absolute inset-y-12 right-0 w-px ${sidebarEdgeLineClass}`} />
              <div className={`absolute inset-y-16 ${sidebarEdgeGlowClass}`} />
            </div>

            {/* Logo */}
            <div
              className={`relative h-16 flex items-center border-b border-gray-800/60 flex-shrink-0 ${
                isSidebarCollapsed ? "justify-center px-2" : "px-6"
              }`}
            >
              {isSidebarCollapsed ? (
                <BrandLogo
                  variant="icon"
                  theme={theme}
                  iconClassName={collapsedBrandIconClassName}
                />
              ) : (
                <BrandLogo
                  variant="full"
                  theme={theme}
                  className="flex items-center gap-3"
                  imageClassName="h-10 -ml-2"
                  iconClassName="h-10 w-10 object-contain rounded-md"
                  textClassName="text-xl font-semibold tracking-wide text-gray-100"
                />
              )}
            </div>

            {/* Navigation */}
            <nav
              className={`sidebar-nav-scroll ${sidebarScrollToneClass} relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain ${
                isSidebarCollapsed ? "px-2 py-4" : "px-4 py-5 pr-2"
              }`}
              onScroll={hideSidebarHoverHint}
            >
              <div className={`${isSidebarCollapsed ? "space-y-2" : "space-y-5"}`}>
                {navigationGroups.map((group, groupIndex) => (
                  <section key={group.id} className="space-y-2.5">
                    {!isSidebarCollapsed ? (
                      <div className="px-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gray-600">
                          {group.label}
                        </p>
                      </div>
                    ) : null}
                    <div className={`${isSidebarCollapsed ? "space-y-2" : "space-y-2.5"}`}>
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);
                        const badgeLabel = formatSidebarBadgeCount(item.badgeCount);

                        return (
                          <Link
                            key={item.href}
                            to={item.href}
                            onClick={handleNavigationClick}
                            aria-label={item.name}
                            onMouseEnter={(event) => handleSidebarItemMouseEnter(event.currentTarget, item)}
                            onMouseLeave={hideSidebarHoverHint}
                          className={`group relative flex items-center overflow-hidden rounded-lg border transition-colors duration-150 ${
                              isSidebarCollapsed ? "justify-center px-2 py-3" : "gap-3 px-3 py-3.5"
                            } ${
                              active ? sidebarActiveCardClass : sidebarIdleCardClass
                            }`}
                          >
                            {!isSidebarCollapsed ? (
                              <span
                                className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
                                  active ? sidebarActiveOverlayClass : sidebarHoverOverlayClass
                                }`}
                              />
                            ) : null}
                            <span
                              className={`pointer-events-none absolute inset-y-3 left-0 rounded-r-full transition-all duration-300 ${
                                active ? sidebarActiveRailClass : sidebarIdleRailClass
                              }`}
                            />
                            <div
                              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border transition-all duration-300 ${
                                active ? sidebarActiveIconClass : sidebarIdleIconClass
                              }`}
                            >
                              <Icon className="h-5 w-5" />
                              <span
                                className={`pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300 ${
                                  active
                                    ? sidebarActiveIconOverlayClass
                                    : sidebarHoverIconOverlayClass
                                }`}
                              />
                            </div>
                            {!isSidebarCollapsed ? (
                              <>
                                <div className="relative min-w-0 flex-1">
                                  <div
                                    className={`truncate text-[15px] font-semibold ${
                                      active ? "text-gray-100" : "text-gray-300 group-hover:text-gray-100"
                                    }`}
                                  >
                                    {item.name}
                                  </div>
                                  <div
                                    className={`mt-1 line-clamp-1 text-[11px] leading-4 ${
                                      active
                                        ? sidebarActiveDescriptionClass
                                        : "text-gray-500 group-hover:text-gray-400"
                                    }`}
                                  >
                                    {item.description}
                                  </div>
                                </div>
                                {badgeLabel ? (
                                  <span
                                    className={`relative ml-2 inline-flex min-w-7 shrink-0 items-center justify-center rounded-full border px-2 py-1 text-[10px] font-semibold text-white ${sidebarBadgeToneClass}`}
                                  >
                                    {badgeLabel}
                                  </span>
                                ) : (
                                  <span
                                    className={`relative h-2 w-2 rounded-full transition-all duration-300 ${
                                      active
                                        ? sidebarActiveDotClass
                                        : "bg-gray-700 group-hover:bg-gray-500"
                                    }`}
                                  />
                                )}
                              </>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                    {!isSidebarCollapsed && groupIndex < navigationGroups.length - 1 ? (
                      <div className="px-2 pt-1">
                        <div className="h-px bg-gray-800/80" />
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </nav>
          </div>

          {/* User section */}
          <div
            className={`fluent-sidebar-footer border-t flex-shrink-0 md:mt-auto ${
              isSidebarCollapsed ? "p-2" : "p-4"
            }`}
          >
            {isSidebarCollapsed ? (
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                title={theme === "dark" ? t("settings.light") : t("settings.dark")}
                className="mb-2 w-full flex items-center justify-center rounded-lg border border-gray-700 bg-gray-800/70 p-2 text-gray-300 hover:bg-gray-700/80 transition-colors"
              >
                {theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
            ) : (
              <div className="mb-4">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-gray-500">
                  {t("settings.appearance")}
                </p>
                <div className="fluent-segmented grid grid-cols-2 gap-1 rounded-lg border p-1">
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                      theme === "dark"
                        ? "fluent-segmented-active"
                        : "text-gray-300 hover:bg-gray-700/70"
                    }`}
                  >
                    <Moon className="w-4 h-4" />
                    <span>{t("settings.dark")}</span>
                  </button>
                  <button
                    onClick={() => setTheme("light")}
                    className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                      theme === "light"
                        ? "fluent-segmented-active"
                        : "text-gray-300 hover:bg-gray-700/70"
                    }`}
                  >
                    <Sun className="w-4 h-4" />
                    <span>{t("settings.light")}</span>
                  </button>
                </div>
              </div>
            )}
            <div className={`flex items-center ${isSidebarCollapsed ? "justify-center mb-2" : "mb-3"}`}>
              <div
                className={`fluent-avatar rounded-full flex items-center justify-center text-white font-semibold ${
                  isSidebarCollapsed ? "w-9 h-9 text-sm" : "w-10 h-10"
                }`}
                title={
                  isSidebarCollapsed
                    ? sidebarProfilePrimaryLabel || sidebarProfileSecondaryLabel || undefined
                    : undefined
                }
              >
                {sidebarProfileAvatarSeed.charAt(0).toUpperCase() || "U"}
              </div>
              {!isSidebarCollapsed && (
                <div className="ml-3 flex-1 min-w-0">
                  {isRemoteWorkspace ? (
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300/80">
                      Remote workspace owner
                    </p>
                  ) : null}
                  <p className="text-sm font-medium text-gray-200 truncate">
                    {sidebarProfilePrimaryLabel || "Unknown user"}
                  </p>
                  {sidebarProfileSecondaryLabel ? (
                    <p className="text-xs text-gray-500 truncate">
                      {sidebarProfileSecondaryLabel}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <button
              onClick={() => {
                if (isRemoteWorkspace) {
                  void endRemoteWorkspaceSession();
                  return;
                }
                void logout();
              }}
              title={
                isSidebarCollapsed ? (isRemoteWorkspace ? "End session" : t("nav.logout")) : undefined
              }
              className={`w-full flex items-center justify-center px-4 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors ${
                isSidebarCollapsed ? "px-2" : ""
              }`}
            >
              <LogOut className={`w-4 h-4 ${isSidebarCollapsed ? "" : "mr-2"}`} />
              {!isSidebarCollapsed && (isRemoteWorkspace ? "End session" : t("nav.logout"))}
            </button>
          </div>
        </div>
      </aside>

      {sidebarHoverHint ? (
        <div
          className={`pointer-events-none fixed z-[70] hidden w-[252px] -translate-y-1/2 rounded-lg border px-3.5 py-3 md:block ${sidebarTooltipToneClass}`}
          style={{ top: sidebarHoverHint.top, left: sidebarHoverHint.left }}
        >
          <div className={`text-[10px] font-semibold uppercase tracking-[0.22em] ${sidebarTooltipTitleClass}`}>
            {sidebarHoverHint.name}
          </div>
          <p className={`mt-2 text-sm leading-5 ${sidebarTooltipBodyClass}`}>
            {sidebarHoverHint.description}
          </p>
        </div>
      ) : null}

      {/* Main content */}
      <div className="flex-1 min-h-0 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="fluent-commandbar relative h-16 border-b flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
          {isRemoteWorkspace ? (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-[5] flex max-w-[min(34rem,52vw)] min-w-0 -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full border border-red-400/35 bg-[linear-gradient(135deg,rgba(127,29,29,0.92),rgba(69,10,10,0.86))] px-4 py-2 shadow-[0_18px_40px_-24px_rgba(239,68,68,0.72)] backdrop-blur-md">
              <span className="inline-flex h-2.5 w-2.5 flex-shrink-0 rounded-full bg-red-300 shadow-[0_0_16px_rgba(252,165,165,0.95)]" />
              <div className="min-w-0 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-red-100/75">
                  Workspace remoto
                </p>
                <p className="truncate text-sm font-semibold text-white">
                  {remoteWindowOwnerLabel}
                </p>
                {remoteWindowOwnerMetaLabel ? (
                  <p className="truncate text-[11px] text-red-100/70">
                    {remoteWindowOwnerMetaLabel}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <button
            onClick={handleSidebarToggle}
            title={
              isDesktop
                ? isSidebarCollapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
                : isSidebarOpen
                ? "Close menu"
                : "Open menu"
            }
            className={`relative p-2 rounded-lg transition-all ${
              showSidebarCollapseCue
                ? "bg-gray-800 text-gray-100 ring-2 ring-blue-400/35 scale-[1.02]"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
          >
            {isDesktop ? (
              isSidebarCollapsed ? (
                <ChevronsRight className="w-5 h-5" />
              ) : (
                <ChevronsLeft className="w-5 h-5" />
              )
            ) : isSidebarOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
            {showSidebarCollapseCue && isDesktop && !isSidebarCollapsed ? (
              <span className="fluent-flyout pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg border px-3 py-1 text-[11px] font-medium tracking-[0.02em]">
                Collapsing sidebar
              </span>
            ) : null}
          </button>

          <nav aria-label="Breadcrumb" className="flex-1 min-w-0 px-3 md:px-5">
            <div className="md:hidden min-w-0">
              <span className="block truncate text-sm font-medium text-gray-200">
                {currentBreadcrumb}
              </span>
            </div>

            <ol className="hidden md:flex items-center gap-1.5 text-sm text-gray-400 overflow-hidden whitespace-nowrap">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;

                return (
                  <li key={`${crumb.label}-${index}`} className="flex items-center min-w-0">
                    {index > 0 && (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-600 mx-1 flex-shrink-0" />
                    )}
                    {crumb.href && !isLast ? (
                      <Link
                        to={crumb.href}
                        className="hover:text-gray-200 transition-colors truncate max-w-[220px]"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className={`truncate max-w-[260px] ${isLast ? "text-gray-200" : ""}`}>
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Monthly Token Usage */}
            {tokenUsageMonth && (
              <div className="fluent-chip hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-lg border">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                  <span className="text-xs text-gray-400">In:</span>
                  <span className="text-sm font-semibold text-gray-200">
                    {(tokenUsageMonth.input_tokens / 1_000_000).toFixed(1)}M
                  </span>
                </div>
                <div className="w-px h-4 bg-gray-700"></div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                  <span className="text-xs text-gray-400">Out:</span>
                  <span className="text-sm font-semibold text-gray-200">
                    {(tokenUsageMonth.output_tokens / 1_000_000).toFixed(1)}M
                  </span>
                </div>
              </div>
            )}

            {showRemoteAccessIndicator ? (
              <div ref={remoteAccessIndicatorRef} className="relative">
                <button
                  type="button"
                  onClick={() => setIsRemoteAccessIndicatorOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-50 transition-colors hover:border-rose-400/45 hover:bg-rose-500/15 hover:text-white"
                  aria-haspopup="dialog"
                  aria-expanded={isRemoteAccessIndicatorOpen}
                  aria-label={`Conta em acesso remoto por ${primaryActiveWorkspaceOperatorLabel}`}
                >
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-300 opacity-70" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-200" />
                  </span>
                  <span className="hidden xl:inline">Acesso remoto</span>
                  <span className="max-w-[9rem] truncate text-sm font-semibold">
                    {remoteAccessIndicatorSummaryLabel}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-rose-200 transition-transform ${
                      isRemoteAccessIndicatorOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isRemoteAccessIndicatorOpen ? (
                  <div
                    role="dialog"
                    aria-label="Sessoes remotas ativas"
                    className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-rose-400/20 bg-[rgba(20,12,14,0.98)] p-2 shadow-2xl shadow-black/60 backdrop-blur-md"
                  >
                    <div className="px-3 pb-2 pt-1">
                      <p className="text-sm font-semibold text-gray-100">
                        Sua conta esta sendo acessada remotamente
                      </p>
                      <p className="mt-1 text-xs leading-5 text-gray-400">
                        {activeWorkspaceSessions.length > 1
                          ? `${activeWorkspaceSessions.length} sessoes ativas agora.`
                          : "1 sessao ativa agora."}
                      </p>
                    </div>

                    <div className="space-y-2">
                      {activeWorkspaceSessions.map((session) => {
                        const startedAtLabel = formatWorkspaceAccessStartedAt(
                          session.connectedAt || session.updatedAt
                        );
                        const isEndingSession =
                          activeWorkspaceSessionAction === session.sessionId;

                        return (
                          <div
                            key={session.sessionId}
                            className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3"
                          >
                            <div className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-rose-400/20 bg-rose-500/10 text-rose-100">
                              <MonitorSmartphone className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-gray-100">
                                {session.operatorDisplayLabel || "Outro usuario"}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-gray-400">
                                {describeWorkspacePermissionProfile(session.permissionProfile, t)}
                                {startedAtLabel ? ` • Desde ${startedAtLabel}` : ""}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleEndActiveWorkspaceSession(session.sessionId)}
                              disabled={isEndingSession}
                              className="inline-flex min-h-[34px] items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs font-semibold text-gray-100 transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isEndingSession ? "Encerrando..." : "Encerrar"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {canOpenDashboard ? (
              <button
                type="button"
                onClick={() => setIsSystemActivityOpen(true)}
                className="fluent-toolbar-button inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
                aria-label="Open system activity"
              >
                <Activity className="h-4 w-4 text-blue-400" />
                <span className="hidden sm:inline">System Activity</span>
              </button>
            ) : null}

            <div ref={tutorialMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsTutorialMenuOpen((open) => !open)}
                className="fluent-toolbar-button inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
                aria-haspopup="menu"
                aria-expanded={isTutorialMenuOpen}
                aria-label={t("tutorial.entry.openAria")}
              >
                <Sparkles className="h-4 w-4 text-blue-400" />
                <span className="hidden sm:inline">{tutorialButtonLabel}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 text-blue-200 transition-transform ${
                    isTutorialMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {isTutorialMenuOpen ? (
                <div
                  role="menu"
                  className="fluent-flyout absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border p-1.5"
                >
                  {tutorialMenuItems.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      role="menuitem"
                      onClick={() => handleTutorialMenuSelect(item.kind)}
                      className="group flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition-colors hover:bg-gray-800/70"
                    >
                      <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-gray-700 bg-gray-800/70 text-blue-400 transition-colors">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-100">
                          {item.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-gray-400">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <LanguageSelector />
            
            {canOpenEvents ? (
              <div ref={notificationsContainerRef} className="relative">
                <button
                  onClick={handleNotificationClick}
                  className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors relative"
                >
                  <Bell className="w-5 h-5" />
                  {hasUnreadNotifications && (
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                  )}
                </button>

                <NotificationsDropdown
                  isOpen={isNotificationsOpen}
                  onClose={handleNotificationsClose}
                  anchorRef={notificationsContainerRef}
                />
              </div>
            ) : null}
          </div>
        </header>

        {isRemoteWorkspace ? (
          <div
            className={`border-b px-4 py-3 md:px-6 ${
              remoteWorkspaceSession?.owner_online === false || remoteWorkspaceError
                ? "border-red-500/20 bg-red-500/10"
                : "border-cyan-500/20 bg-cyan-500/10"
            }`}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-cyan-100">
                  <MonitorSmartphone className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-100">
                    Workspace remoto de{" "}
                    {ownerDisplayLabel ||
                      remoteWorkspaceSession?.owner_handle ||
                      remoteWorkspaceSession?.owner_email ||
                      "outro usuario"}
                  </p>
                  <p className="mt-1 text-sm text-gray-300">
                    Voce esta operando como{" "}
                    {operatorDisplayLabel ||
                      remoteWorkspaceSession?.operator_handle ||
                      remoteWorkspaceSession?.operator_email ||
                      "sua conta"}
                    . Status:{" "}
                    {remoteWorkspaceError
                      ? remoteWorkspaceError
                      : remoteWorkspaceSession?.owner_online === false
                      ? "owner offline"
                      : remoteWorkspaceSession?.status || "conectado"}
                    .
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void endRemoteWorkspaceSession()}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] px-4 text-sm font-semibold text-gray-100 transition-colors hover:bg-white/[0.09]"
              >
                Encerrar sessao
              </button>
            </div>
          </div>
        ) : null}

        {/* Page content */}
        <main className="fluent-content fluent-internal-content min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-7">{children}</main>
      </div>

      {activeWorkspaceRequest ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-cyan-500/20 bg-slate-950/96 p-6 shadow-2xl shadow-cyan-950/40">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-100">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-100">
                  Solicitação de acesso remoto
                </h3>
                <p className="mt-1 text-sm text-gray-300">
                  {activeWorkspaceRequest.operatorDisplayLabel || "Outro usuario"} quer abrir seu
                  workspace enquanto este app estiver aberto.
                </p>
                <p className="mt-2 text-xs uppercase tracking-[0.18em] text-cyan-200/80">
                  {describeWorkspacePermissionProfile(activeWorkspaceRequest.permissionProfile, t)}
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() =>
                  void handleWorkspaceRequestDecision(activeWorkspaceRequest.sessionId, "approve")
                }
                disabled={workspaceRequestAction.length > 0}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-400 disabled:opacity-60"
              >
                Permitir agora
              </button>
              <button
                type="button"
                onClick={() =>
                  void handleWorkspaceRequestDecision(activeWorkspaceRequest.sessionId, "deny")
                }
                disabled={workspaceRequestAction.length > 0}
                className="inline-flex min-h-[44px] items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-sm font-semibold text-gray-100 transition-colors hover:bg-white/[0.09] disabled:opacity-60"
              >
                Negar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Floating chat button and overlay */}
      {canOpenChat ? (
        <>
          <FloatingChatButton />
          <QuickChatOverlay />
          <MinimizedChatTabs />
        </>
      ) : null}
      {canOpenDashboard ? (
        <SystemActivityModal
          isOpen={isSystemActivityOpen}
          onClose={() => setIsSystemActivityOpen(false)}
          cameras={cameras}
          dashboard={dashboard}
        />
      ) : null}
      <TutorialOverlay />

      {showOpenAiKeyPrompt && canOpenSettings && !isSettingsRoute && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md pointer-events-none">
          <div className="fluent-flyout rounded-lg border p-4 pointer-events-auto">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-500/15 rounded-lg flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-100 mb-1">
                  OpenAI API Key Required
                </h4>
                <p className="text-sm text-gray-300 mb-3">
                  Configure your OpenAI API key in Settings, or paste it directly in chat, to enable AI agents, jobs, and chat inference.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowOpenAiKeyPrompt(false)}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowOpenAiKeyPrompt(false);
                      navigate("/settings?focus=openai");
                    }}
                    className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                  >
                    Add Key
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showZAiKeyPrompt && canOpenSettings && !isSettingsRoute && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md pointer-events-none">
          <div className="fluent-flyout rounded-lg border p-4 pointer-events-auto">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-500/15 rounded-lg flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-100 mb-1">
                  Z.ai API Key Required
                </h4>
                <p className="text-sm text-gray-300 mb-3">
                  Configure your Z.ai API key in Settings, or paste it directly in chat, to enable Core model inference.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowZAiKeyPrompt(false)}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowZAiKeyPrompt(false);
                      navigate("/settings?focus=zai");
                    }}
                    className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors"
                  >
                    Add Key
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

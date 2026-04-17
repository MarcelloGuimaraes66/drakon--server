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
import ChatPlexusBackground from "@/react-app/components/ChatPlexusBackground";
import SystemActivityModal from "@/react-app/components/SystemActivityModal";
import TutorialOverlay from "@/react-app/components/TutorialOverlay";
import { useDashboardSummary } from "@/react-app/hooks/useDashboardSummary";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { useTheme } from "@/react-app/hooks/useTheme";
import type { OnboardingTutorialKind } from "@/react-app/lib/onboarding";
import { brand, getBrandStorageKey, getBrandWindowEventName } from "@/shared/brand";
import {
  Activity,
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

function getStandaloneAgentTutorialCameraId(
  cameras: Array<{ id?: unknown; name?: unknown }>
): number | null {
  const availableCameras = cameras
    .map((camera) => ({
      id: typeof camera.id === "number" && Number.isInteger(camera.id) && camera.id > 0
        ? camera.id
        : null,
      name: typeof camera.name === "string" ? camera.name.trim().toLowerCase() : "",
    }))
    .filter((camera): camera is { id: number; name: string } => camera.id !== null);

  return (
    availableCameras.find((camera) => camera.name.includes("tutorial"))?.id ??
    availableCameras[0]?.id ??
    null
  );
}

type ApiKeyPromptStatus = {
  hasOpenAiKey: boolean | null;
  hasZAiKey: boolean | null;
  hasAnyApiKey: boolean | null;
  hasConfirmedNoApiKeys: boolean;
};

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
  const previousPathnameRef = useRef("");
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sidebarHoverHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUnreadCountRef = useRef(0);
  const notificationsContainerRef = useRef<HTMLDivElement>(null);
  const tutorialMenuRef = useRef<HTMLDivElement>(null);
  const isSettingsRoute = /(^|\/)settings(\/|$)/.test(location.pathname);
  const isSidebarCollapsed = isDesktop && (isSidebarCollapsedDesktop || isChatAutoCollapsedDesktop);
  const currentBrandId = brand.id.toLowerCase();
  const isPerceptrumBrand = currentBrandId === "perceptrum";
  const isDrakonBrand = currentBrandId === "drakon";
  const billingEnabled = brand.features.billingEnabled;
  const drakonFindEnabled = brand.features.drakonFindEnabled;
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
    ? "bg-gradient-to-b from-transparent via-white/12 to-transparent"
    : "bg-gradient-to-b from-transparent via-blue-400/45 to-transparent";
  const sidebarEdgeGlowClass = isDrakonBrand
    ? "-right-4 w-8 bg-black/70 blur-[38px]"
    : "-right-3 w-6 bg-blue-500/15 blur-2xl";
  const sidebarActiveCardClass = isDrakonBrand
    ? "border-white/8 bg-[#111112] shadow-[0_24px_40px_-36px_rgba(0,0,0,0.98)]"
    : "border-blue-400/20 bg-gray-800/90 shadow-[0_20px_40px_-30px_rgba(74,149,255,0.9)]";
  const sidebarIdleCardClass = isDrakonBrand
    ? "border-transparent bg-gray-900/15 hover:border-white/8 hover:bg-[#171718]"
    : "border-transparent bg-gray-900/20 hover:border-white/10 hover:bg-gray-800/70";
  const sidebarActiveOverlayClass = isDrakonBrand
    ? "opacity-100 bg-[radial-gradient(circle_at_left_center,rgba(255,255,255,0.05),transparent_56%),linear-gradient(135deg,rgba(255,255,255,0.025),transparent_72%)]"
    : "opacity-100 bg-[radial-gradient(circle_at_left_center,rgba(100,121,160,0.36),transparent_56%),linear-gradient(135deg,rgba(74,149,255,0.12),transparent_72%)]";
  const sidebarHoverOverlayClass = isDrakonBrand
    ? "opacity-0 group-hover:opacity-100 bg-[radial-gradient(circle_at_left_center,rgba(255,255,255,0.04),transparent_60%)]"
    : "opacity-0 group-hover:opacity-100 bg-[radial-gradient(circle_at_left_center,rgba(74,149,255,0.12),transparent_60%)]";
  const sidebarActiveRailClass = isDrakonBrand
    ? "w-[3px] bg-gradient-to-b from-white/75 via-white/45 to-white/20 opacity-100 shadow-[0_0_16px_rgba(255,255,255,0.14)]"
    : "w-[3px] bg-gradient-to-b from-blue-200 via-blue-400 to-purple-300 opacity-100 shadow-[0_0_20px_rgba(74,149,255,0.7)]";
  const sidebarIdleRailClass = "w-px bg-white/10 opacity-0 group-hover:opacity-100";
  const sidebarActiveIconClass = isDrakonBrand
    ? "border-white/8 bg-[#18181a] text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    : "border-white/10 bg-white/10 text-gray-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]";
  const sidebarIdleIconClass = isDrakonBrand
    ? "border-white/8 bg-[#141416] text-gray-400 group-hover:border-white/12 group-hover:bg-[#1b1b1d] group-hover:text-gray-200"
    : "border-white/10 bg-gray-800/60 text-gray-400 group-hover:border-white/15 group-hover:bg-gray-800/80 group-hover:text-gray-200";
  const sidebarActiveIconOverlayClass = isDrakonBrand
    ? "opacity-100 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_62%)]"
    : "opacity-100 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_58%)]";
  const sidebarHoverIconOverlayClass = isDrakonBrand
    ? "opacity-0 group-hover:opacity-100 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_62%)]"
    : "opacity-0 group-hover:opacity-100 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_58%)]";
  const sidebarActiveDescriptionClass = isDrakonBrand ? "text-gray-500" : "text-blue-100/70";
  const sidebarActiveDotClass = isDrakonBrand
    ? "bg-white/45 shadow-[0_0_12px_rgba(255,255,255,0.12)]"
    : "bg-blue-300/70 shadow-[0_0_14px_rgba(147,197,253,0.65)]";
  const sidebarBadgeToneClass = isDrakonBrand
    ? "border-blue-400/25 bg-blue-500/90 shadow-[0_12px_20px_-12px_rgba(59,130,246,0.85)]"
    : "border-blue-300/30 bg-blue-500 shadow-[0_12px_20px_-12px_rgba(59,130,246,0.95)]";
  const sidebarTooltipToneClass = isDrakonBrand
    ? "border-white/10 bg-[#111112]/96 text-gray-200 shadow-[0_18px_34px_-20px_rgba(0,0,0,0.95)]"
    : "border-blue-400/18 bg-[#16192a]/96 text-blue-50 shadow-[0_18px_34px_-20px_rgba(52,97,255,0.5)]";
  const sidebarTooltipTitleClass = isDrakonBrand ? "text-gray-500" : "text-blue-200/70";
  const sidebarTooltipBodyClass = isDrakonBrand ? "text-gray-200" : "text-blue-50/95";
  const sidebarSectionLabels = useMemo(
    () => getSidebarSectionLabels((i18n.resolvedLanguage || i18n.language || "en").toLowerCase()),
    [i18n.language, i18n.resolvedLanguage]
  );
  
  // Use unified dashboard summary hook
  const { cameras, dashboard, unreadCount, tokenUsageMonth } = useDashboardSummary();
  const hasUnreadNotifications = unreadCount > 0 && !isNotificationsBadgeDismissed;

  // Auto-close drawer on route change
  useEffect(() => {
    setIsSidebarOpen(false);
    setSidebarHoverHint(null);
    setIsTutorialMenuOpen(false);
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
    if (isSettingsRoute) {
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
  }, [isSettingsRoute, user?.id]);

  useEffect(() => {
    let cancelled = false;

    const syncPromptForMissingProvider = async (provider: "openai" | "zai") => {
      if (isSettingsRoute) {
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
      if (isSettingsRoute) {
        setShowOpenAiKeyPrompt(false);
        setShowZAiKeyPrompt(false);
        return;
      }
      void syncPromptForMissingProvider("openai");
    };
    const onZAiKeyRequired = () => {
      if (isSettingsRoute) {
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
  }, [isSettingsRoute]);

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
        {
          name: t("nav.dashboard"),
          href: "/dashboard",
          icon: LayoutDashboard,
          description: t("dashboard.pageSubtitle", { defaultValue: t("dashboard.subtitle") }),
          badgeCount: unreadAlertsBadgeCount,
        },
        {
          name: t("nav.aiAgents"),
          href: "/ai-agents",
          icon: Bot,
          description: t("aiAgents.subtitle"),
        },
        {
          name: "Hub",
          href: "/hub",
          icon: Sparkles,
          description: "Reusable agents and task templates",
        },
        ...(drakonFindEnabled
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
        {
          name: t("nav.jobs"),
          href: "/jobs",
          icon: Briefcase,
          description: t("jobs.subtitle"),
          badgeCount: runningJobsBadgeCount,
        },
        {
          name: t("nav.aiAssistant"),
          href: "/chat",
          icon: MessageSquare,
          description: t("quickChat.subtitle", { defaultValue: t("chat.subtitle") }),
        },
      ];
      const systemItems: SidebarNavItem[] = [
        {
          name: t("nav.cameras"),
          href: "/cameras",
          icon: Camera,
          description: t("cameras.subtitle"),
        },
        {
          name: t("nav.logsEvents"),
          href: "/events",
          icon: FileText,
          description: t("events.subtitle"),
        },
        ...(billingEnabled
          ? [
              {
                name: t("nav.billing"),
                href: "/billing",
                icon: CreditCard,
                description: t("billing.subtitle"),
              } satisfies SidebarNavItem,
            ]
          : []),
        {
          name: t("nav.settings"),
          href: "/settings",
          icon: Settings,
          description: t("settings.subtitle"),
        },
      ];

      return [
        { id: "primary", label: sidebarSectionLabels.primary, items: primaryItems },
        { id: "system", label: sidebarSectionLabels.system, items: systemItems },
      ];
    },
    [
      billingEnabled,
      drakonFindEnabled,
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
  const standaloneAgentTutorialCameraId = getStandaloneAgentTutorialCameraId(cameras);
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
  ];

  const handleTutorialMenuSelect = (kind: OnboardingTutorialKind) => {
    setIsTutorialMenuOpen(false);
    startTutorial(
      kind,
      kind === "agent" ? { cameraId: standaloneAgentTutorialCameraId } : undefined
    );
  };

  return (
    <div className="h-screen bg-gray-950 flex overflow-hidden">
      {/* Mobile backdrop overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 fixed md:relative z-50 md:z-auto ${mobileSidebarWidthClass} ${
          isSidebarCollapsed ? collapsedSidebarWidthClass : expandedSidebarWidthClass
        } bg-gray-900 border-r border-gray-800 transition-[transform,width] duration-300 h-screen flex-shrink-0 overflow-hidden`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {!isSidebarCollapsed ? (
                <ChatPlexusBackground
                  motion="rise"
                  className="opacity-[0.7] [mask-image:linear-gradient(180deg,transparent_0%,black_9%,black_92%,transparent_100%)]"
                />
              ) : null}
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
                            className={`group relative flex items-center overflow-hidden rounded-[18px] border transition-all duration-300 ${
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
                                      active ? "text-white" : "text-gray-200 group-hover:text-white"
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
                        <div className="h-px bg-gradient-to-r from-white/0 via-white/10 to-white/0" />
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </nav>
          </div>

          {/* User section */}
          <div
            className={`border-t border-gray-800 flex-shrink-0 md:mt-auto ${
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
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-gray-700/70 bg-gray-800/70 p-1">
                  <button
                    onClick={() => setTheme("dark")}
                    className={`flex items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors ${
                      theme === "dark"
                        ? "bg-blue-500/20 text-white"
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
                        ? "bg-blue-500/20 text-white"
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
                className={`rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-semibold ${
                  isSidebarCollapsed ? "w-9 h-9 text-sm" : "w-10 h-10"
                }`}
                title={isSidebarCollapsed ? (user?.google_user_data?.name || user?.email) : undefined}
              >
                {user?.email?.charAt(0).toUpperCase() || "U"}
              </div>
              {!isSidebarCollapsed && (
                <div className="ml-3 flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">
                    {user?.google_user_data?.name || user?.email}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{user?.email}</p>
                </div>
              )}
            </div>
            <button
              onClick={logout}
              title={isSidebarCollapsed ? t("nav.logout") : undefined}
              className={`w-full flex items-center justify-center px-4 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors ${
                isSidebarCollapsed ? "px-2" : ""
              }`}
            >
              <LogOut className={`w-4 h-4 ${isSidebarCollapsed ? "" : "mr-2"}`} />
              {!isSidebarCollapsed && t("nav.logout")}
            </button>
          </div>
        </div>
      </aside>

      {sidebarHoverHint ? (
        <div
          className={`pointer-events-none fixed z-[70] hidden w-[252px] -translate-y-1/2 rounded-2xl border px-3.5 py-3 backdrop-blur-xl md:block ${sidebarTooltipToneClass}`}
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
        <header className="h-16 bg-gray-900/50 backdrop-blur-xl border-b border-gray-800/50 flex items-center justify-between px-4 md:px-6 sticky top-0 z-10">
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
                ? "bg-gray-800 text-gray-100 shadow-[0_0_0_1px_rgba(96,165,250,0.28),0_0_24px_-10px_rgba(96,165,250,0.9)] ring-2 ring-blue-400/35 scale-[1.03]"
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
              <span className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-full border border-blue-400/20 bg-[#1d2230]/95 px-3 py-1 text-[11px] font-medium tracking-[0.02em] text-blue-100 shadow-[0_18px_40px_-20px_rgba(59,130,246,0.8)]">
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
              <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700/50">
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

            <button
              type="button"
              onClick={() => setIsSystemActivityOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/50 px-3 py-1.5 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-800 hover:text-white"
              aria-label="Open system activity"
            >
              <Activity className="h-4 w-4 text-cyan-300" />
              <span className="hidden sm:inline">System Activity</span>
            </button>

            <div ref={tutorialMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setIsTutorialMenuOpen((open) => !open)}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-sm font-medium text-blue-100 transition-colors hover:border-blue-400/45 hover:bg-blue-500/15 hover:text-white"
                aria-haspopup="menu"
                aria-expanded={isTutorialMenuOpen}
                aria-label={t("tutorial.entry.openAria")}
              >
                <Sparkles className="h-4 w-4 text-blue-200" />
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
                  className="absolute right-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-blue-400/20 bg-slate-950/96 p-1.5 shadow-2xl shadow-blue-950/50 backdrop-blur-xl"
                >
                  {tutorialMenuItems.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      role="menuitem"
                      onClick={() => handleTutorialMenuSelect(item.kind)}
                      className="group flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-blue-500/10"
                    >
                      <span className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-blue-100 transition-colors group-hover:border-blue-300/35 group-hover:bg-blue-500/15">
                        <Sparkles className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-100">
                          {item.label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-400">
                          {item.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <LanguageSelector />
            
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
          </div>
        </header>

        {/* Page content */}
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8">{children}</main>
      </div>

      {/* Floating chat button and overlay */}
      <FloatingChatButton />
      <QuickChatOverlay />
      <MinimizedChatTabs />
      <SystemActivityModal
        isOpen={isSystemActivityOpen}
        onClose={() => setIsSystemActivityOpen(false)}
        cameras={cameras}
        dashboard={dashboard}
      />
      <TutorialOverlay />

      {showOpenAiKeyPrompt && !isSettingsRoute && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md pointer-events-none">
          <div className="bg-gradient-to-br from-slate-900/95 to-slate-950/95 backdrop-blur-xl border border-blue-600/45 rounded-xl shadow-2xl shadow-blue-500/20 p-4 pointer-events-auto">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-5 h-5 text-blue-300" />
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
      {showZAiKeyPrompt && !isSettingsRoute && (
        <div className="fixed bottom-4 right-4 z-40 max-w-md pointer-events-none">
          <div className="bg-gradient-to-br from-slate-900/95 to-slate-950/95 backdrop-blur-xl border border-cyan-600/45 rounded-xl shadow-2xl shadow-cyan-500/20 p-4 pointer-events-auto">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <KeyRound className="w-5 h-5 text-cyan-300" />
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



import { ReactNode, useState, useEffect, useMemo, useRef } from "react";
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
import { useDashboardSummary } from "@/react-app/hooks/useDashboardSummary";
import { useTheme } from "@/react-app/hooks/useTheme";
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
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  Moon,
  Sun,
  Radar,
} from "lucide-react";

interface LayoutProps {
  children: ReactNode;
}

type BreadcrumbItem = {
  label: string;
  href?: string;
};

const CHAT_AUTO_COLLAPSE_DELAY_MS = 260;
const CHAT_AUTO_EXPAND_DELAY_MS = 1000;

export default function Layout({ children }: LayoutProps) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
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
  const previousPathnameRef = useRef("");
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousUnreadCountRef = useRef(0);
  const isSettingsRoute = /(^|\/)settings(\/|$)/.test(location.pathname);
  const isSidebarCollapsed = isDesktop && (isSidebarCollapsedDesktop || isChatAutoCollapsedDesktop);
  const billingEnabled = brand.features.billingEnabled;
  const drakonFindEnabled = brand.features.drakonFindEnabled;
  const collapsedBrandIconClassName =
    brand.id.toLowerCase() === "perceptrum"
      ? "h-10 w-14 object-contain"
      : "h-8 w-8 object-contain rounded-md";
  
  // Use unified dashboard summary hook
  const { cameras, dashboard, unreadCount, tokenUsageMonth } = useDashboardSummary();
  const hasUnreadNotifications = unreadCount > 0 && !isNotificationsBadgeDismissed;

  // Auto-close drawer on route change
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

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

    const checkOpenAiSettings = async () => {
      try {
        const [openAiResponse, zAiResponse] = await Promise.all([
          fetch("/api/openai-settings"),
          fetch("/api/zai-settings"),
        ]);
        if (!openAiResponse.ok && !zAiResponse.ok) return;
        const openAiData = openAiResponse.ok
          ? await openAiResponse.json().catch(() => ({}))
          : {};
        const zAiData = zAiResponse.ok
          ? await zAiResponse.json().catch(() => ({}))
          : {};
        if (cancelled) return;
        setShowOpenAiKeyPrompt(!Boolean(openAiData?.has_key));
        setShowZAiKeyPrompt(!Boolean(zAiData?.has_key));
      } catch {
        // Ignore transient errors; this check should never block UI.
      }
    };

    void checkOpenAiSettings();
    return () => {
      cancelled = true;
    };
  }, [isSettingsRoute, user?.id]);

  useEffect(() => {
    const onOpenAiKeyRequired = () => {
      if (isSettingsRoute) {
        setShowOpenAiKeyPrompt(false);
        return;
      }
      setShowOpenAiKeyPrompt(true);
    };
    const onZAiKeyRequired = () => {
      if (isSettingsRoute) {
        setShowZAiKeyPrompt(false);
        return;
      }
      setShowZAiKeyPrompt(true);
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
    setIsSidebarOpen(false);
  };

  const navigation = [
    { name: t("nav.dashboard"), href: "/dashboard", icon: LayoutDashboard },
    { name: t("nav.aiAgents"), href: "/ai-agents", icon: Bot },
    ...(drakonFindEnabled ? [{ name: "Drakon Find", href: "/drakon-find", icon: Radar }] : []),
    { name: t("nav.jobs"), href: "/jobs", icon: Briefcase },
    { name: t("nav.aiAssistant"), href: "/chat", icon: MessageSquare },
    { name: t("nav.cameras"), href: "/cameras", icon: Camera },
    { name: t("nav.logsEvents"), href: "/events", icon: FileText },
    ...(billingEnabled ? [{ name: t("nav.billing"), href: "/billing", icon: CreditCard }] : []),
    { name: t("nav.settings"), href: "/settings", icon: Settings },
  ];

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
        } md:translate-x-0 fixed md:relative z-50 md:z-auto w-4/5 ${
          isSidebarCollapsed ? "md:w-20" : "md:w-64"
        } bg-gray-900 border-r border-gray-800 transition-[transform,width] duration-300 h-screen flex-shrink-0 overflow-y-auto`}
      >
        <div className="min-h-full flex flex-col">
          {/* Logo */}
          <div
            className={`h-16 flex items-center border-b border-gray-800 flex-shrink-0 ${
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
          <nav className={`${isSidebarCollapsed ? "px-2" : "px-4"} py-6 space-y-1 md:flex-1`}>
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={handleNavigationClick}
                  title={isSidebarCollapsed ? item.name : undefined}
                  className={`flex items-center px-4 py-3 rounded-lg transition-all ${
                    active
                      ? "bg-blue-500/10 text-blue-400 shadow-lg shadow-blue-500/20"
                      : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  } ${isSidebarCollapsed ? "justify-center" : ""}`}
                >
                  <Icon className={`w-5 h-5 ${isSidebarCollapsed ? "" : "mr-3"}`} />
                  {!isSidebarCollapsed && <span className="font-medium">{item.name}</span>}
                </Link>
              );
            })}
          </nav>

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

            <LanguageSelector />
            
            <div className="relative">
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
                  Configure your OpenAI API key in Settings to enable AI agents, jobs, and chat inference.
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
                  Configure your Z.ai API key in Settings to enable Core model inference.
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



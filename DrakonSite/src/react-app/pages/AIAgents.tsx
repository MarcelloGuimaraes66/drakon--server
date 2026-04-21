import { useState, useRef, useMemo, useEffect } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import CameraBulkImportModal from "@/react-app/components/CameraBulkImportModal";
import CameraDirectoryControls from "@/react-app/components/CameraDirectoryControls";
import CameraDiscoveryModal from "@/react-app/components/CameraDiscoveryModal";
import CameraRecordingPlayerOverlay, {
  type CameraRecordingPlayerCamera,
} from "@/react-app/components/CameraRecordingPlayerOverlay";
import Layout from "@/react-app/components/Layout";
import CameraEditorModal, {
  type CameraEditorCamera,
  type CameraEditorDraft,
} from "@/react-app/components/CameraEditorModal";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import {
  CAMERA_DIRECTORY_INDEX_KEYS,
  getCameraDirectoryTab,
  useCameraDirectory,
  type CameraDirectoryIndexKey,
  type CameraDirectoryState,
  type CameraDirectoryTab,
} from "@/react-app/hooks/useCameraDirectory";
import { EventsProvider, useEvents } from "@/react-app/contexts/EventsContext";
import { useDashboardSummary } from "@/react-app/hooks/useDashboardSummary";
import { useThumbnailPolling } from "@/react-app/hooks/useThumbnailPolling";
import { useThumbnailRecovery } from "@/react-app/hooks/useThumbnailRecovery";
import { useBillingCheck } from "@/react-app/hooks/useBillingCheck";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import {
  getCameraConnectionState,
  isCameraOnline,
  isCameraServiceRunning,
} from "@/react-app/lib/cameraStatus";
import { Camera as CameraType, dashboardSummaryStore } from "@/react-app/lib/DashboardSummaryStore";
import { ONBOARDING_TARGETS } from "@/react-app/lib/onboarding";
import {
  createCamerasFromDiscoveryImport,
  formatDiscoveryImportErrorMessage,
  type CameraDiscoveryImportRequest,
} from "@/react-app/utils/cameraDiscovery";
import { toggleCameraService } from "@/react-app/utils/cameraService";
import { brand } from "@/shared/brand";
import {
  Archive,
  Camera,
  Plus,
  Play,
  Square,
  WifiOff,
  Wifi,
  Pencil,
  Cpu,
  AlertCircle,
  FileUp,
  X,
} from "lucide-react";

const AI_AGENTS_RETURN_SOURCE = "ai-agents";
const AI_AGENTS_DIRECTORY_PARAM_KEYS = {
  tab: "tab",
  onlineSearch: "onlineSearch",
  offlineSearch: "offlineSearch",
  onlineIndex: "onlineIndex",
  offlineIndex: "offlineIndex",
} as const;

const CAMERA_DIRECTORY_TABS: CameraDirectoryTab[] = ["online", "offline"];
const CAMERA_DIRECTORY_INDEX_KEY_SET = new Set<CameraDirectoryIndexKey>(
  CAMERA_DIRECTORY_INDEX_KEYS
);

function isCameraDirectoryTabValue(value: string | null): value is CameraDirectoryTab {
  return value === "online" || value === "offline";
}

function parseAIAgentsDirectoryState(searchParams: URLSearchParams): Partial<CameraDirectoryState> {
  const rawActiveTab = searchParams.get(AI_AGENTS_DIRECTORY_PARAM_KEYS.tab);
  const onlineIndex = searchParams.get(AI_AGENTS_DIRECTORY_PARAM_KEYS.onlineIndex);
  const offlineIndex = searchParams.get(AI_AGENTS_DIRECTORY_PARAM_KEYS.offlineIndex);

  return {
    activeTab: isCameraDirectoryTabValue(rawActiveTab) ? rawActiveTab : undefined,
    searchByTab: {
      online: searchParams.get(AI_AGENTS_DIRECTORY_PARAM_KEYS.onlineSearch) ?? "",
      offline: searchParams.get(AI_AGENTS_DIRECTORY_PARAM_KEYS.offlineSearch) ?? "",
    },
    indexByTab: {
      online: CAMERA_DIRECTORY_INDEX_KEY_SET.has(onlineIndex as CameraDirectoryIndexKey)
        ? (onlineIndex as CameraDirectoryIndexKey)
        : "all",
      offline: CAMERA_DIRECTORY_INDEX_KEY_SET.has(offlineIndex as CameraDirectoryIndexKey)
        ? (offlineIndex as CameraDirectoryIndexKey)
        : "all",
    },
  };
}

function applyAIAgentsDirectoryState(
  searchParams: URLSearchParams,
  state: CameraDirectoryState
): URLSearchParams {
  const nextParams = new URLSearchParams(searchParams);

  if (state.activeTab === "online") {
    nextParams.delete(AI_AGENTS_DIRECTORY_PARAM_KEYS.tab);
  } else {
    nextParams.set(AI_AGENTS_DIRECTORY_PARAM_KEYS.tab, state.activeTab);
  }

  for (const tab of CAMERA_DIRECTORY_TABS) {
    const searchParamKey =
      tab === "online"
        ? AI_AGENTS_DIRECTORY_PARAM_KEYS.onlineSearch
        : AI_AGENTS_DIRECTORY_PARAM_KEYS.offlineSearch;
    const indexParamKey =
      tab === "online"
        ? AI_AGENTS_DIRECTORY_PARAM_KEYS.onlineIndex
        : AI_AGENTS_DIRECTORY_PARAM_KEYS.offlineIndex;
    const searchValue = state.searchByTab[tab].trim();
    const indexValue = state.indexByTab[tab];

    if (searchValue.length > 0) {
      nextParams.set(searchParamKey, state.searchByTab[tab]);
    } else {
      nextParams.delete(searchParamKey);
    }

    if (indexValue === "all") {
      nextParams.delete(indexParamKey);
    } else {
      nextParams.set(indexParamKey, indexValue);
    }
  }

  return nextParams;
}

function AIAgentsContent() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDirectoryStateRef = useRef<Partial<CameraDirectoryState> | null>(null);
  if (initialDirectoryStateRef.current === null) {
    initialDirectoryStateRef.current = parseAIAgentsDirectoryState(searchParams);
  }
  const {
    isOpen: isOnboardingOpen,
    currentStepId: onboardingStepId,
    tutorialCameraId,
  } = useOnboarding();
  const billingEnabled = brand.features.billingEnabled;
  const [subscriptionToastCameraId, setSubscriptionToastCameraId] = useState<number | null>(null);
  const { checkBillingForCameraCreation, showBillingModal, closeBillingModal } = useBillingCheck();
  const { toasts, dismissToast, pushToast } = useEvents();

  // Use unified dashboard summary hook - gets cameras from centralized polling
  const { cameras, lastUpdatedAt } = useDashboardSummary();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [recordingCamera, setRecordingCamera] =
    useState<CameraRecordingPlayerCamera | null>(null);
  const [editingCamera, setEditingCamera] = useState<CameraEditorCamera | null>(null);
  const [editorDraft, setEditorDraft] = useState<CameraEditorDraft | null>(null);
  const [loadingEditCameraId, setLoadingEditCameraId] = useState<number | null>(null);
  const [pendingCameraIds, setPendingCameraIds] = useState<Set<number>>(() => new Set());
  const editRequestCameraId = useRef<number | null>(null);
  const hasAlignedTutorialCameraStartTabRef = useRef(false);
  const {
    activeTab,
    setActiveTab,
    activeSearchTerm,
    setActiveSearchTerm,
    activeIndexKey,
    setActiveIndexKey,
    directoryState,
    activeIndexCounts,
    filteredCameras,
    totalCameraCount,
    hasFiltersApplied,
    tabCounts,
  } = useCameraDirectory(cameras, {
    initialState: initialDirectoryStateRef.current ?? undefined,
  });
  const hasLoaded = lastUpdatedAt !== null;
  const aiAgentsReturnTo = useMemo(() => {
    const nextParams = applyAIAgentsDirectoryState(
      new URLSearchParams(searchParams),
      directoryState
    );
    const query = nextParams.toString();
    return query ? `${location.pathname}?${query}` : location.pathname;
  }, [directoryState, location.pathname, searchParams]);

  useEffect(() => {
    const nextParams = applyAIAgentsDirectoryState(
      new URLSearchParams(searchParams),
      directoryState
    );

    if (nextParams.toString() === searchParams.toString()) {
      return;
    }

    setSearchParams(nextParams, { replace: true });
  }, [directoryState, searchParams, setSearchParams]);

  useThumbnailPolling(cameras, (updates) => {
    for (const update of updates) {
      dashboardSummaryStore.patchCameraLocal(update.camera_id, {
        is_service_running: update.is_service_running ?? undefined,
        is_online: update.is_online ?? undefined,
        thumbnail_url: update.thumbnail_url ?? null,
        last_thumbnail_update: update.last_thumbnail_update ?? null,
      });
    }
  });
  useThumbnailRecovery(cameras);
  const existingCameraNames = useMemo(
    () => cameras.map((camera) => String(camera.name || "").trim()).filter(Boolean),
    [cameras]
  );
  const recordingHistoryLabel = i18n.language?.startsWith("pt")
    ? "Arquivo"
    : "Archive";

  useEffect(() => {
    if (!isOnboardingOpen || onboardingStepId !== "ai-agents-camera-start") {
      hasAlignedTutorialCameraStartTabRef.current = false;
      return;
    }

    if (hasAlignedTutorialCameraStartTabRef.current) {
      return;
    }

    if (typeof tutorialCameraId !== "number" || tutorialCameraId <= 0) {
      return;
    }

    const tutorialCamera = cameras.find((camera) => camera.id === tutorialCameraId);
    if (!tutorialCamera) {
      return;
    }

    setActiveTab(getCameraDirectoryTab(tutorialCamera));
    hasAlignedTutorialCameraStartTabRef.current = true;
  }, [cameras, isOnboardingOpen, onboardingStepId, setActiveTab, tutorialCameraId]);

  const updatePendingCameraState = (cameraId: number, isPending: boolean) => {
    setPendingCameraIds((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(cameraId);
      } else {
        next.delete(cameraId);
      }
      return next;
    });
  };

  const toggleService = async (camera: CameraType) => {
    const cameraId = camera.id;
    const isRunning = camera.is_service_running === 1;

    if (pendingCameraIds.has(cameraId)) {
      return;
    }

    updatePendingCameraState(cameraId, true);

    try {
      const result = await toggleCameraService({ cameraId, isRunning });

      if (result.agentsDisabledNoSubscription) {
        setSubscriptionToastCameraId(cameraId);
      }

      // ✅ instant UI update (button flips immediately)
      if (result.nextRunning === 1) {
        pushToast({
          cameraId,
          cameraName:
            result.cameraName ||
            (typeof camera.name === "string" && camera.name.trim()
              ? camera.name.trim()
              : `Camera #${cameraId}`),
          message:
            result.runningAnalytics.length > 0
              ? "The analytics below are active for this camera."
              : "Enable analytics in the Algorithms page to start detections.",
          analytics: result.runningAnalytics,
          type: "camera_started",
        });
      }

      dashboardSummaryStore.patchCameraLocal(cameraId, {
        is_service_running: result.nextRunning,
        ...(result.nextRunning === 0
          ? { thumbnail_url: null, last_thumbnail_update: null }
          : {}),
      });

      dashboardSummaryStore.refresh();
    } catch (error) {
      console.error("Failed to toggle service:", error);
    } finally {
      updatePendingCameraState(cameraId, false);
    }
  };

  // Track 404 thumbnails to avoid retrying until URL changes
  const failed404Thumbnails = useRef<Set<string>>(new Set());

  const getThumbnailUrl = (camera: CameraType) => {
    if (!camera.thumbnail_url) return null;
    
    // Check if this URL previously returned 404
    if (failed404Thumbnails.current.has(camera.thumbnail_url)) {
      return null; // Don't retry 404s
    }
    
    // No cache-busting - rely on ETag/304 responses
    return `/api/thumbnails/${camera.thumbnail_url}`;
  };

  const handleThumbnailError = (camera: CameraType) => {
    if (camera.thumbnail_url) {
      // Mark this URL as 404 so we don't retry
      failed404Thumbnails.current.add(camera.thumbnail_url);
      console.log('[THUMBNAIL 404] Marked as failed, won\'t retry:', camera.thumbnail_url);
    }
  };

  const openEditCamera = async (camera: CameraType) => {
    editRequestCameraId.current = camera.id;
    setLoadingEditCameraId(camera.id);
    setIsImportOpen(false);
    setIsDiscoveryOpen(false);
    setIsEditorOpen(false);
    setEditorDraft(null);
    setEditingCamera(null);

    try {
      const response = await fetch(`/api/cameras/${camera.id}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to load camera ${camera.id}`);
      }

      const fullCamera = await response.json();
      if (editRequestCameraId.current === camera.id) {
        setEditingCamera(fullCamera);
        setIsEditorOpen(true);
      }
    } catch (error) {
      console.error("Failed to load camera editor payload:", error);
      if (editRequestCameraId.current === camera.id) {
        setEditorDraft(null);
        setEditingCamera(camera as CameraEditorCamera);
        setIsEditorOpen(true);
      }
    } finally {
      if (editRequestCameraId.current === camera.id) {
        setLoadingEditCameraId(null);
      }
    }
  };

  const closeEditCamera = () => {
    editRequestCameraId.current = null;
    setLoadingEditCameraId(null);
    setEditingCamera(null);
    setEditorDraft(null);
    setIsEditorOpen(false);
  };

  const handleCameraSaved = async () => {
    dashboardSummaryStore.refresh();
  };

  const openAddModal = async () => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      return;
    }

    setIsImportOpen(false);
    setIsDiscoveryOpen(false);
    editRequestCameraId.current = null;
    setLoadingEditCameraId(null);
    setEditingCamera(null);
    setEditorDraft(null);
    setIsEditorOpen(true);
  };

  const openImportModal = async () => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      return;
    }

    setIsDiscoveryOpen(false);
    closeEditCamera();
    setIsImportOpen(true);
  };

  const openDiscoveryModal = () => {
    setIsImportOpen(false);
    closeEditCamera();
    setIsDiscoveryOpen(true);
  };

  const handleDiscoveryImport = async (request: CameraDiscoveryImportRequest) => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      return;
    }

    const result = await createCamerasFromDiscoveryImport(request);
    dashboardSummaryStore.refresh();
    if (result.failures.length > 0) {
      throw new Error(formatDiscoveryImportErrorMessage(result));
    }

    setIsImportOpen(false);
    closeEditCamera();
    setEditorDraft(null);
    setIsDiscoveryOpen(false);
    setIsEditorOpen(false);
  };

  const handleImportSaved = async () => {
    dashboardSummaryStore.refresh();
  };

  const openRecordingPlayer = (camera: CameraType) => {
    setRecordingCamera({
      id: camera.id,
      name: String(camera.name || "").trim() || `Camera ${camera.id}`,
      description:
        typeof (camera as any).description === "string"
          ? String((camera as any).description).trim()
          : null,
      thumbnail_url:
        typeof camera.thumbnail_url === "string" ? camera.thumbnail_url : null,
      is_service_running:
        typeof camera.is_service_running === "number"
          ? camera.is_service_running
          : null,
      is_online:
        typeof camera.is_online === "number" ? camera.is_online : null,
      store_frames:
        typeof (camera as any).store_frames === "number"
          ? (camera as any).store_frames
          : null,
      retention_days:
        typeof (camera as any).retention_days === "number"
          ? (camera as any).retention_days
          : null,
    });
  };

  const renderCameraActions = (
    camera: CameraType,
    mode: "default" | "overlay" = "default"
  ) => {
    const isOverlay = mode === "overlay";
    const isRunning = isCameraServiceRunning(camera);
    const isTogglePending = pendingCameraIds.has(camera.id);
    const isTutorialCameraStartTarget =
      !isOverlay &&
      isOnboardingOpen &&
      onboardingStepId === "ai-agents-camera-start" &&
      typeof tutorialCameraId === "number" &&
      tutorialCameraId > 0 &&
      tutorialCameraId === camera.id;

    return (
      <div
        className={
          isOverlay
            ? "grid grid-cols-2 gap-2"
            : "flex flex-col gap-2 md:grid md:grid-cols-2"
        }
      >
        <button
          onClick={() => openEditCamera(camera)}
          disabled={loadingEditCameraId === camera.id}
          className={`flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
            isOverlay
              ? "min-h-[40px] rounded-xl border border-white/10 bg-gray-950/85 px-3 py-2 text-gray-100 backdrop-blur-sm hover:bg-gray-800/95 disabled:bg-gray-950/60 disabled:text-gray-500"
              : "min-h-[44px] rounded-lg bg-gray-800 px-3 py-2.5 text-gray-300 hover:bg-gray-700 disabled:bg-gray-800/70 disabled:text-gray-500 md:min-h-0 md:py-2"
          }`}
        >
          <Pencil className="w-4 h-4" />
          {loadingEditCameraId === camera.id ? "Loading..." : t("dashboard.edit")}
        </button>

        <button
          onClick={() => toggleService(camera)}
          disabled={isTogglePending}
          aria-busy={isTogglePending}
          data-camera-running={isRunning ? "true" : "false"}
          data-onboarding-target={
            isTutorialCameraStartTarget ? ONBOARDING_TARGETS.aiAgentsCameraStart : undefined
          }
          className={`flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
            isRunning
              ? isOverlay
                ? "min-h-[40px] rounded-xl border border-red-400/20 bg-red-500/20 px-3 py-2 text-red-100 backdrop-blur-sm hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                : "min-h-[44px] rounded-lg bg-red-500/10 px-3 py-2.5 text-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-0 md:py-2"
              : isOverlay
              ? "min-h-[40px] rounded-xl border border-green-400/20 bg-green-500/20 px-3 py-2 text-green-100 backdrop-blur-sm hover:bg-green-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              : "min-h-[44px] rounded-lg bg-green-500/10 px-3 py-2.5 text-green-400 hover:bg-green-500/20 disabled:cursor-not-allowed disabled:opacity-60 md:min-h-0 md:py-2"
          }`}
        >
          {isTogglePending ? (
            t("common.loading")
          ) : isRunning ? (
            <>
              <Square className="w-4 h-4" />
              {t("dashboard.stop")}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {t("dashboard.start")}
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => openRecordingPlayer(camera)}
          className={`flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
            isOverlay
              ? "min-h-[40px] rounded-xl border border-cyan-400/20 bg-cyan-500/16 px-3 py-2 text-cyan-100 backdrop-blur-sm hover:bg-cyan-500/24"
              : "min-h-[44px] rounded-lg bg-cyan-500/10 px-3 py-2.5 text-cyan-300 hover:bg-cyan-500/18 md:min-h-0 md:py-2"
          }`}
        >
          <Archive className="w-4 h-4" />
          {recordingHistoryLabel}
        </button>

        <Link
          to={{
            pathname: `/algorithms/${camera.id}`,
            search: `?${new URLSearchParams({ returnTo: aiAgentsReturnTo }).toString()}`,
          }}
          state={{ returnSource: AI_AGENTS_RETURN_SOURCE }}
          className={`flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
            isOverlay
              ? "min-h-[40px] rounded-xl border border-blue-400/20 bg-blue-500/20 px-3 py-2 text-blue-100 backdrop-blur-sm hover:bg-blue-500/30"
              : "min-h-[44px] rounded-lg bg-blue-500/10 px-3 py-2.5 text-blue-400 hover:bg-blue-500/20 md:min-h-0 md:py-2"
          }`}
        >
          <Cpu className="w-4 h-4" />
          {t("dashboard.configureAlgorithms")}
        </Link>
      </div>
    );
  };

  const emptyStateTitle =
    totalCameraCount === 0
      ? t("dashboard.noCameras")
      : hasFiltersApplied
      ? t("cameraDirectory.noMatches", {
          defaultValue: "No cameras match this view",
        })
      : activeTab === "online"
      ? t("cameraDirectory.noOnlineCameras", {
          defaultValue: "No online cameras",
        })
      : t("cameraDirectory.noOfflineCameras", {
          defaultValue: "No offline cameras",
        });

  const emptyStateDescription =
    totalCameraCount === 0
      ? t("dashboard.noCamerasDesc")
      : hasFiltersApplied
      ? t("cameraDirectory.noMatchesDesc", {
          defaultValue: "Try another search or initial filter.",
        })
      : activeTab === "online"
      ? t("cameraDirectory.noOnlineCamerasDesc", {
          defaultValue: "Start an offline camera to move it here.",
        })
      : t("cameraDirectory.noOfflineCamerasDesc", {
          defaultValue: "Stopped cameras stay here until they are started again.",
        });



  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-100">
            {t("aiAgents.title")}
          </h1>
          <p className="mt-1.5 text-sm text-gray-400">
            {t("aiAgents.subtitle")}
          </p>
        </div>

        <CameraDirectoryControls
          activeTab={activeTab}
          activeSearchTerm={activeSearchTerm}
          activeIndexKey={activeIndexKey}
          activeIndexCounts={activeIndexCounts}
          tabCounts={tabCounts}
          searchInputId="ai-agents-search"
          onTabChange={setActiveTab}
          onSearchChange={setActiveSearchTerm}
          onIndexChange={setActiveIndexKey}
          actions={
            <>
              <button
                onClick={openDiscoveryModal}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/20"
              >
                <Wifi className="h-4 w-4" />
                Scan Network
              </button>
              <button
                onClick={openImportModal}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-900/60 px-4 py-2.5 text-sm font-medium text-gray-100 transition-colors hover:border-blue-500/40 hover:bg-gray-800"
              >
                <FileUp className="h-4 w-4" />
                Import Cameras
              </button>
            </>
          }
        />

        {/* Camera grid */}
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
          {/* Add camera card */}
          <button
            onClick={openAddModal}
            className="group relative flex h-[200px] self-start flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-700 bg-gradient-to-br from-gray-800/50 to-gray-900/50 p-6 backdrop-blur-sm transition-all duration-300 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/20 dark:from-gray-800/50 dark:to-gray-900/50 md:h-[280px] md:p-8"
          >
            <div className="w-12 md:w-16 h-12 md:h-16 bg-gray-800 group-hover:bg-blue-500/10 rounded-2xl flex items-center justify-center mb-3 md:mb-4 transition-colors">
              <Plus className="w-6 md:w-8 h-6 md:h-8 text-gray-500 group-hover:text-blue-400 transition-colors" />
            </div>
            <p className="text-sm md:text-base text-gray-400 group-hover:text-gray-200 font-medium transition-colors">
              {t("common.registerCamera")}
            </p>
          </button>

          {/* Camera cards */}
          {filteredCameras.map((camera) => {
            const connectionState = getCameraConnectionState(camera);
            const isRunning = isCameraServiceRunning(camera);
            const isOnline = isCameraOnline(camera);
            const isAuthLost = connectionState === "auth_lost";
            const isReconnecting = connectionState === "reconnecting";
            const showInlineActionsForTutorial =
              isOnboardingOpen &&
              onboardingStepId === "ai-agents-camera-start" &&
              typeof tutorialCameraId === "number" &&
              tutorialCameraId > 0 &&
              tutorialCameraId === camera.id;

            return (
            <div
              key={camera.id}
              className="group relative bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 md:hover:scale-[1.02]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 overflow-hidden">
                {isRunning && getThumbnailUrl(camera) ? (
                  <>
                    <img
                      key={`${camera.id}-${camera.last_thumbnail_update}`}
                      src={getThumbnailUrl(camera)!}
                      alt={camera.name}
                      loading="lazy"
                      className="w-full h-full object-contain object-center p-2 md:p-3"
                      onError={(e) => {
                        // Mark as 404 to avoid retrying
                        handleThumbnailError(camera);
                        
                        // Fallback to placeholder on error
                        const img = e.target as HTMLImageElement;
                        const parent = img.parentElement;
                        if (parent) {
                          img.style.display = 'none';
                          const placeholder = document.createElement('div');
                          placeholder.className = 'w-full h-full flex items-center justify-center';
                          placeholder.innerHTML = '<svg class="w-12 h-12 text-gray-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
                          parent.appendChild(placeholder);
                        }
                      }}
                    />
                  </>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="w-12 h-12 text-gray-600" />
                  </div>
                )}

                {/* Status badge */}
                {isAuthLost ? (
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-full bg-gray-900/90 px-3 py-1.5 backdrop-blur-sm">
                    <AlertCircle className="h-4 w-4 text-rose-300" />
                    <span className="text-xs font-medium text-rose-300">
                      Pairing/Auth lost
                    </span>
                  </div>
                ) : isReconnecting ? (
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-gray-900/90 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <AlertCircle className="w-4 h-4 text-amber-300" />
                    <span className="text-xs font-medium text-amber-300">
                      Reconnecting
                    </span>
                  </div>
                ) : !isRunning ? (
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-gray-900/90 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <WifiOff className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-medium text-red-400">
                      {t("dashboard.offline")}
                    </span>
                  </div>
                ) : null}

                {/* Service status */}
                {isRunning ? (
                  <div
                    className={`absolute top-3 left-3 z-20 backdrop-blur-sm p-2 rounded-full ${
                      isOnline ? "bg-blue-500/90" : isAuthLost ? "bg-rose-500/90" : "bg-amber-500/90"
                    }`}
                  >
                    <Play className="w-4 h-4 text-white fill-white" />
                  </div>
                ) : null}

                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden translate-y-3 bg-gradient-to-t from-black/95 via-black/80 to-transparent p-3 opacity-0 transition-all duration-200 md:block md:group-hover:pointer-events-auto md:group-hover:translate-y-0 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100">
                  {renderCameraActions(camera, "overlay")}
                </div>
              </div>

              {/* Card content */}
              <div className="p-4 md:p-5">
                <h3 className="text-base md:text-lg font-semibold text-gray-100 mb-1">
                  {camera.name}
                </h3>
                <p className="text-xs md:text-sm text-gray-500 mb-3 md:mb-4">{camera.ip_address}</p>
                <p
                  className={`text-xs font-medium mb-3 ${
                    isOnline
                      ? "text-green-400"
                      : isAuthLost
                      ? "text-rose-300"
                      : isReconnecting
                      ? "text-amber-300"
                      : "text-red-400"
                  }`}
                >
                  {isOnline
                    ? t("dashboard.online")
                    : isAuthLost
                    ? "Pairing/Auth lost"
                    : isReconnecting
                    ? "Reconnecting"
                    : t("dashboard.offline")}
                </p>

                {/* Actions */}
                <div className={showInlineActionsForTutorial ? "" : "md:hidden"}>
                  {renderCameraActions(camera)}
                </div>
              </div>
            </div>
          )})}

          {hasLoaded && filteredCameras.length === 0 && (
            <div className="col-span-full rounded-2xl border border-gray-800/60 bg-gray-950/40 px-6 py-10 text-center">
              <Camera className="mx-auto mb-4 h-12 w-12 text-gray-600" />
              <h3 className="mb-2 text-lg font-semibold text-gray-300">{emptyStateTitle}</h3>
              <p className="mx-auto max-w-2xl text-sm text-gray-500">
                {emptyStateDescription}
              </p>
              {totalCameraCount === 0 ? (
                <button
                  onClick={openAddModal}
                  className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-500 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600"
                >
                  <Plus className="h-5 w-5" />
                  {t("common.registerCamera")}
                </button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Billing required modal */}
      {billingEnabled && showBillingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-100 mb-4">
                {t("cameras.billingRequired")}
              </h2>
              <p className="text-gray-300 mb-6">
                {t("cameras.billingRequiredDesc")}
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={closeBillingModal}
                  className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
                >
                  {t("cameras.cancel")}
                </button>
                {billingEnabled ? (
                  <button
                    onClick={() => {
                      closeBillingModal();
                      navigate("/billing");
                    }}
                    className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors text-center"
                  >
                    {t("cameras.goToBilling")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      <CameraEditorModal
        isOpen={isEditorOpen}
        camera={editingCamera}
        draftCamera={!editingCamera ? editorDraft : null}
        existingCameraNames={existingCameraNames}
        onClose={closeEditCamera}
        onSaved={handleCameraSaved}
      />

      <CameraDiscoveryModal
        isOpen={isDiscoveryOpen}
        onClose={() => setIsDiscoveryOpen(false)}
        onImport={handleDiscoveryImport}
      />

      <CameraBulkImportModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImported={handleImportSaved}
      />

      <CameraRecordingPlayerOverlay
        isOpen={recordingCamera !== null}
        camera={recordingCamera}
        onClose={() => setRecordingCamera(null)}
      />

      {/* Camera event toasts */}
      <CameraEventToast toasts={toasts} onDismiss={dismissToast} />

      {/* Subscription required toast */}
      {subscriptionToastCameraId !== null && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md pointer-events-none">
          <div className="bg-gradient-to-br from-orange-900/95 to-orange-950/95 backdrop-blur-xl border border-orange-700/50 rounded-xl shadow-2xl shadow-orange-500/20 p-4 pointer-events-auto animate-slide-in">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-orange-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-5 h-5 text-orange-400" />
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-gray-100 mb-1">
                  Agent Start Needs Attention
                </h4>
                <p className="text-sm text-gray-300 mb-2">
                  Some agents for Camera #{subscriptionToastCameraId} were skipped during startup.
                </p>
                <p className="text-xs text-gray-400 mb-3">
                  Review the provider API keys and agent settings if detections do not begin.
                </p>
                {billingEnabled ? (
                  <button
                    onClick={() => navigate("/billing")}
                    className="text-xs font-medium text-orange-300 hover:text-orange-200 underline"
                  >
                    Go to Billing →
                  </button>
                ) : null}
              </div>

              <button
                onClick={() => setSubscriptionToastCameraId(null)}
                className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-orange-800/30 rounded-lg transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function AIAgentsPage() {
  // Use dashboard summary for EventsProvider cameras
  const { cameras } = useDashboardSummary();

  return (
    <Layout>
      <EventsProvider cameras={cameras}>
        <AIAgentsContent />
      </EventsProvider>
    </Layout>
  );
}

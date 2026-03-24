import { useState, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import CameraEditorModal, {
  type CameraEditorCamera,
} from "@/react-app/components/CameraEditorModal";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import { EventsProvider, useEvents } from "@/react-app/contexts/EventsContext";
import { useDashboardSummary } from "@/react-app/hooks/useDashboardSummary";
import { useThumbnailPolling } from "@/react-app/hooks/useThumbnailPolling";
import { useBillingCheck } from "@/react-app/hooks/useBillingCheck";
import { Camera as CameraType, dashboardSummaryStore } from "@/react-app/lib/DashboardSummaryStore";
import { toggleCameraService } from "@/react-app/utils/cameraService";
import { brand } from "@/shared/brand";
import {
  Camera,
  Plus,
  Play,
  Square,
  WifiOff,
  Pencil,
  Cpu,
  AlertCircle,
  X,
} from "lucide-react";

function AIAgentsContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const billingEnabled = brand.features.billingEnabled;
  const [subscriptionToastCameraId, setSubscriptionToastCameraId] = useState<number | null>(null);
  const { checkBillingForCameraCreation, showBillingModal, closeBillingModal } = useBillingCheck();
  const { toasts, dismissToast } = useEvents();
  
  // Use unified dashboard summary hook - gets cameras from centralized polling
  const { cameras } = useDashboardSummary();
  const isLoading = cameras.length === 0;
  const [searchTerm, setSearchTerm] = useState("");
  const [editingCamera, setEditingCamera] = useState<CameraEditorCamera | null>(null);
  const [loadingEditCameraId, setLoadingEditCameraId] = useState<number | null>(null);
  const [pendingCameraIds, setPendingCameraIds] = useState<Set<number>>(() => new Set());
  const editRequestCameraId = useRef<number | null>(null);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredCameras = normalizedSearch
    ? cameras.filter((camera) => camera.name?.toLowerCase().includes(normalizedSearch))
    : cameras;
  useThumbnailPolling(cameras, (updates) => {
    for (const update of updates) {
      dashboardSummaryStore.patchCameraLocal(update.camera_id, {
        thumbnail_url: update.thumbnail_url ?? null,
        last_thumbnail_update: update.last_thumbnail_update ?? null,
      });
    }
  });
  const sortedFilteredCameras = useMemo(
    () =>
      [...filteredCameras].sort(
        (a, b) => (b.is_service_running ?? 0) - (a.is_service_running ?? 0)
      ),
    [filteredCameras]
  );

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

  const toggleService = async (cameraId: number, isRunning: boolean) => {
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
      }
    } catch (error) {
      console.error("Failed to load camera editor payload:", error);
      if (editRequestCameraId.current === camera.id) {
        setEditingCamera(camera as CameraEditorCamera);
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
  };

  const handleCameraSaved = async () => {
    dashboardSummaryStore.refresh();
  };

  const renderCameraActions = (
    camera: CameraType,
    mode: "default" | "overlay" = "default"
  ) => {
    const isOverlay = mode === "overlay";
    const isRunning = camera.is_service_running === 1;
    const isTogglePending = pendingCameraIds.has(camera.id);

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
          onClick={() => toggleService(camera.id, camera.is_service_running === 1)}
          disabled={isTogglePending}
          aria-busy={isTogglePending}
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

        <Link
          to={`/algorithms/${camera.id}`}
          className={`flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
            isOverlay
              ? "col-span-2 min-h-[40px] rounded-xl border border-blue-400/20 bg-blue-500/20 px-3 py-2 text-blue-100 backdrop-blur-sm hover:bg-blue-500/30"
              : "min-h-[44px] rounded-lg bg-blue-500/10 px-3 py-2.5 text-blue-400 hover:bg-blue-500/20 md:col-span-2 md:min-h-0 md:py-2"
          }`}
        >
          <Cpu className="w-4 h-4" />
          {t("dashboard.configureAlgorithms")}
        </Link>
      </div>
    );
  };



  return (
    <>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 md:mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-100 dark:text-gray-100 mb-2">
              {t("aiAgents.title")}
            </h1>
            <p className="text-sm md:text-base text-gray-400 dark:text-gray-400">
              {t("aiAgents.subtitle")}
            </p>
          </div>
          <div className="w-full md:w-72">
            <label className="sr-only" htmlFor="ai-agents-search">
              Search cameras
            </label>
            <input
              id="ai-agents-search"
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search cameras..."
              className="w-full bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40"
            />
          </div>
        </div>

        {/* Camera grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Add camera card */}
          <button
            onClick={async () => {
              const canAdd = await checkBillingForCameraCreation();
              if (canAdd) {
                navigate("/cameras");
              }
            }}
            className="group relative bg-gradient-to-br from-gray-800/50 to-gray-900/50 dark:from-gray-800/50 dark:to-gray-900/50 backdrop-blur-sm border-2 border-dashed border-gray-700 hover:border-blue-500/50 rounded-2xl p-6 md:p-8 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/20 flex flex-col items-center justify-center min-h-[200px] md:min-h-[280px]"
          >
            <div className="w-12 md:w-16 h-12 md:h-16 bg-gray-800 group-hover:bg-blue-500/10 rounded-2xl flex items-center justify-center mb-3 md:mb-4 transition-colors">
              <Plus className="w-6 md:w-8 h-6 md:h-8 text-gray-500 group-hover:text-blue-400 transition-colors" />
            </div>
            <p className="text-sm md:text-base text-gray-400 group-hover:text-gray-200 font-medium transition-colors">
              {t("dashboard.addCamera")}
            </p>
          </button>

          {/* Camera cards */}
          {sortedFilteredCameras.map((camera) => (
            <div
              key={camera.id}
              className="group relative bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-300 md:hover:scale-[1.02]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 overflow-hidden">
                {camera.is_service_running === 1 && getThumbnailUrl(camera) ? (
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
                {camera.is_service_running !== 1 && (
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-2 bg-gray-900/90 backdrop-blur-sm px-3 py-1.5 rounded-full">
                    <WifiOff className="w-4 h-4 text-red-400" />
                    <span className="text-xs font-medium text-red-400">
                      {t("dashboard.offline")}
                    </span>
                  </div>
                )}

                {/* Service status */}
                {camera.is_service_running ? (
                  <div className="absolute top-3 left-3 z-20 bg-blue-500/90 backdrop-blur-sm p-2 rounded-full">
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

                {/* Actions */}
                <div className="md:hidden">{renderCameraActions(camera)}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty state */}
        {!isLoading && cameras.length === 0 && (
          <div className="text-center py-12 md:py-16">
            <Camera className="w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg md:text-xl font-semibold text-gray-300 mb-2">
              {t("dashboard.noCameras")}
            </h3>
            <p className="text-sm md:text-base text-gray-500 mb-6 px-4">
              {t("dashboard.noCamerasDesc")}
            </p>
            <button
              onClick={async () => {
                const canAdd = await checkBillingForCameraCreation();
                if (canAdd) {
                  navigate("/cameras");
                }
              }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors min-h-[44px]"
            >
              <Plus className="w-5 h-5" />
              {t("dashboard.addCamera")}
            </button>
          </div>
        )}
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
        isOpen={!!editingCamera}
        camera={editingCamera}
        onClose={closeEditCamera}
        onSaved={handleCameraSaved}
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

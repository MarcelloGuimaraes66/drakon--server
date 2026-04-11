import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Camera, FileUp, Pencil, Play, Plus, Square, Trash2, Wifi } from "lucide-react";
import CameraStartAttentionToast from "@/react-app/components/CameraStartAttentionToast";
import CameraBulkImportModal from "@/react-app/components/CameraBulkImportModal";
import CameraDirectoryControls from "@/react-app/components/CameraDirectoryControls";
import CameraDiscoveryModal from "@/react-app/components/CameraDiscoveryModal";
import Layout from "@/react-app/components/Layout";
import CameraEditorModal, {
  type CameraEditorCamera,
  type CameraEditorDraft,
  type CameraEditorSavedResult,
} from "@/react-app/components/CameraEditorModal";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import { EventsProvider, useEvents } from "@/react-app/contexts/EventsContext";
import { useBillingCheck } from "@/react-app/hooks/useBillingCheck";
import { useCameraDirectory } from "@/react-app/hooks/useCameraDirectory";
import { useDashboardSummary } from "@/react-app/hooks/useDashboardSummary";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { getCameraConnectionState, isCameraServiceRunning } from "@/react-app/lib/cameraStatus";
import { dashboardSummaryStore } from "@/react-app/lib/DashboardSummaryStore";
import { ONBOARDING_TARGETS } from "@/react-app/lib/onboarding";
import {
  createCamerasFromDiscoveryImport,
  formatDiscoveryImportErrorMessage,
  type CameraDiscoveryImportRequest,
} from "@/react-app/utils/cameraDiscovery";
import { toggleCameraService } from "@/react-app/utils/cameraService";
import { brand } from "@/shared/brand";
import { Camera as CameraType } from "@/shared/types";

type CamerasContentProps = {
  cameras: CameraType[];
  refreshCameras: () => Promise<CameraType[]>;
  patchCamera: (cameraId: number, patch: Partial<CameraType>) => void;
};

const CAMERA_EDITOR_ONBOARDING_STEPS = new Set([
  "camera-rtsp-form",
  "camera-address",
  "camera-storage",
  "camera-webcam-form",
  "camera-webcam-save",
]);

function findSavedCameraId(
  cameras: CameraType[],
  saved?: CameraEditorSavedResult
): number | null {
  if (typeof saved?.cameraId === "number" && Number.isInteger(saved.cameraId) && saved.cameraId > 0) {
    return saved.cameraId;
  }

  const normalizedName =
    typeof saved?.cameraName === "string" ? saved.cameraName.trim().toLowerCase() : "";
  const normalizedConnectionMethod =
    typeof saved?.connectionMethod === "string"
      ? saved.connectionMethod.trim().toUpperCase()
      : "";

  const matches = cameras.filter((camera) => {
    const nameMatches = normalizedName
      ? String(camera.name || "").trim().toLowerCase() === normalizedName
      : true;
    const connectionMatches = normalizedConnectionMethod
      ? String(camera.connection_method || "").trim().toUpperCase() === normalizedConnectionMethod
      : true;
    return nameMatches && connectionMatches;
  });

  if (matches.length === 0) {
    return null;
  }

  const [latestCamera] = [...matches].sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });

  return latestCamera?.id ?? null;
}

function CamerasContent({ cameras, refreshCameras, patchCamera }: CamerasContentProps) {
  const { t } = useTranslation();
  const billingEnabled = brand.features.billingEnabled;
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false);
  const [editorCamera, setEditorCamera] = useState<CameraEditorCamera | null>(null);
  const [editorDraft, setEditorDraft] = useState<CameraEditorDraft | null>(null);
  const [pendingCameraIds, setPendingCameraIds] = useState<Set<number>>(() => new Set());
  const [subscriptionToastCameraId, setSubscriptionToastCameraId] = useState<number | null>(null);
  const { checkBillingForCameraCreation, showBillingModal, closeBillingModal } = useBillingCheck();
  const { toasts, dismissToast, pushToast } = useEvents();
  const {
    currentStepId: onboardingStepId,
    isOpen: isOnboardingOpen,
    completeCameraTutorial,
  } = useOnboarding();
  const tutorialModalRequestStepRef = useRef<string | null>(null);
  const onboardingOwnedEditorRef = useRef(false);
  const refreshDashboardSummary = useCallback(() => {
    dashboardSummaryStore.refresh();
  }, []);
  const {
    activeTab,
    setActiveTab,
    activeSearchTerm,
    setActiveSearchTerm,
    activeIndexKey,
    setActiveIndexKey,
    activeIndexCounts,
    filteredCameras,
    totalCameraCount,
    hasFiltersApplied,
    tabCounts,
  } = useCameraDirectory(cameras);
  const existingCameraNames = useMemo(
    () => cameras.map((camera) => String(camera.name || "").trim()).filter(Boolean),
    [cameras]
  );

  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) {
      return;
    }

    const parsedId = parseInt(editId, 10);
    if (Number.isNaN(parsedId)) {
      return;
    }

    const targetCamera = cameras.find((camera) => camera.id === parsedId);
    if (!targetCamera) {
      return;
    }

    if (!isEditorOpen || editorCamera?.id !== targetCamera.id) {
      setEditorCamera(targetCamera);
      setIsEditorOpen(true);
    }
  }, [cameras, editorCamera?.id, isEditorOpen, searchParams]);

  const clearEditSearchParam = useCallback(() => {
    if (!searchParams.get("edit")) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("edit");
    setSearchParams(nextParams);
  }, [searchParams, setSearchParams]);

  const openNewCameraEditor = useCallback(async (fromOnboarding: boolean) => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      onboardingOwnedEditorRef.current = false;
      return;
    }

    onboardingOwnedEditorRef.current = fromOnboarding;
    clearEditSearchParam();
    setIsImportOpen(false);
    setIsDiscoveryOpen(false);
    setEditorCamera(null);
    setEditorDraft(null);
    setIsEditorOpen(true);
  }, [checkBillingForCameraCreation, clearEditSearchParam]);

  const openAddModal = useCallback(() => openNewCameraEditor(false), [openNewCameraEditor]);

  const openAddModalFromOnboarding = useCallback(
    () => openNewCameraEditor(true),
    [openNewCameraEditor]
  );

  const openImportModal = async () => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      return;
    }

    onboardingOwnedEditorRef.current = false;
    clearEditSearchParam();
    setIsDiscoveryOpen(false);
    setIsEditorOpen(false);
    setEditorDraft(null);
    setEditorCamera(null);
    setIsImportOpen(true);
  };

  const openDiscoveryModal = () => {
    onboardingOwnedEditorRef.current = false;
    clearEditSearchParam();
    setIsImportOpen(false);
    setEditorCamera(null);
    setEditorDraft(null);
    setIsEditorOpen(false);
    setIsDiscoveryOpen(true);
  };

  const openEditModal = (camera: CameraType, syncSearchParam = true) => {
    onboardingOwnedEditorRef.current = false;
    setIsImportOpen(false);
    setIsDiscoveryOpen(false);
    setEditorDraft(null);
    setEditorCamera(camera);
    setIsEditorOpen(true);

    if (!syncSearchParam) {
      return;
    }

    if (searchParams.get("edit") === String(camera.id)) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("edit", String(camera.id));
    setSearchParams(nextParams);
  };

  const closeEditor = useCallback(() => {
    onboardingOwnedEditorRef.current = false;
    setIsEditorOpen(false);
    setEditorCamera(null);
    setEditorDraft(null);
    clearEditSearchParam();
  }, [clearEditSearchParam]);

  useEffect(() => {
    const isCameraEditorOnboardingStep =
      !!onboardingStepId && isOnboardingOpen && CAMERA_EDITOR_ONBOARDING_STEPS.has(onboardingStepId);

    if (!isCameraEditorOnboardingStep) {
      tutorialModalRequestStepRef.current = null;
      if (onboardingOwnedEditorRef.current && isEditorOpen && !editorCamera && !editorDraft) {
        closeEditor();
      }
      return;
    }

    if (isEditorOpen) {
      tutorialModalRequestStepRef.current = onboardingStepId;
      return;
    }

    if (tutorialModalRequestStepRef.current === onboardingStepId) {
      return;
    }

    tutorialModalRequestStepRef.current = onboardingStepId;
    void openAddModalFromOnboarding();
  }, [
    closeEditor,
    editorCamera,
    editorDraft,
    isEditorOpen,
    isOnboardingOpen,
    onboardingStepId,
    openAddModalFromOnboarding,
  ]);

  useEffect(() => {
    if (!isOnboardingOpen || !onboardingStepId) {
      return;
    }

    if (onboardingStepId !== "camera-scan-network" && isDiscoveryOpen) {
      setIsDiscoveryOpen(false);
    }

    if (onboardingStepId !== "camera-import" && isImportOpen) {
      setIsImportOpen(false);
    }
  }, [isDiscoveryOpen, isImportOpen, isOnboardingOpen, onboardingStepId]);

  const handleDiscoveryImport = async (request: CameraDiscoveryImportRequest) => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      return;
    }

    const result = await createCamerasFromDiscoveryImport(request);
    await refreshCameras();
    refreshDashboardSummary();
    if (result.failures.length > 0) {
      throw new Error(formatDiscoveryImportErrorMessage(result));
    }

    clearEditSearchParam();
    setEditorCamera(null);
    setEditorDraft(null);
    setIsImportOpen(false);
    setIsDiscoveryOpen(false);
    setIsEditorOpen(false);
  };

  const handleEditorSaved = async (saved?: CameraEditorSavedResult) => {
    const refreshedCameras = await refreshCameras();
    refreshDashboardSummary();
    if (onboardingStepId === "camera-webcam-save") {
      completeCameraTutorial(findSavedCameraId(refreshedCameras, saved));
    }
  };

  const handleImportSaved = async () => {
    await refreshCameras();
    refreshDashboardSummary();
  };

  const handleDelete = async (cameraId: number) => {
    if (!confirm("Are you sure you want to delete this camera?")) {
      return;
    }

    try {
      const response = await fetch(`/api/cameras/${cameraId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to delete camera (${response.status})`);
      }

      dashboardSummaryStore.removeCameraLocal(cameraId);
      refreshDashboardSummary();
      await refreshCameras();

      if (editorCamera?.id === cameraId) {
        closeEditor();
      }
    } catch (error) {
      console.error("Failed to delete camera:", error);
    }
  };

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

  const handleToggleService = async (camera: CameraType) => {
    if (pendingCameraIds.has(camera.id)) {
      return;
    }

    const isRunning = camera.is_service_running === 1;
    updatePendingCameraState(camera.id, true);

    try {
      const result = await toggleCameraService({
        cameraId: camera.id,
        isRunning,
      });

      if (result.agentsDisabledNoSubscription) {
        setSubscriptionToastCameraId(camera.id);
      }

      if (result.nextRunning === 1) {
        pushToast({
          cameraId: camera.id,
          cameraName:
            result.cameraName ||
            (typeof camera.name === "string" && camera.name.trim()
              ? camera.name.trim()
              : `Camera #${camera.id}`),
          message:
            result.runningAnalytics.length > 0
              ? "The analytics below are active for this camera."
              : "Enable analytics in the Algorithms page to start detections.",
          analytics: result.runningAnalytics,
          type: "camera_started",
        });
      }

      patchCamera(camera.id, {
        is_service_running: result.nextRunning,
      });

      dashboardSummaryStore.patchCameraLocal(camera.id, {
        is_service_running: result.nextRunning,
        ...(result.nextRunning === 0
          ? { thumbnail_url: null, last_thumbnail_update: null }
          : {}),
      });

      refreshDashboardSummary();
      void refreshCameras();
    } catch (error) {
      console.error("Failed to toggle service:", error);
    } finally {
      updatePendingCameraState(camera.id, false);
    }
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
      <div className="max-w-7xl">
        <div className="mb-6 md:mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">{t("cameras.title")}</h1>
            <p className="mt-1.5 text-sm text-gray-400">{t("cameras.subtitle")}</p>
          </div>
        </div>

        <div className="mb-6 md:mb-8">
          <CameraDirectoryControls
            activeTab={activeTab}
            activeSearchTerm={activeSearchTerm}
            activeIndexKey={activeIndexKey}
            activeIndexCounts={activeIndexCounts}
            tabCounts={tabCounts}
            searchInputId="cameras-search"
            onTabChange={setActiveTab}
            onSearchChange={setActiveSearchTerm}
            onIndexChange={setActiveIndexKey}
            actions={
              <>
                <button
                  onClick={openDiscoveryModal}
                  data-onboarding-target={ONBOARDING_TARGETS.camerasScanNetwork}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100 transition-colors hover:border-cyan-400/40 hover:bg-cyan-500/20"
                >
                  <Wifi className="h-4 w-4" />
                  Scan Network
                </button>
                <button
                  onClick={openImportModal}
                  data-onboarding-target={ONBOARDING_TARGETS.camerasImport}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-900/60 px-4 py-2.5 text-sm font-medium text-gray-100 transition-colors hover:border-blue-500/40 hover:bg-gray-800"
                >
                  <FileUp className="h-4 w-4" />
                  Import Cameras
                </button>
                <button
                  onClick={openAddModal}
                  data-onboarding-target={ONBOARDING_TARGETS.camerasRegister}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-medium text-white transition-colors shadow-lg shadow-blue-500/30 hover:bg-blue-600"
                >
                  <Plus className="w-5 h-5" />
                  {t("common.registerCamera")}
                </button>
              </>
            }
          />
        </div>

        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full min-w-[920px] table-fixed">
              <colgroup>
                <col className="w-[38%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[14%]" />
                <col className="w-[11%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead className="bg-gray-800/50 border-b border-gray-700">
                <tr>
                  <th className="px-4 py-4 text-left text-sm font-semibold text-gray-300">
                    {t("cameras.name")}
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-semibold text-gray-300">
                    {t("cameras.ipAddress")}
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-semibold text-gray-300">
                    {t("cameras.manufacturer")}
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-semibold text-gray-300">
                    {t("cameras.description")}
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-semibold text-gray-300">
                    {t("cameras.status")}
                  </th>
                  <th className="px-4 py-4 text-right text-sm font-semibold text-gray-300">
                    {t("cameras.actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filteredCameras.map((camera) => {
                  const connectionState = getCameraConnectionState(camera);
                  const isRunning = isCameraServiceRunning(camera);
                  const isReconnecting = connectionState === "reconnecting";
                  const isOnline = connectionState === "online";

                  return (
                  <tr key={camera.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800">
                          <Camera className="h-5 w-5 text-gray-500" />
                        </div>
                        <span className="truncate font-medium text-gray-200" title={camera.name || undefined}>
                          {camera.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-400 whitespace-nowrap">{camera.ip_address || "-"}</td>
                    <td className="px-4 py-4 text-gray-400 whitespace-nowrap">{camera.manufacturer || "-"}</td>
                    <td className="px-4 py-4 text-gray-400">
                      {camera.description ? (
                        <div className="truncate" title={camera.description}>
                          {camera.description}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          isOnline
                            ? "bg-green-500/10 text-green-400"
                            : isReconnecting
                            ? "bg-amber-500/10 text-amber-300"
                            : "bg-red-500/10 text-red-400"
                        }`}
                        >
                          <Wifi className="w-3 h-3" />
                          {isOnline
                            ? t("dashboard.online")
                            : isReconnecting
                            ? "Reconnecting"
                            : t("dashboard.offline")}
                        </span>
                      </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleToggleService(camera)}
                          disabled={pendingCameraIds.has(camera.id)}
                          aria-busy={pendingCameraIds.has(camera.id)}
                          title={isRunning ? t("dashboard.stop") : t("dashboard.start")}
                          aria-label={isRunning ? t("dashboard.stop") : t("dashboard.start")}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                            isRunning
                              ? "text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                              : "text-green-400 hover:bg-green-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                          }`}
                        >
                          {pendingCameraIds.has(camera.id) ? (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : isRunning ? (
                            <Square className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => openEditModal(camera)}
                          title={t("dashboard.edit")}
                          aria-label={t("dashboard.edit")}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-blue-400 transition-colors hover:bg-blue-500/10"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(camera.id)}
                          title={t("cameras.delete")}
                          aria-label={t("cameras.delete")}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-400 transition-colors hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )})}
                {filteredCameras.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12">
                      <div className="text-center">
                        <Camera className="mx-auto mb-4 h-12 w-12 text-gray-600" />
                        <h3 className="mb-2 text-lg font-semibold text-gray-300">
                          {emptyStateTitle}
                        </h3>
                        <p className="mx-auto max-w-2xl text-sm text-gray-500">
                          {emptyStateDescription}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <CameraEditorModal
        isOpen={isEditorOpen}
        camera={editorCamera}
        draftCamera={!editorCamera ? editorDraft : null}
        existingCameraNames={existingCameraNames}
        onClose={closeEditor}
        onSaved={handleEditorSaved}
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

      <CameraEventToast toasts={toasts} onDismiss={dismissToast} />

      {subscriptionToastCameraId !== null && (
        <CameraStartAttentionToast
          cameraId={subscriptionToastCameraId}
          billingEnabled={billingEnabled}
          onDismiss={() => setSubscriptionToastCameraId(null)}
        />
      )}

      {billingEnabled && showBillingModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-100 mb-4">{t("cameras.billingRequired")}</h2>
              <p className="text-gray-300 mb-6">{t("cameras.billingRequiredDesc")}</p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={closeBillingModal}
                  className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg font-medium transition-colors"
                >
                  {t("cameras.cancel")}
                </button>
                {billingEnabled ? (
                  <Link
                    to="/billing"
                    onClick={closeBillingModal}
                    className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors text-center"
                  >
                    {t("cameras.goToBilling")}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Cameras() {
  const [cameras, setCameras] = useState<CameraType[]>([]);
  const { cameras: dashboardCameras, lastUpdatedAt: dashboardLastUpdatedAt } = useDashboardSummary();

  const patchCamera = useCallback((cameraId: number, patch: Partial<CameraType>) => {
    setCameras((current) =>
      current.map((camera) => (camera.id === cameraId ? { ...camera, ...patch } : camera))
    );
  }, []);

  const refreshCameras = useCallback(async (): Promise<CameraType[]> => {
    try {
      const response = await fetch("/api/cameras", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch cameras (${response.status})`);
      }

      const data = await response.json();
      setCameras(data);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
      return [];
    }
  }, []);

  useEffect(() => {
    void refreshCameras();
  }, [refreshCameras]);

  useEffect(() => {
    if (dashboardLastUpdatedAt === null || !Array.isArray(dashboardCameras)) {
      return;
    }

    setCameras((current) => {
      if (current.length === 0) {
        return current;
      }

      const dashboardCameraById = new Map(
        dashboardCameras.map((camera) => [camera.id, camera] as const)
      );
      let didChange = false;

      const next = current.map((camera) => {
        const dashboardCamera = dashboardCameraById.get(camera.id);
        if (!dashboardCamera) {
          return camera;
        }

        const nextThumbnailUrl =
          typeof dashboardCamera.thumbnail_url === "string" && dashboardCamera.thumbnail_url.trim()
            ? dashboardCamera.thumbnail_url.trim()
            : null;
        const nextThumbnailUpdate =
          typeof dashboardCamera.last_thumbnail_update === "string" &&
          dashboardCamera.last_thumbnail_update.trim()
            ? dashboardCamera.last_thumbnail_update.trim()
            : null;
        const currentThumbnailUrl =
          typeof camera.thumbnail_url === "string" && camera.thumbnail_url.trim()
            ? camera.thumbnail_url.trim()
            : null;
        const currentThumbnailUpdate =
          typeof camera.last_thumbnail_update === "string" && camera.last_thumbnail_update.trim()
            ? camera.last_thumbnail_update.trim()
            : null;

        if (
          camera.is_service_running === dashboardCamera.is_service_running &&
          camera.is_online === dashboardCamera.is_online &&
          currentThumbnailUrl === nextThumbnailUrl &&
          currentThumbnailUpdate === nextThumbnailUpdate
        ) {
          return camera;
        }

        didChange = true;
        return {
          ...camera,
          is_service_running: Number(
            dashboardCamera.is_service_running ?? camera.is_service_running ?? 0
          ),
          is_online: Number(dashboardCamera.is_online ?? camera.is_online ?? 0),
          thumbnail_url: nextThumbnailUrl ?? undefined,
          last_thumbnail_update: nextThumbnailUpdate ?? undefined,
        };
      });

      return didChange ? next : current;
    });
  }, [dashboardCameras, dashboardLastUpdatedAt]);

  return (
    <Layout>
      <EventsProvider cameras={cameras}>
        <CamerasContent
          cameras={cameras}
          refreshCameras={refreshCameras}
          patchCamera={patchCamera}
        />
      </EventsProvider>
    </Layout>
  );
}

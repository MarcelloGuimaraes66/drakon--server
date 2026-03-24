import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Camera, Play, Plus, Square, Wifi } from "lucide-react";
import CameraStartAttentionToast from "@/react-app/components/CameraStartAttentionToast";
import Layout from "@/react-app/components/Layout";
import CameraEditorModal, {
  type CameraEditorCamera,
} from "@/react-app/components/CameraEditorModal";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import { EventsProvider, useEvents } from "@/react-app/contexts/EventsContext";
import { useBillingCheck } from "@/react-app/hooks/useBillingCheck";
import { toggleCameraService } from "@/react-app/utils/cameraService";
import { brand } from "@/shared/brand";
import { Camera as CameraType } from "@/shared/types";

type CamerasContentProps = {
  cameras: CameraType[];
  refreshCameras: () => Promise<void>;
  patchCamera: (cameraId: number, patch: Partial<CameraType>) => void;
};

function CamerasContent({ cameras, refreshCameras, patchCamera }: CamerasContentProps) {
  const { t } = useTranslation();
  const billingEnabled = brand.features.billingEnabled;
  const [searchParams, setSearchParams] = useSearchParams();
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorCamera, setEditorCamera] = useState<CameraEditorCamera | null>(null);
  const [pendingCameraIds, setPendingCameraIds] = useState<Set<number>>(() => new Set());
  const [subscriptionToastCameraId, setSubscriptionToastCameraId] = useState<number | null>(null);
  const { checkBillingForCameraCreation, showBillingModal, closeBillingModal } = useBillingCheck();
  const { toasts, dismissToast } = useEvents();

  const sortedCameras = useMemo(
    () =>
      [...cameras].sort(
        (a, b) => (b.is_service_running ?? 0) - (a.is_service_running ?? 0)
      ),
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

  const openAddModal = async () => {
    const canAdd = await checkBillingForCameraCreation();
    if (!canAdd) {
      return;
    }

    clearEditSearchParam();
    setEditorCamera(null);
    setIsEditorOpen(true);
  };

  const openEditModal = (camera: CameraType, syncSearchParam = true) => {
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

  const closeEditor = () => {
    setIsEditorOpen(false);
    setEditorCamera(null);
    clearEditSearchParam();
  };

  const handleEditorSaved = async () => {
    await refreshCameras();
  };

  const handleDelete = async (cameraId: number) => {
    if (!confirm("Are you sure you want to delete this camera?")) {
      return;
    }

    try {
      await fetch(`/api/cameras/${cameraId}`, { method: "DELETE" });
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

      patchCamera(camera.id, {
        is_service_running: result.nextRunning,
      });

      void refreshCameras();
    } catch (error) {
      console.error("Failed to toggle service:", error);
    } finally {
      updatePendingCameraState(camera.id, false);
    }
  };

  return (
    <>
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 md:mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4 md:mb-0">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-100 mb-2">Cameras</h1>
              <p className="text-sm md:text-base text-gray-400">Manage your security cameras</p>
            </div>
            <button
              onClick={openAddModal}
              className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 md:py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 min-h-[44px] md:min-h-0"
            >
              <Plus className="w-5 h-5" />
              Add Camera
            </button>
          </div>
        </div>

        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto -mx-4 md:mx-0">
            <table className="w-full min-w-[640px]">
              <thead className="bg-gray-800/50 border-b border-gray-700">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Name</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">IP Address</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Manufacturer</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Description</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-300">Status</th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {sortedCameras.map((camera) => (
                  <tr key={camera.id} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
                          <Camera className="w-5 h-5 text-gray-500" />
                        </div>
                        <span className="font-medium text-gray-200">{camera.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-400">{camera.ip_address || "-"}</td>
                    <td className="px-6 py-4 text-gray-400">{camera.manufacturer || "-"}</td>
                    <td className="px-6 py-4 text-gray-400 max-w-xs">
                      {camera.description ? (
                        <div className="truncate" title={camera.description}>
                          {camera.description}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                          camera.is_service_running === 1
                            ? "bg-green-500/10 text-green-400"
                            : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        <Wifi className="w-3 h-3" />
                        {camera.is_service_running === 1 ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleToggleService(camera)}
                          disabled={pendingCameraIds.has(camera.id)}
                          aria-busy={pendingCameraIds.has(camera.id)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                            camera.is_service_running === 1
                              ? "text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                              : "text-green-400 hover:bg-green-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                          }`}
                        >
                          {pendingCameraIds.has(camera.id) ? (
                            t("common.loading")
                          ) : camera.is_service_running === 1 ? (
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
                          onClick={() => openEditModal(camera)}
                          className="px-3 py-1.5 text-sm text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(camera.id)}
                          className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cameras.length === 0 && (
            <div className="text-center py-12 md:py-16">
              <Camera className="w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4" />
              <p className="text-sm md:text-base text-gray-500">No cameras added yet</p>
            </div>
          )}
        </div>
      </div>

      <CameraEditorModal
        isOpen={isEditorOpen}
        camera={editorCamera}
        onClose={closeEditor}
        onSaved={handleEditorSaved}
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

  const patchCamera = useCallback((cameraId: number, patch: Partial<CameraType>) => {
    setCameras((current) =>
      current.map((camera) => (camera.id === cameraId ? { ...camera, ...patch } : camera))
    );
  }, []);

  const refreshCameras = useCallback(async () => {
    try {
      const response = await fetch("/api/cameras", {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch cameras (${response.status})`);
      }

      const data = await response.json();
      setCameras(data);
    } catch (error) {
      console.error("Failed to fetch cameras:", error);
    }
  }, []);

  useEffect(() => {
    void refreshCameras();
  }, [refreshCameras]);

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

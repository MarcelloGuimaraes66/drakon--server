import { CSSProperties, RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  X,
  AlertCircle,
  ShieldAlert,
  AlertTriangle,
  WifiOff,
  Wifi,
  CirclePlay,
  Cpu,
  Clock3,
  Loader2,
  MapPin,
  Radar,
} from "lucide-react";
import { sanitizeAiApiErrorText } from "@/shared/aiApiErrorDisplay";
import type { CameraFindShare } from "@/shared/types";

interface Notification {
  id: number;
  camera_id: number | null;
  type: string;
  title: string;
  message: string | null;
  image_key: string | null;
  video_key: string | null;
  media_type: string | null;
  event_id: number | null;
  created_at: string;
  is_read: number;
}

interface NotificationsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onNotificationsChanged?: () => void;
}

function normalizeCameraFindShare(value: unknown): CameraFindShare | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<CameraFindShare> & Record<string, unknown>;
  const id = Number(row.id || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    owner_public_id: typeof row.owner_public_id === "string" ? row.owner_public_id : "",
    invitee_public_id: typeof row.invitee_public_id === "string" ? row.invitee_public_id : "",
    origin_brand_id: typeof row.origin_brand_id === "string" ? row.origin_brand_id : null,
    owner_local_camera_id: Number(row.owner_local_camera_id || 0),
    camera_name: typeof row.camera_name === "string" ? row.camera_name : "",
    city: typeof row.city === "string" ? row.city : null,
    state_code: typeof row.state_code === "string" ? row.state_code : null,
    country_code: typeof row.country_code === "string" ? row.country_code : "BR",
    status: typeof row.status === "string" ? row.status : "pending",
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    accepted_at: typeof row.accepted_at === "string" ? row.accepted_at : null,
    revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    owner_handle: typeof row.owner_handle === "string" ? row.owner_handle : null,
    owner_email: typeof row.owner_email === "string" ? row.owner_email : null,
    invitee_handle: typeof row.invitee_handle === "string" ? row.invitee_handle : null,
    invitee_email: typeof row.invitee_email === "string" ? row.invitee_email : null,
  };
}

function buildSharedAccountLabel(
  handle?: string | null,
  email?: string | null,
  fallback?: string | null
) {
  const normalizedHandle = typeof handle === "string" ? handle.trim().replace(/^@+/, "") : "";
  if (normalizedHandle) {
    return `@${normalizedHandle}`;
  }
  const normalizedEmail = typeof email === "string" ? email.trim() : "";
  if (normalizedEmail) {
    return normalizedEmail;
  }
  return typeof fallback === "string" ? fallback.trim() : "";
}

function formatSharedLocation(share: CameraFindShare, fallbackLabel: string) {
  const parts = [share.city, share.state_code, share.country_code]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : fallbackLabel;
}

function formatProgramLabel(value?: string | null) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "drakon") return "Drakon";
  if (normalized === "perceptrum") return "Perceptrum";
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export default function NotificationsDropdown({
  isOpen,
  onClose,
  anchorRef,
  onNotificationsChanged,
}: NotificationsDropdownProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [activeSharedInvitation, setActiveSharedInvitation] =
    useState<CameraFindShare | null>(null);
  const [activeSharedInvitationNotification, setActiveSharedInvitationNotification] =
    useState<Notification | null>(null);
  const [isSharedInvitationOpen, setIsSharedInvitationOpen] = useState(false);
  const [isSharedInvitationLoading, setIsSharedInvitationLoading] = useState(false);
  const [sharedInvitationError, setSharedInvitationError] = useState<string | null>(null);
  const [sharedInvitationAction, setSharedInvitationAction] = useState<"accept" | "deny" | null>(
    null
  );

  useEffect(() => {
    if (isOpen) {
      void hydrateNotifications();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const viewportPadding = 16;
      const verticalOffset = 12;

      if (!anchor) {
        setPanelStyle({
          top: 80,
          right: viewportPadding,
          maxHeight: Math.max(240, window.innerHeight - 96),
        });
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const top = Math.max(viewportPadding, Math.round(rect.bottom + verticalOffset));
      const right = Math.max(viewportPadding, Math.round(window.innerWidth - rect.right));
      const maxHeight = Math.max(240, Math.round(window.innerHeight - top - viewportPadding));

      setPanelStyle({
        top,
        right,
        maxHeight,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, isOpen]);

  const fetchNotifications = async () => {
    try {
      const response = await fetch("/api/notifications");
      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    }
  };

  const markAsRead = async () => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      onNotificationsChanged?.();
    } catch (error) {
      console.error("Failed to mark notifications as read:", error);
    }
  };

  const syncSharedInvitationNotifications = async () => {
    try {
      await fetch("/api/shared-find/sync", { method: "POST" });
      onNotificationsChanged?.();
    } catch (error) {
      console.error("Failed to sync shared camera notifications:", error);
    }
  };

  const hydrateNotifications = async () => {
    setIsLoading(true);
    try {
      await syncSharedInvitationNotifications();
      await fetchNotifications();
      await markAsRead();
      await fetchNotifications();
    } finally {
      setIsLoading(false);
    }
  };

  const loadSharedInvitationByShareId = async (shareId: number) => {
    const response = await fetch("/api/shared-find/incoming");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        sanitizeAiApiErrorText(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : typeof data?.sync_error === "string" && data.sync_error.trim()
              ? data.sync_error
              : t("sharedCameraAccess.errors.load")
        )
      );
    }
    const shares = Array.isArray(data?.shares)
      ? data.shares
          .map((row: unknown) => normalizeCameraFindShare(row))
          .filter((row: CameraFindShare | null): row is CameraFindShare => Boolean(row))
      : [];
    return shares.find((share: CameraFindShare) => share.id === shareId) || null;
  };

  const openSharedInvitation = async (notification: Notification) => {
    const shareId = Number(notification.event_id || 0);
    if (!Number.isInteger(shareId) || shareId <= 0) {
      return;
    }

    setActiveSharedInvitation(null);
    setActiveSharedInvitationNotification(notification);
    setSharedInvitationError(null);
    setIsSharedInvitationLoading(true);
    setIsSharedInvitationOpen(true);

    try {
      const share = await loadSharedInvitationByShareId(shareId);
      if (!share || share.status !== "pending") {
        await fetchNotifications();
        onNotificationsChanged?.();
        throw new Error(t("drakonFind.sharedAccess.toast.denyFailed"));
      }
      setActiveSharedInvitation(share);
    } catch (error) {
      setSharedInvitationError(
        sanitizeAiApiErrorText(
          error instanceof Error && error.message
            ? error.message
            : t("sharedCameraAccess.errors.load")
        )
      );
    } finally {
      setIsSharedInvitationLoading(false);
    }
  };

  const closeSharedInvitation = () => {
    setIsSharedInvitationOpen(false);
    setActiveSharedInvitation(null);
    setActiveSharedInvitationNotification(null);
    setSharedInvitationError(null);
    setSharedInvitationAction(null);
  };

  const handleSharedInvitationAction = async (action: "accept" | "deny") => {
    if (!activeSharedInvitation) return;

    const fallbackErrorMessage =
      action === "accept"
        ? t("drakonFind.sharedAccess.toast.acceptFailed")
        : t("drakonFind.sharedAccess.toast.denyFailed");

    setSharedInvitationAction(action);
    setSharedInvitationError(null);
    try {
      const response = await fetch(`/api/shared-find/shares/${activeSharedInvitation.id}/${action}`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          sanitizeAiApiErrorText(
            typeof data?.error === "string" && data.error.trim() ? data.error : fallbackErrorMessage
          )
        );
      }
      await fetchNotifications();
      onNotificationsChanged?.();
      closeSharedInvitation();
    } catch (error) {
      setSharedInvitationError(
        sanitizeAiApiErrorText(
          error instanceof Error && error.message ? error.message : fallbackErrorMessage
        )
      );
    } finally {
      setSharedInvitationAction(null);
    }
  };

  const getNotificationIcon = (type: string) => {
    if (type === "ai_detection") {
      return <ShieldAlert className="w-5 h-5 text-red-400" />;
    }
    if (type === "camera_connection_failed") {
      return <WifiOff className="w-5 h-5 text-orange-300" />;
    }
    if (type === "camera_online") {
      return <Wifi className="w-5 h-5 text-emerald-300" />;
    }
    if (type === "job_staled") {
      return <AlertTriangle className="w-5 h-5 text-amber-400" />;
    }
    if (type === "job_start_blocked") {
      return <AlertCircle className="w-5 h-5 text-amber-300" />;
    }
    if (type === "job_step_start_blocked") {
      return <AlertCircle className="w-5 h-5 text-amber-300" />;
    }
    if (type === "job_started") {
      return <CirclePlay className="w-5 h-5 text-emerald-400" />;
    }
    if (type === "camera_start_blocked") {
      return <Cpu className="w-5 h-5 text-amber-300" />;
    }
    if (type === "agent_api_error") {
      return <Cpu className="w-5 h-5 text-rose-400" />;
    }
    if (type === "shared_find_invitation") {
      return <Radar className="w-5 h-5 text-amber-300" />;
    }
    return <AlertCircle className="w-5 h-5 text-blue-400" />;
  };

  const getNotificationRowClass = (type: string) => {
    if (type === "ai_detection") return "bg-red-500/5";
    if (type === "camera_connection_failed") return "bg-orange-500/5";
    if (type === "camera_online") return "bg-emerald-500/5";
    if (type === "job_staled" || type === "job_start_blocked" || type === "job_step_start_blocked")
      return "bg-amber-500/5";
    if (type === "camera_start_blocked") return "bg-amber-500/5";
    if (type === "job_started") return "bg-emerald-500/5";
    if (type === "agent_api_error") return "bg-rose-500/5";
    if (type === "shared_find_invitation") return "bg-amber-500/5";
    return "";
  };

  const getNotificationBadge = (
    type: string,
  ): { label: string; className: string } | null => {
    if (type === "ai_detection") {
      return {
        label: "Alert",
        className: "bg-red-500/20 text-red-400",
      };
    }
    if (type === "camera_connection_failed") {
      return {
        label: "Camera",
        className: "bg-orange-500/20 text-orange-300",
      };
    }
    if (type === "camera_online") {
      return {
        label: "Camera",
        className: "bg-emerald-500/20 text-emerald-300",
      };
    }
    if (
      type === "job_staled" ||
      type === "job_start_blocked" ||
      type === "job_step_start_blocked" ||
      type === "job_started"
    ) {
      return {
        label: "Job",
        className:
          type === "job_started"
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-amber-500/20 text-amber-300",
      };
    }
    if (type === "camera_start_blocked") {
      return {
        label: "Camera",
        className: "bg-amber-500/20 text-amber-300",
      };
    }
    if (type === "agent_api_error") {
      return {
        label: "AI",
        className: "bg-rose-500/20 text-rose-300",
      };
    }
    if (type === "shared_find_invitation") {
      return {
        label: "Share",
        className: "bg-amber-500/20 text-amber-200",
      };
    }
    return null;
  };

  const getNotificationTarget = (notification: Notification) => {
    if (notification.type === "ai_detection" && notification.event_id) {
      return `/events?type=detection&eventId=${notification.event_id}`;
    }
    if (
      notification.type === "camera_connection_failed" ||
      notification.type === "camera_online" ||
      notification.type === "camera_start_blocked"
    ) {
      return "/cameras";
    }
    if (
      notification.type === "job_staled" ||
      notification.type === "job_start_blocked" ||
      notification.type === "job_step_start_blocked" ||
      notification.type === "job_started"
    ) {
      return "/jobs";
    }
    if (notification.type === "agent_api_error") {
      return notification.camera_id ? "/ai-agents" : "/jobs";
    }
    return null;
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t("notifications.justNow");
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getMediaUrl = (key: string | null) => {
    if (!key) return null;
    return `/api/detections/${key}`;
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark this notification as read
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notification.id] }),
      });
      onNotificationsChanged?.();
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }

    if (notification.type === "shared_find_invitation") {
      await openSharedInvitation(notification);
      return;
    }

    const target = getNotificationTarget(notification);
    if (target) {
      onClose();
      navigate(target);
    }
  };

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100]"
        onClick={onClose}
      />

      {/* Dropdown panel */}
      <div
        className="fluent-flyout fixed z-[101] flex w-96 max-w-[calc(100vw-2rem)] flex-col rounded-lg border"
        style={panelStyle}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold text-gray-100">{t("notifications.title")}</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">
              {t("notifications.loading")}
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">{t("notifications.noNotifications")}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {notifications.map((notification) => {
                const badge = getNotificationBadge(notification.type);
                const target = getNotificationTarget(notification);
                const isClickable =
                  notification.type === "shared_find_invitation"
                    ? Number(notification.event_id || 0) > 0
                    : !!target;
                const displayTitle = sanitizeAiApiErrorText(notification.title);
                const displayMessage = notification.message
                  ? sanitizeAiApiErrorText(notification.message)
                  : null;

                return (
                <div
                  key={notification.id}
                  onClick={() => isClickable && handleNotificationClick(notification)}
                  className={`p-4 transition-colors ${
                    isClickable
                      ? "cursor-pointer hover:bg-gray-800/50"
                      : "cursor-default"
                  } ${getNotificationRowClass(notification.type)}`}
                >
                  <div className="flex gap-3">
                    {/* Icon, thumbnail, or video preview */}
                    <div className="flex-shrink-0">
                      {notification.media_type === "video" && notification.video_key ? (
                        <video
                          src={getMediaUrl(notification.video_key)!}
                          className="w-12 h-12 rounded-lg object-cover"
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          onError={(e) => {
                            // Fallback to icon on error
                            const video = e.target as HTMLVideoElement;
                            const parent = video.parentElement;
                            if (parent) {
                              video.style.display = 'none';
                              const placeholder = document.createElement('div');
                              placeholder.className = 'w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center';
                              placeholder.innerHTML = '<svg class="w-5 h-5 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                              parent.appendChild(placeholder);
                            }
                          }}
                        />
                      ) : notification.image_key ? (
                        <img
                          src={getMediaUrl(notification.image_key)!}
                          alt="Detection"
                          className="w-12 h-12 rounded-lg object-cover"
                          onError={(e) => {
                            // Fallback to icon on error
                            const img = e.target as HTMLImageElement;
                            const parent = img.parentElement;
                            if (parent) {
                              img.style.display = 'none';
                              const placeholder = document.createElement('div');
                              placeholder.className = 'w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center';
                              placeholder.innerHTML = '<svg class="w-5 h-5 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                              parent.appendChild(placeholder);
                            }
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center">
                          {getNotificationIcon(notification.type)}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-semibold text-gray-100">
                          {displayTitle}
                        </h4>
                        {badge && (
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>

                      {displayMessage ? (
                        <p className="text-sm text-gray-300 mb-1">
                          {displayMessage}
                        </p>
                      ) : null}

                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock3 className="w-3 h-3" />
                        <span>
                          {formatTimestamp(notification.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>

      {isSharedInvitationOpen ? (
        <div className="fluent-modal-backdrop fixed inset-0 z-[102] flex items-center justify-center px-4 py-6">
          <div className="fluent-modal-panel w-full max-w-lg rounded-lg border p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="fluent-status-warning inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]">
                  <Radar className="h-3.5 w-3.5" />
                  {t("sharedCameraAccess.title")}
                </div>
                <h3 className="mt-3 text-lg font-semibold text-gray-100">
                  {sanitizeAiApiErrorText(
                    activeSharedInvitationNotification?.title ||
                      t("drakonFind.sharedAccess.pending.title")
                  )}
                </h3>
                {activeSharedInvitationNotification?.message ? (
                  <p className="mt-2 text-sm leading-6 text-gray-300">
                    {sanitizeAiApiErrorText(activeSharedInvitationNotification.message)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeSharedInvitation}
                className="fluent-toolbar-button rounded-lg border p-2 transition-colors"
                aria-label={t("jobs.promptEditor.closePromptEditorAria")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isSharedInvitationLoading ? (
              <div className="flex min-h-[180px] items-center justify-center text-gray-300">
                <Loader2 className="mr-3 h-5 w-5 animate-spin" />
                <span>{t("notifications.loading")}</span>
              </div>
            ) : activeSharedInvitation ? (
              <div className="space-y-4">
                <div className="fluent-panel rounded-lg border p-4">
                  <p className="text-sm font-medium text-gray-100">
                    {activeSharedInvitation.camera_name || t("drakonFind.generic.unnamedCamera")}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {formatSharedLocation(
                      activeSharedInvitation,
                      t("drakonFind.sharedAccess.fields.locationUnavailable")
                    )}
                  </p>
                  <p className="mt-2 text-xs text-gray-500 break-all">
                    {t("drakonFind.sharedAccess.fields.sharedBy")}{" "}
                    {buildSharedAccountLabel(
                      activeSharedInvitation.owner_handle,
                      activeSharedInvitation.owner_email,
                      activeSharedInvitation.owner_public_id
                    )}
                  </p>
                  {activeSharedInvitation.origin_brand_id ? (
                    <div className="fluent-status-warning mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                      <MapPin className="h-3.5 w-3.5" />
                      {formatProgramLabel(activeSharedInvitation.origin_brand_id)}
                    </div>
                  ) : null}
                </div>

                {sharedInvitationError ? (
                  <div className="fluent-status-danger rounded-lg border px-4 py-3 text-sm">
                    {sharedInvitationError}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSharedInvitationAction("deny")}
                    disabled={sharedInvitationAction !== null}
                    className="fluent-toolbar-button rounded-lg border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sharedInvitationAction === "deny"
                      ? t("drakonFind.sharedAccess.actions.working")
                      : t("drakonFind.sharedAccess.actions.deny")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSharedInvitationAction("accept")}
                    disabled={sharedInvitationAction !== null}
                    className="fluent-primary-button rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sharedInvitationAction === "accept"
                      ? t("drakonFind.sharedAccess.actions.working")
                      : t("drakonFind.sharedAccess.actions.accept")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="fluent-status-danger rounded-lg border px-4 py-3 text-sm">
                  {sharedInvitationError || t("sharedCameraAccess.errors.load")}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeSharedInvitation}
                    className="fluent-toolbar-button rounded-lg border px-4 py-2 text-sm transition-colors"
                  >
                    {t("jobs.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
    ,
    document.body
  );
}

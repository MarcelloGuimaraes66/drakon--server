import Layout from "@/react-app/components/Layout";
import { useDashboardSummary } from "@/react-app/lib/DashboardSummaryStore";
import { EventsProvider, useEvents } from "@/react-app/contexts/EventsContext";
import { useDashboardAlertRefresh } from "@/react-app/hooks/useDashboardAlertRefresh";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import Toast from "@/react-app/components/Toast";
import ConfirmDialog from "@/react-app/components/ConfirmDialog";
import { Camera, Activity, AlertCircle, AlertTriangle, Layers, CheckCircle, Clock, Zap, Bell, Command, StopCircle, ChevronDown, ChevronLeft, ChevronRight, Loader2, Circle, ListChecks, Calendar, Search, Play, X, MapPin, Sparkles, PhoneCall, FileText, XCircle, Download, LayoutGrid, Maximize2 } from "lucide-react";
import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function timeAgo(isoString: string | null): string {
  if (!isoString) return "--";
  const now = new Date().getTime();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

function getAlbumMosaicLayout(totalImages: number) {
  const previewCount = Math.max(0, Math.min(totalImages, 16));

  if (previewCount <= 1) return { previewCount, columns: 1, rows: 1 };
  if (previewCount === 2) return { previewCount, columns: 2, rows: 1 };
  if (previewCount === 3) return { previewCount, columns: 3, rows: 1 };
  if (previewCount === 4) return { previewCount, columns: 2, rows: 2 };
  if (previewCount <= 6) return { previewCount, columns: 3, rows: 2 };
  if (previewCount <= 9) return { previewCount, columns: 3, rows: 3 };
  if (previewCount <= 12) return { previewCount, columns: 4, rows: 3 };
  return { previewCount, columns: 4, rows: 4 };
}

function readAlertLabelString(...values: any[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function buildAlertGroupKey(alert: any): string {
  const details = alert?.details || {};
  const eventType = String(alert?.event_type || "").trim().toLowerCase() || "unknown";
  const rawCameraId = Number(
    alert?.camera_id ??
      details?.camera_id ??
      details?.cameraId,
  );
  const cameraToken =
    Number.isInteger(rawCameraId) && rawCameraId > 0 ? String(rawCameraId) : "na";
  const agentToken = (
    readAlertLabelString(
      details?.agent_key,
      details?.agentKey,
      alert?.algo_type,
      details?.algo_type,
      details?.algoType,
    ) || "unknown-agent"
  ).toLowerCase();
  const groupToken = (
    readAlertLabelString(
      details?.group_name,
      details?.groupName,
      alert?.group_name,
      alert?.groupName,
    ) || "na"
  ).toLowerCase();
  const executionToken = (
    readAlertLabelString(
      details?.execution_id,
      details?.executionId,
      details?.run_id,
      details?.runId,
      details?.runtime_id,
      details?.runtimeId,
      details?.fire_key,
      details?.fireKey,
      details?.schedule_fire_id,
      details?.scheduleFireId,
      details?.job_started_at_utc,
      details?.jobStartedAtUtc,
      details?.started_at_utc,
      details?.startedAtUtc,
    ) || "active"
  ).toLowerCase();

  if (eventType === "job_alert_triggered") {
    const rawJobId = Number(details?.job_id ?? details?.jobId ?? details?.job?.id);
    const rawStepId = Number(
      details?.step_id ??
        details?.stepId ??
        details?.step_order ??
        details?.stepOrder,
    );
    const jobToken =
      Number.isInteger(rawJobId) && rawJobId > 0
        ? String(rawJobId)
        : (readAlertLabelString(details?.job_name, details?.job?.name) || "na").toLowerCase();
    const stepToken =
      Number.isInteger(rawStepId) && rawStepId > 0
        ? String(rawStepId)
        : (readAlertLabelString(details?.step_name, details?.stepName) || "na").toLowerCase();

    return [
      "job",
      jobToken,
      stepToken,
      agentToken,
      cameraToken,
      groupToken,
      executionToken,
    ].join("::");
  }

  return ["ai", cameraToken, agentToken, groupToken, executionToken].join("::");
}

function KpiCard({ icon: Icon, label, value, subtext, color = "blue" }: {
  icon: any;
  label: string;
  value: string | number;
  subtext?: string;
  color?: string;
}) {
  const colorClasses = {
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/30",
    green: "from-green-500/20 to-green-600/10 border-green-500/30",
    purple: "from-purple-500/20 to-purple-600/10 border-purple-500/30",
    orange: "from-orange-500/20 to-orange-600/10 border-orange-500/30",
    red: "from-red-500/20 to-red-600/10 border-red-500/30",
    yellow: "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30",
    teal: "from-teal-500/20 to-teal-600/10 border-teal-500/30",
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses] || colorClasses.blue} border rounded-lg p-4 backdrop-blur-sm`}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-gray-400 text-sm font-medium">{label}</div>
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      {subtext && <div className="text-xs text-gray-400">{subtext}</div>}
    </div>
  );
}

function DashboardContent() {
  const { t, i18n } = useTranslation();
  const { cameras, dashboard, refresh } = useDashboardSummary();
  const { toasts: cameraEventToasts, dismissToast: dismissCameraEventToast } = useEvents();
  useDashboardAlertRefresh(refresh);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "warning" | "info" } | null>(null);
  const [stoppingJobs, setStoppingJobs] = useState<Set<number>>(new Set());
  const [expandedJobs, setExpandedJobs] = useState<Set<number>>(new Set());
  const [alertsSearchTerm, setAlertsSearchTerm] = useState("");
  const [alertsFilter, setAlertsFilter] = useState("ALL");
  const [activeAlert, setActiveAlert] = useState<any | null>(null);
  const [activeAlertGroupKey, setActiveAlertGroupKey] = useState<string | null>(null);
  const [isAlertPanelOpen, setIsAlertPanelOpen] = useState(false);
  const [isDeletingFalsePositive, setIsDeletingFalsePositive] = useState(false);
  const [isFalsePositiveConfirmOpen, setIsFalsePositiveConfirmOpen] = useState(false);
  const [removedAlertIds, setRemovedAlertIds] = useState<Set<number>>(new Set());
  const [isGroupAlbumOpen, setIsGroupAlbumOpen] = useState(false);
  const [groupAlbumImages, setGroupAlbumImages] = useState<any[]>([]);
  const [groupAlbumIndex, setGroupAlbumIndex] = useState(0);
  const [groupAlbumLabel, setGroupAlbumLabel] = useState("");
  const [isAlertMediaPreviewOpen, setIsAlertMediaPreviewOpen] = useState(false);
  const [alertMediaPreview, setAlertMediaPreview] = useState<{
    url: string;
    isVideo: boolean;
    label: string;
  } | null>(null);
  const [alertsCompactMode, setAlertsCompactMode] = useState(false);
  const [alertPanelFocusTarget, setAlertPanelFocusTarget] = useState<"emitted-alerts" | null>(null);
  const [highlightEmittedAlerts, setHighlightEmittedAlerts] = useState(false);
  const emittedAlertsSectionRef = useRef<HTMLDivElement | null>(null);

  const stats = dashboard?.stats;
  const perCamera = dashboard?.perCamera || {};
  const jobs = dashboard?.jobs;
  const activity = dashboard?.activity;
  const panelPriorityLabels: Record<string, string> = {
    CRITIC: t("dashboard.alertFilters.critic").toUpperCase(),
    HIGH: t("dashboard.alertFilters.high").toUpperCase(),
    MEDIUM: t("dashboard.alertFilters.medium").toUpperCase(),
    LOW: t("dashboard.alertFilters.low").toUpperCase(),
  };
  const panelPriorityBarClasses: Record<string, string> = {
    CRITIC: "bg-red-500",
    HIGH: "bg-orange-500",
    MEDIUM: "bg-yellow-500",
    LOW: "bg-green-500",
  };
  const panelPriorityTextClasses: Record<string, string> = {
    CRITIC: "text-red-400",
    HIGH: "text-orange-400",
    MEDIUM: "text-yellow-400",
    LOW: "text-green-400",
  };
  const panelPriorityWidths: Record<string, string> = {
    CRITIC: "100%",
    HIGH: "75%",
    MEDIUM: "50%",
    LOW: "25%",
  };
  const activeAlertEventType = String(activeAlert?.event_type || "").trim().toLowerCase();
  const activeAlertIsJobTriggered = activeAlertEventType === "job_alert_triggered";
  const activeAlertCanBeDeleted =
    activeAlertEventType === "job_alert_triggered" || activeAlertEventType === "ai_detection";

  const openAlertPanel = (
    alert: any,
    groupKey?: string | null,
    options?: { focusEmittedAlerts?: boolean },
  ) => {
    setActiveAlert(alert);
    setActiveAlertGroupKey(groupKey || buildAlertGroupKey(alert));
    setAlertPanelFocusTarget(options?.focusEmittedAlerts ? "emitted-alerts" : null);
    setHighlightEmittedAlerts(false);
    setIsAlertPanelOpen(true);
  };

  const closeAlertPanel = () => {
    setIsAlertPanelOpen(false);
    setActiveAlert(null);
    setActiveAlertGroupKey(null);
    setAlertPanelFocusTarget(null);
    setHighlightEmittedAlerts(false);
    setIsFalsePositiveConfirmOpen(false);
  };

  const requestDeleteFalsePositive = () => {
    if (!activeAlert || isDeletingFalsePositive) return;
    const eventId = Number(activeAlert?.id);
    const eventType = String(activeAlert?.event_type || "").trim().toLowerCase();

    if (!Number.isInteger(eventId) || eventId <= 0) {
      setToast({ message: t("dashboard.invalidAlertId"), type: "error" });
      return;
    }
    if (eventType !== "job_alert_triggered" && eventType !== "ai_detection") {
      setToast({ message: "Only dashboard alert events can be deleted here.", type: "warning" });
      return;
    }

    setIsFalsePositiveConfirmOpen(true);
  };

  const handleDeleteFalsePositive = async () => {
    if (!activeAlert || isDeletingFalsePositive) return;
    const eventId = Number(activeAlert?.id);

    setIsFalsePositiveConfirmOpen(false);
    setIsDeletingFalsePositive(true);
    try {
      const response = await fetch(`/api/events/${eventId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        setToast({
          message: error?.error || t("dashboard.falsePositiveDeleteFailed"),
          type: "error",
        });
        return;
      }

      setRemovedAlertIds((prev) => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });
      closeAlertPanel();
      setToast({ message: t("dashboard.falsePositiveDeleted"), type: "success" });
      // Keep store synced in background; UI removal happens immediately via local state.
      refresh();
    } catch (error) {
      console.error("Failed to delete false positive alert:", error);
      setToast({ message: t("dashboard.falsePositiveDeleteFailed"), type: "error" });
    } finally {
      setIsDeletingFalsePositive(false);
    }
  };

  const getAlertMedia = (alert: any) => {
    if (!alert) return { mediaUrl: null, isVideo: false, albumImages: [] as any[] };
    const details = alert.details || {};
    const clipPath = alert.clip_url || details.clip_path || details.clipPath || null;
    const imagePath = alert.image_path || details.image_path || details.imagePath || null;
    const readString = (...values: any[]): string | null => {
      for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      return null;
    };
    const buildMediaUrl = (value: string | null) => {
      if (!value) return null;
      if (
        value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.startsWith("/")
      ) {
        return value;
      }
      const filename = value.split(/[\\/]/).pop();
      return filename ? `/api/detections/${filename}` : null;
    };
    const readBoolean = (...values: any[]): boolean => {
      for (const value of values) {
        if (value === true) return true;
        if (value === false) continue;
        if (typeof value === "number" && value === 1) return true;
        if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
      }
      return false;
    };
    const rawGroupImages = Array.isArray(details.group_image_urls)
      ? details.group_image_urls
      : Array.isArray(alert.group_image_urls)
      ? alert.group_image_urls
      : [];
    const albumImages = rawGroupImages
      .map((entry: any, index: number) => {
        if (!entry) return null;
        if (typeof entry === "string") {
          const url = buildMediaUrl(entry);
          return url
            ? {
                url,
                cameraName: null,
                cameraId: null,
                isOfflinePlaceholder: false,
                key: `group-${index}`,
              }
            : null;
        }
        if (typeof entry !== "object") return null;
        const url = buildMediaUrl(
          readString(
            entry.image_url,
            entry.imageUrl,
            entry.url,
            entry.media_url,
            entry.mediaUrl,
            typeof entry.image_key === "string" ? `/api/detections/${entry.image_key}` : null,
            typeof entry.imageKey === "string" ? `/api/detections/${entry.imageKey}` : null
          )
        );
        const isOfflinePlaceholder = readBoolean(
          entry.is_offline_placeholder,
          entry.isOfflinePlaceholder,
          entry.offline_placeholder,
          entry.offlinePlaceholder
        );
        if (!url && !isOfflinePlaceholder) return null;
        const temporalEvidenceKey = readString(
          entry.temporal_evidence_key,
          entry.temporalEvidenceKey
        );
        const imageKey = readString(entry.image_key, entry.imageKey);
        const timestampName = readString(entry.timestamp_name, entry.timestampName);
        const snapshotUtcIso = readString(
          entry.snapshot_ts_utc_iso,
          entry.snapshotTsUtcIso,
          entry.snapshot_ts_local_iso,
          entry.snapshotTsLocalIso
        );
        const eventName = readString(entry.event);
        const entityId = readString(entry.entity_id, entry.entityId);
        const frameIndexRaw = Number(entry.frame_index ?? entry.frameIndex);
        const frameIndex = Number.isFinite(frameIndexRaw) ? frameIndexRaw : null;
        const keyParts = [
          temporalEvidenceKey ? `evidence:${temporalEvidenceKey}` : null,
          imageKey ? `image:${imageKey}` : null,
          timestampName ? `timestamp:${timestampName}` : null,
          snapshotUtcIso ? `snapshot:${snapshotUtcIso}` : null,
          eventName ? `event:${eventName}` : null,
          entityId ? `entity:${entityId}` : null,
          frameIndex !== null ? `frame:${frameIndex}` : null,
          `index:${index}`,
        ].filter(Boolean);
        return {
          url: url || null,
          cameraName: readString(entry.camera_name, entry.cameraName),
          cameraId: entry.camera_id ?? entry.cameraId ?? null,
          isOfflinePlaceholder,
          temporalEvidenceKey,
          imageKey,
          timestampName,
          key: `group-${keyParts.join("|")}`,
        };
      })
      .filter(Boolean);
    const primaryAlbumUrl =
      albumImages.find((entry: any) => typeof entry?.url === "string" && entry.url.trim())?.url || null;
    const mediaUrlRaw =
      alert.video_url ||
      details.video_url ||
      details.videoUrl ||
      buildMediaUrl(clipPath) ||
      (alert.video_key ? `/api/detections/${alert.video_key}` : null) ||
      alert.image_url ||
      details.image_url ||
      details.imageUrl ||
      buildMediaUrl(imagePath) ||
      (alert.image_key ? `/api/detections/${alert.image_key}` : null) ||
      primaryAlbumUrl;
    const mediaUrl = typeof mediaUrlRaw === "string" ? mediaUrlRaw.trim() : "";
    const isVideo = mediaUrl
      ? mediaUrl.toLowerCase().endsWith(".mp4") || mediaUrl.toLowerCase().includes("/api/job-clips/")
      : false;
    return { mediaUrl, isVideo, albumImages };
  };

  const getAlertTimestampMs = (alert: any) => {
    return (
      Date.parse(String(alert?.detected_at || alert?.created_at || "")) || 0
    );
  };

  const getAlertContributingEventsCount = (alert: any) => {
    const explicitCount = Number(
      alert?.details?.contributing_events_count ?? alert?.contributing_events_count
    );
    if (Number.isFinite(explicitCount) && explicitCount > 0) {
      return explicitCount;
    }

    const operatorResults = Array.isArray(alert?.details?.temporal_operator_results)
      ? alert.details.temporal_operator_results
      : [];
    const seen = new Set<string>();

    const readContributionString = (...values: any[]) => {
      for (const value of values) {
        if (typeof value !== "string") continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      return null;
    };

    operatorResults.forEach((result: any) => {
      if (!result || typeof result !== "object") return;
      const contributingEvents = Array.isArray(result.contributing_events)
        ? result.contributing_events
        : [];
      contributingEvents.forEach((entry: any, index: number) => {
        if (!entry || typeof entry !== "object") return;
        const temporalEvidenceKey = readContributionString(
          entry.temporal_evidence_key,
          entry.temporalEvidenceKey
        );
        const imageKey = readContributionString(entry.image_key, entry.imageKey);
        const timestampName = readContributionString(entry.timestamp_name, entry.timestampName);
        const snapshotUtcIso = readContributionString(
          entry.snapshot_ts_utc_iso,
          entry.snapshotTsUtcIso,
          entry.ts_utc,
          entry.tsUtc
        );
        const eventName = readContributionString(entry.event);
        const entityId = readContributionString(entry.entity_id, entry.entityId);
        const frameIndexRaw = Number(entry.frame_index ?? entry.frameIndex);
        const frameIndex = Number.isFinite(frameIndexRaw) ? frameIndexRaw : null;
        const keyParts = [
          temporalEvidenceKey ? `evidence:${temporalEvidenceKey}` : null,
          imageKey ? `image:${imageKey}` : null,
          timestampName ? `timestamp:${timestampName}` : null,
          snapshotUtcIso ? `snapshot:${snapshotUtcIso}` : null,
          eventName ? `event:${eventName}` : null,
          entityId ? `entity:${entityId}` : null,
          frameIndex !== null ? `frame:${frameIndex}` : null,
          `index:${index}`,
        ].filter(Boolean);
        seen.add(`contribution-${keyParts.join("|")}`);
      });
    });

    return seen.size;
  };

  const getAlertGroupImageCount = (alert: any) => {
    const explicitCount = Number(alert?.details?.group_image_count ?? alert?.group_image_count);
    if (Number.isFinite(explicitCount) && explicitCount > 0) {
      return explicitCount;
    }
    return getAlertMedia(alert).albumImages.length;
  };

  const selectGroupMediaAlert = (alertsList: any[]) => {
    let bestAlert: any | null = null;
    let bestGroupImageCount = -1;
    let bestContributingEventsCount = -1;
    let bestTimestampMs = -1;

    for (const candidate of alertsList) {
      const candidateMedia = getAlertMedia(candidate);
      const hasMedia =
        Boolean(candidateMedia.mediaUrl) || candidateMedia.albumImages.length > 0;
      if (!hasMedia) continue;

      const candidateGroupImageCount = getAlertGroupImageCount(candidate);
      const candidateContributingEventsCount = getAlertContributingEventsCount(candidate);
      const candidateTimestampMs = getAlertTimestampMs(candidate);

      const isBetter =
        candidateGroupImageCount > bestGroupImageCount ||
        (candidateGroupImageCount === bestGroupImageCount &&
          candidateContributingEventsCount > bestContributingEventsCount) ||
        (candidateGroupImageCount === bestGroupImageCount &&
          candidateContributingEventsCount === bestContributingEventsCount &&
          candidateTimestampMs > bestTimestampMs);

      if (isBetter) {
        bestAlert = candidate;
        bestGroupImageCount = candidateGroupImageCount;
        bestContributingEventsCount = candidateContributingEventsCount;
        bestTimestampMs = candidateTimestampMs;
      }
    }

    return bestAlert;
  };

  const getAlertDownloadTarget = (mediaUrl: string | null, albumImages: any[]): string | null => {
    if (mediaUrl && typeof mediaUrl === "string" && mediaUrl.trim()) {
      return mediaUrl.trim();
    }
    const firstAlbumImage = Array.isArray(albumImages)
      ? albumImages.find((entry: any) => typeof entry?.url === "string" && entry.url.trim())
      : null;
    if (firstAlbumImage?.url) {
      return String(firstAlbumImage.url).trim();
    }
    return null;
  };

  const buildAlertDownloadFileName = (url: string, alert: any): string => {
    const fallbackId = Number(alert?.id) || Date.now();
    const safeId = Number.isFinite(fallbackId) ? fallbackId : Date.now();
    const nowIso = new Date().toISOString().replace(/[:.]/g, "-");
    const pathname = url.split("?")[0];
    const rawExtension = pathname.includes(".") ? pathname.split(".").pop() : "";
    const extension = rawExtension && /^[a-zA-Z0-9]{2,5}$/.test(rawExtension) ? rawExtension : "jpg";
    return `alert_${safeId}_${nowIso}.${extension}`;
  };

  const resolveDownloadUrl = (url: string, alert: any): string => {
    const details = alert?.details || {};
    const preferredKeyRaw =
      (typeof details?.video_key === "string" && details.video_key.trim()) ||
      (typeof alert?.video_key === "string" && alert.video_key.trim()) ||
      (typeof details?.image_key === "string" && details.image_key.trim()) ||
      (typeof alert?.image_key === "string" && alert.image_key.trim()) ||
      "";

    if (preferredKeyRaw) {
      const encodedKey = preferredKeyRaw
        .split("/")
        .map((segment: string) => encodeURIComponent(segment))
        .join("/");
      return `/api/media-download/${encodedKey}`;
    }

    try {
      const parsed = new URL(url, window.location.origin);
      const localPath = parsed.origin === window.location.origin
        ? `${parsed.pathname}${parsed.search}`
        : null;
      const targetPath = localPath || url;
      const isLocalMediaPath =
        targetPath.startsWith("/api/detections/") ||
        targetPath.startsWith("/api/job-clips/") ||
        targetPath.startsWith("/api/job-images/");
      if (isLocalMediaPath) {
        const separator = targetPath.includes("?") ? "&" : "?";
        return `${targetPath}${separator}download=1`;
      }
    } catch {
      // Keep original URL if parsing fails.
    }

    return url;
  };

  const handleDownloadAlertMedia = (url: string | null, alert: any) => {
    if (!url) return;

    const resolvedUrl = resolveDownloadUrl(url, alert);
    const isSameOriginPath = resolvedUrl.startsWith("/");

    const anchor = document.createElement("a");
    anchor.href = resolvedUrl;
    anchor.rel = "noopener noreferrer";
    if (isSameOriginPath) {
      anchor.download = buildAlertDownloadFileName(resolvedUrl, alert);
    } else {
      anchor.target = "_blank";
    }
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  };

  const openGroupAlbum = (alert: any, startIndex = 0) => {
    const { albumImages } = getAlertMedia(alert);
    if (!albumImages.length) return;

    const clampedStart = Math.max(0, Math.min(startIndex, albumImages.length - 1));
    const details = alert?.details || {};
    const rawGroupName =
      details.group_name ||
      details.groupName ||
      alert?.group_name ||
      alert?.groupName ||
      "";
    const normalizedGroupName = typeof rawGroupName === "string" ? rawGroupName.trim() : "";
    const groupLabel = normalizedGroupName
      ? `${t("dashboard.groupPrefix")}: ${normalizedGroupName.replace(/^group\s*:\s*/i, "")}`
      : t("dashboard.groupAlert");

    setGroupAlbumImages(albumImages);
    setGroupAlbumIndex(clampedStart);
    setGroupAlbumLabel(groupLabel);
    setIsGroupAlbumOpen(true);
  };

  const closeGroupAlbum = () => {
    setIsGroupAlbumOpen(false);
  };

  const openAlertMediaPreview = (alert: any) => {
    const { mediaUrl, isVideo } = getAlertMedia(alert);
    if (!mediaUrl) return;

    const details = alert?.details || {};
    const label =
      details.camera_name ||
      alert?.camera_name ||
      details.agent_key ||
      alert?.algo_type ||
      t("dashboard.alertDetails");

    setAlertMediaPreview({
      url: mediaUrl,
      isVideo,
      label: String(label || t("dashboard.alertDetails")),
    });
    setIsAlertMediaPreviewOpen(true);
  };

  const openAlertMediaGallery = (alert: any) => {
    const { mediaUrl, albumImages } = getAlertMedia(alert);
    if (albumImages.length > 1) {
      openGroupAlbum(alert, 0);
      return;
    }
    if (mediaUrl) {
      openAlertMediaPreview(alert);
    }
  };

  const closeAlertMediaPreview = () => {
    setIsAlertMediaPreviewOpen(false);
    setAlertMediaPreview(null);
  };

  const showPreviousGroupAlbumImage = () => {
    if (groupAlbumImages.length <= 1) return;
    setGroupAlbumIndex((current) =>
      current <= 0 ? groupAlbumImages.length - 1 : current - 1
    );
  };

  const showNextGroupAlbumImage = () => {
    if (groupAlbumImages.length <= 1) return;
    setGroupAlbumIndex((current) =>
      current >= groupAlbumImages.length - 1 ? 0 : current + 1
    );
  };

  const currentGroupAlbumImage = groupAlbumImages[groupAlbumIndex] || null;

  const recentAlertsFromEvents = Array.isArray(activity?.recentAlerts) ? activity.recentAlerts : [];
  const hasAiDetectionInEvents = recentAlertsFromEvents.some(
    (alert: any) => String(alert?.event_type || "").trim().toLowerCase() === "ai_detection"
  );
  const recentDetectionFallback = hasAiDetectionInEvents
    ? []
    : (Array.isArray(activity?.recentDetections) ? activity.recentDetections : []).map((detection: any) => ({
        ...detection,
        event_type: "ai_detection",
        created_at: detection?.detected_at || detection?.created_at || null,
      }));
  const recentAlertsRaw = [...recentAlertsFromEvents, ...recentDetectionFallback]
    .sort((a: any, b: any) => {
      const aTime = Date.parse(String(a?.detected_at || a?.created_at || "")) || 0;
      const bTime = Date.parse(String(b?.detected_at || b?.created_at || "")) || 0;
      return bTime - aTime;
    });
  const recentAlerts = recentAlertsRaw.filter((alert: any) => {
    const alertId = Number(alert?.id);
    if (!Number.isInteger(alertId) || alertId <= 0) return true;
    return !removedAlertIds.has(alertId);
  });
  const normalizedAlertsSearch = alertsSearchTerm.trim().toLowerCase();
  const alertsWithSearch = normalizedAlertsSearch
    ? recentAlerts.filter((alert: any) => {
        const details = alert.details || {};
        return (
          (alert.camera_name || "").toLowerCase().includes(normalizedAlertsSearch) ||
          (alert.algo_type || "").toLowerCase().includes(normalizedAlertsSearch) ||
          (details.job_name || "").toLowerCase().includes(normalizedAlertsSearch) ||
          (details.step_name || "").toLowerCase().includes(normalizedAlertsSearch) ||
          (details.agent_key || "").toLowerCase().includes(normalizedAlertsSearch) ||
          (details.group_name || details.groupName || alert.group_name || "").toLowerCase().includes(normalizedAlertsSearch)
        );
      })
    : recentAlerts;
  const normalizedFilter = alertsFilter === "MEDUIM" ? "MEDIUM" : alertsFilter;
  const filteredAlerts =
    normalizedFilter === "ALL"
      ? alertsWithSearch
      : alertsWithSearch.filter((alert: any) => {
          const rawPriority =
            alert.priority_level ||
            alert.details?.priority_level ||
            "";
          const normalizedPriority = String(rawPriority).toUpperCase() === "MEDUIM"
            ? "MEDIUM"
            : String(rawPriority).toUpperCase();
          return normalizedPriority === normalizedFilter;
        });
  const buildAlertGroups = (alertsList: any[]) => {
    const groupsByKey = new Map<string, { key: string; alerts: any[] }>();

    for (const alert of alertsList) {
      const key = buildAlertGroupKey(alert);
      const existing = groupsByKey.get(key);
      if (existing) {
        existing.alerts.push(alert);
        continue;
      }
      groupsByKey.set(key, { key, alerts: [alert] });
    }

    return Array.from(groupsByKey.values())
      .map((group) => {
        const latestAlert = group.alerts[0] || null;
        const mediaAlert = selectGroupMediaAlert(group.alerts);

        if (!latestAlert || !mediaAlert) {
          return null;
        }

        return {
          key: group.key,
          alerts: group.alerts,
          latestAlert,
          mediaAlert,
          alertCount: group.alerts.length,
          contributingEventsCount: getAlertContributingEventsCount(mediaAlert),
          mediaGroupImageCount: getAlertGroupImageCount(mediaAlert),
        };
      })
      .filter(Boolean) as Array<{
        key: string;
        alerts: any[];
        latestAlert: any;
        mediaAlert: any;
        alertCount: number;
        contributingEventsCount: number;
        mediaGroupImageCount: number;
      }>;
  };
  const groupedRecentAlerts = buildAlertGroups(recentAlerts);
  const groupedRecentAlertsByKey = new Map(
    groupedRecentAlerts.map((group) => [group.key, group]),
  );
  const activeAlertGroup = activeAlertGroupKey
    ? groupedRecentAlertsByKey.get(activeAlertGroupKey) || null
    : null;
  const activeAlertHistory = activeAlertGroup?.alerts || (activeAlert ? [activeAlert] : []);
  useEffect(() => {
    let focusTimer: number | null = null;
    let highlightTimer: number | null = null;

    if (
      isAlertPanelOpen &&
      alertPanelFocusTarget === "emitted-alerts" &&
      activeAlertHistory.length > 1
    ) {
      focusTimer = window.setTimeout(() => {
        const emittedAlertsSection = emittedAlertsSectionRef.current;
        setAlertPanelFocusTarget(null);
        if (!emittedAlertsSection) return;

        emittedAlertsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        setHighlightEmittedAlerts(true);
        highlightTimer = window.setTimeout(() => {
          setHighlightEmittedAlerts(false);
        }, 2600);
      }, 220);
    }

    return () => {
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
      }
      if (highlightTimer !== null) {
        window.clearTimeout(highlightTimer);
      }
    };
  }, [activeAlertHistory.length, alertPanelFocusTarget, isAlertPanelOpen]);
  const activeAlertTime = activeAlert?.detected_at || activeAlert?.created_at || null;
  const activeAlertSummary =
    readAlertLabelString(
      activeAlert?.details?.answer,
      activeAlert?.message,
      activeAlert?.details?.summary,
      activeAlert?.details?.reason,
    ) || "";
  const formatAlertTimestamp = (iso: string | null | undefined) => {
    if (!iso) return "--";
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return "--";
    return parsed.toLocaleString(i18n.language || undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };
  const activeAlertTimestampLabel = formatAlertTimestamp(activeAlertTime);
  const activeAlertMedia = getAlertMedia(activeAlert);
  const activeAlertContributingEventsCount = getAlertContributingEventsCount(activeAlert);
  const activeAlertGroupImageCount = getAlertGroupImageCount(activeAlert);
  const activeAlertMomentsCount = Math.max(
    activeAlertContributingEventsCount,
    activeAlertGroupImageCount,
    activeAlertMedia.albumImages.length
  );
  const activeAlertPrimaryAlbumImage = activeAlertMedia.albumImages[0] || null;
  const activeAlertHasImageAlbum =
    activeAlertMedia.albumImages.length > 1;
  const activeAlertCanPreview =
    Boolean(activeAlertMedia.mediaUrl) || activeAlertMedia.albumImages.length > 0;
  const activeAlertDownloadTarget = getAlertDownloadTarget(
    activeAlertMedia.mediaUrl,
    activeAlertMedia.albumImages,
  );
  const groupedFilteredAlerts = buildAlertGroups(filteredAlerts);
  const alertsCardsPerView = alertsCompactMode ? 8 : 4;
  const visibleAlerts = groupedFilteredAlerts.slice(0, alertsCardsPerView);
  const placeholderCount = Math.max(0, alertsCardsPerView - visibleAlerts.length);
  const alertsForDisplay = [
    ...visibleAlerts,
    ...Array.from({ length: placeholderCount }, () => null),
    ...groupedFilteredAlerts.slice(alertsCardsPerView),
  ];
  const alertsCardMinHeightClass = alertsCompactMode ? "min-h-[320px]" : "min-h-[320px]";
  const alertsCardMediaHeightClass = alertsCompactMode ? "h-[190px]" : "h-[240px]";
  const alertsCardBodyPaddingClass = alertsCompactMode ? "p-2" : "p-3";
  const alertFilters = ["ALL", "CRITIC", "HIGH", "MEDUIM", "LOW"];
  const alertFilterLabels: Record<string, string> = {
    ALL: t("dashboard.alertFilters.all"),
    CRITIC: t("dashboard.alertFilters.critic"),
    HIGH: t("dashboard.alertFilters.high"),
    MEDUIM: t("dashboard.alertFilters.medium"),
    LOW: t("dashboard.alertFilters.low"),
  };

  const handleStopJob = async (jobId: number, jobName: string) => {
    setStoppingJobs(prev => new Set(prev).add(jobId));
    
    try {
      const response = await fetch(`/api/jobs/${jobId}/stop`, {
        method: "POST",
      });

      if (response.ok) {
      setToast({ message: t("dashboard.stopJobRequested", { jobName }), type: "success" });
        
        // Trigger immediate dashboard refresh
        refresh();
        
        // Fast follow refreshes to ensure UI updates quickly even if polling interval is long
        setTimeout(() => refresh(), 1500);
        setTimeout(() => refresh(), 3500);
      } else {
        const error = await response.json();
        setToast({ message: error.error || t("dashboard.stopJobFailed"), type: "error" });
      }
    } catch (error) {
      console.error("Failed to stop job:", error);
      setToast({ message: t("dashboard.stopJobFailed"), type: "error" });
    } finally {
      setStoppingJobs(prev => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const toggleJobExpanded = (jobId: number) => {
    setExpandedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  };

  // Show loading state if no data yet
  if (!stats && cameras.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t("dashboard.loading")}</div>
      </div>
    );
  }

  // Fallback if dashboard payload missing but we have cameras
  if (!stats) {
    return (
      <div className="w-full max-w-none pl-0 pr-6 sm:pr-8 lg:pr-12 py-8">
        <div className="text-center text-gray-400 py-12">
          <p>{t("dashboard.dataLoading")}</p>
          <p className="text-sm mt-2">{t("dashboard.camerasCount", { count: cameras.length })}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none pl-0 pr-6 sm:pr-8 lg:pr-12 pt-0 pb-8">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <CameraEventToast toasts={cameraEventToasts} onDismiss={dismissCameraEventToast} />
      <ConfirmDialog
        isOpen={isFalsePositiveConfirmOpen}
        title={t("dashboard.deleteFalsePositiveTitle")}
        message={t("dashboard.deleteFalsePositiveMessage")}
        confirmLabel={isDeletingFalsePositive ? t("dashboard.deleting") : t("dashboard.deleteFalsePositiveConfirm")}
        cancelLabel={t("dashboard.deleteFalsePositiveCancel")}
        onConfirm={handleDeleteFalsePositive}
        onCancel={() => setIsFalsePositiveConfirmOpen(false)}
        variant="danger"
      />
      
      {/* Page Header
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">{t("nav.dashboard")}</h1>
        <p className="text-gray-400">{t("dashboard.pageSubtitle")}</p>
      </div>
      */}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4 mb-8">
        <KpiCard
          icon={Camera}
          label={t("dashboard.kpi.camerasRunning")}
          value={`${stats.cameras_running}/${stats.cameras_total}`}
          color="blue"
        />
        <KpiCard
          icon={Clock}
          label={t("dashboard.kpi.jobsRunning")}
          value={`${stats.jobs_running}/${stats.jobs_total}`}
          color="green"
        />
        <KpiCard
          icon={ListChecks}
          label={t("dashboard.kpi.stepsRunning")}
          value={stats.steps_running}
          color="teal"
        />
        <KpiCard
          icon={Zap}
          label={t("dashboard.kpi.enabledAgents")}
          value={stats.agents_enabled_total}
          color="purple"
        />
        <KpiCard
          icon={Activity}
          label={t("dashboard.kpi.detections")}
          value={stats.detections_24h_total}
          subtext={t("dashboard.kpi.last24h")}
          color="orange"
        />
        <KpiCard
          icon={Command}
          label={t("dashboard.kpi.pendingCommands")}
          value={stats.pending_commands}
          color="yellow"
        />
        <KpiCard
          icon={Bell}
          label={t("dashboard.kpi.unreadAlerts")}
          value={stats.unread_alerts}
          color="red"
        />
      </div>

      {/* Main Grid */}
        <div className="grid grid-cols-1 gap-6 mb-6 lg:grid-cols-[0.29fr_1fr] lg:gap-1">
          {/* Jobs & Pipelines */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 backdrop-blur-sm min-w-0 flex flex-col min-h-0 h-[840px] max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">{t("dashboard.jobsPipelines")}</h2>
            <Link
              to="/jobs"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {t("dashboard.manage")} {"->"}
            </Link>
          </div>

          {/* Running Jobs */}
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-300">{t("dashboard.runningJobs")}</h3>
            </div>
            {!jobs?.runningJobs || jobs.runningJobs.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4">{t("dashboard.noJobsRunning")}</div>
            ) : (
              <div className="space-y-2">
                {jobs.runningJobs.map((job: any) => {
                  const isStopping = job.status === "stopping" || stoppingJobs.has(job.job_id);
                  const steps = jobs?.runningJobSteps?.[job.job_id] || [];
                  const isExpanded = expandedJobs.has(job.job_id);
                  const totalSteps = steps.length;
                  const completedSteps = steps.filter((s: any) => s.status === "completed").length;
                  //const runningStep = steps.find((s: any) => s.status === "running");
                  steps.find((s: any) => s.status === "running");

                  
                  return (
                    <div
                      key={job.job_id}
                      className="bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2"
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer"
                          onClick={() => toggleJobExpanded(job.job_id)}
                        >
                          <div className="mt-1 text-gray-400">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="text-white font-medium truncate block">{job.job_name || t("dashboard.unknownJob")}</span>
                            <div className="flex items-center gap-2 mt-1">
                              <span
                                className={`px-2 py-0.5 text-xs rounded-full ${
                                  isStopping
                                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                                    : "bg-green-500/20 text-green-400 border border-green-500/30"
                                }`}
                              >
                                {isStopping ? t("dashboard.stopping") : t("dashboard.running")}
                              </span>

                              {job.started_at_utc && (
                                <span className="text-xs text-gray-400">
                                  {t("dashboard.startedAgo", { value: timeAgo(job.started_at_utc) })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 ml-3" onClick={(e) => e.stopPropagation()}>
                          {totalSteps > 0 && (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              {completedSteps}/{totalSteps}
                            </span>
                          )}
                          <button
                            onClick={() => handleStopJob(job.job_id, job.job_name)}
                            disabled={isStopping}
                            className={`px-3 py-1.5 text-xs rounded transition-colors flex items-center gap-1 ${
                              isStopping
                                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                : "bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20"
                            }`}
                          >
                            <StopCircle className="w-3 h-3" />
                            {t("dashboard.stop")}
                          </button>
                        </div>
                      </div>

                      {isExpanded && steps.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-800/60">
                          <div className="space-y-2 pl-2">
                            {steps.map((step: any) => {
                              const isCompleted = step.status === "completed";
                              const isRunning = step.status === "running";
                              const isPending = step.status === "pending";
                              const isSkipped = step.status === "skipped";
                              const iconColor = isCompleted
                                ? "text-green-400"
                                : isRunning
                                ? "text-purple-400"
                                : isSkipped
                                ? "text-yellow-400"
                                : "text-gray-500";
                              const textColor = isCompleted
                                ? "text-green-300"
                                : isRunning
                                ? "text-purple-300"
                                : isSkipped
                                ? "text-yellow-300"
                                : "text-gray-500";
                              const Icon = isCompleted ? CheckCircle : isRunning ? Loader2 : isSkipped ? XCircle : Circle;
                              return (
                                <div key={step.id} className="flex items-center gap-3 text-sm">
                                  <div className={`w-4 h-4 ${iconColor} flex items-center justify-center`}>
                                    <Icon className={`w-4 h-4 ${isRunning ? "animate-spin" : ""}`} />
                                  </div>
                                  <span className={`truncate ${textColor}`}>
                                    {t("dashboard.stepWithOrder", { order: step.step_order, name: step.name })}
                                  </span>
                                  {isPending ? <span className="text-xs text-gray-600 ml-auto">{t("dashboard.pending")}</span> : null}
                                  {isSkipped ? <span className="text-xs text-yellow-400 ml-auto">{t("dashboard.skipped")}</span> : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Scheduled Jobs */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gray-400" />
              {t("dashboard.scheduledJobs.title")}
            </h3>
            {!jobs?.scheduledJobs || jobs.scheduledJobs.length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4">
                {t("dashboard.scheduledJobs.none")}
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {jobs.scheduledJobs.map((sched: any) => (
                  <div
                    key={`${sched.job_id}-${sched.next_run_local_date}-${sched.next_run_local_time}`}
                    className="bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">{sched.job_name || t("dashboard.unknownJob")}</div>
                        <div className="text-xs text-gray-400">
                          {sched.camera_count} {t("dashboard.scheduledJobs.cameras")} - {sched.step_count} {t("dashboard.scheduledJobs.steps")}
                        </div>
                      </div>
                      <div className="ml-3 px-2.5 py-1 text-xs rounded bg-gray-800 text-gray-200 border border-gray-700 whitespace-nowrap">
                        {sched.next_run_local_time || "--:--"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Job Starts */}
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-3">{t("dashboard.recentJobStarts")}</h3>
            {!jobs?.recentCommands || jobs.recentCommands.filter((c: any) => c.command_type === "job_start").length === 0 ? (
              <div className="text-sm text-gray-500 text-center py-4">{t("dashboard.noRecentJobStarts")}</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {jobs.recentCommands
                  .filter((c: any) => c.command_type === "job_start")
                  .map((cmd: any) => (
                    <div
                      key={cmd.id}
                      className="bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium truncate">
                          {cmd.job_name || t("dashboard.unknownJob")}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            cmd.status === "completed"
                              ? "bg-green-500/20 text-green-400 border border-green-500/30"
                              : cmd.status === "pending"
                              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                              : cmd.status === "failed"
                              ? "bg-red-500/20 text-red-400 border border-red-500/30"
                              : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                          }`}
                        >
                          {cmd.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        {cmd.step_count && <span>{cmd.step_count} {t("dashboard.scheduledJobs.steps")}</span>}
                        <span>{timeAgo(cmd.created_at)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
        {/* Recent Alerts */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 backdrop-blur-sm min-w-0 flex flex-col min-h-0 h-[840px] max-h-[90vh] overflow-hidden relative">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xl font-semibold text-white">{t("dashboard.recentAlerts")}</h2>
            <button
              type="button"
              onClick={() => setAlertsCompactMode((prev) => !prev)}
              className="inline-flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium rounded-full border border-gray-600 text-gray-200 hover:border-gray-400 hover:text-white transition-colors"
              title={alertsCompactMode ? "Show larger cards (4)" : "Show compact cards (8)"}
              aria-label={alertsCompactMode ? "Show larger alert cards" : "Show compact alert cards"}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {alertsCompactMode ? "8" : "4"}
            </button>
          </div>

          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={alertsSearchTerm}
                onChange={(event) => setAlertsSearchTerm(event.target.value)}
                placeholder={t("dashboard.searchAlertsPlaceholder")}
                className="w-full bg-gray-900/60 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/40"
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {alertFilters.map((filter) => {
                const severityClasses = {
                  ALL: "bg-gray-800 text-gray-300 border-gray-700 hover:border-gray-500",
                  CRITIC: "bg-red-500/20 text-red-200 border-red-500/40",
                  HIGH: "bg-orange-500/20 text-orange-200 border-orange-500/40",
                  MEDUIM: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
                  LOW: "bg-green-500/20 text-green-200 border-green-500/40",
                } as const;
                const inactiveClasses = "bg-blue-500/20 text-blue-200 border-blue-500/40";
                const activeClasses = severityClasses[filter as keyof typeof severityClasses];

                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setAlertsFilter(filter)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                      alertsFilter === filter ? activeClasses : inactiveClasses
                    }`}
                  >
                    {alertFilterLabels[filter] ?? filter}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className={`grid pr-1 w-full flex-1 min-h-0 content-start ${
              alertsCompactMode
                ? "overflow-y-scroll grid-cols-2 xl:grid-cols-4 gap-3"
                : "overflow-y-auto grid-cols-2 gap-3"
            }`}
          >
            {alertsForDisplay.map((alertGroup: any, idx: number) => {
              if (!alertGroup) {
                return (
                  <div
                    key={`alert-placeholder-${idx}`}
                    className={`bg-gray-900/60 border border-gray-700/60 rounded-xl overflow-hidden ${alertsCardMinHeightClass}`}
                    >
                    <div className={`relative w-full ${alertsCardMediaHeightClass} bg-gradient-to-br from-gray-900/80 via-gray-800/60 to-gray-900/80 animate-pulse`}>
                      <div className="absolute top-2 left-2 h-6 w-20 rounded-full bg-gray-700/60" />
                      <div className="absolute top-2 right-2 h-6 w-16 rounded-full bg-gray-700/60" />
                      <div className="absolute bottom-2 right-2 h-6 w-20 rounded-full bg-gray-700/60" />
                    </div>
                    <div className={`${alertsCardBodyPaddingClass} space-y-2`}>
                      <div className="h-3 w-32 rounded bg-gray-800/70" />
                      <div className="h-3 w-48 rounded bg-gray-800/70" />
                      <div className="h-9 w-full rounded-lg bg-gray-800/80" />
                    </div>
                  </div>
                );
              }

              const alert = alertGroup.latestAlert;
              const mediaSourceAlert = alertGroup.mediaAlert;
              const alertDetails = alert.details || {};
              const alertTime = alert.detected_at || alert.created_at || null;
              const { mediaUrl, isVideo, albumImages } = getAlertMedia(mediaSourceAlert);
              const downloadTargetUrl = getAlertDownloadTarget(mediaUrl, albumImages);
              const hasAlbumEntries = albumImages.length > 0;
              const hasImageAlbum = hasAlbumEntries && albumImages.length > 1;
              const singleAlbumImage = hasAlbumEntries ? albumImages[0] : null;
              const albumMomentsCount = Math.max(
                alertGroup.contributingEventsCount || 0,
                hasAlbumEntries ? albumImages.length : 0
              );
              const albumMomentsLabel = albumMomentsCount > 0
                ? i18n.language?.startsWith("pt")
                  ? `${albumMomentsCount} momentos`
                  : `${albumMomentsCount} moments`
                : null;
              const albumMosaicLayout = getAlbumMosaicLayout(albumImages.length);
              const albumPreviewImages = hasImageAlbum
                ? albumImages.slice(0, albumMosaicLayout.previewCount)
                : [];
              const hiddenAlbumImagesCount = Math.max(0, albumImages.length - albumPreviewImages.length);
              const showTileCameraName = albumMosaicLayout.previewCount <= 6;
              const rawInputType = String(
                alertDetails.input_type ||
                alertDetails.agent_input_type ||
                alert.input_type ||
                ""
              ).toLowerCase();
              const isJobAlertCard =
                String(alert?.event_type || "").trim().toLowerCase() === "job_alert_triggered";
              const normalizedInputType =
                rawInputType === "video" || rawInputType === "image"
                  ? rawInputType
                  : hasImageAlbum
                  ? "image"
                  : mediaUrl
                  ? isVideo
                    ? "video"
                    : "image"
                  : null;
              const mediaTypeBadgeLabel =
                normalizedInputType === "video"
                  ? t("dashboard.videoBased")
                  : normalizedInputType === "image"
                  ? t("dashboard.imageBased")
                  : null;
              const mediaTypeBadgeClasses =
                normalizedInputType === "video"
                  ? "bg-blue-500/20 text-blue-200 border-blue-500/40"
                  : "bg-emerald-500/20 text-emerald-200 border-emerald-500/40";
              const groupNameValue =
                alertDetails.group_name ||
                alertDetails.groupName ||
                alert.group_name ||
                alert.groupName ||
                "";
              const groupName = typeof groupNameValue === "string" ? groupNameValue.trim() : "";
              const groupNameLabel = groupName
                ? `${t("dashboard.groupPrefix")}: ${groupName.replace(/^group\s*:\s*/i, "")}`
                : "";
              const agentLabel = (alertDetails.agent_key || alert.algo_type || "Alert")
                .toString()
                .toUpperCase();
              const stepIdValue =
                alertDetails.step_id ??
                alertDetails.stepId ??
                alertDetails.step_order;
              const rawPriority =
                alert.priority_level ||
                alertDetails.priority_level ||
                "";
              const priorityValue = String(rawPriority).toUpperCase() === "MEDUIM"
                ? "MEDIUM"
                : String(rawPriority).toUpperCase();
              const priorityBadgeClasses: Record<string, string> = {
                CRITIC: "bg-red-500/30 text-red-200 border-red-500/50",
                HIGH: "bg-orange-500/30 text-orange-200 border-orange-500/50",
                MEDIUM: "bg-yellow-500/30 text-yellow-100 border-yellow-500/50",
                LOW: "bg-green-500/30 text-green-200 border-green-500/50",
              };
              const priorityIconClasses: Record<string, string> = {
                CRITIC: "text-red-400",
                HIGH: "text-orange-400",
                MEDIUM: "text-yellow-400",
                LOW: "text-green-400",
              };
              const showPriority =
                isJobAlertCard && !!priorityValue && priorityBadgeClasses[priorityValue];
              const timeAgoText = alertTime ? timeAgo(alertTime) : null;
              const usePortuguesePrefix =
                i18n.language?.startsWith("pt") && timeAgoText && timeAgoText !== "Just now";
              const alertAgeLabel = timeAgoText ? `${usePortuguesePrefix ? "H\u00E1 " : ""}${timeAgoText}` : null;
              const overlayRightOffsetClass =
                alertGroup.alertCount > 1 ? "right-14" : "right-2";

              return (
                <div
                  key={alertGroup.key}
                  className={`bg-gray-900/60 border border-gray-700/60 rounded-xl overflow-hidden ${alertsCardMinHeightClass}`}
                >
                  <div className={`relative w-full ${alertsCardMediaHeightClass} bg-gray-900/70 group`}>
                    {hasAlbumEntries ? (
                      hasImageAlbum ? (
                        <button
                          type="button"
                          onClick={() => openGroupAlbum(mediaSourceAlert, 0)}
                          className="relative w-full h-full grid gap-1 p-1 overflow-hidden bg-gray-900/60 cursor-pointer"
                          style={{
                            gridTemplateColumns: `repeat(${albumMosaicLayout.columns}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${albumMosaicLayout.rows}, minmax(0, 1fr))`,
                          }}
                        >
                          {albumPreviewImages.map((albumImage: any, albumIndex: number) => (
                            <div
                              key={albumImage.key || `${albumImage.url || "placeholder"}-${albumIndex}`}
                              className="relative min-h-0 overflow-hidden rounded-md border border-gray-800/80 bg-gray-900"
                            >
                              {albumImage?.url ? (
                                <img
                                  src={albumImage.url}
                                  alt={albumImage.cameraName || `Group camera ${albumIndex + 1}`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full min-h-0 flex flex-col items-center justify-center bg-gray-900 text-red-200">
                                  <Camera className="w-4 h-4 mb-1 opacity-90" />
                                  <span className="text-[9px] uppercase tracking-wide">{t("dashboard.offline")}</span>
                                </div>
                              )}
                              {showTileCameraName && albumImage.cameraName && (
                                <div className="absolute left-1 right-1 bottom-1 truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-gray-100 text-left">
                                  {albumImage.cameraName}
                                </div>
                              )}
                              {hiddenAlbumImagesCount > 0 && albumIndex === albumPreviewImages.length - 1 && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/65 text-sm font-semibold text-white">
                                  +{hiddenAlbumImagesCount}
                                </div>
                              )}
                            </div>
                          ))}
                          <div
                            className={`absolute top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-gray-100 transition-opacity group-hover:opacity-0 ${
                              alertGroup.alertCount > 1 ? "right-14" : "right-3"
                            }`}
                          >
                            {t("dashboard.openAlbum")}
                          </div>
                        </button>
                      ) : singleAlbumImage?.isOfflinePlaceholder ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 text-red-200">
                          <Camera className="w-10 h-10 mb-2 opacity-90" />
                          <div className="text-sm font-medium">{t("dashboard.cameraOffline")}</div>
                          {singleAlbumImage?.cameraName && (
                            <div className="mt-1 text-xs text-gray-300">{singleAlbumImage.cameraName}</div>
                          )}
                        </div>
                      ) : singleAlbumImage?.url ? (
                        <img
                          src={singleAlbumImage.url}
                          alt={singleAlbumImage.cameraName || alertDetails.agent_key || alert.algo_type || "Alert"}
                          className="w-full h-full object-cover"
                        />
                      ) : mediaUrl ? (
                        isVideo ? (
                          <video
                            src={mediaUrl}
                            className="w-full h-full object-cover cursor-pointer"
                            controls
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <img
                            src={mediaUrl}
                            alt={alertDetails.agent_key || alert.algo_type || "Alert"}
                            className="w-full h-full object-cover"
                          />
                        )
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                          {t("dashboard.noMediaAvailable")}
                        </div>
                      )
                    ) : mediaUrl ? (
                      isVideo ? (
                        <video
                          src={mediaUrl}
                          className="w-full h-full object-cover cursor-pointer"
                          controls
                          playsInline
                          preload="metadata"
                        />
                      ) : (
                        <img
                          src={mediaUrl}
                          alt={alertDetails.agent_key || alert.algo_type || "Alert"}
                          className="w-full h-full object-cover"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                        {t("dashboard.noMediaAvailable")}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/15 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                    <div className={`absolute top-2 ${overlayRightOffsetClass} z-10 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDownloadAlertMedia(downloadTargetUrl, mediaSourceAlert);
                        }}
                        disabled={!downloadTargetUrl}
                        className="pointer-events-auto p-2 rounded-full border border-gray-500/70 bg-black/55 text-gray-100 hover:border-white hover:bg-black/75 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label="Download alert media"
                        title={downloadTargetUrl ? "Download media" : "No media to download"}
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (hasImageAlbum) {
                            openGroupAlbum(mediaSourceAlert, 0);
                            return;
                          }
                          openAlertMediaPreview(mediaSourceAlert);
                        }}
                        className="pointer-events-auto p-2 rounded-full border border-gray-500/70 bg-black/55 text-gray-100 hover:border-white hover:bg-black/75 transition-colors"
                        aria-label="Expand alert media"
                        title="Expand media"
                      >
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    </div>
                    {alertGroup.alertCount > 1 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openAlertPanel(alert, alertGroup.key, { focusEmittedAlerts: true });
                        }}
                        className="absolute top-2 right-2 z-10 flex h-8 min-w-[2rem] items-center justify-center rounded-full border border-red-400/60 bg-red-500/90 px-2 text-xs font-bold text-white shadow-lg shadow-red-950/40 transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-red-200 hover:bg-red-400 hover:shadow-xl hover:shadow-red-950/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200/80 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                        aria-label={
                          i18n.language?.startsWith("pt")
                            ? `Abrir ${alertGroup.alertCount} alertas emitidos`
                            : `Open ${alertGroup.alertCount} emitted alerts`
                        }
                        title={
                          i18n.language?.startsWith("pt")
                            ? `Abrir ${alertGroup.alertCount} alertas emitidos`
                            : `Open ${alertGroup.alertCount} emitted alerts`
                        }
                      >
                        {alertGroup.alertCount}
                      </button>
                    )}
                    {showPriority && (
                      <div
                        className={`absolute top-2 left-2 px-2 py-0.5 text-xs font-semibold rounded-full border ${priorityBadgeClasses[priorityValue]}`}
                      >
                        {priorityValue}
                      </div>
                    )}
                    {alertAgeLabel && (
                      <div className={`absolute top-2 ${overlayRightOffsetClass} px-2 py-0.5 text-xs bg-black/60 text-gray-200 rounded-full transition-opacity group-hover:opacity-0`}>
                        {alertAgeLabel}
                      </div>
                    )}
                    {albumMomentsLabel && (
                      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full border border-emerald-400/35 bg-black/70 px-2.5 py-1 text-[11px] font-medium text-emerald-200 shadow-sm shadow-black/30">
                        {albumMomentsLabel}
                      </div>
                    )}
                    {isVideo && !hasImageAlbum && (
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center">
                          <Play className="w-7 h-7 text-white" />
                        </div>
                      </div>
                    )}
                  </div>
                    <div className={alertsCardBodyPaddingClass}>
                    <div className="mb-1 -mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-gray-400">
                      <AlertTriangle className={`w-4 h-4 shrink-0 ${priorityIconClasses[priorityValue] || "text-gray-400"}`} />
                      <span
                        className="min-w-0 max-w-[44%] truncate rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-gray-200 cursor-help"
                        title={agentLabel}
                      >
                        {agentLabel}
                      </span>
                      {mediaTypeBadgeLabel && (
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${mediaTypeBadgeClasses}`}
                        >
                          {mediaTypeBadgeLabel}
                        </span>
                      )}
                      </div>
                    {groupNameLabel && (
                      <div className="mb-1 flex min-w-0">
                        <span
                          className="min-w-0 max-w-full truncate rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 text-[11px] text-cyan-200 cursor-help"
                          title={groupNameLabel}
                        >
                          {groupNameLabel}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 text-xs text-gray-200">
                      <div className="flex items-center gap-2 min-w-0 relative -top-0.5">
                        <Camera className="w-4 h-4 text-gray-400" />
                        <span className="truncate">
                          {alertDetails.camera_name || alert.camera_name || t("dashboard.camera")}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openAlertPanel(alert, alertGroup.key)}
                        className="px-3 py-1 text-[11px] font-medium rounded-full border border-gray-600 text-gray-200 hover:border-gray-400 hover:text-white transition-colors"
                      >
                        {t("jobs.open")}
                      </button>
                    </div>
                    {isJobAlertCard && (alertDetails.job_name || alertDetails.step_order !== undefined) && (
                      alertsCompactMode ? (
                        <div className="mt-0.5 space-y-0.5 text-[11px] text-gray-400 relative -top-0.5">
                          {alertDetails.job_name && (
                            <div className="flex items-center gap-2 min-w-0">
                              <Layers className="w-4 h-4 text-gray-500 shrink-0" />
                              <span className="truncate" title={String(alertDetails.job_name || "")}>
                                <span className="text-gray-300">{t("dashboard.job")}:</span> {alertDetails.job_name}
                              </span>
                            </div>
                          )}
                          {stepIdValue !== undefined && stepIdValue !== null && (
                            <div className="flex items-center gap-2 min-w-0">
                              <Circle className="w-2.5 h-2.5 text-gray-500 shrink-0" />
                              <span className="truncate" title={String(stepIdValue)}>
                                <span className="text-gray-300">Step ID:</span> {stepIdValue}
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400 relative -top-0.5">
                          {alertDetails.job_name && (
                            <>
                              <Layers className="w-4 h-4 text-gray-500" />
                              <span className="truncate" title={String(alertDetails.job_name || "")}>
                                <span className="text-gray-300">{t("dashboard.job")}:</span> {alertDetails.job_name}
                              </span>
                            </>
                          )}
                          {alertDetails.step_order !== undefined && (
                            <>
                              <Circle className="w-2.5 h-2.5 text-gray-500" />
                              <span className="truncate" title={String(alertDetails.step_order)}>
                                <span className="text-gray-300">{t("dashboard.step")}:</span> {alertDetails.step_order}
                              </span>
                            </>
                          )}
                        </div>
                      )
                    )}
                    </div>
                </div>
              );
            })}
          </div>

          {isGroupAlbumOpen && (
            <div className="fixed inset-0 z-[90]">
              <div
                className="absolute inset-0 bg-black/65 backdrop-blur-sm"
                onClick={closeGroupAlbum}
              />
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="relative w-full max-w-6xl">
                  <button
                    type="button"
                    onClick={closeGroupAlbum}
                    className="absolute top-3 right-3 z-20 p-2 rounded-full border border-gray-600 bg-black/70 text-gray-100 hover:border-white hover:text-white transition-colors"
                    aria-label={t("dashboard.closeAlbum")}
                  >
                    <X className="w-5 h-5" />
                  </button>

                  {groupAlbumImages.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={showPreviousGroupAlbumImage}
                        className="absolute left-3 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full border border-gray-600 bg-black/70 text-gray-100 hover:border-white hover:text-white transition-colors"
                        aria-label={t("dashboard.previousImage")}
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <button
                        type="button"
                        onClick={showNextGroupAlbumImage}
                        className="absolute right-3 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full border border-gray-600 bg-black/70 text-gray-100 hover:border-white hover:text-white transition-colors"
                        aria-label={t("dashboard.nextImage")}
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </>
                  )}

                  <div className="relative overflow-hidden rounded-xl border border-gray-700/90 bg-black/80 shadow-2xl">
                    {currentGroupAlbumImage ? (
                      currentGroupAlbumImage?.url ? (
                        <img
                          src={currentGroupAlbumImage.url}
                          alt={currentGroupAlbumImage.cameraName || `Group camera ${groupAlbumIndex + 1}`}
                          className="w-full h-[72vh] md:h-[80vh] object-contain"
                        />
                      ) : currentGroupAlbumImage?.isOfflinePlaceholder ? (
                        <div className="w-full h-[72vh] md:h-[80vh] flex flex-col items-center justify-center text-red-200">
                          <Camera className="w-16 h-16 mb-4 opacity-90" />
                          <p className="text-lg font-semibold">{t("dashboard.cameraOffline")}</p>
                          {currentGroupAlbumImage?.cameraName && (
                            <p className="text-sm text-gray-300 mt-1">{currentGroupAlbumImage.cameraName}</p>
                          )}
                        </div>
                      ) : (
                        <div className="w-full h-[72vh] md:h-[80vh] flex items-center justify-center text-sm text-gray-400">
                          {t("dashboard.noImageAvailable")}
                        </div>
                      )
                    ) : (
                      <div className="w-full h-[72vh] md:h-[80vh] flex items-center justify-center text-sm text-gray-400">
                        {t("dashboard.noImageAvailable")}
                      </div>
                    )}
                    <div className="absolute left-4 bottom-4 max-w-[65%] truncate rounded bg-black/70 px-3 py-1.5 text-sm text-gray-100">
                      {currentGroupAlbumImage?.cameraName || groupAlbumLabel}
                    </div>
                    <div className="absolute right-4 bottom-4 rounded bg-black/70 px-3 py-1.5 text-sm text-gray-100">
                      {groupAlbumIndex + 1} / {groupAlbumImages.length}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isAlertMediaPreviewOpen && alertMediaPreview && (
            <div className="fixed inset-0 z-[92]">
              <div
                className="absolute inset-0 bg-black/65 backdrop-blur-sm"
                onClick={closeAlertMediaPreview}
              />
              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="relative w-full max-w-6xl">
                  <button
                    type="button"
                    onClick={closeAlertMediaPreview}
                    className="absolute top-3 right-3 z-20 p-2 rounded-full border border-gray-600 bg-black/70 text-gray-100 hover:border-white hover:text-white transition-colors"
                    aria-label={t("dashboard.closeAlbum")}
                  >
                    <X className="w-5 h-5" />
                  </button>

                  <div className="relative overflow-hidden rounded-xl border border-gray-700/90 bg-black/80 shadow-2xl">
                    {alertMediaPreview.isVideo ? (
                      <video
                        src={alertMediaPreview.url}
                        className="w-full h-[72vh] md:h-[80vh] object-contain bg-black"
                        controls
                        autoPlay
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={alertMediaPreview.url}
                        alt={alertMediaPreview.label}
                        className="w-full h-[72vh] md:h-[80vh] object-contain"
                      />
                    )}
                    <div className="absolute left-4 bottom-4 max-w-[75%] truncate rounded bg-black/70 px-3 py-1.5 text-sm text-gray-100">
                      {alertMediaPreview.label}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Bottom Grid - Activity & Detections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[0.29fr_1fr] lg:gap-1">
        {/* Live Activity Feed */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 backdrop-blur-sm min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">{t("dashboard.liveActivity")}</h2>
            <Link
              to="/events"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {t("dashboard.viewAll")} {"->"}
            </Link>
          </div>

          {!activity?.recentEvents || activity.recentEvents.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <Activity className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{t("dashboard.noRecentActivity")}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {activity.recentEvents.map((event: any) => {
                const camera = cameras.find((c) => c.id === event.camera_id);
                const eventIcon = event.event_type.includes("failed") || event.event_type.includes("error")
                  ? AlertCircle
                  : event.event_type.includes("started") || event.event_type.includes("online")
                  ? CheckCircle
                  : Activity;

                const EventIcon = eventIcon;

                return (
                  <div
                    key={event.id}
                    className="bg-gray-900/50 border border-gray-700/50 rounded px-3 py-2 hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <EventIcon
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          event.event_type.includes("failed") || event.event_type.includes("error")
                            ? "text-red-400"
                            : event.event_type.includes("started") || event.event_type.includes("online")
                            ? "text-green-400"
                            : "text-blue-400"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          {camera && (
                            <span className="text-xs text-gray-400 truncate">{camera.name}</span>
                          )}
                          <span className="text-xs text-gray-500">|</span>
                          <span className="text-xs text-gray-500">{event.event_type}</span>
                        </div>
                        <p className="text-sm text-white truncate">{event.message || "--"}</p>
                        <span className="text-xs text-gray-500">{timeAgo(event.created_at)}</span>
                      </div>
      </div>

    </div>
  );
              })}
            </div>
          )}
        </div>{/* Cameras & Agents */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-6 backdrop-blur-sm min-w-0">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">{t("dashboard.camerasAgents")}</h2>
            <Link
              to="/ai-agents"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {t("dashboard.manage")} {"->"}
            </Link>
          </div>

          {cameras.length === 0 ? (
            <div className="text-center text-gray-400 py-8">
              <Camera className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{t("dashboard.noCamerasConfigured")}</p>
              <Link to="/cameras" className="text-sm text-blue-400 hover:text-blue-300 mt-2 inline-block">
                {t("dashboard.addCamera")}
              </Link>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {cameras.map((camera: any) => {
                const cameraStats = perCamera[camera.id] || {};
                const isRunning = camera.is_service_running === 1;
                const isOnline = isRunning;

                return (
                  <div
                    key={camera.id}
                    className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-4 hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-white truncate">{camera.name}</h3>
                          <div className="flex gap-1">
                            <span
                              className={`px-2 py-0.5 text-xs rounded-full ${
                                isOnline
                                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                  : "bg-red-500/20 text-red-400 border border-red-500/30"
                              }`}
                            >
                              {isOnline ? t("dashboard.online") : t("dashboard.offline")}
                            </span>
                            <span
                              className={`px-2 py-0.5 text-xs rounded-full ${
                                isRunning
                                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                                  : "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                              }`}
                            >
                              {isRunning ? t("dashboard.running") : t("dashboard.stopped")}
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mt-2">
                          <div>
                            <span className="text-gray-500">{t("dashboard.agents")}:</span>{" "}
                            <span className="text-white">{cameraStats.enabled_agents_count || 0}</span>
                            {cameraStats.enabled_agents_types && cameraStats.enabled_agents_types.length > 0 && (
                              <span className="ml-1">
                                ({cameraStats.enabled_agents_types.slice(0, 2).join(", ")}
                                {cameraStats.enabled_agents_types.length > 2 && "..."})
                              </span>
                            )}
                          </div>
                          <div>
                            <span className="text-gray-500">{t("dashboard.detections24h")}:</span>{" "}
                            <span className="text-white">{cameraStats.detections_24h || 0}</span>
                          </div>
                          {cameraStats.last_started_at && (
                            <div>
                              <span className="text-gray-500">{t("dashboard.started")}:</span>{" "}
                              <span className="text-white">{timeAgo(cameraStats.last_started_at)}</span>
                            </div>
                          )}
                          {cameraStats.last_error_at && (
                            <div className="text-red-400">
                              <span className="text-gray-500">{t("dashboard.lastError")}:</span>{" "}
                              <span>{timeAgo(cameraStats.last_error_at)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <Link
                        to="/ai-agents"
                        className="ml-3 px-3 py-1.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-500/20 transition-colors whitespace-nowrap"
                      >
                        {t("dashboard.openAiAgents")}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      <div
        className={`fixed inset-0 z-[80] transition-opacity duration-200 ${
          isAlertPanelOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={closeAlertPanel}
        />
      </div>
      <div
        className={`fixed top-0 right-0 h-screen w-[360px] bg-gray-900/95 border-l border-gray-800 shadow-2xl z-[85] transition-transform duration-200 flex flex-col ${
          isAlertPanelOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold text-white">{t("dashboard.alertDetails")}</h3>
          <button
            type="button"
            onClick={closeAlertPanel}
            className="p-1 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 text-sm text-gray-300 space-y-2 flex-1 min-h-0 overflow-y-auto pr-2">
          {activeAlertHistory.length > 1 && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-widest text-red-200/90">
                    {i18n.language?.startsWith("pt") ? "Grupo de alertas" : "Alert group"}
                  </div>
                  <div className="mt-1 text-sm text-red-50">
                    {i18n.language?.startsWith("pt")
                      ? "A mesma card consolidou os alertas mais recentes deste agente."
                      : "This card consolidated the latest alerts from this agent."}
                  </div>
                </div>
                <div className="flex h-9 min-w-[2.25rem] items-center justify-center rounded-full border border-red-300/50 bg-red-500/90 px-2 text-sm font-bold text-white">
                  {activeAlertHistory.length}
                </div>
              </div>
            </div>
          )}
          {activeAlertIsJobTriggered && (
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-widest text-gray-400">{t("dashboard.severity")}</div>
              <div className="flex items-center gap-3">
                <div className="h-3 flex-1 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      panelPriorityBarClasses[
                        String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "")
                          .toUpperCase() === "MEDUIM"
                          ? "MEDIUM"
                          : String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "").toUpperCase()
                      ] || "bg-gray-600"
                    }`}
                    style={{
                      width:
                        panelPriorityWidths[
                          String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "")
                            .toUpperCase() === "MEDUIM"
                            ? "MEDIUM"
                            : String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "").toUpperCase()
                        ] || "40%",
                    }}
                  />
                </div>
                <div
                  className={`text-sm font-semibold ${
                    panelPriorityTextClasses[
                      String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "")
                        .toUpperCase() === "MEDUIM"
                        ? "MEDIUM"
                        : String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "").toUpperCase()
                    ] || "text-gray-300"
                  }`}
                >
                  {panelPriorityLabels[
                    String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "")
                      .toUpperCase() === "MEDUIM"
                      ? "MEDIUM"
                      : String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "").toUpperCase()
                  ] ||
                    String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "")
                      .toUpperCase()
                      .replace("MEDUIM", "MEDIUM") ||
                    t("dashboard.na")}
                </div>
              </div>
            </div>
          )}
          <div className="mt-4 bg-gray-800/60 border border-gray-700/60 rounded-xl p-4">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <AlertTriangle
                className={`w-4 h-4 ${
                  panelPriorityTextClasses[
                    String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "")
                      .toUpperCase() === "MEDUIM"
                      ? "MEDIUM"
                      : String(activeAlert?.priority_level || activeAlert?.details?.priority_level || "").toUpperCase()
                  ] || "text-gray-400"
                }`}
              />
              <span className="px-2 py-0.5 rounded-full bg-gray-900/60 text-gray-200 border border-gray-700">
                {(activeAlert?.details?.agent_key || activeAlert?.algo_type || "Alert").toString().toUpperCase()}
              </span>
            </div>
            <div className="text-sm text-gray-200">
              {activeAlertSummary || "-"}
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-gray-400 border-t border-gray-700/60 pt-3">
              <span>{t("dashboard.timestamp")}</span>
              <span className="text-gray-300">{activeAlertTimestampLabel}</span>
            </div>
          </div>
          {activeAlertCanPreview && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-widest text-gray-400">
                  {i18n.language?.startsWith("pt") ? "Midia do alerta" : "Alert media"}
                </div>
                <div className="flex items-center gap-2">
                  {activeAlertDownloadTarget && (
                    <button
                      type="button"
                      onClick={() => handleDownloadAlertMedia(activeAlertDownloadTarget, activeAlert)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-600 px-2.5 py-1 text-[11px] text-gray-200 hover:border-gray-400 hover:text-white transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {i18n.language?.startsWith("pt") ? "baixar" : "download"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openAlertMediaGallery(activeAlert)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-[11px] text-blue-100 hover:border-blue-400/50 hover:bg-blue-500/15 transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    {activeAlertHasImageAlbum
                      ? i18n.language?.startsWith("pt")
                        ? "abrir album"
                        : "open album"
                      : i18n.language?.startsWith("pt")
                      ? "visualizar"
                      : "preview"}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openAlertMediaGallery(activeAlert)}
                className="group relative w-full overflow-hidden rounded-xl border border-gray-700/60 bg-gray-900/70 text-left"
              >
                {activeAlertHasImageAlbum ? (
                  activeAlertPrimaryAlbumImage?.url ? (
                    <img
                      src={activeAlertPrimaryAlbumImage.url}
                      alt={String(activeAlert?.details?.camera_name || activeAlert?.camera_name || "Alert media")}
                      className="h-48 w-full object-cover"
                    />
                  ) : activeAlertPrimaryAlbumImage?.isOfflinePlaceholder ? (
                    <div className="flex h-48 w-full flex-col items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 text-red-200">
                      <Camera className="mb-2 h-8 w-8 opacity-90" />
                      <div className="text-sm font-medium">{t("dashboard.cameraOffline")}</div>
                    </div>
                  ) : (
                    <div className="flex h-48 w-full items-center justify-center text-sm text-gray-500">
                      {t("dashboard.noMediaAvailable")}
                    </div>
                  )
                ) : activeAlertMedia.isVideo ? (
                  <video
                    src={activeAlertMedia.mediaUrl || undefined}
                    className="h-48 w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : activeAlertMedia.mediaUrl ? (
                  <img
                    src={activeAlertMedia.mediaUrl}
                    alt={String(activeAlert?.details?.camera_name || activeAlert?.camera_name || "Alert media")}
                    className="h-48 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-48 w-full items-center justify-center text-sm text-gray-500">
                    {t("dashboard.noMediaAvailable")}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-85 transition-opacity group-hover:opacity-100" />
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs uppercase tracking-wide text-gray-300">
                      {activeAlert?.details?.camera_name || activeAlert?.camera_name || t("dashboard.camera")}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-white">
                      {activeAlertHasImageAlbum
                        ? i18n.language?.startsWith("pt")
                          ? "Abrir imagens do alerta"
                          : "Open alert images"
                        : activeAlertMedia.isVideo
                        ? i18n.language?.startsWith("pt")
                          ? "Abrir video do alerta"
                          : "Open alert video"
                        : i18n.language?.startsWith("pt")
                        ? "Abrir imagem do alerta"
                        : "Open alert image"}
                    </div>
                    {activeAlertMomentsCount > 0 && (
                      <div className="mt-1 text-xs text-emerald-200">
                        {i18n.language?.startsWith("pt")
                          ? `${activeAlertMomentsCount} momentos no album temporal`
                          : `${activeAlertMomentsCount} moments in the temporal album`}
                      </div>
                    )}
                  </div>
                  {activeAlertHasImageAlbum ? (
                    <div className="rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
                      {activeAlertMomentsCount}
                    </div>
                  ) : activeAlertMedia.isVideo ? (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-white">
                      <Play className="h-4 w-4" />
                    </div>
                  ) : null}
                </div>
              </button>
            </div>
          )}
          <div className="mt-4">
            <div className="text-xs uppercase tracking-widest text-gray-400 mb-2">{t("dashboard.origin")}</div>
            <div className="space-y-2">
              {activeAlertIsJobTriggered && (
                <>
                  <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <Layers className="w-4 h-4 text-purple-400" />
                      <span>{t("dashboard.job")}</span>
                    </div>
                    <div className="mt-1 text-sm text-gray-100">
                      {activeAlert?.details?.job_name || "--"}
                    </div>
                  </div>
                  <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <ChevronRight className="w-4 h-4 text-blue-400" />
                      <span>
                        {t("dashboard.step")} {activeAlert?.details?.step_order !== undefined ? activeAlert.details.step_order : "--"}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-100">
                      {activeAlert?.details?.step_name || "--"}
                    </div>
                  </div>
                </>
              )}
              <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <Camera className="w-4 h-4 text-green-400" />
                  <span>{t("dashboard.camera")}</span>
                </div>
                <div className="mt-1 text-sm text-gray-100">
                  {activeAlert?.details?.camera_name || activeAlert?.camera_name || "--"}
                </div>
              </div>
              <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <MapPin className="w-4 h-4 text-orange-400" />
                  <span>{t("dashboard.zone")}</span>
                </div>
                <div className="mt-1 text-sm text-gray-100">--</div>
              </div>
            </div>
          </div>
          {activeAlertHistory.length > 1 && (
            <div ref={emittedAlertsSectionRef} className="relative mt-5 scroll-mt-6">
              {highlightEmittedAlerts && (
                <>
                  <div className="pointer-events-none absolute -inset-2 rounded-[1.6rem] bg-red-500/12 blur-xl" />
                  <div className="pointer-events-none absolute -inset-1 rounded-[1.45rem] border border-red-400/40 shadow-[0_0_34px_rgba(248,113,113,0.24)] animate-pulse" />
                </>
              )}
              <div
                className={`relative rounded-2xl transition-all duration-500 ${
                  highlightEmittedAlerts ? "bg-red-500/[0.04] px-2 py-2" : ""
                }`}
              >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-widest text-gray-400">
                  {i18n.language?.startsWith("pt") ? "Alertas emitidos" : "Emitted alerts"}
                </div>
                <div className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-100">
                  {activeAlertHistory.length}
                </div>
              </div>
              <div className="mb-2 text-[11px] text-gray-500">
                {i18n.language?.startsWith("pt")
                  ? "Selecione um item abaixo para trocar a resposta e a midia exibidas."
                  : "Select an item below to switch the displayed answer and media."}
              </div>
              <div className="relative">
                {highlightEmittedAlerts && (
                  <div className="pointer-events-none absolute -inset-2 rounded-[1.3rem] border-2 border-red-400/55 shadow-[0_0_28px_rgba(239,68,68,0.22)]" />
                )}
              <div className="space-y-2">
                {activeAlertHistory.map((groupAlert: any) => {
                  const groupAlertId = Number(groupAlert?.id);
                  const isSelected =
                    Number.isInteger(groupAlertId) &&
                    groupAlertId > 0 &&
                    groupAlertId === Number(activeAlert?.id);
                  const groupAlertDetails = groupAlert?.details || {};
                  const groupAlertSummary =
                    readAlertLabelString(
                      groupAlertDetails?.answer,
                      groupAlert?.message,
                      groupAlertDetails?.summary,
                      groupAlertDetails?.reason,
                    ) || "-";
                  const groupAlertTimestamp = formatAlertTimestamp(
                    groupAlert?.detected_at || groupAlert?.created_at || null,
                  );
                  const groupAlertMetaParts = [
                    groupAlertDetails?.job_name
                      ? `${t("dashboard.job")}: ${groupAlertDetails.job_name}`
                      : null,
                    groupAlertDetails?.step_order !== undefined
                      ? `${t("dashboard.step")}: ${groupAlertDetails.step_order}`
                      : null,
                    groupAlertDetails?.camera_name || groupAlert?.camera_name
                      ? `${t("dashboard.camera")}: ${groupAlertDetails?.camera_name || groupAlert?.camera_name}`
                      : null,
                  ].filter(Boolean);

                  return (
                    <button
                      key={groupAlert?.id ?? groupAlertTimestamp}
                      type="button"
                      onClick={() => setActiveAlert(groupAlert)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-red-400/40 bg-red-500/10"
                          : "border-gray-700/60 bg-gray-800/60 hover:border-gray-500"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs text-gray-400">
                            #{groupAlert?.id ?? "--"}
                          </div>
                          <div className="mt-1 text-sm text-gray-100 line-clamp-2">
                            {groupAlertSummary}
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-gray-400">
                          {groupAlertTimestamp}
                        </div>
                      </div>
                      {groupAlertMetaParts.length > 0 && (
                        <div className="mt-2 text-[11px] text-gray-400">
                          {groupAlertMetaParts.join(" • ")}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              </div>
              </div>
            </div>
          )}
          <div className="mt-5">
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-gray-400 mb-2">
              <Sparkles className="w-4 h-4 text-blue-300" />
              <span>{t("dashboard.executedPrompt")}</span>
            </div>
            <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-4 text-sm text-gray-200 italic whitespace-pre-wrap">
              {activeAlert?.details?.prompt_template
                ? `"${String(activeAlert.details.prompt_template).trim()}"`
                : "-"}
            </div>
          </div>
          <div className="mt-5">
            <div className="text-xs uppercase tracking-widest text-gray-400 mb-2">{t("dashboard.actions")}</div>
            <div className="space-y-2">
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-emerald-900/50 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-900/70 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                {t("dashboard.acknowledgeAlert")}
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-orange-900/40 text-orange-300 border border-orange-700/40 hover:bg-orange-900/60 transition-colors"
              >
                <PhoneCall className="w-4 h-4" />
                {t("dashboard.escalateSupervisor")}
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-slate-800/70 text-slate-200 border border-slate-700/60 hover:bg-slate-800 transition-colors"
              >
                <FileText className="w-4 h-4" />
                {t("dashboard.addNote")}
              </button>
              {activeAlertCanBeDeleted && (
                <button
                  type="button"
                  onClick={requestDeleteFalsePositive}
                  disabled={isDeletingFalsePositive}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-rose-900/40 text-rose-300 border border-rose-700/40 hover:bg-rose-900/60 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  {isDeletingFalsePositive ? t("dashboard.removing") : t("dashboard.removeAlert")}
                </button>
              )}
              <button
                type="button"
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium bg-blue-900/40 text-blue-300 border border-blue-700/40 hover:bg-blue-900/60 transition-colors"
              >
                <Download className="w-4 h-4" />
                {t("dashboard.exportVideo")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { cameras } = useDashboardSummary();

  return (
    <Layout>
      <EventsProvider cameras={cameras}>
        <DashboardContent />
      </EventsProvider>
    </Layout>
  );
}







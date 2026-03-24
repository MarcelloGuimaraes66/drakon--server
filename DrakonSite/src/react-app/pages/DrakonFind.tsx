import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import Toast from "@/react-app/components/Toast";
import BrazilStateTileMap from "@/react-app/components/BrazilStateTileMap";
import type {
  DrakonFindAuditLog,
  DrakonFindHit,
  DrakonFindScopeResolution,
  DrakonFindSearch,
  DrakonFindTarget,
  DrakonFindTargetImage,
} from "@/shared/types";
import {
  Activity,
  Ban,
  Camera,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  MapPin,
  Maximize2,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

type ToastState = {
  message: string;
  type: "success" | "error" | "warning" | "info";
} | null;

const ENTITY_TYPE_OPTIONS = ["person", "object", "car", "motorcycle", "animal", "custom"] as const;

const SEARCH_DURATION_OPTIONS = [1800, 3600, 21600, 43200, 86400, 604800, 2592000] as const;

const ACTIVE_SEARCH_STATUSES = ["queued", "dispatching", "running"];
const STATUS_TRANSLATION_KEYS: Record<string, string> = {
  queued: "drakonFind.status.queued",
  dispatching: "drakonFind.status.dispatching",
  running: "drakonFind.status.running",
  completed: "drakonFind.status.completed",
  cancelled: "drakonFind.status.cancelled",
  failed: "drakonFind.status.failed",
  paused: "drakonFind.status.paused",
};
const STATUS_STYLES: Record<string, string> = {
  queued: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
  dispatching: "border-sky-500/30 bg-sky-500/10 text-sky-200",
  running: "border-blue-500/30 bg-blue-500/10 text-blue-100",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
  cancelled: "border-gray-500/30 bg-gray-500/10 text-gray-200",
  failed: "border-red-500/30 bg-red-500/10 text-red-100",
  paused: "border-amber-500/30 bg-amber-500/10 text-amber-100",
};

const SEARCH_DURATION_TRANSLATION_KEYS: Record<number, string> = {
  1800: "drakonFind.searchComposer.durationOption.1800",
  3600: "drakonFind.searchComposer.durationOption.3600",
  21600: "drakonFind.searchComposer.durationOption.21600",
  43200: "drakonFind.searchComposer.durationOption.43200",
  86400: "drakonFind.searchComposer.durationOption.86400",
  604800: "drakonFind.searchComposer.durationOption.604800",
  2592000: "drakonFind.searchComposer.durationOption.2592000",
};

const SEARCH_MESSAGE_TRANSLATION_KEYS: Record<string, string> = {
  "Uma parte do escopo ja esta ao vivo; outras cameras aguardam slot livre nos clientes elegiveis.":
    "drakonFind.runtime.wait.runningBlockedClient",
  "Uma parte do escopo ja esta ao vivo; outras cameras ainda aguardam roteamento para um cliente elegivel.":
    "drakonFind.runtime.wait.runningUnresolvedAssignment",
  "Parte do escopo ja foi despachada; outras cameras aguardam slot livre nos clientes elegiveis.":
    "drakonFind.runtime.wait.dispatchingBlockedClient",
  "Parte do escopo ja foi despachada; outras cameras ainda aguardam roteamento para um cliente elegivel.":
    "drakonFind.runtime.wait.dispatchingUnresolvedAssignment",
  "Aguardando slot livre nos clientes elegiveis para continuar a distribuicao.":
    "drakonFind.runtime.wait.queuedBlockedClient",
  "Ainda existem cameras aguardando roteamento para um cliente elegivel.":
    "drakonFind.runtime.wait.queuedUnresolvedAssignment",
};

const DRAKON_FIND_MAX_TARGET_IMAGES = 6;
const DRAKON_FIND_TARGET_IMAGE_MAX_BYTES = 1_500_000;

function getLocaleTag(language?: string) {
  const normalized = String(language || "en").toLowerCase();
  if (normalized.startsWith("pt")) return "pt-BR";
  if (normalized.startsWith("es")) return "es-ES";
  if (normalized.startsWith("fr")) return "fr-FR";
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("ar")) return "ar";
  return "en-US";
}

function formatMegabyteLimit(bytes: number) {
  const megabytes = bytes / 1_000_000;
  return `${Number.isInteger(megabytes) ? megabytes.toFixed(0) : megabytes.toFixed(1)}MB`;
}

function getEntityTypeLabel(value: string, t: TFunction) {
  const key = `drakonFind.targetForm.entityType.${value}`;
  const translated = t(key);
  return translated === key ? value : translated;
}

function getSearchDurationLabel(seconds: number | null | undefined, t?: TFunction) {
  const numeric = typeof seconds === "number" ? seconds : Number(seconds);
  const key = SEARCH_DURATION_TRANSLATION_KEYS[numeric];
  if (key && t) return t(key);
  if (!Number.isFinite(numeric) || numeric <= 0) return "--";
  if (!t) {
    if (numeric % 86400 === 0) return `${numeric / 86400} day(s)`;
    if (numeric % 3600 === 0) return `${numeric / 3600} h`;
    return `${Math.round(numeric / 60)} min`;
  }
  if (numeric % 86400 === 0) return t("drakonFind.searchComposer.durationDays", { count: numeric / 86400 });
  if (numeric % 3600 === 0) return t("drakonFind.searchComposer.durationHours", { count: numeric / 3600 });
  return t("drakonFind.searchComposer.durationMinutes", { count: Math.round(numeric / 60) });
}

function getStatusLabel(status: string, t: TFunction) {
  const key = STATUS_TRANSLATION_KEYS[status];
  return key ? t(key) : status;
}

function getDrakonFindTargetImageUploadError(files: File[], t: TFunction, existingCount = 0) {
  if (!files.length) return null;
  if (existingCount + files.length > DRAKON_FIND_MAX_TARGET_IMAGES) {
    return t("drakonFind.validation.maxImages", { count: DRAKON_FIND_MAX_TARGET_IMAGES });
  }
  for (const file of files) {
    const fileName = file?.name?.trim() || t("drakonFind.validation.fileFallback");
    if (!String(file?.type || "").toLowerCase().startsWith("image/")) {
      return t("drakonFind.validation.invalidImage", { fileName });
    }
    if (typeof file?.size === "number" && file.size > DRAKON_FIND_TARGET_IMAGE_MAX_BYTES) {
      return t("drakonFind.validation.imageTooLarge", {
        fileName,
        limit: formatMegabyteLimit(DRAKON_FIND_TARGET_IMAGE_MAX_BYTES),
      });
    }
  }
  return null;
}

function normalizeDrakonFindTargetImage(value: unknown): DrakonFindTargetImage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<DrakonFindTargetImage> & Record<string, unknown>;
  const id = Number(row.id || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const targetId = Number(row.target_id || 0);
  const imageUrl = typeof row.image_url === "string" ? row.image_url.trim() : "";
  if (!imageUrl) return null;
  return {
    id,
    target_id: Number.isInteger(targetId) && targetId > 0 ? targetId : 0,
    image_url: imageUrl,
    content_type: typeof row.content_type === "string" ? row.content_type : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

function normalizeDrakonFindTarget(value: unknown): DrakonFindTarget | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<DrakonFindTarget> & Record<string, unknown>;
  const id = Number(row.id || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const images = Array.isArray(row.images)
    ? row.images
        .map((image) => normalizeDrakonFindTargetImage(image))
        .filter((image): image is DrakonFindTargetImage => Boolean(image))
    : [];
  const numericImageCount = Number(row.image_count ?? images.length);
  return {
    id,
    user_id: typeof row.user_id === "string" ? row.user_id : "",
    entity_type: typeof row.entity_type === "string" ? row.entity_type : "",
    name: typeof row.name === "string" ? row.name : "",
    description: typeof row.description === "string" ? row.description : "",
    traits: Array.isArray(row.traits) ? row.traits.map((item) => String(item || "").trim()).filter(Boolean) : [],
    images,
    image_count:
      Number.isFinite(numericImageCount) && numericImageCount >= 0
        ? Math.max(images.length, Math.floor(numericImageCount))
        : images.length,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    search_count: Number(row.search_count || 0),
    queued_search_count: Number(row.queued_search_count || 0),
    running_search_count: Number(row.running_search_count || 0),
    last_search_at: typeof row.last_search_at === "string" ? row.last_search_at : null,
  };
}

function formatDateTime(value?: string | null, localeTag = "en-US") {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat(localeTag, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatRelative(value?: string | null, localeTag = "en-US") {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  const diff = date.getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 60) {
    return new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" }).format(mins, "minute");
  }
  const hours = Math.round(diff / 3600000);
  if (Math.abs(hours) < 24) {
    return new Intl.RelativeTimeFormat(localeTag, { numeric: "auto" }).format(hours, "hour");
  }
  return formatDateTime(value, localeTag);
}

function formatConfidence(value?: number | null) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${Math.round(Math.max(0, Math.min(1, numeric)) * 100)}%`;
}

function formatAssignedClientLabel(count: number, t: TFunction) {
  return t("drakonFind.operations.clientsAssigned", { count });
}

function isInformationalSearchMessage(value?: string | null) {
  if (!value) return false;
  return Object.keys(SEARCH_MESSAGE_TRANSLATION_KEYS).some((message) => value.startsWith(message));
}

function translateSearchMessage(value: string | null | undefined, t: TFunction) {
  if (!value) return "";
  const key = SEARCH_MESSAGE_TRANSLATION_KEYS[value];
  return key ? t(key) : value;
}

function getTargetDeletionBlockReason(target: DrakonFindTarget | null | undefined, t: TFunction) {
  if (!target) return null;
  const linkedSearchCount = Number(target.search_count || 0);
  if (linkedSearchCount <= 0) return null;
  return linkedSearchCount === 1
    ? t("drakonFind.validation.removeLinkedSearchBeforeDelete")
    : t("drakonFind.validation.removeLinkedSearchesBeforeDelete", { count: linkedSearchCount });
}

function findNearestScrollContainer(element: HTMLElement | null) {
  if (typeof window === "undefined") return null;
  let current = element?.parentElement || null;
  while (current) {
    const styles = window.getComputedStyle(current);
    const isScrollable = /(auto|scroll|overlay)/.test(styles.overflowY || "");
    if (isScrollable && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subtext,
}: {
  icon: typeof Radar;
  label: string;
  value: string | number;
  subtext: string;
}) {
  return (
    <div className="rounded-[24px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.34)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</span>
        <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-2 text-blue-300">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="text-3xl font-semibold text-gray-100">{value}</div>
      <p className="mt-2 text-sm text-gray-400">{subtext}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${STATUS_STYLES[status] || "border-gray-700 bg-gray-800 text-gray-200"}`}>
      {getStatusLabel(status, t)}
    </span>
  );
}

function ImageGrid({
  images,
  deletingImageId,
  onDelete,
}: {
  images: DrakonFindTargetImage[];
  deletingImageId: number | null;
  onDelete: (imageId: number) => void;
}) {
  const { t } = useTranslation();
  if (!images.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-6 text-sm text-gray-400">
        {t("drakonFind.generic.noReferenceImages")}
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {images.map((image) => (
        <div key={image.id} className="relative overflow-hidden rounded-[20px] border border-gray-800 bg-gray-950/70">
          <img src={image.image_url} alt={t("drakonFind.generic.targetImageAlt")} className="h-36 w-full object-cover" />
          <button
            type="button"
            onClick={() => onDelete(image.id)}
            disabled={deletingImageId === image.id}
            className="absolute right-3 top-3 inline-flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-red-100 disabled:opacity-60"
          >
            {deletingImageId === image.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      ))}
    </div>
  );
}

function HitVideoModal({
  hit,
  onClose,
}: {
  hit: DrakonFindHit | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!hit?.video_url) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/78 px-4 py-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_26%),linear-gradient(180deg,rgba(7,10,19,0.96),rgba(3,6,15,0.98))] p-4 shadow-[0_30px_140px_rgba(2,8,23,0.78)] md:p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex items-center justify-center rounded-2xl border border-white/10 bg-black/35 p-2 text-white/80 transition hover:border-cyan-400/30 hover:bg-cyan-500/10 hover:text-cyan-100"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 pr-12">
          <div className="text-lg font-semibold text-gray-100">{hit.camera_name || t("drakonFind.generic.unnamedCamera")}</div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-300">{hit.summary}</p>
        </div>
        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black">
          <video
            src={hit.video_url}
            poster={hit.image_url || undefined}
            controls
            autoPlay
            preload="metadata"
            playsInline
            className="max-h-[72vh] w-full bg-black object-contain"
          />
        </div>
      </div>
    </div>
  );
}

export default function DrakonFindPage() {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.resolvedLanguage || i18n.language || "en";
  const localeTag = useMemo(() => getLocaleTag(currentLanguage), [currentLanguage]);
  const createTargetCardRef = useRef<HTMLDivElement | null>(null);
  const selectedTargetCardRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoreRef = useRef<{ container: HTMLElement | null; top: number; left: number } | null>(null);
  const [targets, setTargets] = useState<DrakonFindTarget[]>([]);
  const [searches, setSearches] = useState<DrakonFindSearch[]>([]);
  const [audit, setAudit] = useState<DrakonFindAuditLog[]>([]);
  const [hits, setHits] = useState<DrakonFindHit[]>([]);
  const [scope, setScope] = useState<DrakonFindScopeResolution | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<number | null>(null);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [savingTarget, setSavingTarget] = useState(false);
  const [creatingSearch, setCreatingSearch] = useState(false);
  const [uploadingTargetId, setUploadingTargetId] = useState<number | null>(null);
  const [deletingTargetId, setDeletingTargetId] = useState<number | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [deletingHitId, setDeletingHitId] = useState<number | null>(null);
  const [actingSearchId, setActingSearchId] = useState<number | null>(null);
  const [expandedHit, setExpandedHit] = useState<DrakonFindHit | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [targetFiles, setTargetFiles] = useState<File[]>([]);
  const [selectedTargetNewFiles, setSelectedTargetNewFiles] = useState<File[]>([]);
  const [excludedCameraIds, setExcludedCameraIds] = useState<number[]>([]);
  const [searchDurationSeconds, setSearchDurationSeconds] = useState<number>(1800);
  const [targetForm, setTargetForm] = useState({ entity_type: "object", name: "", description: "", traits: "" });

  const deferredSelectedStates = useDeferredValue(selectedStates);
  const selectedTarget = useMemo(() => targets.find((row) => row.id === selectedTargetId) || null, [selectedTargetId, targets]);
  const activeSearches = useMemo(() => searches.filter((row) => ACTIVE_SEARCH_STATUSES.includes(row.status)), [searches]);
  const scopeStateCounts = useMemo(() => Object.fromEntries((scope?.states || []).map((row) => [row.state_code, Number(row.camera_count || 0)])), [scope]);
  const scopeCameraIds = useMemo(() => new Set((scope?.cameras || []).map((camera) => camera.id)), [scope]);
  const excludedScopeCameraIds = useMemo(
    () => excludedCameraIds.filter((cameraId) => scopeCameraIds.has(cameraId)),
    [excludedCameraIds, scopeCameraIds]
  );
  const excludedScopeCameraIdSet = useMemo(() => new Set(excludedScopeCameraIds), [excludedScopeCameraIds]);
  const scopePreviewCameras = useMemo(() => scope?.cameras || [], [scope]);
  const includedScopeCameras = useMemo(
    () => scopePreviewCameras.filter((camera) => !excludedScopeCameraIdSet.has(camera.id)),
    [scopePreviewCameras, excludedScopeCameraIdSet]
  );
  const includedOwnerCount = useMemo(
    () =>
      new Set(
        includedScopeCameras
          .map((camera) => (typeof camera.user_id === "string" ? camera.user_id.trim() : ""))
          .filter((value) => value.length > 0)
      ).size,
    [includedScopeCameras]
  );
  const effectiveEligibleCameraCount = includedScopeCameras.length;
  const canCreateSearch = Boolean(selectedTarget) && selectedStates.length > 0 && effectiveEligibleCameraCount > 0;
  const searchHitCounts = useMemo(() => hits.reduce<Record<number, number>>((acc, hit) => {
    acc[hit.search_id] = (acc[hit.search_id] || 0) + 1;
    return acc;
  }, {}), [hits]);
  const heroCards = [
    { icon: ShieldCheck, title: t("drakonFind.hero.dispatchTitle"), text: t("drakonFind.hero.dispatchText") },
    { icon: ImagePlus, title: t("drakonFind.hero.visualTitle"), text: t("drakonFind.hero.visualText") },
    { icon: Activity, title: t("drakonFind.hero.runtimeTitle"), text: t("drakonFind.hero.runtimeText") },
    { icon: FileText, title: t("drakonFind.hero.auditTitle"), text: t("drakonFind.hero.auditText") },
  ];
  const validateTargetImageFiles = (files: File[], existingCount = 0) => {
    const errorMessage = getDrakonFindTargetImageUploadError(files, t, existingCount);
    if (errorMessage) {
      setToast({ message: errorMessage, type: "warning" });
      return false;
    }
    return true;
  };

  const captureScrollPosition = (element?: HTMLElement | null) => {
    if (typeof window === "undefined") return;
    const container = findNearestScrollContainer(
      element || selectedTargetCardRef.current || createTargetCardRef.current
    );
    scrollRestoreRef.current = container
      ? { container, top: container.scrollTop, left: container.scrollLeft }
      : { container: null, top: window.scrollY, left: window.scrollX };
  };

  const restoreScrollPosition = () => {
    if (typeof window === "undefined") return;
    const snapshot = scrollRestoreRef.current;
    if (!snapshot) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (snapshot.container) {
          snapshot.container.scrollTo({
            top: snapshot.top,
            left: snapshot.left,
            behavior: "auto",
          });
          return;
        }
        window.scrollTo({ top: snapshot.top, left: snapshot.left, behavior: "auto" });
      });
    });
  };

  const loadCollections = async (showLoading = false, preferredSelectedTargetId: number | null = null) => {
    if (showLoading) setLoading(true);
    try {
      const [targetsRes, searchesRes, auditRes, hitsRes] = await Promise.all([
        fetch("/api/drakon-find/targets", { cache: "no-store" }),
        fetch("/api/drakon-find/searches", { cache: "no-store" }),
        fetch("/api/drakon-find/audit?limit=40", { cache: "no-store" }),
        fetch("/api/drakon-find/hits?limit=40", { cache: "no-store" }),
      ]);
      const [targetsData, searchesData, auditData, hitsData] = await Promise.all([
        targetsRes.json(),
        searchesRes.json(),
        auditRes.json(),
        hitsRes.json(),
      ]);
      if (!targetsRes.ok || !searchesRes.ok || !auditRes.ok || !hitsRes.ok) {
        throw new Error(t("drakonFind.toast.panelLoadFailed"));
      }
      startTransition(() => {
        const nextTargets = Array.isArray(targetsData?.targets)
          ? targetsData.targets
              .map((target: unknown) => normalizeDrakonFindTarget(target))
              .filter((target: DrakonFindTarget | null): target is DrakonFindTarget => Boolean(target))
          : [];
        setTargets(nextTargets);
        setSearches(Array.isArray(searchesData?.searches) ? searchesData.searches : []);
        setAudit(Array.isArray(auditData?.audit) ? auditData.audit : []);
        setHits(Array.isArray(hitsData?.hits) ? hitsData.hits : []);
        setSelectedTargetId((current) => {
          if (
            Number.isInteger(preferredSelectedTargetId) &&
            preferredSelectedTargetId !== null &&
            nextTargets.some((row: DrakonFindTarget) => row.id === preferredSelectedTargetId)
          ) {
            return preferredSelectedTargetId;
          }
          return current && nextTargets.some((row: DrakonFindTarget) => row.id === current)
            ? current
            : nextTargets?.[0]?.id ?? null;
        });
      });
    } catch (error) {
      console.error("[DRAKON FIND] load failed", error);
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.loadFailed"),
        type: "error",
      });
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    void loadCollections(true);
  }, [currentLanguage]);

  useEffect(() => {
    const interval = window.setInterval(() => void loadCollections(false), 5000);
    return () => window.clearInterval(interval);
  }, [currentLanguage]);

  useEffect(() => {
    if (!expandedHit) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedHit(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedHit]);

  useEffect(() => {
    let cancelled = false;
    if (!deferredSelectedStates.length) {
      setScope(null);
      setScopeLoading(false);
      return;
    }
    setScopeLoading(true);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/drakon-find/scope/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_states: deferredSelectedStates, country_code: "BR" }),
        });
        if (!response.ok) throw new Error(t("drakonFind.toast.scopeResolveFailed"));
        const data = await response.json();
        if (!cancelled) startTransition(() => setScope(data?.scope || null));
      } catch (error) {
        console.error("[DRAKON FIND] scope failed", error);
        if (!cancelled) setScope(null);
      } finally {
        if (!cancelled) setScopeLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredSelectedStates]);

  useEffect(() => {
    if (!selectedStates.length) {
      setExcludedCameraIds([]);
      return;
    }
    if (!scope) return;
    const eligibleCameraIds = new Set((scope.cameras || []).map((camera) => camera.id));
    setExcludedCameraIds((current) => current.filter((cameraId) => eligibleCameraIds.has(cameraId)));
  }, [scope, selectedStates]);

  const uploadImagesToTarget = async (targetId: number, files: File[]) => {
    if (!files.length) return;
    captureScrollPosition(selectedTargetCardRef.current);
    const target = targets.find((row) => row.id === targetId) || null;
    const existingCount = target
      ? Math.max(Array.isArray(target.images) ? target.images.length : 0, Number(target.image_count || 0))
      : 0;
    const validationError = getDrakonFindTargetImageUploadError(files, t, existingCount);
    if (validationError) throw new Error(validationError);
    setUploadingTargetId(targetId);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("image", file);
        const response = await fetch(`/api/drakon-find/targets/${targetId}/images`, { method: "POST", body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.imageUploadFailed"));
      }
      await loadCollections(false, targetId);
    } finally {
      setUploadingTargetId(null);
      restoreScrollPosition();
    }
  };

  const handleCreateTarget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    captureScrollPosition(createTargetCardRef.current);
    setSavingTarget(true);
    try {
      const filesToUpload = [...targetFiles];
      if (filesToUpload.length && !validateTargetImageFiles(filesToUpload, 0)) {
        return;
      }
      const response = await fetch("/api/drakon-find/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: targetForm.entity_type,
          name: targetForm.name,
          description: targetForm.description,
          traits: targetForm.traits.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.targetCreateFailed"));
      const createdTargetId = Number(data?.target?.id || 0);
      if (createdTargetId <= 0) throw new Error(t("drakonFind.toast.targetCreateFailed"));

      await loadCollections(false, createdTargetId);
      setSelectedTargetNewFiles([]);

      if (filesToUpload.length) {
        try {
          await uploadImagesToTarget(createdTargetId, filesToUpload);
          setSelectedTargetId(createdTargetId);
          setToast({ message: t("drakonFind.toast.targetCreatedWithImages"), type: "success" });
        } catch (uploadError) {
          await loadCollections(false, createdTargetId);
          setSelectedTargetId(createdTargetId);
          setSelectedTargetNewFiles(filesToUpload);
          setToast({
            message:
              uploadError instanceof Error
                ? t("drakonFind.toast.targetCreatedUploadFailedWithError", { error: uploadError.message })
                : t("drakonFind.toast.targetCreatedUploadFailed"),
            type: "warning",
          });
        }
      } else {
        setToast({ message: t("drakonFind.toast.targetCreated"), type: "success" });
      }
      setTargetForm({ entity_type: "object", name: "", description: "", traits: "" });
      setTargetFiles([]);
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.targetCreateFailed"),
        type: "error",
      });
    } finally {
      setSavingTarget(false);
      restoreScrollPosition();
    }
  };

  const handleCreateSearch = async () => {
    if (!selectedTarget) return setToast({ message: t("drakonFind.toast.selectTargetFirst"), type: "warning" });
    if (!selectedStates.length) return setToast({ message: t("drakonFind.toast.selectStateFirst"), type: "warning" });
    if (effectiveEligibleCameraCount <= 0) {
      return setToast({ message: t("drakonFind.toast.reactivateCameraFirst"), type: "warning" });
    }
    setCreatingSearch(true);
    try {
      const response = await fetch("/api/drakon-find/searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_id: selectedTarget.id,
          selected_states: selectedStates,
          country_code: "BR",
          duration_seconds: searchDurationSeconds,
          excluded_camera_ids: excludedScopeCameraIds,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.searchCreateFailed"));
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.searchCreated"), type: "success" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.searchCreateFailed"),
        type: "error",
      });
    } finally {
      setCreatingSearch(false);
    }
  };

  const handleCancelSearch = async (searchId: number) => {
    setActingSearchId(searchId);
    try {
      const response = await fetch(`/api/drakon-find/searches/${searchId}/cancel`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.searchCancelFailed"));
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.searchCancelled"), type: "info" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.searchCancelFailed"),
        type: "error",
      });
    } finally {
      setActingSearchId(null);
    }
  };

  const handleRetrySearch = async (searchId: number) => {
    setActingSearchId(searchId);
    try {
      const response = await fetch(`/api/drakon-find/searches/${searchId}/retry`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.searchRetryFailed"));
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.searchRetried"), type: "success" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.searchRetryFailed"),
        type: "error",
      });
    } finally {
      setActingSearchId(null);
    }
  };

  const handleDeleteSearch = async (searchId: number) => {
    setActingSearchId(searchId);
    try {
      const response = await fetch(`/api/drakon-find/searches/${searchId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.searchDeleteFailed"));
      if (expandedHit?.search_id === searchId) setExpandedHit(null);
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.searchDeleted"), type: "info" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.searchDeleteFailed"),
        type: "error",
      });
    } finally {
      setActingSearchId(null);
    }
  };

  const handleDeleteTargetImage = async (targetId: number, imageId: number) => {
    setDeletingImageId(imageId);
    try {
      const response = await fetch(`/api/drakon-find/targets/${targetId}/images/${imageId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.imageDeleteFailed"));
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.imageDeleted"), type: "info" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.imageDeleteFailed"),
        type: "error",
      });
    } finally {
      setDeletingImageId(null);
    }
  };

  const handleDeleteTarget = async (target: DrakonFindTarget) => {
    const blockReason = getTargetDeletionBlockReason(target, t);
    if (blockReason) {
      setToast({ message: blockReason, type: "warning" });
      return;
    }
    const confirmed = window.confirm(t("drakonFind.confirm.deleteTarget", { name: target.name }));
    if (!confirmed) return;

    setDeletingTargetId(target.id);
    try {
      const response = await fetch(`/api/drakon-find/targets/${target.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.targetDeleteFailed"));
      if (selectedTargetId === target.id) {
        setSelectedTargetNewFiles([]);
      }
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.targetDeleted"), type: "info" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.targetDeleteFailed"),
        type: "error",
      });
    } finally {
      setDeletingTargetId(null);
    }
  };

  const handleDeleteHit = async (hit: DrakonFindHit) => {
    const confirmed = window.confirm(
      t("drakonFind.confirm.deleteHit", { cameraName: hit.camera_name || t("drakonFind.generic.unnamedCamera") })
    );
    if (!confirmed) return;

    setDeletingHitId(hit.id);
    try {
      const response = await fetch(`/api/drakon-find/hits/${hit.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || t("drakonFind.toast.hitDeleteFailed"));
      if (expandedHit?.id === hit.id) setExpandedHit(null);
      await loadCollections(false);
      setToast({ message: t("drakonFind.toast.hitDeleted"), type: "info" });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : t("drakonFind.toast.hitDeleteFailed"),
        type: "error",
      });
    } finally {
      setDeletingHitId(null);
    }
  };

  const selectedTargetDeletionBlockReason = selectedTarget
    ? getTargetDeletionBlockReason(selectedTarget, t)
    : null;

  return (
    <Layout>
      <div className="space-y-6">
        <section className="rounded-[32px] border border-blue-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_28%),radial-gradient(circle_at_right,rgba(37,99,235,0.22),transparent_36%),linear-gradient(135deg,rgba(8,12,20,0.98),rgba(4,8,16,0.96))] p-6 shadow-[0_30px_120px_rgba(4,12,28,0.38)] md:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">
                <Radar className="h-3.5 w-3.5" />
                {t("drakonFind.hero.badge")}
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-gray-100 md:text-4xl">
                {t("drakonFind.hero.title")}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-gray-300 md:text-base">
                {t("drakonFind.hero.subtitle")}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {heroCards.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-[24px] border border-blue-500/20 bg-gray-950/50 p-4">
                  <div className="mb-3 flex items-center gap-2 text-blue-200">
                    <Icon className="h-4 w-4" />
                    <span className="text-xs font-semibold uppercase tracking-[0.18em]">{title}</span>
                  </div>
                  <p className="text-sm text-gray-300">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Target} label={t("drakonFind.metrics.targetsLabel")} value={targets.length} subtext={t("drakonFind.metrics.targetsText")} />
          <MetricCard icon={Activity} label={t("drakonFind.metrics.activeLabel")} value={activeSearches.length} subtext={t("drakonFind.metrics.activeText")} />
          <MetricCard icon={Eye} label={t("drakonFind.metrics.hitsLabel")} value={hits.length} subtext={t("drakonFind.metrics.hitsText")} />
          <MetricCard icon={Camera} label={t("drakonFind.metrics.scopeLabel")} value={effectiveEligibleCameraCount} subtext={t("drakonFind.metrics.scopeText")} />
        </section>

        <section className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
            <div ref={createTargetCardRef} className="rounded-[28px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-3 text-blue-300"><Target className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-semibold text-gray-100">{t("drakonFind.targetForm.title")}</p>
                  <p className="text-sm text-gray-400">{t("drakonFind.targetForm.subtitle")}</p>
                </div>
              </div>
              <form onSubmit={handleCreateTarget} className="space-y-4">
                <select value={targetForm.entity_type} onChange={(event) => setTargetForm((current) => ({ ...current, entity_type: event.target.value }))} className="w-full rounded-2xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm text-gray-100">
                  {ENTITY_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{getEntityTypeLabel(option, t)}</option>)}
                </select>
                <input value={targetForm.name} onChange={(event) => setTargetForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("drakonFind.targetForm.namePlaceholder")} className="w-full rounded-2xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm text-gray-100" />
                <textarea value={targetForm.description} onChange={(event) => setTargetForm((current) => ({ ...current, description: event.target.value }))} rows={5} placeholder={t("drakonFind.targetForm.descriptionPlaceholder")} className="w-full rounded-2xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm text-gray-100" />
                <input value={targetForm.traits} onChange={(event) => setTargetForm((current) => ({ ...current, traits: event.target.value }))} placeholder={t("drakonFind.targetForm.traitsPlaceholder")} className="w-full rounded-2xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm text-gray-100" />
                <label onPointerDown={(event) => captureScrollPosition(event.currentTarget)} className="block rounded-[22px] border border-dashed border-gray-700 bg-gray-950/70 px-4 py-4 text-sm text-gray-300">
                  <div className="flex items-center gap-3">
                    <ImagePlus className="h-4 w-4 text-cyan-300" />
                    <span>{t("drakonFind.targetForm.selectImages")}</span>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const files = Array.from(event.target.files || []);
                      if (!files.length) {
                        setTargetFiles([]);
                        event.currentTarget.value = "";
                        restoreScrollPosition();
                        return;
                      }
                      if (validateTargetImageFiles(files, 0)) {
                        setTargetFiles(files);
                      }
                      event.currentTarget.value = "";
                      restoreScrollPosition();
                    }}
                  />
                  {targetFiles.length ? <div className="mt-3 flex flex-wrap gap-2">{targetFiles.map((file) => <span key={`${file.name}-${file.size}`} title={file.name} className="max-w-full truncate rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1 text-xs text-gray-300">{file.name}</span>)}</div> : null}
                </label>
                <button type="submit" disabled={savingTarget} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-cyan-500 to-sky-400 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
                  {savingTarget ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {t("drakonFind.targetForm.submit")}
                </button>
              </form>
            </div>

            <div className="rounded-[28px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-100">{t("drakonFind.catalog.title")}</p>
                  <p className="text-sm text-gray-400">{t("drakonFind.catalog.subtitle")}</p>
                </div>
                <div className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs text-gray-300">{t("drakonFind.catalog.count", { count: targets.length })}</div>
              </div>
              <div className="max-h-[34rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
                {loading && !targets.length ? <div className="rounded-2xl border border-gray-800 bg-gray-950/60 px-4 py-5 text-sm text-gray-400">{t("drakonFind.catalog.loading")}</div> : null}
                {!loading && !targets.length ? <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-6 text-sm text-gray-400">{t("drakonFind.catalog.empty")}</div> : null}
                {targets.map((target) => {
                  const selected = target.id === selectedTargetId;
                  const deleteBlockedReason = getTargetDeletionBlockReason(target, t);
                  const deletingTarget = deletingTargetId === target.id;
                  return (
                    <div
                      key={target.id}
                      className={`w-full rounded-[22px] border p-4 text-left ${selected ? "border-cyan-400/50 bg-cyan-500/10" : "border-gray-800 bg-gray-950/55"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTargetNewFiles([]);
                            setSelectedTargetId(target.id);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="text-sm font-semibold text-gray-100">{target.name}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{getEntityTypeLabel(target.entity_type, t)}</div>
                        </button>
                        <div className="flex items-center gap-2">
                          {selected ? <span className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-200">{t("drakonFind.catalog.selected")}</span> : null}
                          <button
                            type="button"
                            onClick={() => void handleDeleteTarget(target)}
                            disabled={Boolean(deleteBlockedReason) || deletingTarget}
                            title={deleteBlockedReason || t("drakonFind.catalog.delete")}
                            className="inline-flex items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingTarget ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTargetNewFiles([]);
                          setSelectedTargetId(target.id);
                        }}
                        className="mt-3 w-full text-left"
                      >
                        <p className="line-clamp-3 text-sm leading-6 text-gray-300">{target.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                          <span>{t("drakonFind.catalog.referenceImages", { count: target.image_count })}</span>
                          <span>{t("drakonFind.catalog.linkedSearches", { count: target.search_count || 0 })}</span>
                        </div>
                        {deleteBlockedReason ? <div className="mt-2 text-xs text-amber-200">{deleteBlockedReason}</div> : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-[28px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-100">{t("drakonFind.searchComposer.title")}</p>
                  <p className="text-sm text-gray-400">{t("drakonFind.searchComposer.subtitle")}</p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-950/70 px-3 py-1.5 text-xs text-gray-300"><Search className="h-3.5 w-3.5 text-blue-300" />allowpublicaccess = 1</div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100"><Activity className="h-3.5 w-3.5 text-cyan-300" />{t("drakonFind.operations.videoWindow")}</div>
                </div>
              </div>
              <div className="grid gap-6 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] 2xl:items-start">
                <div ref={selectedTargetCardRef} className="rounded-[24px] border border-gray-800 bg-gray-950/70 p-5">
                  {selectedTarget ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200"><Target className="h-3.5 w-3.5" />{t("drakonFind.searchComposer.activeTarget")}</div>
                          <h2 className="text-xl font-semibold text-gray-100">{selectedTarget.name}</h2>
                          <p className="mt-2 text-sm leading-6 text-gray-300">{selectedTarget.description}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDeleteTarget(selectedTarget)}
                          disabled={Boolean(selectedTargetDeletionBlockReason) || deletingTargetId === selectedTarget.id}
                          title={selectedTargetDeletionBlockReason || t("drakonFind.catalog.delete")}
                          className="inline-flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingTargetId === selectedTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {t("drakonFind.searchComposer.deleteTarget")}
                        </button>
                      </div>
                      <label onPointerDown={(event) => captureScrollPosition(event.currentTarget)} className="block rounded-[22px] border border-dashed border-gray-700 bg-gray-950/75 px-4 py-4 text-sm text-gray-300">
                        <div className="flex items-center gap-3"><UploadCloud className="h-4 w-4 text-cyan-300" /><span>{t("drakonFind.searchComposer.addImages")}</span></div>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="sr-only"
                          onChange={(event: ChangeEvent<HTMLInputElement>) => {
                            const files = Array.from(event.target.files || []);
                            if (!files.length) {
                              setSelectedTargetNewFiles([]);
                              event.currentTarget.value = "";
                              restoreScrollPosition();
                              return;
                            }
                            if (validateTargetImageFiles(files, Math.max(Array.isArray(selectedTarget.images) ? selectedTarget.images.length : 0, Number(selectedTarget.image_count || 0)))) {
                              setSelectedTargetNewFiles(files);
                            }
                            event.currentTarget.value = "";
                            restoreScrollPosition();
                          }}
                        />
                        {selectedTargetNewFiles.length ? <div className="mt-3 flex flex-wrap gap-2">{selectedTargetNewFiles.map((file) => <span key={`${file.name}-${file.size}`} title={file.name} className="max-w-full truncate rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1 text-xs text-gray-300">{file.name}</span>)}</div> : null}
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={!selectedTargetNewFiles.length || uploadingTargetId === selectedTarget.id}
                          onClick={async () => {
                            try {
                              await uploadImagesToTarget(selectedTarget.id, selectedTargetNewFiles);
                              setSelectedTargetNewFiles([]);
                              setToast({ message: t("drakonFind.toast.referenceImagesUpdated"), type: "success" });
                            } catch (error) {
                              setToast({
                                message: error instanceof Error ? error.message : t("drakonFind.toast.referenceImagesUploadFailed"),
                                type: "error",
                              });
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2.5 text-sm font-medium text-cyan-100 disabled:opacity-60"
                        >
                          {uploadingTargetId === selectedTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                          {t("drakonFind.searchComposer.uploadReferences")}
                        </button>
                        <div className="text-xs text-gray-400">{t("drakonFind.searchComposer.activeImages", { count: selectedTarget.image_count })}</div>
                        <div className="text-xs text-gray-500">{t("drakonFind.searchComposer.linkedSearches", { count: selectedTarget.search_count || 0 })}</div>
                      </div>
                      {selectedTargetDeletionBlockReason ? <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">{selectedTargetDeletionBlockReason}</div> : null}
                      <ImageGrid images={selectedTarget.images || []} deletingImageId={deletingImageId} onDelete={(imageId) => handleDeleteTargetImage(selectedTarget.id, imageId)} />
                    </div>
                  ) : <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-6 text-sm text-gray-400">{t("drakonFind.searchComposer.noTarget")}</div>}
                </div>
                <BrazilStateTileMap selectedStates={selectedStates} onToggleState={(stateCode: string) => setSelectedStates((current) => current.includes(stateCode) ? current.filter((item) => item !== stateCode) : [...current, stateCode])} stateCounts={scopeStateCounts} />
              </div>
              <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)]">
                <div className="rounded-[24px] border border-gray-800 bg-gray-950/60 p-5">
                  <div className="mb-4 flex items-center gap-2 text-gray-100"><MapPin className="h-4 w-4 text-cyan-300" /><span className="text-sm font-semibold">{t("drakonFind.searchComposer.summaryTitle")}</span>{scopeLoading ? <Loader2 className="h-4 w-4 animate-spin text-blue-400" /> : null}</div>
                  <div className="mb-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-cyan-200">{t("drakonFind.searchComposer.operationalWindow")}</div>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-gray-400">{t("drakonFind.searchComposer.durationLabel")}</div>
                        <select value={searchDurationSeconds} onChange={(event) => setSearchDurationSeconds(Number(event.target.value) || 1800)} className="mt-2 w-full rounded-2xl border border-gray-700 bg-gray-950/80 px-3 py-2.5 text-sm text-gray-100">
                          {SEARCH_DURATION_OPTIONS.map((option) => <option key={option} value={option}>{getSearchDurationLabel(option, t)}</option>)}
                        </select>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/80 px-4 py-3">
                        <div className="text-xs text-gray-400">{t("drakonFind.searchComposer.inputType")}</div>
                        <div className="mt-2 text-sm font-semibold text-gray-100">{t("drakonFind.searchComposer.inputTypeValue")}</div>
                        <div className="mt-1 text-xs text-gray-500">{t("drakonFind.searchComposer.inputTypeHint")}</div>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                    {[{ label: t("drakonFind.searchComposer.statesLabel"), value: selectedStates.length }, { label: t("drakonFind.searchComposer.camerasLabel"), value: effectiveEligibleCameraCount }, { label: t("drakonFind.searchComposer.ownersLabel"), value: includedOwnerCount }].map((item) => <div key={item.label} className="rounded-2xl border border-gray-800 bg-gray-900/80 p-4"><div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{item.label}</div><div className="mt-2 text-2xl font-semibold text-gray-100">{item.value}</div></div>)}
                  </div>
                </div>
                <div className="rounded-[24px] border border-gray-800 bg-gray-950/60 p-5">
                  <div className="mb-2 flex items-center justify-between gap-3 text-gray-100">
                    <div className="flex items-center gap-2"><Camera className="h-4 w-4 text-blue-300" /><span className="text-sm font-semibold">{t("drakonFind.searchComposer.previewTitle")}</span></div>
                    <div className="rounded-full border border-gray-700 bg-gray-900/80 px-3 py-1 text-[11px] text-gray-300">
                      {t("drakonFind.searchComposer.previewCount", { active: effectiveEligibleCameraCount, eligible: scope?.eligible_camera_count ?? 0 })}
                    </div>
                  </div>
                  <div className="mb-4 text-xs text-gray-400">{t("drakonFind.searchComposer.previewHint")}</div>
                  <div className="max-h-[26rem] overflow-y-auto overscroll-contain pr-1 grid gap-2 lg:grid-cols-2">
                    {scopePreviewCameras.map((camera) => {
                      const excluded = excludedScopeCameraIdSet.has(camera.id);
                      return (
                        <button
                          key={camera.id}
                          type="button"
                          onClick={() =>
                            setExcludedCameraIds((current) =>
                              current.includes(camera.id)
                                ? current.filter((item) => item !== camera.id)
                                : [...current, camera.id]
                            )
                          }
                          className={`rounded-2xl border px-3 py-3 text-left transition ${excluded ? "border-amber-500/30 bg-amber-500/10 text-amber-100" : "border-gray-800 bg-gray-900/75 text-gray-100"}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className={`text-sm font-medium ${excluded ? "text-amber-50" : "text-gray-100"}`}>{camera.name}</div>
                              <div className={`mt-1 text-xs ${excluded ? "text-amber-100/80" : "text-gray-400"}`}>{camera.city || t("drakonFind.searchComposer.cityUnknown")} - {camera.state_code || camera.state || "--"}</div>
                            </div>
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${excluded ? "border-amber-400/30 bg-amber-500/10 text-amber-100" : "border-cyan-400/20 bg-cyan-500/10 text-cyan-100"}`}>
                              {excluded ? t("drakonFind.searchComposer.cameraDeselected") : t("drakonFind.searchComposer.cameraSelected")}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                    {!scopePreviewCameras.length ? <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 px-4 py-6 text-sm text-gray-400 lg:col-span-2">{t("drakonFind.searchComposer.previewEmpty")}</div> : null}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-blue-500/20 bg-blue-500/10 px-4 py-4">
                <div><div className="text-sm font-semibold text-gray-100">{t("drakonFind.searchComposer.readyTitle")}</div><div className="mt-1 text-sm text-gray-300">{excludedScopeCameraIds.length ? t("drakonFind.searchComposer.readySummaryWithExcluded", { duration: getSearchDurationLabel(searchDurationSeconds, t), count: excludedScopeCameraIds.length }) : t("drakonFind.searchComposer.readySummary", { duration: getSearchDurationLabel(searchDurationSeconds, t) })}</div></div>
                <button type="button" onClick={handleCreateSearch} disabled={!canCreateSearch || creatingSearch} className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 via-cyan-500 to-sky-400 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-60">
                  {creatingSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                  {t("drakonFind.searchComposer.start")}
                </button>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
              <div className="rounded-[28px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-6">
                <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-gray-100">{t("drakonFind.operations.title")}</p><p className="text-sm text-gray-400">{t("drakonFind.operations.subtitle")}</p></div><div className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs text-gray-300">{t("drakonFind.operations.count", { count: searches.length })}</div></div>
                <div className="max-h-[42rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
                  {searches.map((search) => {
                    const isActing = actingSearchId === search.id;
                    const isActive = ACTIVE_SEARCH_STATUSES.includes(search.status);
                    const canRetry = !isActive && search.pending_camera_count === 0;
                    const canDelete = !isActive && search.pending_camera_count === 0;
                    return (
                      <div key={search.id} className="rounded-[24px] border border-gray-800 bg-gray-950/55 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div><div className="mb-2 flex items-center gap-2"><StatusBadge status={search.status} /><span className="text-xs uppercase tracking-[0.16em] text-gray-500">#{search.id}</span></div><div className="text-lg font-semibold text-gray-100">{search.target_name}</div><div className="mt-1 text-sm text-gray-400">{t("drakonFind.operations.meta", { cameraCount: search.eligible_camera_count, clientLabel: formatAssignedClientLabel(search.active_client_count, t), hitCount: search.hit_count || searchHitCounts[search.id] || 0 })}</div></div>
                          <div className="text-right text-xs text-gray-500">{t("drakonFind.operations.lastEvent", { time: formatRelative(search.last_event_at || search.updated_at, localeTag) })}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                          <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1">{t("drakonFind.operations.videoWindow")}</span>
                          <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1">{t("drakonFind.operations.durationChip", { duration: getSearchDurationLabel(search.duration_seconds, t) })}</span>
                          <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1">{t("drakonFind.operations.untilChip", { date: formatDateTime(search.run_until, localeTag) })}</span>
                        </div>
                        {search.last_error ? <div className={`mt-4 rounded-2xl border px-3 py-3 text-sm ${isInformationalSearchMessage(search.last_error) ? "border-amber-500/20 bg-amber-500/10 text-amber-100" : "border-red-500/20 bg-red-500/10 text-red-100"}`}>{translateSearchMessage(search.last_error, t)}</div> : null}
                        {!isActive && search.pending_camera_count > 0 ? <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">{t("drakonFind.operations.finishing", { count: search.pending_camera_count })}</div> : null}
                        <div className="mt-4 flex flex-wrap gap-2">
                          {isActive ? <button type="button" disabled={isActing} onClick={() => handleCancelSearch(search.id)} className="inline-flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 disabled:opacity-60">{isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}{t("drakonFind.operations.cancel")}</button> : <button type="button" disabled={isActing || !canRetry} onClick={() => handleRetrySearch(search.id)} className="inline-flex items-center gap-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-100 disabled:opacity-60">{isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{canRetry ? t("drakonFind.operations.retry") : t("drakonFind.operations.finalizing")}</button>}
                          {!isActive ? <button type="button" disabled={isActing || !canDelete} onClick={() => handleDeleteSearch(search.id)} className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900/80 px-3 py-2 text-sm font-medium text-gray-100 disabled:opacity-60">{isActing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{canDelete ? t("drakonFind.operations.delete") : t("drakonFind.operations.finalizing")}</button> : null}
                        </div>
                      </div>
                    );
                  })}
                  {!searches.length ? <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-6 text-sm text-gray-400">{t("drakonFind.operations.empty")}</div> : null}
                </div>
              </div>

              <div className="rounded-[28px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-6">
                <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-gray-100">{t("drakonFind.hits.title")}</p><p className="text-sm text-gray-400">{t("drakonFind.hits.subtitle")}</p></div><div className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs text-gray-300">{t("drakonFind.hits.count", { count: hits.length })}</div></div>
                <div className="max-h-[42rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
                  {hits.map((hit) => (
                    <div key={hit.id} className="overflow-hidden rounded-[22px] border border-gray-800 bg-gray-950/55">
                      <div className="grid gap-0 sm:grid-cols-[160px_minmax(0,1fr)]">
                        <div className="min-h-[140px] bg-gray-900">{hit.video_url ? (
                          <div className="group relative flex h-full min-h-[140px] items-center justify-center overflow-hidden bg-black/95">
                            <video src={hit.video_url} poster={hit.image_url || undefined} preload="metadata" playsInline muted className="pointer-events-none h-full w-full object-contain" />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent opacity-0 transition duration-200 group-hover:opacity-100" />
                            <button type="button" onClick={() => setExpandedHit(hit)} className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-slate-950/78 px-3 py-2 text-xs font-semibold text-cyan-100 opacity-0 shadow-[0_16px_40px_rgba(2,12,27,0.55)] transition duration-200 group-hover:opacity-100 focus:opacity-100">
                              <Maximize2 className="h-3.5 w-3.5" />
                              {t("drakonFind.hits.expand")}
                            </button>
                          </div>
                        ) : hit.image_url ? <img src={hit.image_url} alt={hit.summary} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-gray-600"><Eye className="h-6 w-6" /></div>}</div>
                        <div className="p-4">
                          <div className="text-sm font-semibold text-gray-100">{hit.camera_name || t("drakonFind.generic.unnamedCamera")}</div>
                          <p className="mt-2 text-sm leading-6 text-gray-300">{hit.summary}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-400">
                            <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1">{t("drakonFind.hits.searchChip", { id: hit.search_id })}</span>
                            <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1">{t("drakonFind.hits.confidenceChip", { value: formatConfidence(hit.confidence) })}</span>
                            <span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1">{formatRelative(hit.matched_at, localeTag)}</span>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleDeleteHit(hit)}
                              disabled={deletingHitId === hit.id}
                              className="inline-flex items-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 disabled:opacity-60"
                            >
                              {deletingHitId === hit.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                              {t("drakonFind.hits.delete")}
                            </button>
                            {hit.video_url ? <button type="button" onClick={() => setExpandedHit(hit)} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-100"><Maximize2 className="h-4 w-4" />{t("drakonFind.hits.expand")}</button> : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {!hits.length ? <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-6 text-sm text-gray-400">{t("drakonFind.hits.empty")}</div> : null}
                </div>
              </div>

              <div className="xl:col-span-2 rounded-[28px] border border-gray-800/80 bg-gradient-to-br from-gray-900 to-gray-950 p-6">
                <div className="mb-4 flex items-center gap-3"><div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-cyan-300"><FileText className="h-5 w-5" /></div><div><p className="text-sm font-semibold text-gray-100">{t("drakonFind.audit.title")}</p><p className="text-sm text-gray-400">{t("drakonFind.audit.subtitle")}</p></div></div>
                <div className="max-h-[34rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
                  {audit.map((entry) => <div key={entry.id} className="rounded-[22px] border border-gray-800 bg-gray-950/55 p-4"><div className="mb-2 flex items-center justify-between gap-3"><span className="rounded-full border border-gray-700 bg-gray-900/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-300">{entry.action_type.replace(/_/g, " ")}</span><span className="text-xs text-gray-500">{formatDateTime(entry.created_at, localeTag)}</span></div><p className="text-sm leading-6 text-gray-200">{entry.message}</p></div>)}
                  {!audit.length ? <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-4 py-6 text-sm text-gray-400">{t("drakonFind.audit.empty")}</div> : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <HitVideoModal hit={expandedHit} onClose={() => setExpandedHit(null)} />
      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </Layout>
  );
}








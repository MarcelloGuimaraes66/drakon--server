import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Layers,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export type DashboardAlertAlbumOverlayMediaEntry = {
  key: string;
  kind: "image" | "video" | "offline";
  url: string | null;
  label: string;
  thumbnailUrl?: string | null;
};

export type DashboardAlertAlbumOverlayItem = {
  id: number;
  eventIdLabel: string | null;
  summary: string;
  badgeLabel: string;
  originLine: string | null;
  cameraName: string;
  timestampLabel: string;
  groupNameLabel: string | null;
  jobName: string | null;
  stepLabel: string | null;
  priorityLabel: string | null;
  priorityClassName: string | null;
  mediaTypeLabel: string | null;
  mediaTypeClassName: string | null;
  momentsLabel: string | null;
  mediaEntries: DashboardAlertAlbumOverlayMediaEntry[];
  downloadUrl: string | null;
};

type DashboardAlertAlbumOverlayProps = {
  isOpen: boolean;
  items: DashboardAlertAlbumOverlayItem[];
  currentIndex: number;
  onClose: () => void;
  onShowPrevious: () => void;
  onShowNext: () => void;
  onDownloadCurrent?: () => void;
  onOpenDetails?: () => void;
};

type InfoCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  secondary?: string | null;
};

function InfoCard({ icon, label, value, secondary = null }: InfoCardProps) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4 shadow-[0_18px_50px_-36px_rgba(0,0,0,0.95)]">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
        <span className="text-sky-200">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-3 text-sm font-medium leading-6 text-white">{value}</div>
      {secondary ? <div className="mt-2 text-xs leading-5 text-gray-400">{secondary}</div> : null}
    </div>
  );
}

export default function DashboardAlertAlbumOverlay({
  isOpen,
  items,
  currentIndex,
  onClose,
  onShowPrevious,
  onShowNext,
  onDownloadCurrent,
  onOpenDetails,
}: DashboardAlertAlbumOverlayProps) {
  const { t, i18n } = useTranslation();
  const isPortuguese = i18n.language?.startsWith("pt");
  const currentItem = items[currentIndex] || null;
  const [selectedMediaIndex, setSelectedMediaIndex] = useState(0);

  useEffect(() => {
    setSelectedMediaIndex(0);
  }, [currentIndex, currentItem?.id]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (items.length <= 1) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onShowPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onShowNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, items.length, onClose, onShowNext, onShowPrevious]);

  if (!isOpen || !currentItem) {
    return null;
  }

  const mediaEntries = currentItem.mediaEntries;
  const selectedMedia = mediaEntries[selectedMediaIndex] || null;
  const hasAlertPagination = items.length > 1;
  const hasMediaRail = mediaEntries.length > 1;
  const overlayTitle = isPortuguese ? "Album de alertas" : "Alert album";
  const overlaySubtitle = hasAlertPagination
    ? isPortuguese
      ? "Use as setas laterais para navegar pelos alertas deste grupo."
      : "Use the side arrows to move through the alerts in this group."
    : isPortuguese
    ? "Visualize a midia consolidada deste alerta."
    : "Review the consolidated media for this alert.";
  const noMediaLabel = t("dashboard.noMediaAvailable");
  const previousAlertLabel = isPortuguese ? "Alerta anterior" : "Previous alert";
  const nextAlertLabel = isPortuguese ? "Proximo alerta" : "Next alert";
  const currentMediaLabel = isPortuguese ? "Midia atual" : "Current media";
  const detailsButtonLabel = isPortuguese ? "Abrir detalhes" : "Open details";
  const downloadButtonLabel = isPortuguese ? "Baixar" : "Download";
  const flowLabel = isPortuguese ? "Fluxo" : "Flow";
  const contextLabel = isPortuguese ? "Contexto" : "Context";
  const agentFallbackLabel = isPortuguese ? "Agente da camera" : "Camera agent";
  const noContextLabel = isPortuguese ? "Sem contexto adicional" : "No additional context";
  const eventPositionLabel = `${currentIndex + 1} / ${items.length}`;
  const summaryText = currentItem.summary?.trim() || "-";
  const flowValue = currentItem.jobName || agentFallbackLabel;
  const flowSecondary = currentItem.stepLabel
    ? `${t("dashboard.step")}: ${currentItem.stepLabel}`
    : null;
  const contextValue = currentItem.groupNameLabel || currentItem.momentsLabel || noContextLabel;
  const contextSecondary =
    currentItem.groupNameLabel && currentItem.momentsLabel
      ? currentItem.momentsLabel
      : currentItem.originLine;
  const selectedMediaText = selectedMedia?.label || noMediaLabel;

  const overlayContent = (
    <div className="fixed inset-0 z-[94]">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-md"
        onClick={onClose}
        aria-label={t("dashboard.closeAlbum")}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 md:p-6">
        <div className="relative flex w-full max-w-7xl items-center justify-center">
          {hasAlertPagination ? (
            <button
              type="button"
              onClick={onShowPrevious}
              className="pointer-events-auto absolute left-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/45 text-white shadow-[0_24px_60px_-28px_rgba(0,0,0,0.95)] backdrop-blur-md transition hover:border-white/30 hover:bg-black/70 sm:left-3 md:left-4 lg:left-0 lg:-translate-x-[calc(100%+1.25rem)] xl:-translate-x-[calc(100%+2rem)]"
              aria-label={previousAlertLabel}
              title={previousAlertLabel}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}

          <div className="pointer-events-auto relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-[32px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,23,34,0.97),rgba(8,11,18,0.99))] shadow-[0_40px_140px_-46px_rgba(0,0,0,0.98)]">
            <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-4 md:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-200">
                      {overlayTitle}
                    </span>
                    <span className="rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-100">
                      {eventPositionLabel}
                    </span>
                    {currentItem.eventIdLabel ? (
                      <span className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1 text-[11px] font-medium text-gray-300">
                        {currentItem.eventIdLabel}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-gray-400">{overlaySubtitle}</p>
                </div>

                <div className="flex items-center gap-2">
                  {onDownloadCurrent && currentItem.downloadUrl ? (
                    <button
                      type="button"
                      onClick={onDownloadCurrent}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/35 hover:bg-emerald-500/15"
                    >
                      <Download className="h-3.5 w-3.5" />
                      {downloadButtonLabel}
                    </button>
                  ) : null}
                  {onOpenDetails ? (
                    <button
                      type="button"
                      onClick={onOpenDetails}
                      className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-100 transition hover:border-blue-300/35 hover:bg-blue-500/15"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {detailsButtonLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-white/[0.08] bg-black/25 p-2 text-gray-300 transition hover:border-white/20 hover:bg-black/45 hover:text-white"
                    aria-label={t("dashboard.closeAlbum")}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto">
              <div className="border-b border-white/[0.06] bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),rgba(8,11,18,0.98)_70%)]">
                <div className="relative flex min-h-[42vh] items-center justify-center overflow-hidden px-4 py-4 md:min-h-[50vh] md:px-6 md:py-6">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.05] to-transparent" />

                  {selectedMedia ? (
                    selectedMedia.kind === "video" && selectedMedia.url ? (
	                      <video
	                        src={selectedMedia.url}
	                        poster={selectedMedia.thumbnailUrl || undefined}
	                        className="h-[42vh] w-full rounded-[28px] border border-white/[0.05] bg-black/35 object-contain shadow-[0_36px_100px_-44px_rgba(0,0,0,0.96)] md:h-[52vh]"
	                        controls
	                        autoPlay
                        playsInline
                        preload="metadata"
                      />
                    ) : selectedMedia.kind === "image" && selectedMedia.url ? (
                      <img
                        src={selectedMedia.url}
                        alt={selectedMedia.label}
                        className="h-[42vh] w-full rounded-[28px] border border-white/[0.05] bg-black/20 object-contain shadow-[0_36px_100px_-44px_rgba(0,0,0,0.96)] md:h-[52vh]"
                      />
                    ) : selectedMedia.kind === "offline" ? (
                      <div className="flex h-[42vh] w-full flex-col items-center justify-center rounded-[28px] border border-rose-400/20 bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.15),rgba(12,15,22,0.96)_72%)] px-6 text-center md:h-[52vh]">
                        <Camera className="h-12 w-12 text-rose-200" />
                        <p className="mt-4 text-lg font-semibold text-white">{t("dashboard.cameraOffline")}</p>
                        <p className="mt-2 max-w-md text-sm leading-6 text-rose-100/80">
                          {selectedMedia.label}
                        </p>
                      </div>
                    ) : (
                      <div className="flex h-[42vh] w-full items-center justify-center rounded-[28px] border border-dashed border-white/[0.08] bg-black/20 text-sm text-gray-400 md:h-[52vh]">
                        {noMediaLabel}
                      </div>
                    )
                  ) : (
                    <div className="flex h-[42vh] w-full items-center justify-center rounded-[28px] border border-dashed border-white/[0.08] bg-black/20 text-sm text-gray-400 md:h-[52vh]">
                      {noMediaLabel}
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />
                </div>

                {hasMediaRail ? (
                  <div className="border-t border-white/[0.06] bg-black/20 px-4 py-3 md:px-6">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
                        {isPortuguese ? "Midia deste alerta" : "Media in this alert"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {selectedMediaIndex + 1} / {mediaEntries.length}
                      </div>
                    </div>

                    <div className="flex gap-3 overflow-x-auto pb-1">
                      {mediaEntries.map((entry, index) => {
                        const isSelected = index === selectedMediaIndex;

                        return (
                          <button
                            key={entry.key}
                            type="button"
                            onClick={() => setSelectedMediaIndex(index)}
                            className={`group flex w-28 shrink-0 flex-col gap-2 rounded-2xl border p-2 text-left transition ${
                              isSelected
                                ? "border-sky-300/45 bg-sky-400/10 shadow-[0_20px_44px_-28px_rgba(56,189,248,0.9)]"
                                : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.16] hover:bg-white/[0.05]"
                            }`}
                          >
	                            <div className="relative h-16 overflow-hidden rounded-xl border border-white/[0.04] bg-black/35">
	                              {(entry.kind === "image" || entry.kind === "video") && entry.thumbnailUrl ? (
	                                <>
	                                  <img
	                                    src={entry.thumbnailUrl}
	                                    alt={entry.label}
	                                    className="h-full w-full object-cover"
	                                  />
	                                  {entry.kind === "video" ? (
	                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
	                                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45">
	                                        <Play className="h-4 w-4" />
	                                      </div>
	                                    </div>
	                                  ) : null}
	                                </>
	                              ) : entry.kind === "video" ? (
	                                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.18),rgba(15,18,28,0.96)_72%)] text-white">
	                                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
	                                    <Play className="h-4 w-4" />
	                                  </div>
	                                </div>
	                              ) : (
	                                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(244,63,94,0.16),rgba(15,18,28,0.96)_72%)] text-rose-100">
	                                  <Camera className="h-5 w-5" />
	                                </div>
	                              )}
	                            </div>

                            <div className="min-w-0">
                              <div className="truncate text-[11px] font-medium text-white">{entry.label}</div>
                              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-gray-500">
                                {entry.kind === "video"
                                  ? isPortuguese
                                    ? "Clip"
                                    : "Clip"
                                  : entry.kind === "offline"
                                  ? isPortuguese
                                    ? "Offline"
                                    : "Offline"
                                  : isPortuguese
                                  ? "Imagem"
                                  : "Image"}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="bg-[linear-gradient(180deg,rgba(17,21,31,0.9),rgba(10,13,20,0.98))] px-5 py-5 md:px-6">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-[0.14em] text-gray-100">
                        {currentItem.badgeLabel}
                      </span>
                      {currentItem.priorityLabel && currentItem.priorityClassName ? (
                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.12em] ${currentItem.priorityClassName}`}
                        >
                          {currentItem.priorityLabel}
                        </span>
                      ) : null}
                      {currentItem.mediaTypeLabel && currentItem.mediaTypeClassName ? (
                        <span
                          className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.12em] ${currentItem.mediaTypeClassName}`}
                        >
                          {currentItem.mediaTypeLabel}
                        </span>
                      ) : null}
                      {currentItem.groupNameLabel ? (
                        <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium text-cyan-100">
                          {currentItem.groupNameLabel}
                        </span>
                      ) : null}
                      {currentItem.momentsLabel ? (
                        <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-100">
                          {currentItem.momentsLabel}
                        </span>
                      ) : null}
                    </div>

                    <h2 className="mt-4 text-lg font-semibold leading-tight text-white md:text-2xl">
                      {summaryText}
                    </h2>

                    {currentItem.originLine ? (
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                        {currentItem.originLine}
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 shadow-[0_18px_50px_-36px_rgba(0,0,0,0.95)]">
                    <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
                      {currentMediaLabel}
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">{selectedMediaText}</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InfoCard
                    icon={<Camera className="h-4 w-4" />}
                    label={t("dashboard.camera")}
                    value={currentItem.cameraName || t("dashboard.na")}
                  />
                  <InfoCard
                    icon={<Clock3 className="h-4 w-4" />}
                    label={t("dashboard.timestamp")}
                    value={currentItem.timestampLabel}
                  />
                  <InfoCard
                    icon={<Layers className="h-4 w-4" />}
                    label={flowLabel}
                    value={flowValue}
                    secondary={flowSecondary}
                  />
                  <InfoCard
                    icon={<Sparkles className="h-4 w-4" />}
                    label={contextLabel}
                    value={contextValue}
                    secondary={contextSecondary}
                  />
                </div>
              </div>
            </div>
          </div>

          {hasAlertPagination ? (
            <button
              type="button"
              onClick={onShowNext}
              className="pointer-events-auto absolute right-2 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/12 bg-black/45 text-white shadow-[0_24px_60px_-28px_rgba(0,0,0,0.95)] backdrop-blur-md transition hover:border-white/30 hover:bg-black/70 sm:right-3 md:right-4 lg:right-0 lg:translate-x-[calc(100%+1.25rem)] xl:translate-x-[calc(100%+2rem)]"
              aria-label={nextAlertLabel}
              title={nextAlertLabel}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(overlayContent, document.body);
}

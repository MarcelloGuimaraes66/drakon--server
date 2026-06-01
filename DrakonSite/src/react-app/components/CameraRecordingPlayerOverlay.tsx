import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Archive,
  CalendarDays,
  Clock3,
  HardDrive,
  Play,
  Radio,
  RefreshCw,
  SkipBack,
  SkipForward,
  Video,
  X,
} from "lucide-react";
import CameraRecordingTimeline from "@/react-app/components/CameraRecordingTimeline";
import {
  formatRecordingCompactDate,
  formatRecordingDateTime,
  formatRecordingDurationShort,
  formatRecordingSegmentTimeRange,
} from "@/react-app/lib/cameraRecordingTimeline";
import { useCameraRecordingTimeline } from "@/react-app/hooks/useCameraRecordingTimeline";
import type { CameraRecordingTimelineZoom } from "@/shared/cameraRecordings";

export type CameraRecordingPlayerCamera = {
  id: number;
  name: string;
  description?: string | null;
  thumbnail_url?: string | null;
  is_service_running?: number | null;
  is_online?: number | null;
  store_frames?: number | null;
  retention_days?: number | null;
};

type CameraRecordingPlayerOverlayProps = {
  isOpen: boolean;
  camera: CameraRecordingPlayerCamera | null;
  onClose: () => void;
  initialFocusAt?: string | null;
};

type InfoCardProps = {
  icon: ReactNode;
  label: string;
  value: string;
  secondary?: string | null;
};

function InfoCard({ icon, label, value, secondary = null }: InfoCardProps) {
  return (
    <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.035] p-4 shadow-[0_18px_54px_-40px_rgba(0,0,0,0.96)]">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <span className="text-cyan-200">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-3 text-sm font-medium leading-6 text-white">{value}</div>
      {secondary ? (
        <div className="mt-2 text-xs leading-5 text-slate-500">{secondary}</div>
      ) : null}
    </div>
  );
}

export default function CameraRecordingPlayerOverlay({
  isOpen,
  camera,
  onClose,
  initialFocusAt = null,
}: CameraRecordingPlayerOverlayProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("pt") ? "pt-BR" : "en-US";
  const isPortuguese = locale === "pt-BR";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const {
    zoom,
    setZoom,
    summary,
    segments,
    activeBucket,
    selectedSegment,
    selectedSegmentId,
    setSelectedSegmentId,
    loadingSummary,
    loadingSegments,
    error,
    refreshNow,
    handleBucketSelect,
    jumpToLiveEdge,
    liveEdgeBucketKey,
    hasWindowVideo,
    canLoadSegments,
  } = useCameraRecordingTimeline({
    cameraId: isOpen ? camera?.id ?? null : null,
    isOpen,
    initialFocusAt,
  });

  const selectedSegmentIndex =
    selectedSegmentId && segments
      ? segments.segments.findIndex((segment) => segment.id === selectedSegmentId)
      : -1;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!segments || segments.segments.length === 0) {
        return;
      }

      if (event.key === "ArrowLeft" && selectedSegmentIndex > 0) {
        event.preventDefault();
        setSelectedSegmentId(segments.segments[selectedSegmentIndex - 1].id);
      }

      if (
        event.key === "ArrowRight" &&
        selectedSegmentIndex >= 0 &&
        selectedSegmentIndex < segments.segments.length - 1
      ) {
        event.preventDefault();
        setSelectedSegmentId(segments.segments[selectedSegmentIndex + 1].id);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, segments, selectedSegmentIndex, setSelectedSegmentId]);

  useEffect(() => {
    if (!selectedSegment || !videoRef.current) {
      return;
    }
    const video = videoRef.current;
    video.load();
    void video.play().catch(() => {
      // Ignore autoplay restrictions.
    });
  }, [selectedSegment?.id]);

  if (!isOpen || !camera) {
    return null;
  }

  const hasAnyRecordings = Boolean(summary?.availability.has_any_recordings);
  const storeFramesEnabled = Boolean(summary?.capture_state.store_frames_enabled);
  const cadenceHint = summary?.capture_state.cadence_hint || "unknown";
  const recommendedPollLabel =
    summary?.refresh_policy.recommended_poll_interval_ms === 60_000
      ? isPortuguese
        ? "Atualiza a cada 60 s"
        : "Refreshes every 60s"
      : isPortuguese
      ? "Atualiza a cada 10 s"
      : "Refreshes every 10s";
  const emptyStateTitle = !storeFramesEnabled
    ? isPortuguese
      ? "Armazenamento histórico desligado"
      : "Historical storage is turned off"
    : !hasAnyRecordings
    ? isPortuguese
      ? "Nenhuma gravação encontrada"
      : "No recordings found"
    : !hasWindowVideo
    ? isPortuguese
      ? "Sem clips nesta janela"
      : "No clips in this window"
    : zoom !== "hour"
    ? isPortuguese
      ? "Aproxime para carregar os clips"
      : "Zoom in to load the clips"
    : isPortuguese
    ? "Selecione um clip"
    : "Select a clip";
  const emptyStateBody = !storeFramesEnabled
    ? isPortuguese
      ? "Ative Store Frames nesta câmera para construir a timeline histórica no disco."
      : "Enable Store Frames on this camera to build the historical timeline on disk."
    : !hasAnyRecordings
    ? isPortuguese
      ? "Ainda não há vídeos gravados disponíveis para esta câmera."
      : "There are no recorded videos available for this camera yet."
    : !hasWindowVideo
    ? isPortuguese
      ? "Há histórico no disco, mas não dentro da janela selecionada."
      : "There is history on disk, but not inside the selected window."
    : zoom !== "hour"
    ? isPortuguese
      ? "Use mês e dia para navegar. Ao chegar em hora, os clips reais do disco aparecem aqui."
      : "Use month and day to navigate. Once you reach hour view, the actual clips from disk appear here."
    : isPortuguese
    ? "Escolha uma hora na timeline para abrir os segmentos gravados."
    : "Pick an hour in the timeline to open the recorded segments.";

  function handleZoomSelect(nextZoom: CameraRecordingTimelineZoom) {
    setZoom(nextZoom);
  }

  function handleVideoEnded() {
    if (!segments || selectedSegmentIndex < 0) {
      return;
    }
    const nextSegment = segments.segments[selectedSegmentIndex + 1];
    if (nextSegment) {
      setSelectedSegmentId(nextSegment.id);
    }
  }

  const overlayContent = (
    <div className="fixed inset-0 z-[96]">
      <button
        type="button"
        className="absolute inset-0 bg-black/72 backdrop-blur-md"
        onClick={onClose}
        aria-label={isPortuguese ? "Fechar player" : "Close player"}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 md:p-6">
        <div className="pointer-events-auto relative z-10 flex max-h-[94vh] w-full max-w-[1500px] flex-col overflow-hidden rounded-[34px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(14,18,28,0.98),rgba(6,9,15,0.995))] shadow-[0_48px_160px_-56px_rgba(0,0,0,0.98)]">
          <div className="border-b border-white/[0.06] bg-white/[0.03] px-5 py-4 md:px-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100">
                    {isPortuguese ? "Arquivo da câmera" : "Camera archive"}
                  </span>
                  <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-[11px] font-medium text-cyan-100">
                    {camera.name}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
                      summary?.capture_state.is_online
                        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                        : "border-rose-400/25 bg-rose-500/10 text-rose-100"
                    }`}
                  >
                    {summary?.capture_state.is_online
                      ? isPortuguese
                        ? "Online"
                        : "Online"
                      : isPortuguese
                      ? "Offline"
                      : "Offline"}
                  </span>
                  <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[11px] font-medium text-violet-100">
                    {cadenceHint === "60s"
                      ? "60s clips"
                      : cadenceHint === "10s"
                      ? "10s clips"
                      : cadenceHint === "mixed"
                      ? isPortuguese
                        ? "cadência mista"
                        : "mixed cadence"
                      : isPortuguese
                      ? "cadência pendente"
                      : "cadence pending"}
                  </span>
                </div>

                <h2 className="mt-4 text-xl font-semibold text-white md:text-2xl">
                  {isPortuguese
                    ? "Player temporal com timeline fluida"
                    : "Temporal player with a fluid timeline"}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                  {camera.description?.trim()
                    ? camera.description
                    : isPortuguese
                    ? "Conteúdo vindo direto do disco da câmera. Inferências com input type image não aparecem nesta timeline."
                    : "Content comes straight from the camera disk archive. Inference-only image inputs do not appear in this timeline."}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {(["month", "day", "hour"] as CameraRecordingTimelineZoom[]).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleZoomSelect(option)}
                      className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                        zoom === option
                          ? "border-cyan-300/40 bg-cyan-500/12 text-cyan-100"
                          : "border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-white/[0.18] hover:bg-white/[0.07]"
                      }`}
                    >
                      {option === "month"
                        ? isPortuguese
                          ? "Meses"
                          : "Months"
                        : option === "day"
                        ? isPortuguese
                          ? "Dias"
                          : "Days"
                        : isPortuguese
                        ? "Horas"
                        : "Hours"}
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={jumpToLiveEdge}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-500/15"
                >
                  <Radio className="h-3.5 w-3.5" />
                  {isPortuguese ? "Borda ao vivo" : "Live edge"}
                </button>

                <button
                  type="button"
                  onClick={refreshNow}
                  className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-100 transition hover:border-blue-300/35 hover:bg-blue-500/15"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {isPortuguese ? "Atualizar" : "Refresh"}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/[0.08] bg-black/30 p-2 text-slate-300 transition hover:border-white/[0.18] hover:bg-black/50 hover:text-white"
                  aria-label={isPortuguese ? "Fechar player" : "Close player"}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto">
            <div className="grid gap-6 px-5 py-5 md:px-6 xl:grid-cols-[minmax(0,1.8fr)_360px]">
              <div className="min-w-0">
                <div className="overflow-hidden rounded-[30px] border border-white/[0.06] bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.11),rgba(3,7,13,0.95)_72%)]">
                  <div className="relative flex min-h-[44vh] items-center justify-center px-4 py-4 md:min-h-[52vh] md:px-6 md:py-6">
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.05] to-transparent" />

                    {selectedSegment ? (
                      <video
                        key={selectedSegment.id}
                        ref={videoRef}
                        src={selectedSegment.stream_url}
                        poster={camera.thumbnail_url || undefined}
                        className="relative z-10 h-[42vh] w-full rounded-[26px] border border-white/[0.05] bg-black/35 object-contain shadow-[0_38px_120px_-52px_rgba(0,0,0,0.98)] md:h-[52vh]"
                        controls
                        autoPlay
                        playsInline
                        preload="metadata"
                        onEnded={handleVideoEnded}
                      />
                    ) : (
                      <div className="relative z-10 flex h-[42vh] w-full max-w-4xl flex-col items-center justify-center rounded-[26px] border border-dashed border-white/[0.1] bg-black/25 px-6 text-center md:h-[52vh]">
                        <Archive className="h-12 w-12 text-cyan-200" />
                        <h3 className="mt-4 text-xl font-semibold text-white">
                          {loadingSummary ? (isPortuguese ? "Carregando timeline..." : "Loading timeline...") : emptyStateTitle}
                        </h3>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                          {error || emptyStateBody}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/[0.06] bg-black/20 px-4 py-4 md:px-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {isPortuguese ? "Janela ativa" : "Active window"}
                        </div>
                        <div className="mt-2 text-sm font-medium text-white">
                          {activeBucket
                            ? `${formatRecordingDateTime(activeBucket.start_at, locale)}`
                            : isPortuguese
                            ? "Aguardando seleção"
                            : "Waiting for a selection"}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-slate-300">
                          {recommendedPollLabel}
                        </span>
                        {loadingSegments ? (
                          <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-100">
                            {isPortuguese ? "Sincronizando clips" : "Syncing clips"}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (segments && selectedSegmentIndex > 0) {
                            setSelectedSegmentId(segments.segments[selectedSegmentIndex - 1].id);
                          }
                        }}
                        disabled={!segments || selectedSegmentIndex <= 0}
                        className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/[0.18] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <SkipBack className="h-3.5 w-3.5" />
                        {isPortuguese ? "Anterior" : "Previous"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            segments &&
                            selectedSegmentIndex >= 0 &&
                            selectedSegmentIndex < segments.segments.length - 1
                          ) {
                            setSelectedSegmentId(segments.segments[selectedSegmentIndex + 1].id);
                          }
                        }}
                        disabled={
                          !segments ||
                          selectedSegmentIndex < 0 ||
                          selectedSegmentIndex >= segments.segments.length - 1
                        }
                        className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-white/[0.18] hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <SkipForward className="h-3.5 w-3.5" />
                        {isPortuguese ? "Próximo" : "Next"}
                      </button>
                    </div>

                    {zoom === "hour" ? (
                      <div className="mt-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {isPortuguese ? "Clips da hora" : "Hour clips"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {segments?.segments.length || 0} {isPortuguese ? "segmentos" : "segments"}
                          </div>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-1">
                          {(segments?.segments || []).map((segment) => {
                            const isSelected = segment.id === selectedSegmentId;
                            return (
                              <button
                                key={segment.id}
                                type="button"
                                onClick={() => setSelectedSegmentId(segment.id)}
                                className={`w-44 shrink-0 rounded-[22px] border p-3 text-left transition ${
                                  isSelected
                                    ? "border-cyan-300/40 bg-cyan-400/10 shadow-[0_18px_44px_-28px_rgba(34,211,238,0.9)]"
                                    : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.18] hover:bg-white/[0.05]"
                                }`}
                              >
                                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                                  <Play className="h-3.5 w-3.5 text-cyan-200" />
                                  <span>{formatRecordingDurationShort(segment.duration_seconds, locale)}</span>
                                </div>
                                <div className="mt-3 text-sm font-medium text-white">
                                  {formatRecordingSegmentTimeRange(segment, locale)}
                                </div>
                                <div className="mt-2 text-xs text-slate-500">
                                  {formatRecordingCompactDate(segment.start_at, locale)}
                                </div>
                              </button>
                            );
                          })}

                          {canLoadSegments && !loadingSegments && (segments?.segments.length || 0) === 0 ? (
                            <div className="rounded-[22px] border border-dashed border-white/[0.08] bg-white/[0.03] px-4 py-5 text-sm text-slate-400">
                              {isPortuguese
                                ? "Nenhum clip nesta hora."
                                : "No clips in this hour."}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-[22px] border border-dashed border-white/[0.08] bg-white/[0.025] px-4 py-4 text-sm text-slate-400">
                        {zoom === "month"
                          ? isPortuguese
                            ? "Clique em um mês para entrar nos dias e depois abrir as horas gravadas."
                            : "Click a month to drill into days, then open the recorded hours."
                          : isPortuguese
                          ? "Clique em um dia para abrir as horas gravadas deste período."
                          : "Click a day to open the recorded hours for that period."}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <InfoCard
                  icon={<HardDrive className="h-4 w-4" />}
                  label={isPortuguese ? "Origem" : "Source"}
                  value={isPortuguese ? "Disco local da câmera" : "Local camera disk"}
                  secondary={
                    isPortuguese
                      ? "A timeline mostra só o que existe em vídeo no disco."
                      : "The timeline only shows what exists as video on disk."
                  }
                />
                <InfoCard
                  icon={<Clock3 className="h-4 w-4" />}
                  label={isPortuguese ? "Última gravação" : "Latest recording"}
                  value={formatRecordingDateTime(
                    summary?.availability.latest_segment_end_at || null,
                    locale
                  )}
                  secondary={summary?.refresh_policy.latest_known_write_at
                    ? `${isPortuguese ? "Última escrita" : "Last write"}: ${formatRecordingDateTime(
                        summary.refresh_policy.latest_known_write_at,
                        locale
                      )}`
                    : null}
                />
                <InfoCard
                  icon={<CalendarDays className="h-4 w-4" />}
                  label={isPortuguese ? "Primeiro clip" : "First clip"}
                  value={formatRecordingDateTime(
                    summary?.availability.first_segment_at || null,
                    locale
                  )}
                  secondary={
                    summary?.availability.retention_days
                      ? `${summary.availability.retention_days} ${
                          isPortuguese ? "dias de retenção" : "retention days"
                        }`
                      : null
                  }
                />
                <InfoCard
                  icon={<Video className="h-4 w-4" />}
                  label={isPortuguese ? "Janela atual" : "Current window"}
                  value={
                    activeBucket
                      ? `${activeBucket.clip_count} ${
                          isPortuguese ? "clips" : "clips"
                        }`
                      : "—"
                  }
                  secondary={
                    activeBucket
                      ? `${formatRecordingDurationShort(
                          activeBucket.recorded_seconds,
                          locale
                        )} ${isPortuguese ? "de vídeo detectado" : "of detected video"}`
                      : null
                  }
                />
              </div>
            </div>

            <div className="border-t border-white/[0.06] bg-[linear-gradient(180deg,rgba(12,16,24,0.96),rgba(8,11,18,0.98))] px-5 py-5 md:px-6">
              <CameraRecordingTimeline
                buckets={summary?.buckets || []}
                focusBucketKey={summary?.focus_bucket_key || null}
                liveEdgeBucketKey={liveEdgeBucketKey}
                zoom={zoom}
                locale={locale}
                isLoading={loadingSummary}
                onBucketSelect={handleBucketSelect}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(overlayContent, document.body);
}

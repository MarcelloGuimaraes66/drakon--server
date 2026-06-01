import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  formatRecordingBucketLabel,
  formatRecordingBucketSecondaryLabel,
  formatRecordingDurationShort,
} from "@/react-app/lib/cameraRecordingTimeline";
import type {
  CameraRecordingSummaryBucket,
  CameraRecordingTimelineZoom,
} from "@/shared/cameraRecordings";

type CameraRecordingTimelineProps = {
  buckets: CameraRecordingSummaryBucket[];
  focusBucketKey: string | null;
  liveEdgeBucketKey?: string | null;
  zoom: CameraRecordingTimelineZoom;
  locale?: string;
  isLoading?: boolean;
  onBucketSelect: (bucket: CameraRecordingSummaryBucket) => void;
};

export default function CameraRecordingTimeline({
  buckets,
  focusBucketKey,
  liveEdgeBucketKey = null,
  zoom,
  locale = "en-US",
  isLoading = false,
  onBucketSelect,
}: CameraRecordingTimelineProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!railRef.current) {
      return;
    }
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: railRef.current.scrollLeft,
    };
    railRef.current.setPointerCapture(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!railRef.current || !dragStateRef.current) {
      return;
    }
    const delta = event.clientX - dragStateRef.current.startX;
    railRef.current.scrollLeft = dragStateRef.current.startScrollLeft - delta;
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!railRef.current || !dragStateRef.current) {
      return;
    }
    if (railRef.current.hasPointerCapture(event.pointerId)) {
      railRef.current.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDragging(false);
  }

  if (buckets.length === 0) {
    return (
      <div className="rounded-[26px] border border-white/[0.06] bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
        {isLoading ? "Loading timeline..." : "No timeline buckets available."}
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(17,21,31,0.78),rgba(10,13,20,0.94))] p-4 shadow-[0_28px_90px_-48px_rgba(0,0,0,0.92)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            Timeline
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {zoom === "month"
              ? "Pick a month to drill into days."
              : zoom === "day"
              ? "Pick a day to drill into hours."
              : "Pick an hour to load the recorded clips."}
          </div>
        </div>
        <div className="text-xs text-slate-500">
          {buckets.length} {buckets.length === 1 ? "mark" : "marks"}
        </div>
      </div>

      <div
        ref={railRef}
        className={`overflow-x-auto pb-2 select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerLeave={handlePointerEnd}
      >
        <div className="flex min-w-max gap-3">
          {buckets.map((bucket) => {
            const isSelected = bucket.key === focusBucketKey;
            const isLiveEdge = bucket.key === liveEdgeBucketKey;
            const fillHeight = bucket.has_video
              ? Math.max(10, Math.round(bucket.coverage_ratio * 100))
              : 4;
            const widthClass =
              zoom === "month"
                ? "w-[112px]"
                : zoom === "day"
                ? "w-[92px]"
                : "w-[124px]";

            return (
              <button
                key={bucket.key}
                type="button"
                onClick={() => onBucketSelect(bucket)}
                className={`group shrink-0 rounded-[24px] border p-3 text-left transition ${widthClass} ${
                  isSelected
                    ? "border-cyan-300/45 bg-cyan-400/10 shadow-[0_22px_56px_-34px_rgba(34,211,238,0.9)]"
                    : "border-white/[0.06] bg-white/[0.025] hover:border-white/[0.16] hover:bg-white/[0.05]"
                }`}
              >
                <div className="relative flex h-28 items-end overflow-hidden rounded-[18px] border border-white/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(4,7,12,0.5))] px-3 pb-3 pt-4">
                  <div className="absolute inset-x-0 top-0 h-16 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),rgba(0,0,0,0)_70%)]" />
                  <div className="absolute inset-x-3 bottom-3 top-3 rounded-[14px] border border-white/[0.04] bg-black/20" />
                  <div className="relative z-10 flex w-full items-end">
                    <div
                      className={`w-full rounded-[12px] transition-all ${
                        bucket.has_video
                          ? isSelected
                            ? "bg-[linear-gradient(180deg,rgba(34,211,238,0.92),rgba(59,130,246,0.78))]"
                            : "bg-[linear-gradient(180deg,rgba(56,189,248,0.72),rgba(14,165,233,0.45))]"
                          : "bg-white/[0.08]"
                      }`}
                      style={{ height: `${fillHeight}%` }}
                    />
                  </div>
                  {isLiveEdge ? (
                    <span className="absolute right-3 top-3 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-100">
                      Live
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 min-w-0">
                  <div className="truncate text-sm font-semibold text-white">
                    {formatRecordingBucketLabel(bucket, zoom, locale)}
                  </div>
                  <div className="mt-1 truncate text-[11px] uppercase tracking-[0.16em] text-slate-500">
                    {formatRecordingBucketSecondaryLabel(bucket, zoom, locale)}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span>{bucket.clip_count} clips</span>
                    <span>{formatRecordingDurationShort(bucket.recorded_seconds, locale)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

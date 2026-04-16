import { Video, X } from "lucide-react";
import type { UploadedVideoAttachment as UploadedVideoAttachmentData } from "@/shared/types";

interface UploadedVideoAttachmentProps {
  attachment: UploadedVideoAttachmentData;
  mode?: "composer" | "message";
  pendingLabel?: string | null;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

function formatFileSize(bytes?: number | null): string | null {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds?: number | null): string | null {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return null;
  const totalSeconds = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (minutes <= 0) return `${remainingSeconds}s`;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function deriveFallbackVideoName(url?: string | null): string {
  if (!url) return "Video file";
  try {
    const decoded = decodeURIComponent(url.split("/").pop() || "");
    if (decoded.trim()) {
      return decoded;
    }
  } catch {
  }
  return "Video file";
}

export default function UploadedVideoAttachment({
  attachment,
  mode = "message",
  pendingLabel = null,
  onRemove,
  disabled = false,
  className = "",
}: UploadedVideoAttachmentProps) {
  const hasThumbnail = typeof attachment.thumbnailUrl === "string" && attachment.thumbnailUrl.trim().length > 0;
  const clickable =
    mode === "message" &&
    typeof attachment.publicUrl === "string" &&
    attachment.publicUrl.trim().length > 0;
  const fileName =
    (typeof attachment.originalName === "string" && attachment.originalName.trim()) ||
    deriveFallbackVideoName(attachment.publicUrl);
  const sizeLabel = formatFileSize(attachment.sizeBytes);
  const durationLabel = formatDuration(attachment.durationSeconds);
  const metaLabel = [pendingLabel, sizeLabel, durationLabel].filter(Boolean).join(" • ");
  const cardClassName =
    mode === "composer"
      ? "w-[240px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-white/[0.04] shadow-[0_16px_46px_-30px_rgba(0,0,0,0.9)]"
      : "mb-3 w-full max-w-[320px] overflow-hidden rounded-[20px] border border-white/15 bg-white/10 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.75)]";
  const content = (
    <div className={`${cardClassName} ${className}`.trim()}>
      <div className="relative">
        {hasThumbnail ? (
          <img
            src={attachment.thumbnailUrl ?? undefined}
            alt={fileName}
            className="h-36 w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-36 w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(74,149,255,0.35),rgba(17,24,39,0.96)_70%)]">
            <Video className="h-11 w-11 text-white/80" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
        <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white/90 backdrop-blur-sm">
          <Video className="h-3.5 w-3.5" />
          <span>Video</span>
        </div>
        {clickable ? (
          <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/45 px-2 py-1 text-[11px] font-medium text-white/85 backdrop-blur-sm">
            Open
          </div>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-red-600/90 text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Remove video"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 p-3">
          <p className="truncate text-sm font-medium text-white">{fileName}</p>
          {metaLabel ? <p className="mt-1 text-xs text-white/70">{metaLabel}</p> : null}
        </div>
      </div>
    </div>
  );

  if (clickable && attachment.publicUrl) {
    return (
      <a href={attachment.publicUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
        {content}
      </a>
    );
  }

  return content;
}

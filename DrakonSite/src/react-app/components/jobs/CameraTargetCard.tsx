import { ReactNode } from "react";
import { Camera } from "lucide-react";

interface CameraTargetCardProps {
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  topRight?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  thumbnailUrl?: string | null;
  anchorRef?: (node: HTMLDivElement | null) => void;
  density?: "normal" | "compact";
}

export default function CameraTargetCard({
  title,
  subtitle,
  badges,
  topRight,
  body,
  footer,
  thumbnailUrl,
  anchorRef,
  density = "normal",
}: CameraTargetCardProps) {
  const isCompact = density === "compact";

  return (
    <div
      ref={anchorRef}
      className={`overflow-hidden border border-gray-800/80 bg-gray-950/72 shadow-[0_20px_56px_-50px_rgba(0,0,0,0.98)] ${
        isCompact ? "rounded-[12px]" : "rounded-[16px]"
      }`}
    >
      <div className={`flex gap-2.5 ${isCompact ? "p-1.5" : "p-2.5"}`}>
        <div className={`relative shrink-0 overflow-hidden border border-gray-800/80 bg-gray-900 ${
          isCompact ? "h-9 w-9 rounded-[9px]" : "h-12 w-12 rounded-[12px]"
        }`}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(74,149,255,0.18),rgba(17,17,17,0.9)_68%)]">
              <div className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-white/10 bg-white/5 text-gray-200">
                <Camera className="h-4 w-4" />
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className={`truncate font-semibold text-gray-100 ${isCompact ? "text-[13px]" : "text-[15px]"}`}>{title}</div>
                {badges ? <div className="flex flex-wrap gap-2">{badges}</div> : null}
              </div>
              {subtitle ? <div className={`mt-1 text-gray-400 ${isCompact ? "text-[9px]" : "text-[11px]"}`}>{subtitle}</div> : null}
            </div>
            {topRight ? <div className="shrink-0">{topRight}</div> : null}
          </div>
          {body ? <div className="mt-2">{body}</div> : null}
        </div>
      </div>
      {footer ? <div className={`border-t border-gray-800/80 ${isCompact ? "p-1.5" : "p-2.5"}`}>{footer}</div> : null}
    </div>
  );
}

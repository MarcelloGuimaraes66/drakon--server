import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Map, Zap } from "lucide-react";
import { getBrazilStateName } from "@/shared/brazilStates";
import {
  BRAZIL_STATE_TILES,
  BRAZIL_TILEMAP_VIEWBOX,
} from "@/react-app/data/brazilStateTiles";

interface BrazilStateTileMapProps {
  selectedStates: string[];
  onToggleState: (stateCode: string) => void;
  stateCounts?: Record<string, number>;
  disabled?: boolean;
}

export default function BrazilStateTileMap({
  selectedStates,
  onToggleState,
  stateCounts = {},
  disabled = false,
}: BrazilStateTileMapProps) {
  const { t } = useTranslation();
  const selected = new Set(selectedStates);

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>, stateCode: string) => {
    if (disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onToggleState(stateCode);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.14),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(37,99,235,0.18),transparent_28%),linear-gradient(180deg,rgba(6,10,18,0.96),rgba(10,14,24,0.98))] p-5 shadow-[0_24px_80px_rgba(4,12,28,0.5)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-16 h-56 w-56 rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="absolute right-0 top-0 h-64 w-64 rounded-full bg-blue-500/12 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-48 w-48 rounded-full bg-sky-400/8 blur-3xl" />
      </div>

      <div className="relative z-10 mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200/70">
            {t("drakonFind.map.region")}
          </p>
          <div className="flex items-center gap-2">
            <Map className="h-4 w-4 text-cyan-300" />
            <h3 className="text-lg font-semibold text-gray-100">{t("drakonFind.map.title")}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-cyan-500/20 bg-gray-950/60 px-3 py-1.5 text-xs text-gray-300">
          <Zap className="h-3.5 w-3.5 text-cyan-300" />
          {t("drakonFind.map.hint")}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${BRAZIL_TILEMAP_VIEWBOX.width} ${BRAZIL_TILEMAP_VIEWBOX.height}`}
        className="relative z-10 h-[520px] w-full"
      >
        <defs>
          <pattern
            id="drakon-find-grid"
            width="36"
            height="36"
            patternUnits="userSpaceOnUse"
          >
            <path d="M 36 0 L 0 0 0 36" fill="none" stroke="rgba(148,163,184,0.08)" />
          </pattern>
        </defs>

        <rect
          x="0"
          y="0"
          width={BRAZIL_TILEMAP_VIEWBOX.width}
          height={BRAZIL_TILEMAP_VIEWBOX.height}
          fill="url(#drakon-find-grid)"
          opacity="0.7"
        />

        {BRAZIL_STATE_TILES.map((tile) => {
          const stateName = getBrazilStateName(tile.code);
          const isSelected = selected.has(tile.code);
          const cameraCount = Number(stateCounts[tile.code] || 0);
          const fill = isSelected
            ? "rgba(24, 132, 255, 0.92)"
            : cameraCount > 0
            ? "rgba(16, 24, 39, 0.94)"
            : "rgba(8, 12, 22, 0.84)";
          const stroke = isSelected
            ? "rgba(125, 211, 252, 0.96)"
            : cameraCount > 0
            ? "rgba(96, 165, 250, 0.4)"
            : "rgba(107, 114, 128, 0.22)";
          const accent = isSelected ? "#dff6ff" : cameraCount > 0 ? "#dbeafe" : "#d4d4d8";

          return (
            <g
              key={tile.code}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-pressed={isSelected}
              aria-label={cameraCount > 0
                ? t("drakonFind.map.ariaWithCameras", { state: stateName, count: cameraCount })
                : t("drakonFind.map.ariaWithoutCameras", { state: stateName })}
              className={disabled ? "pointer-events-none" : "cursor-pointer"}
              onClick={() => {
                if (!disabled) {
                  onToggleState(tile.code);
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, tile.code)}
            >
              <rect
                x={tile.x}
                y={tile.y}
                width={tile.width}
                height={tile.height}
                rx="18"
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 2.6 : 1.2}
                style={
                  isSelected
                    ? { filter: "drop-shadow(0 0 18px rgba(34, 211, 238, 0.34))" }
                    : undefined
                }
              />

              <text
                x={tile.x + tile.width / 2}
                y={tile.y + tile.height / 2 - (cameraCount > 0 ? 6 : 0)}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={accent}
                fontSize="18"
                fontWeight="700"
                letterSpacing="0.08em"
              >
                {tile.code}
              </text>

              {cameraCount > 0 && (
                <text
                  x={tile.x + tile.width / 2}
                  y={tile.y + tile.height / 2 + 16}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={isSelected ? "#dff6ff" : "#7dd3fc"}
                  fontSize="11"
                  fontWeight="600"
                >
                  {cameraCount} {t("drakonFind.map.cameraShort")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

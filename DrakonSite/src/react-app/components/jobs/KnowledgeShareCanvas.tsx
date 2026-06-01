import { RefObject, useEffect, useState } from "react";

export interface KnowledgeShareConnection {
  id: string;
  fromKey: string;
  toKey: string;
  variant?: "knowledge";
  layout?: "same-step" | "cross-step";
}

interface RenderedConnection extends KnowledgeShareConnection {
  d: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface KnowledgeShareCanvasProps {
  containerRef: RefObject<HTMLDivElement | null>;
  anchorElements: Record<string, HTMLDivElement | null>;
  connections: KnowledgeShareConnection[];
}

export default function KnowledgeShareCanvas({
  containerRef,
  anchorElements,
  connections,
}: KnowledgeShareCanvasProps) {
  const [renderedConnections, setRenderedConnections] = useState<RenderedConnection[]>([]);

  useEffect(() => {
    const recompute = () => {
      const container = containerRef.current;
      if (!container || connections.length === 0) {
        setRenderedConnections([]);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const next = connections
        .map((connection) => {
          const fromElement = anchorElements[connection.fromKey];
          const toElement = anchorElements[connection.toKey];

          if (!fromElement || !toElement) return null;

          const fromRect = fromElement.getBoundingClientRect();
          const toRect = toElement.getBoundingClientRect();

          const startY = fromRect.top + fromRect.height / 2 - containerRect.top;
          const endY = toRect.top + toRect.height / 2 - containerRect.top;

          let startX: number;
          let endX: number;
          let d: string;

          if (connection.layout === "same-step") {
            startX = fromRect.right - containerRect.left - 10;
            endX = toRect.right - containerRect.left - 10;
            const routeX = Math.max(startX, endX) + 28;
            d = `M ${startX} ${startY} C ${routeX} ${startY}, ${routeX} ${endY}, ${endX} ${endY}`;
          } else {
            startX = fromRect.right - containerRect.left - 8;
            endX = toRect.left - containerRect.left + 8;
            const curve = Math.max(52, Math.abs(endX - startX) * 0.45);
            d = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
          }

          return {
            ...connection,
            d,
            startX,
            startY,
            endX,
            endY,
          };
        })
        .filter(Boolean) as RenderedConnection[];

      setRenderedConnections(next);
    };

    const frame = window.requestAnimationFrame(recompute);
    const resizeHandler = () => recompute();
    const scrollHandler = () => recompute();
    const observer =
      typeof ResizeObserver !== "undefined" && containerRef.current
        ? new ResizeObserver(() => recompute())
        : null;

    if (observer && containerRef.current) {
      observer.observe(containerRef.current);
    }

    window.addEventListener("resize", resizeHandler);
    window.addEventListener("scroll", scrollHandler, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resizeHandler);
      window.removeEventListener("scroll", scrollHandler, true);
    };
  }, [anchorElements, connections, containerRef]);

  if (renderedConnections.length === 0) {
    return null;
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-0 h-full w-full overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="knowledge-share-line" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(74,149,255,0.12)" />
          <stop offset="35%" stopColor="rgba(74,149,255,0.9)" />
          <stop offset="100%" stopColor="rgba(120,220,255,0.8)" />
        </linearGradient>
        <filter id="knowledge-share-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {renderedConnections.map((connection) => (
        <g key={connection.id}>
          <path
            d={connection.d}
            stroke="rgba(74,149,255,0.18)"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d={connection.d}
            stroke="url(#knowledge-share-line)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            filter="url(#knowledge-share-glow)"
          />
          <circle cx={connection.startX} cy={connection.startY} r="4" fill="#4A95FF" />
          <circle cx={connection.endX} cy={connection.endY} r="4" fill="#7CE4FF" />
        </g>
      ))}
    </svg>
  );
}

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MessageSquare } from "lucide-react";
import { useQuickChat } from "@/react-app/hooks/useQuickChat";
import { brand } from "@/shared/brand";

type FloatingEdge = "left" | "right" | "top" | "bottom";

type FloatingButtonPosition = {
  edge: FloatingEdge;
  offset: number;
};

const FAB_SIZE_PX = 56;
const FAB_MARGIN_PX = 24;
const FAB_TOP_SAFE_PX = 88;

function getStorageKey() {
  return `${brand.id}:quick-chat-fab-position`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getViewportBounds() {
  if (typeof window === "undefined") {
    return {
      minLeft: FAB_MARGIN_PX,
      maxLeft: FAB_MARGIN_PX,
      minTop: FAB_TOP_SAFE_PX,
      maxTop: FAB_TOP_SAFE_PX,
    };
  }

  return {
    minLeft: FAB_MARGIN_PX,
    maxLeft: Math.max(FAB_MARGIN_PX, window.innerWidth - FAB_SIZE_PX - FAB_MARGIN_PX),
    minTop: FAB_TOP_SAFE_PX,
    maxTop: Math.max(FAB_TOP_SAFE_PX, window.innerHeight - FAB_SIZE_PX - FAB_MARGIN_PX),
  };
}

function buildDefaultPosition(): FloatingButtonPosition {
  const bounds = getViewportBounds();
  return {
    edge: "right",
    offset: bounds.maxTop,
  };
}

function readStoredPosition(): FloatingButtonPosition {
  if (typeof window === "undefined") {
    return buildDefaultPosition();
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey());
    if (!raw) {
      return buildDefaultPosition();
    }

    const parsed = JSON.parse(raw) as Partial<FloatingButtonPosition>;
    if (
      !parsed ||
      (parsed.edge !== "left" &&
        parsed.edge !== "right" &&
        parsed.edge !== "top" &&
        parsed.edge !== "bottom") ||
      typeof parsed.offset !== "number" ||
      !Number.isFinite(parsed.offset)
    ) {
      return buildDefaultPosition();
    }

    return clampPositionToViewport({
      edge: parsed.edge,
      offset: parsed.offset,
    });
  } catch {
    return buildDefaultPosition();
  }
}

function clampPositionToViewport(position: FloatingButtonPosition): FloatingButtonPosition {
  const bounds = getViewportBounds();
  if (position.edge === "left" || position.edge === "right") {
    return {
      edge: position.edge,
      offset: clamp(position.offset, bounds.minTop, bounds.maxTop),
    };
  }

  return {
    edge: position.edge,
    offset: clamp(position.offset, bounds.minLeft, bounds.maxLeft),
  };
}

function positionToCoordinates(position: FloatingButtonPosition) {
  const bounds = getViewportBounds();
  if (position.edge === "left") {
    return { left: bounds.minLeft, top: clamp(position.offset, bounds.minTop, bounds.maxTop) };
  }
  if (position.edge === "right") {
    return { left: bounds.maxLeft, top: clamp(position.offset, bounds.minTop, bounds.maxTop) };
  }
  if (position.edge === "top") {
    return { left: clamp(position.offset, bounds.minLeft, bounds.maxLeft), top: bounds.minTop };
  }

  return { left: clamp(position.offset, bounds.minLeft, bounds.maxLeft), top: bounds.maxTop };
}

function coordinatesToClosestEdge(left: number, top: number): FloatingButtonPosition {
  const bounds = getViewportBounds();
  const clampedLeft = clamp(left, bounds.minLeft, bounds.maxLeft);
  const clampedTop = clamp(top, bounds.minTop, bounds.maxTop);
  const distances = [
    { edge: "left" as const, distance: Math.abs(clampedLeft - bounds.minLeft), offset: clampedTop },
    { edge: "right" as const, distance: Math.abs(clampedLeft - bounds.maxLeft), offset: clampedTop },
    { edge: "top" as const, distance: Math.abs(clampedTop - bounds.minTop), offset: clampedLeft },
    { edge: "bottom" as const, distance: Math.abs(clampedTop - bounds.maxTop), offset: clampedLeft },
  ];

  distances.sort((a, b) => a.distance - b.distance);

  return clampPositionToViewport({
    edge: distances[0].edge,
    offset: distances[0].offset,
  });
}

function persistPosition(position: FloatingButtonPosition) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getStorageKey(), JSON.stringify(position));
}

export default function FloatingChatButton() {
  const { openQuickChat } = useQuickChat();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const movedRef = useRef(false);
  const [position, setPosition] = useState<FloatingButtonPosition>(() => readStoredPosition());
  const [dragCoordinates, setDragCoordinates] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => {
        const next = clampPositionToViewport(current);
        persistPosition(next);
        return next;
      });
      setDragCoordinates((current) => {
        if (!current) return current;
        const bounds = getViewportBounds();
        return {
          left: clamp(current.left, bounds.minLeft, bounds.maxLeft),
          top: clamp(current.top, bounds.minTop, bounds.maxTop),
        };
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStartRef.current) return;

      const bounds = getViewportBounds();
      const deltaX = event.clientX - dragStartRef.current.x;
      const deltaY = event.clientY - dragStartRef.current.y;
      const nextLeft = clamp(dragStartRef.current.left + deltaX, bounds.minLeft, bounds.maxLeft);
      const nextTop = clamp(dragStartRef.current.top + deltaY, bounds.minTop, bounds.maxTop);

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        movedRef.current = true;
      }

      setDragCoordinates({ left: nextLeft, top: nextTop });
    };

    const handlePointerUp = () => {
      if (!dragStartRef.current) return;

      const finalCoordinates =
        dragCoordinates ||
        positionToCoordinates(clampPositionToViewport(position));
      const snapped = coordinatesToClosestEdge(finalCoordinates.left, finalCoordinates.top);
      setPosition(snapped);
      persistPosition(snapped);
      setDragCoordinates(null);
      dragStartRef.current = null;

      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    if (dragStartRef.current) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    }

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragCoordinates, position]);

  const buttonStyle = useMemo(() => {
    if (dragCoordinates) {
      return {
        left: `${dragCoordinates.left}px`,
        top: `${dragCoordinates.top}px`,
      };
    }

    const { left, top } = positionToCoordinates(position);
    return {
      left: `${left}px`,
      top: `${top}px`,
    };
  }, [dragCoordinates, position]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;

    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;

    event.currentTarget.setPointerCapture?.(event.pointerId);
    movedRef.current = false;
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
    };
    setDragCoordinates({ left: rect.left, top: rect.top });
  };

  const handleClick = () => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }

    openQuickChat();
  };

  return (
    <button
      ref={buttonRef}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className="fixed z-40 flex h-14 w-14 touch-none items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-800 shadow-lg transition-[box-shadow,transform,background] duration-300 hover:from-gray-600 hover:to-gray-700 hover:shadow-2xl hover:shadow-black/60 hover:scale-[1.03] active:scale-[0.98] cursor-grab active:cursor-grabbing group"
      style={buttonStyle}
      aria-label={`Open ${brand.quickChatName}`}
    >
      <MessageSquare className="h-6 w-6 text-white transition-transform group-hover:scale-110" />
    </button>
  );
}

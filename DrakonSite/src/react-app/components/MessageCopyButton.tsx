import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  text: string;
  className?: string;
  hoverHideDelayMs?: number;
};

function fallbackCopyText(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function MessageCopyButton({
  text,
  className = "",
  hoverHideDelayMs = 500,
}: Props) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<number | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const button = buttonRef.current;
    const hoverContainer = button?.closest(".group");
    if (!hoverContainer) {
      return;
    }

    const show = () => {
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setIsVisible(true);
    };

    const scheduleHide = () => {
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
      }
      hoverTimeoutRef.current = window.setTimeout(() => {
        setIsVisible(false);
        hoverTimeoutRef.current = null;
      }, hoverHideDelayMs);
    };

    hoverContainer.addEventListener("pointerenter", show);
    hoverContainer.addEventListener("pointerleave", scheduleHide);

    return () => {
      hoverContainer.removeEventListener("pointerenter", show);
      hoverContainer.removeEventListener("pointerleave", scheduleHide);
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
  }, [hoverHideDelayMs]);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!text.trim()) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopyText(text);
      }
      setCopied(true);
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
      resetTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimeoutRef.current = null;
      }, 1600);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  };

  const show = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsVisible(true);
  };

  const scheduleHide = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
      hoverTimeoutRef.current = null;
    }, hoverHideDelayMs);
  };

  const shouldShow = copied || isVisible;
  const visibilityClasses = shouldShow
    ? "pointer-events-auto translate-y-0 opacity-100"
    : "pointer-events-none translate-y-1 opacity-0";

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleCopy}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.06] text-slate-200/80 shadow-sm backdrop-blur-sm transition-all duration-150 hover:bg-white/[0.14] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/35",
        visibilityClasses,
        className,
      ].join(" ")}
      title={copied ? "Copied" : "Copy message"}
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

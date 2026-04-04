import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy } from "lucide-react";

type Props = {
  text: string;
  className?: string;
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

export default function MessageCopyButton({ text, className = "" }: Props) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

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

  const visibilityClasses = [
    "pointer-events-none translate-y-1 opacity-0",
    "group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100",
    "group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100",
    "focus-visible:pointer-events-auto focus-visible:translate-y-0 focus-visible:opacity-100",
  ].join(" ");

  return (
    <button
      type="button"
      onClick={handleCopy}
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

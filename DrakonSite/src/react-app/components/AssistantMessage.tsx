import { Bot, Camera } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState, type ReactNode } from "react";
import HitMediaAlbum from "@/react-app/components/HitMediaAlbum";
import MessageCopyButton from "@/react-app/components/MessageCopyButton";
import usePrefersReducedMotion from "@/react-app/hooks/usePrefersReducedMotion";
import {
  formatAssistantMessageContent,
  shouldSuppressAssistantCameraFooter,
} from "@/react-app/utils/chatUtils";
import { buildChatRevealPlan } from "@/react-app/utils/chatRevealPlan";
import { CHAT_ASSISTANT_BADGE_CLASS } from "@/react-app/lib/chatAssistantStyles";

interface AssistantMessageProps {
  content: string;
  hitMedia?: Array<{
    media_type: "image" | "video";
    url: string;
    time_in_video?: string;
    key?: string;
  }>;
  cameraLabel?: string | null;
  compact?: boolean;
  variant?: "default" | "chat-page";
  supplementalContent?: ReactNode;
  animateReveal?: boolean;
  revealId?: string | null;
  onRevealProgress?: () => void;
  onRevealComplete?: (revealId: string) => void;
}

function assistantMarkdownComponents(compact: boolean) {
  const baseText = compact
    ? "text-[15px] leading-7 tracking-[0.01em]"
    : "text-[16px] leading-[1.85] tracking-[0.005em] md:text-[17px]";
  const paragraphSpacing = compact ? "mb-4 last:mb-0" : "mb-5 last:mb-0";
  const headingSpacing = compact ? "mt-5 mb-2.5 first:mt-0" : "mt-6 mb-3 first:mt-0";
  const listSpacing = compact ? "space-y-2.5" : "space-y-3";
  const blockSpacing = compact ? "my-4" : "my-5";

  return {
    h1: ({ children }: any) => (
      <h1 className={`text-xl font-semibold tracking-tight text-white ${headingSpacing}`}>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className={`text-lg font-semibold tracking-tight text-white ${headingSpacing}`}>
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className={`text-base font-semibold tracking-tight text-gray-50 ${headingSpacing}`}>
        {children}
      </h3>
    ),
    p: ({ children }: any) => (
      <p className={`${baseText} ${paragraphSpacing} break-words whitespace-pre-wrap text-gray-100`}>
        {children}
      </p>
    ),
    ul: ({ children }: any) => (
      <ul className={`${blockSpacing} pl-5 list-disc marker:text-blue-300 ${baseText} ${listSpacing}`}>
        {children}
      </ul>
    ),
    ol: ({ children }: any) => (
      <ol className={`${blockSpacing} pl-5 list-decimal marker:text-blue-300 ${baseText} ${listSpacing}`}>
        {children}
      </ol>
    ),
    li: ({ children }: any) => (
      <li className="pl-1 text-gray-100 leading-[1.85]">
        {children}
      </li>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-white">
        {children}
      </strong>
    ),
    em: ({ children }: any) => (
      <em className="italic text-gray-100">
        {children}
      </em>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className={`${blockSpacing} rounded-r-2xl border-l-2 border-blue-400/50 bg-white/[0.03] px-4 py-3 text-gray-200`}>
        {children}
      </blockquote>
    ),
    hr: () => <hr className={`${blockSpacing} border-gray-700/60`} />,
    a: ({ href, children }: any) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-blue-300 underline decoration-blue-400/40 underline-offset-4 transition-colors hover:text-blue-200"
      >
        {children}
      </a>
    ),
    code: ({ inline, className, children, ...props }: any) => {
      if (inline) {
        return (
          <code
            className="rounded-md border border-white/10 bg-black/25 px-1.5 py-0.5 font-mono text-[0.92em] text-sky-200"
            {...props}
          >
            {children}
          </code>
        );
      }

      const language = typeof className === "string"
        ? className.replace("language-", "").trim()
        : "";

      return (
        <div className={`${blockSpacing} overflow-hidden rounded-2xl border border-gray-700/70 bg-[#0b1220] shadow-inner shadow-black/20`}>
          {language ? (
            <div className="border-b border-gray-700/70 bg-white/[0.03] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400">
              {language}
            </div>
          ) : null}
          <pre className="overflow-x-auto px-4 py-4">
            <code className="block whitespace-pre font-mono text-sm leading-6 text-slate-100" {...props}>
              {children}
            </code>
          </pre>
        </div>
      );
    },
    pre: ({ children }: any) => <>{children}</>,
    table: ({ children }: any) => (
      <div className={`${blockSpacing} overflow-x-auto rounded-2xl border border-gray-700/70`}>
        <table className="min-w-full border-collapse text-left text-sm text-gray-200">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-white/[0.04]">{children}</thead>,
    th: ({ children }: any) => (
      <th className="border-b border-gray-700/70 px-4 py-3 font-semibold text-gray-100">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="border-b border-gray-800/70 px-4 py-3 align-top text-gray-300">
        {children}
      </td>
    ),
  };
}

interface TypingMarkdownProps {
  markdown: string;
  compact: boolean;
  animateReveal: boolean;
  revealId: string | null;
  onRevealProgress?: () => void;
  onRevealComplete?: (revealId: string) => void;
}

function easeOutCubic(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

function TypingMarkdown({
  markdown,
  compact,
  animateReveal,
  revealId,
  onRevealProgress,
  onRevealComplete,
}: TypingMarkdownProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const planCacheRef = useRef<ReturnType<typeof buildChatRevealPlan> & { markdown: string } | null>(null);
  const onRevealProgressRef = useRef(onRevealProgress);
  const onRevealCompleteRef = useRef(onRevealComplete);
  const completedRevealIdRef = useRef<string | null>(null);

  if (!planCacheRef.current || planCacheRef.current.markdown !== markdown) {
    planCacheRef.current = {
      markdown,
      ...buildChatRevealPlan(markdown),
    };
  }

  const revealPlan = planCacheRef.current!;
  const [forceRevealComplete, setForceRevealComplete] = useState(false);
  const [visibleChunkCount, setVisibleChunkCount] = useState(() =>
    animateReveal && revealId ? 1 : revealPlan.chunks.length,
  );
  const markdownComponents = assistantMarkdownComponents(compact);

  const markRevealComplete = () => {
    if (!revealId || completedRevealIdRef.current === revealId) {
      return;
    }

    completedRevealIdRef.current = revealId;
    onRevealCompleteRef.current?.(revealId);
  };

  useEffect(() => {
    onRevealProgressRef.current = onRevealProgress;
  }, [onRevealProgress]);

  useEffect(() => {
    onRevealCompleteRef.current = onRevealComplete;
  }, [onRevealComplete]);

  useEffect(() => {
    setForceRevealComplete(false);
    completedRevealIdRef.current = null;
  }, [markdown, revealId]);

  useEffect(() => {
    const totalChunks = revealPlan.chunks.length;

    if (!animateReveal || !revealId) {
      setVisibleChunkCount(totalChunks);
      return;
    }

    if (forceRevealComplete || prefersReducedMotion || totalChunks <= 1) {
      setVisibleChunkCount(totalChunks);
      onRevealProgressRef.current?.();
      markRevealComplete();
      return;
    }

    let animationFrameId = 0;
    let cancelled = false;
    let lastRenderedChunkCount = 1;

    setVisibleChunkCount(1);
    onRevealProgressRef.current?.();

    const animationStartedAt = performance.now();
    const revealDurationMs = revealPlan.totalDurationMs;

    const renderFrame = (timestamp: number) => {
      if (cancelled) {
        return;
      }

      const rawProgress =
        revealDurationMs <= 0
          ? 1
          : Math.min(1, (timestamp - animationStartedAt) / revealDurationMs);
      const easedProgress = easeOutCubic(rawProgress);
      const nextChunkCount = Math.max(
        1,
        Math.min(totalChunks, Math.ceil(easedProgress * totalChunks)),
      );

      if (nextChunkCount !== lastRenderedChunkCount) {
        lastRenderedChunkCount = nextChunkCount;
        setVisibleChunkCount(nextChunkCount);
        onRevealProgressRef.current?.();
      }

      if (rawProgress >= 1) {
        markRevealComplete();
        return;
      }

      animationFrameId = window.requestAnimationFrame(renderFrame);
    };

    animationFrameId = window.requestAnimationFrame(renderFrame);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [
    animateReveal,
    forceRevealComplete,
    markdown,
    prefersReducedMotion,
    revealId,
    revealPlan.chunks.length,
    revealPlan.totalDurationMs,
  ]);

  const displayMarkdown =
    animateReveal && revealId
      ? revealPlan.chunks.slice(0, visibleChunkCount).join("")
      : markdown;

  const handleTextInteractionStart = () => {
    if (!animateReveal || !revealId || forceRevealComplete) {
      return;
    }

    setForceRevealComplete(true);
  };

  return (
    <div
      className="select-text cursor-text"
      onPointerDownCapture={handleTextInteractionStart}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={markdownComponents}
      >
        {displayMarkdown}
      </ReactMarkdown>
    </div>
  );
}

export default function AssistantMessage({
  content,
  hitMedia = [],
  cameraLabel = null,
  compact = false,
  variant = "default",
  supplementalContent = null,
  animateReveal = false,
  revealId = null,
  onRevealProgress,
  onRevealComplete,
}: AssistantMessageProps) {
  const markdown = formatAssistantMessageContent(content);
  const suppressCameraFooter = shouldSuppressAssistantCameraFooter(content);
  const isChatPageVariant = variant === "chat-page";
  const contentWidthClasses = compact ? "max-w-[34rem]" : "max-w-[68ch]";
  const bubbleClasses = compact
    ? "max-w-[82%] px-4 py-3"
    : "w-full max-w-full px-5 py-4 md:max-w-[50rem] md:px-7 md:py-5 xl:max-w-[54rem]";

  return (
    <div className={`flex items-start justify-start ${compact ? "gap-3" : "gap-4"}`}>
      <div
        className={`flex-shrink-0 rounded-xl flex items-center justify-center ${
          isChatPageVariant
            ? CHAT_ASSISTANT_BADGE_CLASS
            : "bg-gradient-to-br from-gray-700 to-gray-800"
        } ${
          compact ? "w-8 h-8" : "w-8 h-8 md:w-10 md:h-10"
        }`}
      >
        <Bot className={`${compact ? "w-4 h-4" : "w-4 h-4 md:w-5 md:h-5"} text-white`} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="group relative min-w-0">
          <div
            className={[
              bubbleClasses,
              isChatPageVariant
                ? "min-w-0 overflow-hidden rounded-[28px] border border-white/[0.08] bg-white/[0.035] text-gray-100 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)] backdrop-blur-sm"
                : "min-w-0 overflow-hidden rounded-[26px] border border-gray-700/60 bg-gradient-to-br from-gray-800/95 via-gray-800/90 to-gray-900/95 text-gray-100 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.8)] backdrop-blur-sm",
            ].join(" ")}
          >
            <div className={compact ? "space-y-3" : "space-y-5"}>
              <div className={contentWidthClasses}>
                <TypingMarkdown
                  markdown={markdown}
                  compact={compact}
                  animateReveal={animateReveal}
                  revealId={revealId}
                  onRevealProgress={onRevealProgress}
                  onRevealComplete={onRevealComplete}
                />
              </div>

              {hitMedia.length > 0 && <HitMediaAlbum items={hitMedia} />}

              {supplementalContent}

              {cameraLabel && !suppressCameraFooter ? (
                <div className="border-t border-gray-700/50 pt-3">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Camera className="w-3 h-3" />
                    {cameraLabel}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <MessageCopyButton
            text={markdown}
            className={compact ? "absolute left-2 top-[calc(100%+0.375rem)] z-20" : "absolute left-3 top-[calc(100%+0.375rem)] z-20"}
          />
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQuickChat } from "@/react-app/hooks/useQuickChat";
import { usePerceptrumChatSession } from "@/react-app/hooks/usePerceptrumChatSession";
import ChatInput from "@/react-app/components/ChatInput";
import AssistantMessage from "@/react-app/components/AssistantMessage";
import ChatPlexusBackground from "@/react-app/components/ChatPlexusBackground";
import ModelHostingBadge from "@/react-app/components/ModelHostingBadge";
import PendingAssistantMessage from "@/react-app/components/PendingAssistantMessage";
import { ChatMessage } from "@/shared/types";
import { brand, getBrandStorageKey } from "@/shared/brand";
import { X, Bot, User, ExternalLink, Minus, AlertCircle } from "lucide-react";
import {
  extractChatProgressFromMessage,
  extractHitMediaFromMessage,
  formatMessageContent,
} from "@/react-app/utils/chatUtils";
import { CHAT_ASSISTANT_BADGE_CLASS } from "@/react-app/lib/chatAssistantStyles";

type ChatModelTier = "ultra" | "ultra_plus" | "light" | "core";
type ChatRunningResolution = 640 | 1024;
const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "ultra";
const DEFAULT_CHAT_CORE_RUNNING_RESOLUTION: ChatRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;
const QUICK_CHAT_PLEXUS_BACKGROUND_ENABLED = true;

const MODEL_FPS_BY_TIER: Record<ChatModelTier, number> = {
  ultra: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  ultra_plus: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  light: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  core: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
};

const supportsAdjustableVideoFps = (tier: ChatModelTier): boolean =>
  tier === "ultra" || tier === "ultra_plus" || tier === "light";

function normalizeChatModelTier(value: string | null | undefined): ChatModelTier {
  if (typeof value !== "string") return DEFAULT_CHAT_MODEL_TIER;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ultra+" || normalized === "ultra-plus" || normalized === "ultra_plus") {
    return "ultra_plus";
  }
  if (normalized === "core") return "core";
  if (normalized === "light") return "light";
  return "ultra";
}

function normalizeChatRunningResolution(
  value: unknown,
  fallback: ChatRunningResolution = DEFAULT_CHAT_CORE_RUNNING_RESOLUTION
): ChatRunningResolution {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded === 640 || rounded === 1024) return rounded;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (parsed === 640 || parsed === 1024) return parsed;
  }
  return fallback;
}

function normalizeChatModelFps(value: unknown, fallback = DEFAULT_ULTRA_VIDEO_MODEL_FPS): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, rounded));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, parsed));
    }
  }
  return normalizeChatModelFps(fallback, DEFAULT_ULTRA_VIDEO_MODEL_FPS);
}

function QuickThinkingDots() {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="chat-thinking-dot" style={{ animationDelay: "0ms" }} />
      <span className="chat-thinking-dot" style={{ animationDelay: "180ms" }} />
      <span className="chat-thinking-dot" style={{ animationDelay: "360ms" }} />
    </div>
  );
}

export default function QuickChatOverlay() {
  const { isOpen, sessionId, closeQuickChat, minimizeQuickChat, setSessionId } = useQuickChat();
  const navigate = useNavigate();
  const billingEnabled = brand.features.billingEnabled;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedVideo, setUploadedVideo] = useState<{
    id: number;
    publicUrl: string;
    originalName: string;
    sizeBytes: number;
  } | null>(null);
  const [modelTier, setModelTier] = useState<ChatModelTier>(DEFAULT_CHAT_MODEL_TIER);
  const [modelFps, setModelFps] = useState<number>(DEFAULT_ULTRA_VIDEO_MODEL_FPS);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const modelLabels: Record<ChatModelTier, string> = {
    ultra_plus: "Ultra+",
    ultra: "Ultra",
    light: "Light",
    core: "Core",
  };

  const { isLoading, error, warning, pendingExecutionState, sendMessage, cancelMessage, clearError, clearWarning } = usePerceptrumChatSession({
    sessionId,
    onMessagesUpdate: (updatedMessages) => {
      setMessages(updatedMessages);
    },
  });

  const pendingExecutionNotice =
    pendingExecutionState.kind === "offline"
      ? "Desktop agent offline. Open the EXE on this machine to continue."
      : pendingExecutionState.kind === "stale"
        ? "Desktop agent connection looks stale. Check whether the EXE is still connected."
        : null;

  useEffect(() => {
    if (sessionId) {
      // Clear messages immediately when session changes to prevent flicker
      setMessages([]);
      fetchMessages(sessionId);
    } else {
      // Clear messages when no session
      setMessages([]);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!isOpen) return;
    const savedTier = localStorage.getItem(getBrandStorageKey("globalModelTier"));
    const normalizedTier = normalizeChatModelTier(savedTier);
    setModelTier(normalizedTier);
    const savedModelFps = localStorage.getItem(getBrandStorageKey("globalUltraModelFps"));
    const normalizedModelFps = normalizeChatModelFps(savedModelFps);
    setModelFps(normalizedModelFps);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || sessionId) return;

    setMessages([]);
    setInput("");
    setUploadedImage(null);
    setUploadedVideo(null);
    setShouldAutoScroll(true);
    clearError();
    clearWarning();
  }, [clearError, clearWarning, isOpen, sessionId]);

  useEffect(() => {
    // Only auto-scroll if user is near the bottom
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messages, shouldAutoScroll]);

  const createQuickChatSession = async (): Promise<number | null> => {
    if (isCreatingSession) return null;

    setIsCreatingSession(true);
    clearError();
    clearWarning();
    try {
      const now = new Date().toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });

      const response = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Quick chat – ${now}` }),
      });

      if (!response.ok) {
        throw new Error("Failed to create chat session");
      }

      const newSession = await response.json() as { id: number };
      setMessages([]);
      setSessionId(newSession.id);
      return newSession.id;
    } catch (error) {
      console.error("Failed to create quick chat session:", error);
      return null;
    } finally {
      setIsCreatingSession(false);
    }
  };

  const fetchMessages = async (id: number) => {
    try {
      const response = await fetch(`/api/chat/sessions/${id}/messages`);
      const data = await response.json();
      setMessages(data);
    } catch (error) {
      console.error("Failed to fetch messages:", error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    
    // If user is within 100px of bottom, enable auto-scroll
    setShouldAutoScroll(distanceFromBottom < 100);
  };

  const handleSend = async () => {
    if ((!input.trim() && !uploadedImage && !uploadedVideo) || isCreatingSession) return;

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      targetSessionId = await createQuickChatSession();
      if (!targetSessionId) return;
    }

    const userMessage = input;
    const imageBase64 = uploadedImage;
    const videoId = uploadedVideo?.id;
    setInput("");
    setUploadedImage(null);
    setUploadedVideo(null);

    // Enable auto-scroll when user sends a message
    setShouldAutoScroll(true);

    // Get global model tier from localStorage
    const savedResolution = localStorage.getItem(getBrandStorageKey("globalRunningResolution"));
    const runningResolution = normalizeChatRunningResolution(savedResolution);

    await sendMessage({
      sessionIdOverride: targetSessionId,
      content: userMessage,
      uploadedImageBase64: imageBase64,
      uploadedVideoId: videoId,
      modelTier: modelTier,
      modelFps: supportsAdjustableVideoFps(modelTier) ? modelFps : MODEL_FPS_BY_TIER[modelTier],
      runningResolution: modelTier === "core" ? runningResolution : null,
    });
  };

  const handleOpenFullChat = () => {
    if (sessionId) {
      navigate(`/chat?session=${sessionId}`);
    } else {
      navigate("/chat");
    }
    closeQuickChat();
  };

  const renderMessage = (message: ChatMessage) => {
    const msg = message as any;
    const isPending = msg.is_pending === 1;

    // Show loading bubble for pending messages
    if (isPending) {
      const progress = extractChatProgressFromMessage(message);
      return (
        <PendingAssistantMessage
          key={message.id}
          content={msg.content}
          progress={progress}
          notice={pendingExecutionNotice}
          variant="quick-chat"
        />
      );
    }

    if (message.role === "user") {
      const userMsg = message as any;
      return (
        <div key={message.id} className="flex justify-end gap-4 animate-slide-up">
          <div className="max-w-[85%] min-w-0 overflow-hidden rounded-[26px] border border-blue-300/10 bg-gradient-to-br from-blue-500/90 via-blue-500/82 to-cyan-500/78 px-4 py-3 text-white shadow-[0_24px_60px_-30px_rgba(74,149,255,0.8)]">
            {userMsg.uploaded_image_base64 && (
              <img
                src={userMsg.uploaded_image_base64}
                alt="Uploaded"
                className="mb-3 max-h-32 rounded-2xl shadow-md"
              />
            )}
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap break-words"
              style={{ overflowWrap: "anywhere" }}
            >
              {formatMessageContent(message.content)}
            </p>
          </div>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
            <User className="h-4 w-4 text-white" />
          </div>
        </div>
      );
    }

    // Assistant message (router_ack, final, etc.) - show all messages when is_pending === 0
    // Extract hit media (images and videos) using shared utility
    const hitMedia = extractHitMediaFromMessage(message);

    return (
      <AssistantMessage
        key={message.id}
        content={message.content}
        hitMedia={hitMedia}
        cameraLabel={message.camera_ids ? `Camera #${message.camera_ids}` : null}
        variant="chat-page"
      />
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/18 backdrop-blur-[1.5px] transition-opacity"
        onClick={closeQuickChat}
      />

      {/* Overlay */}
      <div className="fixed inset-x-3 bottom-3 top-20 z-50 flex flex-col overflow-hidden rounded-[30px] border border-white/[0.08] bg-[radial-gradient(circle_at_top,rgba(84,90,130,0.26),rgba(24,27,38,0.95)_42%,rgba(11,12,18,0.98)_100%)] shadow-[0_40px_140px_-60px_rgba(0,0,0,0.98)] animate-slide-up md:inset-x-auto md:bottom-6 md:right-24 md:top-auto md:h-[76vh] md:max-h-[820px] md:w-[620px] lg:w-[700px]">
        {QUICK_CHAT_PLEXUS_BACKGROUND_ENABLED ? <ChatPlexusBackground className="opacity-[0.7]" /> : null}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-white/[0.05] to-transparent" />
        {/* Header */}
        <div className="relative border-b border-white/[0.06] px-5 pb-4 pt-5 md:px-6 md:pb-5 md:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-xl font-semibold tracking-tight text-white">{brand.quickChatName}</h3>
              <p className="mt-1 text-sm text-gray-400">Ask about live cameras, footage, and app help.</p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {supportsAdjustableVideoFps(modelTier) && (
                <select
                  value={modelFps}
                  onChange={(e) => {
                    const next = normalizeChatModelFps(e.target.value, modelFps);
                    setModelFps(next);
                    localStorage.setItem(getBrandStorageKey("globalUltraModelFps"), String(next));
                  }}
                  className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-gray-100 transition-colors hover:bg-white/[0.08]"
                  title="Video FPS"
                >
                  {Array.from({ length: MAX_ULTRA_VIDEO_MODEL_FPS }, (_, index) => {
                    const fps = index + 1;
                    return (
                      <option key={fps} value={fps}>
                        {`Video FPS: ${fps}`}
                      </option>
                    );
                  })}
                </select>
              )}
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-gray-100">
                <span className="mr-2 text-gray-400">Model</span>
                <span className="text-blue-300">{modelLabels[modelTier]}</span>
                <ModelHostingBadge modelTier={modelTier} compact className="ml-2 align-middle" />
              </div>
              <button
                onClick={handleOpenFullChat}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                title="Open full chat"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <button
                onClick={minimizeQuickChat}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                title="Minimize"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                onClick={closeQuickChat}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-2.5 text-gray-300 transition-colors hover:bg-white/[0.08] hover:text-white"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div 
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 pt-5 scrollbar-thin md:px-6 md:pb-6"
        >
          <div className="mx-auto flex w-full max-w-[620px] flex-col gap-5">
          {isCreatingSession && (
            <div className="flex items-center justify-center py-8">
              <QuickThinkingDots />
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4">
              <p className="text-sm text-red-400">{error}</p>
              {billingEnabled ? (
                <a
                  href="/billing"
                  className="text-sm text-blue-400 hover:underline mt-2 inline-block"
                >
                  Go to Billing →
                </a>
              ) : null}
            </div>
          )}

          {warning && (
            <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4">
              <p className="text-sm text-amber-300">{warning}</p>
            </div>
          )}

          {pendingExecutionNotice && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                <p className="text-sm text-amber-200">{pendingExecutionNotice}</p>
              </div>
            </div>
          )}

          {!isCreatingSession && messages.length === 0 && (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-10 text-center">
              <div className={`flex h-20 w-20 items-center justify-center rounded-[26px] ${CHAT_ASSISTANT_BADGE_CLASS}`}>
                <Bot className="h-10 w-10 text-white" />
              </div>
              <h4 className="mt-6 text-3xl font-semibold tracking-tight text-white">
                Start a quick conversation
              </h4>
              <p className="mt-3 text-sm leading-7 text-gray-400">
                Ask about live cameras, stored footage, or anything you need from the app.
              </p>
            </div>
          )}

          {messages.map((message) => renderMessage(message))}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.06] bg-gradient-to-t from-black/20 via-black/10 to-transparent px-5 pb-5 pt-4 md:px-6 md:pb-6">
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onCancel={cancelMessage}
            isRunning={isLoading}
            disabled={isCreatingSession}
            placeholder="Ask about your cameras..."
            variant="chat-page"
            uploadedImage={uploadedImage}
            onImageUpload={setUploadedImage}
            onImageRemove={() => setUploadedImage(null)}
            uploadedVideo={uploadedVideo}
            onVideoUpload={setUploadedVideo}
            onVideoRemove={() => setUploadedVideo(null)}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-gray-500">
            <span>{`${brand.quickChatName} can make mistakes. Verify important details when needed.`}</span>
            <button
              onClick={handleOpenFullChat}
              className="flex items-center gap-1 text-blue-300 transition-colors hover:text-blue-200 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Open full chat
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

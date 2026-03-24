import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import ChatInput from "@/react-app/components/ChatInput";
import AssistantMessage from "@/react-app/components/AssistantMessage";
import Toast from "@/react-app/components/Toast";
import ModelHostingBadge from "@/react-app/components/ModelHostingBadge";
import PendingAssistantMessage from "@/react-app/components/PendingAssistantMessage";
import CameraEventToast from "@/react-app/components/CameraEventToast";
import { usePerceptrumChatSession } from "@/react-app/hooks/usePerceptrumChatSession";
import { useCameraEvents } from "@/react-app/hooks/useCameraEvents";
import { ChatMessage, ChatSession } from "@/shared/types";
import { brand, getBrandStorageKey } from "@/shared/brand";
import { AlertCircle, Bot, User, Plus, Edit2, Check, X, Trash2, Video } from "lucide-react";
import {
  extractHitMediaFromMessage,
  extractChatProgressFromMessage,
  formatMessageContent,
} from "@/react-app/utils/chatUtils";
import {
  getCoreModelNoticeCopy,
  shouldShowCoreModelNotice,
} from "@/react-app/utils/coreModelNotice";

type ChatModelTier = "ultra" | "core";
type ChatRunningResolution = 640 | 1024;
type ChatHeaderDropdown = "fps" | "resolution" | "model" | null;
const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "ultra";
const DEFAULT_CHAT_CORE_RUNNING_RESOLUTION: ChatRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;

const MODEL_FPS_BY_TIER: Record<ChatModelTier, number> = {
  ultra: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  core: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
};

function normalizeChatModelTier(value: string | null | undefined): ChatModelTier {
  if (typeof value !== "string") return DEFAULT_CHAT_MODEL_TIER;
  const normalized = value.trim().toLowerCase();
  return normalized === "core" ? "core" : "ultra";
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

export default function Chat() {
  const { t, i18n } = useTranslation();
  const billingEnabled = brand.features.billingEnabled;
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [initialSessionId, setInitialSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedVideo, setUploadedVideo] = useState<{
    id: number;
    publicUrl: string;
    originalName: string;
    sizeBytes: number;
  } | null>(null);
  const [videoUploadsCache, setVideoUploadsCache] = useState<Map<number, {
    originalName: string;
    sizeBytes: number;
    publicUrl: string;
  }>>(new Map());
  const [modelTier, setModelTier] = useState<ChatModelTier>(DEFAULT_CHAT_MODEL_TIER);
  const [modelFps, setModelFps] = useState<number>(DEFAULT_ULTRA_VIDEO_MODEL_FPS);
  const [runningResolution, setRunningResolution] = useState<ChatRunningResolution>(
    DEFAULT_CHAT_CORE_RUNNING_RESOLUTION
  );
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning" | "info";
  } | null>(null);
  const [openHeaderDropdown, setOpenHeaderDropdown] = useState<ChatHeaderDropdown>(null);
  const [isHeaderGhostedWhileScrolling, setIsHeaderGhostedWhileScrolling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const headerGhostTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyCamerasRef = useRef<any[]>([]);
  const previousMessageCountRef = useRef(0);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const { toasts: cameraEventToasts, dismissToast: dismissCameraEventToast } = useCameraEvents(
    emptyCamerasRef.current,
  );

  const canChangeModelTier = true;

  useEffect(() => {
    const saved = localStorage.getItem(getBrandStorageKey("globalModelTier"));
    const normalizedTier = normalizeChatModelTier(saved);
    setModelTier(normalizedTier);
    localStorage.setItem(getBrandStorageKey("globalModelTier"), normalizedTier);
    const savedResolution = localStorage.getItem(getBrandStorageKey("globalRunningResolution"));
    const normalizedResolution = normalizeChatRunningResolution(savedResolution);
    setRunningResolution(normalizedResolution);
    localStorage.setItem(getBrandStorageKey("globalRunningResolution"), String(normalizedResolution));
    const savedModelFps = localStorage.getItem(getBrandStorageKey("globalUltraModelFps"));
    const normalizedModelFps = normalizeChatModelFps(savedModelFps);
    setModelFps(normalizedModelFps);
    localStorage.setItem(getBrandStorageKey("globalUltraModelFps"), String(normalizedModelFps));
  }, []);

  const { isLoading, error, warning, pendingExecutionState, sendMessage, cancelMessage } = usePerceptrumChatSession({
    sessionId: activeSessionId,
    onMessagesUpdate: (updatedMessages) => {
      setMessages(updatedMessages);
    },
  });

  const pendingExecutionNotice =
    pendingExecutionState.kind === "offline"
      ? "Desktop agent offline. Open the EXE on this machine to continue processing this request."
      : pendingExecutionState.kind === "stale"
        ? "Desktop agent connection looks stale. Make sure the EXE is open and still connected."
        : null;

  useEffect(() => {
    const initializeChat = async () => {
      const params = new URLSearchParams(window.location.search);
      const sessionParam = params.get("session");
      let parsedInitialSessionId: number | null = null;
      if (sessionParam) {
        const sessionId = parseInt(sessionParam, 10);
        if (!isNaN(sessionId)) {
          parsedInitialSessionId = sessionId;
          setInitialSessionId(sessionId);
        }
      }

      if (parsedInitialSessionId) {
        await fetchSessions(parsedInitialSessionId);
        return;
      }

      await createNewSession();
    };

    void initializeChat();
  }, []);

  useEffect(() => {
    return () => {
      if (headerGhostTimeoutRef.current) {
        clearTimeout(headerGhostTimeoutRef.current);
        headerGhostTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (activeSessionId) {
      previousMessageCountRef.current = 0;
      setShouldAutoScroll(true);
      fetchMessages(activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    const hasNewMessage = messages.length > previousMessageCountRef.current;
    previousMessageCountRef.current = messages.length;

    if (shouldAutoScroll && hasNewMessage && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages, shouldAutoScroll]);

  const fetchSessions = async (explicitInitialSessionId?: number | null) => {
    try {
      const response = await fetch("/api/chat/sessions");
      const data = await response.json();
      setSessions(data);

      const desiredInitialSessionId = explicitInitialSessionId ?? initialSessionId;
      if (
        desiredInitialSessionId &&
        data.some((s: ChatSession) => s.id === desiredInitialSessionId)
      ) {
        setActiveSessionId(desiredInitialSessionId);
        setInitialSessionId(null);
        return data as ChatSession[];
      }

      if (data.length > 0) {
        setActiveSessionId((currentActiveSessionId) => {
          if (
            currentActiveSessionId &&
            data.some((s: ChatSession) => s.id === currentActiveSessionId)
          ) {
            return currentActiveSessionId;
          }
          return data[0].id;
        });
        return data as ChatSession[];
      }

      setActiveSessionId(null);
      return data as ChatSession[];
    } catch (fetchError) {
      console.error("Failed to fetch sessions:", fetchError);
      return [];
    }
  };

  const fetchMessages = async (sessionId: number) => {
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/messages`);
      const data = await response.json();
      setMessages(data);
    } catch (fetchError) {
      console.error("Failed to fetch messages:", fetchError);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  };

  const markHeaderAsActivelyScrolling = () => {
    if (!isHeaderGhostedWhileScrolling) {
      setIsHeaderGhostedWhileScrolling(true);
    }

    if (headerGhostTimeoutRef.current) {
      clearTimeout(headerGhostTimeoutRef.current);
    }

    headerGhostTimeoutRef.current = setTimeout(() => {
      setIsHeaderGhostedWhileScrolling(false);
      headerGhostTimeoutRef.current = null;
    }, 160);
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    markHeaderAsActivelyScrolling();

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    setShouldAutoScroll(distanceFromBottom < 150);
  };

  const createNewSession = async (): Promise<number | null> => {
    try {
      setMessages([]);

      const response = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const newSession = await response.json();
      const refreshedSessions = await fetch("/api/chat/sessions");
      const refreshedData = await refreshedSessions.json();
      setSessions(refreshedData);
      setActiveSessionId(newSession.id);
      return newSession.id as number;
    } catch (createError) {
      console.error("Failed to create new chat:", createError);
      return null;
    }
  };

  const handleNewChat = async () => {
    await createNewSession();
  };

  const handleSelectSession = (sessionId: number) => {
    setMessages([]);
    setActiveSessionId(sessionId);
  };

  const handleStartEdit = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveEdit = async (sessionId: number) => {
    if (!editingTitle.trim()) {
      setEditingTitle("Untitled chat");
    }

    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editingTitle.trim() || "Untitled chat" }),
      });

      const updatedSession = await response.json();
      setSessions(sessions.map((session) => (session.id === sessionId ? updatedSession : session)));
      setEditingSessionId(null);
    } catch (saveError) {
      console.error("Failed to update session:", saveError);
    }
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setEditingTitle("");
  };

  const handleDeleteSession = async () => {
    if (!deletingSessionId) return;

    try {
      const sessionId = deletingSessionId;
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete session");
      }

      const newSessions = sessions.filter((session) => session.id !== sessionId);
      setSessions(newSessions);

      if (activeSessionId === sessionId) {
        setMessages([]);
        if (newSessions.length > 0) {
          setActiveSessionId(newSessions[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
    } catch (deleteError) {
      console.error("Failed to delete session:", deleteError);
      alert("Failed to delete chat. Please try again.");
    } finally {
      setDeletingSessionId(null);
    }
  };

  const handleSend = async () => {
    if ((!input.trim() && !uploadedImage && !uploadedVideo) || !activeSessionId) return;

    const userMessage = input;
    const imageBase64 = uploadedImage;
    const videoId = uploadedVideo?.id;

    if (uploadedVideo) {
      setVideoUploadsCache((prev) => {
        const newCache = new Map(prev);
        newCache.set(uploadedVideo.id, {
          originalName: uploadedVideo.originalName,
          sizeBytes: uploadedVideo.sizeBytes,
          publicUrl: uploadedVideo.publicUrl,
        });
        return newCache;
      });
    }

    setInput("");
    setUploadedImage(null);
    setUploadedVideo(null);
    setShouldAutoScroll(true);

    await sendMessage({
      content: userMessage,
      uploadedImageBase64: imageBase64,
      uploadedVideoId: videoId,
      modelTier,
      modelFps: modelTier === "ultra" ? modelFps : MODEL_FPS_BY_TIER[modelTier],
      runningResolution: modelTier === "core" ? runningResolution : null,
    });

    await fetchSessions();
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleModelSelect = (tier: ChatModelTier) => {
    const previousTier = modelTier;
    const normalizedTier = normalizeChatModelTier(tier);
    setModelTier(normalizedTier);
    localStorage.setItem(getBrandStorageKey("globalModelTier"), normalizedTier);
    setOpenHeaderDropdown(null);
    if (shouldShowCoreModelNotice(normalizedTier, previousTier)) {
      setToast({
        message: getCoreModelNoticeCopy(i18n.resolvedLanguage || i18n.language).message,
        type: "info",
      });
    }
  };

  const handleModelFpsChange = (value: string) => {
    const next = normalizeChatModelFps(value, modelFps);
    setModelFps(next);
    localStorage.setItem(getBrandStorageKey("globalUltraModelFps"), String(next));
    setOpenHeaderDropdown(null);
  };

  const handleRunningResolutionChange = (value: string | number) => {
    const next = normalizeChatRunningResolution(value, runningResolution);
    setRunningResolution(next);
    localStorage.setItem(getBrandStorageKey("globalRunningResolution"), String(next));
    setOpenHeaderDropdown(null);
  };

  const modelLabels: Record<ChatModelTier, string> = {
    ultra: t("jobs.inferenceModelOption.ultra"),
    core: t("jobs.inferenceModelOption.core"),
  };

  const starterPrompts = [
    "What's happening in the entrance camera?",
    "Is anyone wearing a mask in all cameras?",
    "Search for intruders in the parking lot",
  ];

  const renderMessage = (message: ChatMessage) => {
    const msg = message as any;
    const isPending = msg.is_pending === 1;

    if (isPending) {
      const progress = extractChatProgressFromMessage(message);
      return (
        <PendingAssistantMessage
          key={message.id}
          content={msg.content}
          progress={progress}
          notice={pendingExecutionNotice}
          variant="chat-page"
        />
      );
    }

    if (message.role === "user") {
      const userMsg = message as any;
      let videoMetadata: { uploaded_video_id?: number; uploaded_video_url?: string } | null = null;
      try {
        if (userMsg.camera_selection_json) {
          const parsed = JSON.parse(userMsg.camera_selection_json);
          if (parsed.uploaded_video_id || parsed.uploaded_video_url) {
            videoMetadata = parsed;
          }
        }
      } catch {
      }

      let videoFileName = "Video file";
      let videoFileSize: number | null = null;
      let videoUrl: string | null = null;

      if (videoMetadata) {
        videoUrl = videoMetadata.uploaded_video_url || null;

        if (videoMetadata.uploaded_video_id) {
          const cached = videoUploadsCache.get(videoMetadata.uploaded_video_id);
          if (cached) {
            videoFileName = cached.originalName;
            videoFileSize = cached.sizeBytes;
            videoUrl = cached.publicUrl;
          }
        }

        if (videoUrl && videoFileName === "Video file") {
          try {
            const urlPath = videoUrl.split("/").pop();
            if (urlPath) {
              const decodedPath = decodeURIComponent(urlPath);
              const match = decodedPath.match(/\.(mp4|webm|mov)$/i);
              if (match) {
                videoFileName = `Video${match[0]}`;
              }
            }
          } catch {
          }
        }
      }

      return (
        <div key={message.id} className="flex justify-end gap-4 animate-slide-up">
          <div className="w-full max-w-full min-w-0 overflow-hidden rounded-[26px] border border-blue-300/10 bg-gradient-to-br from-blue-500/90 via-blue-500/82 to-cyan-500/78 px-4 py-3 text-white shadow-[0_24px_60px_-30px_rgba(74,149,255,0.8)] md:max-w-[42rem] md:px-5">
            {userMsg.uploaded_image_base64 && (
              <img
                src={userMsg.uploaded_image_base64}
                alt="Uploaded"
                className="mb-3 max-h-40 rounded-2xl shadow-md"
              />
            )}
            {videoUrl && (
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 transition-colors hover:bg-white/20"
                onClick={(event) => event.stopPropagation()}
              >
                <Video className="h-5 w-5 flex-shrink-0" />
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium">{videoFileName}</p>
                  {videoFileSize && (
                    <p className="text-xs opacity-75">{formatFileSize(videoFileSize)}</p>
                  )}
                </div>
              </a>
            )}
            <p
              className="break-words whitespace-pre-wrap text-sm leading-relaxed"
              style={{ overflowWrap: "anywhere" }}
            >
              {formatMessageContent(message.content)}
            </p>
          </div>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
            <User className="h-4 w-4 text-white md:h-5 md:w-5" />
          </div>
        </div>
      );
    }

    const hitMedia = extractHitMediaFromMessage(message);
    const cameraLabel = message.camera_ids ? `Camera #${message.camera_ids}` : null;

    return (
      <AssistantMessage
        key={message.id}
        content={message.content}
        hitMedia={hitMedia}
        cameraLabel={cameraLabel}
        variant="chat-page"
      />
    );
  };

  return (
    <Layout>
      <div className="flex h-[calc(100vh-10rem)] gap-5 md:h-[calc(100vh-8rem)]">
        <div className="hidden md:flex w-[18.75rem] flex-col overflow-hidden rounded-[28px] border border-white/[0.06] bg-gradient-to-b from-[#171a22]/96 via-[#13161d]/98 to-[#101216] shadow-[0_30px_120px_-55px_rgba(0,0,0,0.96)] backdrop-blur-xl">
          <div className="border-b border-white/[0.06] p-4">
            <button
              onClick={handleNewChat}
              className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-left text-sm font-medium text-gray-100 transition-all hover:border-blue-400/30 hover:bg-white/[0.06] hover:text-white"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/[0.05] text-blue-300">
                  <Plus className="h-4 w-4" />
                </span>
                <span>New chat</span>
              </span>
            </button>
          </div>

          <div className="px-5 pb-2 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">
              History
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
            <div className="space-y-1.5">
              {sessions.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-sm text-gray-500">
                  No chats yet
                </div>
              )}

              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => !editingSessionId && handleSelectSession(session.id)}
                  className={`group relative cursor-pointer rounded-[20px] px-4 py-3 transition-all ${
                    activeSessionId === session.id
                      ? "border border-blue-400/20 bg-blue-500/12 shadow-[0_20px_50px_-35px_rgba(74,149,255,0.95)]"
                      : "border border-transparent hover:border-white/[0.06] hover:bg-white/[0.04]"
                  }`}
                >
                  {editingSessionId === session.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleSaveEdit(session.id);
                          } else if (e.key === "Escape") {
                            handleCancelEdit();
                          }
                        }}
                        className="flex-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSaveEdit(session.id);
                        }}
                        className="p-1 text-green-400 hover:text-green-300"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelEdit();
                        }}
                        className="p-1 text-red-400 hover:text-red-300"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <h3 className="flex-1 truncate text-sm font-medium text-gray-100">
                          {session.title}
                        </h3>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEdit(session);
                            }}
                            className="rounded-md p-1 text-gray-500 hover:bg-white/[0.05] hover:text-gray-200"
                          >
                            <Edit2 className="h-3 w-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingSessionId(session.id);
                            }}
                            className="rounded-md p-1 text-gray-500 hover:bg-white/[0.05] hover:text-red-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500">{formatTime(session.updated_at)}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="relative flex-1 min-w-0 overflow-hidden rounded-[30px] border border-white/[0.06] bg-[radial-gradient(circle_at_top,rgba(84,90,130,0.34),rgba(29,31,44,0.96)_42%,rgba(15,16,20,1)_100%)] shadow-[0_40px_140px_-60px_rgba(0,0,0,0.98)]">
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/[0.05] to-transparent transition-opacity duration-200 ${
              isHeaderGhostedWhileScrolling ? "opacity-[0.04]" : "opacity-100"
            }`}
          />
          <div className="relative flex h-full flex-col">
            <div
              className={`absolute inset-x-0 top-0 z-20 px-4 pb-4 pt-5 transition-[opacity,background-color,backdrop-filter] duration-200 md:px-8 md:pb-5 md:pt-6 ${
                isHeaderGhostedWhileScrolling
                  ? "bg-transparent opacity-[0.08] backdrop-blur-0"
                  : "bg-gradient-to-b from-[#171c2b]/92 via-[#171c2b]/70 to-transparent opacity-100 backdrop-blur-[2px]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[22px] bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_24px_50px_-24px_rgba(45,212,191,0.92)]">
                    <Bot className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-white md:text-[2rem]">
                      {t("chat.title")}
                    </h1>
                    <p className="mt-1 text-sm text-gray-400 md:text-base">
                      {t("chat.subtitle")}
                    </p>
                  </div>
                </div>

                <div className="relative flex flex-wrap items-center justify-end gap-2">
                  {openHeaderDropdown && (
                    <div className="fixed inset-0 z-40" onClick={() => setOpenHeaderDropdown(null)} />
                  )}
                  {modelTier === "ultra" && (
                    <div className="relative z-50">
                      <button
                        onClick={() =>
                          setOpenHeaderDropdown((current) => (current === "fps" ? null : "fps"))
                        }
                        className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-gray-100 transition-colors hover:bg-white/[0.08]"
                      >
                        <span className="hidden text-gray-400 sm:inline">Video FPS</span>
                        <span className="text-blue-300">{modelFps}</span>
                        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {openHeaderDropdown === "fps" && (
                        <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1f2230]/96 shadow-2xl backdrop-blur-xl">
                          {Array.from({ length: MAX_ULTRA_VIDEO_MODEL_FPS }, (_, index) => {
                            const fps = index + 1;
                            return (
                              <button
                                key={fps}
                                onClick={() => handleModelFpsChange(String(fps))}
                                className="w-full px-4 py-3 text-left text-sm text-gray-100 transition-colors hover:bg-white/[0.06]"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{`Video FPS: ${fps}`}</span>
                                  {modelFps === fps && <span className="text-blue-300">&#10003;</span>}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  {modelTier === "core" && (
                    <div className="relative z-50">
                      <button
                        onClick={() =>
                          setOpenHeaderDropdown((current) => (current === "resolution" ? null : "resolution"))
                        }
                        className="flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-gray-100 transition-colors hover:bg-white/[0.08]"
                      >
                        <span className="hidden text-gray-400 sm:inline">{t("jobs.runningResolution")}</span>
                        <span className="text-blue-300">
                          {runningResolution === 640
                            ? t("jobs.runningResolutionOption.640")
                            : t("jobs.runningResolutionOption.1024")}
                        </span>
                        <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {openHeaderDropdown === "resolution" && (
                        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1f2230]/96 shadow-2xl backdrop-blur-xl">
                          {[640, 1024].map((resolution) => (
                            <button
                              key={resolution}
                              onClick={() => handleRunningResolutionChange(resolution)}
                              className="w-full px-4 py-3 text-left text-sm text-gray-100 transition-colors hover:bg-white/[0.06]"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium">
                                  {resolution === 640
                                    ? t("jobs.runningResolutionOption.640")
                                    : t("jobs.runningResolutionOption.1024")}
                                </span>
                                {runningResolution === resolution && <span className="text-blue-300">&#10003;</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    onClick={() => {
                      if (!canChangeModelTier) return;
                      setOpenHeaderDropdown((current) => (current === "model" ? null : "model"));
                    }}
                    disabled={!canChangeModelTier}
                    className={`flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-gray-100 transition-colors ${
                      canChangeModelTier ? "hover:bg-white/[0.08]" : "cursor-not-allowed opacity-60"
                    }`}
                  >
                    <span className="hidden text-gray-400 sm:inline">Model</span>
                    <span className="text-blue-300">{modelLabels[modelTier]}</span>
                    <ModelHostingBadge modelTier={modelTier} compact />
                    <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {canChangeModelTier && openHeaderDropdown === "model" && (
                      <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#1f2230]/96 shadow-2xl backdrop-blur-xl">
                        <button
                          onClick={() => handleModelSelect("ultra")}
                          className="w-full px-4 py-3 text-left text-sm text-gray-100 transition-colors hover:bg-white/[0.06]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{t("jobs.inferenceModelOption.ultra")}</span>
                            <div className="flex items-center gap-2">
                              <ModelHostingBadge modelTier="ultra" compact />
                              {modelTier === "ultra" && <span className="text-blue-300">&#10003;</span>}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() => handleModelSelect("core")}
                          className="w-full px-4 py-3 text-left text-sm text-gray-100 transition-colors hover:bg-white/[0.06]"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-medium">{t("jobs.inferenceModelOption.core")}</span>
                            <div className="flex items-center gap-2">
                              <ModelHostingBadge modelTier="core" compact />
                              {modelTier === "core" && <span className="text-blue-300">&#10003;</span>}
                            </div>
                          </div>
                        </button>
                      </div>
                  )}
                </div>
              </div>
            </div>

            <div
              ref={messagesContainerRef}
              onScroll={handleScroll}
              onWheel={(e) => {
                markHeaderAsActivelyScrolling();
                if (e.deltaY < 0) {
                  setShouldAutoScroll(false);
                }
              }}
              onTouchMove={markHeaderAsActivelyScrolling}
              className="flex-1 overflow-y-auto px-4 pb-6 pt-[7.5rem] md:px-8 md:pb-8 md:pt-[8.5rem] scrollbar-thin touch-pan-y"
            >
              <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6">
                {!activeSessionId && (
                  <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-16 text-center md:py-24">
                    <div className="flex h-24 w-24 items-center justify-center rounded-[30px] bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_30px_80px_-34px_rgba(45,212,191,0.95)]">
                      <Bot className="h-11 w-11 text-white" />
                    </div>
                    <h3 className="mt-8 text-3xl font-semibold tracking-tight text-white md:text-5xl">
                      No chats yet
                    </h3>
                    <p className="mt-4 max-w-xl text-base leading-8 text-gray-400 md:text-lg">
                      {`Start a fresh conversation with ${brand.displayName} and explore your cameras in natural language.`}
                    </p>
                  </div>
                )}

                {activeSessionId && messages.length === 0 && (
                  <div className="mx-auto flex max-w-4xl flex-col items-center justify-center px-4 py-10 text-center md:py-16">
                    <div className="flex h-24 w-24 items-center justify-center rounded-[30px] bg-gradient-to-br from-emerald-400 to-teal-500 shadow-[0_32px_90px_-36px_rgba(45,212,191,0.95)]">
                      <Bot className="h-11 w-11 text-white" />
                    </div>
                    <h3 className="mt-8 text-3xl font-semibold tracking-tight text-white md:text-5xl">
                      How can I help you today?
                    </h3>
                    <p className="mt-4 max-w-2xl text-base leading-8 text-gray-400 md:text-lg">
                      Ask about live cameras, search through stored footage, or get help understanding how the app works.
                    </p>
                    <div className="mt-10 grid w-full max-w-4xl gap-4 md:grid-cols-3">
                      {starterPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => setInput(prompt)}
                          className="rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-5 text-left transition-all hover:-translate-y-0.5 hover:border-blue-300/25 hover:bg-white/[0.06]"
                        >
                          <p className="text-sm font-medium leading-7 text-gray-100">{prompt}</p>
                          <p className="mt-3 text-sm leading-6 text-gray-500">
                            Tap to start with this prompt.
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-[24px] border border-red-500/30 bg-red-500/10 p-4 backdrop-blur-sm">
                    <p className="text-sm text-red-300">{error}</p>
                    {billingEnabled ? (
                      <a href="/billing" className="mt-2 inline-block text-sm text-blue-300 hover:underline">
                        Go to Billing →
                      </a>
                    ) : null}
                  </div>
                )}

                {warning && (
                  <div className="rounded-[24px] border border-amber-500/25 bg-amber-500/10 p-4 backdrop-blur-sm">
                    <p className="text-sm text-amber-200">{warning}</p>
                  </div>
                )}

                {pendingExecutionNotice && (
                  <div className="rounded-[24px] border border-amber-400/25 bg-amber-400/10 p-4 backdrop-blur-sm">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                      <p className="text-sm leading-6 text-amber-100">{pendingExecutionNotice}</p>
                    </div>
                  </div>
                )}

                {messages.map((message) => renderMessage(message))}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-white/[0.06] bg-gradient-to-t from-black/25 via-black/10 to-transparent px-4 pb-4 pt-4 md:px-8 md:pb-6">
              <div className="mx-auto w-full max-w-[1080px]">
                <ChatInput
                  value={input}
                  onChange={setInput}
                  onSend={handleSend}
                  onCancel={cancelMessage}
                  isRunning={isLoading}
                  disabled={!activeSessionId}
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
                  <span>Drakon Chat can make mistakes. Consider verifying important details.</span>
                  {billingEnabled ? (
                    <span>
                      Token usage is tracked in{" "}
                      <a href="/billing" className="text-blue-300 hover:underline">
                        Billing
                      </a>
                      .
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {deletingSessionId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 p-6 shadow-2xl">
            <h3 className="mb-3 text-lg font-semibold text-gray-100">Delete Chat</h3>
            <p className="mb-6 text-sm text-gray-400">
              Are you sure you want to delete this chat? This action cannot be undone and all messages will be permanently removed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingSessionId(null)}
                className="flex-1 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSession}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Delete Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <CameraEventToast toasts={cameraEventToasts} onDismiss={dismissCameraEventToast} />
    </Layout>
  );
}

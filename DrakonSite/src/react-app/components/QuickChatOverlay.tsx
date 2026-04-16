import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useQuickChat } from "@/react-app/hooks/useQuickChat";
import { usePerceptrumChatSession } from "@/react-app/hooks/usePerceptrumChatSession";
import ChatInput from "@/react-app/components/ChatInput";
import AssistantMessage from "@/react-app/components/AssistantMessage";
import UploadedVideoAttachment from "@/react-app/components/UploadedVideoAttachment";
import ChatCameraRegistrationCard from "@/react-app/components/ChatCameraRegistrationCard";
import ChatCameraBatchRegistrationCard from "@/react-app/components/ChatCameraBatchRegistrationCard";
import ChatCameraBatchEditCard from "@/react-app/components/ChatCameraBatchEditCard";
import ChatCameraEditCard from "@/react-app/components/ChatCameraEditCard";
import ChatCameraAgentCard from "@/react-app/components/ChatCameraAgentCard";
import ChatCameraAgentCreatedCard from "@/react-app/components/ChatCameraAgentCreatedCard";
import ChatCameraAgentEditContextCard from "@/react-app/components/ChatCameraAgentEditContextCard";
import ChatCameraAgentUpdatedCard from "@/react-app/components/ChatCameraAgentUpdatedCard";
import ChatCameraDiscoveryCard from "@/react-app/components/ChatCameraDiscoveryCard";
import ChatJobCreatedCard from "@/react-app/components/ChatJobCreatedCard";
import ChatIdentityCardsPanel from "@/react-app/components/ChatIdentityCardsPanel";
import ChatPlexusBackground from "@/react-app/components/ChatPlexusBackground";
import CameraEditorModal, { type CameraEditorCamera } from "@/react-app/components/CameraEditorModal";
import CameraCustomAgentEditorModal, {
  type CameraAgentEditorTarget,
  type CameraCustomAgentRow,
  type ToastVariant,
} from "@/react-app/components/CameraCustomAgentEditorModal";
import MessageCopyButton from "@/react-app/components/MessageCopyButton";
import ModelHostingBadge from "@/react-app/components/ModelHostingBadge";
import PendingAssistantMessage from "@/react-app/components/PendingAssistantMessage";
import Toast from "@/react-app/components/Toast";
import { ChatMessage, ChatSession, type UploadedVideoAttachment as UploadedVideoAttachmentData } from "@/shared/types";
import { brand, getBrandStorageKey } from "@/shared/brand";
import {
  X,
  Bot,
  User,
  ExternalLink,
  Minus,
  AlertCircle,
  ChevronDown,
  Check,
  Clock3,
  Plus,
} from "lucide-react";
import {
  type CameraAgentFormRequestMessageMetadata,
  type CameraEditFormRequestMessageMetadata,
  extractChatProgressFromMessage,
  extractCameraAgentCreationResultFromMessage,
  extractCameraAgentEditContextFromMessage,
  extractCameraAgentFormRequestFromMessage,
  extractCameraAgentUpdateResultFromMessage,
  extractCameraEditFormRequestFromMessage,
  extractCameraNetworkScanFromMessage,
  extractCameraBatchEditDraftFromMessage,
  extractCameraBatchRegistrationDraftFromMessage,
  extractCameraRegistrationDraftFromMessage,
  extractJobCreationResultFromMessage,
  applyCameraEditDraftToCamera,
  buildCameraAgentDraftForEditor,
  extractIdentityCardsFromMessage,
  extractHitMediaFromMessage,
  extractUploadedVideoAttachmentFromMessage,
  formatMessageContent,
} from "@/react-app/utils/chatUtils";
import { CHAT_ASSISTANT_BADGE_CLASS } from "@/react-app/lib/chatAssistantStyles";

type ChatModelTier = "ultra" | "ultra_plus" | "light" | "core";
const DEFAULT_CHAT_MODEL_TIER: ChatModelTier = "ultra";
const DEFAULT_CHAT_CORE_RUNNING_RESOLUTION = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const QUICK_CHAT_PLEXUS_BACKGROUND_ENABLED = true;
const QUICK_CHAT_SESSION_BATCH_SIZE = 24;
const QUICK_CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 140;
const QUICK_CHAT_SESSION_MENU_LOAD_MORE_THRESHOLD_PX = 64;

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
  const {
    isOpen,
    sessionId,
    sessionTitle,
    closeQuickChat,
    minimizeQuickChat,
    openQuickChatSession,
    setSessionId,
    setSessionTitle,
  } = useQuickChat();
  const navigate = useNavigate();
  const billingEnabled = brand.features.billingEnabled;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [visibleSessionCount, setVisibleSessionCount] = useState(QUICK_CHAT_SESSION_BATCH_SIZE);
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [uploadedVideo, setUploadedVideo] = useState<UploadedVideoAttachmentData | null>(null);
  const [modelTier, setModelTier] = useState<ChatModelTier>(DEFAULT_CHAT_MODEL_TIER);
  const [chatEditModalCamera, setChatEditModalCamera] = useState<CameraEditorCamera | null>(null);
  const [isChatEditModalOpen, setIsChatEditModalOpen] = useState(false);
  const [chatAgentModalTarget, setChatAgentModalTarget] = useState<CameraAgentEditorTarget | null>(null);
  const [chatAgentModalInitialAgent, setChatAgentModalInitialAgent] = useState<CameraCustomAgentRow | null>(null);
  const [isChatAgentModalOpen, setIsChatAgentModalOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning" | "info";
  } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const sessionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const autoScrollFrameRef = useRef<number | null>(null);
  const modelLabels: Record<ChatModelTier, string> = {
    ultra_plus: "Ultra+",
    ultra: "Ultra",
    light: "Light",
    core: "Core",
  };

  const { isLoading, error, warning, pendingExecutionState, sendMessage, submitCameraRegistration, submitCameraBatchRegistration, submitCameraBatchEdit, cancelMessage, clearError, clearWarning } = usePerceptrumChatSession({
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

  const clearDraftVideo = async ({ preserveUpload = false }: { preserveUpload?: boolean } = {}) => {
    const currentVideo = uploadedVideo;
    setUploadedVideo(null);

    if (preserveUpload || !currentVideo?.id) {
      return;
    }

    try {
      const response = await fetch(`/api/video-uploads/${currentVideo.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok && response.status !== 404 && response.status !== 409) {
        console.warn("[QUICK CHAT] Failed to clean up draft video upload:", response.status);
      }
    } catch (error) {
      console.warn("[QUICK CHAT] Failed to clean up draft video upload:", error);
    }
  };

  const resetQuickChatDraft = ({ preserveVideoUpload = false }: { preserveVideoUpload?: boolean } = {}) => {
    setInput("");
    setUploadedImage(null);
    void clearDraftVideo({ preserveUpload: preserveVideoUpload });
    shouldAutoScrollRef.current = true;
    clearError();
    clearWarning();
  };

  const upsertSessionSummary = (session: ChatSession) => {
    setSessions((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((entry) => entry.id === session.id);
      if (existingIndex === -1) {
        next.unshift(session);
      } else {
        next[existingIndex] = session;
      }

      next.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
      return next;
    });
  };

  const fetchSessions = async (preferredSessionId?: number | null) => {
    setIsLoadingSessions(true);
    try {
      const response = await fetch("/api/chat/sessions");
      if (!response.ok) {
        throw new Error("Failed to fetch chat sessions");
      }

      const data = (await response.json()) as ChatSession[];
      const sortedSessions = [...data].sort(
        (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)
      );
      setSessions(sortedSessions);

      const targetSessionId = preferredSessionId ?? sessionId;
      if (targetSessionId) {
        const currentSession = sortedSessions.find((session) => session.id === targetSessionId) || null;
        if (currentSession) {
          setSessionTitle(currentSession.title);
        }
      }

      return sortedSessions;
    } catch (fetchError) {
      console.error("Failed to fetch quick chat sessions:", fetchError);
      return [];
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const formatSessionTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const currentSession =
    (sessionId ? sessions.find((entry) => entry.id === sessionId) : null) || null;
  const currentSessionLabel = currentSession?.title?.trim() || sessionTitle?.trim() || "New conversation";
  const visibleSessions = sessions.slice(0, visibleSessionCount);
  const hasMoreSessions = visibleSessionCount < sessions.length;

  const handleStartNewConversation = () => {
    resetQuickChatDraft();
    setSessionId(null);
    setSessionTitle(null);
    setMessages([]);
    setIsSessionMenuOpen(false);
  };

  const handleSelectExistingSession = (session: ChatSession) => {
    resetQuickChatDraft();
    openQuickChatSession(session.id, session.title);
    setMessages([]);
    setIsSessionMenuOpen(false);
  };

  const openChatEditForm = async (
    cameraId: number,
    cameraDraftMetadata: CameraEditFormRequestMessageMetadata
  ) => {
    const response = await fetch(`/api/cameras/${cameraId}`, {
      credentials: "include",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof (data as any)?.error === "string"
          ? (data as any).error
          : "Failed to load the camera for editing."
      );
    }

    const mergedCamera = applyCameraEditDraftToCamera(
      data as CameraEditorCamera,
      cameraDraftMetadata
    );
    setChatEditModalCamera(mergedCamera);
    setIsChatEditModalOpen(true);
  };

  const openChatAgentForm = async (
    metadata: CameraAgentFormRequestMessageMetadata
  ) => {
    const target = metadata.editor_target ?? null;
    const hasValidTarget =
      !!target &&
      (
        (target.type === "camera" && Number.isInteger(target.camera_id) && Number(target.camera_id) > 0) ||
        (target.type === "step_default" && Number.isInteger(target.step_id) && Number(target.step_id) > 0) ||
        (target.type === "step_camera" &&
          Number.isInteger(target.step_id) &&
          Number(target.step_id) > 0 &&
          Number.isInteger(target.camera_id) &&
          Number(target.camera_id) > 0)
      );

    if (!hasValidTarget) {
      throw new Error("Invalid agent target selected for the form.");
    }

    setChatAgentModalTarget(target);
    setChatAgentModalInitialAgent(
      buildCameraAgentDraftForEditor(metadata) as unknown as CameraCustomAgentRow
    );
    setIsChatAgentModalOpen(true);
  };

  useEffect(() => {
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }

    shouldAutoScrollRef.current = true;
    lastScrollTopRef.current = 0;

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
    if (!isOpen) {
      setIsSessionMenuOpen(false);
      return;
    }
    const savedTier = localStorage.getItem(getBrandStorageKey("globalModelTier"));
    const normalizedTier = normalizeChatModelTier(savedTier);
    setModelTier(normalizedTier);
    void fetchSessions(sessionId);
  }, [isOpen, sessionId]);

  useEffect(() => {
    if (!isOpen || sessionId) return;

    setMessages([]);
    resetQuickChatDraft();
  }, [clearError, clearWarning, isOpen, sessionId]);

  useEffect(() => {
    if (!isSessionMenuOpen) return;

    const currentSessionIndex = sessionId
      ? sessions.findIndex((session) => session.id === sessionId)
      : -1;
    const minimumVisibleSessions =
      currentSessionIndex >= 0
        ? Math.max(QUICK_CHAT_SESSION_BATCH_SIZE, currentSessionIndex + 1)
        : QUICK_CHAT_SESSION_BATCH_SIZE;
    setVisibleSessionCount((currentCount) =>
      Math.min(sessions.length, Math.max(currentCount, minimumVisibleSessions))
    );

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        (sessionMenuRef.current && target && sessionMenuRef.current.contains(target)) ||
        (sessionMenuButtonRef.current && target && sessionMenuButtonRef.current.contains(target))
      ) {
        return;
      }

      setIsSessionMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isSessionMenuOpen, sessionId, sessions]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    scheduleAutoScroll();
  }, [messages]);

  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, []);

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

      const newSession = await response.json() as ChatSession;
      setMessages([]);
      setSessionId(newSession.id);
      setSessionTitle(newSession.title);
      upsertSessionSummary(newSession);
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
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTop = container.scrollHeight;
    lastScrollTopRef.current = container.scrollTop;
  };

  const scheduleAutoScroll = () => {
    if (!shouldAutoScrollRef.current) return;
    if (autoScrollFrameRef.current !== null) return;

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      scrollToBottom();
    });
  };

  const loadMoreSessions = () => {
    setVisibleSessionCount((currentCount) =>
      Math.min(sessions.length, currentCount + QUICK_CHAT_SESSION_BATCH_SIZE)
    );
  };

  const handleSessionMenuScroll = () => {
    const container = sessionListRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distanceFromBottom > QUICK_CHAT_SESSION_MENU_LOAD_MORE_THRESHOLD_PX) {
      return;
    }

    loadMoreSessions();
  };

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isScrollingUp = scrollTop < lastScrollTopRef.current;
    lastScrollTopRef.current = scrollTop;

    if (isScrollingUp) {
      shouldAutoScrollRef.current = false;
      return;
    }

    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < QUICK_CHAT_SCROLL_BOTTOM_THRESHOLD_PX;
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
    const draftVideo = uploadedVideo;
    const videoId = uploadedVideo?.id ?? null;
    resetQuickChatDraft({ preserveVideoUpload: true });

    // Enable auto-scroll when user sends a message
    shouldAutoScrollRef.current = true;

    const sendSucceeded = await sendMessage({
      sessionIdOverride: targetSessionId,
      content: userMessage,
      uploadedImageBase64: imageBase64,
      uploadedVideoId: videoId,
      modelTier: modelTier,
      modelFps: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
      runningResolution: modelTier === "core" ? DEFAULT_CHAT_CORE_RUNNING_RESOLUTION : null,
    });

    if (!sendSucceeded) {
      setInput(userMessage);
      setUploadedImage(imageBase64);
      if (draftVideo) {
        setUploadedVideo(draftVideo);
      }
      return;
    }
    void fetchSessions(targetSessionId);
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
      const formattedUserContent = formatMessageContent(message.content);
      const uploadedVideoAttachment = extractUploadedVideoAttachmentFromMessage(message);
      const hasUserText = formattedUserContent.trim().length > 0;
      return (
        <div key={message.id} className="flex justify-end gap-4 animate-slide-up">
          <div className="flex min-w-0 flex-1 justify-end">
            <div className="group relative max-w-[85%] min-w-0">
              <div className="min-w-0 overflow-hidden rounded-[26px] border border-blue-300/10 bg-gradient-to-br from-blue-500/90 via-blue-500/82 to-cyan-500/78 px-4 py-3 text-white shadow-[0_24px_60px_-30px_rgba(74,149,255,0.8)]">
                {userMsg.uploaded_image_base64 && (
                  <img
                    src={userMsg.uploaded_image_base64}
                    alt="Uploaded"
                    className="mb-3 max-h-32 rounded-2xl shadow-md"
                  />
                )}
                {uploadedVideoAttachment ? (
                  <UploadedVideoAttachment attachment={uploadedVideoAttachment} mode="message" />
                ) : null}
                {hasUserText ? (
                  <p
                    className="text-sm leading-relaxed whitespace-pre-wrap break-words"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    {formattedUserContent}
                  </p>
                ) : null}
              </div>
              {hasUserText ? (
                <MessageCopyButton
                  text={formattedUserContent}
                  className="absolute right-2 top-[calc(100%+0.375rem)] z-20 border-white/10 bg-white/[0.08] text-white/80 hover:bg-white/[0.14]"
                />
              ) : null}
            </div>
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
    const cameraRegistrationDraft = extractCameraRegistrationDraftFromMessage(message);
    const cameraBatchRegistrationDraft = extractCameraBatchRegistrationDraftFromMessage(message);
    const cameraBatchEditDraft = extractCameraBatchEditDraftFromMessage(message);
    const cameraAgentFormRequest = extractCameraAgentFormRequestFromMessage(message);
    const cameraAgentCreationResult = extractCameraAgentCreationResultFromMessage(message);
    const jobCreationResult = extractJobCreationResultFromMessage(message);
    const cameraAgentEditContext = extractCameraAgentEditContextFromMessage(message);
    const cameraAgentUpdateResult = extractCameraAgentUpdateResultFromMessage(message);
    const cameraEditFormRequest = extractCameraEditFormRequestFromMessage(message);
    const cameraNetworkScan = extractCameraNetworkScanFromMessage(message);
    const identityCards = extractIdentityCardsFromMessage(message);
    const workflowSupplementalContent =
      cameraRegistrationDraft ? (
        <ChatCameraRegistrationCard
          messageId={message.id}
          metadata={cameraRegistrationDraft}
          onSubmit={(sourceMessageId, draft) =>
            submitCameraRegistration({
              sessionIdOverride: sessionId,
              sourceMessageId,
              draft,
            })
          }
        />
      ) : cameraBatchRegistrationDraft ? (
        <ChatCameraBatchRegistrationCard
          messageId={message.id}
          metadata={cameraBatchRegistrationDraft}
          onSubmit={(sourceMessageId) =>
            submitCameraBatchRegistration({
              sessionIdOverride: sessionId,
              sourceMessageId,
            })
          }
        />
      ) : cameraBatchEditDraft ? (
        <ChatCameraBatchEditCard
          messageId={message.id}
          metadata={cameraBatchEditDraft}
          onSubmit={(sourceMessageId) =>
            submitCameraBatchEdit({
              sessionIdOverride: sessionId,
              sourceMessageId,
            })
          }
        />
      ) : cameraAgentFormRequest ? (
        <ChatCameraAgentCard
          metadata={cameraAgentFormRequest}
          onOpen={() => openChatAgentForm(cameraAgentFormRequest)}
        />
      ) : cameraAgentEditContext ? (
        <ChatCameraAgentEditContextCard metadata={cameraAgentEditContext} />
      ) : cameraAgentUpdateResult ? (
        <ChatCameraAgentUpdatedCard metadata={cameraAgentUpdateResult} />
      ) : jobCreationResult ? (
        <ChatJobCreatedCard metadata={jobCreationResult} />
      ) : cameraAgentCreationResult ? (
        <ChatCameraAgentCreatedCard metadata={cameraAgentCreationResult} />
      ) : cameraEditFormRequest ? (
        <ChatCameraEditCard
          metadata={cameraEditFormRequest}
          onOpen={() =>
            openChatEditForm(cameraEditFormRequest.camera_id, cameraEditFormRequest)
          }
        />
      ) : cameraNetworkScan ? (
        <ChatCameraDiscoveryCard metadata={cameraNetworkScan} />
      ) : null;

    const supplementalContent = (
      <>
        {workflowSupplementalContent}
        {identityCards.length > 0 ? <ChatIdentityCardsPanel cards={identityCards} /> : null}
      </>
    );

    return (
      <AssistantMessage
        key={message.id}
        content={message.content}
        hitMedia={hitMedia}
        cameraLabel={message.camera_ids ? `Camera #${message.camera_ids}` : null}
        variant="chat-page"
        supplementalContent={supplementalContent}
      />
    );
  };

  if (!isOpen) return null;

  return (
    <>
      <CameraEditorModal
        isOpen={isChatEditModalOpen}
        camera={chatEditModalCamera}
        onClose={() => {
          setIsChatEditModalOpen(false);
          setChatEditModalCamera(null);
        }}
      />

      <CameraCustomAgentEditorModal
        open={isChatAgentModalOpen && chatAgentModalTarget !== null}
        editorTarget={chatAgentModalTarget}
        initialAgent={chatAgentModalInitialAgent}
        onClose={() => {
          setIsChatAgentModalOpen(false);
          setChatAgentModalTarget(null);
          setChatAgentModalInitialAgent(null);
        }}
        onSaved={() => {
          const fallbackName =
            chatAgentModalInitialAgent?.config_json &&
            typeof chatAgentModalInitialAgent.config_json === "object" &&
            !Array.isArray(chatAgentModalInitialAgent.config_json) &&
            typeof (chatAgentModalInitialAgent.config_json as Record<string, unknown>).display_name === "string"
              ? String((chatAgentModalInitialAgent.config_json as Record<string, unknown>).display_name)
              : "agent";
          setToast({
            message: `Agent ${fallbackName || "agent"} saved.`,
            type: "success",
          });
        }}
        showToast={(title: string, description: string, variant?: ToastVariant) => {
          setToast({
            message: title ? `${title}: ${description}` : description,
            type:
              variant === "destructive"
                ? "error"
                : variant === "default"
                  ? "success"
                  : "info",
          });
        }}
      />

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
              <div className="relative mt-3">
                <button
                  ref={sessionMenuButtonRef}
                  type="button"
                  onClick={() => setIsSessionMenuOpen((current) => !current)}
                  aria-expanded={isSessionMenuOpen}
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <Clock3 className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                  <span className="truncate font-medium text-gray-200">{currentSessionLabel}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform ${
                      isSessionMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isSessionMenuOpen ? (
                  <div
                    ref={sessionMenuRef}
                    className="absolute left-0 top-full z-40 mt-3 w-[320px] max-w-[min(84vw,320px)] overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#171c2b]/96 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.95)] backdrop-blur-xl"
                  >
                    <div className="border-b border-white/[0.06] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                      Conversations
                    </div>
                    <div
                      ref={sessionListRef}
                      onScroll={handleSessionMenuScroll}
                      className="max-h-[320px] overflow-y-auto p-2 scrollbar-thin"
                    >
                      <button
                        type="button"
                        onClick={handleStartNewConversation}
                        className={`flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left transition-colors ${
                          sessionId === null
                            ? "bg-blue-500/12 text-white"
                            : "text-gray-200 hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                          <Plus className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">New conversation</p>
                          <p className="mt-0.5 text-xs text-gray-500">Start fresh in quick chat</p>
                        </div>
                        {sessionId === null ? <Check className="h-4 w-4 flex-shrink-0 text-blue-300" /> : null}
                      </button>

                      {isLoadingSessions ? (
                        <div className="px-3 py-4 text-sm text-gray-500">Loading conversations...</div>
                      ) : sessions.length === 0 ? (
                        <div className="px-3 py-4 text-sm text-gray-500">No saved chats yet.</div>
                      ) : (
                        visibleSessions.map((session) => {
                          const isCurrent = session.id === sessionId;
                          return (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => handleSelectExistingSession(session)}
                              className={`mt-1 flex w-full items-center gap-3 rounded-[18px] px-3 py-3 text-left transition-colors ${
                                isCurrent
                                  ? "bg-blue-500/12 text-white"
                                  : "text-gray-200 hover:bg-white/[0.05]"
                              }`}
                            >
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                                <Bot className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-inherit">
                                  {session.title || "Untitled chat"}
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  {formatSessionTime(session.updated_at)}
                                </p>
                              </div>
                              {isCurrent ? (
                                <Check className="h-4 w-4 flex-shrink-0 text-blue-300" />
                              ) : null}
                            </button>
                          );
                        })
                      )}

                      {!isLoadingSessions && hasMoreSessions ? (
                        <div className="px-2 pb-2 pt-3">
                          <button
                            type="button"
                            onClick={loadMoreSessions}
                            className="w-full rounded-[16px] border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                          >
                            Load older conversations
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
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
                onClick={() => minimizeQuickChat(currentSessionLabel)}
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
            onVideoRemove={() => void clearDraftVideo()}
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

      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </>
  );
}

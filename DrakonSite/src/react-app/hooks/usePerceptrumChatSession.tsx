import { useState, useEffect, useRef, useCallback } from "react";
import { ChatMessage } from "@/shared/types";
import { sanitizeAiApiErrorText } from "@/shared/aiApiErrorDisplay";
import {
  emitOpenAiKeyRequiredPrompt,
  emitZAiKeyRequiredPrompt,
  isOpenAiKeyRequiredError,
  isZAiKeyRequiredError,
} from "@/react-app/utils/openAiKeyGuard";

interface ChatSessionConfig {
  sessionId: number | null;
  onMessagesUpdate: (messages: ChatMessage[]) => void;
}

interface PairingHeartbeatStatus {
  status: "not_connected" | "connected";
  effective_status?: "not_connected" | "connected" | "stale";
  chat_effective_status?: "not_connected" | "connected" | "stale";
  is_available_for_chat?: boolean;
  is_heartbeat_fresh?: boolean;
  last_seen_at?: string | null;
  last_seen_age_seconds?: number | null;
}

export type PendingExecutionState =
  | { kind: "none" }
  | {
      kind: "offline" | "stale";
      lastSeenAt?: string | null;
      ageSeconds?: number | null;
    };

type ChatModelTier = "legacy" | "pro" | "ultra" | "ultra_plus" | "light" | "core";
export const PERCEPTRUM_CHAT_TRIAL_EXPIRED_ERROR = "PERCEPTRUM_CHAT_TRIAL_EXPIRED";
const FIXED_CHAT_MODEL_TIER: ChatModelTier = "ultra";
const CHAT_MODE = "v2";
type ChatRunningResolution = 640 | 1024;
const DEFAULT_CORE_RUNNING_RESOLUTION: ChatRunningResolution = 640;
const DEFAULT_ULTRA_VIDEO_MODEL_FPS = 1;
const MAX_ULTRA_VIDEO_MODEL_FPS = 10;
const CHAT_DESKTOP_AGENT_CHECK_AFTER_MS = 3500;
// The EXE heartbeat is driven by the command poll loop, which runs every 1s.
// Keep this aligned with the backend's chat freshness window to avoid false
// stale/offline states in production.
const CHAT_DESKTOP_AGENT_MAX_AGE_SECONDS = 25;

const MODEL_FPS_BY_TIER: Record<ChatModelTier, number> = {
  legacy: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  pro: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  ultra: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  ultra_plus: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  light: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
  core: DEFAULT_ULTRA_VIDEO_MODEL_FPS,
};

function inferUiLanguage(): string {
  if (typeof document !== "undefined" && typeof document.documentElement?.lang === "string") {
    const lang = document.documentElement.lang.trim().toLowerCase();
    if (lang) return lang;
  }

  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    const lang = navigator.language.trim().toLowerCase();
    if (lang) return lang;
  }

  return "en";
}

function getCancelledAssistantMessage(reason: NonNullable<CancelMessageOptions["reason"]>): string {
  const language = inferUiLanguage();

  if (reason === "offline") {
    if (language.startsWith("pt")) {
      return "Nao consegui me comunicar com o aplicativo desktop nesta maquina. Abra o EXE e tente novamente.";
    }
    if (language.startsWith("es")) {
      return "No pude comunicarme con la app de escritorio en esta maquina. Abre el EXE e intentalo de nuevo.";
    }
    if (language.startsWith("fr")) {
      return "Impossible de communiquer avec l'application desktop sur cette machine. Ouvrez l'EXE et reessayez.";
    }
    return "I couldn't communicate with the desktop app on this machine. Open the EXE and try again.";
  }

  if (reason === "stale") {
    if (language.startsWith("pt")) {
      return "A conexao com o aplicativo desktop parece desatualizada. Verifique se o EXE esta aberto e conectado e tente novamente.";
    }
    if (language.startsWith("es")) {
      return "La conexion con la app de escritorio parece desactualizada. Verifica que el EXE siga abierto y conectado, y vuelve a intentarlo.";
    }
    if (language.startsWith("fr")) {
      return "La connexion avec l'application desktop semble expiree. Verifiez que l'EXE est ouvert et connecte, puis reessayez.";
    }
    return "The desktop app connection looks stale. Make sure the EXE is open and connected, then try again.";
  }

  if (language.startsWith("pt")) {
    return "Resposta interrompida.";
  }
  if (language.startsWith("es")) {
    return "Respuesta detenida.";
  }
  if (language.startsWith("fr")) {
    return "Reponse interrompue.";
  }
  return "Response stopped.";
}

function normalizeChatModelTier(value: string | null | undefined): ChatModelTier {
  if (typeof value !== "string") return FIXED_CHAT_MODEL_TIER;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ultra+" || normalized === "ultra-plus" || normalized === "ultra_plus") return "ultra_plus";
  if (normalized === "core") return "core";
  if (normalized === "ultra") return "ultra";
  if (normalized === "light") return "light";
  if (normalized === "pro") return "pro";
  if (normalized === "legacy") return "legacy";
  return FIXED_CHAT_MODEL_TIER;
}

function normalizeModelFps(value: unknown, modelTier: ChatModelTier): number {
  const fallback = MODEL_FPS_BY_TIER[modelTier] ?? DEFAULT_ULTRA_VIDEO_MODEL_FPS;
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
  return Math.min(MAX_ULTRA_VIDEO_MODEL_FPS, Math.max(DEFAULT_ULTRA_VIDEO_MODEL_FPS, fallback));
}

function normalizeRunningResolution(
  value: unknown,
  fallback: ChatRunningResolution = DEFAULT_CORE_RUNNING_RESOLUTION
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

interface SendMessageOptions {
  sessionIdOverride?: number | null;
  content: string;
  camera_id?: number;
  uploadedImageBase64?: string | null;
  uploadedVideoId?: number | null;
  modelTier?: ChatModelTier;
  modelFps?: number;
  runningResolution?: ChatRunningResolution | null;
}

interface CancelMessageOptions {
  reason?: "manual" | "offline" | "stale";
}

interface SubmitCameraRegistrationOptions {
  sessionIdOverride?: number | null;
  sourceMessageId: number;
  draft: Record<string, unknown>;
}

interface SubmitCameraBatchRegistrationOptions {
  sessionIdOverride?: number | null;
  sourceMessageId: number;
}

interface SubmitCameraBatchEditOptions {
  sessionIdOverride?: number | null;
  sourceMessageId: number;
}

export interface UpdateIdentityCardOptions {
  entity_id: string;
  entity_type?: string;
  target_name?: string;
  physical_traits?: string[];
  save_as_face_target?: boolean;
  portrait_data_url?: string | null;
  card_snapshot?: Record<string, unknown> | null;
}

export function usePerceptrumChatSession({ sessionId, onMessagesUpdate }: ChatSessionConfig) {
  const disableWebSocket = import.meta.env.VITE_DISABLE_WS === "true";
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pendingExecutionState, setPendingExecutionState] = useState<PendingExecutionState>({
    kind: "none",
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pairingCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const autoCancelKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setWarning(null);
    setPendingExecutionState({ kind: "none" });
    autoCancelKeyRef.current = null;
    setErrorCode(null);
  }, [sessionId]);

  // Helper function to upsert messages by ID
  const upsertMessages = useCallback((incomingMessages: ChatMessage[]) => {
    const newMessages = [...messagesRef.current];
    
    incomingMessages.forEach(incomingMsg => {
      const idx = newMessages.findIndex(m => m.id === incomingMsg.id);
      
      if (idx === -1) {
        // New message - add it
        newMessages.push(incomingMsg);
      } else {
        // Existing message - update it (server is source of truth)
        newMessages[idx] = { ...newMessages[idx], ...incomingMsg };
      }
    });
    
    // Keep strict DB insertion order to avoid timestamp-format ordering glitches.
    newMessages.sort((a, b) => {
      const idA = Number((a as any).id) || 0;
      const idB = Number((b as any).id) || 0;
      return idA - idB;
    });
    
    messagesRef.current = newMessages;
    setIsLoading(newMessages.some((msg: any) => msg?.is_pending === 1));
    if (!newMessages.some((msg: any) => msg?.is_pending === 1)) {
      autoCancelKeyRef.current = null;
    }
    onMessagesUpdate(newMessages);
  }, [onMessagesUpdate]);

  const applyLocalCancellation = useCallback(
    (reason: NonNullable<CancelMessageOptions["reason"]>) => {
      const cancelledMessage = getCancelledAssistantMessage(reason);
      const nowIso = new Date().toISOString();
      const nextMessages = messagesRef.current.map((message) => {
        const isPendingAssistant =
          String((message as any)?.role || "") === "assistant" && Number((message as any)?.is_pending || 0) === 1;
        if (!isPendingAssistant) {
          return message;
        }

        return {
          ...message,
          content: cancelledMessage,
          is_pending: 0,
          message_type: "final",
          progress_json: null,
          updated_at: nowIso,
        } as ChatMessage;
      });

      messagesRef.current = nextMessages;
      onMessagesUpdate(nextMessages);
      setIsLoading(false);
      setPendingExecutionState({ kind: "none" });
      setError(null);
      setErrorCode(null);
      setWarning(null);
      autoCancelKeyRef.current = null;
    },
    [onMessagesUpdate]
  );

  useEffect(() => {
    if (!sessionId) {
      if (pairingCheckIntervalRef.current) {
        clearInterval(pairingCheckIntervalRef.current);
        pairingCheckIntervalRef.current = null;
      }
      setPendingExecutionState({ kind: "none" });
      return;
    }

    let isMounted = true;

    const checkPendingExecutionState = async () => {
      const pendingMessages = messagesRef.current.filter((msg: any) => msg?.is_pending === 1);
      if (pendingMessages.length === 0) {
        if (isMounted) {
          setPendingExecutionState({ kind: "none" });
        }
        return;
      }

      const latestPendingMessage = pendingMessages[pendingMessages.length - 1] as any;
      const latestPendingAtRaw =
        typeof latestPendingMessage?.updated_at === "string" && latestPendingMessage.updated_at.trim()
          ? latestPendingMessage.updated_at
          : latestPendingMessage?.created_at;
      const latestPendingAtMs = latestPendingAtRaw ? Date.parse(latestPendingAtRaw) : Number.NaN;
      const pendingAgeMs = Number.isFinite(latestPendingAtMs) ? Date.now() - latestPendingAtMs : 0;

      // Give normal routing/model latency a short head start before checking EXE health.
      if (pendingAgeMs < CHAT_DESKTOP_AGENT_CHECK_AFTER_MS) {
        if (isMounted) {
          setPendingExecutionState({ kind: "none" });
        }
        return;
      }

      try {
        const response = await fetch("/api/pairing/status");
        if (!response.ok) return;

        const data = (await response.json()) as PairingHeartbeatStatus;
        if (!isMounted) return;

        const chatEffectiveStatus =
          data.chat_effective_status ||
          (typeof data.last_seen_age_seconds === "number" &&
          data.last_seen_age_seconds > CHAT_DESKTOP_AGENT_MAX_AGE_SECONDS
            ? "stale"
            : data.effective_status) ||
          data.status ||
          "not_connected";
        if (chatEffectiveStatus === "not_connected") {
          setPendingExecutionState({
            kind: "offline",
            lastSeenAt: data.last_seen_at ?? null,
            ageSeconds: data.last_seen_age_seconds ?? null,
          });
          return;
        }

        if (
          chatEffectiveStatus === "stale" ||
          data.is_available_for_chat === false ||
          data.is_heartbeat_fresh === false
        ) {
          setPendingExecutionState({
            kind: "stale",
            lastSeenAt: data.last_seen_at ?? null,
            ageSeconds: data.last_seen_age_seconds ?? null,
          });
          return;
        }

        setPendingExecutionState({ kind: "none" });
      } catch (err) {
        console.error("[PAIRING STATUS] Failed to check desktop agent state:", err);
      }
    };

    void checkPendingExecutionState();
    pairingCheckIntervalRef.current = setInterval(checkPendingExecutionState, 3000);

    return () => {
      isMounted = false;
      if (pairingCheckIntervalRef.current) {
        clearInterval(pairingCheckIntervalRef.current);
        pairingCheckIntervalRef.current = null;
      }
    };
  }, [sessionId]);

  // Connect to WebSocket when sessionId is available
  useEffect(() => {
    if (!sessionId || disableWebSocket) {
      // Clean up any existing WebSocket connection
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      messagesRef.current = [];
      return;
    }

    // Capture the current sessionId to prevent race conditions
    const currentSessionId = sessionId;
    let isMounted = true;

    const connectWebSocket = () => {
      // Only connect if still mounted and on the same session
      if (!isMounted || currentSessionId !== sessionId) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws/chat/${currentSessionId}`;

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[WS] Connected to chat session:", currentSessionId);
      };

      ws.onmessage = (event) => {
        // Only process messages if we're still on the same session
        if (!isMounted || currentSessionId !== sessionId) {
          return;
        }

        try {
          const data = JSON.parse(event.data);
          console.log("[WS] Received message:", data);

          if (data.type === "message_update" && Array.isArray(data.messages)) {
            // Server sent updated messages array - upsert them
            upsertMessages(data.messages);
          }
        } catch (err) {
          console.error("[WS] Failed to parse message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("[WS] Error:", error);
      };

      ws.onclose = () => {
        console.log("[WS] Connection closed");
        wsRef.current = null;

        // Only attempt to reconnect if still mounted and on the same session
        if (isMounted && currentSessionId === sessionId) {
          console.log("[WS] Reconnecting in 5s...");
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 5000);
        }
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId, upsertMessages, disableWebSocket]);

  // Polling fallback for when WebSocket updates might be missed
  useEffect(() => {
    if (!sessionId) {
      // Clear any existing polling when sessionId is null
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    // Capture the current sessionId to prevent race conditions
    const currentSessionId = sessionId;
    let isMounted = true;
    let currentInterval = 1000; // Start with fast polling while the first pending state settles

    const fetchMessages = async () => {
      // Only fetch if we're still on the same session
      if (!isMounted || currentSessionId !== sessionId) {
        return;
      }

      try {
        const response = await fetch(`/api/chat/sessions/${currentSessionId}/messages`);
        if (response.ok) {
          const data = await response.json();
          
          // Only update if we're still on the same session
          if (isMounted && currentSessionId === sessionId) {
            upsertMessages(data);
            
            // Check if there are any pending messages
            const hasPending = data.some((msg: any) => msg.is_pending === 1);
            const hasProgress = data.some(
              (msg: any) => msg.is_pending === 1 && !!msg.progress_json
            );
            
            // Adjust polling interval based on pending state
            const newInterval = hasPending ? (hasProgress ? 400 : 1000) : 5000;
            
            if (newInterval !== currentInterval && pollIntervalRef.current) {
              // Restart polling with new interval
              currentInterval = newInterval;
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = setInterval(fetchMessages, newInterval);
            }
          }
        }
      } catch (err) {
        console.error("[POLL] Failed to fetch messages:", err);
      }
    };

    // Initial fetch
    fetchMessages();

    // Start polling quickly while the session is active so progress changes are visible.
    pollIntervalRef.current = setInterval(fetchMessages, currentInterval);

    return () => {
      isMounted = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [sessionId, upsertMessages]);

  const sendMessage = useCallback(
    async ({
      sessionIdOverride,
      content,
      camera_id,
      uploadedImageBase64,
      uploadedVideoId,
      modelTier,
      modelFps,
      runningResolution,
    }: SendMessageOptions) => {
      const targetSessionId = sessionIdOverride ?? sessionId;
      if (!targetSessionId || (!content.trim() && !uploadedImageBase64 && !uploadedVideoId)) return;

      setIsLoading(true);
      setError(null);
      setErrorCode(null);
      setWarning(null);

      try {
        const normalizedModelTier = normalizeChatModelTier(modelTier);
        const normalizedModelFps = normalizeModelFps(
          modelFps ?? MODEL_FPS_BY_TIER[normalizedModelTier],
          normalizedModelTier
        );
        const normalizedRunningResolution =
          normalizedModelTier === "core"
            ? normalizeRunningResolution(runningResolution)
            : null;

        const response = await fetch(`/api/chat/sessions/${targetSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            content, 
            camera_id,
            uploaded_image_base64: uploadedImageBase64 || null,
            uploaded_video_id: uploadedVideoId || null,
            chat_mode: CHAT_MODE,
            model_tier: normalizedModelTier,
            model_fps: normalizedModelFps,
            running_resolution: normalizedRunningResolution,
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (isOpenAiKeyRequiredError(data)) {
          emitOpenAiKeyRequiredPrompt();
          setErrorCode(typeof (data as any)?.error === "string" ? (data as any).error : null);
          setError(
            sanitizeAiApiErrorText((data as any).message) || "OpenAI API key is required in Settings."
          );
          setIsLoading(false);
          return;
        }
        if (isZAiKeyRequiredError(data)) {
          emitZAiKeyRequiredPrompt();
          setErrorCode(typeof (data as any)?.error === "string" ? (data as any).error : null);
          setError(
            sanitizeAiApiErrorText((data as any).message) || "Z.ai API key is required in Settings."
          );
          setIsLoading(false);
          return;
        }

        if (!response.ok) {
          const serverErrorCode =
            typeof (data as any)?.error === "string" ? (data as any).error.trim() : "";
          const serverErrorMessage =
            typeof (data as any)?.message === "string" ? (data as any).message.trim() : "";
          setErrorCode(serverErrorCode || null);
          throw new Error(
            sanitizeAiApiErrorText(serverErrorMessage || serverErrorCode) ||
              "Failed to send message"
          );
        }

        setErrorCode(null);
        const warningMessage =
          typeof (data as any)?.warning === "string" ? (data as any).warning.trim() : "";
        setWarning(warningMessage || null);
        
        // Update messages with pre-answer and loading state
        upsertMessages((data as any).messages);

        // Keep loading state active (will be cleared when final answer arrives via WebSocket)
      } catch (err) {
        console.error("Failed to send message:", err);
        setError(
          err instanceof Error && err.message
            ? sanitizeAiApiErrorText(err.message)
            : "Failed to send message. Please try again."
        );
        setWarning(null);
        setIsLoading(false);
      }
    },
    [sessionId, upsertMessages]
  );

  const submitCameraRegistration = useCallback(
    async ({
      sessionIdOverride,
      sourceMessageId,
      draft,
    }: SubmitCameraRegistrationOptions) => {
      const targetSessionId = sessionIdOverride ?? sessionId;
      if (!targetSessionId || !sourceMessageId) return;

      setError(null);
      setWarning(null);

      try {
        const response = await fetch(
          `/api/chat/sessions/${targetSessionId}/camera-registration/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_message_id: sourceMessageId,
              draft,
            }),
          }
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (Array.isArray((data as any)?.messages)) {
            upsertMessages((data as any).messages);
          }
          const errorText =
            typeof (data as any)?.error === "string"
              ? (data as any).error
              : "Failed to register camera";
          throw new Error(errorText);
        }

        if (Array.isArray((data as any)?.messages)) {
          upsertMessages((data as any).messages);
        }
      } catch (err) {
        console.error("Failed to submit camera registration:", err);
        throw err;
      }
    },
    [sessionId, upsertMessages]
  );

  const submitCameraBatchRegistration = useCallback(
    async ({
      sessionIdOverride,
      sourceMessageId,
    }: SubmitCameraBatchRegistrationOptions) => {
      const targetSessionId = sessionIdOverride ?? sessionId;
      if (!targetSessionId || !sourceMessageId) return;

      setError(null);
      setWarning(null);

      try {
        const response = await fetch(
          `/api/chat/sessions/${targetSessionId}/camera-batch-registration/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_message_id: sourceMessageId,
            }),
          }
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (Array.isArray((data as any)?.messages)) {
            upsertMessages((data as any).messages);
          }
          const errorText =
            typeof (data as any)?.error === "string"
              ? (data as any).error
              : "Failed to register camera batch";
          throw new Error(errorText);
        }

        if (Array.isArray((data as any)?.messages)) {
          upsertMessages((data as any).messages);
        }
      } catch (err) {
        console.error("Failed to submit camera batch registration:", err);
        throw err;
      }
    },
    [sessionId, upsertMessages]
  );

  const submitCameraBatchEdit = useCallback(
    async ({
      sessionIdOverride,
      sourceMessageId,
    }: SubmitCameraBatchEditOptions) => {
      const targetSessionId = sessionIdOverride ?? sessionId;
      if (!targetSessionId || !sourceMessageId) return;

      setError(null);
      setWarning(null);

      try {
        const response = await fetch(
          `/api/chat/sessions/${targetSessionId}/camera-batch-edit/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              source_message_id: sourceMessageId,
            }),
          }
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (Array.isArray((data as any)?.messages)) {
            upsertMessages((data as any).messages);
          }
          const errorText =
            typeof (data as any)?.error === "string"
              ? (data as any).error
              : "Failed to update camera batch";
          throw new Error(errorText);
        }

        if (Array.isArray((data as any)?.messages)) {
          upsertMessages((data as any).messages);
        }
      } catch (err) {
        console.error("Failed to submit camera batch edit:", err);
        throw err;
      }
    },
    [sessionId, upsertMessages]
  );

  const updateIdentityCard = useCallback(
    async ({
      entity_id,
      entity_type,
      target_name,
      physical_traits,
      save_as_face_target,
      portrait_data_url,
      card_snapshot,
    }: UpdateIdentityCardOptions) => {
      if (!sessionId) {
        throw new Error("No active chat session.");
      }
      if (!String(entity_id || "").trim()) {
        throw new Error("entity_id is required.");
      }

      setError(null);
      setWarning(null);

      try {
        const response = await fetch(`/api/chat/sessions/${sessionId}/identity-cards/upsert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity_id: String(entity_id).trim(),
            entity_type: typeof entity_type === "string" ? entity_type.trim() : undefined,
            target_name: typeof target_name === "string" ? target_name.trim() : undefined,
            physical_traits: Array.isArray(physical_traits) ? physical_traits : [],
            save_as_face_target: save_as_face_target === true,
            portrait_data_url: typeof portrait_data_url === "string" ? portrait_data_url : null,
            card_snapshot: card_snapshot && typeof card_snapshot === "object" ? card_snapshot : null,
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (Array.isArray((data as any)?.messages)) {
            upsertMessages((data as any).messages);
          }
          const errorText =
            typeof (data as any)?.error === "string"
              ? (data as any).error
              : "Failed to update identity card";
          setError(errorText);
          throw new Error(errorText);
        }

        if (Array.isArray((data as any)?.messages)) {
          upsertMessages((data as any).messages);
        }
      } catch (err) {
        console.error("Failed to update identity card:", err);
        throw err;
      }
    },
    [sessionId, upsertMessages]
  );

  const cancelMessage = useCallback(async ({ reason = "manual" }: CancelMessageOptions = {}) => {
    if (!sessionId) return;

    const hasPendingAssistantMessages = messagesRef.current.some(
      (message: any) => String(message?.role || "") === "assistant" && Number(message?.is_pending || 0) === 1
    );
    if (!hasPendingAssistantMessages && !isLoading) return;

    applyLocalCancellation(reason);

    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error((data as any)?.error || "Failed to cancel message");
      }

      if (Array.isArray((data as any)?.messages)) {
        upsertMessages((data as any).messages);
      }
    } catch (err) {
      console.error("Failed to cancel message:", err);
    }
  }, [applyLocalCancellation, isLoading, sessionId, upsertMessages]);

  useEffect(() => {
    if (!sessionId || !isLoading || pendingExecutionState.kind === "none") {
      if (pendingExecutionState.kind === "none") {
        autoCancelKeyRef.current = null;
      }
      return;
    }

    const pendingMessages = messagesRef.current.filter((msg: any) => msg?.is_pending === 1);
    const latestPendingMessage = pendingMessages[pendingMessages.length - 1] as any;
    const autoCancelKey = `${sessionId}:${latestPendingMessage?.id ?? "pending"}:${pendingExecutionState.kind}`;
    if (autoCancelKeyRef.current === autoCancelKey) {
      return;
    }

    autoCancelKeyRef.current = autoCancelKey;
    void cancelMessage({ reason: pendingExecutionState.kind });
  }, [cancelMessage, isLoading, pendingExecutionState.kind, sessionId]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);

  const clearWarning = useCallback(() => {
    setWarning(null);
  }, []);

  return {
    isLoading,
    error,
    errorCode,
    warning,
    pendingExecutionState,
    sendMessage,
    submitCameraRegistration,
    submitCameraBatchRegistration,
    submitCameraBatchEdit,
    updateIdentityCard,
    cancelMessage,
    clearError,
    clearWarning,
  };
}

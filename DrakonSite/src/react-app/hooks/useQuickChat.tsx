import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface MinimizedChat {
  sessionId: number;
  title: string;
}

interface QuickChatContextType {
  isOpen: boolean;
  sessionId: number | null;
  sessionTitle: string | null;
  minimizedChats: MinimizedChat[];
  openQuickChat: () => void;
  closeQuickChat: () => void;
  minimizeQuickChat: (titleOverride?: string | null) => void;
  openQuickChatSession: (chatSessionId: number, title?: string | null) => void;
  restoreChat: (sessionId: number) => void;
  removeMinimizedChat: (sessionId: number) => void;
  setSessionId: (id: number | null) => void;
  setSessionTitle: (title: string | null) => void;
}

const QuickChatContext = createContext<QuickChatContextType | undefined>(undefined);

export function QuickChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [minimizedChats, setMinimizedChats] = useState<MinimizedChat[]>([]);

  const openQuickChat = useCallback(() => {
    setIsOpen(true);
    if (sessionId) {
      setMinimizedChats((prev) => prev.filter((chat) => chat.sessionId !== sessionId));
    }
  }, [sessionId]);

  const closeQuickChat = useCallback(() => {
    setIsOpen(false);
    setSessionId(null);
    setSessionTitle(null);
  }, []);

  const minimizeQuickChat = useCallback((titleOverride?: string | null) => {
    if (sessionId) {
      const title =
        (typeof titleOverride === "string" && titleOverride.trim()) ||
        (typeof sessionTitle === "string" && sessionTitle.trim()) ||
        "Quick chat";

      setMinimizedChats((prev) => {
        const existingIndex = prev.findIndex((chat) => chat.sessionId === sessionId);
        if (existingIndex === -1) {
          return [...prev, { sessionId, title }];
        }

        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          title,
        };
        return next;
      });
    }

    setIsOpen(false);
  }, [sessionId, sessionTitle]);

  const openQuickChatSession = useCallback((chatSessionId: number, title?: string | null) => {
    setSessionId(chatSessionId);
    setSessionTitle(typeof title === "string" && title.trim() ? title : null);
    setIsOpen(true);
    setMinimizedChats((prev) => prev.filter((chat) => chat.sessionId !== chatSessionId));
  }, []);

  const restoreChat = useCallback((chatSessionId: number) => {
    const restoredChat = minimizedChats.find((chat) => chat.sessionId === chatSessionId) || null;
    setSessionId(chatSessionId);
    setSessionTitle(restoredChat?.title || null);
    setIsOpen(true);
    setMinimizedChats((prev) => prev.filter((chat) => chat.sessionId !== chatSessionId));
  }, [minimizedChats]);

  const removeMinimizedChat = useCallback((chatSessionId: number) => {
    setMinimizedChats((prev) => prev.filter((chat) => chat.sessionId !== chatSessionId));
    if (!isOpen && sessionId === chatSessionId) {
      setSessionId(null);
      setSessionTitle(null);
    }
  }, [isOpen, sessionId]);

  return (
    <QuickChatContext.Provider
      value={{
        isOpen,
        sessionId,
        sessionTitle,
        minimizedChats,
        openQuickChat,
        closeQuickChat,
        minimizeQuickChat,
        openQuickChatSession,
        restoreChat,
        removeMinimizedChat,
        setSessionId,
        setSessionTitle,
      }}
    >
      {children}
    </QuickChatContext.Provider>
  );
}

export function useQuickChat() {
  const context = useContext(QuickChatContext);
  if (!context) {
    throw new Error("useQuickChat must be used within QuickChatProvider");
  }
  return context;
}

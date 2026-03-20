import { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface MinimizedChat {
  sessionId: number;
  title: string;
}

interface QuickChatContextType {
  isOpen: boolean;
  sessionId: number | null;
  minimizedChats: MinimizedChat[];
  openQuickChat: () => void;
  closeQuickChat: () => void;
  minimizeQuickChat: () => void;
  restoreChat: (sessionId: number) => void;
  removeMinimizedChat: (sessionId: number) => void;
  setSessionId: (id: number | null) => void;
}

const QuickChatContext = createContext<QuickChatContextType | undefined>(undefined);

export function QuickChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [minimizedChats, setMinimizedChats] = useState<MinimizedChat[]>([]);

  const openQuickChat = useCallback(() => {
    // Clear session to always create a fresh chat
    setSessionId(null);
    setIsOpen(true);
  }, []);

  const closeQuickChat = useCallback(() => {
    setIsOpen(false);
    // Clear session when closing completely
    setSessionId(null);
  }, []);

  const minimizeQuickChat = useCallback(() => {
    if (sessionId) {
      // Get chat title from session or create default
      const title = `Quick chat`;
      
      // Add to minimized chats if not already there
      setMinimizedChats(prev => {
        const exists = prev.some(chat => chat.sessionId === sessionId);
        if (exists) return prev;
        return [...prev, { sessionId, title }];
      });
    }
    
    setIsOpen(false);
  }, [sessionId]);

  const restoreChat = useCallback((chatSessionId: number) => {
    setSessionId(chatSessionId);
    setIsOpen(true);
    
    // Remove from minimized chats
    setMinimizedChats(prev => prev.filter(chat => chat.sessionId !== chatSessionId));
  }, []);

  const removeMinimizedChat = useCallback((chatSessionId: number) => {
    setMinimizedChats(prev => prev.filter(chat => chat.sessionId !== chatSessionId));
  }, []);

  return (
    <QuickChatContext.Provider
      value={{
        isOpen,
        sessionId,
        minimizedChats,
        openQuickChat,
        closeQuickChat,
        minimizeQuickChat,
        restoreChat,
        removeMinimizedChat,
        setSessionId,
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

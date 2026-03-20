import { useQuickChat } from "@/react-app/hooks/useQuickChat";
import { Bot, X } from "lucide-react";

export default function MinimizedChatTabs() {
  const { minimizedChats, restoreChat, removeMinimizedChat } = useQuickChat();

  if (minimizedChats.length === 0) return null;

  return (
    <div className="fixed bottom-0 right-24 md:right-32 z-30 flex gap-2 mb-4">
      {minimizedChats.map((chat) => (
        <div
          key={chat.sessionId}
          className="bg-gray-900 border border-gray-700 rounded-t-lg shadow-2xl overflow-hidden group hover:shadow-blue-500/20 transition-shadow"
        >
          <button
            onClick={() => restoreChat(chat.sessionId)}
            className="flex items-center gap-2 px-4 py-2.5 hover:bg-gray-800 transition-colors w-48"
          >
            <div className="w-6 h-6 bg-gradient-to-br from-gray-700 to-gray-800 rounded flex items-center justify-center flex-shrink-0">
              <Bot className="w-3 h-3 text-white" />
            </div>
            <span className="text-sm text-gray-200 font-medium truncate flex-1 text-left">
              {chat.title}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeMinimizedChat(chat.sessionId);
              }}
              className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove"
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        </div>
      ))}
    </div>
  );
}

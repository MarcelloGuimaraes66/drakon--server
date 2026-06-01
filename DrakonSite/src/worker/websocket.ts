// WebSocket handler for real-time chat updates

export interface ChatWebSocketMessage {
  type: "message_update" | "error";
  messages?: any[];
  error?: string;
}

export function createWebSocketHandler() {
  const connections = new Map<number, Set<WebSocket>>();

  return {
    handleUpgrade(sessionId: number, ws: WebSocket) {
      console.log(`[WS] New connection for session ${sessionId}`);

      if (!connections.has(sessionId)) {
        connections.set(sessionId, new Set());
      }
      connections.get(sessionId)!.add(ws);

      ws.addEventListener("close", () => {
        console.log(`[WS] Connection closed for session ${sessionId}`);
        const sessionConnections = connections.get(sessionId);
        if (sessionConnections) {
          sessionConnections.delete(ws);
          if (sessionConnections.size === 0) {
            connections.delete(sessionId);
          }
        }
      });

      ws.addEventListener("error", (error) => {
        console.error(`[WS] Error for session ${sessionId}:`, error);
      });
    },

    broadcast(sessionId: number, message: ChatWebSocketMessage) {
      const sessionConnections = connections.get(sessionId);
      if (!sessionConnections || sessionConnections.size === 0) {
        console.log(`[WS] No connections for session ${sessionId}`);
        return;
      }

      const messageStr = JSON.stringify(message);
      console.log(`[WS] Broadcasting to ${sessionConnections.size} connection(s) for session ${sessionId}`);

      sessionConnections.forEach((ws) => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(messageStr);
          }
        } catch (err) {
          console.error("[WS] Failed to send message:", err);
        }
      });
    },
  };
}

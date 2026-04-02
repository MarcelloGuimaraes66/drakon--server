import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  X,
  AlertCircle,
  ShieldAlert,
  AlertTriangle,
  WifiOff,
  CirclePlay,
  Cpu,
  Clock3,
  Radar,
} from "lucide-react";

interface Notification {
  id: number;
  camera_id: number | null;
  type: string;
  title: string;
  message: string | null;
  image_key: string | null;
  video_key: string | null;
  media_type: string | null;
  event_id: number | null;
  created_at: string;
  is_read: number;
}

interface NotificationsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationsDropdown({
  isOpen,
  onClose,
}: NotificationsDropdownProps) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
      markAsRead();
    }
  }, [isOpen]);

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/notifications");
      if (response.ok) {
        const data = await response.json();
        setNotifications(data);
      }
    } catch (error) {
      console.error("Failed to fetch notifications:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const markAsRead = async () => {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch (error) {
      console.error("Failed to mark notifications as read:", error);
    }
  };

  const getNotificationIcon = (type: string) => {
    if (type === "ai_detection") {
      return <ShieldAlert className="w-5 h-5 text-red-400" />;
    }
    if (type === "camera_connection_failed") {
      return <WifiOff className="w-5 h-5 text-orange-300" />;
    }
    if (type === "job_staled") {
      return <AlertTriangle className="w-5 h-5 text-amber-400" />;
    }
    if (type === "job_start_blocked") {
      return <AlertCircle className="w-5 h-5 text-amber-300" />;
    }
    if (type === "job_started") {
      return <CirclePlay className="w-5 h-5 text-emerald-400" />;
    }
    if (type === "agent_api_error") {
      return <Cpu className="w-5 h-5 text-rose-400" />;
    }
    if (type === "shared_find_invitation") {
      return <Radar className="w-5 h-5 text-amber-300" />;
    }
    return <AlertCircle className="w-5 h-5 text-blue-400" />;
  };

  const getNotificationRowClass = (type: string) => {
    if (type === "ai_detection") return "bg-red-500/5";
    if (type === "camera_connection_failed") return "bg-orange-500/5";
    if (type === "job_staled" || type === "job_start_blocked") return "bg-amber-500/5";
    if (type === "job_started") return "bg-emerald-500/5";
    if (type === "agent_api_error") return "bg-rose-500/5";
    if (type === "shared_find_invitation") return "bg-amber-500/5";
    return "";
  };

  const getNotificationBadge = (
    type: string,
  ): { label: string; className: string } | null => {
    if (type === "ai_detection") {
      return {
        label: "Alert",
        className: "bg-red-500/20 text-red-400",
      };
    }
    if (type === "camera_connection_failed") {
      return {
        label: "Camera",
        className: "bg-orange-500/20 text-orange-300",
      };
    }
    if (
      type === "job_staled" ||
      type === "job_start_blocked" ||
      type === "job_started"
    ) {
      return {
        label: "Job",
        className:
          type === "job_started"
            ? "bg-emerald-500/20 text-emerald-300"
            : "bg-amber-500/20 text-amber-300",
      };
    }
    if (type === "agent_api_error") {
      return {
        label: "AI",
        className: "bg-rose-500/20 text-rose-300",
      };
    }
    if (type === "shared_find_invitation") {
      return {
        label: "Find",
        className: "bg-amber-500/20 text-amber-200",
      };
    }
    return null;
  };

  const getNotificationTarget = (notification: Notification) => {
    if (notification.type === "ai_detection" && notification.event_id) {
      return `/events?type=detection&eventId=${notification.event_id}`;
    }
    if (notification.type === "camera_connection_failed") {
      return "/cameras";
    }
    if (
      notification.type === "job_staled" ||
      notification.type === "job_start_blocked" ||
      notification.type === "job_started"
    ) {
      return "/jobs";
    }
    if (notification.type === "agent_api_error") {
      return notification.camera_id ? "/ai-agents" : "/jobs";
    }
    if (notification.type === "shared_find_invitation") {
      return "/drakon-find";
    }
    return null;
  };

  const formatTimestamp = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getMediaUrl = (key: string | null) => {
    if (!key) return null;
    return `/api/detections/${key}`;
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark this notification as read
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notification.id] }),
      });
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }

    const target = getNotificationTarget(notification);
    if (target) {
      onClose();
      navigate(target);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Dropdown panel */}
      <div className="absolute right-0 top-14 w-96 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-50 max-h-[calc(100vh-5rem)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold text-gray-100">Notifications</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifications list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">
              Loading notifications...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500">No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {notifications.map((notification) => {
                const badge = getNotificationBadge(notification.type);
                const target = getNotificationTarget(notification);
                const isClickable = !!target;

                return (
                <div
                  key={notification.id}
                  onClick={() => isClickable && handleNotificationClick(notification)}
                  className={`p-4 transition-colors ${
                    isClickable
                      ? "cursor-pointer hover:bg-gray-800/50"
                      : "cursor-default"
                  } ${getNotificationRowClass(notification.type)}`}
                >
                  <div className="flex gap-3">
                    {/* Icon, thumbnail, or video preview */}
                    <div className="flex-shrink-0">
                      {notification.media_type === "video" && notification.video_key ? (
                        <video
                          src={getMediaUrl(notification.video_key)!}
                          className="w-12 h-12 rounded-lg object-cover"
                          muted
                          loop
                          playsInline
                          preload="metadata"
                          onError={(e) => {
                            // Fallback to icon on error
                            const video = e.target as HTMLVideoElement;
                            const parent = video.parentElement;
                            if (parent) {
                              video.style.display = 'none';
                              const placeholder = document.createElement('div');
                              placeholder.className = 'w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center';
                              placeholder.innerHTML = '<svg class="w-5 h-5 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                              parent.appendChild(placeholder);
                            }
                          }}
                        />
                      ) : notification.image_key ? (
                        <img
                          src={getMediaUrl(notification.image_key)!}
                          alt="Detection"
                          className="w-12 h-12 rounded-lg object-cover"
                          onError={(e) => {
                            // Fallback to icon on error
                            const img = e.target as HTMLImageElement;
                            const parent = img.parentElement;
                            if (parent) {
                              img.style.display = 'none';
                              const placeholder = document.createElement('div');
                              placeholder.className = 'w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center';
                              placeholder.innerHTML = '<svg class="w-5 h-5 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                              parent.appendChild(placeholder);
                            }
                          }}
                        />
                      ) : (
                        <div className="w-12 h-12 bg-gray-800 rounded-lg flex items-center justify-center">
                          {getNotificationIcon(notification.type)}
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-semibold text-gray-100">
                          {notification.title}
                        </h4>
                        {badge && (
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full whitespace-nowrap ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>

                      {notification.message ? (
                        <p className="text-sm text-gray-300 mb-1">
                          {notification.message}
                        </p>
                      ) : null}

                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock3 className="w-3 h-3" />
                        <span>
                          {formatTimestamp(notification.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

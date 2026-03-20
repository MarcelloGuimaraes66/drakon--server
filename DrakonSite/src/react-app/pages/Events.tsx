import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router";
import Layout from "@/react-app/components/Layout";
import { Event } from "@/shared/types";
import {
  FileText,
  AlertTriangle,
  Camera,
  CheckCircle,
  XCircle,
  Filter,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Mail,
  Download,
  Loader2,
} from "lucide-react";

interface Detection {
  id: number;
  camera_id: number;
  camera_name: string;
  algo_type: string;
  detected_at: string;
  image_url?: string;
  video_url?: string;
  media_type: string;
  event_id: number | null;
}

export default function Events() {
  const [searchParams] = useSearchParams();
  const [events, setEvents] = useState<Event[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [filter, setFilter] = useState("all");
  const [highlightedId, setHighlightedId] = useState<number | null>(null);
  const [expandedDetectionId, setExpandedDetectionId] = useState<number | null>(null);
  const [sharingId, setSharingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const detectionRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Helper to normalize media URLs
  const normalizeMediaUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    return window.location.origin + url;
  };

  // Handle URL query params on mount
  useEffect(() => {
    const typeParam = searchParams.get("type");
    const eventIdParam = searchParams.get("eventId");

    if (typeParam === "detection") {
      setFilter("detection");
    }

    if (eventIdParam) {
      const eventId = parseInt(eventIdParam);
      if (!isNaN(eventId)) {
        setHighlightedId(eventId);
        // Clear highlight after 5 seconds
        setTimeout(() => setHighlightedId(null), 5000);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (filter === "detection") {
      fetchDetections();
    } else {
      fetchEvents();
    }
  }, [filter]);

  // Scroll to highlighted detection after data loads
  useEffect(() => {
    if (highlightedId !== null && filter === "detection" && detections.length > 0) {
      // Find the detection with matching event_id
      const detection = detections.find(d => d.event_id === highlightedId);
      if (detection) {
        const element = detectionRefs.current.get(detection.id);
        if (element) {
          setTimeout(() => {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 100);
        }
      }
    }
  }, [highlightedId, filter, detections]);

  const fetchEvents = async () => {
    try {
      const url =
        filter === "all"
          ? "/api/events"
          : `/api/events?event_type=${filter}`;
      const response = await fetch(url);
      const data = await response.json();
      setEvents(data);
    } catch (error) {
      console.error("Failed to fetch events:", error);
    }
  };

  const fetchDetections = async () => {
    try {
      const response = await fetch("/api/detections");
      const data = await response.json();
      console.log("[EVENTS] Fetched detections:", data.detections);
      console.log("[EVENTS] First detection media info:", data.detections?.[0] ? {
        id: data.detections[0].id,
        media_type: data.detections[0].media_type,
        video_url: data.detections[0].video_url,
        image_url: data.detections[0].image_url,
      } : "No detections");
      setDetections(data.detections || []);
    } catch (error) {
      console.error("Failed to fetch detections:", error);
    }
  };

  const handleDetectionClick = (detectionId: number) => {
    if (expandedDetectionId === detectionId) {
      setExpandedDetectionId(null);
    } else {
      setExpandedDetectionId(detectionId);
    }
  };

  const handleShare = async (detection: Detection, e: React.MouseEvent) => {
    e.stopPropagation();
    setSharingId(detection.id);
    
    try {
      const response = await fetch(`/api/detections/${detection.id}/share`, {
        method: "POST",
      });

      if (response.ok) {
        showToast("Detection sent to your email", "success");
      } else {
        const error = await response.json();
        showToast(error.error || "Could not send email. Please try again.", "error");
      }
    } catch (error) {
      console.error("Failed to share detection:", error);
      showToast("Could not send email. Please try again.", "error");
    } finally {
      setSharingId(null);
    }
  };

  const handleDownload = async (detection: Detection, e: React.MouseEvent) => {
    e.stopPropagation();
    setDownloadingId(detection.id);

    try {
      const response = await fetch(`/api/detections/${detection.id}/export`);
      
      if (!response.ok) {
        throw new Error("Failed to export detection");
      }

      // Download ZIP file
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `detection_${detection.id}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast("Detection downloaded successfully", "success");
    } catch (error) {
      console.error("Failed to download detection:", error);
      showToast("Could not download detection. Please try again.", "error");
    } finally {
      setDownloadingId(null);
    }
  };

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case "detection":
        return <AlertTriangle className="w-5 h-5 text-yellow-400" />;
      case "error":
        return <XCircle className="w-5 h-5 text-red-400" />;
      case "status_change":
        return <CheckCircle className="w-5 h-5 text-green-400" />;
      default:
        return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  };

  const formatFullDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(date);
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* Toast */}
        {toast && (
          <div className="fixed top-20 right-4 z-50 animate-slide-in">
            <div
              className={`px-6 py-3 rounded-lg shadow-2xl backdrop-blur-xl border ${
                toast.type === "success"
                  ? "bg-green-900/95 border-green-700/50 text-green-100"
                  : "bg-red-900/95 border-red-700/50 text-red-100"
              }`}
            >
              {toast.message}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-100 mb-2">
            Logs & Events
          </h1>
          <p className="text-sm md:text-base text-gray-400">
            Monitor system activity and detections
          </p>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center gap-3">
          <Filter className="w-5 h-5 text-gray-400 hidden md:block" />
          <div className="flex flex-wrap gap-2">
            {["all", "detection", "error", "status_change"].map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all min-h-[44px] md:min-h-0 ${
                  filter === type
                    ? "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {type === "all"
                  ? "All Events"
                  : type
                      .split("_")
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(" ")}
              </button>
            ))}
          </div>
        </div>

        {/* Events/Detections list */}
        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl overflow-hidden">
          <div className="divide-y divide-gray-800">
            {filter === "detection" ? (
              // Detections view
              <>
                {detections.length === 0 && (
                  <div className="text-center py-12 md:py-16">
                    <ShieldAlert className="w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-sm md:text-base text-gray-500">No detections to display</p>
                  </div>
                )}

                {detections.map((detection) => {
                  const isExpanded = expandedDetectionId === detection.id;
                  const isHighlighted = detection.event_id === highlightedId;

                  return (
                    <div
                      key={detection.id}
                      ref={(el) => {
                        if (el) {
                          detectionRefs.current.set(detection.id, el);
                        } else {
                          detectionRefs.current.delete(detection.id);
                        }
                      }}
                      className={`transition-all ${
                        isHighlighted
                          ? "ring-2 ring-red-500 bg-red-500/10 animate-pulse"
                          : ""
                      }`}
                    >
                      {/* Header row (always visible) */}
                      <div
                        className="p-4 md:p-6 hover:bg-gray-800/30 cursor-pointer transition-colors"
                        onClick={() => handleDetectionClick(detection.id)}
                      >
                        <div className="flex items-start gap-3 md:gap-4">
                          {/* Thumbnail or video preview */}
                          <div className="flex-shrink-0">
                            {detection.media_type === "video" && detection.video_url ? (
                              <video
                                src={normalizeMediaUrl(detection.video_url)}
                                className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border border-gray-700"
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                onError={(e) => {
                                  const video = e.target as HTMLVideoElement;
                                  const parent = video.parentElement;
                                  if (parent) {
                                    video.style.display = "none";
                                    const placeholder = document.createElement("div");
                                    placeholder.className =
                                      "w-16 h-16 md:w-20 md:h-20 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700";
                                    placeholder.innerHTML =
                                      '<svg class="w-8 h-8 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                                    parent.appendChild(placeholder);
                                  }
                                }}
                              />
                            ) : detection.image_url ? (
                              <img
                                src={normalizeMediaUrl(detection.image_url)}
                                alt="Detection"
                                loading="lazy"
                                className="w-16 h-16 md:w-20 md:h-20 rounded-lg object-cover border border-gray-700"
                                onError={(e) => {
                                  const img = e.target as HTMLImageElement;
                                  const parent = img.parentElement;
                                  if (parent) {
                                    img.style.display = "none";
                                    const placeholder = document.createElement("div");
                                    placeholder.className =
                                      "w-16 h-16 md:w-20 md:h-20 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700";
                                    placeholder.innerHTML =
                                      '<svg class="w-8 h-8 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                                    parent.appendChild(placeholder);
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-16 h-16 md:w-20 md:h-20 bg-gray-800 rounded-lg flex items-center justify-center border border-gray-700">
                                <ShieldAlert className="w-8 h-8 text-red-400" />
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 md:gap-4 mb-2">
                              <div className="flex-1">
                                <h3 className="text-sm md:text-base font-semibold text-gray-100 mb-1">
                                  Detection "{detection.algo_type}" = YES
                                </h3>
                                <p className="text-sm text-gray-400">
                                  on camera "{detection.camera_name}"
                                </p>
                              </div>
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatDate(detection.detected_at)}
                              </span>
                            </div>

                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              <div className="flex items-center gap-1.5">
                                <Camera className="w-3 h-3" />
                                Camera #{detection.camera_id}
                              </div>
                              <div className="px-2 py-1 bg-red-500/10 text-red-400 rounded border border-red-500/20">
                                AI Detection
                              </div>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              onClick={(e) => handleShare(detection, e)}
                              disabled={sharingId === detection.id}
                              className="p-2 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Share via Email"
                            >
                              {sharingId === detection.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Mail className="w-5 h-5" />
                              )}
                            </button>
                            <button
                              onClick={(e) => handleDownload(detection, e)}
                              disabled={downloadingId === detection.id}
                              className="p-2 text-gray-400 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title="Download"
                            >
                              {downloadingId === detection.id ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                              ) : (
                                <Download className="w-5 h-5" />
                              )}
                            </button>
                            {isExpanded ? (
                              <ChevronUp className="w-5 h-5 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-5 h-5 text-gray-400" />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-4 md:px-6 pb-6 bg-gray-800/20">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Large media (video or image) */}
                            <div className="order-2 lg:order-1">
                              {detection.media_type === "video" && detection.video_url ? (
                                <div className="space-y-3">
                                  <video
                                    src={normalizeMediaUrl(detection.video_url)}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    className="w-full rounded-xl border border-gray-700 shadow-2xl"
                                    onError={(e) => {
                                      const video = e.target as HTMLVideoElement;
                                      const parent = video.parentElement;
                                      if (parent) {
                                        video.style.display = "none";
                                        const placeholder = document.createElement("div");
                                        placeholder.className =
                                          "w-full aspect-video bg-gray-800 rounded-xl border border-gray-700 flex items-center justify-center";
                                        placeholder.innerHTML =
                                          '<svg class="w-16 h-16 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                                        parent.appendChild(placeholder);
                                      }
                                    }}
                                  />
                                  <a
                                    href={normalizeMediaUrl(detection.video_url)}
                                    download={`detection_${detection.id}.mp4`}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30"
                                  >
                                    <Download className="w-4 h-4" />
                                    Download clip
                                  </a>
                                </div>
                              ) : detection.image_url ? (
                                <img
                                  src={normalizeMediaUrl(detection.image_url)}
                                  alt="Detection Frame"
                                  loading="lazy"
                                  className="w-full rounded-xl border border-gray-700 shadow-2xl"
                                  onError={(e) => {
                                    const img = e.target as HTMLImageElement;
                                    const parent = img.parentElement;
                                    if (parent) {
                                      img.style.display = "none";
                                      const placeholder = document.createElement("div");
                                      placeholder.className =
                                        "w-full aspect-video bg-gray-800 rounded-xl border border-gray-700 flex items-center justify-center";
                                      placeholder.innerHTML =
                                        '<svg class="w-16 h-16 text-red-400" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
                                      parent.appendChild(placeholder);
                                    }
                                  }}
                                />
                              ) : (
                                <div className="w-full aspect-video bg-gray-800 rounded-xl border border-gray-700 flex items-center justify-center">
                                  <AlertTriangle className="w-16 h-16 text-red-400" />
                                </div>
                              )}
                            </div>

                            {/* Metadata card */}
                            <div className="order-1 lg:order-2">
                              <div className="bg-gray-900/80 backdrop-blur-sm border border-gray-700 rounded-xl p-6">
                                <h4 className="text-lg font-semibold text-gray-100 mb-4">
                                  Detection Details
                                </h4>
                                <div className="space-y-4">
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">Camera Name</p>
                                    <p className="text-sm text-gray-200 font-medium">
                                      {detection.camera_name}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">Camera ID</p>
                                    <p className="text-sm text-gray-200">#{detection.camera_id}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">
                                      Algorithm / Detection Type
                                    </p>
                                    <p className="text-sm text-gray-200">{detection.algo_type}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">Detection Result</p>
                                    <span className="inline-block px-3 py-1 bg-red-500/20 text-red-400 rounded-lg text-sm font-medium border border-red-500/30">
                                      YES
                                    </span>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500 mb-1">Timestamp</p>
                                    <p className="text-sm text-gray-200">
                                      {formatFullDate(detection.detected_at)}
                                    </p>
                                  </div>
                                  {detection.event_id && (
                                    <div>
                                      <p className="text-xs text-gray-500 mb-1">Event ID</p>
                                      <p className="text-sm text-gray-200">#{detection.event_id}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            ) : (
              // Events view
              <>
                {events.length === 0 && (
                  <div className="text-center py-12 md:py-16">
                    <FileText className="w-12 md:w-16 h-12 md:h-16 text-gray-600 mx-auto mb-4" />
                    <p className="text-sm md:text-base text-gray-500">No events to display</p>
                  </div>
                )}

                {events.map((event) => (
                  <div
                    key={event.id}
                    className="p-4 md:p-6 hover:bg-gray-800/30 transition-colors"
                  >
                    <div className="flex items-start gap-3 md:gap-4">
                      <div className="w-8 md:w-10 h-8 md:h-10 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0">
                        {getEventIcon(event.event_type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2 md:gap-4 mb-2">
                          <div className="flex-1">
                            <h3 className="text-sm md:text-base font-semibold text-gray-100 mb-1">
                              {event.event_type
                                .split("_")
                                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                                .join(" ")}
                            </h3>
                            {event.description && (
                              <p className="text-sm text-gray-400">
                                {event.description}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {formatDate(event.created_at)}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          {event.camera_id && (
                            <div className="flex items-center gap-1.5">
                              <Camera className="w-3 h-3" />
                              Camera #{event.camera_id}
                            </div>
                          )}
                          {event.metadata && (
                            <div className="px-2 py-1 bg-gray-800 rounded">
                              {event.metadata}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

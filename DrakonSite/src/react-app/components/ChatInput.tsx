import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Plus, Send, Video, X } from "lucide-react";
import {
  FACE_ID_MAX_IMAGE_SIDE_PX,
  FACE_ID_MAX_UPLOAD_BYTES,
  normalizeFaceIdImage,
} from "@/react-app/utils/faceIdImage";

const CHAT_INPUT_MAX_HEIGHT_PX = 180;
const CHAT_INPUT_BASE_HEIGHT_PX = {
  default: 44,
  "chat-page": 48,
} as const;

interface UploadedVideo {
  id: number;
  publicUrl: string;
  originalName: string;
  sizeBytes: number;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
  className?: string;
  variant?: "default" | "chat-page";
  uploadedImage?: string | null;
  onImageUpload?: (base64: string) => void;
  onImageRemove?: () => void;
  uploadedVideo?: UploadedVideo | null;
  onVideoUpload?: (video: UploadedVideo) => void;
  onVideoRemove?: () => void;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onCancel,
  disabled = false,
  isRunning = false,
  placeholder = "Ask about your cameras...",
  className = "",
  variant = "default",
  uploadedImage = null,
  onImageUpload,
  onImageRemove,
  uploadedVideo = null,
  onVideoUpload,
  onVideoRemove,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const isChatPageVariant = variant === "chat-page";
  const baseTextareaHeight = isChatPageVariant
    ? CHAT_INPUT_BASE_HEIGHT_PX["chat-page"]
    : CHAT_INPUT_BASE_HEIGHT_PX.default;

  const syncTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${baseTextareaHeight}px`;

    if (!textarea.value.length) {
      textarea.style.overflowY = "hidden";
      return;
    }

    const nextHeight = Math.min(
      Math.max(textarea.scrollHeight, baseTextareaHeight),
      CHAT_INPUT_MAX_HEIGHT_PX,
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    if (!showDropdown) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showDropdown]);

  useEffect(() => {
    syncTextareaHeight();
  }, [baseTextareaHeight, value]);

  useEffect(() => {
    const handleResize = () => {
      syncTextareaHeight();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isRunning) return;
    if ((!value.trim() && !uploadedImage && !uploadedVideo) || disabled) return;
    onSend();
  };

  const handleActionClick = () => {
    if (isRunning) {
      onCancel?.();
      return;
    }

    if ((!value.trim() && !uploadedImage && !uploadedVideo) || disabled) return;
    onSend();
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    syncTextareaHeight();
  };

  const handleTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;

    e.preventDefault();
    handleActionClick();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (JPEG or PNG)");
      return;
    }

    if (file.size > FACE_ID_MAX_UPLOAD_BYTES) {
      alert("Image file is too large. Please select an image under 10MB.");
      return;
    }

    setIsProcessing(true);

    try {
      const normalized = await normalizeFaceIdImage(file, {
        maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
      });
      onImageUpload?.(normalized.dataUrl);
    } catch (error) {
      console.error("Failed to process image:", error);
      alert("Failed to process image. Please try another file.");
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleUploadClick = () => {
    if (isProcessing || isUploadingVideo) return;
    setShowDropdown((current) => !current);
  };

  const handleSearchByFace = () => {
    setShowDropdown(false);
    if (uploadedImage || isProcessing) return;
    fileInputRef.current?.click();
  };

  const handleSearchInVideo = () => {
    setShowDropdown(false);
    if (uploadedVideo || isUploadingVideo) return;
    videoInputRef.current?.click();
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ["video/mp4", "video/webm", "video/quicktime"];
    if (!allowedTypes.includes(file.type)) {
      alert("Please select a video file (MP4, WebM, or MOV)");
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      alert("Video file is too large. Maximum size is 500MB.");
      return;
    }

    setIsUploadingVideo(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/video-uploads", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Video upload failed: ${res.status}`);
      }

      const result = await res.json();

      onVideoUpload?.({
        id: result.id,
        publicUrl: result.public_url,
        originalName: result.original_name,
        sizeBytes: result.size_bytes,
      });
    } catch (error) {
      console.error("Failed to upload video:", error);
      alert("Failed to upload video. Please try again.");
    } finally {
      setIsUploadingVideo(false);
      if (videoInputRef.current) {
        videoInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = () => {
    onImageRemove?.();
  };

  const handleRemoveVideo = () => {
    onVideoRemove?.();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const actionButtonDisabled = isRunning
    ? disabled || !onCancel
    : (!value.trim() && !uploadedImage && !uploadedVideo) || disabled || isProcessing || isUploadingVideo;

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div
        className={
          isChatPageVariant
            ? "flex flex-col gap-3 rounded-[30px] border border-white/[0.08] bg-[#222634]/82 p-3 shadow-[0_24px_80px_-42px_rgba(0,0,0,0.88)] backdrop-blur-xl md:p-4"
            : "flex flex-col gap-2"
        }
      >
        {(uploadedImage || uploadedVideo) && (
          <div className={isChatPageVariant ? "flex flex-wrap gap-3 px-1" : "flex flex-wrap gap-2"}>
            {uploadedImage && (
              <div className="relative inline-block">
                <img
                  src={uploadedImage}
                  alt="Uploaded preview"
                  className={`max-h-[70px] max-w-[200px] object-contain ${
                    isChatPageVariant
                      ? "rounded-2xl border border-white/[0.08] shadow-lg shadow-black/25"
                      : "rounded-lg border border-gray-700"
                  }`}
                />
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white transition-colors hover:bg-red-700"
                  aria-label="Remove image"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {uploadedVideo && (
              <div
                className={`flex max-w-[300px] items-center gap-2 px-3 py-2 ${
                  isChatPageVariant
                    ? "rounded-2xl border border-white/[0.08] bg-white/[0.04]"
                    : "rounded-lg border border-gray-700 bg-gray-800"
                }`}
              >
                <Video className="h-4 w-4 flex-shrink-0 text-sky-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-200">{uploadedVideo.originalName}</p>
                  <p className="text-xs text-gray-500">{formatFileSize(uploadedVideo.sizeBytes)}</p>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveVideo}
                  className="flex-shrink-0 rounded-full bg-red-600 p-1 text-white transition-colors hover:bg-red-700"
                  aria-label="Remove video"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}

        <div className="relative flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
            disabled={disabled || isProcessing || !!uploadedImage}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={handleVideoSelect}
            className="hidden"
            disabled={disabled || isUploadingVideo || !!uploadedVideo}
          />

          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={disabled || isProcessing || isUploadingVideo}
              className={
                isChatPageVariant
                  ? "flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-gray-300 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
                  : "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-gray-700 bg-gray-800 p-2.5 transition-colors hover:bg-gray-750 disabled:opacity-50"
              }
              aria-label="Attach image or video"
              title="Attach image or video"
            >
              <Plus className={`h-4 w-4 md:h-5 md:w-5 ${isChatPageVariant ? "text-gray-300" : "text-gray-400"}`} />
            </button>

            {showDropdown && (
              <div
                className={`absolute bottom-full left-0 z-50 mb-2 w-48 shadow-xl ${
                  isChatPageVariant
                    ? "rounded-2xl border border-white/[0.08] bg-[#1f2330]/96 backdrop-blur-xl"
                    : "rounded-lg border border-gray-700 bg-gray-800"
                }`}
              >
                <button
                  type="button"
                  onClick={handleSearchByFace}
                  disabled={!!uploadedImage || isProcessing}
                  className={`w-full rounded-t-2xl px-4 py-3 text-left text-sm text-gray-200 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isChatPageVariant ? "hover:bg-white/[0.06]" : "rounded-t-lg hover:bg-gray-700"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <ImageIcon className="h-4 w-4 text-blue-400" />
                    <span>Search by Face</span>
                    {uploadedImage && <span className="ml-auto text-xs text-gray-500">&#10003;</span>}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleSearchInVideo}
                  disabled={!!uploadedVideo || isUploadingVideo}
                  className={`w-full rounded-b-2xl px-4 py-3 text-left text-sm text-gray-200 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isChatPageVariant ? "hover:bg-white/[0.06]" : "rounded-b-lg hover:bg-gray-700"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Video className="h-4 w-4 text-sky-400" />
                    <span>Search in Video</span>
                    {uploadedVideo && <span className="ml-auto text-xs text-gray-500">&#10003;</span>}
                  </span>
                </button>
              </div>
            )}
          </div>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleTextChange}
            onKeyDown={handleTextKeyDown}
            placeholder={placeholder}
            rows={1}
            className={
              isChatPageVariant
                ? "h-[48px] flex-1 resize-none rounded-2xl border border-white/[0.08] bg-[#171b26]/90 px-4 py-3 text-sm leading-6 text-gray-100 transition-all placeholder:text-gray-500 focus:border-blue-400/30 focus:outline-none focus:ring-2 focus:ring-blue-400/60 md:text-base"
                : "h-[44px] flex-1 resize-none rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm leading-6 text-gray-100 transition-all placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 md:px-4 md:text-base"
            }
            style={{ maxHeight: `${CHAT_INPUT_MAX_HEIGHT_PX}px` }}
            disabled={disabled || isProcessing}
          />

          <button
            type="button"
            onClick={handleActionClick}
            disabled={actionButtonDisabled}
            className={
              isChatPageVariant
                ? "flex min-h-[48px] min-w-[48px] items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 px-4 text-white shadow-[0_18px_34px_-18px_rgba(74,149,255,0.9)] transition-all hover:from-blue-400 hover:to-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:shadow-none"
                : "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-blue-500 px-4 py-2.5 font-medium text-white shadow-lg shadow-blue-500/30 transition-colors hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 disabled:shadow-none md:px-6"
            }
            aria-label={isRunning ? "Stop response" : "Send message"}
            title={isRunning ? "Stop response" : "Send message"}
          >
            {isRunning ? (
              <span className="h-3.5 w-3.5 rounded-[2px] bg-white md:h-4 md:w-4" />
            ) : (
              <Send className="h-4 w-4 md:h-5 md:w-5" />
            )}
          </button>
        </div>

        {isProcessing && <p className="text-xs text-gray-400">Processing image...</p>}

        {isUploadingVideo && <p className="text-xs text-gray-400">Uploading video...</p>}
      </div>
    </form>
  );
}

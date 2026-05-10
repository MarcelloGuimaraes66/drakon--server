import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Plus, Send, Video } from "lucide-react";
import UploadedVideoAttachment from "@/react-app/components/UploadedVideoAttachment";
import {
  FACE_ID_MAX_IMAGE_SIDE_PX,
  FACE_ID_MAX_UPLOAD_BYTES,
  normalizeFaceIdImage,
} from "@/react-app/utils/faceIdImage";
import { generateVideoThumbnail } from "@/react-app/utils/videoThumbnail";
import type { UploadedVideoAttachment as UploadedVideoAttachmentData, VideoUploadResponse } from "@/shared/types";

const CHAT_INPUT_MAX_HEIGHT_PX = 180;
const CHAT_INPUT_BASE_HEIGHT_PX = {
  default: 44,
  "chat-page": 48,
} as const;

const SAFE_VIDEO_UPLOAD_UI_MESSAGES = new Set<string>([
  "Please select a video file (MP4, WebM, or MOV).",
  "Video file is too large. Maximum size is 500MB.",
  "Your session expired. Please sign in again and retry the video upload.",
  "Failed to upload video. Please try again.",
]);

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
  textareaId?: string;
  containerTargetId?: string;
  className?: string;
  variant?: "default" | "chat-page";
  uploadedImage?: string | null;
  onImageUpload?: (base64: string) => void;
  onImageRemove?: () => void;
  uploadedVideo?: UploadedVideoAttachmentData | null;
  onVideoUpload?: (video: UploadedVideoAttachmentData) => void;
  onVideoRemove?: () => void;
}

function buildThumbnailFileName(originalName: string, mimeType: string): string {
  const baseName = originalName.replace(/\.[^.]+$/, "").trim() || "video-preview";
  const extension =
    mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  return `${baseName}-thumb${extension}`;
}

function mapVideoUploadResponseToAttachment(
  response: VideoUploadResponse,
  fallbackThumbnailUrl: string | null = null,
): UploadedVideoAttachmentData {
  return {
    id: response.id,
    publicUrl: response.public_url,
    originalName: response.original_name,
    sizeBytes: response.size_bytes,
    mimeType: response.mime_type,
    thumbnailUrl:
      typeof response.thumbnail_url === "string" && response.thumbnail_url.trim()
        ? response.thumbnail_url.trim()
        : fallbackThumbnailUrl,
    thumbnailFilename:
      typeof response.thumbnail_filename === "string" && response.thumbnail_filename.trim()
        ? response.thumbnail_filename.trim()
        : null,
    thumbnailWidth:
      typeof response.thumbnail_width === "number" && Number.isFinite(response.thumbnail_width)
        ? response.thumbnail_width
        : null,
    thumbnailHeight:
      typeof response.thumbnail_height === "number" && Number.isFinite(response.thumbnail_height)
        ? response.thumbnail_height
        : null,
    durationSeconds:
      typeof response.duration_seconds === "number" && Number.isFinite(response.duration_seconds)
        ? response.duration_seconds
        : null,
    previewFrameSeconds:
      typeof response.preview_frame_seconds === "number" && Number.isFinite(response.preview_frame_seconds)
        ? response.preview_frame_seconds
        : null,
  };
}

function getSafeVideoUploadErrorMessage(status: number, errorBody: unknown): string {
  const rawError =
    typeof (errorBody as any)?.error === "string" ? String((errorBody as any).error).trim().toLowerCase() : "";

  if (rawError.includes("invalid file type")) {
    return "Please select a video file (MP4, WebM, or MOV).";
  }

  if (rawError.includes("too large")) {
    return "Video file is too large. Maximum size is 500MB.";
  }

  if (status === 401 || status === 403) {
    return "Your session expired. Please sign in again and retry the video upload.";
  }

  return "Failed to upload video. Please try again.";
}

function getSafeUnexpectedVideoUploadErrorMessage(error: unknown): string {
  if (error instanceof Error && SAFE_VIDEO_UPLOAD_UI_MESSAGES.has(error.message)) {
    return error.message;
  }

  return "Failed to upload video. Please try again.";
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onCancel,
  disabled = false,
  isRunning = false,
  placeholder = "Ask about your cameras...",
  textareaId,
  containerTargetId,
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
  const [pendingVideoPreview, setPendingVideoPreview] = useState<UploadedVideoAttachmentData | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const isChatPageVariant = variant === "chat-page";
  const baseTextareaHeight = isChatPageVariant
    ? CHAT_INPUT_BASE_HEIGHT_PX["chat-page"]
    : CHAT_INPUT_BASE_HEIGHT_PX.default;
  const displayedVideo = uploadedVideo ?? pendingVideoPreview;

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

  useEffect(() => {
    if (uploadedVideo) {
      setPendingVideoPreview(null);
      setAttachmentError(null);
    }
  }, [uploadedVideo]);

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

    setAttachmentError(null);

    if (!file.type.startsWith("image/")) {
      setAttachmentError("Please select an image file (JPEG or PNG).");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    if (file.size > FACE_ID_MAX_UPLOAD_BYTES) {
      setAttachmentError("Image file is too large. Please select an image under 10MB.");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
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
      setAttachmentError("Failed to process image. Please try another file.");
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
    setAttachmentError(null);
    fileInputRef.current?.click();
  };

  const handleSearchInVideo = () => {
    setShowDropdown(false);
    if (uploadedVideo || pendingVideoPreview || isUploadingVideo) return;
    setAttachmentError(null);
    videoInputRef.current?.click();
  };

  const handleVideoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAttachmentError(null);

    const allowedTypes = ["video/mp4", "video/webm", "video/quicktime"];
    if (!allowedTypes.includes(file.type)) {
      setAttachmentError("Please select a video file (MP4, WebM, or MOV).");
      if (videoInputRef.current) {
        videoInputRef.current.value = "";
      }
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setAttachmentError("Video file is too large. Maximum size is 500MB.");
      if (videoInputRef.current) {
        videoInputRef.current.value = "";
      }
      return;
    }

    setIsUploadingVideo(true);

    let thumbnailDataUrl: string | null = null;
    let thumbnailBlob: Blob | null = null;
    let thumbnailMimeType = "image/jpeg";
    let thumbnailWidth: number | null = null;
    let thumbnailHeight: number | null = null;
    let durationSeconds: number | null = null;
    let previewFrameSeconds: number | null = null;

    try {
      try {
        const thumbnail = await generateVideoThumbnail(file);
        thumbnailDataUrl = thumbnail.dataUrl;
        thumbnailBlob = thumbnail.blob;
        thumbnailMimeType = thumbnail.mimeType;
        thumbnailWidth = thumbnail.width;
        thumbnailHeight = thumbnail.height;
        durationSeconds = thumbnail.durationSeconds;
        previewFrameSeconds = thumbnail.previewFrameSeconds;
      } catch (thumbnailError) {
        console.warn("Failed to generate local video thumbnail. Continuing without thumbnail.", thumbnailError);
      }

      setPendingVideoPreview({
        originalName: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        thumbnailUrl: thumbnailDataUrl,
        thumbnailWidth,
        thumbnailHeight,
        durationSeconds,
        previewFrameSeconds,
      });

      const formData = new FormData();
      formData.append("file", file);
      if (thumbnailBlob) {
        formData.append(
          "thumbnail",
          new File([thumbnailBlob], buildThumbnailFileName(file.name, thumbnailMimeType), {
            type: thumbnailMimeType,
            lastModified: Date.now(),
          }),
        );
      }
      if (thumbnailWidth) {
        formData.append("thumbnail_width", String(thumbnailWidth));
      }
      if (thumbnailHeight) {
        formData.append("thumbnail_height", String(thumbnailHeight));
      }
      if (durationSeconds !== null) {
        formData.append("duration_seconds", String(durationSeconds));
      }
      if (previewFrameSeconds !== null) {
        formData.append("preview_frame_seconds", String(previewFrameSeconds));
      }

      const res = await fetch("/api/video-uploads", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(getSafeVideoUploadErrorMessage(res.status, errorBody));
      }

      const result = (await res.json()) as VideoUploadResponse;
      onVideoUpload?.(mapVideoUploadResponseToAttachment(result, thumbnailDataUrl));
      setPendingVideoPreview(null);
      setAttachmentError(null);
    } catch (error) {
      console.error("Failed to upload video:", error);
      setPendingVideoPreview(null);
      setAttachmentError(getSafeUnexpectedVideoUploadErrorMessage(error));
    } finally {
      setIsUploadingVideo(false);
      if (videoInputRef.current) {
        videoInputRef.current.value = "";
      }
    }
  };

  const handleRemoveImage = () => {
    setAttachmentError(null);
    onImageRemove?.();
  };

  const handleRemoveVideo = () => {
    setPendingVideoPreview(null);
    setAttachmentError(null);
    onVideoRemove?.();
  };

  const actionButtonDisabled = isRunning
    ? disabled || !onCancel
    : (!value.trim() && !uploadedImage && !uploadedVideo) || disabled || isProcessing || isUploadingVideo;

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div
        data-onboarding-target={containerTargetId}
        className={
          isChatPageVariant
            ? "flex flex-col gap-3 rounded-[30px] border border-white/[0.08] bg-[#222634]/82 p-3 shadow-[0_24px_80px_-42px_rgba(0,0,0,0.88)] backdrop-blur-xl md:p-4"
            : "flex flex-col gap-2"
        }
      >
        {(uploadedImage || displayedVideo) && (
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
                  <span className="sr-only">Remove image</span>
                  <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 2l8 8M10 2L2 10" />
                  </svg>
                </button>
              </div>
            )}

            {displayedVideo ? (
              <UploadedVideoAttachment
                attachment={displayedVideo}
                mode="composer"
                pendingLabel={isUploadingVideo ? "Uploading..." : null}
                onRemove={uploadedVideo && !isUploadingVideo ? handleRemoveVideo : undefined}
                disabled={isUploadingVideo}
              />
            ) : null}
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
            disabled={disabled || isUploadingVideo || !!uploadedVideo || !!pendingVideoPreview}
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
                  disabled={!!uploadedVideo || !!pendingVideoPreview || isUploadingVideo}
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
            id={textareaId}
            ref={textareaRef}
            value={value}
            onChange={handleTextChange}
            onKeyDown={handleTextKeyDown}
            placeholder={placeholder}
            rows={1}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
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

        {attachmentError && (
          <p className="text-xs text-red-400" role="alert">
            {attachmentError}
          </p>
        )}
      </div>
    </form>
  );
}

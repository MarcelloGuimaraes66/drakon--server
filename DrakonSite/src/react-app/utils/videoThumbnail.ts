const DEFAULT_MAX_WIDTH_PX = 320;
const DEFAULT_JPEG_QUALITY = 0.82;
const DEFAULT_OUTPUT_MIME_TYPE = "image/jpeg";

export interface VideoThumbnailOptions {
  maxWidthPx?: number;
  jpegQuality?: number;
  outputMimeType?: string;
}

export interface GeneratedVideoThumbnail {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  previewFrameSeconds: number | null;
  mimeType: string;
}

const waitForLoadedMetadata = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }

    const handleLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Failed to load video metadata"));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });

const waitForFrameData = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const handleLoadedData = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Failed to load video frame data"));
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });

const seekVideoTo = (video: HTMLVideoElement, timeSeconds: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const targetTime = Math.max(0, timeSeconds);
    if (Math.abs(video.currentTime - targetTime) < 0.05) {
      resolve();
      return;
    }

    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Failed to seek video for thumbnail generation"));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });

    try {
      video.currentTime = targetTime;
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error("Failed to seek video"));
    }
  });

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.trim()) {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to convert video thumbnail to data URL"));
    };
    reader.onerror = () => reject(new Error("Failed to convert video thumbnail to data URL"));
    reader.readAsDataURL(blob);
  });

const choosePreviewFrameSeconds = (durationSeconds: number | null): number | null => {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return null;
  }

  const tenthOfDuration = durationSeconds * 0.1;
  const preferred = durationSeconds > 5 ? Math.min(1, tenthOfDuration) : Math.min(0.5, durationSeconds / 2);
  return Math.max(0, Math.min(durationSeconds - 0.05, preferred));
};

export async function generateVideoThumbnail(
  inputFile: File,
  options: VideoThumbnailOptions = {},
): Promise<GeneratedVideoThumbnail> {
  if (!(inputFile instanceof File)) {
    throw new Error("Invalid video file");
  }

  const maxWidthPx = Math.max(80, Math.round(options.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX));
  const jpegQuality = Math.min(0.95, Math.max(0.4, options.jpegQuality ?? DEFAULT_JPEG_QUALITY));
  const outputMimeType = options.outputMimeType ?? DEFAULT_OUTPUT_MIME_TYPE;
  const objectUrl = URL.createObjectURL(inputFile);
  const video = document.createElement("video");

  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForLoadedMetadata(video);
    await waitForFrameData(video);

    const sourceWidth = video.videoWidth || 0;
    const sourceHeight = video.videoHeight || 0;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("Video dimensions are not available");
    }

    const durationSeconds =
      Number.isFinite(video.duration) && video.duration > 0 ? Number(video.duration) : null;
    const previewFrameSeconds = choosePreviewFrameSeconds(durationSeconds);
    if (previewFrameSeconds !== null) {
      await seekVideoTo(video, previewFrameSeconds);
    }

    const scale = Math.min(1, maxWidthPx / sourceWidth);
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context for video thumbnail");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (generatedBlob) => {
          if (!generatedBlob) {
            reject(new Error("Failed to create video thumbnail blob"));
            return;
          }
          resolve(generatedBlob);
        },
        outputMimeType,
        jpegQuality,
      );
    });

    return {
      blob,
      dataUrl: await blobToDataUrl(blob),
      width: targetWidth,
      height: targetHeight,
      durationSeconds,
      previewFrameSeconds,
      mimeType: outputMimeType,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

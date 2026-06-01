export const FACE_ID_MAX_IMAGE_SIDE_PX = 1024;
export const FACE_ID_MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

type NormalizeFaceIdImageOptions = {
  maxSidePx?: number;
  jpegQuality?: number;
  outputMimeType?: string;
};

type NormalizeFaceIdImageResult = {
  file: File;
  dataUrl: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
};

const DEFAULT_OPTIONS: Required<NormalizeFaceIdImageOptions> = {
  maxSidePx: FACE_ID_MAX_IMAGE_SIDE_PX,
  jpegQuality: 0.85,
  outputMimeType: "image/jpeg",
};

const createImageFromObjectUrl = (objectUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = objectUrl;
  });

const toDataUrlFromBlob = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("Failed to generate base64 image"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error("Failed to generate base64 image"));
    reader.readAsDataURL(blob);
  });

const fileNameWithExtension = (originalName: string, extension: string): string => {
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  const base = originalName.replace(/\.[^.]+$/, "").trim() || "face-target";
  return `${base}${safeExt}`;
};

export async function normalizeFaceIdImage(
  inputFile: File,
  options: NormalizeFaceIdImageOptions = {}
): Promise<NormalizeFaceIdImageResult> {
  const { maxSidePx, jpegQuality, outputMimeType } = { ...DEFAULT_OPTIONS, ...options };
  if (!(inputFile instanceof File)) {
    throw new Error("Invalid file");
  }

  const objectUrl = URL.createObjectURL(inputFile);
  try {
    const img = await createImageFromObjectUrl(objectUrl);
    const originalWidth = img.naturalWidth || img.width;
    const originalHeight = img.naturalHeight || img.height;
    if (!originalWidth || !originalHeight) {
      throw new Error("Invalid image dimensions");
    }

    const scale = Math.min(1, maxSidePx / Math.max(originalWidth, originalHeight));
    const targetWidth = Math.max(1, Math.round(originalWidth * scale));
    const targetHeight = Math.max(1, Math.round(originalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get canvas context");
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (generatedBlob) => {
          if (!generatedBlob) {
            reject(new Error("Failed to generate normalized image"));
            return;
          }
          resolve(generatedBlob);
        },
        outputMimeType,
        jpegQuality
      );
    });

    const dataUrl = await toDataUrlFromBlob(blob);
    const extension = outputMimeType === "image/jpeg" ? "jpg" : "bin";
    const file = new File([blob], fileNameWithExtension(inputFile.name, extension), {
      type: outputMimeType,
      lastModified: Date.now(),
    });

    return {
      file,
      dataUrl,
      width: targetWidth,
      height: targetHeight,
      originalWidth,
      originalHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

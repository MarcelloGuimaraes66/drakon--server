import { getBrandWindowEventName } from "@/shared/brand";

export const OPENAI_KEY_REQUIRED_ERROR_CODE = "OPENAI_KEY_REQUIRED";
export const OPENAI_KEY_REQUIRED_DEFAULT_MESSAGE =
  "OpenAI API key is required. Add it in Settings.";
export const ZAI_KEY_REQUIRED_ERROR_CODE = "ZAI_KEY_REQUIRED";
export const ZAI_KEY_REQUIRED_DEFAULT_MESSAGE =
  "Z.ai API key is required. Add it in Settings.";

const toMessageString = (payload: Record<string, unknown>): string =>
  String(payload.message || payload.error || "").toLowerCase();

export function isOpenAiKeyRequiredError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const data = payload as Record<string, unknown>;
  const errorCode = String(data.error || "").trim().toUpperCase();
  if (errorCode === OPENAI_KEY_REQUIRED_ERROR_CODE) {
    return true;
  }

  const messageRaw = toMessageString(data);
  if (!messageRaw) return false;

  return (
    messageRaw.includes("openai api key") &&
    (messageRaw.includes("settings") || messageRaw.includes("configure"))
  );
}

export function emitOpenAiKeyRequiredPrompt(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(getBrandWindowEventName("openAiKeyRequired")));
}

export function isZAiKeyRequiredError(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const data = payload as Record<string, unknown>;
  const errorCode = String(data.error || "").trim().toUpperCase();
  if (errorCode === ZAI_KEY_REQUIRED_ERROR_CODE) {
    return true;
  }

  const messageRaw = toMessageString(data);
  if (!messageRaw) return false;

  return (
    (messageRaw.includes("z.ai api key") || messageRaw.includes("zai api key")) &&
    (messageRaw.includes("settings") || messageRaw.includes("configure"))
  );
}

export function emitZAiKeyRequiredPrompt(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(getBrandWindowEventName("zAiKeyRequired")));
}

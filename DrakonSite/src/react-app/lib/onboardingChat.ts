import type { TFunction } from "i18next";
import { brand } from "@/shared/brand";

export const ONBOARDING_CHAT_PREFILL_EVENT = `${brand.id}:onboarding-chat-prefill`;

function normalizeCameraName(cameraName: string | null | undefined): string | null {
  if (typeof cameraName !== "string") {
    return null;
  }

  const normalized = cameraName.trim();
  return normalized ? normalized : null;
}

export function buildOnboardingChatCameraStatusPrompt(
  t: TFunction,
  cameraName: string | null | undefined
): string {
  const normalizedCameraName = normalizeCameraName(cameraName);
  return normalizedCameraName
    ? t("tutorial.chat.prompt.named", { cameraName: normalizedCameraName })
    : t("tutorial.chat.prompt.generic");
}

export function buildOnboardingChatActiveFollowUpPrompt(
  t: TFunction,
  cameraName: string | null | undefined
): string {
  const normalizedCameraName = normalizeCameraName(cameraName);
  return normalizedCameraName
    ? t("tutorial.chat.prompt.activeFollowUp.named", { cameraName: normalizedCameraName })
    : t("tutorial.chat.prompt.activeFollowUp.generic");
}

export function buildOnboardingChatRecoveryPrompt(
  t: TFunction,
  cameraName: string | null | undefined
): string {
  const normalizedCameraName = normalizeCameraName(cameraName);
  return normalizedCameraName
    ? t("tutorial.chat.prompt.recovery.named", { cameraName: normalizedCameraName })
    : t("tutorial.chat.prompt.recovery.generic");
}

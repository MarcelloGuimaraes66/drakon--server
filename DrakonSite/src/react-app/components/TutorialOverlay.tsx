import { useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import {
  Bot,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import ChatPlexusBackground from "@/react-app/components/ChatPlexusBackground";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import {
  buildOnboardingChatActiveFollowUpPrompt,
  buildOnboardingChatCameraStatusPrompt,
  buildOnboardingChatRecoveryPrompt,
  ONBOARDING_CHAT_PREFILL_EVENT,
} from "@/react-app/lib/onboardingChat";
import {
  getOnboardingTargetId,
  getOnboardingTargetSelector,
  ONBOARDING_TARGETS,
  type OnboardingProviderKind,
  type OnboardingStepId,
  type OnboardingTutorialKind,
} from "@/react-app/lib/onboarding";
import { brand } from "@/shared/brand";

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type TutorialPreviewCard = {
  stage: string;
  title: string;
  description: string;
  icon: "key" | "camera" | "agent";
  tintClassName: string;
  iconShellClassName: string;
};

type StepView = {
  title: string;
  description: string;
  stageLabel?: string;
  stageProgress?: string;
  bullets?: string[];
  primaryLabel?: string;
  showBack?: boolean;
  centered?: boolean;
  customChoiceStep?: boolean;
  primaryDisabled?: boolean;
  accentClassName?: string;
  hint?: string;
  previewCards?: TutorialPreviewCard[];
  panelMaxWidth?: number;
  minHeight?: number;
  titleClassName?: string;
  descriptionClassName?: string;
  backgroundOpacityClassName?: string;
  illustration?: "thumbs-up-detection";
  illustrationCaption?: string;
};

type ProviderMeta = {
  label: string;
  buttonLabel: string;
  inputLabel: string;
  saveLabel: string;
  accentClassName: string;
};

const PANEL_MARGIN_PX = 16;
const HIGHLIGHT_PADDING_PX = 10;
const PANEL_MAX_WIDTH_PX = 520;
const TARGET_POLL_INTERVAL_MS = 150;
const TARGET_POLL_TIMEOUT_MS = 4000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getProviderMeta(provider: OnboardingProviderKind | null, t: TFunction): ProviderMeta {
  if (provider === "zai") {
    const label = t("settings.apiKeys.providers.zai");
    return {
      label,
      buttonLabel: t("settings.apiKeys.openButton", { provider: label }),
      inputLabel: t("settings.apiKeys.newLabel", { provider: label }),
      saveLabel: t("settings.apiKeys.save", { provider: label }),
      accentClassName: "from-cyan-500/20 to-sky-500/10 border-cyan-400/35 text-cyan-100",
    };
  }

  const label = t("settings.apiKeys.providers.openai");
  return {
    label,
    buttonLabel: t("settings.apiKeys.openButton", { provider: label }),
    inputLabel: t("settings.apiKeys.newLabel", { provider: label }),
    saveLabel: t("settings.apiKeys.save", { provider: label }),
    accentClassName: "from-blue-500/20 to-indigo-500/10 border-blue-400/35 text-blue-100",
  };
}

function getPreviewCardIcon(icon: TutorialPreviewCard["icon"]) {
  switch (icon) {
    case "key":
      return KeyRound;
    case "camera":
      return Camera;
    case "agent":
      return Bot;
    default:
      return Sparkles;
  }
}

function getStepView(
  stepId: OnboardingStepId | null,
  tutorialKind: OnboardingTutorialKind,
  provider: OnboardingProviderKind | null,
  tutorialCameraName: string | null,
  tutorialProceedWithoutWebcam: boolean,
  inlineMessage: string,
  t: TFunction
): StepView | null {
  const providerMeta = getProviderMeta(provider, t);
  const tutorialCameraPrompt = buildOnboardingChatCameraStatusPrompt(t, tutorialCameraName);
  const tutorialChatActiveFollowUpPrompt = buildOnboardingChatActiveFollowUpPrompt(
    t,
    tutorialCameraName
  );
  const tutorialChatRecoveryPrompt = buildOnboardingChatRecoveryPrompt(t, tutorialCameraName);

  switch (stepId) {
    case "welcome":
      return {
        title: t("tutorial.welcome.title", { appName: brand.displayName }),
        description: t("tutorial.welcome.description"),
        stageLabel: t("tutorial.common.guidedOnboarding"),
        stageProgress: t("tutorial.common.stageCount", { count: 3 }),
        primaryLabel: t("tutorial.welcome.primary"),
        centered: true,
        previewCards: [
          {
            stage: t("tutorial.common.stageShort", { current: 1 }),
            title: t("tutorial.welcome.stage1.title"),
            description: t("tutorial.welcome.stage1.description"),
            icon: "key",
            tintClassName: "from-cyan-500/16 via-sky-500/10 to-transparent",
            iconShellClassName: "from-cyan-400/22 via-cyan-300/8 to-transparent text-cyan-100",
          },
          {
            stage: t("tutorial.common.stageShort", { current: 2 }),
            title: t("tutorial.welcome.stage2.title"),
            description: t("tutorial.welcome.stage2.description"),
            icon: "camera",
            tintClassName: "from-emerald-500/16 via-teal-500/10 to-transparent",
            iconShellClassName: "from-emerald-400/22 via-emerald-300/8 to-transparent text-emerald-100",
          },
          {
            stage: t("tutorial.common.stageShort", { current: 3 }),
            title: t("tutorial.welcome.stage3.title"),
            description: t("tutorial.welcome.stage3.description"),
            icon: "agent",
            tintClassName: "from-violet-500/16 via-indigo-500/10 to-transparent",
            iconShellClassName: "from-violet-400/22 via-violet-300/8 to-transparent text-violet-100",
          },
        ],
        panelMaxWidth: 780,
        minHeight: 680,
        titleClassName: "text-3xl font-semibold tracking-tight text-white sm:text-[2.55rem] sm:leading-[1.05]",
        descriptionClassName: "max-w-[42rem] text-base leading-7 text-slate-200 sm:text-lg",
        backgroundOpacityClassName: "opacity-[0.82]",
        accentClassName: "from-blue-500/20 to-cyan-500/10 border-blue-400/30 text-blue-100",
      };
    case "settings-zai-card":
      return {
        title: t("tutorial.providerCards.zai.title"),
        description: t("tutorial.providerCards.zai.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 1, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 1, total: 6 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: tutorialKind !== "api-key",
        panelMaxWidth: 540,
        accentClassName: "from-cyan-500/20 to-sky-500/10 border-cyan-400/35 text-cyan-100",
      };
    case "settings-openai-card":
      return {
        title: t("tutorial.providerCards.openai.title"),
        description: t("tutorial.providerCards.openai.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 1, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 2, total: 6 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        panelMaxWidth: 540,
        accentClassName: "from-blue-500/20 to-indigo-500/10 border-blue-400/35 text-blue-100",
      };
    case "settings-provider-choice":
      return {
        title: t("tutorial.providerChoice.title"),
        description: t("tutorial.providerChoice.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 1, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 3, total: 6 }),
        centered: true,
        showBack: true,
        customChoiceStep: true,
        panelMaxWidth: 860,
        minHeight: 600,
        titleClassName:
          "max-w-[32rem] text-[1.95rem] font-semibold leading-[1.12] tracking-tight text-white sm:text-[2.1rem]",
        descriptionClassName: "text-base leading-7 text-slate-200",
        accentClassName: "from-violet-500/20 to-blue-500/10 border-violet-400/35 text-violet-100",
      };
    case "provider-open":
      return {
        title: t("tutorial.providerOpen.title", { provider: providerMeta.label }),
        description: t("tutorial.providerOpen.description", { buttonLabel: providerMeta.buttonLabel }),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 1, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 4, total: 6 }),
        primaryLabel: t("tutorial.providerOpen.primary"),
        showBack: true,
        panelMaxWidth: 560,
        accentClassName: providerMeta.accentClassName,
      };
    case "provider-input":
      return {
        title: t("tutorial.providerInput.title", { inputLabel: providerMeta.inputLabel }),
        description: t("tutorial.providerInput.description", { provider: providerMeta.label }),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 1, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 5, total: 6 }),
        primaryLabel: t("tutorial.providerInput.primary"),
        showBack: true,
        panelMaxWidth: 560,
        accentClassName: providerMeta.accentClassName,
      };
    case "provider-save":
      return {
        title: t("tutorial.providerSave.title", { saveLabel: providerMeta.saveLabel }),
        description: t("tutorial.providerSave.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 1, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 6, total: 6 }),
        primaryLabel: t("tutorial.providerSave.primary"),
        showBack: true,
        panelMaxWidth: 560,
        accentClassName: providerMeta.accentClassName,
        hint: inlineMessage || undefined,
      };
    case "camera-placeholder":
      return {
        title: t("tutorial.cameraIntro.title"),
        description: t("tutorial.cameraIntro.description"),
        bullets: [
          t("tutorial.cameraIntro.bullet1"),
          t("tutorial.cameraIntro.bullet2"),
        ],
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 1, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: tutorialKind !== "camera",
        centered: true,
        panelMaxWidth: 560,
        accentClassName: "from-emerald-500/18 to-cyan-500/10 border-emerald-400/35 text-emerald-100",
      };
    case "camera-scan-network":
      return {
        title: t("tutorial.cameraScan.title"),
        description: t("tutorial.cameraScan.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 2, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-cyan-500/18 to-sky-500/10 border-cyan-400/35 text-cyan-100",
      };
    case "camera-import":
      return {
        title: t("tutorial.cameraImport.title"),
        description: t("tutorial.cameraImport.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 3, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-indigo-500/18 to-blue-500/10 border-indigo-400/35 text-indigo-100",
      };
    case "camera-register":
      return {
        title: t("tutorial.cameraRegister.title"),
        description: t("tutorial.cameraRegister.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 4, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-blue-500/18 to-cyan-500/10 border-blue-400/35 text-blue-100",
      };
    case "camera-rtsp-form":
      return {
        title: t("tutorial.cameraRtsp.title"),
        description: t("tutorial.cameraRtsp.description"),
        bullets: [t("tutorial.cameraRtsp.bullet1"), t("tutorial.cameraRtsp.bullet2")],
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 5, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-amber-500/18 to-orange-500/10 border-amber-400/35 text-amber-100",
      };
    case "camera-address":
      return {
        title: t("tutorial.cameraAddress.title"),
        description: t("tutorial.cameraAddress.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 6, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-teal-500/18 to-cyan-500/10 border-teal-400/35 text-teal-100",
      };
    case "camera-storage":
      return {
        title: t("tutorial.cameraStorage.title"),
        description: t("tutorial.cameraStorage.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 7, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-emerald-500/18 to-blue-500/10 border-emerald-400/35 text-emerald-100",
      };
    case "camera-webcam-form":
      return {
        title: t("tutorial.cameraWebcam.title"),
        description: t("tutorial.cameraWebcam.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 8, total: 9 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-cyan-500/18 to-blue-500/10 border-cyan-400/35 text-cyan-100",
      };
    case "camera-webcam-save":
      return {
        title: t("tutorial.cameraWebcamSave.title"),
        description: t("tutorial.cameraWebcamSave.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 2, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 9, total: 9 }),
        primaryLabel: t("tutorial.cameraWebcamSave.primary"),
        showBack: true,
        accentClassName: "from-blue-500/18 to-indigo-500/10 border-blue-400/35 text-blue-100",
      };
    case "agent-intro":
      return {
        title: t("tutorial.agentIntro.title"),
        description: t("tutorial.agentIntro.description"),
        bullets: [
          t("tutorial.agentIntro.bullet1"),
          t("tutorial.agentIntro.bullet2"),
        ],
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 1, total: 11 }),
        primaryLabel: t("tutorial.agentIntro.primary"),
        showBack: tutorialKind !== "agent",
        centered: true,
        panelMaxWidth: 560,
        accentClassName: "from-fuchsia-500/18 to-indigo-500/10 border-fuchsia-400/35 text-fuchsia-100",
      };
    case "agent-create":
      return {
        title: t("tutorial.agentCreate.title"),
        description: t("tutorial.agentCreate.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 2, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-violet-500/18 to-indigo-500/10 border-violet-400/35 text-violet-100",
      };
    case "agent-model":
      return {
        title: t("tutorial.agentModel.title"),
        description: t("tutorial.agentModel.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 3, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-indigo-500/18 to-blue-500/10 border-indigo-400/35 text-indigo-100",
      };
    case "agent-input-type":
      return {
        title: t("tutorial.agentInputType.title"),
        description: t("tutorial.agentInputType.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 4, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-sky-500/18 to-indigo-500/10 border-sky-400/35 text-sky-100",
      };
    case "agent-fields":
      return {
        title: t("tutorial.agentFields.title"),
        description: t("tutorial.agentFields.description"),
        bullets: [
          t("tutorial.agentFields.bullet1"),
          t("tutorial.agentFields.bullet2"),
        ],
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 5, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-blue-500/18 to-cyan-500/10 border-blue-400/35 text-blue-100",
      };
    case "agent-enhance":
      return {
        title: t("tutorial.agentEnhance.title"),
        description: t("tutorial.agentEnhance.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 6, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-cyan-500/18 to-sky-500/10 border-cyan-400/35 text-cyan-100",
      };
    case "agent-polygons":
      return {
        title: t("tutorial.agentPolygons.title"),
        description: t("tutorial.agentPolygons.description"),
        bullets: [
          t("tutorial.agentPolygons.bullet1"),
          t("tutorial.agentPolygons.bullet2"),
        ],
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 7, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-amber-500/18 to-cyan-500/10 border-amber-400/35 text-amber-100",
      };
    case "agent-execution":
      return {
        title: t("tutorial.agentExecution.title"),
        description: t("tutorial.agentExecution.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 8, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-emerald-500/18 to-teal-500/10 border-emerald-400/35 text-emerald-100",
      };
    case "agent-save":
      return {
        title: t("tutorial.agentSave.title"),
        description: t("tutorial.agentSave.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 9, total: 11 }),
        primaryLabel: t("tutorial.agentSave.primary"),
        showBack: true,
        accentClassName: "from-fuchsia-500/18 to-blue-500/10 border-fuchsia-400/35 text-fuchsia-100",
      };
    case "agent-toggle":
      return {
        title: t("tutorial.agentToggle.title"),
        description: t("tutorial.agentToggle.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 10, total: 11 }),
        primaryLabel: t("tutorial.common.continue"),
        showBack: true,
        accentClassName: "from-violet-500/18 to-fuchsia-500/10 border-violet-400/35 text-violet-100",
      };
    case "ai-agents-camera-start":
      return {
        title: t("tutorial.agentCameraStart.title"),
        description: tutorialProceedWithoutWebcam
          ? t("tutorial.agentCameraStart.descriptionWithoutWebcam")
          : t("tutorial.agentCameraStart.description"),
        stageLabel: t("tutorial.common.stageOfTotal", { current: 3, total: 3 }),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 11, total: 11 }),
        primaryLabel: tutorialProceedWithoutWebcam
          ? t("tutorial.common.continue")
          : t("tutorial.agentCameraStart.primary"),
        showBack: true,
        accentClassName: "from-emerald-500/18 to-cyan-500/10 border-emerald-400/35 text-emerald-100",
      };
    case "agent-camera-required":
      return {
        title: t("tutorial.agentCameraRequired.title"),
        description: t("tutorial.agentCameraRequired.description"),
        bullets: [
          t("tutorial.agentCameraRequired.bullet1"),
          t("tutorial.agentCameraRequired.bullet2"),
        ],
        primaryLabel: t("tutorial.agentCameraRequired.primary"),
        centered: true,
        panelMaxWidth: 560,
        accentClassName: "from-amber-500/18 to-orange-500/10 border-amber-400/35 text-amber-100",
      };
    case "chat-offer":
      return {
        title: t("tutorial.chatOffer.title"),
        description: t("tutorial.chatOffer.description"),
        bullets: [
          t("tutorial.chatOffer.bullet1"),
          t("tutorial.chatOffer.bullet2"),
        ],
        primaryLabel: t("tutorial.chatOffer.primary"),
        showBack: true,
        centered: true,
        panelMaxWidth: 580,
        accentClassName: "from-cyan-500/18 to-blue-500/10 border-cyan-400/35 text-cyan-100",
      };
    case "chat-intro":
      return {
        title: t("tutorial.chatIntro.title"),
        description: t("tutorial.chatIntro.description"),
        bullets: [
          t("tutorial.chatIntro.bullet1"),
          t("tutorial.chatIntro.bullet2"),
          t("tutorial.chatIntro.bullet3"),
        ],
        stageLabel: t("tutorial.entry.menu.chat.label"),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 1, total: 3 }),
        primaryLabel: t("tutorial.chatIntro.primary"),
        centered: true,
        panelMaxWidth: 600,
        accentClassName: "from-sky-500/18 to-indigo-500/10 border-sky-400/35 text-sky-100",
      };
    case "chat-compose":
      return {
        title: t("tutorial.chatCompose.title"),
        description: tutorialCameraName
          ? t("tutorial.chatCompose.descriptionWithCamera", { cameraName: tutorialCameraName })
          : t("tutorial.chatCompose.descriptionWithoutCamera"),
        bullets: [
          t("tutorial.chatCompose.bullet1"),
          t("tutorial.chatCompose.bullet2"),
        ],
        stageLabel: t("tutorial.entry.menu.chat.label"),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 2, total: 3 }),
        primaryLabel: t("tutorial.chatCompose.primary"),
        showBack: true,
        hint: tutorialCameraPrompt,
        accentClassName: "from-blue-500/18 to-cyan-500/10 border-blue-400/35 text-blue-100",
      };
    case "chat-examples":
      return {
        title: t("tutorial.chatExamples.title"),
        description: t("tutorial.chatExamples.description"),
        bullets: [
          t("tutorial.chatExamples.activeBullet", {
            prompt: tutorialChatActiveFollowUpPrompt,
          }),
          t("tutorial.chatExamples.recoveryBullet", {
            prompt: tutorialChatRecoveryPrompt,
          }),
          t("tutorial.chatExamples.generalBullet"),
        ],
        stageLabel: t("tutorial.entry.menu.chat.label"),
        stageProgress: t("tutorial.common.progressOfTotal", { current: 3, total: 3 }),
        primaryLabel: t("tutorial.chatExamples.primary"),
        showBack: true,
        centered: true,
        panelMaxWidth: 620,
        accentClassName: "from-violet-500/18 to-cyan-500/10 border-violet-400/35 text-violet-100",
      };
    case "complete":
      if (tutorialKind === "api-key") {
        return {
          title: t("tutorial.complete.apiKey.title"),
          description: t("tutorial.complete.apiKey.description"),
          bullets: [
            t("tutorial.complete.apiKey.bullet1"),
            t("tutorial.complete.apiKey.bullet2"),
          ],
          primaryLabel: t("tutorial.complete.primary"),
          centered: true,
          panelMaxWidth: 520,
          accentClassName: "from-cyan-500/20 to-blue-500/10 border-cyan-400/35 text-cyan-100",
        };
      }

      if (tutorialKind === "camera") {
        return {
          title: t("tutorial.complete.camera.title"),
          description: t("tutorial.complete.camera.description"),
          bullets: [
            t("tutorial.complete.camera.bullet1"),
            t("tutorial.complete.camera.bullet2"),
          ],
          primaryLabel: t("tutorial.complete.primary"),
          centered: true,
          panelMaxWidth: 520,
          accentClassName: "from-emerald-500/20 to-blue-500/10 border-emerald-400/35 text-emerald-100",
        };
      }

      if (tutorialKind === "agent") {
        return {
          title: t("tutorial.complete.agent.title"),
          description: t("tutorial.complete.agent.description"),
          bullets: [
            t("tutorial.complete.agent.bullet1"),
            t("tutorial.complete.agent.bullet2"),
          ],
          primaryLabel: t("tutorial.complete.primary"),
          centered: true,
          panelMaxWidth: 520,
          accentClassName: "from-fuchsia-500/20 to-blue-500/10 border-fuchsia-400/35 text-fuchsia-100",
          illustration: "thumbs-up-detection",
          illustrationCaption: t("tutorial.complete.visualCaption"),
        };
      }

      if (tutorialKind === "chat") {
        return {
          title: t("tutorial.complete.chat.title"),
          description: t("tutorial.complete.chat.description"),
          bullets: [
            t("tutorial.complete.chat.bullet1"),
            t("tutorial.complete.chat.bullet2"),
          ],
          primaryLabel: t("tutorial.complete.primary"),
          centered: true,
          panelMaxWidth: 560,
          accentClassName: "from-cyan-500/20 to-blue-500/10 border-cyan-400/35 text-cyan-100",
        };
      }

      return {
        title: t("tutorial.complete.title"),
        description: tutorialProceedWithoutWebcam
          ? t("tutorial.complete.descriptionWithoutWebcam")
          : t("tutorial.complete.description"),
        bullets: [
          t("tutorial.complete.bullet1"),
          tutorialProceedWithoutWebcam
            ? t("tutorial.complete.bullet2WithoutWebcam")
            : t("tutorial.complete.bullet2"),
        ],
        primaryLabel: t("tutorial.complete.primary"),
        showBack: true,
        centered: true,
        panelMaxWidth: 520,
        accentClassName: "from-emerald-500/20 to-blue-500/10 border-emerald-400/35 text-emerald-100",
        illustration: "thumbs-up-detection",
        illustrationCaption: t("tutorial.complete.visualCaption"),
      };
    default:
      return null;
  }
}

export default function TutorialOverlay() {
  const { t, i18n } = useTranslation();
  const {
    isHydrated,
    isOpen,
    tutorialKind,
    currentStepId,
    selectedProvider,
    tutorialCameraId,
    tutorialCameraName,
    providerStatus,
    inlineMessage,
    tutorialProceedWithoutWebcam,
    startTutorial,
    closeTutorial,
    finishTutorial,
    next,
    back,
    chooseProvider,
    clearInlineMessage,
  } = useOnboarding();
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [isTargetPending, setIsTargetPending] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: PANEL_MAX_WIDTH_PX, height: 320 });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrolledStepIdRef = useRef<OnboardingStepId | null>(null);

  const targetId = useMemo(
    () => getOnboardingTargetId(currentStepId, selectedProvider),
    [currentStepId, selectedProvider]
  );
  const view = useMemo(
    () =>
      getStepView(
        currentStepId,
        tutorialKind,
        selectedProvider,
        tutorialCameraName,
        tutorialProceedWithoutWebcam,
        inlineMessage,
        t
      ),
    [
      currentStepId,
      i18n.language,
      i18n.resolvedLanguage,
      inlineMessage,
      selectedProvider,
      t,
      tutorialCameraName,
      tutorialKind,
      tutorialProceedWithoutWebcam,
    ]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTutorial();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeTutorial, isOpen]);

  useEffect(() => {
    if (!isOpen || !panelRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const updatePanelSize = () => {
      if (!panelRef.current) {
        return;
      }

      const rect = panelRef.current.getBoundingClientRect();
      setPanelSize((current) => {
        if (Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1) {
          return current;
        }

        return {
          width: rect.width,
          height: rect.height,
        };
      });
    };

    updatePanelSize();
    const observer = new ResizeObserver(updatePanelSize);
    observer.observe(panelRef.current);

    return () => observer.disconnect();
  }, [currentStepId, isOpen, view]);

  useEffect(() => {
    if (!isOpen || !targetId) {
      setIsTargetPending(false);
      setTargetRect(null);
      scrolledStepIdRef.current = null;
      return;
    }

    let disposed = false;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;

    const updateTargetRect = () => {
      if (disposed || !targetId) {
        return false;
      }

      const element = document.querySelector<HTMLElement>(getOnboardingTargetSelector(targetId));
      if (!element) {
        setIsTargetPending(true);
        setTargetRect(null);
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        setIsTargetPending(true);
        setTargetRect(null);
        return false;
      }

      if (scrolledStepIdRef.current !== currentStepId) {
        element.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
        scrolledStepIdRef.current = currentStepId;
      }

      setIsTargetPending(false);
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });

      return true;
    };

    const startPolling = () => {
      if (pollIntervalId) {
        return;
      }

      const startedAt = Date.now();
      pollIntervalId = setInterval(() => {
        const foundTarget = updateTargetRect();
        if (foundTarget || Date.now() - startedAt >= TARGET_POLL_TIMEOUT_MS) {
          if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
          }
        }
      }, TARGET_POLL_INTERVAL_MS);
    };

    if (!updateTargetRect()) {
      startPolling();
    }
    const onScrollOrResize = () => {
      window.requestAnimationFrame(() => {
        if (!updateTargetRect()) {
          startPolling();
        }
      });
    };

    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    return () => {
      disposed = true;
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
      }
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [currentStepId, isOpen, targetId]);

  if (!isHydrated || !isOpen || !view || !currentStepId) {
    return null;
  }

  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
  const highlightRect = targetRect
    ? (() => {
        const top = Math.max(PANEL_MARGIN_PX, targetRect.top - HIGHLIGHT_PADDING_PX);
        const left = Math.max(PANEL_MARGIN_PX, targetRect.left - HIGHLIGHT_PADDING_PX);
        const right = Math.min(
          viewportWidth - PANEL_MARGIN_PX,
          targetRect.left + targetRect.width + HIGHLIGHT_PADDING_PX
        );
        const bottom = Math.min(
          viewportHeight - PANEL_MARGIN_PX,
          targetRect.top + targetRect.height + HIGHLIGHT_PADDING_PX
        );

        return {
          top,
          left,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        };
      })()
    : null;

  const panelWidth = Math.min(view.panelMaxWidth ?? PANEL_MAX_WIDTH_PX, viewportWidth - PANEL_MARGIN_PX * 2);
  const panelMinHeight = view.minHeight
    ? Math.min(view.minHeight, viewportHeight - PANEL_MARGIN_PX * 2)
    : undefined;
  const panelMaxHeight = viewportHeight - PANEL_MARGIN_PX * 2;
  const shouldCenterPanel = view.centered || !highlightRect || isTargetPending;
  const panelStyle = {
    width: `${panelWidth}px`,
    minHeight: panelMinHeight ? `${panelMinHeight}px` : undefined,
    maxHeight: `${panelMaxHeight}px`,
    ...(shouldCenterPanel
      ? {}
      : {
          left: `${clamp(
            highlightRect.left + highlightRect.width / 2 - panelWidth / 2,
            PANEL_MARGIN_PX,
            viewportWidth - panelWidth - PANEL_MARGIN_PX
          )}px`,
          top: `${(() => {
            const belowTop = highlightRect.top + highlightRect.height + PANEL_MARGIN_PX;
            const aboveTop = highlightRect.top - panelSize.height - PANEL_MARGIN_PX;
            if (belowTop + panelSize.height <= viewportHeight - PANEL_MARGIN_PX) {
              return belowTop;
            }
            return Math.max(PANEL_MARGIN_PX, aboveTop);
          })()}px`,
        }),
  };

  const waitForTargetElement = async (
    selector: string,
    timeoutMs = TARGET_POLL_TIMEOUT_MS
  ): Promise<HTMLElement | null> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const element = document.querySelector<HTMLElement>(selector);
      const rect = element?.getBoundingClientRect();
      if (element && rect && rect.width > 0 && rect.height > 0) {
        return element;
      }

      await new Promise((resolve) => setTimeout(resolve, TARGET_POLL_INTERVAL_MS));
    }

    return null;
  };

  const waitForTargetMatchOrDisappear = async <TElement extends HTMLElement>(
    selector: string,
    predicate: (element: TElement) => boolean,
    initialElementSeen: boolean,
    timeoutMs = TARGET_POLL_TIMEOUT_MS
  ): Promise<TElement | "disappeared" | null> => {
    const startedAt = Date.now();
    let hasObservedElement = initialElementSeen;

    while (Date.now() - startedAt < timeoutMs) {
      const element = document.querySelector<TElement>(selector);
      if (element) {
        hasObservedElement = true;
        if (predicate(element)) {
          return element;
        }
      } else if (hasObservedElement) {
        return "disappeared";
      }

      await new Promise((resolve) => setTimeout(resolve, TARGET_POLL_INTERVAL_MS));
    }

    return null;
  };

  const onPrimaryClick = async () => {
    clearInlineMessage();

    if (currentStepId === "welcome") {
      await next();
      return;
    }

    if (currentStepId === "agent-camera-required") {
      startTutorial("camera");
      return;
    }

    if (currentStepId === "chat-offer") {
      startTutorial("chat", {
        cameraId: tutorialCameraId,
        cameraName: tutorialCameraName,
      });
      return;
    }

    if (currentStepId === "complete") {
      finishTutorial();
      return;
    }

    if (currentStepId === "camera-webcam-save") {
      if (targetId) {
        const saveButton = document.querySelector<HTMLButtonElement>(
          getOnboardingTargetSelector(targetId)
        );
        saveButton?.click();
      }
      return;
    }

    if (currentStepId === "agent-create") {
      if (targetId) {
        const createButton = document.querySelector<HTMLButtonElement>(
          getOnboardingTargetSelector(targetId)
        );
        createButton?.click();
      }

      await waitForTargetElement(
        getOnboardingTargetSelector(ONBOARDING_TARGETS.cameraAgentEditorModel)
      );
      await next();
      return;
    }

    if (currentStepId === "agent-save") {
      if (targetId) {
        const saveButton = document.querySelector<HTMLButtonElement>(
          getOnboardingTargetSelector(targetId)
        );
        saveButton?.click();
      }
      return;
    }

    if (currentStepId === "chat-compose") {
      window.dispatchEvent(
        new CustomEvent(ONBOARDING_CHAT_PREFILL_EVENT, {
          detail: {
            prompt: buildOnboardingChatCameraStatusPrompt(t, tutorialCameraName),
          },
        })
      );
      return;
    }

    if (currentStepId === "ai-agents-camera-start") {
      if (tutorialProceedWithoutWebcam) {
        await next();
        return;
      }

      if (!targetId) {
        await next();
        return;
      }

      const selector = getOnboardingTargetSelector(targetId);
      const startButton = document.querySelector<HTMLButtonElement>(selector);

      if (startButton?.dataset.cameraRunning !== "true") {
        startButton?.click();
        const startResult = await waitForTargetMatchOrDisappear<HTMLButtonElement>(
          selector,
          (element) => element.dataset.cameraRunning === "true",
          Boolean(startButton),
          6000
        );

        if (!startResult) {
          return;
        }
      }

      await next();
      return;
    }

    await next();
  };

  const renderChoiceButtons = () => (
    <div className="grid gap-4 md:grid-cols-2">
      <button
        type="button"
        onClick={() => void chooseProvider("zai")}
        className="flex min-h-[234px] flex-col rounded-[26px] border border-cyan-400/25 bg-cyan-500/10 px-6 py-6 text-left transition-colors hover:border-cyan-300/45 hover:bg-cyan-500/15"
      >
        <div className="mb-4 flex flex-col items-start gap-2">
          <span className="text-[1.05rem] font-semibold leading-8 text-cyan-100">
            {providerStatus.zai
              ? t("tutorial.providerChoice.useSaved", {
                  provider: t("settings.apiKeys.providers.zai"),
                })
              : t("tutorial.providerChoice.configure", {
                  provider: t("settings.apiKeys.providers.zai"),
                })}
          </span>
          {providerStatus.zai ? (
            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-emerald-100">
              {t("settings.apiKeys.status.configured")}
            </span>
          ) : null}
        </div>
        <p className="text-base leading-8 text-cyan-50/85">
          {providerStatus.zai
            ? t("tutorial.providerChoice.savedDescription", {
                provider: t("settings.apiKeys.providers.zai"),
              })
            : t("tutorial.providerChoice.zaiDefaultDescription")}
        </p>
      </button>
      <button
        type="button"
        onClick={() => void chooseProvider("openai")}
        className="flex min-h-[234px] flex-col rounded-[26px] border border-blue-400/25 bg-blue-500/10 px-6 py-6 text-left transition-colors hover:border-blue-300/45 hover:bg-blue-500/15"
      >
        <div className="mb-4 flex flex-col items-start gap-2">
          <span className="text-[1.05rem] font-semibold leading-8 text-blue-100">
            {providerStatus.openai
              ? t("tutorial.providerChoice.useSaved", {
                  provider: t("settings.apiKeys.providers.openai"),
                })
              : t("tutorial.providerChoice.configure", {
                  provider: t("settings.apiKeys.providers.openai"),
                })}
          </span>
          {providerStatus.openai ? (
            <span className="rounded-full border border-emerald-400/25 bg-emerald-500/15 px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-emerald-100">
              {t("settings.apiKeys.status.configured")}
            </span>
          ) : null}
        </div>
        <p className="text-base leading-8 text-blue-50/85">
          {providerStatus.openai
            ? t("tutorial.providerChoice.savedDescription", {
                provider: t("settings.apiKeys.providers.openai"),
              })
            : t("tutorial.providerChoice.openaiDefaultDescription")}
        </p>
      </button>
    </div>
  );

  const renderPreviewCards = () => {
    if (!view.previewCards?.length) {
      return null;
    }

    return (
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {view.previewCards.map((card) => {
          const Icon = getPreviewCardIcon(card.icon);

          return (
            <div
              key={card.title}
              className="group relative overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.035] p-5 shadow-[0_24px_80px_-48px_rgba(8,15,29,0.9)]"
            >
              <ChatPlexusBackground className="opacity-[0.34]" />
              <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${card.tintClassName}`} />
              <div className="pointer-events-none absolute -left-10 bottom-2 h-24 w-24 rounded-full bg-white/[0.05] blur-3xl" />
              <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-sky-300/[0.06] blur-3xl" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/[0.05] to-transparent" />
              <div className="relative">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
                    {card.stage}
                  </span>
                  <div
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br ${card.iconShellClassName}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-white">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{card.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderIllustration = () => {
    if (view.illustration !== "thumbs-up-detection") {
      return null;
    }

    return (
      <div className="mt-5 rounded-[24px] border border-emerald-400/20 bg-emerald-500/[0.06] px-5 py-5">
        <div className="flex items-center justify-center">
          <div className="relative w-full max-w-[360px] overflow-hidden rounded-[22px] border border-cyan-400/12 bg-gradient-to-r from-cyan-500/[0.04] via-white/[0.02] to-emerald-500/[0.04] px-4 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_50%,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_76%_42%,rgba(16,185,129,0.14),transparent_30%)]" />
            <svg
              viewBox="0 0 340 150"
              className="relative z-10 mx-auto h-auto w-full max-w-[320px]"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="tutorial-scene-camera" x1="0%" x2="100%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(34,211,238,0.22)" />
                  <stop offset="100%" stopColor="rgba(14,116,144,0.08)" />
                </linearGradient>
                <linearGradient id="tutorial-scene-person" x1="0%" x2="100%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
                  <stop offset="100%" stopColor="rgba(148,163,184,0.03)" />
                </linearGradient>
                <linearGradient id="tutorial-scene-beam" x1="0%" x2="100%" y1="50%" y2="50%">
                  <stop offset="0%" stopColor="rgba(34,211,238,0.00)" />
                  <stop offset="45%" stopColor="rgba(34,211,238,0.18)" />
                  <stop offset="100%" stopColor="rgba(16,185,129,0.00)" />
                </linearGradient>
              </defs>

              <ellipse cx="170" cy="126" rx="118" ry="18" fill="rgba(15,23,42,0.32)" />

              <path
                d="M86 78 C122 63, 152 57, 188 57"
                stroke="rgba(34,211,238,0.28)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeDasharray="5 8"
              />
              <path
                d="M86 88 C124 87, 154 88, 190 88"
                stroke="url(#tutorial-scene-beam)"
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M86 98 C122 112, 152 118, 188 118"
                stroke="rgba(16,185,129,0.22)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeDasharray="5 8"
              />

              <g transform="translate(28 52)">
                <rect
                  x="0"
                  y="0"
                  width="64"
                  height="42"
                  rx="14"
                  fill="url(#tutorial-scene-camera)"
                  stroke="rgba(186,230,253,0.30)"
                  strokeWidth="2"
                />
                <rect
                  x="16"
                  y="-8"
                  width="18"
                  height="10"
                  rx="4"
                  fill="rgba(186,230,253,0.10)"
                  stroke="rgba(186,230,253,0.18)"
                  strokeWidth="1.8"
                />
                <circle
                  cx="35"
                  cy="21"
                  r="11"
                  fill="rgba(15,23,42,0.45)"
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth="2.4"
                />
                <circle cx="35" cy="21" r="4.5" fill="rgba(110,231,183,0.75)" />
                <circle cx="58" cy="8" r="4.5" fill="rgba(110,231,183,0.95)" />
              </g>

              <g transform="translate(196 28)">
                <circle
                  cx="42"
                  cy="46"
                  r="34"
                  fill="url(#tutorial-scene-person)"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="1.6"
                />
                <circle
                  cx="42"
                  cy="40"
                  r="12"
                  fill="rgba(15,23,42,0.42)"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="4"
                />
                <path
                  d="M42 54 L42 86"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M42 62 L23 80"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M42 62 L60 50 L72 54"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M72 54 L79 49 L85 51 L84 59 L77 60 L73 57"
                  fill="rgba(110,231,183,0.20)"
                  stroke="rgba(110,231,183,0.95)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M42 86 L28 111"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M42 86 L58 111"
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </g>
            </svg>
          </div>
        </div>
        {view.illustrationCaption ? (
          <p className="mt-4 text-center text-sm leading-6 text-emerald-50/90">
            {view.illustrationCaption}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[110]">
      {highlightRect ? (
        <>
          <div
            className="fixed left-0 top-0 bg-slate-950/76 backdrop-blur-[2px]"
            style={{
              width: "100vw",
              height: `${Math.max(0, highlightRect.top)}px`,
            }}
          />
          <div
            className="fixed left-0 bg-slate-950/76 backdrop-blur-[2px]"
            style={{
              top: `${highlightRect.top}px`,
              width: `${Math.max(0, highlightRect.left)}px`,
              height: `${highlightRect.height}px`,
            }}
          />
          <div
            className="fixed bg-slate-950/76 backdrop-blur-[2px]"
            style={{
              top: `${highlightRect.top}px`,
              left: `${highlightRect.left + highlightRect.width}px`,
              width: `${Math.max(
                0,
                viewportWidth - (highlightRect.left + highlightRect.width)
              )}px`,
              height: `${highlightRect.height}px`,
            }}
          />
          <div
            className="fixed bottom-0 left-0 bg-slate-950/76 backdrop-blur-[2px]"
            style={{
              top: `${highlightRect.top + highlightRect.height}px`,
              width: "100vw",
            }}
          />
          <div
            className="pointer-events-none fixed rounded-2xl border border-white/65 shadow-[0_0_0_1px_rgba(125,211,252,0.35),0_0_0_10px_rgba(56,189,248,0.12),0_20px_60px_-28px_rgba(14,165,233,0.75)]"
            style={{
              top: `${highlightRect.top}px`,
              left: `${highlightRect.left}px`,
              width: `${highlightRect.width}px`,
              height: `${highlightRect.height}px`,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-slate-950/76 backdrop-blur-[3px]" />
      )}

      <div
        ref={panelRef}
        className={`fixed z-[111] ${shouldCenterPanel ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" : ""}`}
        style={panelStyle}
      >
        <div className="relative min-h-full overflow-hidden rounded-[30px] border border-white/10 bg-[#08111f]/95 shadow-[0_32px_90px_-42px_rgba(15,23,42,0.95)]">
          <ChatPlexusBackground className={view.backgroundOpacityClassName || "opacity-[0.56]"} />
          <div className="pointer-events-none absolute -left-24 top-16 h-52 w-52 rounded-full bg-cyan-400/[0.08] blur-3xl" />
          <div className="pointer-events-none absolute -right-16 top-10 h-44 w-44 rounded-full bg-blue-400/[0.08] blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-sky-300/[0.05] blur-3xl" />
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${view.accentClassName || "from-blue-500/20 to-cyan-500/10 border-blue-400/30 text-blue-100"}`}
          />
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeTutorial();
            }}
            className="absolute right-4 top-4 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-slate-900/80 text-gray-300 transition-colors hover:bg-slate-800 hover:text-white"
            aria-label={t("tutorial.closeAria")}
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative z-10 flex min-h-full flex-col p-5 sm:p-6">
            <div className="mb-4 flex items-start gap-3 pr-14 sm:pr-16">
              <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                {currentStepId === "complete" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                ) : (
                  <Sparkles className="h-5 w-5 text-sky-200" />
                )}
              </div>
              <div className="min-w-0">
                {view.stageLabel ? (
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">
                      {view.stageLabel}
                    </span>
                    {view.stageProgress ? (
                      <span className="text-xs font-medium text-slate-400">{view.stageProgress}</span>
                    ) : null}
                  </div>
                ) : null}
                <h2 className={view.titleClassName || "text-xl font-semibold text-white"}>{view.title}</h2>
              </div>
            </div>

            <p className={view.descriptionClassName || "text-sm leading-6 text-slate-300"}>
              {view.description}
            </p>

            {renderIllustration()}

            {renderPreviewCards()}

            {view.bullets?.length ? (
              <ul className="mt-4 space-y-2 text-sm text-slate-300">
                {view.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-sky-300" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {isTargetPending ? (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
                <span>{t("tutorial.common.pending")}</span>
              </div>
            ) : null}

            {view.hint ? (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {view.hint}
              </div>
            ) : null}

            {view.customChoiceStep ? <div className="mt-5">{renderChoiceButtons()}</div> : null}

            <div className="mt-auto pt-6">
              {currentStepId === "welcome" ? (
                <div className="mb-5 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-300">
                  {t("tutorial.welcome.stopHint")}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {view.showBack ? (
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {t("tutorial.common.back")}
                  </button>
                ) : null}
              </div>
              {!view.customChoiceStep && view.primaryLabel ? (
                <button
                  type="button"
                  onClick={() => void onPrimaryClick()}
                  disabled={view.primaryDisabled || (Boolean(targetId) && isTargetPending)}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl bg-blue-500 text-sm font-semibold text-white transition-colors hover:bg-blue-400 disabled:bg-slate-700 disabled:text-slate-400 ${
                    currentStepId === "welcome" ? "px-5 py-3.5 text-base" : "px-4 py-2.5"
                  }`}
                >
                  <span>{view.primaryLabel}</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

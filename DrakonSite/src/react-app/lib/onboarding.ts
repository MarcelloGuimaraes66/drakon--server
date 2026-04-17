import { brand } from "@/shared/brand";

export type OnboardingProviderKind = "zai" | "openai";

export type OnboardingTutorialKind = "intro" | "api-key" | "camera" | "agent";

export type OnboardingStepId =
  | "welcome"
  | "settings-zai-card"
  | "settings-openai-card"
  | "settings-provider-choice"
  | "provider-open"
  | "provider-input"
  | "provider-save"
  | "camera-placeholder"
  | "camera-scan-network"
  | "camera-import"
  | "camera-register"
  | "camera-rtsp-form"
  | "camera-address"
  | "camera-storage"
  | "camera-webcam-form"
  | "camera-webcam-save"
  | "agent-intro"
  | "agent-create"
  | "agent-model"
  | "agent-input-type"
  | "agent-fields"
  | "agent-enhance"
  | "agent-polygons"
  | "agent-execution"
  | "agent-save"
  | "agent-toggle"
  | "ai-agents-camera-start"
  | "agent-camera-required"
  | "complete";

export type OnboardingStatus =
  | "never_started"
  | "dismissed"
  | "in_progress"
  | "completed";

export type OnboardingTargetId =
  | "settings.zai.card"
  | "settings.zai.open-button"
  | "settings.zai.input"
  | "settings.zai.save"
  | "settings.openai.card"
  | "settings.openai.open-button"
  | "settings.openai.input"
  | "settings.openai.save"
  | "cameras.scan-network"
  | "cameras.import"
  | "cameras.register"
  | "camera-editor.rtsp.form"
  | "camera-editor.address"
  | "camera-editor.storage"
  | "camera-editor.webcam.form"
  | "camera-editor.save"
  | "algorithms.create-custom"
  | "camera-agent-editor.model"
  | "camera-agent-editor.input-type"
  | "camera-agent-editor.fields"
  | "camera-agent-editor.enhance"
  | "camera-agent-editor.polygons"
  | "camera-agent-editor.execution"
  | "camera-agent-editor.save"
  | "algorithms.custom-agent.toggle"
  | "ai-agents.camera.start";

export const ONBOARDING_TARGET_ATTRIBUTE = "data-onboarding-target";

export const ONBOARDING_TARGETS = {
  settingsZAiCard: "settings.zai.card",
  settingsZAiOpenButton: "settings.zai.open-button",
  settingsZAiInput: "settings.zai.input",
  settingsZAiSave: "settings.zai.save",
  settingsOpenAiCard: "settings.openai.card",
  settingsOpenAiOpenButton: "settings.openai.open-button",
  settingsOpenAiInput: "settings.openai.input",
  settingsOpenAiSave: "settings.openai.save",
  camerasScanNetwork: "cameras.scan-network",
  camerasImport: "cameras.import",
  camerasRegister: "cameras.register",
  cameraEditorRtspForm: "camera-editor.rtsp.form",
  cameraEditorAddress: "camera-editor.address",
  cameraEditorStorage: "camera-editor.storage",
  cameraEditorWebcamForm: "camera-editor.webcam.form",
  cameraEditorSave: "camera-editor.save",
  algorithmsCreateCustom: "algorithms.create-custom",
  cameraAgentEditorModel: "camera-agent-editor.model",
  cameraAgentEditorInputType: "camera-agent-editor.input-type",
  cameraAgentEditorFields: "camera-agent-editor.fields",
  cameraAgentEditorEnhance: "camera-agent-editor.enhance",
  cameraAgentEditorPolygons: "camera-agent-editor.polygons",
  cameraAgentEditorExecution: "camera-agent-editor.execution",
  cameraAgentEditorSave: "camera-agent-editor.save",
  algorithmsCustomAgentToggle: "algorithms.custom-agent.toggle",
  aiAgentsCameraStart: "ai-agents.camera.start",
} as const satisfies Record<string, OnboardingTargetId>;

export type PersistedOnboardingState = {
  version: number;
  status: OnboardingStatus;
  tutorialKind: OnboardingTutorialKind;
  currentStepId: OnboardingStepId | null;
  selectedProvider: OnboardingProviderKind | null;
  tutorialCameraId: number | null;
  tutorialAgentId: number | null;
  tutorialProceedWithoutWebcam: boolean;
};

const ONBOARDING_STORAGE_VERSION = 1;

const DEFAULT_PERSISTED_STATE: PersistedOnboardingState = {
  version: ONBOARDING_STORAGE_VERSION,
  status: "never_started",
  tutorialKind: "intro",
  currentStepId: null,
  selectedProvider: null,
  tutorialCameraId: null,
  tutorialAgentId: null,
  tutorialProceedWithoutWebcam: false,
};

function normalizeOnboardingStorageUserSegment(userId?: string | null): string {
  if (typeof userId !== "string") {
    return "anonymous";
  }

  const normalized = userId.trim();
  return normalized ? `user:${normalized}` : "anonymous";
}

function isValidStepId(value: unknown): value is OnboardingStepId {
  return (
    value === "welcome" ||
    value === "settings-zai-card" ||
    value === "settings-openai-card" ||
    value === "settings-provider-choice" ||
    value === "provider-open" ||
    value === "provider-input" ||
    value === "provider-save" ||
    value === "camera-placeholder" ||
    value === "camera-scan-network" ||
    value === "camera-import" ||
    value === "camera-register" ||
    value === "camera-rtsp-form" ||
    value === "camera-address" ||
    value === "camera-storage" ||
    value === "camera-webcam-form" ||
    value === "camera-webcam-save" ||
    value === "agent-intro" ||
    value === "agent-create" ||
    value === "agent-model" ||
    value === "agent-input-type" ||
    value === "agent-fields" ||
    value === "agent-enhance" ||
    value === "agent-polygons" ||
    value === "agent-execution" ||
    value === "agent-save" ||
    value === "agent-toggle" ||
    value === "ai-agents-camera-start" ||
    value === "agent-camera-required" ||
    value === "complete"
  );
}

function isValidStatus(value: unknown): value is OnboardingStatus {
  return (
    value === "never_started" ||
    value === "dismissed" ||
    value === "in_progress" ||
    value === "completed"
  );
}

function isValidProvider(value: unknown): value is OnboardingProviderKind {
  return value === "zai" || value === "openai";
}

function isValidTutorialKind(value: unknown): value is OnboardingTutorialKind {
  return value === "intro" || value === "api-key" || value === "camera" || value === "agent";
}

function normalizePersistedStepId(value: unknown): OnboardingStepId | null {
  if (value === "agent-placeholder") {
    return "agent-intro";
  }

  return isValidStepId(value) ? value : null;
}

function normalizePersistedCameraId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

export function getOnboardingStorageKey(userId?: string | null): string {
  return `${brand.id}:guided-onboarding:${normalizeOnboardingStorageUserSegment(userId)}:v${ONBOARDING_STORAGE_VERSION}`;
}

export function readOnboardingState(userId?: string | null): PersistedOnboardingState {
  if (typeof window === "undefined") {
    return DEFAULT_PERSISTED_STATE;
  }

  try {
    const raw = window.localStorage.getItem(getOnboardingStorageKey(userId));
    if (!raw) {
      return DEFAULT_PERSISTED_STATE;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedOnboardingState> | null;
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_PERSISTED_STATE;
    }

    if (parsed.version !== ONBOARDING_STORAGE_VERSION) {
      return DEFAULT_PERSISTED_STATE;
    }

    return {
      version: ONBOARDING_STORAGE_VERSION,
      status: isValidStatus(parsed.status) ? parsed.status : DEFAULT_PERSISTED_STATE.status,
      tutorialKind: isValidTutorialKind(parsed.tutorialKind)
        ? parsed.tutorialKind
        : DEFAULT_PERSISTED_STATE.tutorialKind,
      currentStepId: normalizePersistedStepId(parsed.currentStepId),
      selectedProvider: isValidProvider(parsed.selectedProvider) ? parsed.selectedProvider : null,
      tutorialCameraId: normalizePersistedCameraId(parsed.tutorialCameraId),
      tutorialAgentId: normalizePersistedCameraId(parsed.tutorialAgentId),
      tutorialProceedWithoutWebcam:
        typeof parsed.tutorialProceedWithoutWebcam === "boolean"
          ? parsed.tutorialProceedWithoutWebcam
          : DEFAULT_PERSISTED_STATE.tutorialProceedWithoutWebcam,
    };
  } catch {
    return DEFAULT_PERSISTED_STATE;
  }
}

export function writeOnboardingState(
  state: PersistedOnboardingState,
  userId?: string | null
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getOnboardingStorageKey(userId), JSON.stringify(state));
  } catch {
    // Ignore storage failures. The tutorial should remain optional.
  }
}

export function getOnboardingRoute(
  stepId: OnboardingStepId | null,
  tutorialCameraId?: number | null
): string | null {
  if (
    stepId === "settings-zai-card" ||
    stepId === "settings-openai-card" ||
    stepId === "settings-provider-choice" ||
    stepId === "provider-open" ||
    stepId === "provider-input" ||
    stepId === "provider-save"
  ) {
    return "/settings";
  }

  if (
    stepId === "camera-placeholder" ||
    stepId === "camera-scan-network" ||
    stepId === "camera-import" ||
    stepId === "camera-register" ||
    stepId === "camera-rtsp-form" ||
    stepId === "camera-address" ||
    stepId === "camera-storage" ||
    stepId === "camera-webcam-form" ||
    stepId === "camera-webcam-save"
  ) {
    return "/cameras";
  }

  if (
    stepId === "agent-intro" ||
    stepId === "agent-create" ||
    stepId === "agent-model" ||
    stepId === "agent-input-type" ||
    stepId === "agent-fields" ||
    stepId === "agent-enhance" ||
    stepId === "agent-polygons" ||
    stepId === "agent-execution" ||
    stepId === "agent-save" ||
    stepId === "agent-toggle"
  ) {
    return tutorialCameraId ? `/algorithms/${tutorialCameraId}` : "/cameras";
  }

  if (stepId === "ai-agents-camera-start") {
    return "/ai-agents";
  }

  return null;
}

export function getOnboardingTargetSelector(targetId: OnboardingTargetId): string {
  return `[${ONBOARDING_TARGET_ATTRIBUTE}="${targetId}"]`;
}

export function getOnboardingTargetId(
  stepId: OnboardingStepId | null,
  provider: OnboardingProviderKind | null
): OnboardingTargetId | null {
  switch (stepId) {
    case "settings-zai-card":
      return ONBOARDING_TARGETS.settingsZAiCard;
    case "settings-openai-card":
      return ONBOARDING_TARGETS.settingsOpenAiCard;
    case "provider-open":
      if (provider === "zai") return ONBOARDING_TARGETS.settingsZAiOpenButton;
      if (provider === "openai") return ONBOARDING_TARGETS.settingsOpenAiOpenButton;
      return null;
    case "provider-input":
      if (provider === "zai") return ONBOARDING_TARGETS.settingsZAiInput;
      if (provider === "openai") return ONBOARDING_TARGETS.settingsOpenAiInput;
      return null;
    case "provider-save":
      if (provider === "zai") return ONBOARDING_TARGETS.settingsZAiSave;
      if (provider === "openai") return ONBOARDING_TARGETS.settingsOpenAiSave;
      return null;
    case "camera-scan-network":
      return ONBOARDING_TARGETS.camerasScanNetwork;
    case "camera-import":
      return ONBOARDING_TARGETS.camerasImport;
    case "camera-register":
      return ONBOARDING_TARGETS.camerasRegister;
    case "camera-rtsp-form":
      return ONBOARDING_TARGETS.cameraEditorRtspForm;
    case "camera-address":
      return ONBOARDING_TARGETS.cameraEditorAddress;
    case "camera-storage":
      return ONBOARDING_TARGETS.cameraEditorStorage;
    case "camera-webcam-form":
      return ONBOARDING_TARGETS.cameraEditorWebcamForm;
    case "camera-webcam-save":
      return ONBOARDING_TARGETS.cameraEditorSave;
    case "agent-create":
      return ONBOARDING_TARGETS.algorithmsCreateCustom;
    case "agent-model":
      return ONBOARDING_TARGETS.cameraAgentEditorModel;
    case "agent-input-type":
      return ONBOARDING_TARGETS.cameraAgentEditorInputType;
    case "agent-fields":
      return ONBOARDING_TARGETS.cameraAgentEditorFields;
    case "agent-enhance":
      return ONBOARDING_TARGETS.cameraAgentEditorEnhance;
    case "agent-polygons":
      return ONBOARDING_TARGETS.cameraAgentEditorPolygons;
    case "agent-execution":
      return ONBOARDING_TARGETS.cameraAgentEditorExecution;
    case "agent-save":
      return ONBOARDING_TARGETS.cameraAgentEditorSave;
    case "agent-toggle":
      return ONBOARDING_TARGETS.algorithmsCustomAgentToggle;
    case "ai-agents-camera-start":
      return ONBOARDING_TARGETS.aiAgentsCameraStart;
    default:
      return null;
  }
}

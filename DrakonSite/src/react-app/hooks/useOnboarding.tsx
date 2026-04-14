import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useLocation, useNavigate } from "react-router";
import {
  getOnboardingStorageKey,
  getOnboardingRoute,
  type OnboardingProviderKind,
  type OnboardingStepId,
  type OnboardingStatus,
  readOnboardingState,
  writeOnboardingState,
} from "@/react-app/lib/onboarding";
import i18n from "@/react-app/i18n";

type ProviderStatusMap = Record<OnboardingProviderKind, boolean>;

type OnboardingContextValue = {
  isHydrated: boolean;
  isOpen: boolean;
  status: OnboardingStatus;
  currentStepId: OnboardingStepId | null;
  selectedProvider: OnboardingProviderKind | null;
  tutorialCameraId: number | null;
  tutorialAgentId: number | null;
  tutorialProceedWithoutWebcam: boolean;
  providerStatus: ProviderStatusMap;
  inlineMessage: string;
  startTutorial: () => void;
  closeTutorial: () => void;
  finishTutorial: () => void;
  completeCameraTutorial: (cameraId?: number | null) => void;
  completeAgentTutorial: (agentId?: number | null) => void;
  setTutorialProceedWithoutWebcam: (value: boolean) => void;
  next: () => Promise<void>;
  back: () => void;
  chooseProvider: (provider: OnboardingProviderKind) => Promise<void>;
  syncProviderStatus: (nextStatus: Partial<ProviderStatusMap>) => void;
  refreshProviderStatus: () => Promise<ProviderStatusMap>;
  clearInlineMessage: () => void;
};

const DEFAULT_PROVIDER_STATUS: ProviderStatusMap = {
  openai: false,
  zai: false,
};

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

function isAuthOnlyRoute(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

function normalizeCameraId(value: unknown): number | null {
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

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, isPending: isAuthPending } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingUserId = user?.id || null;
  const onboardingStorageKey = useMemo(
    () => getOnboardingStorageKey(onboardingUserId),
    [onboardingUserId]
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus>("never_started");
  const [currentStepId, setCurrentStepId] = useState<OnboardingStepId | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<OnboardingProviderKind | null>(null);
  const [tutorialCameraId, setTutorialCameraId] = useState<number | null>(null);
  const [tutorialAgentId, setTutorialAgentId] = useState<number | null>(null);
  const [tutorialProceedWithoutWebcam, setTutorialProceedWithoutWebcam] = useState(false);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusMap>(DEFAULT_PROVIDER_STATUS);
  const [inlineMessage, setInlineMessage] = useState("");
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);

  const moveToStep = useCallback((stepId: OnboardingStepId) => {
    setInlineMessage("");
    setStatus("in_progress");
    setCurrentStepId(stepId);
    setIsOpen(true);
  }, []);

  useEffect(() => {
    if (isAuthPending) {
      return;
    }

    const persisted = readOnboardingState(onboardingUserId);
    setStatus(persisted.status);
    setCurrentStepId(persisted.currentStepId);
    setSelectedProvider(persisted.selectedProvider);
    setTutorialCameraId(persisted.tutorialCameraId);
    setTutorialAgentId(persisted.tutorialAgentId);
    setTutorialProceedWithoutWebcam(persisted.tutorialProceedWithoutWebcam);
    if (persisted.status === "in_progress" && persisted.currentStepId) {
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
    setLoadedStorageKey(onboardingStorageKey);
    setIsHydrated(true);
  }, [isAuthPending, onboardingStorageKey, onboardingUserId]);

  useEffect(() => {
    if (!isHydrated || loadedStorageKey !== onboardingStorageKey) {
      return;
    }

    writeOnboardingState({
      version: 1,
      status,
      currentStepId,
      selectedProvider,
      tutorialCameraId,
      tutorialAgentId,
      tutorialProceedWithoutWebcam,
    }, onboardingUserId);
  }, [
    currentStepId,
    isHydrated,
    loadedStorageKey,
    onboardingStorageKey,
    onboardingUserId,
    selectedProvider,
    status,
    tutorialAgentId,
    tutorialCameraId,
    tutorialProceedWithoutWebcam,
  ]);

  useEffect(() => {
    if (
      !isHydrated ||
      isOpen ||
      status !== "never_started" ||
      isAuthOnlyRoute(location.pathname) ||
      user?.requires_secret_recovery_setup
    ) {
      return;
    }

    moveToStep("welcome");
  }, [
    isHydrated,
    isOpen,
    location.pathname,
    moveToStep,
    status,
    user?.requires_secret_recovery_setup,
  ]);

  useEffect(() => {
    if (!isOpen || !currentStepId || user?.requires_secret_recovery_setup) {
      return;
    }

    const route = getOnboardingRoute(currentStepId, tutorialCameraId);
    if (!route || location.pathname === route) {
      return;
    }

    navigate(route, { replace: true });
  }, [currentStepId, isOpen, location.pathname, navigate, tutorialCameraId, user?.requires_secret_recovery_setup]);

  useEffect(() => {
    if (!isOpen || !selectedProvider || !providerStatus[selectedProvider]) {
      return;
    }

    if (
      currentStepId !== "provider-open" &&
      currentStepId !== "provider-input" &&
      currentStepId !== "provider-save"
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      moveToStep("camera-placeholder");
    }, 420);

    return () => window.clearTimeout(timeoutId);
  }, [currentStepId, isOpen, moveToStep, providerStatus, selectedProvider]);

  const refreshProviderStatus = useCallback(async (): Promise<ProviderStatusMap> => {
    const readHasKey = async (url: string): Promise<boolean | null> => {
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) {
          return null;
        }

        const data = await response.json().catch(() => ({}));
        return Boolean((data as { has_key?: unknown }).has_key);
      } catch {
        return null;
      }
    };

    const [nextOpenAi, nextZAi] = await Promise.all([
      readHasKey("/api/openai-settings"),
      readHasKey("/api/zai-settings"),
    ]);

    const nextStatus = {
      openai: nextOpenAi ?? providerStatus.openai,
      zai: nextZAi ?? providerStatus.zai,
    };

    setProviderStatus((current) =>
      current.openai === nextStatus.openai && current.zai === nextStatus.zai ? current : nextStatus
    );
    return nextStatus;
  }, [providerStatus.openai, providerStatus.zai]);

  const syncProviderStatus = useCallback((nextStatus: Partial<ProviderStatusMap>) => {
    setProviderStatus((current) => {
      const merged = {
        ...current,
        ...nextStatus,
      };

      if (merged.openai === current.openai && merged.zai === current.zai) {
        return current;
      }

      return merged;
    });
  }, []);

  const startTutorial = useCallback(() => {
    setSelectedProvider(null);
    setTutorialCameraId(null);
    setTutorialAgentId(null);
    setTutorialProceedWithoutWebcam(false);
    moveToStep("welcome");
  }, [moveToStep]);

  const closeTutorial = useCallback(() => {
    setInlineMessage("");
    setIsOpen(false);
    setCurrentStepId(null);
    setSelectedProvider(null);
    setTutorialCameraId(null);
    setTutorialAgentId(null);
    setTutorialProceedWithoutWebcam(false);
    setStatus((current) => (current === "completed" ? current : "dismissed"));
  }, []);

  const finishTutorial = useCallback(() => {
    setInlineMessage("");
    setIsOpen(false);
    setCurrentStepId(null);
    setSelectedProvider(null);
    setTutorialCameraId(null);
    setTutorialAgentId(null);
    setTutorialProceedWithoutWebcam(false);
    setStatus("completed");
  }, []);

  const completeCameraTutorial = useCallback((cameraId?: number | null) => {
    setInlineMessage("");
    setTutorialCameraId((current) => normalizeCameraId(cameraId) ?? current);
    setTutorialAgentId(null);
    moveToStep("agent-intro");
  }, [moveToStep]);

  const completeAgentTutorial = useCallback((agentId?: number | null) => {
    setInlineMessage("");
    setTutorialAgentId((current) => normalizeCameraId(agentId) ?? current);
    moveToStep("agent-toggle");
  }, [moveToStep]);

  const updateTutorialProceedWithoutWebcam = useCallback((value: boolean) => {
    setTutorialProceedWithoutWebcam(value);
  }, []);

  const chooseProvider = useCallback(
    async (provider: OnboardingProviderKind) => {
      setSelectedProvider(provider);
      setInlineMessage("");
      const nextStatus = await refreshProviderStatus();
      if (nextStatus[provider]) {
        moveToStep("camera-placeholder");
        return;
      }

      moveToStep("provider-open");
    },
    [moveToStep, refreshProviderStatus]
  );

  const next = useCallback(async () => {
    setInlineMessage("");

    switch (currentStepId) {
      case "welcome":
        moveToStep("settings-zai-card");
        return;
      case "settings-zai-card":
        moveToStep("settings-openai-card");
        return;
      case "settings-openai-card":
        moveToStep("settings-provider-choice");
        return;
      case "provider-open":
        moveToStep("provider-input");
        return;
      case "provider-input":
        moveToStep("provider-save");
        return;
      case "provider-save": {
        if (!selectedProvider) {
          moveToStep("settings-provider-choice");
          return;
        }

        const nextStatus = await refreshProviderStatus();
        if (nextStatus[selectedProvider]) {
          moveToStep("camera-placeholder");
          return;
        }

        setInlineMessage(i18n.t("tutorial.providerSave.missingKeyHint"));
        return;
      }
      case "camera-placeholder":
        moveToStep("camera-scan-network");
        return;
      case "camera-scan-network":
        moveToStep("camera-import");
        return;
      case "camera-import":
        moveToStep("camera-register");
        return;
      case "camera-register":
        moveToStep("camera-rtsp-form");
        return;
      case "camera-rtsp-form":
        moveToStep("camera-address");
        return;
      case "camera-address":
        moveToStep("camera-storage");
        return;
      case "camera-storage":
        moveToStep("camera-webcam-form");
        return;
      case "camera-webcam-form":
        moveToStep("camera-webcam-save");
        return;
      case "camera-webcam-save":
        return;
      case "agent-intro":
        moveToStep("agent-create");
        return;
      case "agent-create":
        moveToStep("agent-model");
        return;
      case "agent-model":
        moveToStep("agent-input-type");
        return;
      case "agent-input-type":
        moveToStep("agent-fields");
        return;
      case "agent-fields":
        moveToStep("agent-enhance");
        return;
      case "agent-enhance":
        moveToStep("agent-polygons");
        return;
      case "agent-polygons":
        moveToStep("agent-execution");
        return;
      case "agent-execution":
        moveToStep("agent-save");
        return;
      case "agent-save":
        return;
      case "agent-toggle":
        moveToStep("ai-agents-camera-start");
        return;
      case "ai-agents-camera-start":
        moveToStep("complete");
        return;
      case "complete":
        finishTutorial();
        return;
      default:
        return;
    }
  }, [currentStepId, finishTutorial, moveToStep, refreshProviderStatus, selectedProvider]);

  const back = useCallback(() => {
    setInlineMessage("");

    switch (currentStepId) {
      case "settings-zai-card":
        moveToStep("welcome");
        return;
      case "settings-openai-card":
        moveToStep("settings-zai-card");
        return;
      case "settings-provider-choice":
        moveToStep("settings-openai-card");
        return;
      case "provider-open":
        moveToStep("settings-provider-choice");
        return;
      case "provider-input":
        moveToStep("provider-open");
        return;
      case "provider-save":
        moveToStep("provider-input");
        return;
      case "camera-placeholder":
        moveToStep("settings-provider-choice");
        return;
      case "camera-scan-network":
        moveToStep("camera-placeholder");
        return;
      case "camera-import":
        moveToStep("camera-scan-network");
        return;
      case "camera-register":
        moveToStep("camera-import");
        return;
      case "camera-rtsp-form":
        moveToStep("camera-register");
        return;
      case "camera-address":
        moveToStep("camera-rtsp-form");
        return;
      case "camera-storage":
        moveToStep("camera-address");
        return;
      case "camera-webcam-form":
        moveToStep("camera-storage");
        return;
      case "camera-webcam-save":
        moveToStep("camera-webcam-form");
        return;
      case "agent-intro":
        moveToStep("camera-webcam-save");
        return;
      case "agent-create":
        moveToStep("agent-intro");
        return;
      case "agent-model":
        moveToStep("agent-create");
        return;
      case "agent-input-type":
        moveToStep("agent-model");
        return;
      case "agent-fields":
        moveToStep("agent-input-type");
        return;
      case "agent-enhance":
        moveToStep("agent-fields");
        return;
      case "agent-polygons":
        moveToStep("agent-enhance");
        return;
      case "agent-execution":
        moveToStep("agent-polygons");
        return;
      case "agent-save":
        moveToStep("agent-execution");
        return;
      case "agent-toggle":
        moveToStep("agent-save");
        return;
      case "ai-agents-camera-start":
        moveToStep("agent-toggle");
        return;
      case "complete":
        moveToStep("ai-agents-camera-start");
        return;
      default:
        return;
    }
  }, [currentStepId, moveToStep]);

  const clearInlineMessage = useCallback(() => {
    setInlineMessage("");
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      isHydrated,
      isOpen,
      status,
      currentStepId,
      selectedProvider,
      tutorialCameraId,
      tutorialAgentId,
      tutorialProceedWithoutWebcam,
      providerStatus,
      inlineMessage,
      startTutorial,
      closeTutorial,
      finishTutorial,
      completeCameraTutorial,
      completeAgentTutorial,
      setTutorialProceedWithoutWebcam: updateTutorialProceedWithoutWebcam,
      next,
      back,
      chooseProvider,
      syncProviderStatus,
      refreshProviderStatus,
      clearInlineMessage,
    }),
    [
      back,
      chooseProvider,
      clearInlineMessage,
      closeTutorial,
      completeCameraTutorial,
      completeAgentTutorial,
      currentStepId,
      finishTutorial,
      inlineMessage,
      isHydrated,
      isOpen,
      next,
      providerStatus,
      refreshProviderStatus,
      selectedProvider,
      startTutorial,
      status,
      syncProviderStatus,
      tutorialAgentId,
      tutorialCameraId,
      tutorialProceedWithoutWebcam,
      updateTutorialProceedWithoutWebcam,
    ]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }

  return context;
}

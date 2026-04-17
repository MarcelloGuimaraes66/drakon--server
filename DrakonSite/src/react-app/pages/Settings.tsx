import { useState, useEffect, useRef } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
import SettingsTabs, {
  type SettingsTabView,
} from "@/react-app/components/settings/SettingsTabs";
import { useOnboarding } from "@/react-app/hooks/useOnboarding";
import { ONBOARDING_TARGETS } from "@/react-app/lib/onboarding";
import { brand } from "@/shared/brand";
import {
  User,
  Link2,
  Copy,
  CheckCircle,
  Loader2,
  AlertCircle,
  Send,
  KeyRound,
  ChevronDown,
  ChevronRight,
  Clock3,
  ExternalLink,
  Sparkles,
  X,
} from "lucide-react";

interface PairingStatus {
  status: "not_connected" | "connected";
  client_id?: string;
  exe_id?: string;
  paired_at?: string;
  timezone_iana?: string;
  timezone_updated_at?: string | null;
}

interface AccountDeletionPreviewSection {
  key: string;
  count: number;
}

interface AccountDeletionPreviewSummary {
  total_records: number;
  storage_object_count?: number;
  sections: AccountDeletionPreviewSection[];
}

interface AccountDeletionPreviewPayload {
  confirmation_email: string;
  requires_password: boolean;
  local: AccountDeletionPreviewSummary;
  remote: {
    configured: boolean;
    linked: boolean;
    unavailable_reason: string | null;
    preview: AccountDeletionPreviewSummary & {
      already_deleted?: boolean;
    };
  };
}

type DesktopWebViewBridge = {
  postMessage?: (message: unknown) => void;
};

type DesktopShellWindow = Window & {
  chrome?: {
    webview?: DesktopWebViewBridge;
  };
  __drakonDesktopShell?: boolean;
};

function deriveHandleFromEmail(email?: string | null): string {
  if (typeof email !== "string") {
    return "";
  }

  const trimmed = email.trim();
  const atIndex = trimmed.indexOf("@");
  return atIndex > 0 ? trimmed.slice(0, atIndex) : "";
}

function normalizeHandleInput(value: string): string {
  return value.replace(/@/g, "").trim();
}

function requestDesktopAccountDeletionCleanup(clearStorageRoot: boolean): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const desktopWindow = window as DesktopShellWindow;
  const webview = desktopWindow.chrome?.webview;
  if (
    desktopWindow.__drakonDesktopShell !== true &&
    !(desktopWindow.chrome && typeof webview !== "undefined")
  ) {
    return false;
  }

  if (!webview || typeof webview.postMessage !== "function") {
    return false;
  }

  try {
    webview.postMessage({
      type: "account-delete-cleanup",
      clear_storage_root: clearStorageRoot,
    });
    return true;
  } catch (error) {
    console.warn("Failed to request desktop AppData cleanup after account deletion:", error);
    return false;
  }
}

export default function Settings() {
  const openAiKeysUrl = "https://platform.openai.com/api-keys";
  const zAiKeysUrl = "https://z.ai/manage-apikey/apikey-list";
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const {
    startTutorial,
    status: onboardingStatus,
    syncProviderStatus,
    currentStepId,
  } = useOnboarding();
  const location = useLocation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTabView>("user");
  const [pairCode, setPairCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedConnectionField, setCopiedConnectionField] = useState<"client" | "exe" | null>(null);
  const [isQuickInstructionsOpen, setIsQuickInstructionsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pairingStatus, setPairingStatus] = useState<PairingStatus>({ status: "not_connected" });
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savedHandle, setSavedHandle] = useState("");
  const [handleInput, setHandleInput] = useState("");
  const [handleSaving, setHandleSaving] = useState(false);
  const [handleMessage, setHandleMessage] = useState("");
  const [handleMessageType, setHandleMessageType] = useState<"success" | "error" | null>(null);

  // Telegram settings state
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [openAiKeyPreview, setOpenAiKeyPreview] = useState("");
  const [openAiHasKey, setOpenAiHasKey] = useState(false);
  const [openAiKeyInput, setOpenAiKeyInput] = useState("");
  const [openAiLoading, setOpenAiLoading] = useState(true);
  const [openAiSaving, setOpenAiSaving] = useState(false);
  const [openAiMessage, setOpenAiMessage] = useState("");
  const [openAiMessageType, setOpenAiMessageType] = useState<"success" | "error" | null>(null);
  const [zAiKeyPreview, setZAiKeyPreview] = useState("");
  const [zAiHasKey, setZAiHasKey] = useState(false);
  const [zAiKeyInput, setZAiKeyInput] = useState("");
  const [zAiLoading, setZAiLoading] = useState(true);
  const [zAiSaving, setZAiSaving] = useState(false);
  const [zAiMessage, setZAiMessage] = useState("");
  const [zAiMessageType, setZAiMessageType] = useState<"success" | "error" | null>(null);
  const [highlightOpenAiCard, setHighlightOpenAiCard] = useState(false);
  const [highlightZAiCard, setHighlightZAiCard] = useState(false);
  const openAiCardRef = useRef<HTMLDivElement | null>(null);
  const zAiCardRef = useRef<HTMLDivElement | null>(null);
  const [accountDeletionPreview, setAccountDeletionPreview] =
    useState<AccountDeletionPreviewPayload | null>(null);
  const [accountDeletionLoading, setAccountDeletionLoading] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState("");
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteAccountMessage, setDeleteAccountMessage] = useState("");
  const [deleteAccountMessageType, setDeleteAccountMessageType] = useState<
    "success" | "error" | null
  >(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [isDeleteAccountModalOpen, setIsDeleteAccountModalOpen] = useState(false);
  const [showDeleteAccountDetails, setShowDeleteAccountDetails] = useState(false);

  const selectSettingsTab = (tab: SettingsTabView) => {
    setActiveTab(tab);
    const nextPath = tab === "alerts" ? "/settings/alerts" : "/settings";
    navigate(nextPath);
  };

  const fetchPairingStatus = async () => {
    try {
      const response = await fetch("/api/pairing/status");
      if (response.ok) {
        const data = await response.json();
        setPairingStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch pairing status:", error);
    } finally {
      setLoadingStatus(false);
    }
  };

  const generatePairCode = async () => {
    setGenerating(true);
    try {
      const response = await fetch("/api/pairing/generate", {
        method: "POST",
      });
      if (response.ok) {
        const data = await response.json();
        setPairCode(data.pair_code);
        setExpiresAt(data.expires_at);
      }
    } catch (error) {
      console.error("Failed to generate pair code:", error);
    } finally {
      setGenerating(false);
    }
  };

  const copyPairCode = () => {
    navigator.clipboard.writeText(pairCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyConnectionValue = async (
    field: "client" | "exe",
    value?: string
  ) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedConnectionField(field);
      setTimeout(() => setCopiedConnectionField(null), 1800);
    } catch (error) {
      console.error("Failed to copy connection value:", error);
    }
  };

  const disconnectExe = async () => {
    try {
      await fetch("/api/pairing/disconnect", {
        method: "POST",
      });
      setPairCode("");
      setExpiresAt("");
      await fetchPairingStatus();
    } catch (error) {
      console.error("Failed to disconnect:", error);
    }
  };

  const getTimeRemaining = () => {
    if (!expiresAt) return "";
    const now = new Date().getTime();
    const expiry = new Date(expiresAt).getTime();
    const diff = expiry - now;
    
    if (diff <= 0) return "Expired";
    
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const fetchTelegramSettings = async () => {
    setTelegramLoading(true);
    try {
      const response = await fetch("/api/telegram-settings");
      if (response.ok) {
        const data = await response.json();
        setTelegramEnabled(!!data.enabled);
        setTelegramChatId(data.chat_id || "");
        setTelegramBotToken(data.bot_token || "");
      }
    } catch (error) {
      console.error("Failed to fetch Telegram settings:", error);
    } finally {
      setTelegramLoading(false);
    }
  };

  const fetchOpenAiSettings = async () => {
    setOpenAiLoading(true);
    try {
      const response = await fetch("/api/openai-settings");
      if (response.ok) {
        const data = await response.json();
        setOpenAiHasKey(!!data?.has_key);
        setOpenAiKeyPreview(typeof data?.api_key_preview === "string" ? data.api_key_preview : "");
      }
    } catch (error) {
      console.error("Failed to fetch OpenAI settings:", error);
    } finally {
      setOpenAiLoading(false);
    }
  };

  const fetchZAiSettings = async () => {
    setZAiLoading(true);
    try {
      const response = await fetch("/api/zai-settings");
      if (response.ok) {
        const data = await response.json();
        setZAiHasKey(!!data?.has_key);
        setZAiKeyPreview(typeof data?.api_key_preview === "string" ? data.api_key_preview : "");
      }
    } catch (error) {
      console.error("Failed to fetch Z.ai settings:", error);
    } finally {
      setZAiLoading(false);
    }
  };

  const saveOpenAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openAiKeyInput.trim()) {
      setOpenAiMessageType("error");
      setOpenAiMessage(t("settings.apiKeys.validation.enter", { provider: openAiProviderLabel }));
      return;
    }

    setOpenAiSaving(true);
    setOpenAiMessage("");
    setOpenAiMessageType(null);
    try {
      const response = await fetch("/api/openai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: openAiKeyInput.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || t("settings.apiKeys.validation.saveFailed", { provider: openAiProviderLabel })
        );
      }

      setOpenAiHasKey(!!data?.has_key);
      setOpenAiKeyPreview(typeof data?.api_key_preview === "string" ? data.api_key_preview : "");
      setOpenAiKeyInput("");
      setOpenAiMessageType("success");
      setOpenAiMessage(t("settings.apiKeys.messages.saved", { provider: openAiProviderLabel }));
    } catch (error: any) {
      setOpenAiMessageType("error");
      setOpenAiMessage(
        error?.message || t("settings.apiKeys.validation.saveFailed", { provider: openAiProviderLabel })
      );
    } finally {
      setOpenAiSaving(false);
    }
  };

  const clearOpenAiSettings = async () => {
    setOpenAiSaving(true);
    setOpenAiMessage("");
    setOpenAiMessageType(null);
    try {
      const response = await fetch("/api/openai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || t("settings.apiKeys.validation.removeFailed", { provider: openAiProviderLabel })
        );
      }

      setOpenAiHasKey(false);
      setOpenAiKeyPreview("");
      setOpenAiKeyInput("");
      setOpenAiMessageType("success");
      setOpenAiMessage(t("settings.apiKeys.messages.removed", { provider: openAiProviderLabel }));
    } catch (error: any) {
      setOpenAiMessageType("error");
      setOpenAiMessage(
        error?.message || t("settings.apiKeys.validation.removeFailed", { provider: openAiProviderLabel })
      );
    } finally {
      setOpenAiSaving(false);
    }
  };

  const saveZAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zAiKeyInput.trim()) {
      setZAiMessageType("error");
      setZAiMessage(t("settings.apiKeys.validation.enter", { provider: zAiProviderLabel }));
      return;
    }

    setZAiSaving(true);
    setZAiMessage("");
    setZAiMessageType(null);
    try {
      const response = await fetch("/api/zai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: zAiKeyInput.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || t("settings.apiKeys.validation.saveFailed", { provider: zAiProviderLabel })
        );
      }

      setZAiHasKey(!!data?.has_key);
      setZAiKeyPreview(typeof data?.api_key_preview === "string" ? data.api_key_preview : "");
      setZAiKeyInput("");
      setZAiMessageType("success");
      setZAiMessage(t("settings.apiKeys.messages.saved", { provider: zAiProviderLabel }));
    } catch (error: any) {
      setZAiMessageType("error");
      setZAiMessage(
        error?.message || t("settings.apiKeys.validation.saveFailed", { provider: zAiProviderLabel })
      );
    } finally {
      setZAiSaving(false);
    }
  };

  const clearZAiSettings = async () => {
    setZAiSaving(true);
    setZAiMessage("");
    setZAiMessageType(null);
    try {
      const response = await fetch("/api/zai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || t("settings.apiKeys.validation.removeFailed", { provider: zAiProviderLabel })
        );
      }

      setZAiHasKey(false);
      setZAiKeyPreview("");
      setZAiKeyInput("");
      setZAiMessageType("success");
      setZAiMessage(t("settings.apiKeys.messages.removed", { provider: zAiProviderLabel }));
    } catch (error: any) {
      setZAiMessageType("error");
      setZAiMessage(
        error?.message || t("settings.apiKeys.validation.removeFailed", { provider: zAiProviderLabel })
      );
    } finally {
      setZAiSaving(false);
    }
  };

  const saveTelegramSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setTelegramSaving(true);
    try {
      const response = await fetch("/api/telegram-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: telegramEnabled,
          chat_id: telegramChatId,
          bot_token: telegramBotToken,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save settings");
      }

      const saved = await response.json();

      // Keep UI in sync with backend response
      setTelegramEnabled(!!saved.enabled);
      setTelegramChatId(saved.chat_id || "");
      setTelegramBotToken(saved.bot_token || "");
    } catch (error: any) {
      console.error("Failed to save Telegram settings:", error);
    } finally {
      setTelegramSaving(false);
    }
  };

  const saveUserHandle = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedHandle = normalizeHandleInput(handleInput);
    if (!normalizedHandle) {
      setHandleMessageType("error");
      setHandleMessage(t("settings.handleRequired"));
      return;
    }

    if (/\s/.test(normalizedHandle)) {
      setHandleMessageType("error");
      setHandleMessage(t("settings.handleInvalid"));
      return;
    }

    setHandleSaving(true);
    setHandleMessage("");
    setHandleMessageType(null);

    try {
      const response = await fetch("/api/user-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: normalizedHandle }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t("settings.handleSaveFailed"));
      }

      const nextHandle =
        typeof data?.handle === "string" && data.handle.trim()
          ? data.handle
          : normalizedHandle;
      setSavedHandle(nextHandle);
      setHandleInput(nextHandle);
      setHandleMessageType("success");
      setHandleMessage(t("settings.handleSaved"));
    } catch (error: any) {
      setHandleMessageType("error");
      setHandleMessage(error?.message || t("settings.handleSaveFailed"));
    } finally {
      setHandleSaving(false);
    }
  };

  const fetchAccountDeletionPreview = async () => {
    if (!user?.email) {
      setAccountDeletionPreview(null);
      setAccountDeletionError("");
      return;
    }

    setAccountDeletionLoading(true);
    setAccountDeletionError("");
    try {
      const response = await fetch("/api/account/deletion-preview");
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.error || t("settings.deleteAccount.previewFailed"));
      }

      setAccountDeletionPreview(data as AccountDeletionPreviewPayload);
    } catch (error: any) {
      setAccountDeletionPreview(null);
      setAccountDeletionError(
        error?.message || t("settings.deleteAccount.previewFailed")
      );
    } finally {
      setAccountDeletionLoading(false);
    }
  };

  const resetDeleteAccountForm = () => {
    setDeleteConfirmEmail("");
    setDeleteConfirmationText("");
    setDeletePassword("");
    setDeleteAccountMessage("");
    setDeleteAccountMessageType(null);
  };

  const openDeleteAccountModal = () => {
    resetDeleteAccountForm();
    setShowDeleteAccountDetails(false);
    setIsDeleteAccountModalOpen(true);
  };

  const closeDeleteAccountModal = () => {
    if (deletingAccount) {
      return;
    }

    resetDeleteAccountForm();
    setShowDeleteAccountDetails(false);
    setIsDeleteAccountModalOpen(false);
  };

  const deleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountDeletionPreview) {
      return;
    }

    let holdDeletingState = false;
    setDeletingAccount(true);
    setDeleteAccountMessage("");
    setDeleteAccountMessageType(null);
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm_email: deleteConfirmEmail.trim(),
          confirmation_text: deleteConfirmationText.trim(),
          ...(accountDeletionPreview.requires_password
            ? { password: deletePassword }
            : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || t("settings.deleteAccount.errorDefault"));
      }

      setDeleteAccountMessageType("success");
      const redirectPath =
        typeof data?.redirect_path === "string" && data.redirect_path.trim()
          ? data.redirect_path
          : "/login?accountDeleted=1";
      const clearStorageRoot = Boolean(data?.desktop_cleanup?.clear_storage_root);
      if (requestDesktopAccountDeletionCleanup(clearStorageRoot)) {
        holdDeletingState = true;
        setDeleteAccountMessage(t("settings.deleteAccount.desktopCleanup", {
          brand: brand.displayName,
        }));
        window.setTimeout(() => {
          window.location.assign(redirectPath);
        }, 5000);
        return;
      }

      setDeleteAccountMessage(t("settings.deleteAccount.deleting"));
      window.location.assign(redirectPath);
    } catch (error: any) {
      setDeleteAccountMessageType("error");
      setDeleteAccountMessage(
        error?.message || t("settings.deleteAccount.errorDefault")
      );
    } finally {
      if (!holdDeletingState) {
        setDeletingAccount(false);
      }
    }
  };

  useEffect(() => {
    fetchPairingStatus();
    fetchTelegramSettings();
    fetchOpenAiSettings();
    fetchZAiSettings();
  }, []);

  useEffect(() => {
    if (isDeleteAccountModalOpen && user?.email) {
      fetchAccountDeletionPreview();
    }
  }, [isDeleteAccountModalOpen, user?.email]);

  useEffect(() => {
    if (!isDeleteAccountModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deletingAccount) {
        closeDeleteAccountModal();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDeleteAccountModalOpen, deletingAccount]);

  useEffect(() => {
    const initialHandle =
      (typeof user?.handle === "string" && user.handle.trim()) ||
      deriveHandleFromEmail(user?.email);
    setSavedHandle(initialHandle);
    setHandleInput(initialHandle);
    setHandleMessage("");
    setHandleMessageType(null);
    setDeleteConfirmEmail("");
    setDeleteConfirmationText("");
    setDeletePassword("");
    setDeleteAccountMessage("");
    setDeleteAccountMessageType(null);
    setIsDeleteAccountModalOpen(false);
    setShowDeleteAccountDetails(false);
    setAccountDeletionPreview(null);
    setAccountDeletionError("");
  }, [user?.email, user?.handle]);

  const accountCreatedRaw = (user as { created_at?: string } | null)?.created_at || "";
  const accountCreatedValue = (() => {
    if (!accountCreatedRaw) return "";
    const parsedDate = new Date(accountCreatedRaw);
    if (Number.isNaN(parsedDate.getTime())) {
      return accountCreatedRaw;
    }
    return new Intl.DateTimeFormat(i18n.language || "en", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsedDate);
  })();
  const normalizedHandleValue = normalizeHandleInput(handleInput);
  const isHandleDirty = normalizedHandleValue !== savedHandle;
  const isHandleValid = normalizedHandleValue.length > 0 && !/\s/.test(normalizedHandleValue);
  const zAiProviderLabel = t("settings.apiKeys.providers.zai");
  const openAiProviderLabel = t("settings.apiKeys.providers.openai");
  const tutorialButtonLabel =
    onboardingStatus === "never_started"
      ? t("tutorial.settingsCard.start")
      : t("tutorial.settingsCard.reopen");
  const normalizedDeleteConfirmEmail = deleteConfirmEmail.trim().toLowerCase();
  const expectedDeleteEmail =
    accountDeletionPreview?.confirmation_email?.trim().toLowerCase() ||
    (typeof user?.email === "string" ? user.email.trim().toLowerCase() : "");
  const deletePhraseMatches = deleteConfirmationText.trim().toUpperCase() === "DELETE";
  const deleteEmailMatches =
    !!expectedDeleteEmail && normalizedDeleteConfirmEmail === expectedDeleteEmail;
  const deleteRequiresPassword = !!accountDeletionPreview?.requires_password;
  const remoteDeletionBlocked = Boolean(
    accountDeletionPreview?.remote.linked &&
      accountDeletionPreview.remote.unavailable_reason
  );
  const deleteAccountDisabled =
    deletingAccount ||
    accountDeletionLoading ||
    !accountDeletionPreview ||
    !deleteEmailMatches ||
    !deletePhraseMatches ||
    remoteDeletionBlocked ||
    (deleteRequiresPassword && !deletePassword.trim());

  const getDeletionSectionLabel = (key: string) => {
    switch (key) {
      case "credentials":
        return t("settings.deleteAccount.section.credentials");
      case "sessions":
        return t("settings.deleteAccount.section.sessions");
      case "pairings":
        return t("settings.deleteAccount.section.pairings");
      case "cameras":
        return t("settings.deleteAccount.section.cameras");
      case "jobs":
        return t("settings.deleteAccount.section.jobs");
      case "chat":
        return t("settings.deleteAccount.section.chat");
      case "events":
        return t("settings.deleteAccount.section.events");
      case "api_keys":
        return t("settings.deleteAccount.section.apiKeys");
      case "face_targets":
        return t("settings.deleteAccount.section.faceTargets");
      case "drakon_find":
        return t("settings.deleteAccount.section.drakonFind");
      case "shared_find":
        return t("settings.deleteAccount.section.sharedFind");
      case "hub":
        return t("settings.deleteAccount.section.hub");
      case "uploads":
        return t("settings.deleteAccount.section.uploads");
      case "billing":
        return t("settings.deleteAccount.section.billing");
      case "monitoring":
        return t("settings.deleteAccount.section.monitoring");
      case "device_sessions":
        return t("settings.deleteAccount.section.deviceSessions");
      case "find_shares":
        return t("settings.deleteAccount.section.findShares");
      default:
        return key.replace(/_/g, " ");
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focus = params.get("focus");
    if (location.pathname === "/settings/alerts" || params.get("tab") === "alerts") {
      setActiveTab("alerts");
      return;
    }
    if (focus === "openai") {
      setActiveTab("api-keys");
      setHighlightOpenAiCard(true);
      const frameId = window.requestAnimationFrame(() => {
        openAiCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const timeoutId = window.setTimeout(() => {
        setHighlightOpenAiCard(false);
      }, 4200);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(timeoutId);
      };
    }
    if (focus === "zai") {
      setActiveTab("api-keys");
      setHighlightZAiCard(true);
      const frameId = window.requestAnimationFrame(() => {
        zAiCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      const timeoutId = window.setTimeout(() => {
        setHighlightZAiCard(false);
      }, 4200);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.clearTimeout(timeoutId);
      };
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (
      currentStepId === "settings-zai-card" ||
      currentStepId === "settings-openai-card" ||
      currentStepId === "settings-provider-choice" ||
      currentStepId === "provider-open" ||
      currentStepId === "provider-input" ||
      currentStepId === "provider-save"
    ) {
      setActiveTab("api-keys");
    }
  }, [currentStepId]);

  // Poll for pairing status when code is generated
  useEffect(() => {
    if (!pairCode) return;

    const interval = setInterval(() => {
      fetchPairingStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [pairCode]);

  // Clear pair code when connected
  useEffect(() => {
    if (pairingStatus.status === "connected") {
      setPairCode("");
      setExpiresAt("");
    }
  }, [pairingStatus.status]);

  useEffect(() => {
    syncProviderStatus({
      openai: openAiHasKey,
      zai: zAiHasKey,
    });
  }, [openAiHasKey, syncProviderStatus, zAiHasKey]);

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),auto,minmax(0,1fr)] xl:items-start">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-100">{t("settings.title")}</h1>
            <p className="mt-1.5 text-sm text-gray-400">{t("settings.subtitle")}</p>
          </div>
          <div className="flex justify-center xl:justify-self-center">
            <SettingsTabs
              activeView={activeTab}
              onSelectUser={() => selectSettingsTab("user")}
              onSelectApiKeys={() => selectSettingsTab("api-keys")}
              onSelectAlerts={() => selectSettingsTab("alerts")}
              onSelectConnectivity={() => selectSettingsTab("connectivity")}
            />
          </div>
          <div className="hidden xl:block" />
        </div>

        <div className="mx-auto w-full max-w-4xl">
          <div className="mb-4 md:mb-6 rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/10 via-slate-900/40 to-cyan-500/10 p-4 md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-blue-200">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-100">{t("tutorial.settingsCard.title")}</p>
                  <p className="mt-1 text-sm text-gray-300">{t("tutorial.settingsCard.description")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => startTutorial("intro")}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-400"
              >
                {tutorialButtonLabel}
              </button>
            </div>
          </div>

          {/* User Profile */}
          {activeTab === "user" && (
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6 mb-4 md:mb-6">
            <div className="flex items-center gap-3 mb-6">
              <User className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-100">
                {t("settings.userProfile")}
              </h2>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("settings.name")}
                </label>
                <input
                  type="text"
                  value={user?.google_user_data?.name || ""}
                  disabled
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("settings.email")}
                </label>
                <input
                  type="email"
                  value={user?.email || ""}
                  disabled
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
              </div>

              <form onSubmit={saveUserHandle} className="space-y-3">
              <label className="block text-sm font-medium text-gray-300">
                {t("settings.handle")}
              </label>
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="flex flex-1 items-center rounded-lg border border-gray-700 bg-gray-800">
                  <span className="px-4 text-gray-400">@</span>
                  <input
                    type="text"
                    value={handleInput}
                    onChange={(e) => {
                      setHandleInput(e.target.value.replace(/@/g, ""));
                      setHandleMessage("");
                      setHandleMessageType(null);
                    }}
                    placeholder={t("settings.handlePlaceholder")}
                    disabled={handleSaving}
                    className="w-full bg-transparent py-2.5 pr-4 text-gray-100 placeholder-gray-500 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <button
                  type="submit"
                  disabled={handleSaving || !isHandleDirty || !isHandleValid}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white transition-colors hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500"
                >
                  {handleSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("settings.handleSaving")}
                    </>
                  ) : (
                    t("settings.handleSave")
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500">{t("settings.handleHelp")}</p>
              {handleMessage ? (
                <p
                  className={`text-xs ${
                    handleMessageType === "success" ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {handleMessage}
                </p>
              ) : null}
            </form>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t("settings.accountCreated")}
              </label>
              <input
                type="text"
                value={accountCreatedValue}
                disabled
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
              />
            </div>

            <div className="mt-6 border-t border-gray-800/80 pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-gray-400">
                    {t("settings.deleteAccount.inlineTitle")}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t("settings.deleteAccount.inlineHint")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openDeleteAccountModal}
                  className="inline-flex min-h-[36px] items-center justify-center self-start rounded-lg px-2 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-rose-300 sm:self-auto"
                >
                  {t("settings.deleteAccount.open")}
                </button>
              </div>
            </div>

            {isDeleteAccountModalOpen ? (
              <div className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6">
                <button
                  type="button"
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={closeDeleteAccountModal}
                  disabled={deletingAccount}
                  aria-label="Close delete account modal"
                />
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="delete-account-modal-title"
                  className="relative max-h-[92vh] w-full max-w-xl overflow-hidden rounded-[28px] border border-gray-800/80 bg-gray-950 text-gray-100 shadow-[0_40px_120px_-48px_rgba(0,0,0,0.95)]"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-gray-800/80 px-6 py-5">
                    <div className="min-w-0">
                      <h3
                        id="delete-account-modal-title"
                        className="text-lg font-semibold text-gray-100"
                      >
                        {t("settings.deleteAccount.title")}
                      </h3>
                      <p className="mt-1 text-sm text-gray-400">
                        {t("settings.deleteAccount.description", {
                          brand: brand.displayName,
                        })}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeDeleteAccountModal}
                      disabled={deletingAccount}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-800 bg-gray-900 text-gray-400 transition-colors hover:border-gray-700 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Close delete account modal"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-6 py-5">
                    <div className="space-y-4">
                      {accountDeletionLoading ? (
                        <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>{t("settings.deleteAccount.loading")}</span>
                        </div>
                      ) : null}

                      {accountDeletionError ? (
                        <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4">
                          <p className="text-sm text-rose-200">{accountDeletionError}</p>
                          <button
                            type="button"
                            onClick={fetchAccountDeletionPreview}
                            className="mt-3 inline-flex min-h-[40px] items-center justify-center rounded-lg border border-rose-300/20 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-100 transition-colors hover:bg-rose-500/20"
                          >
                            {t("settings.deleteAccount.fetchRetry")}
                          </button>
                        </div>
                      ) : null}

                      {accountDeletionPreview ? (
                        <form onSubmit={deleteAccount} className="space-y-4">
                          <div className="rounded-2xl border border-gray-800/80 bg-white/[0.03] p-4">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="min-w-0">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                                  {t("settings.deleteAccount.localData")}
                                </p>
                                <p className="mt-2 text-sm font-medium text-gray-100">
                                  {t("settings.deleteAccount.records", {
                                    count: accountDeletionPreview.local.total_records,
                                  })}
                                </p>
                                <p className="mt-1 text-xs text-gray-500">
                                  {t("settings.deleteAccount.storageObjects", {
                                    count:
                                      accountDeletionPreview.local.storage_object_count || 0,
                                  })}
                                </p>
                              </div>

                              <div className="min-w-0 sm:border-l sm:border-gray-800/80 sm:pl-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                                  {t("settings.deleteAccount.centralData")}
                                </p>
                                {accountDeletionPreview.remote.linked ? (
                                  <p className="mt-2 text-sm font-medium text-gray-100">
                                    {accountDeletionPreview.remote.preview.already_deleted
                                      ? t("settings.deleteAccount.remoteAlreadyDeleted")
                                      : accountDeletionPreview.remote.preview.total_records > 0
                                        ? t("settings.deleteAccount.records", {
                                            count:
                                              accountDeletionPreview.remote.preview.total_records,
                                          })
                                        : t("settings.deleteAccount.remoteNoExtraData")}
                                  </p>
                                ) : (
                                  <p className="mt-2 text-sm text-gray-400">
                                    {t("settings.deleteAccount.localOnly")}
                                  </p>
                                )}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                setShowDeleteAccountDetails((current) => !current)
                              }
                              className="mt-4 inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
                            >
                              {showDeleteAccountDetails ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                              {showDeleteAccountDetails
                                ? t("settings.deleteAccount.hideDetails")
                                : t("settings.deleteAccount.reviewDetails")}
                            </button>

                            {showDeleteAccountDetails ? (
                              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-gray-800/80 bg-black/20 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                                    {t("settings.deleteAccount.localData")}
                                  </p>
                                  <div className="mt-3 space-y-2">
                                    {accountDeletionPreview.local.sections.map((section) => (
                                      <div
                                        key={`local-${section.key}`}
                                        className="flex items-center justify-between gap-4 text-sm"
                                      >
                                        <span className="text-gray-300">
                                          {getDeletionSectionLabel(section.key)}
                                        </span>
                                        <span className="font-medium text-gray-100">
                                          {section.count}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-xl border border-gray-800/80 bg-black/20 p-3">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                                    {t("settings.deleteAccount.centralData")}
                                  </p>
                                  {accountDeletionPreview.remote.linked ? (
                                    accountDeletionPreview.remote.preview.sections.length > 0 ? (
                                      <div className="mt-3 space-y-2">
                                        {accountDeletionPreview.remote.preview.sections.map(
                                          (section) => (
                                            <div
                                              key={`remote-${section.key}`}
                                              className="flex items-center justify-between gap-4 text-sm"
                                            >
                                              <span className="text-gray-300">
                                                {getDeletionSectionLabel(section.key)}
                                              </span>
                                              <span className="font-medium text-gray-100">
                                                {section.count}
                                              </span>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    ) : (
                                      <p className="mt-3 text-sm text-gray-400">
                                        {t("settings.deleteAccount.remoteNoExtraData")}
                                      </p>
                                    )
                                  ) : (
                                    <p className="mt-3 text-sm text-gray-400">
                                      {t("settings.deleteAccount.localOnly")}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </div>

                          {remoteDeletionBlocked ? (
                            <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-4 py-3">
                              <p className="text-sm text-amber-100">
                                {t("settings.deleteAccount.remoteUnavailable")}
                              </p>
                              <p className="mt-1 text-xs text-amber-100/80">
                                {t("settings.deleteAccount.remoteUnavailableReason", {
                                  reason: accountDeletionPreview.remote.unavailable_reason,
                                })}
                              </p>
                            </div>
                          ) : null}

                          <p className="text-sm text-gray-300">
                            {t("settings.deleteAccount.confirmHelp")}
                          </p>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-300">
                                {t("settings.deleteAccount.emailLabel")}
                              </label>
                              <input
                                type="email"
                                value={deleteConfirmEmail}
                                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                                placeholder={accountDeletionPreview.confirmation_email}
                                disabled={deletingAccount}
                                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
                              />
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-300">
                                {t("settings.deleteAccount.confirmTextLabel")}
                              </label>
                              <input
                                type="text"
                                value={deleteConfirmationText}
                                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                                placeholder="DELETE"
                                disabled={deletingAccount}
                                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
                              />
                            </div>
                          </div>

                          {accountDeletionPreview.requires_password ? (
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-300">
                                {t("settings.deleteAccount.passwordLabel")}
                              </label>
                              <input
                                type="password"
                                value={deletePassword}
                                onChange={(e) => setDeletePassword(e.target.value)}
                                disabled={deletingAccount}
                                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50"
                              />
                              <p className="mt-2 text-xs text-gray-500">
                                {t("settings.deleteAccount.passwordHelp")}
                              </p>
                            </div>
                          ) : null}

                          {deleteAccountMessage ? (
                            <p
                              className={`text-sm ${
                                deleteAccountMessageType === "success"
                                  ? "text-emerald-300"
                                  : "text-rose-300"
                              }`}
                            >
                              {deleteAccountMessage}
                            </p>
                          ) : null}

                          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <button
                              type="button"
                              onClick={closeDeleteAccountModal}
                              disabled={deletingAccount}
                              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {t("settings.deleteAccount.cancel")}
                            </button>
                            <button
                              type="submit"
                              disabled={deleteAccountDisabled}
                              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500"
                            >
                              {deletingAccount ? (
                                <>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t("settings.deleteAccount.deleting")}
                                </>
                              ) : (
                                t("settings.deleteAccount.submit")
                              )}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          </div>
        )}

        {/* Connect EXE */}
        {activeTab === "connectivity" && (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Link2 className="w-5 h-5 text-gray-400" />
              <h2 className="text-base font-semibold text-gray-100">
                {t("settings.connectExe")}
              </h2>
            </div>
            {loadingStatus ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading...</span>
              </div>
            ) : (
              <div
                className={`flex items-center gap-2 text-sm font-semibold ${
                  pairingStatus.status === "connected" ? "text-emerald-400" : "text-gray-400"
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full ${
                    pairingStatus.status === "connected"
                      ? "bg-emerald-400 animate-[pulse_2.8s_ease-in-out_infinite]"
                      : "bg-gray-500"
                  }`}
                />
                {pairingStatus.status === "connected"
                  ? t("settings.connected")
                  : t("settings.notConnected")}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {pairingStatus.status === "connected" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="min-w-0 rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
                  <p className="text-xs text-gray-400 mb-2">Client ID</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <p
                      className="min-w-0 flex-1 truncate text-base md:text-lg font-mono tracking-tight text-gray-100"
                      title={pairingStatus.client_id || "-"}
                    >
                      {pairingStatus.client_id || "-"}
                    </p>
                    <button
                      type="button"
                      onClick={() => copyConnectionValue("client", pairingStatus.client_id)}
                      disabled={!pairingStatus.client_id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 bg-gray-800/70 text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Copy Client ID"
                    >
                      {copiedConnectionField === "client" ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="min-w-0 rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
                  <p className="text-xs text-gray-400 mb-2">EXE ID</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <p
                      className="min-w-0 flex-1 truncate text-base md:text-lg font-mono tracking-tight text-gray-100"
                      title={pairingStatus.exe_id || "-"}
                    >
                      {pairingStatus.exe_id || "-"}
                    </p>
                    <button
                      type="button"
                      onClick={() => copyConnectionValue("exe", pairingStatus.exe_id)}
                      disabled={!pairingStatus.exe_id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-700 bg-gray-800/70 text-gray-300 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Copy EXE ID"
                    >
                      {copiedConnectionField === "exe" ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
              <div className="mb-3 flex items-center gap-2 text-gray-400">
                <Clock3 className="w-5 h-5" />
                <span className="text-xs">Timezone</span>
              </div>
              <p className="text-base md:text-lg font-semibold tracking-tight text-gray-100">
                {pairingStatus.timezone_iana || "UTC"}
              </p>
            </div>

            {pairingStatus.status !== "connected" && (
              <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
                <div className="mb-4">
                  <button
                    onClick={generatePairCode}
                    disabled={generating || !!pairCode}
                    className="w-full px-5 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/30 disabled:shadow-none min-h-[44px] flex items-center justify-center gap-2"
                  >
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t("settings.generating")}
                      </>
                    ) : (
                      t("settings.generatePairCode")
                    )}
                  </button>
                </div>

                {pairCode && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-2">
                        {t("settings.pairCodeLabel")}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={pairCode}
                          readOnly
                          className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-gray-100 font-mono text-xl text-center tracking-widest focus:outline-none"
                        />
                        <button
                          onClick={copyPairCode}
                          className="px-4 py-3 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl transition-colors min-h-[44px]"
                        >
                          {copied ? (
                            <CheckCircle className="w-5 h-5 text-green-400" />
                          ) : (
                            <Copy className="w-5 h-5 text-gray-300" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        Expires in: {getTimeRemaining()}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border border-gray-700/50 bg-gray-800/50">
              <button
                type="button"
                onClick={() => setIsQuickInstructionsOpen((prev) => !prev)}
                className="w-full flex items-center gap-3 px-4 py-4 text-left"
              >
                {isQuickInstructionsOpen ? (
                  <ChevronDown className="w-5 h-5 text-gray-300" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-300" />
                )}
                <span className="text-base font-semibold text-gray-100">
                  {t("settings.quickInstructions")}
                </span>
              </button>

              {isQuickInstructionsOpen && (
                <div className="border-t border-gray-800 px-4 pb-4 pt-3 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-8 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-sm font-semibold">
                      1
                    </span>
                    <span className="text-sm text-gray-300">{t("settings.step1")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-8 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-sm font-semibold">
                      2
                    </span>
                    <span className="text-sm text-gray-300">{t("settings.step2")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="h-8 w-8 rounded-full bg-blue-500/20 text-blue-300 flex items-center justify-center text-sm font-semibold">
                      3
                    </span>
                    <span className="text-sm text-gray-300">{t("settings.step3")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                        pairingStatus.status === "connected"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-gray-700 text-gray-300"
                      }`}
                    >
                      {pairingStatus.status === "connected" ? <CheckCircle className="w-5 h-5" /> : "4"}
                    </span>
                    <span
                      className={`text-sm ${
                        pairingStatus.status === "connected" ? "text-emerald-400" : "text-gray-400"
                      }`}
                    >
                      {t("settings.step4")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {pairingStatus.status === "connected" && (
              <button
                onClick={disconnectExe}
                className="w-full px-5 py-3 bg-red-500/15 hover:bg-red-500/20 text-red-400 rounded-xl font-semibold transition-colors border border-red-500/20 text-sm"
              >
                {t("settings.disconnectExe")}
              </button>
            )}
          </div>
          </div>
        )}

        {activeTab === "api-keys" && (
          <>
        {/* Z.ai API Key */}
        <div
          ref={zAiCardRef}
          data-onboarding-target={ONBOARDING_TARGETS.settingsZAiCard}
          className={`bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6 transition-all ${
            highlightZAiCard
              ? "ring-2 ring-cyan-400/80 shadow-[0_0_0_4px_rgba(34,211,238,0.2)] animate-pulse"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-100">
                {t("settings.apiKeys.sectionTitle", { provider: zAiProviderLabel })}
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <a
                href={zAiKeysUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-onboarding-target={ONBOARDING_TARGETS.settingsZAiOpenButton}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/15 hover:text-cyan-200"
              >
                <ExternalLink className="w-4 h-4" />
                {t("settings.apiKeys.openButton", { provider: zAiProviderLabel })}
              </a>
              <span
                className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold border ${
                  zAiLoading
                    ? "border-gray-700 bg-gray-800 text-gray-400"
                    : zAiHasKey
                    ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/20 text-amber-300"
                }`}
              >
                {zAiLoading
                  ? t("settings.apiKeys.status.checking")
                  : zAiHasKey
                    ? t("settings.apiKeys.status.configured")
                    : t("settings.apiKeys.status.notConfigured")}
              </span>
            </div>
          </div>

          {zAiLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : (
            <form onSubmit={saveZAiSettings} className="space-y-4">
              <p className="text-sm text-gray-400">
                {t("settings.apiKeys.needNew", { provider: zAiProviderLabel })}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("settings.apiKeys.storedPreview")}
                </label>
                <input
                  type="text"
                  value={zAiHasKey ? zAiKeyPreview : t("settings.apiKeys.noKeyConfigured")}
                  readOnly
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none"
                />
                <p className="mt-2 text-xs text-gray-500">
                  {t("settings.apiKeys.securityHint")}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("settings.apiKeys.newLabel", { provider: zAiProviderLabel })}
                </label>
                <input
                  type="password"
                  value={zAiKeyInput}
                  onChange={(e) => setZAiKeyInput(e.target.value)}
                  placeholder="zai-..."
                  disabled={zAiSaving}
                  data-onboarding-target={ONBOARDING_TARGETS.settingsZAiInput}
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all disabled:opacity-50"
                />
              </div>

              {zAiMessage ? (
                <p
                  className={`text-xs ${
                    zAiMessageType === "success" ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {zAiMessage}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void clearZAiSettings()}
                  disabled={zAiSaving || !zAiHasKey}
                  className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-gray-100 rounded-lg font-medium transition-colors"
                >
                  {t("settings.apiKeys.remove")}
                </button>
                <button
                  type="submit"
                  disabled={zAiSaving || !zAiKeyInput.trim()}
                  data-onboarding-target={ONBOARDING_TARGETS.settingsZAiSave}
                  className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-cyan-500/30 disabled:shadow-none flex items-center gap-2"
                >
                  {zAiSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("settings.apiKeys.saving")}
                    </>
                  ) : (
                    t("settings.apiKeys.save", { provider: zAiProviderLabel })
                  )}
                </button>
              </div>
            </form>
          )}
        </div>


        {/* OpenAI API Key */}
        <div
          ref={openAiCardRef}
          data-onboarding-target={ONBOARDING_TARGETS.settingsOpenAiCard}
          className={`bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6 mt-4 md:mt-6 transition-all ${
            highlightOpenAiCard
              ? "ring-2 ring-blue-400/80 shadow-[0_0_0_4px_rgba(59,130,246,0.2)] animate-pulse"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-100">
                {t("settings.apiKeys.sectionTitle", { provider: openAiProviderLabel })}
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <a
                href={openAiKeysUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-onboarding-target={ONBOARDING_TARGETS.settingsOpenAiOpenButton}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/15 hover:text-blue-200"
              >
                <ExternalLink className="w-4 h-4" />
                {t("settings.apiKeys.openButton", { provider: openAiProviderLabel })}
              </a>
              <span
                className={`inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold border ${
                  openAiLoading
                    ? "border-gray-700 bg-gray-800 text-gray-400"
                    : openAiHasKey
                    ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                    : "border-amber-500/30 bg-amber-500/20 text-amber-300"
                }`}
              >
                {openAiLoading
                  ? t("settings.apiKeys.status.checking")
                  : openAiHasKey
                    ? t("settings.apiKeys.status.configured")
                    : t("settings.apiKeys.status.notConfigured")}
              </span>
            </div>
          </div>

          {openAiLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
          ) : (
            <form onSubmit={saveOpenAiSettings} className="space-y-4">
              <p className="text-sm text-gray-400">
                {t("settings.apiKeys.needNew", { provider: openAiProviderLabel })}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("settings.apiKeys.storedPreview")}
                </label>
                <input
                  type="text"
                  value={openAiHasKey ? openAiKeyPreview : t("settings.apiKeys.noKeyConfigured")}
                  readOnly
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none"
                />
                <p className="mt-2 text-xs text-gray-500">
                  {t("settings.apiKeys.securityHint")}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {t("settings.apiKeys.newLabel", { provider: openAiProviderLabel })}
                </label>
                <input
                  type="password"
                  value={openAiKeyInput}
                  onChange={(e) => setOpenAiKeyInput(e.target.value)}
                  placeholder="sk-..."
                  disabled={openAiSaving}
                  data-onboarding-target={ONBOARDING_TARGETS.settingsOpenAiInput}
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                />
              </div>

              {openAiMessage ? (
                <p
                  className={`text-xs ${
                    openAiMessageType === "success" ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {openAiMessage}
                </p>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void clearOpenAiSettings()}
                  disabled={openAiSaving || !openAiHasKey}
                  className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-gray-100 rounded-lg font-medium transition-colors"
                >
                  {t("settings.apiKeys.remove")}
                </button>
                <button
                  type="submit"
                  disabled={openAiSaving || !openAiKeyInput.trim()}
                  data-onboarding-target={ONBOARDING_TARGETS.settingsOpenAiSave}
                  className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 disabled:shadow-none flex items-center gap-2"
                >
                  {openAiSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("settings.apiKeys.saving")}
                    </>
                  ) : (
                    t("settings.apiKeys.save", { provider: openAiProviderLabel })
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
          </>
        )}

        {/* Telegram Alerts */}
        {activeTab === "alerts" && (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6">
          <div className="flex items-center gap-3 mb-6">
            <Send className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">Telegram Alerts</h2>
          </div>

            <div className="space-y-6">
              {/* Enable Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                  Enable Telegram Integration
                  </label>
                  <p className="text-xs text-gray-500">
                  Register the Telegram bot and chat used when AI Agents or Job alerts have Telegram delivery enabled.
                  </p>
                </div>
                <button
                onClick={() => setTelegramEnabled(!telegramEnabled)}
                disabled={telegramLoading}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                  telegramEnabled ? "bg-blue-500" : "bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    telegramEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Settings Form */}
            {telegramLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
              </div>
            ) : (
              <form onSubmit={saveTelegramSettings} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Telegram Chat ID
                  </label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    placeholder="e.g. 123456789"
                    disabled={telegramSaving}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Bot Token
                  </label>
                  <input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder="e.g. 123456789:ABC-DEF..."
                    disabled={telegramSaving}
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      telegramSaving ||
                      telegramLoading ||
                      (telegramEnabled &&
                        (!telegramChatId.trim() || !telegramBotToken.trim()))
                    }
                    className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 disabled:shadow-none flex items-center gap-2"
                  >
                    {telegramSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Integration"
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Instructions */}
            <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm text-gray-300">
                  <p className="font-medium text-blue-400">How to get your Chat ID and Bot Token:</p>
                  <p className="text-gray-400">
                    AI Agents only send Telegram for agents whose Telegram icon is enabled. Jobs only send Telegram for steps with a Telegram alert configured.
                  </p>
                  <ol className="space-y-1 list-decimal list-inside text-gray-400">
                    <li>Search for @BotFather in Telegram and create a new bot</li>
                    <li>Copy the Bot Token from BotFather's message</li>
                    <li>Search for @userinfobot in Telegram and start it</li>
                    <li>Copy your Chat ID from the bot's response</li>
                    <li>Enter both values above and enable the integration</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
      </div>
    </Layout>
  );
}





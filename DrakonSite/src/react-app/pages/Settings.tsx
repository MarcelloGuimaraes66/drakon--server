import { useState, useEffect, useRef } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import Layout from "@/react-app/components/Layout";
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
} from "lucide-react";

interface PairingStatus {
  status: "not_connected" | "connected";
  client_id?: string;
  exe_id?: string;
  paired_at?: string;
  timezone_iana?: string;
  timezone_updated_at?: string | null;
}

export default function Settings() {
  const openAiKeysUrl = "https://platform.openai.com/api-keys";
  const zAiKeysUrl = "https://z.ai/manage-apikey/apikey-list";
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const [pairCode, setPairCode] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedConnectionField, setCopiedConnectionField] = useState<"client" | "exe" | null>(null);
  const [isQuickInstructionsOpen, setIsQuickInstructionsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pairingStatus, setPairingStatus] = useState<PairingStatus>({ status: "not_connected" });
  const [loadingStatus, setLoadingStatus] = useState(true);

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
      setOpenAiMessage("Please enter an OpenAI API key.");
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
        throw new Error(data?.error || "Failed to save OpenAI key");
      }

      setOpenAiHasKey(!!data?.has_key);
      setOpenAiKeyPreview(typeof data?.api_key_preview === "string" ? data.api_key_preview : "");
      setOpenAiKeyInput("");
      setOpenAiMessageType("success");
      setOpenAiMessage("OpenAI API key saved.");
    } catch (error: any) {
      setOpenAiMessageType("error");
      setOpenAiMessage(error?.message || "Failed to save OpenAI key");
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
        throw new Error(data?.error || "Failed to remove OpenAI key");
      }

      setOpenAiHasKey(false);
      setOpenAiKeyPreview("");
      setOpenAiKeyInput("");
      setOpenAiMessageType("success");
      setOpenAiMessage("OpenAI API key removed.");
    } catch (error: any) {
      setOpenAiMessageType("error");
      setOpenAiMessage(error?.message || "Failed to remove OpenAI key");
    } finally {
      setOpenAiSaving(false);
    }
  };

  const saveZAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!zAiKeyInput.trim()) {
      setZAiMessageType("error");
      setZAiMessage("Please enter a Z.ai API key.");
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
        throw new Error(data?.error || "Failed to save Z.ai key");
      }

      setZAiHasKey(!!data?.has_key);
      setZAiKeyPreview(typeof data?.api_key_preview === "string" ? data.api_key_preview : "");
      setZAiKeyInput("");
      setZAiMessageType("success");
      setZAiMessage("Z.ai API key saved.");
    } catch (error: any) {
      setZAiMessageType("error");
      setZAiMessage(error?.message || "Failed to save Z.ai key");
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
        throw new Error(data?.error || "Failed to remove Z.ai key");
      }

      setZAiHasKey(false);
      setZAiKeyPreview("");
      setZAiKeyInput("");
      setZAiMessageType("success");
      setZAiMessage("Z.ai API key removed.");
    } catch (error: any) {
      setZAiMessageType("error");
      setZAiMessage(error?.message || "Failed to remove Z.ai key");
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

  useEffect(() => {
    fetchPairingStatus();
    fetchTelegramSettings();
    fetchOpenAiSettings();
    fetchZAiSettings();
  }, []);

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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focus = params.get("focus");
    if (focus === "openai") {
      setHighlightOpenAiCard(true);
      openAiCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const timeoutId = window.setTimeout(() => {
        setHighlightOpenAiCard(false);
      }, 4200);
      return () => window.clearTimeout(timeoutId);
    }
    if (focus === "zai") {
      setHighlightZAiCard(true);
      zAiCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const timeoutId = window.setTimeout(() => {
        setHighlightZAiCard(false);
      }, 4200);
      return () => window.clearTimeout(timeoutId);
    }
  }, [location.search]);

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

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-100 mb-2">{t("settings.title")}</h1>
          <p className="text-sm md:text-base text-gray-400">{t("settings.subtitle")}</p>
        </div>

        {/* User Profile */}
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
          </div>
        </div>

        {/* Connect EXE */}
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
                <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
                  <p className="text-xs text-gray-400 mb-2">Client ID</p>
                  <div className="flex items-center gap-2">
                    <p className="text-base md:text-lg font-mono tracking-tight text-gray-100">
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

                <div className="rounded-xl border border-gray-700/50 bg-gray-800/50 p-4">
                  <p className="text-xs text-gray-400 mb-2">EXE ID</p>
                  <div className="flex items-center gap-2">
                    <p className="text-base md:text-lg font-mono tracking-tight text-gray-100">
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

        {/* Z.ai API Key */}
        <div
          ref={zAiCardRef}
          className={`bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6 mt-4 md:mt-6 transition-all ${
            highlightZAiCard
              ? "ring-2 ring-cyan-400/80 shadow-[0_0_0_4px_rgba(34,211,238,0.2)] animate-pulse"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-100">Z.ai API Key</h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <a
                href={zAiKeysUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-300 transition-colors hover:bg-cyan-500/15 hover:text-cyan-200"
              >
                <ExternalLink className="w-4 h-4" />
                Open Z.ai API Keys
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
                {zAiLoading ? "Checking..." : zAiHasKey ? "Configured" : "Not Configured"}
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
                Need a new Z.ai key? Open the official dashboard, create or copy the key there, and paste it below.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Stored key preview
                </label>
                <input
                  type="text"
                  value={zAiHasKey ? zAiKeyPreview : "No key configured"}
                  readOnly
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none"
                />
                <p className="mt-2 text-xs text-gray-500">
                  For security, only the beginning of the key is displayed.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  New Z.ai API key
                </label>
                <input
                  type="password"
                  value={zAiKeyInput}
                  onChange={(e) => setZAiKeyInput(e.target.value)}
                  placeholder="zai-..."
                  disabled={zAiSaving}
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
                  Remove Key
                </button>
                <button
                  type="submit"
                  disabled={zAiSaving || !zAiKeyInput.trim()}
                  className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-cyan-500/30 disabled:shadow-none flex items-center gap-2"
                >
                  {zAiSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Z.ai Key"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>


        {/* OpenAI API Key */}
        <div
          ref={openAiCardRef}
          className={`bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6 mt-4 md:mt-6 transition-all ${
            highlightOpenAiCard
              ? "ring-2 ring-blue-400/80 shadow-[0_0_0_4px_rgba(59,130,246,0.2)] animate-pulse"
              : ""
          }`}
        >
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <KeyRound className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-semibold text-gray-100">OpenAI API Key</h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <a
                href={openAiKeysUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm font-medium text-blue-300 transition-colors hover:bg-blue-500/15 hover:text-blue-200"
              >
                <ExternalLink className="w-4 h-4" />
                Open OpenAI API Keys
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
                {openAiLoading ? "Checking..." : openAiHasKey ? "Configured" : "Not Configured"}
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
                Need a new OpenAI key? Open the official dashboard, create or copy the key there, and paste it below.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Stored key preview
                </label>
                <input
                  type="text"
                  value={openAiHasKey ? openAiKeyPreview : "No key configured"}
                  readOnly
                  className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none"
                />
                <p className="mt-2 text-xs text-gray-500">
                  For security, only the beginning of the key is displayed.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  New OpenAI API key
                </label>
                <input
                  type="password"
                  value={openAiKeyInput}
                  onChange={(e) => setOpenAiKeyInput(e.target.value)}
                  placeholder="sk-..."
                  disabled={openAiSaving}
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
                  Remove Key
                </button>
                <button
                  type="submit"
                  disabled={openAiSaving || !openAiKeyInput.trim()}
                  className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 disabled:shadow-none flex items-center gap-2"
                >
                  {openAiSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save OpenAI Key"
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Telegram Alerts */}
        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800/50 rounded-2xl p-4 md:p-6 mt-4 md:mt-6">
          <div className="flex items-center gap-3 mb-6">
            <Send className="w-5 h-5 text-gray-400" />
            <h2 className="text-lg font-semibold text-gray-100">Telegram Alerts</h2>
          </div>

          <div className="space-y-6">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Enable Telegram Notifications
                </label>
                <p className="text-xs text-gray-500">
                  {`Receive ${brand.displayName} alerts directly in your Telegram chat`}
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
                      !telegramEnabled ||
                      !telegramChatId.trim() ||
                      !telegramBotToken.trim()
                    }
                    className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/30 disabled:shadow-none flex items-center gap-2"
                  >
                    {telegramSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Settings"
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
                  <ol className="space-y-1 list-decimal list-inside text-gray-400">
                    <li>Search for @BotFather in Telegram and create a new bot</li>
                    <li>Copy the Bot Token from BotFather's message</li>
                    <li>Search for @userinfobot in Telegram and start it</li>
                    <li>Copy your Chat ID from the bot's response</li>
                    <li>Enter both values above and enable notifications</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}





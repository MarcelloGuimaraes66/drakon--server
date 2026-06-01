import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, KeyRound, Loader2, X } from "lucide-react";
import {
  SECRET_RECOVERY_MAX_ANSWER_LENGTH,
  SECRET_RECOVERY_QUESTION_TRANSLATION_KEYS,
  type SecretRecoveryQuestionKey,
} from "@/shared/securityRecovery";

type ForgotPasswordDialogProps = {
  isOpen: boolean;
  initialEmail?: string;
  onClose: () => void;
  onRecoveredEmail?: (email: string) => void;
};

type RecoveryStep = "email" | "reset" | "success";

export default function ForgotPasswordDialog({
  isOpen,
  initialEmail = "",
  onClose,
  onRecoveredEmail,
}: ForgotPasswordDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<RecoveryStep>("email");
  const [email, setEmail] = useState(initialEmail);
  const [questionKey, setQuestionKey] = useState<SecretRecoveryQuestionKey | null>(null);
  const [answer, setAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setStep("email");
    setEmail(initialEmail);
    setQuestionKey(null);
    setAnswer("");
    setNewPassword("");
    setConfirmPassword("");
    setHasPassword(true);
    setIsLoading(false);
    setMessage("");
  }, [initialEmail, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setMessage(t("login.errorInvalidEmail"));
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/recovery/question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "Failed to load the recovery question."
        );
      }

      setQuestionKey((data?.question_key as SecretRecoveryQuestionKey) || null);
      setHasPassword(Boolean(data?.has_password));
      setStep("reset");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to load the recovery question."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!questionKey) {
      setMessage("Failed to load the recovery question.");
      return;
    }
    if (!answer.trim()) {
      setMessage(t("securityRecovery.reset.errorAnswerRequired"));
      return;
    }
    if (newPassword.length < 8) {
      setMessage(t("login.errorPasswordLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage(t("securityRecovery.reset.errorPasswordMismatch"));
      return;
    }

    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/recovery/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          question_key: questionKey,
          answer,
          new_password: newPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "Failed to reset the password."
        );
      }

      onRecoveredEmail?.(email.trim());
      setStep("success");
      setAnswer("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to reset the password."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const questionLabel =
    questionKey && SECRET_RECOVERY_QUESTION_TRANSLATION_KEYS[questionKey]
      ? t(SECRET_RECOVERY_QUESTION_TRANSLATION_KEYS[questionKey])
      : "";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 py-6">
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t("securityRecovery.reset.close")}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-dialog-title"
        className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[#0d1016] text-gray-100 shadow-[0_40px_120px_-48px_rgba(0,0,0,0.95)]"
      >
        <div className="border-b border-white/10 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-400/10 text-blue-200">
                <KeyRound className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 id="forgot-password-dialog-title" className="text-xl font-semibold text-gray-50">
                  {step === "success"
                    ? t("securityRecovery.reset.successTitle")
                    : t("securityRecovery.reset.title")}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  {step === "success"
                    ? t("securityRecovery.reset.successDescription")
                    : t("securityRecovery.reset.description")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              aria-label={t("securityRecovery.reset.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="px-6 py-5">
          {step === "email" ? (
            <form onSubmit={handleLookup} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  {t("securityRecovery.reset.emailLabel")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (message) {
                      setMessage("");
                    }
                  }}
                  disabled={isLoading}
                  placeholder={t("securityRecovery.reset.emailPlaceholder")}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-gray-100 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60"
                />
              </div>

              {message ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-blue-300 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-blue-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("securityRecovery.reset.lookupLoading")}
                  </>
                ) : (
                  t("securityRecovery.reset.lookup")
                )}
              </button>
            </form>
          ) : null}

          {step === "reset" ? (
            <form onSubmit={handleReset} className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setMessage("");
                }}
                className="inline-flex items-center gap-2 text-sm text-gray-400 transition-colors hover:text-gray-200"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("securityRecovery.reset.back")}
              </button>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                  {t("securityRecovery.reset.questionLabel")}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-100">{questionLabel}</p>
              </div>

              {!hasPassword ? (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {t("securityRecovery.reset.noPasswordHint")}
                </div>
              ) : null}

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  {t("securityRecovery.reset.answerLabel")}
                </label>
                <input
                  type="text"
                  value={answer}
                  onChange={(event) => {
                    setAnswer(event.target.value.slice(0, SECRET_RECOVERY_MAX_ANSWER_LENGTH));
                    if (message) {
                      setMessage("");
                    }
                  }}
                  disabled={isLoading}
                  placeholder={t("securityRecovery.reset.answerPlaceholder")}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-gray-100 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  {t("securityRecovery.reset.passwordLabel")}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    if (message) {
                      setMessage("");
                    }
                  }}
                  disabled={isLoading}
                  placeholder={t("securityRecovery.reset.passwordPlaceholder")}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-gray-100 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">
                  {t("securityRecovery.reset.confirmPasswordLabel")}
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    if (message) {
                      setMessage("");
                    }
                  }}
                  disabled={isLoading}
                  placeholder={t("securityRecovery.reset.confirmPasswordPlaceholder")}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-gray-100 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60"
                />
              </div>

              {message ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-blue-300 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-blue-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("securityRecovery.reset.submitting")}
                  </>
                ) : (
                  t("securityRecovery.reset.submit")
                )}
              </button>
            </form>
          ) : null}

          {step === "success" ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
                {t("securityRecovery.reset.successDescription")}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-blue-300 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-blue-200"
              >
                {t("securityRecovery.reset.successAction")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

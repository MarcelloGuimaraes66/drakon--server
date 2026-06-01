import { useEffect, useState } from "react";
import { useAuth } from "@getmocha/users-service/react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import {
  normalizeSecretRecoveryQuestionKey,
  SECRET_RECOVERY_MAX_ANSWER_LENGTH,
  SECRET_RECOVERY_QUESTION_KEYS,
  SECRET_RECOVERY_QUESTION_TRANSLATION_KEYS,
  type SecretRecoveryQuestionKey,
} from "@/shared/securityRecovery";
import { brand } from "@/shared/brand";

export default function SecretRecoverySetupOverlay() {
  const { user, refreshUser, logout } = useAuth();
  const { t } = useTranslation();
  const isPerceptrumBrand = brand.id === "perceptrum";
  const accentBorderClass = isPerceptrumBrand ? "border-cyan-400/35" : "border-blue-400/35";
  const accentTextClass = isPerceptrumBrand ? "text-cyan-200" : "text-blue-200";
  const accentBgClass = isPerceptrumBrand ? "bg-cyan-400/10" : "bg-blue-400/10";
  const selectedQuestionBorderClass = isPerceptrumBrand
    ? "border-cyan-300/60 bg-cyan-400/10"
    : "border-blue-300/60 bg-blue-400/10";
  const selectedQuestionDotClass = isPerceptrumBrand ? "bg-cyan-300" : "bg-blue-300";
  const submitButtonClass = isPerceptrumBrand
    ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200"
    : "bg-blue-300 text-slate-950 hover:bg-blue-200";

  const [selectedQuestion, setSelectedQuestion] = useState<SecretRecoveryQuestionKey>(
    SECRET_RECOVERY_QUESTION_KEYS[0]
  );
  const [answer, setAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const nextQuestion =
      normalizeSecretRecoveryQuestionKey(user?.secret_recovery_question_key) ||
      SECRET_RECOVERY_QUESTION_KEYS[0];
    setSelectedQuestion(nextQuestion);
    setAnswer("");
    setMessage("");
    setIsSubmitting(false);
  }, [user?.id, user?.secret_recovery_question_key]);

  if (!user?.requires_secret_recovery_setup) {
    return null;
  }

  const canSubmit =
    answer.trim().length >= 2 &&
    answer.trim().length <= SECRET_RECOVERY_MAX_ANSWER_LENGTH &&
    !isSubmitting;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      setMessage(t("securityRecovery.overlay.answerRequired"));
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/account-security/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          question_key: selectedQuestion,
          answer,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "Failed to save the secret recovery answer."
        );
      }

      await refreshUser();
    } catch (error) {
      setMessage(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to save the secret recovery answer."
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120]">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-md" />
      <div className="relative flex min-h-full items-center justify-center px-4 py-6">
        <div className="w-full max-w-3xl overflow-hidden rounded-[32px] border border-white/10 bg-[#06080d] shadow-[0_48px_120px_-48px_rgba(0,0,0,0.95)]">
          <div className="relative overflow-hidden border-b border-white/10 px-6 py-6 sm:px-8">
            <div
              className={`absolute inset-x-0 top-0 h-40 opacity-80 ${
                isPerceptrumBrand
                  ? "bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.2),transparent_54%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.16),transparent_48%)]"
                  : "bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.22),transparent_54%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_48%)]"
              }`}
            />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div
                  className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl border ${accentBorderClass} ${accentBgClass}`}
                >
                  <ShieldCheck className={`h-7 w-7 ${accentTextClass}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gray-400">
                    {t("securityRecovery.overlay.badge")}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-gray-50 sm:text-[2rem]">
                    {t("securityRecovery.overlay.title")}
                  </h2>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-300">
                    {t("securityRecovery.overlay.description")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void logout()}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                {t("nav.logout")}
              </button>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1.1fr),minmax(0,0.9fr)]"
          >
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-200">
                {t("securityRecovery.overlay.selectLabel")}
              </p>
              <div className="space-y-3">
                {SECRET_RECOVERY_QUESTION_KEYS.map((questionKey) => {
                  const selected = selectedQuestion === questionKey;
                  return (
                    <button
                      key={questionKey}
                      type="button"
                      onClick={() => setSelectedQuestion(questionKey)}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left transition-colors ${
                        selected
                          ? selectedQuestionBorderClass
                          : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                      }`}
                    >
                      <span
                        className={`mt-1 h-3 w-3 rounded-full border ${
                          selected
                            ? `${selectedQuestionDotClass} border-transparent`
                            : "border-white/25"
                        }`}
                      />
                      <span className="text-sm leading-6 text-gray-100">
                        {t(SECRET_RECOVERY_QUESTION_TRANSLATION_KEYS[questionKey])}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-gray-100">
                <KeyRound className="h-5 w-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-gray-100">
                {t("securityRecovery.overlay.answerLabel")}
              </p>
              <p className="mt-2 text-sm leading-6 text-gray-400">
                {t("securityRecovery.overlay.serverRequired")}
              </p>

              <label className="mt-5 block">
                <span className="sr-only">{t("securityRecovery.overlay.answerLabel")}</span>
                <input
                  type="text"
                  value={answer}
                  onChange={(event) => {
                    setAnswer(event.target.value.slice(0, SECRET_RECOVERY_MAX_ANSWER_LENGTH));
                    if (message) {
                      setMessage("");
                    }
                  }}
                  autoComplete="off"
                  disabled={isSubmitting}
                  placeholder={t("securityRecovery.overlay.answerPlaceholder")}
                  className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-gray-100 placeholder:text-gray-500 focus:border-white/20 focus:outline-none focus:ring-2 focus:ring-white/10 disabled:opacity-60"
                />
              </label>

              <p className="mt-3 text-xs leading-5 text-gray-500">
                {t("securityRecovery.overlay.answerHelp")}
              </p>

              {message ? (
                <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!canSubmit}
                className={`mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-gray-500 ${submitButtonClass}`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("securityRecovery.overlay.submitting")}
                  </>
                ) : (
                  t("securityRecovery.overlay.submit")
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

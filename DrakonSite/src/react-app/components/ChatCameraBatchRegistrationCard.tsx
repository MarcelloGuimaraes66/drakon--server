import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MapPin, Rows3 } from "lucide-react";
import type { CameraImportCandidate, CameraImportRequiredField } from "@/shared/cameraImport";
import type { CameraBatchRegistrationDraftMessageMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  messageId: number;
  metadata: CameraBatchRegistrationDraftMessageMetadata;
  onSubmit: (messageId: number) => Promise<void>;
};

const REQUIRED_FIELD_LABELS: Record<CameraImportRequiredField, string> = {
  ip_address: "IP",
  username: "Usuario",
  password: "Senha",
  manufacturer: "Fabricante",
};

function humanizeFieldLabel(field: string) {
  if (field in REQUIRED_FIELD_LABELS) {
    return REQUIRED_FIELD_LABELS[field as CameraImportRequiredField];
  }

  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCandidateAddress(candidate: CameraImportCandidate) {
  return [
    candidate.street,
    candidate.number,
    candidate.city,
    candidate.state,
    candidate.zip_code,
    candidate.country,
  ]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(", ");
}

function copyForLanguage(languageInput?: string) {
  const language = String(languageInput || "").trim().toLowerCase();
  const isPt = language.startsWith("pt");

  return {
    isPt,
    title: isPt ? "Lote de cameras" : "Camera batch",
    subtitle: isPt
      ? "Revise o preview antes de registrar todas de uma vez."
      : "Review the preview before registering everything at once.",
    ready: isPt ? "Prontas" : "Ready",
    review: isPt ? "Em revisao" : "Need review",
    total: isPt ? "No lote" : "In batch",
    expected: isPt ? "Esperadas" : "Expected",
    register: isPt ? "Registrar lote" : "Register batch",
    registering: isPt ? "Registrando..." : "Registering...",
    registered: isPt ? "Lote registrado" : "Batch registered",
    incompleteWarning: isPt
      ? "Complete ou corrija os itens pendentes no chat antes de registrar o lote inteiro."
      : "Complete or correct the pending items in chat before registering the whole batch.",
    expectedWarning: isPt
      ? "Ainda faltam cameras para atingir a quantidade pedida."
      : "More cameras are still needed to reach the requested count.",
    defaultsWarning: isPt
      ? "Alguns enderecos foram completados com placeholders."
      : "Some addresses were completed with placeholders.",
    failures: isPt ? "Falhas" : "Failures",
    missing: isPt ? "Faltando" : "Missing",
    readyBadge: isPt ? "Pronta" : "Ready",
    reviewBadge: isPt ? "Revisar" : "Review",
    success: isPt ? "Cadastro concluido." : "Batch registration completed.",
    ipPending: isPt ? "IP pendente" : "IP pending",
    manufacturerPending: isPt ? "Fabricante pendente" : "Manufacturer pending",
    createdSummary: isPt ? "criadas" : "created",
    skippedSummary: isPt ? "puladas" : "skipped",
  };
}

export default function ChatCameraBatchRegistrationCard({
  messageId,
  metadata,
  onSubmit,
}: Props) {
  const copy = copyForLanguage(metadata.language);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const preview = metadata.preview;
  const candidates = Array.isArray(preview?.candidates) ? preview.candidates : [];
  const expectedCount = Number(metadata.expected_count || 0);
  const hasExpectedGap = expectedCount > 0 && candidates.length < expectedCount;
  const hasIncomplete = Number(preview?.incomplete_count || 0) > 0;
  const canSubmit =
    metadata.status === "awaiting_confirmation" &&
    Number(preview?.ready_count || 0) > 0 &&
    !hasIncomplete &&
    !hasExpectedGap;

  const warningLines = useMemo(() => {
    const lines: string[] = [];
    if (hasExpectedGap) {
      lines.push(copy.expectedWarning);
    }
    if (hasIncomplete) {
      lines.push(copy.incompleteWarning);
    }
    if (Number(preview?.defaulted_address_count || 0) > 0) {
      lines.push(copy.defaultsWarning);
    }
    (preview?.global_warnings || []).forEach((warning) => {
      if (warning) lines.push(warning);
    });
    Object.entries(preview?.missing_field_summary || {}).forEach(([field, count]) => {
      lines.push(`${copy.missing}: ${humanizeFieldLabel(field)} (${count})`);
    });
    return Array.from(new Set(lines));
  }, [
    copy.defaultsWarning,
    copy.expectedWarning,
    copy.incompleteWarning,
    copy.missing,
    hasExpectedGap,
    hasIncomplete,
    preview?.defaulted_address_count,
    preview?.global_warnings,
    preview?.missing_field_summary,
  ]);

  const handleSubmit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(messageId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.incompleteWarning);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{copy.title}</p>
          <p className="mt-1 text-xs text-slate-300">
            {metadata.status === "registered" ? copy.registered : copy.subtitle}
          </p>
        </div>
        {metadata.status === "registered" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {copy.registered}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-100">
            <Rows3 className="h-3.5 w-3.5" />
            {candidates.length}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.ready}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{preview?.ready_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.review}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{preview?.incomplete_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.total}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{candidates.length}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.expected}</p>
          <p className="mt-2 text-2xl font-semibold text-white">
            {expectedCount || candidates.length}
          </p>
        </div>
      </div>

      {warningLines.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1">
              {warningLines.map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {candidates.map((candidate) => {
          const address = formatCandidateAddress(candidate);
          const missingFields = Array.isArray(candidate.missing_fields)
            ? candidate.missing_fields
            : [];
          return (
            <div
              key={`${candidate.source_index}-${candidate.source_reference}`}
              className="rounded-2xl border border-white/[0.06] bg-black/10 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">
                      {candidate.name || candidate.source_reference}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        candidate.can_create
                          ? "border border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
                          : "border border-amber-300/20 bg-amber-400/10 text-amber-100"
                      }`}
                    >
                      {candidate.can_create ? copy.readyBadge : copy.reviewBadge}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300">
                    {candidate.ip_address || copy.ipPending} |{" "}
                    {candidate.manufacturer || copy.manufacturerPending}
                  </p>
                  {address ? (
                    <p className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>{address}</span>
                    </p>
                  ) : null}
                </div>
                {missingFields.length > 0 ? (
                  <p className="text-xs text-amber-100">
                    {copy.missing}: {missingFields.map(humanizeFieldLabel).join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {metadata.status === "registered" ? (
        <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          <p>{copy.success}</p>
          {metadata.apply_result ? (
            <p className="mt-1 text-emerald-50/90">
              {metadata.apply_result.created_count} {copy.createdSummary},{" "}
              {metadata.apply_result.skipped_count} {copy.skippedSummary}.
            </p>
          ) : null}
          {Array.isArray((metadata.apply_result as any)?.failed_candidates) &&
          (metadata.apply_result as any).failed_candidates.length > 0 ? (
            <div className="mt-3 space-y-1 text-xs text-emerald-50/90">
              <p className="font-medium">{copy.failures}</p>
              {(metadata.apply_result as any).failed_candidates.map((candidate: any) => (
                <p key={`${candidate.source_index}-${candidate.source_reference}`}>
                  {candidate.source_reference}: {candidate.reason}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4">
          {submitError ? (
            <div className="mb-3 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              {submitError}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
            className="inline-flex items-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? copy.registering : `${copy.register} (${preview?.ready_count || 0})`}
          </button>
        </div>
      )}
    </div>
  );
}

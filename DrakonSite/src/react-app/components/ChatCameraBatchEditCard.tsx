import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import type { CameraBatchEditChange, CameraBatchEditPreviewTarget } from "@/shared/cameraBatchEdit";
import type { CameraBatchEditDraftMessageMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  messageId: number;
  metadata: CameraBatchEditDraftMessageMetadata;
  onSubmit: (messageId: number) => Promise<void>;
};

function humanizeFieldLabel(field: string) {
  if (field === "ip_address" || field === "normalize_ip_address_format") {
    return "IP Address";
  }
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatChangeValue(change: CameraBatchEditChange) {
  if (change.mode === "clear") {
    return "Clear";
  }
  if (typeof change.value === "boolean") {
    return change.value ? "True" : "False";
  }
  if (typeof change.value === "number") {
    return String(change.value);
  }
  if (change.value === null) {
    return "Null";
  }
  return String(change.value ?? "");
}

function copyForLanguage(languageInput?: string) {
  const language = String(languageInput || "").trim().toLowerCase();
  const isPt = language.startsWith("pt");

  return {
    isPt,
    title: isPt ? "Edicao em lote" : "Batch edit",
    subtitle: isPt
      ? "Revise as cameras e os campos antes de aplicar a alteracao em lote."
      : "Review the cameras and fields before applying the batch change.",
    updated: isPt ? "Edicao aplicada" : "Batch updated",
    matched: isPt ? "Encontradas" : "Matched",
    ready: isPt ? "Prontas" : "Ready",
    blocked: isPt ? "Bloqueadas" : "Blocked",
    unchanged: isPt ? "Sem mudanca" : "No change",
    changes: isPt ? "Alteracoes" : "Changes",
    apply: isPt ? "Aplicar alteracoes" : "Apply changes",
    applying: isPt ? "Aplicando..." : "Applying...",
    readyBadge: isPt ? "Pronta" : "Ready",
    blockedBadge: isPt ? "Bloqueada" : "Blocked",
    unchangedBadge: isPt ? "Sem mudanca" : "No change",
    blockedWarning: isPt
      ? "Ajuste o escopo ou os campos antes de confirmar este lote."
      : "Adjust the scope or the fields before confirming this batch.",
    success: isPt ? "Edicao em lote concluida." : "Batch edit completed.",
    failures: isPt ? "Falhas" : "Failures",
    updatedSummary: isPt ? "atualizadas" : "updated",
    skippedSummary: isPt ? "puladas" : "skipped",
    noTargets: isPt ? "Nenhuma camera encontrada neste preview." : "No cameras were matched in this preview.",
    warnings: isPt ? "Avisos" : "Warnings",
    changedFields: isPt ? "Campos" : "Fields",
    ipPending: isPt ? "IP indisponivel" : "IP unavailable",
  };
}

function targetStatusClasses(status: CameraBatchEditPreviewTarget["status"]) {
  if (status === "ready") {
    return "border border-emerald-300/20 bg-emerald-400/10 text-emerald-200";
  }
  if (status === "blocked") {
    return "border border-rose-300/20 bg-rose-400/10 text-rose-100";
  }
  return "border border-white/10 bg-white/5 text-slate-200";
}

export default function ChatCameraBatchEditCard({
  messageId,
  metadata,
  onSubmit,
}: Props) {
  const copy = copyForLanguage(metadata.language);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const preview = metadata.preview;
  const targets = Array.isArray(preview?.targets) ? preview.targets : [];
  const changes = Array.isArray(preview?.changes) ? preview.changes : [];
  const blockedCount = Number(preview?.blocked_count || 0);
  const readyCount = Number(preview?.ready_count || 0);
  const unchangedCount = Number(preview?.unchanged_count || 0);
  const canSubmit =
    metadata.status === "awaiting_confirmation" &&
    readyCount > 0 &&
    blockedCount === 0;

  const warningLines = useMemo(() => {
    const lines: string[] = [];
    if (blockedCount > 0) {
      lines.push(copy.blockedWarning);
    }
    (preview?.global_warnings || []).forEach((warning) => {
      if (warning) lines.push(warning);
    });
    return Array.from(new Set(lines));
  }, [blockedCount, copy.blockedWarning, preview?.global_warnings]);

  const handleSubmit = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(messageId);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : copy.blockedWarning);
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
            {metadata.status === "updated" ? copy.updated : copy.subtitle}
          </p>
        </div>
        {metadata.status === "updated" ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {copy.updated}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-100">
            <RefreshCw className="h-3.5 w-3.5" />
            {targets.length}
          </span>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.matched}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{preview?.total_matched || 0}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.ready}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{readyCount}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.blocked}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{blockedCount}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.unchanged}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{unchangedCount}</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-gray-500">{copy.changes}</p>
        {changes.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {changes.map((change) => (
              <div
                key={`${change.field}-${change.mode}`}
                className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-slate-100"
              >
                <span className="font-medium">{humanizeFieldLabel(change.field)}</span>
                <span className="mx-1 text-slate-400">·</span>
                <span className="text-slate-300">{formatChangeValue(change)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">{copy.noTargets}</p>
        )}
      </div>

      {warningLines.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm text-amber-50">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">{copy.warnings}</p>
              {warningLines.map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {targets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-5 text-sm text-slate-400">
            {copy.noTargets}
          </div>
        ) : (
          targets.map((target) => (
            <div
              key={target.camera_id}
              className="rounded-2xl border border-white/[0.06] bg-black/10 p-4"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{target.camera_name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${targetStatusClasses(target.status)}`}>
                      {target.status === "ready"
                        ? copy.readyBadge
                        : target.status === "blocked"
                          ? copy.blockedBadge
                          : copy.unchangedBadge}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300">
                    {target.ip_address || copy.ipPending}
                    {target.manufacturer ? ` | ${target.manufacturer}` : ""}
                  </p>
                  {target.changed_fields.length > 0 ? (
                    <p className="mt-2 text-xs text-slate-400">
                      {copy.changedFields}: {target.changed_fields.map(humanizeFieldLabel).join(", ")}
                    </p>
                  ) : null}
                </div>
                {target.warnings.length > 0 ? (
                  <div className="max-w-sm space-y-1 text-xs text-amber-100">
                    {target.warnings.map((warning, index) => (
                      <p key={`${target.camera_id}-warning-${index}`}>{warning}</p>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {metadata.status === "updated" ? (
        <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          <p>{copy.success}</p>
          {metadata.apply_result ? (
            <p className="mt-1 text-emerald-50/90">
              {metadata.apply_result.updated_count} {copy.updatedSummary},{" "}
              {metadata.apply_result.skipped_count} {copy.skippedSummary}.
            </p>
          ) : null}
          {Array.isArray(metadata.apply_result?.failed_targets) &&
          metadata.apply_result.failed_targets.length > 0 ? (
            <div className="mt-3 space-y-1 text-xs text-emerald-50/90">
              <p className="font-medium">{copy.failures}</p>
              {metadata.apply_result.failed_targets.map((target) => (
                <p key={`${target.camera_id}-${target.camera_name || "camera"}`}>
                  {target.camera_name || `Camera ${target.camera_id}`}: {target.reason}
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
          {blockedCount > 0 ? (
            <div className="mb-3 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>{copy.blockedWarning}</p>
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
            className="inline-flex items-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isSubmitting ? copy.applying : `${copy.apply} (${readyCount})`}
          </button>
        </div>
      )}
    </div>
  );
}

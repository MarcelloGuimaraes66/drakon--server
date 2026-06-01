import { useNavigate } from "react-router";
import { Camera, CheckCircle2, Clock3, ExternalLink } from "lucide-react";
import type {
  JobCreationResultMessageMetadata,
  JobCreationStepMessageMetadata,
} from "@/react-app/utils/chatUtils";

type Props = {
  metadata: JobCreationResultMessageMetadata;
};

function buildJobRoute(jobId?: number): string | null {
  if (!Number.isInteger(jobId) || (jobId as number) <= 0) {
    return null;
  }

  const params = new URLSearchParams({
    view: "steps",
    job: String(jobId),
  });
  return `/jobs?${params.toString()}`;
}

function buildStepTitle(step: JobCreationStepMessageMetadata, isPt: boolean): string {
  const rawName = step.step_name?.trim();
  if (rawName) {
    return rawName;
  }

  return isPt ? `Etapa ${step.step_index}` : `Step ${step.step_index}`;
}

function formatRunEvery(seconds: number | undefined, isPt: boolean): string | null {
  if (!Number.isInteger(seconds) || (seconds as number) <= 0) {
    return null;
  }

  const safeSeconds = Number(seconds);
  if (safeSeconds % 60 === 0) {
    const minutes = safeSeconds / 60;
    return isPt
      ? `A cada ${minutes} min`
      : `Every ${minutes} min`;
  }

  return isPt
    ? `A cada ${safeSeconds}s`
    : `Every ${safeSeconds}s`;
}

function formatRole(role: string | null | undefined, isPt: boolean): string | null {
  const normalized = String(role || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "collector") {
    return isPt ? "Coleta" : "Collector";
  }
  if (normalized === "decision") {
    return isPt ? "Decisao" : "Decision";
  }
  return normalized;
}

function formatExecutionMode(
  executionMode: string | null | undefined,
  isPt: boolean
): string | null {
  const normalized = String(executionMode || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "inference_group_image") {
    return isPt ? "Grupo unico" : "Single group";
  }
  if (normalized === "per_target_agents") {
    return isPt ? "Por camera" : "Per camera";
  }
  return normalized;
}

function formatInputType(inputType: string | null | undefined, isPt: boolean): string | null {
  const normalized = String(inputType || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "image") {
    return isPt ? "Imagem" : "Image";
  }
  if (normalized === "video") {
    return "Video";
  }
  return normalized;
}

function formatCameraCount(count: number, isPt: boolean): string {
  if (!Number.isInteger(count) || count <= 0) {
    return isPt ? "0 cameras" : "0 cameras";
  }

  if (isPt) {
    return count === 1 ? "1 camera" : `${count} cameras`;
  }

  return count === 1 ? "1 camera" : `${count} cameras`;
}

function formatRemainingTargets(count: number, isPt: boolean): string {
  if (!Number.isInteger(count) || count <= 0) {
    return "";
  }

  if (isPt) {
    return count === 1
      ? "+1 camera adicional"
      : `+${count} cameras adicionais`;
  }

  return count === 1
    ? "+1 more camera"
    : `+${count} more cameras`;
}

function buildStepBadges(
  step: JobCreationStepMessageMetadata,
  isPt: boolean
): string[] {
  const badges: string[] = [];
  const role = formatRole(step.role, isPt);
  const executionMode = formatExecutionMode(step.execution_mode, isPt);
  const inputType = formatInputType(step.input_type, isPt);

  if (role) {
    badges.push(role);
  }
  if (executionMode) {
    badges.push(executionMode);
  }
  if (inputType) {
    badges.push(inputType);
  }

  return badges;
}

function buildTargetPreview(step: JobCreationStepMessageMetadata, isPt: boolean): string | null {
  const labels = Array.isArray(step.target_preview_labels)
    ? step.target_preview_labels
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];

  if (labels.length === 0 && (!step.remaining_target_count || step.remaining_target_count <= 0)) {
    return null;
  }

  const preview = labels.join(", ");
  if (step.remaining_target_count && step.remaining_target_count > 0) {
    const suffix = formatRemainingTargets(step.remaining_target_count, isPt);
    return preview ? `${preview}, ${suffix}` : suffix;
  }

  return preview;
}

export default function ChatJobCreatedCard({ metadata }: Props) {
  const navigate = useNavigate();
  const language = String(metadata.language || "en").trim().toLowerCase();
  const isPt = language.startsWith("pt");
  const openRoute = buildJobRoute(metadata.job_id);

  const title = isPt ? "Tarefa criada" : "Job created";
  const subtitle = metadata.job_name?.trim()
    ? isPt
      ? `O job ${metadata.job_name.trim()} ja esta disponivel.`
      : `The job ${metadata.job_name.trim()} is ready.`
    : isPt
      ? "O job solicitado foi criado."
      : "The requested job was created.";

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-slate-300">{subtitle}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {isPt ? "Criada" : "Created"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Etapas" : "Steps"}
          </p>
          <p className="mt-3 text-lg font-semibold text-white">
            {Number.isInteger(metadata.step_count) && metadata.step_count > 0
              ? metadata.step_count
              : metadata.steps.length}
          </p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Cameras" : "Cameras"}
          </p>
          <p className="mt-3 text-lg font-semibold text-white">
            {Number.isInteger(metadata.target_count) && metadata.target_count > 0
              ? metadata.target_count
              : metadata.steps.reduce((sum, step) => sum + step.target_count, 0)}
          </p>
        </div>
      </div>

      {metadata.steps.length > 0 ? (
        <div className="mt-4 space-y-3">
          {metadata.steps.map((step, index) => {
            const badges = buildStepBadges(step, isPt);
            const targetPreview = buildTargetPreview(step, isPt);

            return (
              <div
                key={`${step.step_key || step.step_name || "step"}-${step.step_index}-${index}`}
                className="rounded-2xl border border-white/[0.06] bg-black/10 p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                      {buildStepTitle(step, isPt)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {isPt
                        ? `${formatCameraCount(step.target_count, true)} neste step`
                        : `${formatCameraCount(step.target_count, false)} in this step`}
                    </p>
                  </div>
                  {badges.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {badges.map((badge) => (
                        <span
                          key={badge}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-200"
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {targetPreview ? (
                  <div className="mt-3 flex items-start gap-2 text-xs text-slate-300">
                    <Camera className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-sky-300" />
                    <p className="leading-5">{targetPreview}</p>
                  </div>
                ) : null}

                {step.run_every_seconds && step.run_every_seconds > 0 ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                    <Clock3 className="h-3.5 w-3.5 text-slate-400" />
                    <span>{formatRunEvery(step.run_every_seconds, isPt)}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {openRoute ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => navigate(openRoute)}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-400/20"
          >
            <ExternalLink className="h-4 w-4" />
            {isPt ? "Abrir tarefa" : "Open job"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

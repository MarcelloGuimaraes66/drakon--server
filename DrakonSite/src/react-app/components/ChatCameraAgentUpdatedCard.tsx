import { Bot, Camera, CheckCircle2, Workflow } from "lucide-react";
import type {
  CameraAgentFormEditorTarget,
  CameraAgentUpdateResultMessageMetadata,
  CameraAgentUpdatedFieldMetadata,
} from "@/react-app/utils/chatUtils";

type Props = {
  metadata: CameraAgentUpdateResultMessageMetadata;
};

function describeTarget(
  target: CameraAgentFormEditorTarget | undefined,
  isPt: boolean
): string {
  if (!target) {
    return isPt ? "Destino selecionado" : "Selected target";
  }

  if (target.type === "step_default") {
    return (
      target.step_title?.trim() ||
      (Number.isInteger(target.step_id)
        ? `Step ${target.step_id}`
        : isPt
          ? "Etapa"
          : "Step")
    );
  }

  if (target.type === "step_camera") {
    const cameraLabel =
      target.camera_name?.trim() ||
      (Number.isInteger(target.camera_id)
        ? `Camera ${target.camera_id}`
        : isPt
          ? "Camera"
          : "Camera");
    const stepLabel =
      target.step_title?.trim() ||
      (Number.isInteger(target.step_id)
        ? `Step ${target.step_id}`
        : isPt
          ? "Etapa"
          : "Step");
    return isPt ? `${cameraLabel} em ${stepLabel}` : `${cameraLabel} in ${stepLabel}`;
  }

  return (
    target.camera_name?.trim() ||
    (Number.isInteger(target.camera_id)
      ? `Camera ${target.camera_id}`
      : isPt
        ? "Camera"
        : "Camera")
  );
}

function renderTargetIcon(target: CameraAgentFormEditorTarget | undefined) {
  if (target?.type === "camera") {
    return <Camera className="h-4 w-4 text-emerald-200" />;
  }
  return <Workflow className="h-4 w-4 text-emerald-200" />;
}

function fieldLabel(field: CameraAgentUpdatedFieldMetadata, isPt: boolean): string {
  return field.label?.trim() || (isPt ? "Campo alterado" : "Updated field");
}

function fieldValue(value: string | null | undefined, isPt: boolean): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) return normalized;
  return isPt ? "vazio" : "empty";
}

export default function ChatCameraAgentUpdatedCard({ metadata }: Props) {
  const language = String(metadata.language || "en").trim().toLowerCase();
  const isPt = language.startsWith("pt");
  const targetDescription = describeTarget(metadata.editor_target, isPt);
  const updatedFields = Array.isArray(metadata.updated_fields) ? metadata.updated_fields : [];
  const updatedCount = updatedFields.length;
  const agentName =
    metadata.agent_name?.trim() || (isPt ? "Agente existente" : "Existing agent");
  const agentSummary = metadata.agent_summary?.trim() || "";

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">
            {isPt ? "Agente atualizado" : "Agent updated"}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {isPt
              ? "Estas foram as alteracoes aplicadas no agente."
              : "These are the changes applied to the agent."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {updatedCount > 0 ? updatedCount : isPt ? "OK" : "OK"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Destino" : "Target"}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {renderTargetIcon(metadata.editor_target)}
            <p className="text-sm font-medium text-white">{targetDescription}</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Agente" : "Agent"}
          </p>
          <div className="mt-3 flex items-start gap-2">
            <Bot className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-200" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">{agentName}</p>
              {agentSummary ? (
                <p className="mt-2 text-xs leading-5 text-slate-300">{agentSummary}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Campos alterados" : "Changed fields"}
          </p>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-200">
            {updatedCount}
          </span>
        </div>

        {updatedFields.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            {isPt
              ? "Nenhuma diferenca material foi detectada, mas o agente foi salvo."
              : "No material differences were detected, but the agent was saved."}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {updatedFields.map((field) => {
              const key = `${field.field}-${field.label || "field"}`;
              return (
                <div
                  key={key}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4"
                >
                  <p className="text-sm font-medium text-white">
                    {fieldLabel(field, isPt)}
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500">
                        {isPt ? "Antes" : "Before"}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
                        {fieldValue(field.before, isPt)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/5 p-3">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/80">
                        {isPt ? "Depois" : "After"}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-white">
                        {fieldValue(field.after, isPt)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

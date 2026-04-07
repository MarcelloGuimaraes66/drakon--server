import { Bot, Camera, PencilLine, Workflow } from "lucide-react";
import type {
  CameraAgentEditContextMessageMetadata,
  CameraAgentFormEditorTarget,
} from "@/react-app/utils/chatUtils";

type Props = {
  metadata: CameraAgentEditContextMessageMetadata;
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
    return <Camera className="h-4 w-4 text-sky-200" />;
  }
  return <Workflow className="h-4 w-4 text-sky-200" />;
}

export default function ChatCameraAgentEditContextCard({ metadata }: Props) {
  const language = String(metadata.language || "en").trim().toLowerCase();
  const isPt = language.startsWith("pt");
  const targetDescription = describeTarget(metadata.editor_target, isPt);
  const agentName =
    metadata.agent_name?.trim() || (isPt ? "Agente existente" : "Existing agent");
  const agentSummary = metadata.agent_summary?.trim() || "";

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">
            {isPt ? "Agente encontrado" : "Agent found"}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {isPt
              ? "Revise o alvo abaixo e me diga o que voce quer mudar."
              : "Review the target below and tell me what you want to change."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-100">
          <PencilLine className="h-3.5 w-3.5" />
          {isPt ? "Edicao" : "Edit"}
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
    </div>
  );
}

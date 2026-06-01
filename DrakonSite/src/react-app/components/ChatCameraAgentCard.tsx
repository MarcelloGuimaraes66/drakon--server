import { useMemo, useState } from "react";
import { Bot, ExternalLink, Loader2 } from "lucide-react";
import {
  isGeneratedCustomAgentName,
  type CameraAgentFormRequestMessageMetadata,
} from "@/react-app/utils/chatUtils";

type Props = {
  metadata: CameraAgentFormRequestMessageMetadata;
  onOpen: () => Promise<void>;
};

function formatSummary(metadata: CameraAgentFormRequestMessageMetadata, isPt: boolean): string {
  const draft = metadata.draft_agent && typeof metadata.draft_agent === "object"
    ? metadata.draft_agent
    : {};
  const configJson =
    draft.config_json && typeof draft.config_json === "object" && !Array.isArray(draft.config_json)
      ? (draft.config_json as Record<string, unknown>)
      : {};
  const displayName =
    typeof draft.display_name === "string" && draft.display_name.trim()
      ? draft.display_name.trim()
      : "";
  const configDisplayName =
    typeof configJson.display_name === "string" && configJson.display_name.trim()
      ? configJson.display_name.trim()
      : "";
  const summary =
    typeof draft.summary === "string" && draft.summary.trim()
      ? draft.summary.trim()
      : typeof configJson.summary === "string" && configJson.summary.trim()
        ? configJson.summary.trim()
      : "";
  const preferredDisplayName =
    (displayName && !isGeneratedCustomAgentName(displayName) ? displayName : "") ||
    (configDisplayName && !isGeneratedCustomAgentName(configDisplayName) ? configDisplayName : "") ||
    summary ||
    displayName ||
    configDisplayName;

  if (preferredDisplayName && summary && summary !== preferredDisplayName) {
    return `${preferredDisplayName} - ${summary}`;
  }
  if (preferredDisplayName) return preferredDisplayName;
  if (summary) return summary;
  return isPt ? "Rascunho de agente preparado pelo chat." : "Agent draft prepared by the chat.";
}

function formatTargetDescription(
  metadata: CameraAgentFormRequestMessageMetadata,
  isPt: boolean,
): string {
  const target = metadata.editor_target;
  if (!target) {
    return isPt
      ? "Formulario preparado para o destino selecionado."
      : "Form prepared for the selected target.";
  }

  if (target.type === "step_default") {
    const stepLabel =
      target.step_title?.trim() ||
      (Number.isInteger(target.step_id) ? `Step ${target.step_id}` : isPt ? "etapa" : "step");
    return isPt
      ? `Formulario preparado para a etapa ${stepLabel}.`
      : `Form prepared for step ${stepLabel}.`;
  }

  if (target.type === "step_camera") {
    const cameraLabel =
      target.camera_name?.trim() ||
      (Number.isInteger(target.camera_id) ? `Camera ${target.camera_id}` : isPt ? "camera" : "camera");
    const stepLabel =
      target.step_title?.trim() ||
      (Number.isInteger(target.step_id) ? `Step ${target.step_id}` : isPt ? "etapa" : "step");
    return isPt
      ? `Formulario preparado para ${cameraLabel} na etapa ${stepLabel}.`
      : `Form prepared for ${cameraLabel} in step ${stepLabel}.`;
  }

  const cameraLabel =
    target.camera_name?.trim() ||
    metadata.camera_name?.trim() ||
    (Number.isInteger(target.camera_id) ? `Camera ${target.camera_id}` : isPt ? "camera selecionada" : "selected camera");
  return isPt
    ? `Formulario preparado para a camera ${cameraLabel}.`
    : `Form prepared for camera ${cameraLabel}.`;
}

export default function ChatCameraAgentCard({ metadata, onOpen }: Props) {
  const language = String(metadata.language || "en").trim().toLowerCase();
  const isPt = language.startsWith("pt");
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const summary = useMemo(() => formatSummary(metadata, isPt), [isPt, metadata]);

  const handleOpen = async () => {
    setOpenError(null);
    setIsOpening(true);
    try {
      await onOpen();
    } catch (error) {
      setOpenError(
        error instanceof Error
          ? error.message
          : isPt
            ? "Nao foi possivel abrir o formulario do agente agora."
            : "Could not open the agent form right now."
      );
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">
            {isPt ? "Formulario do agente" : "Agent form"}
          </p>
          <p className="mt-1 text-xs text-slate-300">{formatTargetDescription(metadata, isPt)}</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-100">
          <Bot className="h-3.5 w-3.5" />
          {isPt ? "Agente" : "Agent"}
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
          {isPt ? "Rascunho" : "Draft"}
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-200">{summary}</p>
      </div>

      {openError ? (
        <div className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
          {openError}
        </div>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={isOpening}
          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {isOpening
            ? isPt
              ? "Abrindo..."
              : "Opening..."
            : isPt
              ? "Abrir formulario do agente"
              : "Open agent form"}
        </button>
      </div>
    </div>
  );
}

import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  Bot,
  Camera,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import type {
  CameraAgentCreationDestinationMetadata,
  CameraAgentCreationResultMessageMetadata,
} from "@/react-app/utils/chatUtils";

type Props = {
  metadata: CameraAgentCreationResultMessageMetadata;
};

type DestinationAction = {
  to: string;
  label: string;
};

function buildCameraAgentRoute(destination: CameraAgentCreationDestinationMetadata): string | null {
  if (!Number.isInteger(destination.camera_id) || (destination.camera_id as number) <= 0) {
    return null;
  }

  const params = new URLSearchParams();
  if (Number.isInteger(destination.agent_id) && (destination.agent_id as number) > 0) {
    params.set("agentId", String(destination.agent_id));
    params.set("openAgent", "1");
  }

  const suffix = params.toString();
  return suffix
    ? `/algorithms/${destination.camera_id}?${suffix}`
    : `/algorithms/${destination.camera_id}`;
}

function buildStepRoute(
  destination: CameraAgentCreationDestinationMetadata,
  openAgent: boolean
): string | null {
  if (!Number.isInteger(destination.job_id) || (destination.job_id as number) <= 0) {
    return null;
  }

  const params = new URLSearchParams({
    view: "steps",
    job: String(destination.job_id),
  });

  if (Number.isInteger(destination.step_id) && (destination.step_id as number) > 0) {
    params.set("step", String(destination.step_id));
  }

  if (openAgent) {
    if (Number.isInteger(destination.camera_id) && (destination.camera_id as number) > 0) {
      params.set("camera", String(destination.camera_id));
    }
    if (Number.isInteger(destination.agent_id) && (destination.agent_id as number) > 0) {
      params.set("agent", String(destination.agent_id));
      params.set("openAgent", "1");
    }
  }

  return `/jobs?${params.toString()}`;
}

function buildDestinationAction(
  destination: CameraAgentCreationDestinationMetadata,
  isPt: boolean
): DestinationAction | null {
  if (destination.destination_type === "camera") {
    const route = buildCameraAgentRoute(destination);
    if (!route) {
      return null;
    }

    return {
      to: route,
      label:
        Number.isInteger(destination.agent_id) && (destination.agent_id as number) > 0
          ? isPt
            ? "Ir para o agente"
            : "Go to agent"
          : isPt
            ? "Abrir camera"
            : "Open camera",
    };
  }

  if (destination.destination_type === "step_camera") {
    const route = buildStepRoute(
      destination,
      Number.isInteger(destination.agent_id) && (destination.agent_id as number) > 0,
    );
    if (!route) {
      return null;
    }

    return {
      to: route,
      label:
        Number.isInteger(destination.agent_id) && (destination.agent_id as number) > 0
          ? isPt
            ? "Ir para o agente"
            : "Go to agent"
          : isPt
            ? "Abrir etapa"
            : "Open step",
    };
  }

  if (destination.destination_type === "step_default") {
    const route = buildStepRoute(destination, false);
    if (!route) {
      return null;
    }

    return {
      to: route,
      label: isPt ? "Abrir etapa" : "Open step",
    };
  }

  return null;
}

function describeDestination(
  destination: CameraAgentCreationDestinationMetadata,
  isPt: boolean
): string {
  if (destination.destination_type === "camera") {
    const cameraLabel =
      destination.camera_name?.trim() ||
      (Number.isInteger(destination.camera_id) ? `Camera ${destination.camera_id}` : destination.label);
    return cameraLabel;
  }

  if (destination.destination_type === "step_camera") {
    const cameraLabel =
      destination.camera_name?.trim() ||
      (Number.isInteger(destination.camera_id) ? `Camera ${destination.camera_id}` : destination.label);
    const stepLabel =
      destination.step_title?.trim() ||
      (Number.isInteger(destination.step_id) ? `Step ${destination.step_id}` : "Step");
    return isPt
      ? `${cameraLabel} no ${stepLabel}`
      : `${cameraLabel} in ${stepLabel}`;
  }

  if (destination.destination_type === "step_default") {
    const stepLabel =
      destination.step_title?.trim() ||
      (Number.isInteger(destination.step_id) ? `Step ${destination.step_id}` : "Step");
    const jobLabel = destination.job_name?.trim();
    return jobLabel ? `${stepLabel} - ${jobLabel}` : stepLabel;
  }

  return destination.label;
}

export default function ChatCameraAgentCreatedCard({ metadata }: Props) {
  const navigate = useNavigate();
  const language = String(metadata.language || "en").trim().toLowerCase();
  const isPt = language.startsWith("pt");

  const destinations = useMemo(
    () =>
      metadata.created_destinations.map((destination) => ({
        destination,
        description: describeDestination(destination, isPt),
        action: buildDestinationAction(destination, isPt),
      })),
    [isPt, metadata.created_destinations],
  );

  const title =
    metadata.status === "partially_created"
      ? isPt
        ? "Agente criado parcialmente"
        : "Agent partially created"
      : isPt
        ? "Agente criado"
        : "Agent created";
  const subtitle =
    metadata.agent_name?.trim()
      ? isPt
        ? `O agente ${metadata.agent_name.trim()} foi criado.`
        : `The agent ${metadata.agent_name.trim()} was created.`
      : metadata.status === "partially_created"
        ? isPt
          ? "Alguns destinos foram atualizados."
          : "Some destinations were updated."
        : isPt
          ? "Os destinos solicitados foram atualizados."
          : "The requested destinations were updated.";
  const badgeLabel =
    metadata.status === "partially_created"
      ? isPt
        ? "Parcial"
        : "Partial"
      : isPt
        ? "Criado"
        : "Created";

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(56,74,96,0.32),rgba(15,18,28,0.55))] p-4 shadow-[0_26px_80px_-44px_rgba(0,0,0,0.9)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-slate-300">{subtitle}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            metadata.status === "partially_created"
              ? "border border-amber-300/20 bg-amber-400/10 text-amber-100"
              : "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
          }`}
        >
          {metadata.status === "partially_created" ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {badgeLabel}
        </span>
      </div>

      {metadata.agent_name?.trim() ? (
        <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Agente" : "Agent"}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-200">{metadata.agent_name.trim()}</p>
        </div>
      ) : null}

      {metadata.status === "partially_created" ? (
        <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3 text-xs text-amber-50">
          {isPt
            ? "Pelo menos um destino foi atualizado, mas o chat reportou falha no restante."
            : "At least one destination was updated, but chat reported a failure for the remaining ones."}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {destinations.map(({ destination, description, action }, index) => {
          const key = `${destination.destination_type}-${destination.agent_id || "none"}-${destination.camera_id || "none"}-${destination.step_id || "none"}-${index}`;
          const isCameraDestination = destination.destination_type === "camera";

          return (
            <div
              key={key}
              className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-black/10 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {isCameraDestination ? (
                    <Camera className="h-4 w-4 flex-shrink-0 text-sky-300" />
                  ) : (
                    <Bot className="h-4 w-4 flex-shrink-0 text-emerald-300" />
                  )}
                  <p className="truncate text-sm font-medium text-white">{description}</p>
                </div>
                <p className="mt-1 text-xs text-slate-400">{destination.label}</p>
              </div>

              {action ? (
                <button
                  type="button"
                  onClick={() => navigate(action.to)}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-400/20"
                >
                  <ExternalLink className="h-4 w-4" />
                  {action.label}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

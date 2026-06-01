import { useMemo, useState } from "react";
import { ExternalLink, Loader2, PencilLine } from "lucide-react";
import type { CameraEditFormRequestMessageMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  metadata: CameraEditFormRequestMessageMetadata;
  onOpen: () => Promise<void>;
};

function formatFieldLabel(field: string, language: string) {
  const isPt = language.startsWith("pt");
  if (field === "name") return isPt ? "Nome" : "Name";
  if (field === "ip_address") return isPt ? "IP ou host" : "IP or host";
  if (field === "rtsp_port") return isPt ? "Porta RTSP" : "RTSP port";
  if (field === "manufacturer") return isPt ? "Fabricante" : "Manufacturer";
  if (field === "username") return isPt ? "Usuario" : "Username";
  if (field === "password") return isPt ? "Senha" : "Password";
  if (field === "channel") return isPt ? "Canal" : "Channel";
  if (field === "subtype") return "Subtype";
  if (field === "connection_method") return isPt ? "Metodo de conexao" : "Connection method";
  if (field === "description") return isPt ? "Descricao" : "Description";
  if (field === "street") return isPt ? "Rua" : "Street";
  if (field === "number") return isPt ? "Numero do endereco" : "Address number";
  if (field === "city") return isPt ? "Cidade" : "City";
  if (field === "state") return isPt ? "Estado" : "State";
  if (field === "zip_code") return isPt ? "CEP ou zipcode" : "Zip or postal code";
  if (field === "country") return isPt ? "Pais" : "Country";
  if (field === "retention_days") return isPt ? "Retencao" : "Retention";
  if (field === "webcam_index") return isPt ? "Indice da webcam" : "Webcam index";
  if (field === "allowpublicaccess") return isPt ? "Compartilhar com colaboradores" : "Share with collaborators";
  return field.replace(/_/g, " ");
}

function formatFieldValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export default function ChatCameraEditCard({ metadata, onOpen }: Props) {
  const language = String(metadata.language || "en").trim().toLowerCase();
  const isPt = language.startsWith("pt");
  const [isOpening, setIsOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const previewLines = useMemo(() => {
    const lines: string[] = [];
    Object.entries(metadata.draft_patch || {}).forEach(([field, value]) => {
      const formattedValue = formatFieldValue(value);
      if (!formattedValue) return;
      lines.push(`${formatFieldLabel(field, language)} -> ${formattedValue}`);
    });
    (metadata.clear_fields || []).forEach((field) => {
      lines.push(
        isPt
          ? `${formatFieldLabel(field, language)} sera limpo`
          : `${formatFieldLabel(field, language)} will be cleared`
      );
    });
    return lines;
  }, [isPt, language, metadata.clear_fields, metadata.draft_patch]);

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
            ? "Nao foi possivel abrir o formulario agora."
            : "Could not open the form right now."
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
            {isPt ? "Edicao da camera" : "Camera edit"}
          </p>
          <p className="mt-1 text-xs text-slate-300">
            {metadata.camera_name
              ? isPt
                ? `Formulario preparado para ${metadata.camera_name}.`
                : `Form prepared for ${metadata.camera_name}.`
              : isPt
                ? "Formulario preparado para a camera selecionada."
                : "Form prepared for the selected camera."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-sky-300/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-medium text-sky-100">
          <PencilLine className="h-3.5 w-3.5" />
          {isPt ? "Formulario" : "Form"}
        </span>
      </div>

      {previewLines.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-gray-500">
            {isPt ? "Sugestao de alteracoes" : "Suggested changes"}
          </p>
          <div className="mt-3 space-y-1.5 text-sm text-slate-200">
            {previewLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}

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
          className="inline-flex items-center gap-2 rounded-2xl border border-sky-300/25 bg-sky-400/15 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
          {isOpening
            ? isPt
              ? "Abrindo..."
              : "Opening..."
            : isPt
              ? "Abrir formulario de edicao"
              : "Open edit form"}
        </button>
      </div>
    </div>
  );
}

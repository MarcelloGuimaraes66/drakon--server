import { Archive, BarChart3, Download, FileText, Images, Video } from "lucide-react";
import type { ReportDocumentMessageMetadata } from "@/react-app/utils/chatUtils";

type Props = {
  metadata: ReportDocumentMessageMetadata;
};

function languageIsPt(language: string | undefined) {
  return String(language || "").trim().toLowerCase().startsWith("pt");
}

function formatGeneratedAt(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function ChatReportDocumentCard({ metadata }: Props) {
  const isPt = languageIsPt(metadata.language);
  const generatedAt = formatGeneratedAt(metadata.generated_at);
  const stats = metadata.stats.slice(0, 6);
  const hasEvidence = Boolean(metadata.evidence_download_path);
  const rollupStatus = metadata.rollup_status;
  const rollupsPending = Boolean(
    rollupStatus &&
      (rollupStatus.camera_daily_rollups !== "ready" ||
        rollupStatus.job_daily_rollups !== "ready" ||
        rollupStatus.agent_daily_rollups !== "ready")
  );

  return (
    <div className="rounded-[28px] border border-white/[0.08] bg-white/[0.04] p-5 shadow-[0_18px_60px_-42px_rgba(0,0,0,0.85)] backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-white">
            {isPt ? "Relatorio pronto" : "Report ready"}
          </p>
          <p className="mt-1 text-sm text-gray-400">{metadata.title}</p>
          {metadata.summary ? (
            <p className="mt-3 text-sm leading-6 text-gray-300">{metadata.summary}</p>
          ) : null}
        </div>

        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-500/10 text-emerald-200">
          <FileText className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={metadata.download_path}
          download={metadata.download_filename || true}
          className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/20"
        >
          <Download className="h-4 w-4" />
          <span>{isPt ? "Baixar DOCX" : "Download DOCX"}</span>
        </a>

        {hasEvidence ? (
          <a
            href={metadata.evidence_download_path || undefined}
            download={metadata.evidence_filename || true}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/20"
          >
            <Archive className="h-4 w-4" />
            <span>{isPt ? "Baixar evidencias" : "Download evidence"}</span>
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <BarChart3 className="h-3.5 w-3.5" />
            <span>{isPt ? "Metricas" : "Metrics"}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{metadata.stats.length}</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <Images className="h-3.5 w-3.5" />
            <span>{isPt ? "Imagens" : "Images"}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{metadata.image_count || 0}</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <Video className="h-3.5 w-3.5" />
            <span>{isPt ? "Videos" : "Videos"}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">{metadata.video_count || 0}</p>
        </div>

        <div className="rounded-2xl border border-white/[0.06] bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-gray-500">
            <Archive className="h-3.5 w-3.5" />
            <span>{isPt ? "Arquivos" : "Files"}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold text-white">
            {metadata.evidence_file_count || 0}
          </p>
        </div>
      </div>

      {stats.length > 0 ? (
        <section className="mt-4 rounded-2xl border border-white/[0.06] bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-gray-500">
            {isPt ? "Resumo numerico" : "Numeric summary"}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {stats.map((stat) => (
              <div
                key={`${stat.label}:${stat.value}`}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
              >
                <p className="text-xs uppercase tracking-[0.12em] text-gray-500">
                  {stat.label}
                </p>
                <p className="mt-1 text-lg font-semibold text-white">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400">
        {generatedAt ? (
          <span>
            {isPt ? "Gerado em" : "Generated"}: {generatedAt}
          </span>
        ) : null}
        {metadata.report_kind ? (
          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-gray-300">
            {metadata.report_kind.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>

      {rollupsPending ? (
        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
          {isPt
            ? "Os rollups diarios da Fase 2 ja estao provisionados, mas ainda nao foram populados. Os comparativos deste relatorio usam os eventos e o estado disponiveis agora."
            : "Phase 2 daily rollups are provisioned but not populated yet, so this report compares the currently available events and state."}
        </div>
      ) : null}
    </div>
  );
}

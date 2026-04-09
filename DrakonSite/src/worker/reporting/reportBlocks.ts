import { buildReportCharts } from "./reportCharts";
import { buildReportEvidenceLayout } from "./reportEvidenceLayout";
import type { ReportTone } from "./reportTheme";

export interface ReportDocxStat {
  label: string;
  value: string;
}

export interface ReportDocxSection {
  heading: string;
  paragraphs: string[];
  bullets: string[];
}

export interface ReportDocxImageEvidence {
  filename: string;
  title: string;
  caption?: string;
  bytes: Uint8Array;
  contentType: string;
  downloadUrl?: string;
  localPath?: string;
  detectedAt?: string | null;
  sourceLabel?: string;
}

export interface ReportDocxVideoEvidence {
  title: string;
  caption?: string;
  downloadUrl?: string;
  filename?: string;
  localPath?: string;
  detectedAt?: string | null;
  sourceLabel?: string;
}

export interface ReportDocxContext {
  applicationName?: string;
  reportId?: string;
  replyLanguage?: string;
  issuedByHandle?: string;
  issuedAtLabel?: string;
  scopeLabel?: string;
  scopeStartAt?: string;
  scopeEndAt?: string;
  focus?: string[];
  rollupStatus?: Record<string, string>;
  topFindings?: string[];
  limitations?: string[];
  currentState?: Record<string, unknown>;
  history?: Record<string, unknown>;
  comparisons?: Record<string, unknown>;
  chatDiscussion?: Record<string, unknown>;
}

export interface ReportDocxInput {
  title: string;
  generatedAt?: string;
  reportKind?: string;
  requestedQuery?: string;
  summary?: string;
  stats?: ReportDocxStat[];
  sections: ReportDocxSection[];
  images?: ReportDocxImageEvidence[];
  videos?: ReportDocxVideoEvidence[];
  context?: ReportDocxContext;
}

export interface ReportMetadataItem {
  label: string;
  value: string;
  tone?: ReportTone;
}

export interface ReportKpiCard {
  label: string;
  value: string;
  tone: ReportTone;
}

export interface ReportChartBlock {
  title: string;
  caption?: string;
  filename: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface ReportTableColumn {
  key: string;
  label: string;
  widthWeight?: number;
  align?: "left" | "center" | "right";
}

export interface ReportTable {
  title: string;
  caption?: string;
  columns: ReportTableColumn[];
  rows: Array<Record<string, string>>;
}

export interface ReportNarrativeSection {
  title: string;
  intro?: string;
  paragraphs: string[];
  bullets: string[];
}

export interface ReportMediaLocation {
  kind: "image" | "video";
  title: string;
  filename?: string;
  downloadUrl?: string;
  localPath?: string;
  detectedAt?: string | null;
  caption?: string;
}

export interface ReportVideoCard extends ReportDocxVideoEvidence {
  posterBytes: Uint8Array;
  posterContentType: string;
  posterFilename: string;
}

export interface ReportEvidenceLayout {
  imageGallery: ReportDocxImageEvidence[];
  videoCards: ReportVideoCard[];
  mediaLocations: ReportMediaLocation[];
}

export interface ReportDocumentModel {
  cover: {
    eyebrow: string;
    title: string;
    subtitle: string;
    summary: string;
    metadata: ReportMetadataItem[];
  };
  header: {
    title: string;
    subtitle?: string;
  };
  footer: {
    leftText: string;
    rightLabel?: string;
  };
  metadataStrip: ReportMetadataItem[];
  executiveSummary: {
    title: string;
    summary: string;
    findings: string[];
  };
  kpis: ReportKpiCard[];
  charts: ReportChartBlock[];
  tables: ReportTable[];
  sections: ReportNarrativeSection[];
  evidence: ReportEvidenceLayout;
  appendix: {
    title: string;
    items: ReportMetadataItem[];
    limitations: string[];
    mediaLocations: ReportMediaLocation[];
  };
}

function isPtLanguage(language: string | undefined): boolean {
  return typeof language === "string" && language.trim().toLowerCase().startsWith("pt");
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function coerceRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function humanizeReportKind(kind: string | undefined, isPt: boolean): string {
  const normalized = normalizeText(kind).toLowerCase();
  const labels: Record<string, { pt: string; en: string }> = {
    current_state: { pt: "Estado atual", en: "Current state" },
    history: { pt: "Histórico", en: "History" },
    camera_health: { pt: "Saúde de câmeras", en: "Camera health" },
    job_activity: { pt: "Atividade de jobs", en: "Job activity" },
    agent_activity: { pt: "Atividade de agentes", en: "Agent activity" },
    detections_alerts: { pt: "Detecções e alertas", en: "Detections and alerts" },
    chat_discussion: { pt: "Discussão do chat", en: "Chat discussion" },
    system_activity: { pt: "Atividade do sistema", en: "System activity" },
    comparison: { pt: "Comparativo analítico", en: "Analytical comparison" },
  };

  if (labels[normalized]) {
    return isPt ? labels[normalized].pt : labels[normalized].en;
  }

  const humanized = normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

  return humanized || (isPt ? "Relatório analítico" : "Analytical report");
}

function rollupStatusSummary(
  status: Record<string, string> | undefined,
  isPt: boolean
): string {
  const camera = normalizeText(status?.camera_daily_rollups, "empty");
  const jobs = normalizeText(status?.job_daily_rollups, "empty");
  const agents = normalizeText(status?.agent_daily_rollups, "empty");
  if (isPt) {
    return `Câmeras: ${camera}; Jobs: ${jobs}; Agentes: ${agents}`;
  }
  return `Cameras: ${camera}; Jobs: ${jobs}; Agents: ${agents}`;
}

function inferKpiTone(label: string): ReportTone {
  const normalized = label.toLowerCase();
  if (
    normalized.includes("erro") ||
    normalized.includes("error") ||
    normalized.includes("falha") ||
    normalized.includes("failure") ||
    normalized.includes("outage")
  ) {
    return "critical";
  }
  if (
    normalized.includes("alert") ||
    normalized.includes("queue") ||
    normalized.includes("retry") ||
    normalized.includes("timeout")
  ) {
    return "warning";
  }
  if (
    normalized.includes("running") ||
    normalized.includes("execu") ||
    normalized.includes("detect") ||
    normalized.includes("atividade") ||
    normalized.includes("activity")
  ) {
    return "success";
  }
  return "primary";
}

function toDisplayValue(value: unknown, fallback = "—"): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return fallback;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  const normalized = normalizeText(value);
  return normalized || fallback;
}

function boolDisplay(value: unknown, isPt: boolean): string {
  return Boolean(value) ? (isPt ? "Sim" : "Yes") : isPt ? "Não" : "No";
}

function buildMetadataItems(input: ReportDocxInput, isPt: boolean): ReportMetadataItem[] {
  const context = input.context || {};
  const metadata: ReportMetadataItem[] = [];

  if (context.issuedByHandle) {
    metadata.push({
      label: isPt ? "Emitido por" : "Issued by",
      value: `@${context.issuedByHandle}`,
      tone: "primary",
    });
  }

  if (context.issuedAtLabel) {
    metadata.push({
      label: isPt ? "Data de emissão" : "Issue date",
      value: context.issuedAtLabel,
    });
  }

  if (context.scopeLabel) {
    metadata.push({
      label: isPt ? "Janela de análise" : "Analysis window",
      value: context.scopeLabel,
    });
  }

  metadata.push({
    label: isPt ? "Tipo" : "Type",
    value: humanizeReportKind(input.reportKind, isPt),
  });

  if (input.requestedQuery) {
    metadata.push({
      label: isPt ? "Pergunta" : "Question",
      value: input.requestedQuery,
    });
  }

  if (Array.isArray(context.focus) && context.focus.length > 0) {
    metadata.push({
      label: isPt ? "Foco" : "Focus",
      value: context.focus.map((entry) => normalizeText(entry)).filter(Boolean).join(", "),
    });
  }

  if (context.rollupStatus) {
    metadata.push({
      label: isPt ? "Base analítica" : "Analytical base",
      value: rollupStatusSummary(context.rollupStatus, isPt),
    });
  }

  if (context.reportId) {
    metadata.push({
      label: isPt ? "Relatório ID" : "Report ID",
      value: context.reportId,
      tone: "neutral",
    });
  }

  return metadata.filter((item) => item.value.trim().length > 0);
}

function buildKpis(input: ReportDocxInput): ReportKpiCard[] {
  return (input.stats || [])
    .map((stat) => ({
      label: normalizeText(stat.label),
      value: normalizeText(stat.value),
      tone: inferKpiTone(normalizeText(stat.label)),
    }))
    .filter((stat) => stat.label.length > 0 && stat.value.length > 0)
    .slice(0, 8);
}

function buildCameraTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Ranking de câmeras" : "Camera ranking",
    caption: isPt
      ? "Comparativo resumido de estabilidade, reconexões e indisponibilidade."
      : "Condensed comparison of stability, reconnects, and downtime.",
    columns: [
      { key: "name", label: isPt ? "Câmera" : "Camera", widthWeight: 4 },
      { key: "running", label: isPt ? "Ativa" : "Live", widthWeight: 1.2, align: "center" },
      { key: "score", label: isPt ? "Score" : "Score", widthWeight: 1.2, align: "center" },
      { key: "reconnects", label: isPt ? "Reconexões" : "Reconnects", widthWeight: 1.5, align: "center" },
      { key: "outage", label: isPt ? "Outage (min)" : "Outage (min)", widthWeight: 1.6, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      name: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      running: boolDisplay(row.is_running, isPt),
      score: toDisplayValue(row.stability_score),
      reconnects: toDisplayValue(row.reconnect_count, "0"),
      outage: toDisplayValue(row.outage_minutes_estimate, "0"),
    })),
  };
}

function buildJobTable(rows: Array<Record<string, unknown>>, isPt: boolean): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Jobs em destaque" : "Jobs in focus",
    caption: isPt
      ? "Execuções, atividade recente e sinais de bloqueio."
      : "Runs, recent activity, and blocking signals.",
    columns: [
      { key: "name", label: isPt ? "Job" : "Job", widthWeight: 3.6 },
      { key: "status", label: isPt ? "Status" : "Status", widthWeight: 1.4, align: "center" },
      { key: "runs", label: isPt ? "Runs" : "Runs", widthWeight: 1.2, align: "center" },
      { key: "alerts", label: isPt ? "Alertas" : "Alerts", widthWeight: 1.2, align: "center" },
      { key: "errors", label: isPt ? "Erros" : "Errors", widthWeight: 1.2, align: "center" },
      { key: "activity", label: isPt ? "Atividade" : "Activity", widthWeight: 1.4, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      name: toDisplayValue(row.job_name, `Job ${toDisplayValue(row.job_id, "")}`),
      status: toDisplayValue(row.runtime_status, "—"),
      runs: toDisplayValue(row.run_count, "0"),
      alerts: toDisplayValue(row.alert_count, "0"),
      errors: toDisplayValue(row.historical_error_count ?? row.current_error_count, "0"),
      activity: toDisplayValue(row.activity_score, "0"),
    })),
  };
}

function buildAgentTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Agentes com mais sinal" : "Top signal agents",
    caption: isPt
      ? "Volume recente de detecções, alertas e erros por agente."
      : "Recent volume of detections, alerts, and errors by agent.",
    columns: [
      { key: "name", label: isPt ? "Agente" : "Agent", widthWeight: 3.5 },
      { key: "scope", label: isPt ? "Escopo" : "Scope", widthWeight: 1.5, align: "center" },
      { key: "detections", label: isPt ? "Detecções" : "Detections", widthWeight: 1.4, align: "center" },
      { key: "alerts", label: isPt ? "Alertas" : "Alerts", widthWeight: 1.2, align: "center" },
      { key: "errors", label: isPt ? "Erros" : "Errors", widthWeight: 1.2, align: "center" },
      { key: "activity", label: isPt ? "Atividade" : "Activity", widthWeight: 1.4, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      name: toDisplayValue(row.agent_name, `Agent ${toDisplayValue(row.agent_id, "")}`),
      scope:
        normalizeText(row.agent_scope_type) === "camera_algorithm"
          ? isPt
            ? "Câmera"
            : "Camera"
          : isPt
          ? "Job"
          : "Job",
      detections: toDisplayValue(row.detection_count, "0"),
      alerts: toDisplayValue(row.alert_count, "0"),
      errors: toDisplayValue(row.error_count, "0"),
      activity: toDisplayValue(row.activity_score, "0"),
    })),
  };
}

function buildRecentActivityTable(
  history: Record<string, unknown> | undefined,
  isPt: boolean
): ReportTable | null {
  if (!history) return null;

  const detections = coerceRows(history.recent_detections);
  if (detections.length > 0) {
    return {
      title: isPt ? "Linha do tempo de detecções" : "Detection timeline",
      caption: isPt
        ? "Ocorrências mais recentes com mídia ou sinal analítico."
        : "Most recent occurrences with media or analytical signal.",
      columns: [
        { key: "time", label: isPt ? "Horário" : "Time", widthWeight: 1.8 },
        { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 3.2 },
        { key: "signal", label: isPt ? "Sinal" : "Signal", widthWeight: 2.2 },
        { key: "media", label: isPt ? "Mídia" : "Media", widthWeight: 1.2, align: "center" },
      ],
      rows: detections.slice(0, 6).map((row) => ({
        time: toDisplayValue(row.detected_at),
        camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
        signal: toDisplayValue(row.algo_type, "—"),
        media:
          row.image_key || row.video_key
            ? isPt
              ? "Sim"
              : "Yes"
            : isPt
            ? "Não"
            : "No",
      })),
    };
  }

  const alerts = coerceRows(history.recent_alerts);
  if (alerts.length > 0) {
    return {
      title: isPt ? "Linha do tempo de alertas" : "Alert timeline",
      caption: isPt
        ? "Alertas mais recentes com câmera, evento e mensagem."
        : "Most recent alerts with camera, event, and message.",
      columns: [
        { key: "time", label: isPt ? "Horário" : "Time", widthWeight: 1.8 },
        { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 3.2 },
        { key: "event", label: isPt ? "Evento" : "Event", widthWeight: 2.1 },
        { key: "message", label: isPt ? "Mensagem" : "Message", widthWeight: 2.9 },
      ],
      rows: alerts.slice(0, 6).map((row) => ({
        time: toDisplayValue(row.created_at),
        camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
        event: toDisplayValue(row.event_type, "—"),
        message: toDisplayValue(row.message, "—"),
      })),
    };
  }

  const events = coerceRows(history.recent_events);
  if (events.length > 0) {
    return {
      title: isPt ? "Eventos recentes do sistema" : "Recent system events",
      caption: isPt
        ? "Amostra dos eventos mais recentes registrados no período."
        : "Sample of the most recent events recorded in the selected period.",
      columns: [
        { key: "time", label: isPt ? "Horário" : "Time", widthWeight: 1.8 },
        { key: "type", label: isPt ? "Tipo" : "Type", widthWeight: 1.9 },
        { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.3 },
        { key: "message", label: isPt ? "Mensagem" : "Message", widthWeight: 3.6 },
      ],
      rows: events.slice(0, 6).map((row) => ({
        time: toDisplayValue(row.created_at),
        type: toDisplayValue(row.event_type),
        camera: toDisplayValue(row.camera_id, "—"),
        message: toDisplayValue(row.message, "—"),
      })),
    };
  }

  return null;
}

function buildNarrativeSections(input: ReportDocxInput, isPt: boolean): ReportNarrativeSection[] {
  const sections = (input.sections || [])
    .map((section) => ({
      title: normalizeText(section.heading),
      paragraphs: Array.isArray(section.paragraphs)
        ? section.paragraphs.map((entry) => normalizeText(entry)).filter(Boolean)
        : [],
      bullets: Array.isArray(section.bullets)
        ? section.bullets.map((entry) => normalizeText(entry)).filter(Boolean)
        : [],
    }))
    .filter(
      (section) =>
        section.title.length > 0 || section.paragraphs.length > 0 || section.bullets.length > 0
    )
    .map((section) => ({
      title: section.title || (isPt ? "Análise" : "Analysis"),
      intro: section.paragraphs[0] || undefined,
      paragraphs: section.paragraphs.slice(section.paragraphs[0] ? 1 : 0),
      bullets: section.bullets,
    }));

  if (sections.length > 0) {
    return sections.slice(0, 8);
  }

  return [
    {
      title: isPt ? "Análise" : "Analysis",
      intro: normalizeText(input.summary),
      paragraphs: [],
      bullets: [],
    },
  ];
}

function buildAppendixItems(input: ReportDocxInput, isPt: boolean): ReportMetadataItem[] {
  const context = input.context || {};
  const appendix: ReportMetadataItem[] = [];

  if (context.reportId) {
    appendix.push({
      label: isPt ? "ID do relatório" : "Report ID",
      value: context.reportId,
      tone: "neutral",
    });
  }
  if (input.requestedQuery) {
    appendix.push({
      label: isPt ? "Pergunta original" : "Original question",
      value: input.requestedQuery,
    });
  }
  if (input.generatedAt) {
    appendix.push({
      label: isPt ? "Timestamp UTC" : "UTC timestamp",
      value: input.generatedAt,
      tone: "neutral",
    });
  }
  if (context.scopeStartAt && context.scopeEndAt) {
    appendix.push({
      label: isPt ? "Intervalo UTC" : "UTC interval",
      value: `${context.scopeStartAt} → ${context.scopeEndAt}`,
      tone: "neutral",
    });
  }
  if (context.rollupStatus) {
    appendix.push({
      label: isPt ? "Status dos rollups" : "Rollup status",
      value: rollupStatusSummary(context.rollupStatus, isPt),
      tone: "neutral",
    });
  }

  return appendix;
}

export function buildReportDocumentModel(input: ReportDocxInput): ReportDocumentModel {
  const context = input.context || {};
  const isPt = isPtLanguage(context.replyLanguage);
  const reportKindLabel = humanizeReportKind(input.reportKind, isPt);
  const metadata = buildMetadataItems(input, isPt);
  const evidence = buildReportEvidenceLayout({
    images: input.images || [],
    videos: input.videos || [],
    language: context.replyLanguage,
  });
  const kpis = buildKpis(input);
  const comparisonRows = context.comparisons || {};
  const history = context.history;
  const tables = [
    buildCameraTable(coerceRows(comparisonRows.cameras), isPt),
    buildJobTable(coerceRows(comparisonRows.jobs), isPt),
    buildAgentTable(coerceRows(comparisonRows.agents), isPt),
    buildRecentActivityTable(history, isPt),
  ].filter((table): table is ReportTable => Boolean(table));

  const topFindings = Array.isArray(context.topFindings)
    ? context.topFindings.map((entry) => normalizeText(entry)).filter(Boolean).slice(0, 4)
    : [];

  const sections = buildNarrativeSections(input, isPt);
  const summaryText =
    normalizeText(input.summary) ||
    sections[0]?.intro ||
    (isPt ? "Resumo não disponível." : "Summary not available.");
  const focusText =
    Array.isArray(context.focus) && context.focus.length > 0
      ? context.focus.map((entry) => normalizeText(entry)).filter(Boolean).join(", ")
      : isPt
      ? "Sem foco declarado"
      : "No explicit focus";
  const coverMetadata = metadata.slice(0, 4);

  return {
    cover: {
      eyebrow: isPt ? "Relatório analítico" : "Analytical report",
      title: normalizeText(input.title, isPt ? "Relatório" : "Report"),
      subtitle: [reportKindLabel, normalizeText(context.scopeLabel)].filter(Boolean).join(" • "),
      summary: summaryText,
      metadata:
        coverMetadata.length > 0
          ? coverMetadata
          : [
              {
                label: isPt ? "Foco" : "Focus",
                value: focusText,
              },
            ],
    },
    header: {
      title: normalizeText(context.applicationName, "Perceptrum"),
      subtitle: normalizeText(input.title),
    },
    footer: {
      leftText:
        [context.reportId ? `#${context.reportId}` : "", context.issuedByHandle ? `@${context.issuedByHandle}` : ""]
          .filter(Boolean)
          .join(" • ") || normalizeText(context.applicationName, "Perceptrum"),
      rightLabel: reportKindLabel,
    },
    metadataStrip: metadata.slice(0, 6),
    executiveSummary: {
      title: isPt ? "Resumo executivo" : "Executive summary",
      summary: summaryText,
      findings:
        topFindings.length > 0
          ? topFindings
          : sections.flatMap((section) => section.bullets).slice(0, 4),
    },
    kpis,
    charts: buildReportCharts(input),
    tables,
    sections,
    evidence,
    appendix: {
      title: isPt ? "Apêndice técnico" : "Technical appendix",
      items: buildAppendixItems(input, isPt),
      limitations: Array.isArray(context.limitations)
        ? context.limitations.map((entry) => normalizeText(entry)).filter(Boolean)
        : [],
      mediaLocations: evidence.mediaLocations,
    },
  };
}

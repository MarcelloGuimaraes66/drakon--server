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
  details?: Record<string, unknown>;
  resolvedEntities?: Record<string, unknown>;
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

function buildJobRunDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Ledger de runs" : "Run ledger",
    caption: isPt
      ? "Runs das tarefas com steps, agentes, alertas e identity cards."
      : "Task runs with steps, agents, alerts, and identity cards.",
    columns: [
      { key: "job", label: isPt ? "Tarefa" : "Task", widthWeight: 3.2 },
      { key: "status", label: isPt ? "Status" : "Status", widthWeight: 1.2, align: "center" },
      { key: "steps", label: isPt ? "Steps" : "Steps", widthWeight: 1.1, align: "center" },
      { key: "agents", label: isPt ? "Agentes" : "Agents", widthWeight: 1.1, align: "center" },
      { key: "alerts", label: isPt ? "Alertas" : "Alerts", widthWeight: 1.1, align: "center" },
      { key: "identities", label: isPt ? "IDs" : "IDs", widthWeight: 1.0, align: "center" },
      { key: "duration", label: isPt ? "Dur. (s)" : "Dur. (s)", widthWeight: 1.2, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      job: toDisplayValue(row.job_name, `Job ${toDisplayValue(row.job_id, "")}`),
      status: toDisplayValue(row.status, "—"),
      steps: toDisplayValue(row.step_count, "0"),
      agents: toDisplayValue(row.agent_run_count, "0"),
      alerts: toDisplayValue(row.alert_count, "0"),
      identities: toDisplayValue(row.identity_card_count, "0"),
      duration: toDisplayValue(row.duration_seconds, "—"),
    })),
  };
}

function buildStepRunDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Execucao de steps" : "Step execution",
    caption: isPt
      ? "Steps, cameras, agentes e resultados estruturados."
      : "Steps, cameras, agents, and structured results.",
    columns: [
      { key: "step", label: isPt ? "Step" : "Step", widthWeight: 3.2 },
      { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.2 },
      { key: "status", label: isPt ? "Status" : "Status", widthWeight: 1.2, align: "center" },
      { key: "agents", label: isPt ? "Agentes" : "Agents", widthWeight: 1.1, align: "center" },
      { key: "results", label: isPt ? "Resultados" : "Results", widthWeight: 1.1, align: "center" },
      { key: "alerts", label: isPt ? "Alertas" : "Alerts", widthWeight: 1.1, align: "center" },
      { key: "identities", label: isPt ? "IDs" : "IDs", widthWeight: 1.0, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      step: toDisplayValue(row.step_name, `Step ${toDisplayValue(row.step_id, "")}`),
      camera: toDisplayValue(row.camera_name, "—"),
      status: toDisplayValue(row.status, "—"),
      agents: toDisplayValue(row.agent_run_count, "0"),
      results: toDisplayValue(row.result_count, "0"),
      alerts: toDisplayValue(row.alert_count, "0"),
      identities: toDisplayValue(row.identity_card_count, "0"),
    })),
  };
}

function buildStepResultDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Resultados e respostas" : "Results and responses",
    caption: isPt
      ? "Saidas estruturadas com modelo, condicao de alerta e preview."
      : "Structured outputs with model, alert condition, and preview.",
    columns: [
      { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.1 },
      { key: "model", label: isPt ? "Modelo" : "Model", widthWeight: 1.8 },
      { key: "condition", label: isPt ? "Cond." : "Cond.", widthWeight: 0.9, align: "center" },
      { key: "confidence", label: isPt ? "Conf." : "Conf.", widthWeight: 1.0, align: "center" },
      { key: "preview", label: isPt ? "Conteúdo" : "Content", widthWeight: 4.2 },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      model: toDisplayValue(row.model, toDisplayValue(row.provider, "—")),
      condition: boolDisplay(row.alert_condition_true, isPt),
      confidence: toDisplayValue(row.confidence, "—"),
      preview: toDisplayValue(row.output_preview, "—"),
    })),
  };
}

function buildCameraAgentRunDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Execucoes de AI agents da camera" : "Camera AI agent runs",
    caption: isPt
      ? "Runs por camera com avaliacoes, positivos finais e ultima resposta."
      : "Per-camera runs with evaluations, final positives, and last response.",
    columns: [
      { key: "camera", label: isPt ? "Camera" : "Camera", widthWeight: 1.8 },
      { key: "agent", label: isPt ? "Agente" : "Agent", widthWeight: 1.8 },
      { key: "evals", label: isPt ? "Avals." : "Evals.", widthWeight: 0.9, align: "center" },
      { key: "finals", label: isPt ? "Final+" : "Final+", widthWeight: 0.9, align: "center" },
      { key: "tokens", label: isPt ? "Tokens" : "Tokens", widthWeight: 1.1, align: "center" },
      { key: "answer", label: isPt ? "Ultima resposta" : "Last response", widthWeight: 3.9 },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      agent: toDisplayValue(row.agent_key, toDisplayValue(row.algorithm_type, "--")),
      evals: toDisplayValue(row.evaluation_count, "0"),
      finals: toDisplayValue(row.final_positive_count, "0"),
      tokens: toDisplayValue(row.total_tokens_total, "0"),
      answer: toDisplayValue(row.last_answer, "--"),
    })),
  };
}

function buildResponseTimelineTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Timeline de respostas" : "Response timeline",
    caption: isPt
      ? "Respostas preservadas por execucao, com estado LLM e decisao final."
      : "Preserved responses per execution, with LLM state and final decision.",
    columns: [
      { key: "time", label: isPt ? "Horario" : "Time", widthWeight: 1.6 },
      { key: "camera", label: isPt ? "Camera" : "Camera", widthWeight: 1.8 },
      { key: "agent", label: isPt ? "Agente" : "Agent", widthWeight: 1.5 },
      { key: "llm", label: "LLM", widthWeight: 0.9, align: "center" },
      { key: "final", label: isPt ? "Final" : "Final", widthWeight: 0.9, align: "center" },
      { key: "answer", label: isPt ? "Resposta" : "Response", widthWeight: 4.3 },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      time: toDisplayValue(row.event_at, "--"),
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      agent: toDisplayValue(row.agent_key, toDisplayValue(row.status, "--")),
      llm:
        row.llm_alert_condition === null || row.llm_alert_condition === undefined
          ? "--"
          : boolDisplay(row.llm_alert_condition, isPt),
      final:
        row.final_alert_condition === null || row.final_alert_condition === undefined
          ? "--"
          : boolDisplay(row.final_alert_condition, isPt),
      answer: toDisplayValue(row.answer, toDisplayValue(row.status, "--")),
    })),
  };
}

function buildCameraSessionDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Sessoes de câmera" : "Camera sessions",
    caption: isPt
      ? "Sessões com alertas, identity cards e incidentes de conectividade."
      : "Sessions with alerts, identity cards, and connectivity incidents.",
    columns: [
      { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.8 },
      { key: "status", label: isPt ? "Status" : "Status", widthWeight: 1.2, align: "center" },
      { key: "alerts", label: isPt ? "Alertas" : "Alerts", widthWeight: 1.1, align: "center" },
      { key: "identities", label: isPt ? "IDs" : "IDs", widthWeight: 1.0, align: "center" },
      { key: "incidents", label: isPt ? "Incidentes" : "Incidents", widthWeight: 1.2, align: "center" },
      { key: "recoveries", label: isPt ? "Recups." : "Recovs.", widthWeight: 1.1, align: "center" },
      { key: "duration", label: isPt ? "Dur. (s)" : "Dur. (s)", widthWeight: 1.2, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      status: toDisplayValue(row.status, "—"),
      alerts: toDisplayValue(row.alert_count, "0"),
      identities: toDisplayValue(row.identity_card_count, "0"),
      incidents: toDisplayValue(row.connectivity_incident_count, "0"),
      recoveries: toDisplayValue(row.recovered_count, "0"),
      duration: toDisplayValue(row.duration_seconds, "—"),
    })),
  };
}

function buildAlertDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Ledger de alertas" : "Alert ledger",
    caption: isPt
      ? "Alertas com câmera, prioridade, modelo e alert_condition."
      : "Alerts with camera, priority, model, and alert_condition.",
    columns: [
      { key: "time", label: isPt ? "Horário" : "Time", widthWeight: 1.7 },
      { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.1 },
      { key: "priority", label: isPt ? "Prioridade" : "Priority", widthWeight: 1.3, align: "center" },
      { key: "condition", label: isPt ? "Cond." : "Cond.", widthWeight: 0.9, align: "center" },
      { key: "model", label: isPt ? "Modelo" : "Model", widthWeight: 1.8 },
      { key: "message", label: isPt ? "Mensagem" : "Message", widthWeight: 3.2 },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      time: toDisplayValue(row.created_at),
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      priority: toDisplayValue(row.priority_level, "—"),
      condition: boolDisplay(row.alert_condition_true, isPt),
      model: toDisplayValue(row.model, "—"),
      message: toDisplayValue(row.message, "—"),
    })),
  };
}

function buildIdentityCardDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Identity cards" : "Identity cards",
    caption: isPt
      ? "Ocorrências com vínculo de câmera, origem e crop persistido."
      : "Occurrences with linked camera, source, and persisted crop.",
    columns: [
      { key: "time", label: isPt ? "Horário" : "Time", widthWeight: 1.8 },
      { key: "identity", label: isPt ? "Identidade" : "Identity", widthWeight: 2.6 },
      { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.1 },
      { key: "source", label: isPt ? "Origem" : "Source", widthWeight: 1.5, align: "center" },
      { key: "confidence", label: isPt ? "Conf." : "Conf.", widthWeight: 1.0, align: "center" },
      { key: "crop", label: isPt ? "Crop" : "Crop", widthWeight: 0.9, align: "center" },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      time: toDisplayValue(row.created_at),
      identity: toDisplayValue(row.display_name, toDisplayValue(row.identity_card_id, "—")),
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      source: toDisplayValue(row.source_type, "—"),
      confidence: toDisplayValue(row.confidence, "—"),
      crop: boolDisplay(Boolean(row.crop_storage_key || row.crop_url), isPt),
    })),
  };
}

function buildConnectivityIncidentDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Conectividade" : "Connectivity",
    caption: isPt
      ? "Incidentes de conectividade por camera e fase."
      : "Connectivity incidents by camera and phase.",
    columns: [
      { key: "camera", label: isPt ? "Câmera" : "Camera", widthWeight: 2.4 },
      { key: "phase", label: isPt ? "Fase" : "Phase", widthWeight: 1.6, align: "center" },
      { key: "status", label: isPt ? "Status" : "Status", widthWeight: 1.2, align: "center" },
      { key: "duration", label: isPt ? "Dur. (s)" : "Dur. (s)", widthWeight: 1.1, align: "center" },
      { key: "started", label: isPt ? "Início" : "Start", widthWeight: 1.8 },
      { key: "recovered", label: isPt ? "Recup." : "Recovered", widthWeight: 1.8 },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      camera: toDisplayValue(row.camera_name, `Camera ${toDisplayValue(row.camera_id, "")}`),
      phase: toDisplayValue(row.failure_phase, "—"),
      status: toDisplayValue(row.status, "—"),
      duration: toDisplayValue(row.duration_seconds, "—"),
      started: toDisplayValue(row.started_at),
      recovered: toDisplayValue(row.recovered_at),
    })),
  };
}

function buildStructuredErrorDetailTable(
  rows: Array<Record<string, unknown>>,
  isPt: boolean
): ReportTable | null {
  if (rows.length === 0) return null;
  return {
    title: isPt ? "Erros estruturados" : "Structured errors",
    caption: isPt
      ? "Falhas de modelo, API e execucao correlacionadas."
      : "Correlated model, API, and execution failures.",
    columns: [
      { key: "time", label: isPt ? "Horário" : "Time", widthWeight: 1.7 },
      { key: "provider", label: isPt ? "Provider" : "Provider", widthWeight: 1.4, align: "center" },
      { key: "model", label: isPt ? "Modelo" : "Model", widthWeight: 1.8 },
      { key: "flow", label: isPt ? "Fluxo" : "Flow", widthWeight: 1.4, align: "center" },
      { key: "message", label: isPt ? "Mensagem" : "Message", widthWeight: 3.7 },
    ],
    rows: rows.slice(0, 6).map((row) => ({
      time: toDisplayValue(row.occurred_at),
      provider: toDisplayValue(row.provider, "—"),
      model: toDisplayValue(row.model, "—"),
      flow: toDisplayValue(row.flow, "—"),
      message: toDisplayValue(row.message, "—"),
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
  const reportKindKey = normalizeText(input.reportKind).toLowerCase();
  const focusSet = new Set(
    Array.isArray(context.focus)
      ? context.focus.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean)
      : []
  );
  const metadata = buildMetadataItems(input, isPt);
  const evidence = buildReportEvidenceLayout({
    images: input.images || [],
    videos: input.videos || [],
    language: context.replyLanguage,
  });
  const kpis = buildKpis(input);
  const comparisonRows = context.comparisons || {};
  const history = context.history;
  const detailRows = context.details || {};
  const availableTables = new Map<string, ReportTable>();
  const registerTable = (key: string, table: ReportTable | null) => {
    if (table) {
      availableTables.set(key, table);
    }
  };

  registerTable("job_runs", buildJobRunDetailTable(coerceRows(detailRows.job_runs), isPt));
  registerTable("step_runs", buildStepRunDetailTable(coerceRows(detailRows.step_runs), isPt));
  registerTable(
    "camera_agent_runs",
    buildCameraAgentRunDetailTable(coerceRows(detailRows.camera_agent_runs), isPt)
  );
  registerTable(
    "step_results",
    buildStepResultDetailTable(coerceRows(detailRows.step_results), isPt)
  );
  registerTable(
    "response_timeline",
    buildResponseTimelineTable(coerceRows(detailRows.response_timeline), isPt)
  );
  registerTable(
    "camera_sessions",
    buildCameraSessionDetailTable(coerceRows(detailRows.camera_sessions), isPt)
  );
  registerTable("alerts", buildAlertDetailTable(coerceRows(detailRows.alerts), isPt));
  registerTable(
    "identity_cards",
    buildIdentityCardDetailTable(coerceRows(detailRows.identity_cards), isPt)
  );
  registerTable(
    "connectivity",
    buildConnectivityIncidentDetailTable(coerceRows(detailRows.connectivity_incidents), isPt)
  );
  registerTable(
    "structured_errors",
    buildStructuredErrorDetailTable(coerceRows(detailRows.structured_errors), isPt)
  );
  registerTable("cameras", buildCameraTable(coerceRows(comparisonRows.cameras), isPt));
  registerTable("jobs", buildJobTable(coerceRows(comparisonRows.jobs), isPt));
  registerTable("agents", buildAgentTable(coerceRows(comparisonRows.agents), isPt));
  registerTable("recent_activity", buildRecentActivityTable(history, isPt));

  const isCameraReport = reportKindKey === "camera_health" || focusSet.has("cameras");
  const isJobReport = reportKindKey === "job_activity" || focusSet.has("jobs");
  const isAgentReport = reportKindKey === "agent_activity" || focusSet.has("agents");
  const isAlertReport = reportKindKey === "detections_alerts" || focusSet.has("detections");

  let tableOrder: string[];
  if (isCameraReport) {
    tableOrder = [
      "camera_sessions",
      "camera_agent_runs",
      "connectivity",
      "alerts",
      "identity_cards",
      "step_results",
      "response_timeline",
      "step_runs",
      "job_runs",
      "structured_errors",
      "cameras",
      "recent_activity",
    ];
  } else if (isJobReport) {
    tableOrder = [
      "job_runs",
      "step_runs",
      "camera_agent_runs",
      "step_results",
      "response_timeline",
      "alerts",
      "identity_cards",
      "structured_errors",
      "camera_sessions",
      "jobs",
      "agents",
      "recent_activity",
    ];
  } else if (isAgentReport) {
    tableOrder = [
      "camera_agent_runs",
      "step_runs",
      "step_results",
      "response_timeline",
      "job_runs",
      "structured_errors",
      "alerts",
      "camera_sessions",
      "agents",
      "recent_activity",
      "jobs",
    ];
  } else if (isAlertReport) {
    tableOrder = [
      "alerts",
      "camera_agent_runs",
      "step_results",
      "response_timeline",
      "identity_cards",
      "camera_sessions",
      "step_runs",
      "job_runs",
      "connectivity",
      "recent_activity",
      "cameras",
    ];
  } else {
    tableOrder = [
      "camera_sessions",
      "camera_agent_runs",
      "job_runs",
      "step_runs",
      "step_results",
      "alerts",
      "identity_cards",
      "structured_errors",
      "cameras",
      "jobs",
      "agents",
      "recent_activity",
    ];
  }

  const tables: ReportTable[] = [];
  for (const key of tableOrder) {
    const table = availableTables.get(key);
    if (table && !tables.includes(table)) {
      tables.push(table);
    }
    if (tables.length >= 7) {
      break;
    }
  }
  if (tables.length < 7) {
    for (const table of availableTables.values()) {
      if (!tables.includes(table)) {
        tables.push(table);
      }
      if (tables.length >= 7) {
        break;
      }
    }
  }

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

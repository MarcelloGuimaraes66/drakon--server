import type {
  ReportChartBlock,
  ReportChartDatum,
  ReportDocxInput,
} from "./reportBlocks";
import type { ReportTone } from "./reportTheme";

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

function toFiniteNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function trimLabel(label: string, maxLength = 32): string {
  const normalized = normalizeText(label);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function chartToneForScore(value: number): ReportTone {
  if (value <= 45) return "critical";
  if (value <= 75) return "warning";
  if (value >= 90) return "success";
  return "primary";
}

function normalizeChartItems(
  items: readonly ReportChartDatum[],
  limit = 5
): ReportChartDatum[] {
  return items
    .map((item) => ({
      label: trimLabel(normalizeText(item.label), 32),
      value: Math.max(0, toFiniteNumber(item.value)),
      tone: item.tone,
    }))
    .filter((item) => item.label.length > 0)
    .slice(0, limit);
}

function aggregateChartItems(
  rows: Array<Record<string, unknown>>,
  labelResolver: (row: Record<string, unknown>) => string,
  valueResolver: (row: Record<string, unknown>) => number,
  tone: ReportTone = "primary",
  limit = 5
): ReportChartDatum[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const label = normalizeText(labelResolver(row));
    if (!label) continue;
    grouped.set(label, (grouped.get(label) || 0) + Math.max(0, valueResolver(row)));
  }
  return normalizeChartItems(
    Array.from(grouped.entries())
      .map(([label, value]) => ({ label, value, tone }))
      .filter((item) => item.value > 0)
      .sort((left, right) => right.value - left.value),
    limit
  );
}

function buildChartBlock(params: {
  isPt: boolean;
  titlePt: string;
  titleEn: string;
  captionPt: string;
  captionEn: string;
  items: ReportChartDatum[];
  maxValue?: number;
}): ReportChartBlock | null {
  const items = normalizeChartItems(params.items);
  if (items.length === 0) return null;
  return {
    title: params.isPt ? params.titlePt : params.titleEn,
    caption: params.isPt ? params.captionPt : params.captionEn,
    items,
    maxValue: params.maxValue,
  };
}

function buildSignalChart(input: ReportDocxInput, isPt: boolean): ReportChartBlock | null {
  const stats = new Map<string, string>();
  for (const stat of input.stats || []) {
    const key = normalizeText(stat.label).toLowerCase();
    if (key) {
      stats.set(key, normalizeText(stat.value));
    }
  }

  const items = [
    {
      label: isPt ? "Deteccoes" : "Detections",
      value: toFiniteNumber(
        stats.get("deteccoes na janela") || stats.get("detections in window")
      ),
      tone: "success" as const,
    },
    {
      label: isPt ? "Alertas" : "Alerts",
      value: toFiniteNumber(stats.get("alertas na janela") || stats.get("alerts in window")),
      tone: "warning" as const,
    },
    {
      label: isPt ? "Comandos" : "Commands",
      value: toFiniteNumber(stats.get("comandos na janela") || stats.get("commands in window")),
      tone: "primary" as const,
    },
    {
      label: isPt ? "Erros" : "Errors",
      value: toFiniteNumber(
        stats.get("erros de agentes na janela") || stats.get("agent errors in window")
      ),
      tone: "critical" as const,
    },
  ].filter((item) => item.value > 0);

  return buildChartBlock({
    isPt,
    titlePt: "Volume operacional",
    titleEn: "Operational volume",
    captionPt: "Leitura rapida da movimentacao do periodo selecionado.",
    captionEn: "Quick read of the selected window's operational flow.",
    items,
  });
}

export function buildReportCharts(input: ReportDocxInput): ReportChartBlock[] {
  const context = input.context || {};
  const comparisons = context.comparisons || {};
  const details = context.details || {};
  const isPt = isPtLanguage(context.replyLanguage);
  const reportKind = normalizeText(input.reportKind).toLowerCase();
  const focusSet = new Set(
    Array.isArray(context.focus)
      ? context.focus.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean)
      : []
  );

  const stepChart = buildChartBlock({
    isPt,
    titlePt: "Steps com mais sinal",
    titleEn: "Top signal steps",
    captionPt: "Highlights de atividade operacional por step.",
    captionEn: "Operational highlights by step.",
    items: coerceRows(comparisons.steps)
      .map((row) => ({
        label: normalizeText(row.step_name, `Step ${normalizeText(row.step_id, "")}`),
        value: toFiniteNumber(row.activity_score || row.alert_count || row.result_count),
        tone: "warning" as const,
      }))
      .filter((row) => row.label && row.value > 0),
  });

  const sessionChart = buildChartBlock({
    isPt,
    titlePt: "Sessoes por camera",
    titleEn: "Sessions by camera",
    captionPt: "Mostra quais cameras concentraram mais sessoes operacionais.",
    captionEn: "Shows which cameras concentrated the most operational sessions.",
    items: coerceRows(comparisons.sessions_by_camera)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.session_count),
        tone: "primary" as const,
      }))
      .filter((row) => row.label && row.value > 0),
  });

  const alertChart = buildChartBlock({
    isPt,
    titlePt: "Alertas por camera",
    titleEn: "Alerts by camera",
    captionPt: "Ajuda a localizar as cameras com maior volume de alerta.",
    captionEn: "Helps locate the cameras with the highest alert volume.",
    items: coerceRows(comparisons.alerts_by_camera)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.alert_count),
        tone: "warning" as const,
      }))
      .filter((row) => row.label && row.value > 0),
  });

  const agentRunChart = buildChartBlock({
    isPt,
    titlePt: "Execucoes por agente",
    titleEn: "Executions by agent",
    captionPt: "Mostra os agentes que mais rodaram no periodo solicitado.",
    captionEn: "Shows the agents that ran the most in the requested period.",
    items: aggregateChartItems(
      coerceRows(details.agent_runs),
      (row) => normalizeText(row.agent_key, `Agent ${normalizeText(row.agent_run_id, "")}`),
      () => 1,
      "success",
      5
    ),
  });

  const identityChart = buildChartBlock({
    isPt,
    titlePt: "Identity cards por camera",
    titleEn: "Identity cards by camera",
    captionPt: "Resume quais cameras geraram mais identity cards no periodo.",
    captionEn: "Summarizes which cameras generated the most identity cards.",
    items: coerceRows(comparisons.identity_cards_by_camera)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.identity_card_count),
        tone: "critical" as const,
      }))
      .filter((row) => row.label && row.value > 0),
  });

  const connectivityChart = buildChartBlock({
    isPt,
    titlePt: "Incidentes por camera",
    titleEn: "Incidents by camera",
    captionPt: "Destaca as cameras com mais incidentes de conectividade.",
    captionEn: "Highlights cameras with the most connectivity incidents.",
    items: aggregateChartItems(
      coerceRows(details.connectivity_incidents),
      (row) => normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
      () => 1,
      "critical",
      5
    ),
  });

  const cameraRows = normalizeChartItems(
    coerceRows(comparisons.cameras)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.stability_score),
        tone: chartToneForScore(toFiniteNumber(row.stability_score)),
      }))
      .filter((row) => row.label && row.value >= 0),
    5
  );
  const cameraStabilityChart =
    cameraRows.length > 0
      ? {
          title: isPt ? "Estabilidade por camera" : "Stability by camera",
          caption: isPt
            ? "Score agregado por camera no recorte analisado."
            : "Aggregated camera score for the selected window.",
          items: cameraRows,
          maxValue: 100,
        }
      : null;

  const jobRows = normalizeChartItems(
    coerceRows(comparisons.jobs)
      .map((row) => ({
        label: normalizeText(row.job_name, `Job ${normalizeText(row.job_id, "")}`),
        value: toFiniteNumber(row.activity_score || row.run_count),
        tone: "primary" as const,
      }))
      .filter((row) => row.label && row.value > 0),
    5
  );
  const jobActivityChart =
    jobRows.length > 0
      ? {
          title: isPt ? "Atividade de jobs" : "Job activity",
          caption: isPt
            ? "Jobs com maior score de atividade recente."
            : "Jobs with the highest recent activity score.",
          items: jobRows,
        }
      : null;

  const signalChart = buildSignalChart(input, isPt);
  const availableCharts = new Map<string, ReportChartBlock>();
  const registerChart = (key: string, chart: ReportChartBlock | null) => {
    if (chart) {
      availableCharts.set(key, chart);
    }
  };

  registerChart("step_activity", stepChart);
  registerChart("camera_sessions", sessionChart);
  registerChart("alerts_by_camera", alertChart);
  registerChart("agent_runs", agentRunChart);
  registerChart("identity_cards_by_camera", identityChart);
  registerChart("connectivity_by_camera", connectivityChart);
  registerChart("camera_stability", cameraStabilityChart);
  registerChart("job_activity", jobActivityChart);
  registerChart("operational_volume", signalChart);

  const isCameraReport = reportKind === "camera_health" || focusSet.has("cameras");
  const isJobReport = reportKind === "job_activity" || focusSet.has("jobs");
  const isAgentReport = reportKind === "agent_activity" || focusSet.has("agents");
  const isAlertReport = reportKind === "detections_alerts" || focusSet.has("detections");
  const isHistoryReport = reportKind === "history";
  const isComparisonReport = reportKind === "comparison";

  let preferredOrder: string[];
  if (isCameraReport) {
    preferredOrder = [
      "camera_sessions",
      "alerts_by_camera",
      "identity_cards_by_camera",
      "connectivity_by_camera",
      "camera_stability",
      "agent_runs",
      "step_activity",
      "job_activity",
      "operational_volume",
    ];
  } else if (isJobReport) {
    preferredOrder = [
      "step_activity",
      "agent_runs",
      "alerts_by_camera",
      "identity_cards_by_camera",
      "camera_sessions",
      "job_activity",
      "connectivity_by_camera",
      "operational_volume",
      "camera_stability",
    ];
  } else if (isAgentReport) {
    preferredOrder = [
      "agent_runs",
      "step_activity",
      "alerts_by_camera",
      "camera_sessions",
      "identity_cards_by_camera",
      "job_activity",
      "operational_volume",
      "camera_stability",
      "connectivity_by_camera",
    ];
  } else if (isAlertReport) {
    preferredOrder = [
      "alerts_by_camera",
      "identity_cards_by_camera",
      "step_activity",
      "agent_runs",
      "camera_sessions",
      "operational_volume",
      "camera_stability",
      "job_activity",
      "connectivity_by_camera",
    ];
  } else if (isHistoryReport) {
    preferredOrder = [
      "camera_sessions",
      "step_activity",
      "agent_runs",
      "alerts_by_camera",
      "identity_cards_by_camera",
      "connectivity_by_camera",
      "operational_volume",
      "camera_stability",
      "job_activity",
    ];
  } else if (isComparisonReport) {
    preferredOrder = [
      "camera_stability",
      "job_activity",
      "step_activity",
      "alerts_by_camera",
      "agent_runs",
      "camera_sessions",
      "identity_cards_by_camera",
      "connectivity_by_camera",
      "operational_volume",
    ];
  } else {
    preferredOrder = [
      "camera_stability",
      "job_activity",
      "alerts_by_camera",
      "operational_volume",
      "step_activity",
      "agent_runs",
      "camera_sessions",
      "identity_cards_by_camera",
      "connectivity_by_camera",
    ];
  }

  const charts: ReportChartBlock[] = [];
  for (const key of preferredOrder) {
    const chart = availableCharts.get(key);
    if (chart && !charts.includes(chart)) {
      charts.push(chart);
    }
    if (charts.length >= 5) {
      return charts;
    }
  }

  for (const chart of availableCharts.values()) {
    if (!charts.includes(chart)) {
      charts.push(chart);
    }
    if (charts.length >= 5) {
      break;
    }
  }

  return charts;
}

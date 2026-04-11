import type { ReportChartBlock, ReportDocxInput } from "./reportBlocks";
import { REPORT_THEME, reportToneInk, type ReportTone } from "./reportTheme";

type ChartDatum = {
  label: string;
  value: number;
  tone?: ReportTone;
};

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

function trimLabel(label: string, maxLength = 28): string {
  const normalized = normalizeText(label);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function svgBytes(svg: string): Uint8Array {
  return new TextEncoder().encode(svg);
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function chartToneForScore(value: number): ReportTone {
  if (value <= 45) return "critical";
  if (value <= 75) return "warning";
  if (value >= 90) return "success";
  return "primary";
}

function horizontalBarChartSvg(params: {
  title: string;
  subtitle: string;
  items: ChartDatum[];
  maxValue?: number;
}): string {
  const width = 1200;
  const height = Math.max(340, 160 + params.items.length * 84);
  const maxValue = Math.max(params.maxValue || 0, ...params.items.map((item) => item.value), 1);
  const chartLeft = 310;
  const chartWidth = 760;
  const barHeight = 34;
  const startY = 110;

  const rows = params.items
    .map((item, index) => {
      const y = startY + index * 78;
      const widthValue = Math.max(12, (item.value / maxValue) * chartWidth);
      const tone = item.tone || "primary";
      return [
        `<text x="56" y="${y + 22}" font-family="${REPORT_THEME.fonts.body}" font-size="25" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(trimLabel(item.label, 30))}</text>`,
        `<rect x="${chartLeft}" y="${y}" width="${chartWidth}" height="${barHeight}" rx="12" fill="#${REPORT_THEME.colors.surfaceMuted}"/>`,
        `<rect x="${chartLeft}" y="${y}" width="${widthValue}" height="${barHeight}" rx="12" fill="#${reportToneInk(tone)}"/>`,
        `<text x="${chartLeft + chartWidth + 26}" y="${y + 24}" text-anchor="end" font-family="${REPORT_THEME.fonts.display}" font-size="24" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(String(Number(item.value.toFixed(2))))}</text>`,
      ].join("");
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#${REPORT_THEME.colors.surfaceAlt}"/>`,
    `<rect x="42" y="36" width="6" height="48" rx="3" fill="#${REPORT_THEME.colors.accent}"/>`,
    `<text x="64" y="58" font-family="${REPORT_THEME.fonts.display}" font-size="34" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(params.title)}</text>`,
    `<text x="64" y="88" font-family="${REPORT_THEME.fonts.body}" font-size="20" fill="#${REPORT_THEME.colors.muted}">${escapeSvgText(params.subtitle)}</text>`,
    rows,
    "</svg>",
  ].join("");
}

function verticalBarChartSvg(params: {
  title: string;
  subtitle: string;
  items: ChartDatum[];
}): string {
  const width = 1200;
  const height = 540;
  const chartHeight = 250;
  const chartWidth = 980;
  const left = 120;
  const bottom = 430;
  const maxValue = Math.max(...params.items.map((item) => item.value), 1);
  const barGap = 36;
  const totalGaps = Math.max(0, params.items.length - 1) * barGap;
  const barWidth = Math.max(72, (chartWidth - totalGaps) / Math.max(1, params.items.length));

  const bars = params.items
    .map((item, index) => {
      const heightValue = Math.max(14, (item.value / maxValue) * chartHeight);
      const x = left + index * (barWidth + barGap);
      const y = bottom - heightValue;
      const tone = item.tone || "primary";
      return [
        `<rect x="${x}" y="${y}" width="${barWidth}" height="${heightValue}" rx="16" fill="#${reportToneInk(tone)}"/>`,
        `<text x="${x + barWidth / 2}" y="${y - 14}" text-anchor="middle" font-family="${REPORT_THEME.fonts.display}" font-size="24" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(String(Number(item.value.toFixed(2))))}</text>`,
        `<text x="${x + barWidth / 2}" y="${bottom + 34}" text-anchor="middle" font-family="${REPORT_THEME.fonts.body}" font-size="22" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(trimLabel(item.label, 14))}</text>`,
      ].join("");
    })
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="28" fill="#${REPORT_THEME.colors.surfaceAlt}"/>`,
    `<rect x="42" y="36" width="6" height="48" rx="3" fill="#${REPORT_THEME.colors.primary}"/>`,
    `<text x="64" y="58" font-family="${REPORT_THEME.fonts.display}" font-size="34" font-weight="700" fill="#${REPORT_THEME.colors.ink}">${escapeSvgText(params.title)}</text>`,
    `<text x="64" y="88" font-family="${REPORT_THEME.fonts.body}" font-size="20" fill="#${REPORT_THEME.colors.muted}">${escapeSvgText(params.subtitle)}</text>`,
    `<line x1="${left}" y1="${bottom}" x2="${left + chartWidth}" y2="${bottom}" stroke="#${REPORT_THEME.colors.lineStrong}" stroke-width="2"/>`,
    bars,
    "</svg>",
  ].join("");
}

function aggregateChartItems(
  rows: Array<Record<string, unknown>>,
  labelResolver: (row: Record<string, unknown>) => string,
  valueResolver: (row: Record<string, unknown>) => number,
  tone: ReportTone = "primary",
  limit = 5
): ChartDatum[] {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const label = normalizeText(labelResolver(row));
    if (!label) continue;
    grouped.set(label, (grouped.get(label) || 0) + Math.max(0, valueResolver(row)));
  }
  return Array.from(grouped.entries())
    .map(([label, value]) => ({ label, value, tone }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, limit);
}

function buildHorizontalChartBlock(params: {
  isPt: boolean;
  titlePt: string;
  titleEn: string;
  subtitlePt: string;
  subtitleEn: string;
  captionPt: string;
  captionEn: string;
  filename: string;
  items: ChartDatum[];
  maxValue?: number;
}): ReportChartBlock | null {
  if (params.items.length === 0) return null;
  const title = params.isPt ? params.titlePt : params.titleEn;
  return {
    title,
    caption: params.isPt ? params.captionPt : params.captionEn,
    filename: params.filename,
    contentType: "image/svg+xml",
    bytes: svgBytes(
      horizontalBarChartSvg({
        title,
        subtitle: params.isPt ? params.subtitlePt : params.subtitleEn,
        items: params.items,
        maxValue: params.maxValue,
      })
    ),
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
      tone: "success",
    },
    {
      label: isPt ? "Alertas" : "Alerts",
      value: toFiniteNumber(stats.get("alertas na janela") || stats.get("alerts in window")),
      tone: "warning",
    },
    {
      label: isPt ? "Comandos" : "Commands",
      value: toFiniteNumber(stats.get("comandos na janela") || stats.get("commands in window")),
      tone: "primary",
    },
    {
      label: isPt ? "Erros" : "Errors",
      value: toFiniteNumber(
        stats.get("erros de agentes na janela") || stats.get("agent errors in window")
      ),
      tone: "critical",
    },
  ] satisfies ChartDatum[];

  const visibleItems = items.filter((item) => item.value > 0);
  if (visibleItems.length === 0) {
    return null;
  }

  return {
    title: isPt ? "Volume operacional" : "Operational volume",
    caption: isPt
      ? "Leitura rapida da movimentacao do periodo selecionado."
      : "Quick read of the selected window's operational flow.",
    filename: "chart-operational-volume.svg",
    contentType: "image/svg+xml",
    bytes: svgBytes(
      verticalBarChartSvg({
        title: isPt ? "Volume operacional" : "Operational volume",
        subtitle: isPt
          ? "Deteccoes, alertas, comandos e erros"
          : "Detections, alerts, commands, and errors",
        items: visibleItems,
      })
    ),
  };
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

  const stepChart = buildHorizontalChartBlock({
    isPt,
    titlePt: "Steps com mais sinal",
    titleEn: "Top signal steps",
    subtitlePt: "Execucao, resultados e alertas por step",
    subtitleEn: "Execution, results, and alerts by step",
    captionPt: "Highlights de atividade operacional por step.",
    captionEn: "Operational highlights by step.",
    filename: "chart-step-activity.svg",
    items: coerceRows(comparisons.steps)
      .map((row) => ({
        label: normalizeText(row.step_name, `Step ${normalizeText(row.step_id, "")}`),
        value: toFiniteNumber(row.activity_score || row.alert_count || row.result_count),
        tone: "warning" as const,
      }))
      .filter((row) => row.label && row.value > 0)
      .slice(0, 5),
  });

  const sessionChart = buildHorizontalChartBlock({
    isPt,
    titlePt: "Sessoes por camera",
    titleEn: "Sessions by camera",
    subtitlePt: "Quantidade de sessoes no periodo",
    subtitleEn: "Number of sessions in the window",
    captionPt: "Mostra quais cameras concentraram mais sessoes operacionais.",
    captionEn: "Shows which cameras concentrated the most operational sessions.",
    filename: "chart-camera-sessions.svg",
    items: coerceRows(comparisons.sessions_by_camera)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.session_count),
        tone: "primary" as const,
      }))
      .filter((row) => row.label && row.value > 0)
      .slice(0, 5),
  });

  const alertChart = buildHorizontalChartBlock({
    isPt,
    titlePt: "Alertas por camera",
    titleEn: "Alerts by camera",
    subtitlePt: "Alertas estruturados emitidos por camera",
    subtitleEn: "Structured alerts emitted by camera",
    captionPt: "Ajuda a localizar as cameras com maior volume de alerta.",
    captionEn: "Helps locate the cameras with the highest alert volume.",
    filename: "chart-alerts-by-camera.svg",
    items: coerceRows(comparisons.alerts_by_camera)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.alert_count),
        tone: "warning" as const,
      }))
      .filter((row) => row.label && row.value > 0)
      .slice(0, 5),
  });

  const agentRunChart = buildHorizontalChartBlock({
    isPt,
    titlePt: "Execucoes por agente",
    titleEn: "Executions by agent",
    subtitlePt: "Agentes com mais execucoes no recorte",
    subtitleEn: "Agents with the most executions in the window",
    captionPt: "Mostra os agentes que mais rodaram no periodo solicitado.",
    captionEn: "Shows the agents that ran the most in the requested period.",
    filename: "chart-agent-runs.svg",
    items: aggregateChartItems(
      coerceRows(details.agent_runs),
      (row) => normalizeText(row.agent_key, `Agent ${normalizeText(row.agent_run_id, "")}`),
      () => 1,
      "success",
      5
    ),
  });

  const identityChart = buildHorizontalChartBlock({
    isPt,
    titlePt: "Identity cards por camera",
    titleEn: "Identity cards by camera",
    subtitlePt: "Ocorrencias com crop e vinculo operacional",
    subtitleEn: "Occurrences with crop and operational linkage",
    captionPt: "Resume quais cameras geraram mais identity cards no periodo.",
    captionEn: "Summarizes which cameras generated the most identity cards.",
    filename: "chart-identity-cards.svg",
    items: coerceRows(comparisons.identity_cards_by_camera)
      .map((row) => ({
        label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
        value: toFiniteNumber(row.identity_card_count),
        tone: "critical" as const,
      }))
      .filter((row) => row.label && row.value > 0)
      .slice(0, 5),
  });

  const connectivityChart = buildHorizontalChartBlock({
    isPt,
    titlePt: "Incidentes por camera",
    titleEn: "Incidents by camera",
    subtitlePt: "Falhas e recuperacoes registradas no periodo",
    subtitleEn: "Failures and recoveries recorded in the window",
    captionPt: "Destaca as cameras com mais incidentes de conectividade.",
    captionEn: "Highlights cameras with the most connectivity incidents.",
    filename: "chart-connectivity-by-camera.svg",
    items: aggregateChartItems(
      coerceRows(details.connectivity_incidents),
      (row) => normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
      () => 1,
      "critical",
      5
    ),
  });

  const cameraRows = coerceRows(comparisons.cameras)
    .map((row) => ({
      label: normalizeText(row.camera_name, `Camera ${normalizeText(row.camera_id, "")}`),
      value: toFiniteNumber(row.stability_score),
      tone: chartToneForScore(toFiniteNumber(row.stability_score)),
    }))
    .filter((row) => row.label && row.value >= 0)
    .slice(0, 5);
  const cameraStabilityChart =
    cameraRows.length > 0
      ? {
          title: isPt ? "Estabilidade por camera" : "Stability by camera",
          caption: isPt
            ? "Score agregado por camera no recorte analisado."
            : "Aggregated camera score for the selected window.",
          filename: "chart-camera-stability.svg",
          contentType: "image/svg+xml",
          bytes: svgBytes(
            horizontalBarChartSvg({
              title: isPt ? "Estabilidade por camera" : "Stability by camera",
              subtitle: isPt ? "Quanto maior, mais estavel" : "Higher means more stable",
              items: cameraRows,
              maxValue: 100,
            })
          ),
        }
      : null;

  const jobRows = coerceRows(comparisons.jobs)
    .map((row) => ({
      label: normalizeText(row.job_name, `Job ${normalizeText(row.job_id, "")}`),
      value: toFiniteNumber(row.activity_score || row.run_count),
      tone: "primary" as const,
    }))
    .filter((row) => row.label && row.value > 0)
    .slice(0, 5);
  const jobActivityChart =
    jobRows.length > 0
      ? {
          title: isPt ? "Atividade de jobs" : "Job activity",
          caption: isPt
            ? "Jobs com maior score de atividade recente."
            : "Jobs with the highest recent activity score.",
          filename: "chart-job-activity.svg",
          contentType: "image/svg+xml",
          bytes: svgBytes(
            horizontalBarChartSvg({
              title: isPt ? "Atividade de jobs" : "Job activity",
              subtitle: isPt ? "Baseado em runs, etapas e alertas" : "Based on runs, steps, and alerts",
              items: jobRows,
            })
          ),
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

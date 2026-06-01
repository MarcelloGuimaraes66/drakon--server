export const BRAZIL_STATES = [
  { code: "AC", name: "Acre", region: "North" },
  { code: "AL", name: "Alagoas", region: "Northeast" },
  { code: "AP", name: "Amapa", region: "North" },
  { code: "AM", name: "Amazonas", region: "North" },
  { code: "BA", name: "Bahia", region: "Northeast" },
  { code: "CE", name: "Ceara", region: "Northeast" },
  { code: "DF", name: "Distrito Federal", region: "Central-West" },
  { code: "ES", name: "Espirito Santo", region: "Southeast" },
  { code: "GO", name: "Goias", region: "Central-West" },
  { code: "MA", name: "Maranhao", region: "Northeast" },
  { code: "MT", name: "Mato Grosso", region: "Central-West" },
  { code: "MS", name: "Mato Grosso do Sul", region: "Central-West" },
  { code: "MG", name: "Minas Gerais", region: "Southeast" },
  { code: "PA", name: "Para", region: "North" },
  { code: "PB", name: "Paraiba", region: "Northeast" },
  { code: "PR", name: "Parana", region: "South" },
  { code: "PE", name: "Pernambuco", region: "Northeast" },
  { code: "PI", name: "Piaui", region: "Northeast" },
  { code: "RJ", name: "Rio de Janeiro", region: "Southeast" },
  { code: "RN", name: "Rio Grande do Norte", region: "Northeast" },
  { code: "RS", name: "Rio Grande do Sul", region: "South" },
  { code: "RO", name: "Rondonia", region: "North" },
  { code: "RR", name: "Roraima", region: "North" },
  { code: "SC", name: "Santa Catarina", region: "South" },
  { code: "SP", name: "Sao Paulo", region: "Southeast" },
  { code: "SE", name: "Sergipe", region: "Northeast" },
  { code: "TO", name: "Tocantins", region: "North" },
] as const;

export type BrazilStateCode = (typeof BRAZIL_STATES)[number]["code"];

const BRAZIL_STATE_SORT_INDEX = new Map<BrazilStateCode, number>(
  BRAZIL_STATES.map((state, index) => [state.code, index])
);

export const BRAZIL_STATE_NAME_BY_CODE = Object.fromEntries(
  BRAZIL_STATES.map((state) => [state.code, state.name])
) as Record<BrazilStateCode, string>;

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bestado\b/g, " ")
    .replace(/\bdo\b|\bda\b|\bdas\b|\bde\b|\bdos\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const BRAZIL_STATE_ALIAS_MAP = new Map<string, BrazilStateCode>();

for (const state of BRAZIL_STATES) {
  BRAZIL_STATE_ALIAS_MAP.set(foldText(state.code), state.code);
  BRAZIL_STATE_ALIAS_MAP.set(foldText(state.name), state.code);
}

BRAZIL_STATE_ALIAS_MAP.set("brasilia", "DF");

export function normalizeBrazilStateCode(value: unknown): BrazilStateCode | null {
  if (typeof value !== "string") return null;
  const folded = foldText(value);
  if (!folded) return null;
  return BRAZIL_STATE_ALIAS_MAP.get(folded) || null;
}

export function normalizeBrazilStateSelection(values: unknown): BrazilStateCode[] {
  const items = Array.isArray(values) ? values : [values];
  const seen = new Set<BrazilStateCode>();
  for (const item of items) {
    const code = normalizeBrazilStateCode(item);
    if (code) {
      seen.add(code);
    }
  }
  return Array.from(seen).sort(
    (left, right) =>
      (BRAZIL_STATE_SORT_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (BRAZIL_STATE_SORT_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function normalizeCountryCode(
  value: unknown,
  fallbackStateCode?: BrazilStateCode | null
): string | null {
  if (typeof value === "string") {
    const raw = value.trim();
    if (raw) {
      const folded = foldText(raw);
      if (
        folded === "br" ||
        folded === "bra" ||
        folded === "brazil" ||
        folded === "brasil"
      ) {
        return "BR";
      }

      const upper = raw.toUpperCase();
      if (/^[A-Z]{2}$/.test(upper)) {
        return upper;
      }
    }
  }

  if (fallbackStateCode) {
    return "BR";
  }

  return null;
}

export function getBrazilStateName(code: unknown): string {
  const normalized = normalizeBrazilStateCode(code);
  return normalized ? BRAZIL_STATE_NAME_BY_CODE[normalized] : "";
}

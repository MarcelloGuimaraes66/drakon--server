import { COUNTRIES, type Country } from "@/react-app/data/countries";
import { normalizeCountryCode } from "@/shared/brazilStates";

function normalizeCountrySearchValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const COUNTRY_BY_CODE = new Map<string, Country>();
const COUNTRY_BY_NAME = new Map<string, Country>();

for (const country of COUNTRIES) {
  COUNTRY_BY_CODE.set(country.code.toUpperCase(), country);
  COUNTRY_BY_NAME.set(normalizeCountrySearchValue(country.name), country);
}

export function resolveCountryOption(value: unknown): Country | null {
  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const byCode = COUNTRY_BY_CODE.get(raw.toUpperCase());
  if (byCode) {
    return byCode;
  }

  const byName = COUNTRY_BY_NAME.get(normalizeCountrySearchValue(raw));
  if (byName) {
    return byName;
  }

  const normalizedCode = normalizeCountryCode(raw, null);
  if (!normalizedCode) {
    return null;
  }

  return COUNTRY_BY_CODE.get(normalizedCode) || null;
}

export function resolveCountryCodeFromValue(value: unknown): string | null {
  return resolveCountryOption(value)?.code || normalizeCountryCode(value, null);
}

export function resolveCountryNameFromValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return resolveCountryOption(value)?.name || value.trim();
}

export function filterCountries(query: string): Country[] {
  const normalizedQuery = normalizeCountrySearchValue(query);
  if (!normalizedQuery) {
    return COUNTRIES;
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");

  return COUNTRIES.filter((country) => {
    const normalizedName = normalizeCountrySearchValue(country.name);
    const compactName = normalizedName.replace(/\s+/g, "");

    return (
      normalizedName.includes(normalizedQuery) ||
      compactName.includes(compactQuery) ||
      country.code.toLowerCase().includes(compactQuery)
    );
  });
}

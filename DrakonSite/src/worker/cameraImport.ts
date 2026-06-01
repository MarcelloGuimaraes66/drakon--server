import * as XLSX from "xlsx";
import {
  CAMERA_IMPORT_REQUIRED_FIELDS,
  type CameraImportCandidate,
  type CameraImportPreview,
  type CameraImportSharedDefaults,
  type CameraImportSourceRow,
} from "@/shared/cameraImport";

const CAMERA_IMPORT_MAX_ROWS = 250;
const CAMERA_IMPORT_MAX_COLUMNS = 64;

const CAMERA_IMPORT_SHAREABLE_FIELDS = [
  "manufacturer",
  "username",
  "password",
  "rtsp_port",
  "connection_method",
  "channel",
  "subtype",
] as const;

const CAMERA_IMPORT_FIELD_ALIASES = {
  name: [
    "name",
    "camera",
    "camera_name",
    "camera_label",
    "camera_nome",
    "camera_nombre",
    "nome",
    "nombre",
    "nom",
    "label",
  ],
  ip_address: [
    "ip",
    "ip_address",
    "ipaddr",
    "ipv4",
    "host",
    "hostname",
    "ip_host",
    "ip_or_host",
    "endereco_ip",
    "enderecoip",
    "host_ip",
  ],
  rtsp_port: [
    "rtsp_port",
    "port",
    "porta",
    "porta_rtsp",
    "puerto",
    "puerto_rtsp",
    "port_rtsp",
  ],
  manufacturer: [
    "manufacturer",
    "fabricante",
    "fabricant",
    "factory",
    "brand",
    "marca",
    "vendor",
    "make",
  ],
  username: [
    "username",
    "user",
    "usuario",
    "utilisateur",
    "login",
    "user_name",
    "nome_de_usuario",
  ],
  password: [
    "password",
    "pass",
    "passwd",
    "senha",
    "contrasena",
    "contrasenia",
    "mot_de_passe",
    "pwd",
  ],
  channel: ["channel", "canal", "ch", "camera_channel", "stream_channel"],
  subtype: ["subtype", "sub_type", "subtipo", "sub_tipo", "stream_type", "perfil"],
  connection_method: [
    "connection_method",
    "method",
    "metodo",
    "metodo_conexao",
    "tipo_conexao",
    "protocol",
    "protocolo",
  ],
  description: [
    "description",
    "descricao",
    "descripcion",
    "descripcio",
    "desc",
    "notes",
    "note",
    "observacoes",
    "observacao",
    "obs",
    "setor",
    "sector",
  ],
  street: ["street", "rua", "logradouro", "calle", "rue", "address", "endereco", "direccion"],
  number: ["number", "numero", "num", "address_number", "numero_endereco"],
  city: ["city", "cidade", "ciudad", "ville", "municipio"],
  state: ["state", "estado", "province", "provincia", "uf", "region", "etat"],
  zip_code: [
    "zip",
    "zip_code",
    "zipcode",
    "postal_code",
    "postcode",
    "cep",
    "codigo_postal",
    "code_postal",
  ],
  country: ["country", "pais", "pays", "country_code"],
  stream_url: ["rtsp", "rtsp_url", "stream_url", "url", "link", "uri"],
} as const;

const CAMERA_IMPORT_MANUFACTURER_ALIASES = new Map<string, string>([
  ["hikvision", "Hikvision"],
  ["hik", "Hikvision"],
  ["dahua", "Dahua"],
  ["intelbras", "Intelbras"],
  ["axis", "Axis"],
  ["hanwha", "Hanwha"],
  ["wisenet", "Hanwha"],
  ["uniview", "Uniview"],
  ["giga", "Giga"],
  ["vivotek", "Vivotek"],
  ["bosch", "Bosch"],
  ["sony", "Sony"],
  ["panasonic", "Panasonic"],
]);

type CameraImportShareableField =
  (typeof CAMERA_IMPORT_SHAREABLE_FIELDS)[number];

type SourceAliasField = keyof typeof CAMERA_IMPORT_FIELD_ALIASES;

export type ParsedCameraImportFile = Pick<
  CameraImportPreview,
  "file_name" | "file_extension" | "source_format"
> & {
  total_rows_detected: number;
  rows: CameraImportSourceRow[];
  global_warnings: string[];
};

type ExtractedCameraFields = Partial<
  Pick<
    CameraImportCandidate,
    | "name"
    | "ip_address"
    | "rtsp_port"
    | "manufacturer"
    | "username"
    | "password"
    | "channel"
    | "subtype"
    | "connection_method"
    | "description"
    | "street"
    | "number"
    | "city"
    | "state"
    | "zip_code"
    | "country"
  >
>;

type CameraImportNormalizationOptions = {
  extraGlobalWarnings?: string[];
  sharedDefaults?: CameraImportSharedDefaults | null;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeLookupToken(value: string) {
  return stripDiacritics(normalizeWhitespace(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return normalizeWhitespace(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  try {
    return normalizeWhitespace(JSON.stringify(value));
  } catch {
    return "";
  }
}

export function normalizeCameraIpAddressValue(value: unknown): string {
  const text = stringifyCellValue(value);
  if (!text) {
    return "";
  }

  const trimmed = normalizeWhitespace(text);
  const octets = trimmed.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
    return trimmed;
  }

  const numericOctets = octets.map((octet) => Number.parseInt(octet, 10));
  if (numericOctets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return trimmed;
  }

  return numericOctets.map((octet) => String(octet)).join(".");
}

function titleCaseWords(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeManufacturerValue(value: string) {
  const normalized = normalizeLookupToken(value);
  if (!normalized) {
    return "";
  }

  for (const [token, canonical] of CAMERA_IMPORT_MANUFACTURER_ALIASES.entries()) {
    if (normalized === token || normalized.includes(token)) {
      return canonical;
    }
  }

  return titleCaseWords(value);
}

function sanitizeHeaderValue(value: unknown, index: number) {
  const normalized = normalizeLookupToken(stringifyCellValue(value));
  return normalized || `column_${index + 1}`;
}

function sanitizeHeaderValues(values: unknown[]) {
  const counts = new Map<string, number>();
  return values.slice(0, CAMERA_IMPORT_MAX_COLUMNS).map((value, index) => {
    const base = sanitizeHeaderValue(value, index);
    const nextCount = (counts.get(base) || 0) + 1;
    counts.set(base, nextCount);
    return nextCount === 1 ? base : `${base}_${nextCount}`;
  });
}

function sanitizeSourceValues(values: Record<string, unknown>) {
  const counts = new Map<string, number>();
  const entries = Object.entries(values)
    .slice(0, CAMERA_IMPORT_MAX_COLUMNS)
    .map(([key, value], index) => {
      const baseKey = sanitizeHeaderValue(key, index);
      const nextCount = (counts.get(baseKey) || 0) + 1;
      counts.set(baseKey, nextCount);
      const dedupedKey = nextCount === 1 ? baseKey : `${baseKey}_${nextCount}`;
      return [dedupedKey, stringifyCellValue(value)] as const;
    })
    .filter(([, value]) => value.length > 0);

  return Object.fromEntries(entries);
}

function flattenJsonRecord(
  value: Record<string, unknown>,
  prefix = ""
): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [key, rawChild] of Object.entries(value)) {
    const childKey = prefix ? `${prefix}.${key}` : key;
    if (
      rawChild &&
      typeof rawChild === "object" &&
      !Array.isArray(rawChild) &&
      !(rawChild instanceof Date)
    ) {
      Object.assign(
        output,
        flattenJsonRecord(rawChild as Record<string, unknown>, childKey)
      );
      continue;
    }

    if (Array.isArray(rawChild)) {
      const flatArray = rawChild
        .map((item) => stringifyCellValue(item))
        .filter((item) => item.length > 0);
      if (flatArray.length > 0) {
        output[childKey] = flatArray.join(" | ");
      }
      continue;
    }

    const textValue = stringifyCellValue(rawChild);
    if (textValue.length > 0) {
      output[childKey] = textValue;
    }
  }

  return output;
}

function isMeaningfulRow(values: Record<string, string>) {
  return Object.keys(values).length > 0;
}

function looksLikeIpv4(value: string) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function looksLikeTransportUrl(value: string) {
  return /^(?:rtsp|http|https):\/\//i.test(value);
}

function looksLikeBareHost(value: string) {
  return (
    /^[a-z0-9.-]+$/i.test(value) &&
    !/^[a-z]+$/i.test(value) &&
    !/^\d{1,5}$/.test(value)
  );
}

function looksLikeStructuredDataValue(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return false;
  if (looksLikeTransportUrl(normalized)) return true;
  if (looksLikeIpv4(normalized)) return true;
  if (/^\d{1,5}$/.test(normalized)) return true;
  if (normalized.includes("@")) return true;
  if (looksLikeBareHost(normalized)) return true;
  return false;
}

function resolveCanonicalSourceField(key: string): SourceAliasField | null {
  const normalizedKey = normalizeLookupToken(key);
  if (!normalizedKey) {
    return null;
  }

  for (const [field, aliases] of Object.entries(CAMERA_IMPORT_FIELD_ALIASES)) {
    if (
      aliases.some((alias) => {
        return (
          normalizedKey === alias ||
          normalizedKey.startsWith(`${alias}_`) ||
          normalizedKey.endsWith(`_${alias}`) ||
          normalizedKey.includes(`_${alias}_`)
        );
      })
    ) {
      return field as SourceAliasField;
    }
  }

  return null;
}

function normalizeConnectionMethodValue(
  value: unknown
): CameraImportCandidate["connection_method"] | null {
  const normalized = normalizeLookupToken(stringifyCellValue(value));
  if (!normalized) {
    return null;
  }
  if (normalized === "http" || normalized === "https") {
    return "HTTP";
  }
  if (normalized === "onvif") {
    return "ONVIF";
  }
  if (normalized === "rtsp" || normalized === "rtsp_tcp") {
    return "RTSP";
  }
  return null;
}

function normalizeSharedDefaultField(
  field: CameraImportShareableField,
  value: unknown
) {
  const text = stringifyCellValue(value);
  if (!text) {
    return "";
  }

  if (field === "manufacturer") {
    return normalizeManufacturerValue(text);
  }

  if (field === "connection_method") {
    return normalizeConnectionMethodValue(text) || "";
  }

  return normalizeWhitespace(text);
}

export function normalizeCameraImportSharedDefaults(
  value: CameraImportSharedDefaults | Record<string, unknown> | null | undefined
): CameraImportSharedDefaults {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const normalized: CameraImportSharedDefaults = {};
  for (const field of CAMERA_IMPORT_SHAREABLE_FIELDS) {
    const nextValue = normalizeSharedDefaultField(field, source[field]);
    if (!nextValue) {
      continue;
    }

    (normalized as Record<string, string>)[field] = nextValue;
  }

  return normalized;
}

function buildSourceReference(
  sheetName: string | null,
  rowNumber: number | null,
  index: number
) {
  if (sheetName && rowNumber) {
    return `${sheetName} row ${rowNumber}`;
  }
  if (sheetName) {
    return `${sheetName} item ${index + 1}`;
  }
  if (rowNumber) {
    return `Row ${rowNumber}`;
  }
  return `Item ${index + 1}`;
}

function shouldCarryForwardKey(key: string) {
  const canonicalField = resolveCanonicalSourceField(key);
  return canonicalField !== null && canonicalField !== "name" && canonicalField !== "ip_address";
}

function propagateSparseFieldValues(rows: CameraImportSourceRow[]) {
  const carriedBySheet = new Map<string, Record<string, string>>();

  return rows.map((row) => {
    const sheetKey = row.source_sheet_name || "__default__";
    const carried = carriedBySheet.get(sheetKey) || {};
    const nextValues: Record<string, string> = { ...row.values };

    for (const [key, value] of Object.entries(carried)) {
      if (!(key in nextValues) && shouldCarryForwardKey(key)) {
        nextValues[key] = value;
      }
    }

    for (const [key, value] of Object.entries(nextValues)) {
      if (shouldCarryForwardKey(key) && value) {
        carried[key] = value;
      }
    }

    carriedBySheet.set(sheetKey, carried);
    return {
      ...row,
      values: nextValues,
    };
  });
}

function scoreHeaderRow(cells: string[], nextCells: string[]) {
  const nonEmptyCells = cells.filter(Boolean);
  if (nonEmptyCells.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const aliasCount = nonEmptyCells.filter((cell) => resolveCanonicalSourceField(cell)).length;
  const textLikeCount = nonEmptyCells.filter((cell) => !looksLikeStructuredDataValue(cell)).length;
  const dataLikeCount = nonEmptyCells.filter((cell) => looksLikeStructuredDataValue(cell)).length;
  const nextDataLikeCount = nextCells.filter(Boolean).filter(looksLikeStructuredDataValue).length;

  return aliasCount * 4 + textLikeCount - dataLikeCount * 2 + (nextDataLikeCount > 0 ? 1 : 0);
}

function detectHeaderRowIndex(matrix: string[][]) {
  const scanLimit = Math.min(matrix.length, 5);
  let bestIndex = -1;
  let bestScore = 1;

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const score = scoreHeaderRow(matrix[rowIndex] || [], matrix[rowIndex + 1] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  }

  return bestIndex;
}

function buildRowsFromMatrix(
  matrix: string[][],
  options: {
    sheetName: string | null;
    startIndex: number;
    rowReferencePrefix: string;
  }
) {
  const headerRowIndex = detectHeaderRowIndex(matrix);
  const headers =
    headerRowIndex >= 0 ? sanitizeHeaderValues(matrix[headerRowIndex] || []) : null;
  const firstDataRowIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;
  const rows: CameraImportSourceRow[] = [];

  const pushRow = (values: Record<string, unknown>, rowNumber: number | null) => {
    const sourceValues = sanitizeSourceValues(values);
    if (!isMeaningfulRow(sourceValues)) {
      return;
    }

    const sourceIndex = options.startIndex + rows.length;
    rows.push({
      source_index: sourceIndex,
      source_sheet_name: options.sheetName,
      source_row_number: rowNumber,
      source_reference:
        options.sheetName !== null
          ? buildSourceReference(options.sheetName, rowNumber, sourceIndex)
          : `${options.rowReferencePrefix} ${rowNumber ?? sourceIndex + 1}`,
      values: sourceValues,
    });
  };

  for (let rowIndex = firstDataRowIndex; rowIndex < matrix.length; rowIndex += 1) {
    const rawRow = matrix[rowIndex] || [];
    const values: Record<string, unknown> = {};
    rawRow.slice(0, CAMERA_IMPORT_MAX_COLUMNS).forEach((cell, cellIndex) => {
      const key =
        headers?.[cellIndex] ||
        (headerRowIndex >= 0 ? `column_${cellIndex + 1}` : `column_${cellIndex + 1}`);
      values[key] = cell;
    });
    pushRow(values, rowIndex + 1);
  }

  return propagateSparseFieldValues(rows);
}

function workbookRowsFromSheet(
  sheetName: string,
  sheet: XLSX.WorkSheet,
  startIndex: number
) {
  const matrix = XLSX.utils
    .sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    })
    .map((row) =>
      Array.isArray(row)
        ? row.slice(0, CAMERA_IMPORT_MAX_COLUMNS).map((cell) => stringifyCellValue(cell))
        : []
    );

  return buildRowsFromMatrix(matrix, {
    sheetName,
    startIndex,
    rowReferencePrefix: "Sheet row",
  });
}

function collectJsonObjectRows(value: unknown): Record<string, string>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonObjectRows(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const objectValue = value as Record<string, unknown>;
  const directRow = flattenJsonRecord(objectValue);
  const nestedRows = Object.values(objectValue).flatMap((item) =>
    collectJsonObjectRows(item)
  );

  if (nestedRows.length === 0 && Object.keys(directRow).length > 0) {
    return [directRow];
  }

  if (
    nestedRows.length > 0 &&
    Object.keys(directRow).length > 0 &&
    Object.keys(directRow).length <= 4
  ) {
    return nestedRows.map((row) => ({ ...directRow, ...row }));
  }

  return nestedRows;
}

function splitDelimitedLine(line: string, delimiter: string) {
  const parts: string[] = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      const nextChar = line[index + 1];
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts.map((part) => normalizeWhitespace(part));
}

function detectTextDelimiter(lines: string[]) {
  const candidates = ["\t", ";", "|", ","];
  const sampleLines = lines.slice(0, 10);
  let bestDelimiter = "";
  let bestScore = 0;

  for (const delimiter of candidates) {
    const counts = sampleLines.map(
      (line) => splitDelimitedLine(line, delimiter).filter(Boolean).length
    );
    const usefulCounts = counts.filter((count) => count > 1);
    if (usefulCounts.length === 0) {
      continue;
    }

    const averageCount =
      usefulCounts.reduce((sum, count) => sum + count, 0) / usefulCounts.length;
    const score = usefulCounts.length * 10 + averageCount;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

function parseTextRows(text: string): CameraImportSourceRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const delimiter = detectTextDelimiter(lines);
  if (!delimiter) {
    return lines.map((line, index) => ({
      source_index: index,
      source_sheet_name: null,
      source_row_number: index + 1,
      source_reference: `Text line ${index + 1}`,
      values: {
        text_line: normalizeWhitespace(line),
      },
    }));
  }

  const matrix = lines.map((line) =>
    splitDelimitedLine(line, delimiter).slice(0, CAMERA_IMPORT_MAX_COLUMNS)
  );

  return buildRowsFromMatrix(matrix, {
    sheetName: null,
    startIndex: 0,
    rowReferencePrefix: "Text row",
  });
}

function inferFileExtension(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

function inferSourceFormat(extension: string): ParsedCameraImportFile["source_format"] {
  if (extension === "csv") return "csv";
  if (extension === "tsv") return "tsv";
  if (extension === "json") return "json";
  if (extension === "txt") return "text";
  if (["xlsx", "xls", "ods"].includes(extension)) return "spreadsheet";
  return "unknown";
}

function resolveCountryName(countryCode: string) {
  const normalized = normalizeWhitespace(countryCode).toUpperCase();
  if (!normalized) {
    return "Imported placeholder country";
  }

  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

function findManufacturerInText(text: string) {
  const normalized = normalizeLookupToken(text);
  if (!normalized) {
    return "";
  }

  for (const [token, canonical] of CAMERA_IMPORT_MANUFACTURER_ALIASES.entries()) {
    if (normalized.includes(token)) {
      return canonical;
    }
  }

  return "";
}

function mergeExtractedField(
  target: ExtractedCameraFields,
  field: keyof ExtractedCameraFields,
  value: unknown
) {
  const currentValue = target[field];
  if (typeof currentValue === "string" && currentValue.trim().length > 0) {
    return;
  }

  if (field === "manufacturer") {
    const normalized = normalizeManufacturerValue(stringifyCellValue(value));
    if (normalized) {
      target[field] = normalized;
    }
    return;
  }

  if (field === "connection_method") {
    const method = normalizeConnectionMethodValue(value);
    if (method) {
      target[field] = method;
    }
    return;
  }

  if (field === "ip_address") {
    const normalizedIp = normalizeCameraIpAddressValue(value);
    if (normalizedIp) {
      target[field] = normalizedIp;
    }
    return;
  }

  const normalized = stringifyCellValue(value);
  if (normalized) {
    (target as unknown as Record<string, string>)[field] = normalized;
  }
}

function extractTransportFieldsFromUrl(value: string): ExtractedCameraFields {
  const extracted: ExtractedCameraFields = {};
  const match = value.match(/\b(?:rtsp|http|https):\/\/[^\s"']+/i);
  if (!match) {
    return extracted;
  }

  const urlText = match[0];
  try {
    const url = new URL(urlText);
    mergeExtractedField(extracted, "ip_address", url.hostname);
    if (url.port) {
      mergeExtractedField(extracted, "rtsp_port", url.port);
    }
    if (url.username) {
      mergeExtractedField(extracted, "username", decodeURIComponent(url.username));
    }
    if (url.password) {
      mergeExtractedField(extracted, "password", decodeURIComponent(url.password));
    }

    if (url.protocol.toLowerCase().startsWith("http")) {
      mergeExtractedField(extracted, "connection_method", "HTTP");
    } else if (url.protocol.toLowerCase().startsWith("rtsp")) {
      mergeExtractedField(extracted, "connection_method", "RTSP");
    }

    const usernameParam =
      url.searchParams.get("username") ||
      url.searchParams.get("user") ||
      url.searchParams.get("usuario");
    const passwordParam =
      url.searchParams.get("password") ||
      url.searchParams.get("pass") ||
      url.searchParams.get("senha");
    const channelParam = url.searchParams.get("channel");
    const subtypeParam = url.searchParams.get("subtype");

    if (usernameParam) {
      mergeExtractedField(extracted, "username", usernameParam);
    }
    if (passwordParam) {
      mergeExtractedField(extracted, "password", passwordParam);
    }
    if (channelParam) {
      mergeExtractedField(extracted, "channel", channelParam);
    }
    if (subtypeParam) {
      mergeExtractedField(extracted, "subtype", subtypeParam);
    }
  } catch {
    const hostPortMatch = urlText.match(
      /^(?:rtsp|http|https):\/\/(?:[^@/]+@)?([^/:?#]+)(?::(\d{1,5}))?/i
    );
    if (hostPortMatch?.[1]) {
      mergeExtractedField(extracted, "ip_address", hostPortMatch[1]);
    }
    if (hostPortMatch?.[2]) {
      mergeExtractedField(extracted, "rtsp_port", hostPortMatch[2]);
    }
  }

  return extracted;
}

function extractStructuredTextFields(value: string): ExtractedCameraFields {
  const extracted: ExtractedCameraFields = {};
  const text = normalizeWhitespace(value);
  if (!text) {
    return extracted;
  }

  const ipMatch = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
  if (ipMatch?.[1]) {
    mergeExtractedField(extracted, "ip_address", ipMatch[1]);
  }

  const portMatch = text.match(
    /\b(?:rtsp\s*port|porta\s*rtsp|puerto\s*rtsp|port|porta|puerto)\b\s*[:=]?\s*(\d{1,5})/i
  );
  if (portMatch?.[1]) {
    mergeExtractedField(extracted, "rtsp_port", portMatch[1]);
  }

  const usernameMatch = text.match(
    /\b(?:username|user|usuario|utilisateur|login)\b\s*[:=]?\s*([^\s,;|]+)/i
  );
  if (usernameMatch?.[1]) {
    mergeExtractedField(extracted, "username", usernameMatch[1]);
  }

  const passwordMatch = text.match(
    /\b(?:password|pass|senha|contrasena|contrasenia|pwd)\b\s*[:=]?\s*([^\s,;|]+)/i
  );
  if (passwordMatch?.[1]) {
    mergeExtractedField(extracted, "password", passwordMatch[1]);
  }

  const manufacturerMatch = text.match(
    /\b(?:manufacturer|fabricante|fabricant|factory|brand|marca)\b\s*[:=]?\s*([^\n,;|]+)/i
  );
  if (manufacturerMatch?.[1]) {
    mergeExtractedField(extracted, "manufacturer", manufacturerMatch[1]);
  } else {
    const manufacturer = findManufacturerInText(text);
    if (manufacturer) {
      mergeExtractedField(extracted, "manufacturer", manufacturer);
    }
  }

  const channelMatch = text.match(/\b(?:channel|canal|ch)\b\s*[:=]?\s*([^\s,;|]+)/i);
  if (channelMatch?.[1]) {
    mergeExtractedField(extracted, "channel", channelMatch[1]);
  }

  const subtypeMatch = text.match(
    /\b(?:subtype|subtipo|sub_type|perfil)\b\s*[:=]?\s*([^\s,;|]+)/i
  );
  if (subtypeMatch?.[1]) {
    mergeExtractedField(extracted, "subtype", subtypeMatch[1]);
  }

  const methodMatch = text.match(/\b(rtsp|http|https|onvif)\b/i);
  if (methodMatch?.[1]) {
    mergeExtractedField(extracted, "connection_method", methodMatch[1]);
  }

  const streetMatch = text.match(
    /\b(?:street|rua|logradouro|calle|rue|address|endereco|direccion)\b\s*[:=]?\s*([^\n,;|]+)/i
  );
  if (streetMatch?.[1]) {
    mergeExtractedField(extracted, "street", streetMatch[1]);
  }

  const numberMatch = text.match(
    /\b(?:number|numero|num)\b\s*[:=]?\s*([^\s,;|]+)/i
  );
  if (numberMatch?.[1]) {
    mergeExtractedField(extracted, "number", numberMatch[1]);
  }

  const cityMatch = text.match(/\b(?:city|cidade|ciudad|ville)\b\s*[:=]?\s*([^\n,;|]+)/i);
  if (cityMatch?.[1]) {
    mergeExtractedField(extracted, "city", cityMatch[1]);
  }

  const stateMatch = text.match(
    /\b(?:state|estado|province|provincia|uf|region|etat)\b\s*[:=]?\s*([^\n,;|]+)/i
  );
  if (stateMatch?.[1]) {
    mergeExtractedField(extracted, "state", stateMatch[1]);
  }

  const zipMatch = text.match(
    /\b(?:zip\s*code|zipcode|zip|postal\s*code|postcode|cep|codigo\s*postal|code\s*postal)\b\s*[:=]?\s*([A-Za-z0-9 -]{4,16})/i
  );
  if (zipMatch?.[1]) {
    mergeExtractedField(extracted, "zip_code", zipMatch[1]);
  }

  const countryMatch = text.match(/\b(?:country|pais|pays)\b\s*[:=]?\s*([^\n,;|]+)/i);
  if (countryMatch?.[1]) {
    mergeExtractedField(extracted, "country", countryMatch[1]);
  }

  return extracted;
}

function extractCanonicalCameraFieldsFromSourceValues(
  sourceValues: Record<string, string>
): ExtractedCameraFields {
  const extracted: ExtractedCameraFields = {};
  const entries = Object.entries(sourceValues);

  for (const [key, value] of entries) {
    const textValue = stringifyCellValue(value);
    if (!textValue) {
      continue;
    }

    const canonicalField = resolveCanonicalSourceField(key);
    if (canonicalField === "stream_url") {
      Object.entries(extractTransportFieldsFromUrl(textValue)).forEach(([field, fieldValue]) =>
        mergeExtractedField(extracted, field as keyof ExtractedCameraFields, fieldValue)
      );
    } else if (canonicalField) {
      if (canonicalField === "manufacturer") {
        mergeExtractedField(extracted, "manufacturer", textValue);
      } else if (canonicalField === "connection_method") {
        mergeExtractedField(extracted, "connection_method", textValue);
      } else {
        mergeExtractedField(
          extracted,
          canonicalField as keyof ExtractedCameraFields,
          textValue
        );
      }
    }

    Object.entries(extractTransportFieldsFromUrl(textValue)).forEach(([field, fieldValue]) =>
      mergeExtractedField(extracted, field as keyof ExtractedCameraFields, fieldValue)
    );
    Object.entries(extractStructuredTextFields(textValue)).forEach(([field, fieldValue]) =>
      mergeExtractedField(extracted, field as keyof ExtractedCameraFields, fieldValue)
    );

    if (!extracted.ip_address && looksLikeIpv4(textValue)) {
      mergeExtractedField(extracted, "ip_address", textValue);
    } else if (
      !extracted.ip_address &&
      !looksLikeTransportUrl(textValue) &&
      looksLikeBareHost(textValue)
    ) {
      mergeExtractedField(extracted, "ip_address", textValue);
    }
  }

  if (entries.length >= 2 && entries.length <= 4) {
    for (let index = 0; index < entries.length - 1; index += 1) {
      const keyLikeValue = normalizeLookupToken(entries[index][1]);
      const canonicalField = resolveCanonicalSourceField(keyLikeValue);
      const nextValue = stringifyCellValue(entries[index + 1][1]);
      if (!canonicalField || !nextValue) {
        continue;
      }

      if (canonicalField === "stream_url") {
        Object.entries(extractTransportFieldsFromUrl(nextValue)).forEach(
          ([field, fieldValue]) =>
            mergeExtractedField(extracted, field as keyof ExtractedCameraFields, fieldValue)
        );
      } else {
        mergeExtractedField(
          extracted,
          canonicalField as keyof ExtractedCameraFields,
          nextValue
        );
      }
    }
  }

  return extracted;
}

function buildSharedDefaultWarning(field: CameraImportShareableField) {
  if (field === "password") {
    return "A single shared password found in the file was applied to rows where the password was blank.";
  }
  if (field === "username") {
    return "A single shared username found in the file was applied to rows where the username was blank.";
  }
  if (field === "manufacturer") {
    return "A single shared manufacturer found in the file was applied to rows where the manufacturer was blank.";
  }
  if (field === "rtsp_port") {
    return "A single shared RTSP port found in the file was applied to rows where the RTSP port was blank.";
  }
  if (field === "connection_method") {
    return "A single shared connection method found in the file was applied to rows where the method was blank.";
  }
  if (field === "channel") {
    return "A single shared channel found in the file was applied to rows where the channel was blank.";
  }
  return "A single shared subtype found in the file was applied to rows where the subtype was blank.";
}

function deriveSharedDefaults(
  candidates: CameraImportCandidate[],
  extractedByCandidate: ExtractedCameraFields[],
  explicitDefaults: CameraImportSharedDefaults | null | undefined
) {
  const resolvedDefaults = normalizeCameraImportSharedDefaults(explicitDefaults);
  const warnings: string[] = [];

  for (const field of CAMERA_IMPORT_SHAREABLE_FIELDS) {
    if ((resolvedDefaults as Record<string, string | undefined>)[field]) {
      continue;
    }

    let missingCount = 0;
    const uniqueValues = new Set<string>();

    candidates.forEach((candidate, index) => {
      const candidateValue = normalizeSharedDefaultField(
        field,
        (candidate as unknown as Record<string, unknown>)[field]
      );
      const extractedValue = normalizeSharedDefaultField(
        field,
        (extractedByCandidate[index] as unknown as Record<string, unknown>)[field]
      );
      const resolvedValue = candidateValue || extractedValue;
      if (!resolvedValue) {
        missingCount += 1;
        return;
      }

      uniqueValues.add(resolvedValue);
    });

    if (missingCount > 0 && uniqueValues.size === 1) {
      (resolvedDefaults as Record<string, string>)[field] = Array.from(uniqueValues)[0];
      warnings.push(buildSharedDefaultWarning(field));
    }
  }

  return {
    sharedDefaults: resolvedDefaults,
    warnings,
  };
}

export function buildDefaultImportedAddress(countryCode: string, sourceIndex: number) {
  const countryName = resolveCountryName(countryCode);
  const suffix = sourceIndex + 1;

  return {
    street: "Imported placeholder street",
    number: String(1000 + suffix),
    city: `Imported placeholder city ${suffix}`,
    state: "Imported placeholder state",
    zip_code: `00000-${String(suffix).padStart(3, "0")}`,
    country: countryName,
  };
}

function normalizeImportedPreviewOptions(
  value: string[] | CameraImportNormalizationOptions
): CameraImportNormalizationOptions {
  if (Array.isArray(value)) {
    return {
      extraGlobalWarnings: value,
      sharedDefaults: null,
    };
  }

  return {
    extraGlobalWarnings: Array.isArray(value?.extraGlobalWarnings)
      ? value.extraGlobalWarnings
      : [],
    sharedDefaults: value?.sharedDefaults || null,
  };
}

function normalizedWhitespaceLookup(
  candidate: Pick<
    CameraImportCandidate,
    "ip_address" | "username" | "password" | "manufacturer"
  >,
  field: (typeof CAMERA_IMPORT_REQUIRED_FIELDS)[number]
) {
  return normalizeWhitespace(candidate[field] || "");
}

export function normalizeImportedCandidate(
  candidate: CameraImportCandidate,
  userCountryCode: string,
  context?: {
    sourceBackfill?: ExtractedCameraFields;
    sharedDefaults?: CameraImportSharedDefaults | null;
  }
) {
  const sourceValues =
    candidate.source_values && typeof candidate.source_values === "object"
      ? sanitizeSourceValues(candidate.source_values)
      : {};
  const sourceBackfill =
    context?.sourceBackfill || extractCanonicalCameraFieldsFromSourceValues(sourceValues);
  const sharedDefaults = normalizeCameraImportSharedDefaults(context?.sharedDefaults);

  const rawConnectionMethod =
    normalizeConnectionMethodValue(candidate.connection_method) ||
    normalizeConnectionMethodValue(sourceBackfill.connection_method) ||
    normalizeConnectionMethodValue(sharedDefaults.connection_method);

  const normalized: CameraImportCandidate = {
    ...candidate,
    source_values: sourceValues,
    name: normalizeWhitespace(candidate.name),
    ip_address: normalizeCameraIpAddressValue(candidate.ip_address),
    rtsp_port: normalizeWhitespace(candidate.rtsp_port),
    manufacturer: normalizeWhitespace(candidate.manufacturer),
    username: normalizeWhitespace(candidate.username),
    password: normalizeWhitespace(candidate.password),
    channel: normalizeWhitespace(candidate.channel || "") || null,
    subtype: normalizeWhitespace(candidate.subtype || "") || null,
    connection_method: rawConnectionMethod || "RTSP",
    description: normalizeWhitespace(candidate.description || "") || null,
    street: normalizeWhitespace(candidate.street),
    number: normalizeWhitespace(candidate.number),
    city: normalizeWhitespace(candidate.city),
    state: normalizeWhitespace(candidate.state),
    zip_code: normalizeWhitespace(candidate.zip_code),
    country: normalizeWhitespace(candidate.country),
    missing_fields: [],
    defaulted_fields: Array.from(new Set(candidate.defaulted_fields || [])),
    warnings: Array.from(new Set(candidate.warnings || [])),
    can_create: false,
    address_was_defaulted: Boolean(candidate.address_was_defaulted),
  };

  const fillFromSource = (
    field: keyof ExtractedCameraFields & keyof CameraImportCandidate
  ) => {
    const existingValue = normalizeWhitespace(String(normalized[field] || ""));
    if (existingValue) {
      return;
    }

    const nextValue = sourceBackfill[field];
    if (!nextValue) {
      return;
    }

    if (field === "manufacturer") {
      normalized.manufacturer = normalizeManufacturerValue(nextValue);
      return;
    }

    if (field === "connection_method") {
      const method = normalizeConnectionMethodValue(nextValue);
      if (method) {
        normalized.connection_method = method;
      }
      return;
    }

    if (field === "ip_address") {
      normalized.ip_address = normalizeCameraIpAddressValue(nextValue);
      return;
    }

    (normalized as unknown as Record<string, string | null>)[field] =
      normalizeWhitespace(nextValue) || null;
  };

  for (const field of [
    "name",
    "ip_address",
    "rtsp_port",
    "manufacturer",
    "username",
    "password",
    "channel",
    "subtype",
    "description",
    "street",
    "number",
    "city",
    "state",
    "zip_code",
    "country",
  ] as const) {
    fillFromSource(field);
  }

  const applySharedDefault = (field: CameraImportShareableField) => {
    const nextValue = normalizeSharedDefaultField(field, sharedDefaults[field]);
    if (!nextValue) {
      return;
    }

    const currentValue = normalizeWhitespace(
      String((normalized as unknown as Record<string, unknown>)[field] || "")
    );
    if (currentValue) {
      return;
    }

    (normalized as unknown as Record<string, string | null>)[field] = nextValue;
    normalized.defaulted_fields.push(field);
  };

  for (const field of CAMERA_IMPORT_SHAREABLE_FIELDS) {
    applySharedDefault(field);
  }

  if (!rawConnectionMethod && !normalizeConnectionMethodValue(sharedDefaults.connection_method)) {
    normalized.defaulted_fields.push("connection_method");
  }

  if (!normalized.rtsp_port) {
    normalized.rtsp_port = "554";
    normalized.defaulted_fields.push("rtsp_port");
  }

  if (!normalized.name) {
    normalized.name = normalized.ip_address
      ? `Imported camera ${normalized.ip_address}`
      : `Imported camera ${normalized.source_index + 1}`;
    normalized.defaulted_fields.push("name");
  }

  const addressFields = [
    normalized.street,
    normalized.number,
    normalized.city,
    normalized.state,
    normalized.zip_code,
    normalized.country,
  ];

  if (addressFields.some((field) => field.length === 0)) {
    const defaultAddress = buildDefaultImportedAddress(
      userCountryCode,
      normalized.source_index
    );
    let usedPlaceholderAddress = false;

    for (const field of [
      "street",
      "number",
      "city",
      "state",
      "zip_code",
      "country",
    ] as const) {
      if (normalized[field]) {
        continue;
      }

      normalized[field] = defaultAddress[field];
      normalized.defaulted_fields.push(field);
      usedPlaceholderAddress = true;
    }

    if (usedPlaceholderAddress) {
      normalized.address_was_defaulted = true;
      normalized.warnings.push(
        "Address was missing or incomplete, so a placeholder address was generated."
      );
    }
  }

  normalized.missing_fields = Array.from(
    new Set(
      CAMERA_IMPORT_REQUIRED_FIELDS.filter((field) => {
        const value = normalizedWhitespaceLookup(normalized, field);
        return value.length === 0;
      })
    )
  );
  normalized.defaulted_fields = Array.from(new Set(normalized.defaulted_fields));
  normalized.warnings = Array.from(new Set(normalized.warnings));
  normalized.can_create = normalized.missing_fields.length === 0;

  return normalized;
}

export function normalizeImportedPreview(
  preview: CameraImportPreview,
  userCountryCode: string,
  extraGlobalWarningsOrOptions: string[] | CameraImportNormalizationOptions = []
): CameraImportPreview {
  const options = normalizeImportedPreviewOptions(extraGlobalWarningsOrOptions);
  const rawCandidates = Array.isArray(preview.candidates) ? preview.candidates : [];
  const extractedByCandidate = rawCandidates.map((candidate) =>
    extractCanonicalCameraFieldsFromSourceValues(candidate.source_values || {})
  );
  const { sharedDefaults, warnings: sharedDefaultWarnings } = deriveSharedDefaults(
    rawCandidates,
    extractedByCandidate,
    options.sharedDefaults
  );

  const candidates = rawCandidates.map((candidate, index) =>
    normalizeImportedCandidate(candidate, userCountryCode, {
      sourceBackfill: extractedByCandidate[index],
      sharedDefaults,
    })
  );

  const missingFieldSummary: Record<string, number> = {};
  let readyCount = 0;
  let incompleteCount = 0;
  let defaultedAddressCount = 0;

  for (const candidate of candidates) {
    if (candidate.can_create) {
      readyCount += 1;
    } else {
      incompleteCount += 1;
    }

    if (candidate.address_was_defaulted) {
      defaultedAddressCount += 1;
    }

    for (const field of candidate.missing_fields) {
      missingFieldSummary[field] = (missingFieldSummary[field] || 0) + 1;
    }
  }

  return {
    ...preview,
    ready_count: readyCount,
    incomplete_count: incompleteCount,
    defaulted_address_count: defaultedAddressCount,
    skipped_count:
      typeof preview.skipped_count === "number" && preview.skipped_count >= 0
        ? preview.skipped_count
        : Math.max((preview.total_rows_detected || 0) - candidates.length, 0),
    global_warnings: Array.from(
      new Set([
        ...(preview.global_warnings || []),
        ...(options.extraGlobalWarnings || []),
        ...sharedDefaultWarnings,
      ])
    ),
    missing_field_summary: missingFieldSummary,
    candidates,
  };
}

export function buildCameraImportPreviewFromParsedFile(
  parsedFile: ParsedCameraImportFile,
  userCountryCode: string,
  options: CameraImportNormalizationOptions = {}
): CameraImportPreview {
  const rawCandidates: CameraImportCandidate[] = parsedFile.rows.map((row) => {
    const sourceValues = sanitizeSourceValues(row.values || {});
    const extracted = extractCanonicalCameraFieldsFromSourceValues(sourceValues);
    const hasInferredCameraSignal = Object.values(extracted).some((value) =>
      normalizeWhitespace(String(value || "")).length > 0
    );

    return {
      source_index: row.source_index,
      source_reference:
        normalizeWhitespace(row.source_reference || "") || `Row ${row.source_index + 1}`,
      source_sheet_name: row.source_sheet_name ?? null,
      source_row_number:
        typeof row.source_row_number === "number" ? row.source_row_number : null,
      source_values: sourceValues,
      name: normalizeWhitespace(extracted.name || ""),
      ip_address: normalizeCameraIpAddressValue(extracted.ip_address || ""),
      rtsp_port: normalizeWhitespace(extracted.rtsp_port || ""),
      manufacturer: normalizeManufacturerValue(extracted.manufacturer || ""),
      username: normalizeWhitespace(extracted.username || ""),
      password: normalizeWhitespace(extracted.password || ""),
      channel: normalizeWhitespace(extracted.channel || "") || null,
      subtype: normalizeWhitespace(extracted.subtype || "") || null,
      connection_method:
        normalizeConnectionMethodValue(extracted.connection_method) || "RTSP",
      description: normalizeWhitespace(extracted.description || "") || null,
      street: normalizeWhitespace(extracted.street || ""),
      number: normalizeWhitespace(extracted.number || ""),
      city: normalizeWhitespace(extracted.city || ""),
      state: normalizeWhitespace(extracted.state || ""),
      zip_code: normalizeWhitespace(extracted.zip_code || ""),
      country: normalizeWhitespace(extracted.country || ""),
      missing_fields: [],
      defaulted_fields: [],
      warnings: hasInferredCameraSignal
        ? []
        : ["No camera-like fields could be inferred from this row."],
      can_create: false,
      address_was_defaulted: false,
    };
  });

  return normalizeImportedPreview(
    {
      file_name: parsedFile.file_name,
      file_extension: parsedFile.file_extension,
      source_format: parsedFile.source_format,
      total_rows_detected: parsedFile.total_rows_detected,
      rows_sent_to_llm: parsedFile.rows.length,
      ready_count: 0,
      incomplete_count: 0,
      defaulted_address_count: 0,
      skipped_count: Math.max(parsedFile.total_rows_detected - rawCandidates.length, 0),
      global_warnings: Array.isArray(parsedFile.global_warnings)
        ? [...parsedFile.global_warnings]
        : [],
      missing_field_summary: {},
      candidates: rawCandidates,
    },
    userCountryCode,
    options
  );
}

export async function parseCameraImportFile(file: File): Promise<ParsedCameraImportFile> {
  const fileName = normalizeWhitespace(file.name || "camera-import");
  const fileExtension = inferFileExtension(fileName);
  const sourceFormat = inferSourceFormat(fileExtension);
  const globalWarnings: string[] = [];
  let rows: CameraImportSourceRow[] = [];

  if (sourceFormat === "json") {
    const text = await file.text();
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(text);
    } catch {
      throw new Error("The JSON file could not be parsed.");
    }

    rows = collectJsonObjectRows(parsedJson).map((values, index) => ({
      source_index: index,
      source_sheet_name: null,
      source_row_number: index + 1,
      source_reference: `JSON item ${index + 1}`,
      values,
    }));
  } else if (sourceFormat === "text" || sourceFormat === "unknown") {
    const text = await file.text();
    rows = parseTextRows(text);
  } else {
    const workbook = XLSX.read(await file.arrayBuffer(), {
      type: "array",
      raw: false,
      cellDates: false,
    });

    let nextIndex = 0;
    for (const sheetName of workbook.SheetNames || []) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const sheetRows = workbookRowsFromSheet(sheetName, sheet, nextIndex);
      rows.push(...sheetRows);
      nextIndex = rows.length;
    }
  }

  const totalRowsDetected = rows.length;
  if (rows.length > CAMERA_IMPORT_MAX_ROWS) {
    rows = rows.slice(0, CAMERA_IMPORT_MAX_ROWS);
    globalWarnings.push(
      `Only the first ${CAMERA_IMPORT_MAX_ROWS} rows were sent for AI extraction in this import.`
    );
  }

  if (rows.length === 0) {
    throw new Error("No usable camera rows were found in the selected file.");
  }

  return {
    file_name: fileName,
    file_extension: fileExtension,
    source_format: sourceFormat,
    total_rows_detected: totalRowsDetected,
    rows,
    global_warnings: globalWarnings,
  };
}

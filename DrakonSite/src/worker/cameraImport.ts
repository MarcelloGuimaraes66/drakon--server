import * as XLSX from "xlsx";
import {
  CAMERA_IMPORT_REQUIRED_FIELDS,
  type CameraImportCandidate,
  type CameraImportPreview,
  type CameraImportSourceRow,
} from "@/shared/cameraImport";

const CAMERA_IMPORT_MAX_ROWS = 250;
const CAMERA_IMPORT_MAX_COLUMNS = 64;

type ParsedCameraImportFile = Pick<
  CameraImportPreview,
  "file_name" | "file_extension" | "source_format"
> & {
  total_rows_detected: number;
  rows: CameraImportSourceRow[];
  global_warnings: string[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

function sanitizeHeaderValue(value: unknown, index: number) {
  const normalized = stringifyCellValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `column_${index + 1}`;
}

function sanitizeSourceValues(values: Record<string, unknown>) {
  const entries = Object.entries(values)
    .slice(0, CAMERA_IMPORT_MAX_COLUMNS)
    .map(([key, value]) => [sanitizeHeaderValue(key, 0), stringifyCellValue(value)] as const)
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

function buildSourceReference(sheetName: string | null, rowNumber: number | null, index: number) {
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

function workbookRowsFromSheet(
  sheetName: string,
  sheet: XLSX.WorkSheet,
  startIndex: number
) {
  const defaultRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const rows: CameraImportSourceRow[] = [];

  const pushRow = (values: Record<string, unknown>, rowNumber: number | null) => {
    const sourceValues = sanitizeSourceValues(values);
    if (!isMeaningfulRow(sourceValues)) {
      return;
    }

    const sourceIndex = startIndex + rows.length;
    rows.push({
      source_index: sourceIndex,
      source_sheet_name: sheetName,
      source_row_number: rowNumber,
      source_reference: buildSourceReference(sheetName, rowNumber, sourceIndex),
      values: sourceValues,
    });
  };

  if (defaultRows.length > 0) {
    defaultRows.forEach((row, rowIndex) => {
      pushRow(row, rowIndex + 2);
    });
    return rows;
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  if (matrix.length <= 1) {
    return rows;
  }

  const headerRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const headers = headerRow.map((cell, index) => sanitizeHeaderValue(cell, index));

  matrix.slice(1).forEach((rawRow, rowIndex) => {
    if (!Array.isArray(rawRow)) {
      return;
    }

    const values: Record<string, unknown> = {};
    rawRow.slice(0, CAMERA_IMPORT_MAX_COLUMNS).forEach((cell, index) => {
      values[headers[index] || `column_${index + 1}`] = cell;
    });
    pushRow(values, rowIndex + 2);
  });

  return rows;
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
  const firstLine = lines[0] || "";
  let bestDelimiter = "";
  let bestScore = 0;

  for (const delimiter of candidates) {
    const pieces = splitDelimitedLine(firstLine, delimiter);
    if (pieces.length <= 1) continue;
    const score = pieces.filter((piece) => piece.length > 0).length;
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
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

  const headerCells = splitDelimitedLine(lines[0], delimiter).map((cell, index) =>
    sanitizeHeaderValue(cell, index)
  );

  return lines.slice(1).map((line, index) => {
    const cells = splitDelimitedLine(line, delimiter);
    const values: Record<string, string> = {};
    cells.slice(0, CAMERA_IMPORT_MAX_COLUMNS).forEach((cell, cellIndex) => {
      if (!cell) return;
      values[headerCells[cellIndex] || `column_${cellIndex + 1}`] = cell;
    });

    return {
      source_index: index,
      source_sheet_name: null,
      source_row_number: index + 2,
      source_reference: `Text row ${index + 2}`,
      values,
    };
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

export function normalizeImportedCandidate(
  candidate: CameraImportCandidate,
  userCountryCode: string
) {
  const normalized: CameraImportCandidate = {
    ...candidate,
    name: normalizeWhitespace(candidate.name),
    ip_address: normalizeWhitespace(candidate.ip_address),
    rtsp_port: normalizeWhitespace(candidate.rtsp_port),
    manufacturer: normalizeWhitespace(candidate.manufacturer),
    username: normalizeWhitespace(candidate.username),
    password: normalizeWhitespace(candidate.password),
    channel: normalizeWhitespace(candidate.channel || "") || null,
    subtype: normalizeWhitespace(candidate.subtype || "") || null,
    connection_method:
      candidate.connection_method === "HTTP" || candidate.connection_method === "ONVIF"
        ? candidate.connection_method
        : "RTSP",
    description: normalizeWhitespace(candidate.description || "") || null,
    street: normalizeWhitespace(candidate.street),
    number: normalizeWhitespace(candidate.number),
    city: normalizeWhitespace(candidate.city),
    state: normalizeWhitespace(candidate.state),
    zip_code: normalizeWhitespace(candidate.zip_code),
    country: normalizeWhitespace(candidate.country),
    missing_fields: Array.from(
      new Set(
        CAMERA_IMPORT_REQUIRED_FIELDS.filter((field) => {
          const value = normalizedWhitespaceLookup(candidate, field);
          return value.length === 0;
        })
      )
    ),
    defaulted_fields: Array.from(new Set(candidate.defaulted_fields || [])),
    warnings: Array.from(new Set(candidate.warnings || [])),
    can_create: false,
    address_was_defaulted: Boolean(candidate.address_was_defaulted),
  };

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

  normalized.missing_fields = Array.from(new Set(normalized.missing_fields));
  normalized.defaulted_fields = Array.from(new Set(normalized.defaulted_fields));
  normalized.warnings = Array.from(new Set(normalized.warnings));
  normalized.can_create = normalized.missing_fields.length === 0;

  return normalized;
}

export function normalizeImportedPreview(
  preview: CameraImportPreview,
  userCountryCode: string,
  extraGlobalWarnings: string[] = []
): CameraImportPreview {
  const candidates = Array.isArray(preview.candidates)
    ? preview.candidates.map((candidate) =>
        normalizeImportedCandidate(candidate, userCountryCode)
      )
    : [];

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
      new Set([...(preview.global_warnings || []), ...extraGlobalWarnings])
    ),
    missing_field_summary: missingFieldSummary,
    candidates,
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

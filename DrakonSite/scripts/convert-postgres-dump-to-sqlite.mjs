import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function decodeCopyValue(raw) {
  if (raw === "\\N") return null;

  return raw.replace(/\\([\\btnrfv])/g, (_match, token) => {
    switch (token) {
      case "\\":
        return "\\";
      case "b":
        return "\b";
      case "t":
        return "\t";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "f":
        return "\f";
      case "v":
        return "\v";
      default:
        return token;
    }
  });
}

function normalizeDefaultValue(rawDefault) {
  if (!rawDefault) return null;

  let value = rawDefault.trim();
  value = value.replace(/::[\w\s".()]+/g, "");

  if (/^nextval\(/i.test(value)) {
    return null;
  }

  if (/^null$/i.test(value)) {
    return null;
  }

  if (/^true$/i.test(value)) {
    return "1";
  }

  if (/^false$/i.test(value)) {
    return "0";
  }

  return value;
}

function normalizeSqliteType(rawType) {
  const type = rawType.trim().toLowerCase();

  if (
    type.includes("integer") ||
    type.includes("bigint") ||
    type.includes("smallint")
  ) {
    return "INTEGER";
  }

  if (
    type.includes("double precision") ||
    type.includes("real") ||
    type.includes("numeric") ||
    type.includes("decimal")
  ) {
    return "REAL";
  }

  if (type.includes("bytea") || type.includes("blob")) {
    return "BLOB";
  }

  if (type.includes("boolean")) {
    return "INTEGER";
  }

  return "TEXT";
}

function splitCsvIdentifiers(raw) {
  return raw
    .split(",")
    .map((part) => part.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function preferColumnName(existingName, candidateName) {
  const existingIsLower = existingName === existingName.toLowerCase();
  const candidateIsLower = candidateName === candidateName.toLowerCase();

  if (existingIsLower && !candidateIsLower) {
    return candidateName;
  }

  return existingName;
}

function finalizeTableColumns(table) {
  const preferredNames = new Map();
  const preferredColumns = new Map();

  for (const column of table.columns) {
    const lower = column.name.toLowerCase();
    const chosenName = preferredNames.has(lower)
      ? preferColumnName(preferredNames.get(lower), column.name)
      : column.name;
    preferredNames.set(lower, chosenName);
  }

  for (const column of table.columns) {
    const lower = column.name.toLowerCase();
    if (preferredNames.get(lower) === column.name) {
      preferredColumns.set(lower, column);
    }
  }

  const canonicalize = (name) => preferredNames.get(String(name).toLowerCase()) || name;
  const dedupeNames = (names) => {
    const seen = new Set();
    const out = [];
    for (const name of names) {
      const canonical = canonicalize(name);
      const key = canonical.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(canonical);
    }
    return out;
  };

  table.columns = [...preferredColumns.values()];
  table.primaryKey = dedupeNames(table.primaryKey || []);
  table.uniqueConstraints = (table.uniqueConstraints || []).map((columns) => dedupeNames(columns));
  table.foreignKeys = (table.foreignKeys || []).map((fk) => ({
    ...fk,
    columns: dedupeNames(fk.columns || []),
  }));
  table.canonicalColumnNames = preferredNames;
}

function parseColumnDefinition(rawLine) {
  const line = rawLine.trim().replace(/,$/, "");
  if (!line) return null;
  if (/^(constraint|primary key|unique|foreign key|check)\b/i.test(line)) {
    return null;
  }

  const nameMatch = /^("?[A-Za-z0-9_]+"?)\s+(.+)$/.exec(line);
  if (!nameMatch) {
    throw new Error(`Unable to parse column definition: ${rawLine}`);
  }

  const name = nameMatch[1].replace(/^"|"$/g, "");
  let rest = nameMatch[2].trim();
  const notNull = /\sNOT NULL$/i.test(rest);
  if (notNull) {
    rest = rest.replace(/\sNOT NULL$/i, "");
  }

  let defaultValue = null;
  const defaultIndex = rest.search(/\sDEFAULT\s/i);
  if (defaultIndex >= 0) {
    defaultValue = normalizeDefaultValue(rest.slice(defaultIndex).replace(/^\s*DEFAULT\s+/i, ""));
    rest = rest.slice(0, defaultIndex).trim();
  }

  return {
    name,
    rawType: rest,
    sqliteType: normalizeSqliteType(rest),
    defaultValue,
    notNull,
  };
}

function parseDumpSchema(dumpSql) {
  const tables = new Map();

  for (const match of dumpSql.matchAll(/CREATE TABLE public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);\n/g)) {
    const tableName = match[1];
    const body = match[2];
    const columns = body
      .split("\n")
      .map((line) => parseColumnDefinition(line))
      .filter(Boolean);

    tables.set(tableName, {
      name: tableName,
      columns,
      primaryKey: [],
      uniqueConstraints: [],
      foreignKeys: [],
      autoColumns: new Set(),
      indexes: [],
      rows: [],
      columnIndex: new Map(columns.map((column, index) => [column.name, index])),
    });
  }

  for (const match of dumpSql.matchAll(
    /ALTER TABLE(?: ONLY)? public\.([a-zA-Z0-9_]+)\s+ALTER COLUMN ([A-Za-z0-9_"]+) ADD GENERATED BY DEFAULT AS IDENTITY/gs
  )) {
    const table = tables.get(match[1]);
    if (!table) continue;
    table.autoColumns.add(match[2].replace(/^"|"$/g, ""));
  }

  for (const match of dumpSql.matchAll(
    /ALTER TABLE ONLY public\.([a-zA-Z0-9_]+)\s+ALTER COLUMN ([A-Za-z0-9_"]+) SET DEFAULT nextval\(/gs
  )) {
    const table = tables.get(match[1]);
    if (!table) continue;
    table.autoColumns.add(match[2].replace(/^"|"$/g, ""));
  }

  for (const match of dumpSql.matchAll(
    /ALTER TABLE ONLY public\.([a-zA-Z0-9_]+)\s+ADD CONSTRAINT [^\s]+ PRIMARY KEY \(([^)]+)\);/gs
  )) {
    const table = tables.get(match[1]);
    if (!table) continue;
    table.primaryKey = splitCsvIdentifiers(match[2]);
  }

  for (const match of dumpSql.matchAll(
    /ALTER TABLE ONLY public\.([a-zA-Z0-9_]+)\s+ADD CONSTRAINT [^\s]+ UNIQUE \(([^)]+)\);/gs
  )) {
    const table = tables.get(match[1]);
    if (!table) continue;
    table.uniqueConstraints.push(splitCsvIdentifiers(match[2]));
  }

  for (const match of dumpSql.matchAll(
    /ALTER TABLE ONLY public\.([a-zA-Z0-9_]+)\s+ADD CONSTRAINT [^\s]+ FOREIGN KEY \(([^)]+)\) REFERENCES public\.([a-zA-Z0-9_]+)\(([^)]+)\)([^;]*);/gs
  )) {
    const table = tables.get(match[1]);
    if (!table) continue;
    const tail = match[5] || "";
    const onDelete = /ON DELETE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/i.exec(tail)?.[1] || null;
    const onUpdate = /ON UPDATE (CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/i.exec(tail)?.[1] || null;
    table.foreignKeys.push({
      columns: splitCsvIdentifiers(match[2]),
      refTable: match[3],
      refColumns: splitCsvIdentifiers(match[4]),
      onDelete,
      onUpdate,
    });
  }

  for (const match of dumpSql.matchAll(
    /CREATE (UNIQUE )?INDEX ([^\s]+) ON public\.([a-zA-Z0-9_]+)(?: USING [a-z]+)? \(([^;]+)\);/gs
  )) {
    const table = tables.get(match[3]);
    if (!table) continue;
    table.indexes.push({
      name: match[2].replace(/^public\./, ""),
      unique: Boolean(match[1]),
      expression: match[4].trim(),
    });
  }

  for (const table of tables.values()) {
    finalizeTableColumns(table);
  }

  return tables;
}

function parseDumpData(dumpSql, tables) {
  const lines = dumpSql.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].replace(/\r$/, "");
    const match = /^COPY public\.([a-zA-Z0-9_]+) \(([^)]+)\) FROM stdin;$/.exec(line);
    if (!match) continue;

    const table = tables.get(match[1]);
    if (!table) continue;

    const rawColumns = splitCsvIdentifiers(match[2]);
    const selectedColumns = [];
    const selectedIndexes = [];

    for (const column of table.columns) {
      const targetName = column.name;
      let selectedIndex = -1;

      for (let index = 0; index < rawColumns.length; index += 1) {
        if (rawColumns[index].toLowerCase() !== targetName.toLowerCase()) continue;
        if (selectedIndex < 0 || rawColumns[index] === targetName) {
          selectedIndex = index;
        }
      }

      if (selectedIndex >= 0) {
        selectedColumns.push(targetName);
        selectedIndexes.push(selectedIndex);
      }
    }

    const rows = [];
    lineIndex += 1;

    while (lineIndex < lines.length) {
      const rowLine = lines[lineIndex].replace(/\r$/, "");
      if (rowLine === "\\.") {
        break;
      }

      if (rowLine.length > 0) {
        const rawValues = rowLine.split("\t").map((value) => decodeCopyValue(value));
        rows.push(selectedIndexes.map((index) => rawValues[index] ?? null));
      }

      lineIndex += 1;
    }

    table.copyColumns = selectedColumns;
    table.rows = rows;
  }
}

function createLookupForColumns(table, columns) {
  if (!table || !Array.isArray(table.copyColumns) || !Array.isArray(table.rows)) {
    return new Map();
  }

  const indexMap = new Map();
  const positions = columns.map((column) => {
    const position = table.copyColumns.indexOf(column);
    if (position < 0) {
      throw new Error(`Column ${column} not found in COPY block for ${table.name}`);
    }
    return position;
  });

  table.rows.forEach((row, rowIndex) => {
    const key = JSON.stringify(positions.map((position) => row[position]));
    if (!indexMap.has(key)) {
      indexMap.set(key, rowIndex);
    }
  });

  return indexMap;
}

const IMPLICIT_RELATIONSHIPS = {
  local_sessions: [
    { columns: ["user_id"], refTable: "local_users", refColumns: ["id"] },
  ],
  chat_messages: [
    { columns: ["session_id"], refTable: "chat_sessions", refColumns: ["id"] },
  ],
  chat_hit_images: [
    { columns: ["chat_session_id"], refTable: "chat_sessions", refColumns: ["id"] },
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  camera_algorithms: [
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  camera_algorithm_face_targets: [
    { columns: ["algorithm_id"], refTable: "camera_algorithms", refColumns: ["id"] },
    { columns: ["face_target_id"], refTable: "face_targets", refColumns: ["id"] },
  ],
  camera_algorithm_negative_images: [
    { columns: ["algorithm_id"], refTable: "camera_algorithms", refColumns: ["id"] },
  ],
  face_target_images: [
    { columns: ["face_target_id"], refTable: "face_targets", refColumns: ["id"] },
  ],
  reid_targets: [
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  faceid_targets: [
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  job_steps: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
    { columns: ["input_from_step_id"], refTable: "job_steps", refColumns: ["id"] },
    { columns: ["start_condition_from_step_id"], refTable: "job_steps", refColumns: ["id"] },
  ],
  job_step_targets: [
    { columns: ["step_id"], refTable: "job_steps", refColumns: ["id"] },
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  job_step_agents: [
    { columns: ["step_id"], refTable: "job_steps", refColumns: ["id"] },
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  job_step_agent_face_targets: [
    { columns: ["agent_id"], refTable: "job_step_agents", refColumns: ["id"] },
    { columns: ["face_target_id"], refTable: "face_targets", refColumns: ["id"] },
  ],
  job_step_agent_negative_images: [
    { columns: ["agent_id"], refTable: "job_step_agents", refColumns: ["id"] },
  ],
  job_step_alert_rules: [
    { columns: ["step_id"], refTable: "job_steps", refColumns: ["id"] },
  ],
  job_step_runs: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
    { columns: ["step_id"], refTable: "job_steps", refColumns: ["id"] },
  ],
  job_step_run_logs: [
    { columns: ["step_run_id"], refTable: "job_step_runs", refColumns: ["id"] },
  ],
  job_step_run_results: [
    { columns: ["step_run_id"], refTable: "job_step_runs", refColumns: ["id"] },
  ],
  job_run_alerts: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
  ],
  job_schedule_days: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
  ],
  job_schedule_windows: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
    { columns: ["schedule_day_id"], refTable: "job_schedule_days", refColumns: ["id"] },
  ],
  job_schedule_fires: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
    { columns: ["schedule_day_id"], refTable: "job_schedule_days", refColumns: ["id"] },
    { columns: ["window_id"], refTable: "job_schedule_windows", refColumns: ["id"] },
  ],
  job_schedule_stops: [
    { columns: ["job_id"], refTable: "jobs", refColumns: ["id"] },
    { columns: ["schedule_day_id"], refTable: "job_schedule_days", refColumns: ["id"] },
    { columns: ["window_id"], refTable: "job_schedule_windows", refColumns: ["id"] },
  ],
  drakon_find_target_images: [
    { columns: ["target_id"], refTable: "drakon_find_targets", refColumns: ["id"] },
  ],
  drakon_find_searches: [
    { columns: ["target_id"], refTable: "drakon_find_targets", refColumns: ["id"] },
  ],
  drakon_find_search_cameras: [
    { columns: ["search_id"], refTable: "drakon_find_searches", refColumns: ["id"] },
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  drakon_find_hits: [
    { columns: ["search_id"], refTable: "drakon_find_searches", refColumns: ["id"] },
    { columns: ["camera_id"], refTable: "cameras", refColumns: ["id"] },
  ],
  subscription_token_usage: [
    { columns: ["subscription_id"], refTable: "subscriptions", refColumns: ["id"] },
  ],
  payments: [
    { columns: ["subscription_id"], refTable: "subscriptions", refColumns: ["id"] },
  ],
};

function getRelationshipsForTable(table) {
  const explicit = Array.isArray(table.foreignKeys) ? table.foreignKeys : [];
  const implicit = IMPLICIT_RELATIONSHIPS[table.name] || [];
  return [...explicit, ...implicit];
}

function seedIncludedRows(tables, wantedUsers) {
  const includedByTable = new Map();
  const lookupCache = new Map();
  const localNumericUserIds = new Set(
    [...wantedUsers]
      .map((value) => /^local:(\d+)$/.exec(String(value))?.[1] || null)
      .filter(Boolean)
  );

  function getIncluded(tableName) {
    if (!includedByTable.has(tableName)) {
      includedByTable.set(tableName, new Set());
    }
    return includedByTable.get(tableName);
  }

  function getLookup(tableName, columns) {
    const cacheKey = `${tableName}:${columns.join(",")}`;
    if (!lookupCache.has(cacheKey)) {
      lookupCache.set(cacheKey, createLookupForColumns(tables.get(tableName), columns));
    }
    return lookupCache.get(cacheKey);
  }

  for (const table of tables.values()) {
    if (!Array.isArray(table.rows) || table.rows.length === 0 || !Array.isArray(table.copyColumns)) {
      continue;
    }

    const userIdIndex = table.copyColumns.indexOf("user_id");
    const idIndex = table.copyColumns.indexOf("id");

    table.rows.forEach((row, rowIndex) => {
      let include = false;

      if (userIdIndex >= 0 && wantedUsers.has(String(row[userIdIndex] || ""))) {
        include = true;
      } else if (
        table.name === "local_sessions" &&
        userIdIndex >= 0 &&
        localNumericUserIds.has(String(row[userIdIndex] || ""))
      ) {
        include = true;
      } else if (
        (table.name === "app_users" || table.name === "local_users") &&
        idIndex >= 0 &&
        (
          wantedUsers.has(String(row[idIndex] || "")) ||
          (table.name === "local_users" && localNumericUserIds.has(String(row[idIndex] || "")))
        )
      ) {
        include = true;
      }

      if (include) {
        getIncluded(table.name).add(rowIndex);
      }
    });
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const table of tables.values()) {
      if (!Array.isArray(table.rows) || table.rows.length === 0 || !Array.isArray(table.copyColumns)) {
        continue;
      }

      const includedRows = getIncluded(table.name);

      table.rows.forEach((row, rowIndex) => {
        const isIncluded = includedRows.has(rowIndex);

        for (const fk of getRelationshipsForTable(table)) {
          const sourcePositions = fk.columns.map((column) => table.copyColumns.indexOf(column));
          if (sourcePositions.some((position) => position < 0)) {
            continue;
          }

          const fkValues = sourcePositions.map((position) => row[position]);
          if (fkValues.some((value) => value === null || value === undefined || value === "")) {
            continue;
          }

          const parentLookup = getLookup(fk.refTable, fk.refColumns);
          const parentRowIndex = parentLookup.get(JSON.stringify(fkValues));
          if (parentRowIndex === undefined) {
            continue;
          }

          const parentIncluded = getIncluded(fk.refTable);

          if (isIncluded && !parentIncluded.has(parentRowIndex)) {
            parentIncluded.add(parentRowIndex);
            changed = true;
          }

          if (!isIncluded && parentIncluded.has(parentRowIndex)) {
            includedRows.add(rowIndex);
            changed = true;
          }
        }
      });
    }
  }

  return includedByTable;
}

function buildCreateTableSql(table) {
  const pk = table.primaryKey || [];
  const singlePk = pk.length === 1 ? pk[0] : null;

  const columnSql = table.columns.map((column) => {
    const isSinglePrimaryKey = singlePk === column.name;
    const isSingleIntegerPrimaryKey =
      isSinglePrimaryKey && column.sqliteType === "INTEGER";
    const parts = [quoteIdent(column.name)];

    if (isSingleIntegerPrimaryKey) {
      parts.push("INTEGER PRIMARY KEY");
    } else {
      parts.push(column.sqliteType);
      if (isSinglePrimaryKey) {
        parts.push("PRIMARY KEY");
      }
    }

    if (column.notNull && !isSingleIntegerPrimaryKey) {
      parts.push("NOT NULL");
    }

    if (column.defaultValue !== null && !isSingleIntegerPrimaryKey) {
      parts.push(`DEFAULT ${column.defaultValue}`);
    }

    return parts.join(" ");
  });

  if (pk.length > 1) {
    columnSql.push(`PRIMARY KEY (${pk.map(quoteIdent).join(", ")})`);
  }

  for (const uniqueColumns of table.uniqueConstraints) {
    columnSql.push(`UNIQUE (${uniqueColumns.map(quoteIdent).join(", ")})`);
  }

  for (const fk of table.foreignKeys) {
    const parts = [
      `FOREIGN KEY (${fk.columns.map(quoteIdent).join(", ")})`,
      `REFERENCES ${quoteIdent(fk.refTable)} (${fk.refColumns.map(quoteIdent).join(", ")})`,
    ];
    if (fk.onDelete) parts.push(`ON DELETE ${fk.onDelete.toUpperCase()}`);
    if (fk.onUpdate) parts.push(`ON UPDATE ${fk.onUpdate.toUpperCase()}`);
    columnSql.push(parts.join(" "));
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (\n  ${columnSql.join(",\n  ")}\n);`;
}

function buildCreateIndexSql(table) {
  return table.indexes.map((index) => {
    const unique = index.unique ? "UNIQUE " : "";
    return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(index.name)} ON ${quoteIdent(table.name)} (${index.expression});`;
  });
}

function createSqliteDatabase(outPath, tables, includedByTable, schemaOutPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) {
    fs.rmSync(outPath, { force: true });
  }

  const db = new DatabaseSync(outPath);
  const schemaStatements = [];
  const report = {
    output: outPath,
    tables_created: 0,
    rows_imported: {},
    foreign_key_violations: [],
  };

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  for (const table of tables.values()) {
    const sql = buildCreateTableSql(table);
    schemaStatements.push(sql);
    db.exec(sql);
    report.tables_created += 1;
  }

  for (const table of tables.values()) {
    if (!Array.isArray(table.rows) || table.rows.length === 0 || !Array.isArray(table.copyColumns)) {
      continue;
    }

    const included = includedByTable.get(table.name) || new Set();
    if (included.size === 0) {
      continue;
    }

    const insertSql = `INSERT INTO ${quoteIdent(table.name)} (${table.copyColumns
      .map(quoteIdent)
      .join(", ")}) VALUES (${table.copyColumns.map(() => "?").join(", ")})`;
    const statement = db.prepare(insertSql);

    let inserted = 0;
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      if (!included.has(rowIndex)) continue;
      const row = table.rows[rowIndex];
      statement.run(...row);
      inserted += 1;
    }

    report.rows_imported[table.name] = inserted;
  }

  for (const table of tables.values()) {
    for (const sql of buildCreateIndexSql(table)) {
      schemaStatements.push(sql);
      db.exec(sql);
    }
  }

  db.exec("PRAGMA foreign_keys = ON");
  const fkCheckRows = db.prepare("PRAGMA foreign_key_check").all();
  report.foreign_key_violations = fkCheckRows;

  if (schemaOutPath) {
    fs.writeFileSync(schemaOutPath, `${schemaStatements.join("\n\n")}\n`, "utf8");
  }

  db.close();
  return report;
}

function loadBrandConfig() {
  const configPath = path.join(workspaceRoot, "brand.config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function resolveDefaultPaths(targetBrand) {
  const config = loadBrandConfig();
  const dataRoot =
    config?.brands?.[targetBrand]?.dataRootWindows ||
    path.resolve(workspaceRoot, "DrakonSite", "storage", targetBrand);
  const localDir = path.join(dataRoot, "local-site");
  return {
    dump: path.join(workspaceRoot, "Postgres", "perceptrum_site.sql"),
    out: path.join(localDir, "perceptrum_site.sqlite"),
    report: path.join(localDir, "perceptrum_site.import-report.json"),
    schema: path.join(localDir, "perceptrum_site.sqlite.schema.sql"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetBrand = String(args.brand || "perceptrum").trim().toLowerCase();
  const defaults = resolveDefaultPaths(targetBrand);
  const dumpPath = path.resolve(args.dump || defaults.dump);
  const outPath = path.resolve(args.out || defaults.out);
  const reportPath = path.resolve(args.report || defaults.report);
  const schemaOutPath = path.resolve(args["schema-out"] || defaults.schema);
  const userIds = String(args.users || "local:1,local:3,local:5,local:6")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const dumpSql = fs.readFileSync(dumpPath, "utf8");
  const tables = parseDumpSchema(dumpSql);
  parseDumpData(dumpSql, tables);

  const includedByTable = seedIncludedRows(tables, new Set(userIds));
  const report = createSqliteDatabase(outPath, tables, includedByTable, schemaOutPath);

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        brand: targetBrand,
        dump: dumpPath,
        users: userIds,
        ...report,
      },
      null,
      2
    ),
    "utf8"
  );

  const importedTables = Object.entries(report.rows_imported)
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));

  console.log(`SQLite database created at: ${outPath}`);
  console.log(`Schema SQL written to: ${schemaOutPath}`);
  console.log(`Import report written to: ${reportPath}`);
  console.log(`Imported users: ${userIds.join(", ")}`);
  for (const [tableName, count] of importedTables) {
    console.log(`${tableName}\t${count}`);
  }

  if (Array.isArray(report.foreign_key_violations) && report.foreign_key_violations.length > 0) {
    console.warn(`Foreign key violations detected: ${report.foreign_key_violations.length}`);
    process.exitCode = 2;
  }
}

main();

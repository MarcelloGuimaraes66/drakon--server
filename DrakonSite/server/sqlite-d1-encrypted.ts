import fs from "fs";
import path from "path";
import Database from "better-sqlite3-multiple-ciphers";

type BetterSqliteDatabase = InstanceType<typeof Database>;

type BindValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | Date
  | Buffer
  | Uint8Array;

type QueryMeta = {
  changes?: number;
  last_row_id?: number | null;
};

export type D1Result<T = any> = {
  results?: T[];
  meta?: QueryMeta;
};

export type SqliteCipherConfig = {
  keyHex: string;
  cipher?: string;
  legacy?: number;
};

function normalizeValue(value: BindValue) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value;
}

function normalizeRows(rows: unknown) {
  if (!Array.isArray(rows)) return [];
  return rows as any[];
}

function normalizeLastInsertRowId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : null;
}

function normalizeKeyHex(value: string) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) {
    throw new Error("Desktop SQLite encryption requires a 32-byte hex key.");
  }
  return trimmed;
}

function escapeSqliteStringLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function applyCipherConfig(db: BetterSqliteDatabase, config: SqliteCipherConfig) {
  const cipher = String(config.cipher || "sqlcipher").trim() || "sqlcipher";
  const legacy =
    typeof config.legacy === "number" && Number.isFinite(config.legacy) ? config.legacy : 4;

  db.pragma(`cipher='${escapeSqliteStringLiteral(cipher)}'`);
  db.pragma(`legacy=${legacy}`);
}

function createKeyBuffer(keyHex: string) {
  return Buffer.from(normalizeKeyHex(keyHex), "hex");
}

export function rekeyPlaintextSqliteDatabase(filePath: string, config: SqliteCipherConfig) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  try {
    applyCipherConfig(db, config);
    db.rekey(createKeyBuffer(config.keyHex));
  } finally {
    try {
      db.close();
    } catch {
      // ignore close errors when a keying attempt already failed
    }
  }
}

class SqliteEncryptedD1Statement {
  private db: BetterSqliteDatabase;
  private sql: string;
  private params: BindValue[];

  constructor(db: BetterSqliteDatabase, sql: string, params: BindValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: BindValue[]) {
    return new SqliteEncryptedD1Statement(this.db, this.sql, params);
  }

  async all<T = any>(): Promise<D1Result<T>> {
    const statement = this.db.prepare(this.sql);
    const rows = normalizeRows(statement.all(...this.params.map(normalizeValue)));
    return { results: rows as T[] };
  }

  async first<T = any>(): Promise<T | null> {
    const statement = this.db.prepare(this.sql);
    const row = statement.get(...this.params.map(normalizeValue));
    return (row as T | undefined) ?? null;
  }

  async run(): Promise<D1Result> {
    const statement = this.db.prepare(this.sql);
    const result = statement.run(...this.params.map(normalizeValue));
    return {
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: normalizeLastInsertRowId(result.lastInsertRowid),
      },
    };
  }
}

export class EncryptedSqliteD1Database {
  private db: BetterSqliteDatabase;
  private isClosed = false;

  constructor(filePath: string, config: SqliteCipherConfig) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    applyCipherConfig(this.db, config);
    this.db.key(createKeyBuffer(config.keyHex));
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("busy_timeout = 5000");
  }

  prepare(sql: string) {
    return new SqliteEncryptedD1Statement(this.db, sql);
  }

  close() {
    if (this.isClosed) {
      return;
    }

    try {
      this.db.close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
      if (!message.includes("database connection is not open")) {
        throw error;
      }
    } finally {
      this.isClosed = true;
    }
  }
}

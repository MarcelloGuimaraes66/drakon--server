import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

type BindValue = string | number | boolean | bigint | null | undefined | Date | Buffer | Uint8Array;

type QueryMeta = {
  changes?: number;
  last_row_id?: number | null;
};

export type D1Result<T = any> = {
  results?: T[];
  meta?: QueryMeta;
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

class SqliteD1Statement {
  private db: DatabaseSync;
  private sql: string;
  private params: BindValue[];

  constructor(db: DatabaseSync, sql: string, params: BindValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params: BindValue[]) {
    return new SqliteD1Statement(this.db, this.sql, params);
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

export class SqliteD1Database {
  private db: DatabaseSync;
  private isClosed = false;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
  }

  prepare(sql: string) {
    return new SqliteD1Statement(this.db, sql);
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
      if (!message.includes("database is not open")) {
        throw error;
      }
    } finally {
      this.isClosed = true;
    }
  }
}

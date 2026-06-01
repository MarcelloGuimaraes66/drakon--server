import fs from "fs";
import { SqliteD1Database } from "./sqlite-d1";
import {
  EncryptedSqliteD1Database,
  rekeyPlaintextSqliteDatabase,
  type SqliteCipherConfig,
} from "./sqlite-d1-encrypted";

export type DesktopSqliteEncryptionMode = "off" | "required";

export type DesktopSqliteEncryptionConfig = {
  mode: DesktopSqliteEncryptionMode;
  keyHex: string;
  keyVersion: string;
  cipher: string;
  legacy: number;
};

export type DesktopSqliteDatabase = SqliteD1Database | EncryptedSqliteD1Database;

const SQLITE_PLAINTEXT_HEADER = "SQLite format 3\0";

function normalizeKeyHex(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function resolveDesktopSqliteEncryptionConfig(
  env: NodeJS.ProcessEnv = process.env
): DesktopSqliteEncryptionConfig {
  const mode =
    String(env.APP_SQLITE_ENCRYPTION || "")
      .trim()
      .toLowerCase() === "required"
      ? "required"
      : "off";
  const keyHex = normalizeKeyHex(String(env.APP_SQLITE_KEY_HEX || ""));
  const keyVersion = String(env.APP_SQLITE_KEY_VERSION || "").trim() || "v1";
  const cipher = String(env.APP_SQLITE_CIPHER || "").trim() || "sqlcipher";
  const parsedLegacy = Number.parseInt(String(env.APP_SQLITE_LEGACY || "4"), 10);
  const legacy = Number.isFinite(parsedLegacy) ? parsedLegacy : 4;

  if (mode === "required" && !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error(
      "Desktop SQLite encryption is enabled, but APP_SQLITE_KEY_HEX is missing or invalid."
    );
  }

  return {
    mode,
    keyHex,
    keyVersion,
    cipher,
    legacy,
  };
}

export function isDesktopSqliteEncryptionRequired(config: DesktopSqliteEncryptionConfig) {
  return config.mode === "required";
}

export function hasPlaintextSqliteHeader(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const fileDescriptor = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(fileDescriptor, header, 0, header.length, 0);
    if (bytesRead <= 0) {
      return false;
    }

    return header.subarray(0, bytesRead).toString("ascii") === SQLITE_PLAINTEXT_HEADER;
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

export function createDesktopSqliteDatabase(
  filePath: string,
  config: DesktopSqliteEncryptionConfig
): DesktopSqliteDatabase {
  if (isDesktopSqliteEncryptionRequired(config)) {
    return new EncryptedSqliteD1Database(filePath, toCipherConfig(config));
  }

  return new SqliteD1Database(filePath);
}

export async function checkpointPlaintextSqlite(filePath: string) {
  const db = new SqliteD1Database(filePath);
  try {
    await db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  } finally {
    db.close();
  }
}

export async function encryptPlaintextSqliteInPlace(
  filePath: string,
  config: DesktopSqliteEncryptionConfig
) {
  if (!isDesktopSqliteEncryptionRequired(config)) {
    return;
  }

  rekeyPlaintextSqliteDatabase(filePath, toCipherConfig(config));
}

function toCipherConfig(config: DesktopSqliteEncryptionConfig): SqliteCipherConfig {
  return {
    keyHex: config.keyHex,
    cipher: config.cipher,
    legacy: config.legacy,
  };
}

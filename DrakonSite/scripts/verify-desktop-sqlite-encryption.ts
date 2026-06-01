import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

import {
  checkpointPlaintextSqlite,
  createDesktopSqliteDatabase,
  encryptPlaintextSqliteInPlace,
  hasPlaintextSqliteHeader,
  type DesktopSqliteEncryptionConfig,
} from "../server/sqlite-encryption";

const root = path.resolve(process.cwd(), "tmp", "desktop-sqlite-encryption");
const sqlitePath = path.join(root, "desktop-encryption-smoke.sqlite");
const config: DesktopSqliteEncryptionConfig = {
  mode: "required",
  keyHex: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  keyVersion: "v1",
  cipher: "sqlcipher",
  legacy: 4,
};

function removeArtifacts(targetPath: string) {
  for (const artifact of [
    targetPath,
    `${targetPath}-wal`,
    `${targetPath}-shm`,
    `${targetPath}-journal`,
  ]) {
    if (fs.existsSync(artifact)) {
      fs.rmSync(artifact, { force: true });
    }
  }
}

async function main() {
  fs.mkdirSync(root, { recursive: true });
  removeArtifacts(sqlitePath);

  const plaintextDb = new DatabaseSync(sqlitePath);
  plaintextDb.exec("PRAGMA journal_mode = WAL");
  plaintextDb.exec("CREATE TABLE smoke(id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  plaintextDb.exec("INSERT INTO smoke(value) VALUES ('ok')");
  plaintextDb.close();

  await checkpointPlaintextSqlite(sqlitePath);

  if (!hasPlaintextSqliteHeader(sqlitePath)) {
    throw new Error("Expected the smoke database to start as plaintext SQLite.");
  }

  await encryptPlaintextSqliteInPlace(sqlitePath, config);

  if (hasPlaintextSqliteHeader(sqlitePath)) {
    throw new Error("Expected the smoke database header to become non-plaintext after encryption.");
  }

  let plainOpenFailed = false;
  try {
    const db = new DatabaseSync(sqlitePath);
    db.prepare("SELECT * FROM smoke").get();
    db.close();
  } catch {
    plainOpenFailed = true;
  }

  if (!plainOpenFailed) {
    throw new Error("Expected opening the encrypted smoke database without a key to fail.");
  }

  const encryptedDb = createDesktopSqliteDatabase(sqlitePath, config);
  try {
    const row = await encryptedDb.prepare("SELECT value FROM smoke WHERE id = 1").first<{
      value: string;
    }>();
    if (!row || row.value !== "ok") {
      throw new Error(`Unexpected row payload after encrypted reopen: ${JSON.stringify(row)}`);
    }
  } finally {
    encryptedDb.close();
  }

  console.log("desktop sqlite encryption smoke test passed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

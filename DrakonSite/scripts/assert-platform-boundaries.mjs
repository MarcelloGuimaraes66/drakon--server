#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const reactRoot = join(scriptDir, "..", "src", "react-app");

const forbiddenPatterns = [
  /Microsoft\.UI/,
  /WinUI/,
  /WebView2/,
  /C\+\+\/WinRT/,
  /\bwinrt\b/i,
  /\bAppHost\b/,
];

const checkedExtensions = new Set([".ts", ".tsx", ".css"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (checkedExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

const violations = [];
for (const file of await walk(reactRoot)) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(text)) {
      violations.push(`${file}: ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error("React common UI must not depend on Windows host APIs:");
  violations.forEach((violation) => console.error(`  ${violation}`));
  process.exit(1);
}

console.log("React common UI platform boundary OK.");

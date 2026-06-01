import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = { out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out" || token === "-o") {
      args.out = argv[index + 1] || "";
      index += 1;
    }
  }
  return args;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(source, destination) {
  if (!(await exists(source))) {
    throw new Error(`Required runtime package is missing: ${source}`);
  }

  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
  });
}

async function writeLauncher(runtimeRoot) {
  const launcherPath = path.join(runtimeRoot, "perceptrum-local-backend.sh");
  await fs.writeFile(
    launcherPath,
    `#!/usr/bin/env sh
set -eu

backend_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "\${APP_RUNTIME_ROOT:-}" ]; then
  APP_RUNTIME_ROOT="$backend_dir"
  export APP_RUNTIME_ROOT
fi
export NODE_PATH="$backend_dir/node_modules\${NODE_PATH:+:$NODE_PATH}"
exec node "$backend_dir/desktop-local-server.cjs"
`,
    "utf8"
  );
  await fs.chmod(launcherPath, 0o755);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    throw new Error("Usage: node stage-backend-runtime.mjs --out <runtime-dir>");
  }

  const workspaceRoot = path.resolve(import.meta.dirname, "..", "..");
  const appHostRoot = path.join(workspaceRoot, "AppHost");
  const drakonSiteRoot = path.join(workspaceRoot, "DrakonSite");
  const runtimeRoot = path.resolve(args.out);
  const bootstrapRoot = path.join(runtimeRoot, "bootstrap");
  const nodeModulesRoot = path.join(runtimeRoot, "node_modules");
  const requireFromDrakonSite = createRequire(path.join(drakonSiteRoot, "package.json"));
  const esbuild = requireFromDrakonSite("esbuild");

  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(bootstrapRoot, { recursive: true });
  await fs.mkdir(nodeModulesRoot, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(appHostRoot, "Runtime", "desktop-local-server.mjs")],
    absWorkingDir: drakonSiteRoot,
    alias: {
      "@": path.join(drakonSiteRoot, "src"),
    },
    bundle: true,
    conditions: ["node", "require", "default"],
    external: ["better-sqlite3-multiple-ciphers"],
    format: "cjs",
    logLevel: "info",
    minify: false,
    nodePaths: [path.join(drakonSiteRoot, "node_modules")],
    outfile: path.join(runtimeRoot, "desktop-local-server.cjs"),
    platform: "node",
    sourcemap: false,
    target: "node22",
  });

  for (const packageName of [
    "better-sqlite3-multiple-ciphers",
    "bindings",
    "file-uri-to-path",
  ]) {
    await copyDir(
      path.join(drakonSiteRoot, "node_modules", ...packageName.split("/")),
      path.join(nodeModulesRoot, ...packageName.split("/"))
    );
  }

  await execFileAsync(process.execPath, [
    path.join(drakonSiteRoot, "scripts", "convert-postgres-dump-to-sqlite.mjs"),
    "--brand",
    "perceptrum",
    "--schema-only",
    "--out",
    path.join(bootstrapRoot, "perceptrum_site.seed.sqlite"),
    "--report",
    path.join(bootstrapRoot, "perceptrum_site.seed.import-report.json"),
    "--schema-out",
    path.join(bootstrapRoot, "perceptrum_site.seed.schema.sql"),
  ]);

  await writeLauncher(runtimeRoot);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

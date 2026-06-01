import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";

function parseArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

const outDirArg = parseArgValue("--out-dir");
const outputDir = path.resolve(outDirArg || path.join(process.cwd(), "tmp", "central-auth-keys"));

fs.mkdirSync(outputDir, { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).trim();
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).trim();

const publicPath = path.join(outputDir, "central-auth-public.pem");
const privatePath = path.join(outputDir, "central-auth-private.pem");

fs.writeFileSync(publicPath, `${publicPem}\n`, { encoding: "utf8", mode: 0o644 });
fs.writeFileSync(privatePath, `${privatePem}\n`, { encoding: "utf8", mode: 0o600 });

console.log(`[central-auth keys] public: ${publicPath}`);
console.log(`[central-auth keys] private: ${privatePath}`);
console.log("");
console.log("Suggested server env entries:");
console.log(`CENTRAL_AUTH_PUBLIC_KEY_PATH=${publicPath}`);
console.log(`CENTRAL_AUTH_PRIVATE_KEY_PATH=${privatePath}`);

import fs from "fs";
import path from "path";
import { Readable } from "stream";

type HttpMetadata = {
  contentType?: string;
};

type LocalR2Object = {
  body: ReadableStream;
  httpMetadata?: HttpMetadata;
  httpEtag: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
  writeHttpMetadata: (headers: Headers) => void;
};

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toBuffer(value: ArrayBuffer | Uint8Array | string | Buffer) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return Buffer.from(String(value));
}

function readMeta(metaPath: string): HttpMetadata | null {
  if (!fs.existsSync(metaPath)) return null;
  try {
    const raw = fs.readFileSync(metaPath, "utf8");
    return JSON.parse(raw) as HttpMetadata;
  } catch {
    return null;
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export class LocalR2Bucket {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    ensureDir(this.rootDir);
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | string | Buffer,
    options?: { httpMetadata?: HttpMetadata }
  ) {
    const filePath = path.join(this.rootDir, key);
    ensureDir(path.dirname(filePath));

    const buffer = toBuffer(value);
    await fs.promises.writeFile(filePath, buffer);

    const metaPath = `${filePath}.meta.json`;
    const meta = {
      contentType: options?.httpMetadata?.contentType || null,
    };
    await fs.promises.writeFile(metaPath, JSON.stringify(meta));
  }

  async get(key: string): Promise<LocalR2Object | null> {
    const filePath = path.join(this.rootDir, key);
    if (!fs.existsSync(filePath)) return null;

    const stat = await fs.promises.stat(filePath);
    const metaPath = `${filePath}.meta.json`;
    const meta = readMeta(metaPath);
    const httpMetadata = meta?.contentType ? { contentType: meta.contentType } : undefined;
    const httpEtag = `W/"${stat.size}-${stat.mtimeMs}"`;
    const stream = fs.createReadStream(filePath);
    const readFileBuffer = () => fs.promises.readFile(filePath);

    return {
      body: Readable.toWeb(stream) as ReadableStream,
      httpMetadata,
      httpEtag,
      async arrayBuffer() {
        const buffer = await readFileBuffer();
        return bufferToArrayBuffer(buffer);
      },
      async text() {
        const buffer = await readFileBuffer();
        return buffer.toString("utf8");
      },
      async json<T = unknown>() {
        return JSON.parse(await this.text()) as T;
      },
      writeHttpMetadata(headers: Headers) {
        if (httpMetadata?.contentType) {
          headers.set("content-type", httpMetadata.contentType);
        }
      },
    };
  }

  async delete(key: string) {
    const filePath = path.join(this.rootDir, key);
    const metaPath = `${filePath}.meta.json`;

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    if (fs.existsSync(metaPath)) {
      await fs.promises.unlink(metaPath);
    }
  }
}

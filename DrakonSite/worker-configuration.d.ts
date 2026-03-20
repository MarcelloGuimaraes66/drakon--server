/// <reference path="./src/worker/env.d.ts" />

// Minimal Cloudflare Workers types to satisfy TypeScript during local builds.
// If you later install @cloudflare/workers-types, these can be removed.
declare global {
  type D1Database = any;
  type R2Bucket = any;
  type ScheduledEvent = any;
  interface ExecutionContext {
    waitUntil(promise: Promise<any>): void;
    passThroughOnException?: () => void;
  }
}

export {};

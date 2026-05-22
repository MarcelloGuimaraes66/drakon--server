import "hono";

declare global {
  interface Env {
    DB: D1Database;
    R2_BUCKET: R2Bucket;
    GOOGLE_OAUTH_CLIENT_ID: string;
    GOOGLE_OAUTH_CLIENT_SECRET: string;
    GOOGLE_OAUTH_REDIRECT_URI?: string;
    DESKTOP_GOOGLE_OAUTH_REDIRECT_URI?: string;
    GOOGLE_GEOCODING_API_KEY?: string;
    GEONAMES_USERNAME?: string;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_CHAT_PAYG_PRICE_ID: string;
    R2_PUBLIC_BASE_URL?: string;
    LOCAL_MEDIA_BASE_DIR?: string;
    APP_SERVICE_SESSION_DIR?: string;
    STORAGE_ROOT?: string;
    CAMERA_RECORDINGS_BASE_DIR?: string;
    APP_ALLOWED_ORIGINS?: string;
    APP_AGENT_BASE_URL?: string;
    APP_SERVER_ROLE?: string;
    USD_TO_BRL?: string;
    SCHEDULER_TICK_SECRET?: string;
    CHAT_V2_ENABLED?: string;
    LOCAL_AGENT_INGEST_MODE?: string;
    LOCAL_AGENT_INGEST_POLL_MS?: string;
    LOCAL_AGENT_EVENT_BATCH_SIZE?: string;
    LOCAL_AGENT_LATEST_BATCH_SIZE?: string;
    LOCAL_AGENT_EVENT_MAX_ATTEMPTS?: string;
    APP_SCHEMA_SCOPE?: string;
    CENTRAL_AUTH_BASE_URL?: string;
    CENTRAL_AUTH_PUBLIC_KEY?: string;
    CENTRAL_AUTH_PRIVATE_KEY?: string;
    CENTRAL_AUTH_GRANT_TTL_HOURS?: string;
    CENTRAL_AUTH_DEVICE_SESSION_TTL_DAYS?: string;
    CENTRAL_AUTH_KEY_ID?: string;
  }

  type WorkerAuthenticatedUser = {
    id: string;
    email: string;
    auth_provider: string;
    country_code?: string | null;
    google_user_data?: unknown;
  };
}

declare module "hono" {
  interface ContextVariableMap {
    user?: WorkerAuthenticatedUser;
  }
}

export {};

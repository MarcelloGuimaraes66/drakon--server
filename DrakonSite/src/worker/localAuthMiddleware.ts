import { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { brand } from "@/shared/brand";
import {
  getLocalSessionUserByToken,
  resolveCanonicalAppUserIdFromLocalUserRow,
} from "./localIdentity";

const LOCAL_SESSION_COOKIE_NAME = brand.cookieNames.localSession;
const GOOGLE_SESSION_COOKIE_NAME = `${brand.id}_google_session`;

interface LocalUser {
  id: string;
  email: string;
  country_code?: string | null;
  auth_provider: "local";
}

interface GoogleUser {
  id: string;
  email: string;
  google_sub: string;
  google_user_data: any;
  auth_provider: "google";
  last_signed_in_at: string;
  created_at: string;
  updated_at: string;
}

type UnifiedUser = LocalUser | GoogleUser;

declare module "hono" {
  interface ContextVariableMap {
    unifiedUser?: UnifiedUser;
  }
}

/**
 * Combined auth middleware that supports both local email/password sessions
 * and first-party Google OAuth sessions stored by the app.
 */
export const localAuthMiddleware: MiddlewareHandler = async (c: Context, next) => {
  const env = c.env as any;

  const localSessionToken = getCookie(c, LOCAL_SESSION_COOKIE_NAME);
  if (localSessionToken) {
    const session = await getLocalSessionUserByToken(env.DB, localSessionToken);

    if (session) {
      const sessionData = session as any;
      const localUser: LocalUser = {
        id: resolveCanonicalAppUserIdFromLocalUserRow(sessionData),
        email: sessionData.email,
        country_code: sessionData.country_code,
        auth_provider: "local",
      };

      c.set("user", localUser as any);
      c.set("unifiedUser", localUser);
      await next();
      return;
    }
  }

  const googleSessionToken = getCookie(c, GOOGLE_SESSION_COOKIE_NAME);
  if (googleSessionToken) {
    const session = await env.DB.prepare(
      `SELECT
         os.user_id,
         au.email,
         oi.provider_subject,
         oi.profile_json,
         oi.last_signed_in_at,
         au.created_at,
         au.updated_at
       FROM oauth_sessions os
       JOIN app_users au ON au.id = os.user_id
       LEFT JOIN oauth_identities oi
         ON oi.provider = os.provider
        AND oi.provider_subject = os.provider_subject
       WHERE os.session_token = ?
         AND os.provider = 'google'
         AND os.expires_at > ?
       LIMIT 1`
    )
      .bind(googleSessionToken, new Date().toISOString())
      .first();

    if (session) {
      let googleUserData: any = null;
      const rawProfile = (session as any).profile_json;
      if (typeof rawProfile === "string" && rawProfile.trim()) {
        try {
          googleUserData = JSON.parse(rawProfile);
        } catch {
          googleUserData = null;
        }
      }

      const googleUser: GoogleUser = {
        id: String((session as any).user_id || ""),
        email: String((session as any).email || ""),
        google_sub: String((session as any).provider_subject || ""),
        google_user_data: googleUserData,
        auth_provider: "google",
        last_signed_in_at: String((session as any).last_signed_in_at || ""),
        created_at: String((session as any).created_at || ""),
        updated_at: String((session as any).updated_at || ""),
      };

      c.set("user", googleUser as any);
      c.set("unifiedUser", googleUser);
      await next();
      return;
    }
  }

  throw new HTTPException(401, { message: "Unauthorized" });
};

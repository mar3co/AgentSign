import { createHash } from "node:crypto";
import {
  sessionCookieAttrs,
  type AuthAdapter,
  type AuthUser,
} from "./supabase.js";

const ACCESS_COOKIE = "sb-access-token";
const TOKEN_PREFIX = "dev.";

/** Deterministic UUID-shaped id so the same email is the same user forever. */
export function devUserId(email: string): string {
  const h = createHash("sha256").update(email.toLowerCase()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function tokenFor(email: string): string {
  return `${TOKEN_PREFIX}${Buffer.from(email).toString("base64url")}`;
}

function emailFromToken(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const email = Buffer.from(
      token.slice(TOKEN_PREFIX.length),
      "base64url",
    ).toString("utf8");
    return email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq !== -1 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function userFor(email: string): AuthUser {
  return { id: devUserId(email), email };
}

/**
 * DEV_OFFLINE auth: any email plus any non-empty password logs in, no user
 * store, sessions are a readable cookie. Selected by getAuth() only when
 * devOffline() is true and Supabase is not configured; never in production.
 */
export const devOfflineAuth: AuthAdapter = {
  async sendMagicLink() {
    throw new Error(
      "Magic links need Supabase. In offline dev, log in with any email and password.",
    );
  },
  async signInWithPassword({ email, password }) {
    if (!email.includes("@") || !password) {
      return {
        ok: false,
        error: "Enter an email and any password (offline dev mode).",
        code: "invalid_credentials",
      };
    }
    return {
      ok: true,
      user: userFor(email),
      cookie: `${ACCESS_COOKIE}=${tokenFor(email)}; ${sessionCookieAttrs()}`,
    };
  },
  async signUp({ email, password }) {
    if (!email.includes("@") || !password) {
      return {
        ok: false,
        error: "Enter an email and any password (offline dev mode).",
        code: "signup_failed",
      };
    }
    return { ok: true };
  },
  async startOAuth() {
    throw new Error(
      "OAuth needs Supabase. In offline dev, log in with any email and password.",
    );
  },
  async userFromCookie(cookieHeader) {
    const token = cookieValue(cookieHeader, ACCESS_COOKIE);
    if (!token) return null;
    const email = emailFromToken(token);
    return email ? userFor(email) : null;
  },
  async exchangeCode() {
    return null;
  },
  async startPasskeyAuthentication() {
    return {
      ok: false as const,
      error:
        "Passkeys need Supabase. In offline dev, log in with any email and password.",
      code: "passkey_disabled",
    };
  },
  async verifyPasskeyAuthentication() {
    return {
      ok: false as const,
      error:
        "Passkeys need Supabase. In offline dev, log in with any email and password.",
      code: "passkey_disabled",
    };
  },
  async startPasskeyRegistration() {
    return {
      ok: false as const,
      error:
        "Passkeys need Supabase. In offline dev, log in with any email and password.",
      code: "passkey_disabled",
    };
  },
  async verifyPasskeyRegistration() {
    return {
      ok: false as const,
      error:
        "Passkeys need Supabase. In offline dev, log in with any email and password.",
      code: "passkey_disabled",
    };
  },
  async listPasskeys() {
    return {
      ok: false as const,
      error:
        "Passkeys need Supabase. In offline dev, log in with any email and password.",
      code: "passkey_disabled",
    };
  },
  async deletePasskey() {
    return {
      ok: false as const,
      error:
        "Passkeys need Supabase. In offline dev, log in with any email and password.",
      code: "passkey_disabled",
    };
  },
};

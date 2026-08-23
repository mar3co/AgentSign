import { createClient } from "@supabase/supabase-js";
import { appOrigin, getEnv } from "../../env.js";
import { getDeps } from "../deps.js";

export type AuthUser = { id: string; email: string };

export type AuthAdapter = {
  sendMagicLink(input: {
    email: string;
    emailRedirectTo: string;
  }): Promise<void | { cookies?: string[] }>;
  signInWithPassword(input: {
    email: string;
    password: string;
  }): Promise<
    | { ok: true; user: AuthUser; cookie: string }
    | { ok: false; error: string; code: string }
  >;
  signUp(input: {
    email: string;
    password: string;
  }): Promise<{ ok: true } | { ok: false; error: string; code: string }>;
  startOAuth(input: {
    provider: "google" | "github";
    redirectTo: string;
  }): Promise<{ url: string; cookies?: string[] }>;
  userFromCookie(cookieHeader: string | null): Promise<AuthUser | null>;
  exchangeCode(
    code: string,
    cookieHeader?: string | null,
  ): Promise<{ user: AuthUser; cookie: string } | null>;
};

const ACCESS_COOKIE = "sb-access-token";
const PKCE_COOKIE = "sign-pkce";

export function sessionCookieAttrs(): string {
  const secure = appOrigin().startsWith("https:") ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

function sessionCookie(accessToken: string): string {
  return `${ACCESS_COOKIE}=${accessToken}; ${sessionCookieAttrs()}`;
}

/** Expired copies of every auth cookie we set, for logout. */
export function clearedSessionCookies(): string[] {
  return [ACCESS_COOKIE, PKCE_COOKIE].map(
    (name) => `${name}=; ${sessionCookieAttrs()}; Max-Age=0`,
  );
}

function bagFromCookie(header: string | null): Map<string, string> {
  const bag = new Map<string, string>();
  const raw = parseCookie(header, PKCE_COOKIE);
  if (!raw) return bag;
  try {
    const obj = JSON.parse(decodeURIComponent(raw)) as Record<string, string>;
    for (const [k, v] of Object.entries(obj)) bag.set(k, v);
  } catch {
    return bag;
  }
  return bag;
}

function bagCookie(bag: Map<string, string>): string {
  return `${PKCE_COOKIE}=${encodeURIComponent(JSON.stringify(Object.fromEntries(bag)))}; ${sessionCookieAttrs()}`;
}

function pkceStorage(bag: Map<string, string>) {
  return {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => {
      bag.set(key, value);
    },
    removeItem: (key: string) => {
      bag.delete(key);
    },
  };
}

const unconfigured: AuthAdapter = {
  async sendMagicLink() {
    throw new Error("Supabase is not configured");
  },
  async signInWithPassword() {
    return {
      ok: false,
      error: "Supabase is not configured",
      code: "unauthorized",
    };
  },
  async signUp() {
    return {
      ok: false,
      error: "Supabase is not configured",
      code: "unauthorized",
    };
  },
  async startOAuth() {
    throw new Error("Supabase is not configured");
  },
  async userFromCookie() {
    return null;
  },
  async exchangeCode() {
    return null;
  },
};

/** Real GoTrue client. Tests inject a fake adapter via setDeps({ auth }). */
export function createSupabaseAuth(): AuthAdapter {
  const env = getEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return unconfigured;
  function clientFor(bag: Map<string, string>) {
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",
        persistSession: false,
        autoRefreshToken: false,
        storage: pkceStorage(bag),
      },
    });
  }

  return {
    async sendMagicLink({ email, emailRedirectTo }) {
      const bag = new Map<string, string>();
      const supabase = clientFor(bag);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo },
      });
      if (error) throw error;
      return { cookies: [bagCookie(bag)] };
    },
    async signInWithPassword({ email, password }) {
      const supabase = clientFor(new Map());
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error || !data.session || !data.user?.email) {
        return {
          ok: false,
          error: error?.message ?? "Invalid credentials",
          code: "invalid_credentials",
        };
      }
      return {
        ok: true,
        user: { id: data.user.id, email: data.user.email },
        cookie: sessionCookie(data.session.access_token),
      };
    },
    async signUp({ email, password }) {
      const supabase = clientFor(new Map());
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        return { ok: false, error: error.message, code: "signup_failed" };
      }
      return { ok: true };
    },
    async startOAuth({ provider, redirectTo }) {
      const bag = new Map<string, string>();
      const supabase = clientFor(bag);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) {
        throw error ?? new Error("oauth_failed");
      }
      return { url: data.url, cookies: [bagCookie(bag)] };
    },
    async userFromCookie(cookieHeader) {
      const token = parseCookie(cookieHeader, ACCESS_COOKIE);
      if (!token) return null;
      const supabase = clientFor(new Map());
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.email) return null;
      return { id: data.user.id, email: data.user.email };
    },
    async exchangeCode(code, cookieHeader) {
      const bag = bagFromCookie(cookieHeader ?? null);
      const supabase = clientFor(bag);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data.session || !data.user?.email) return null;
      return {
        user: { id: data.user.id, email: data.user.email },
        cookie: sessionCookie(data.session.access_token),
      };
    },
  };
}

export function getAuth(): AuthAdapter {
  return getDeps().auth ?? createSupabaseAuth();
}

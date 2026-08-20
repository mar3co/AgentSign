import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../../env.js";
import { getDeps } from "../deps.js";

export type AuthUser = { id: string; email: string };

export type AuthAdapter = {
  sendMagicLink(input: { email: string; emailRedirectTo: string }): Promise<void>;
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
  }): Promise<{ url: string }>;
  userFromCookie(cookieHeader: string | null): Promise<AuthUser | null>;
  exchangeCode(code: string): Promise<{ user: AuthUser; cookie: string } | null>;
};

const ACCESS_COOKIE = "sb-access-token";

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
  return `${ACCESS_COOKIE}=${accessToken}; Path=/; HttpOnly; SameSite=Lax`;
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
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    async sendMagicLink({ email, emailRedirectTo }) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo },
      });
      if (error) throw error;
    },
    async signInWithPassword({ email, password }) {
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
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        return { ok: false, error: error.message, code: "signup_failed" };
      }
      return { ok: true };
    },
    async startOAuth({ provider, redirectTo }) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error || !data.url) {
        throw error ?? new Error("oauth_failed");
      }
      return { url: data.url };
    },
    async userFromCookie(cookieHeader) {
      const token = parseCookie(cookieHeader, ACCESS_COOKIE);
      if (!token) return null;
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user?.email) return null;
      return { id: data.user.id, email: data.user.email };
    },
    async exchangeCode(code) {
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

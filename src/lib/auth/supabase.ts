import { createClient } from "@supabase/supabase-js";
import { appOrigin, devOffline, getEnv } from "../../env.js";
import { getDeps } from "../deps.js";
import { devOfflineAuth } from "./dev-offline.js";

export type AuthUser = { id: string; email: string };

export type PasskeyFail = { ok: false; error: string; code: string };

export type PasskeyChallenge = {
  challengeId: string;
  options: Record<string, unknown>;
};

export type PasskeyItem = {
  id: string;
  friendlyName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

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
  startPasskeyAuthentication?(): Promise<
    { ok: true; challenge: PasskeyChallenge } | PasskeyFail
  >;
  verifyPasskeyAuthentication?(input: {
    challengeId: string;
    credential: unknown;
  }): Promise<{ ok: true; user: AuthUser; cookie: string } | PasskeyFail>;
  startPasskeyRegistration?(
    cookieHeader: string | null,
  ): Promise<{ ok: true; challenge: PasskeyChallenge } | PasskeyFail>;
  verifyPasskeyRegistration?(input: {
    cookieHeader: string | null;
    challengeId: string;
    credential: unknown;
  }): Promise<{ ok: true; passkey: PasskeyItem } | PasskeyFail>;
  listPasskeys?(
    cookieHeader: string | null,
  ): Promise<{ ok: true; passkeys: PasskeyItem[] } | PasskeyFail>;
  deletePasskey?(input: {
    cookieHeader: string | null;
    passkeyId: string;
  }): Promise<{ ok: true } | PasskeyFail>;
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

const PASSKEY_OFF: PasskeyFail = {
  ok: false,
  error: "Passkeys are not available",
  code: "passkey_disabled",
};

function asPasskey(raw: unknown): PasskeyItem {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ""),
    friendlyName: o.friendly_name == null ? null : String(o.friendly_name),
    createdAt: String(o.created_at ?? ""),
    lastUsedAt: o.last_used_at == null ? null : String(o.last_used_at),
  };
}

function passkeysFrom(data: unknown): PasskeyItem[] {
  if (Array.isArray(data)) return data.map(asPasskey);
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.passkeys)) return o.passkeys.map(asPasskey);
    if (Array.isArray(o.data)) return o.data.map(asPasskey);
  }
  return [];
}

function challengeFrom(
  data: unknown,
): PasskeyChallenge | null {
  const o = (data ?? {}) as Record<string, unknown>;
  const challengeId = String(o.challenge_id ?? "");
  const options =
    o.options && typeof o.options === "object"
      ? (o.options as Record<string, unknown>)
      : null;
  if (!challengeId || !options) return null;
  return { challengeId, options };
}

function sessionUserFrom(
  data: unknown,
): { accessToken: string; user: AuthUser } | null {
  const o = (data ?? {}) as Record<string, unknown>;
  const session = (
    o.session && typeof o.session === "object" ? o.session : o
  ) as Record<string, unknown>;
  const userRaw = (o.user ?? session.user) as Record<string, unknown> | undefined;
  const accessToken = String(session.access_token ?? "");
  const email = typeof userRaw?.email === "string" ? userRaw.email : "";
  const id = typeof userRaw?.id === "string" ? userRaw.id : "";
  if (!accessToken || !email || !id) return null;
  return { accessToken, user: { id, email } };
}

async function gotrue<T>(
  path: string,
  init: { method?: string; jwt?: string; body?: unknown } = {},
): Promise<{ data: T; error: null } | { data: null; error: PasskeyFail }> {
  const env = getEnv();
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/auth/v1${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${init.jwt ?? env.SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return { data: undefined as T, error: null };
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      data: null,
      error: {
        ok: false,
        error: String(json?.msg ?? json?.message ?? json?.error ?? "Request failed"),
        code: String(json?.error_code ?? json?.code ?? "passkey_failed"),
      },
    };
  }
  return { data: json as T, error: null };
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
  async startPasskeyAuthentication() {
    return PASSKEY_OFF;
  },
  async verifyPasskeyAuthentication() {
    return PASSKEY_OFF;
  },
  async startPasskeyRegistration() {
    return PASSKEY_OFF;
  },
  async verifyPasskeyRegistration() {
    return PASSKEY_OFF;
  },
  async listPasskeys() {
    return PASSKEY_OFF;
  },
  async deletePasskey() {
    return PASSKEY_OFF;
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
    async startPasskeyAuthentication() {
      const result = await gotrue<unknown>("/passkeys/authentication/options", {
        method: "POST",
        body: {},
      });
      if (result.error) return result.error;
      const challenge = challengeFrom(result.data);
      if (!challenge) {
        return { ok: false, error: "Could not start passkey sign-in", code: "passkey_failed" };
      }
      return { ok: true, challenge };
    },
    async verifyPasskeyAuthentication({ challengeId, credential }) {
      const result = await gotrue<unknown>("/passkeys/authentication/verify", {
        method: "POST",
        body: { challenge_id: challengeId, credential },
      });
      if (result.error) return result.error;
      const session = sessionUserFrom(result.data);
      if (!session) {
        return {
          ok: false,
          error: "Could not verify passkey",
          code: "webauthn_verification_failed",
        };
      }
      return {
        ok: true,
        user: session.user,
        cookie: sessionCookie(session.accessToken),
      };
    },
    async startPasskeyRegistration(cookieHeader) {
      const jwt = parseCookie(cookieHeader, ACCESS_COOKIE);
      if (!jwt) return { ok: false, error: "Unauthorized", code: "unauthorized" };
      const result = await gotrue<unknown>("/passkeys/registration/options", {
        method: "POST",
        jwt,
        body: {},
      });
      if (result.error) return result.error;
      const challenge = challengeFrom(result.data);
      if (!challenge) {
        return {
          ok: false,
          error: "Could not start passkey registration",
          code: "passkey_failed",
        };
      }
      return { ok: true, challenge };
    },
    async verifyPasskeyRegistration({ cookieHeader, challengeId, credential }) {
      const jwt = parseCookie(cookieHeader, ACCESS_COOKIE);
      if (!jwt) return { ok: false, error: "Unauthorized", code: "unauthorized" };
      const result = await gotrue<unknown>("/passkeys/registration/verify", {
        method: "POST",
        jwt,
        body: { challenge_id: challengeId, credential },
      });
      if (result.error) return result.error;
      const passkey = asPasskey(result.data);
      if (!passkey.id) {
        return {
          ok: false,
          error: "Could not save passkey",
          code: "webauthn_verification_failed",
        };
      }
      return { ok: true, passkey };
    },
    async listPasskeys(cookieHeader) {
      const jwt = parseCookie(cookieHeader, ACCESS_COOKIE);
      if (!jwt) return { ok: false, error: "Unauthorized", code: "unauthorized" };
      const result = await gotrue<unknown>("/passkeys", { jwt });
      if (result.error) return result.error;
      return { ok: true, passkeys: passkeysFrom(result.data) };
    },
    async deletePasskey({ cookieHeader, passkeyId }) {
      const jwt = parseCookie(cookieHeader, ACCESS_COOKIE);
      if (!jwt) return { ok: false, error: "Unauthorized", code: "unauthorized" };
      const result = await gotrue<unknown>(`/passkeys/${encodeURIComponent(passkeyId)}`, {
        method: "DELETE",
        jwt,
      });
      if (result.error) return result.error;
      return { ok: true };
    },
  };
}

export function getAuth(): AuthAdapter {
  const injected = getDeps().auth;
  if (injected) return injected;
  // Real Supabase always wins; the offline adapter only fills a total absence.
  if (devOffline() && !getEnv().SUPABASE_URL) return devOfflineAuth;
  return createSupabaseAuth();
}

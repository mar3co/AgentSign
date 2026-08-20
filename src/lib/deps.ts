import { createClient } from "@supabase/supabase-js";
import { getEnv } from "../env.js";
import type { AuthAdapter } from "./auth/supabase.js";
import type { AuditDb } from "./audit.js";
import { createMailer, type Mailer } from "./email.js";
import {
  createFsStore,
  createSupabaseStore,
  type BlobStore,
} from "./storage.js";

export type Deps = {
  db?: AuditDb;
  store?: BlobStore;
  mailer?: Mailer;
  now?: () => Date;
  auth?: AuthAdapter;
  stripe?: unknown;
  p12?: Buffer;
  p12Passphrase?: string;
  fetch?: typeof fetch;
  lookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
};

let deps: Deps = {};

/** Merge-replace injected test/prod deps; does not boot Supabase. */
export function setDeps(next: Deps): void {
  deps = { ...deps, ...next };
}

/** Drop the process-global bag so tests do not inherit another file's clock. */
export function resetDeps(): void {
  deps = {};
}

/**
 * Bind BlobStore from env when tests have not injected one.
 * STORAGE_DIR wins (local dogfood). Else Supabase service-role Storage.
 * Never constructs a live Supabase client under Vitest.
 */
export function resolveStoreFromEnv(): BlobStore | undefined {
  const env = getEnv();
  const dir = env.STORAGE_DIR.trim();
  // Function filesystem is ephemeral on Vercel; never prefer STORAGE_DIR there.
  if (dir && !process.env.VERCEL) return createFsStore(dir);
  if (process.env.VITEST) return undefined;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return createSupabaseStore(client, env.STORAGE_BUCKET);
  }
  return undefined;
}

export function storeUnavailableResponse(): Response {
  return Response.json(
    { error: "Storage is not configured", code: "storage_unconfigured" },
    { status: 503 },
  );
}

export function getDeps(): Deps {
  return {
    ...deps,
    store: deps.store ?? resolveStoreFromEnv(),
    mailer: deps.mailer ?? createMailer(),
  };
}

import type { AuditDb } from "./audit.js";
import type { Mailer } from "./email.js";
import type { BlobStore } from "./storage.js";

export type Deps = {
  db?: AuditDb;
  store?: BlobStore;
  mailer?: Mailer;
  now?: () => Date;
  auth?: unknown;
  stripe?: unknown;
};

let deps: Deps = {};

/** Merge-replace injected test/prod deps; does not boot Supabase. */
export function setDeps(next: Deps): void {
  deps = { ...deps, ...next };
}

export function getDeps(): Deps {
  return deps;
}

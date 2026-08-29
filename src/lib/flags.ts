import { getEnv } from "../env.js";

export type FlagName = "agent_parties" | "agent_only_attest" | "ai_field_detect";

export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  agent_parties: true,
  agent_only_attest: false,
  ai_field_detect: false,
};

const ENV_KEYS: Record<
  FlagName,
  | "SIGN_FLAG_AGENT_PARTIES"
  | "SIGN_FLAG_AGENT_ONLY_ATTEST"
  | "SIGN_FLAG_AI_FIELD_DETECT"
> = {
  agent_parties: "SIGN_FLAG_AGENT_PARTIES",
  agent_only_attest: "SIGN_FLAG_AGENT_ONLY_ATTEST",
  ai_field_detect: "SIGN_FLAG_AI_FIELD_DETECT",
};

/** `"1"`/`"true"` on, `"0"`/`"false"` off, empty/other → no override. */
function parseEnvFlag(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

/**
 * Read the flag from the Vercel dashboard. The shared client reads the
 * connection string Vercel injects as FLAGS, and caches definitions across
 * requests on a warm instance. With no connection string, or with the
 * dashboard unreachable, every path here lands on the built-in default.
 */
async function vercelFlagOn(name: FlagName): Promise<boolean> {
  const fallback = FLAG_DEFAULTS[name];
  try {
    const { flagsClient } = await import("@vercel/flags-core");
    const result = await flagsClient.evaluate<boolean>(name, fallback);
    return "value" in result ? Boolean(result.value) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The Vercel dashboard owns flag values. SIGN_FLAG_* is a local dev and test
 * override only — setting one in a deployment takes that flag away from the
 * dashboard, so leave them unset there.
 */
export async function flagOn(name: FlagName): Promise<boolean> {
  const override = parseEnvFlag(getEnv()[ENV_KEYS[name]]);
  if (override !== undefined) return override;
  return vercelFlagOn(name);
}

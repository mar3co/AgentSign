import { getEnv } from "../env.js";

export type FlagName = "agent_parties" | "agent_only_attest";

export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  agent_parties: true,
  agent_only_attest: false,
};

const ENV_KEYS: Record<FlagName, "SIGN_FLAG_AGENT_PARTIES" | "SIGN_FLAG_AGENT_ONLY_ATTEST"> = {
  agent_parties: "SIGN_FLAG_AGENT_PARTIES",
  agent_only_attest: "SIGN_FLAG_AGENT_ONLY_ATTEST",
};

/** `"1"`/`"true"` on, `"0"`/`"false"` off, empty/other → no override. */
function parseEnvFlag(raw: string): boolean | undefined {
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return undefined;
}

async function vercelFlagOn(name: FlagName): Promise<boolean> {
  const fallback = FLAG_DEFAULTS[name];
  try {
    const { createClient } = await import("@vercel/flags-core");
    const client = createClient({
      disableMetrics: true,
      stream: false,
      polling: false,
    });
    try {
      await client.initialize();
    } catch {
      // No definitions / offline — evaluate still returns defaultValue.
    }
    const result = await client.evaluate<boolean>(name, fallback);
    try {
      await client.shutdown();
    } catch {
      // ignore shutdown errors
    }
    return Boolean(result.value);
  } catch {
    return fallback;
  }
}

/** Env override wins. Else Vercel Flags when FLAGS_SECRET set. Else defaults. */
export async function flagOn(name: FlagName): Promise<boolean> {
  const env = getEnv();
  const override = parseEnvFlag(env[ENV_KEYS[name]]);
  if (override !== undefined) return override;
  if (env.FLAGS_SECRET.trim() !== "") return vercelFlagOn(name);
  return FLAG_DEFAULTS[name];
}

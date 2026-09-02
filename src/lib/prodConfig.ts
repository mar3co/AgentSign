/**
 * Secrets the public cloud cannot run without. Every entry in env.ts defaults
 * to "" so a deploy missing one boots clean and then fails quietly: mail turns
 * into console.log, the shred cron 401s forever, sealing throws on Finish.
 * /health names what is missing so the gap shows up on the first curl.
 *
 * An inner array is a set of alternatives; any one of them satisfies it.
 */
const REQUIRED_IN_PRODUCTION = [
  ["DATABASE_URL"],
  ["SUPABASE_URL"],
  ["SUPABASE_ANON_KEY"],
  ["SUPABASE_SERVICE_ROLE_KEY"],
  ["APP_URL", "APP_ORIGIN"],
  ["RESEND_API_KEY"],
  ["FROM_EMAIL"],
  // Also covers the webhook key: WEBHOOK_KEK falls back to CRON_SECRET.
  ["CRON_SECRET"],
  ["P12_BASE64", "P12_PATH"],
] as const;

type ProductionKey = (typeof REQUIRED_IN_PRODUCTION)[number][number];

/** Names of required secrets that are empty. Only Vercel production is checked. */
export function missingProductionConfig(
  env: Record<ProductionKey, string>,
  vercelEnv: string | undefined,
): string[] {
  if (vercelEnv !== "production") return [];
  return REQUIRED_IN_PRODUCTION.filter(
    (keys) => !keys.some((key) => env[key].trim()),
  ).map((keys) => keys.join(" or "));
}

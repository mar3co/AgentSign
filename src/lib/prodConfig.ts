/**
 * Secrets the public cloud cannot run without. Every entry in env.ts defaults
 * to "" so a deploy missing one boots clean and then fails quietly: mail turns
 * into console.log, the shred cron 401s forever, sealing throws on Finish.
 * /health names what is missing so the gap shows up on the first curl.
 */
const REQUIRED_IN_PRODUCTION = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APP_URL",
  "RESEND_API_KEY",
  "FROM_EMAIL",
  "CRON_SECRET",
  "WEBHOOK_KEK",
  "P12_PATH",
] as const;

type ProductionKey = (typeof REQUIRED_IN_PRODUCTION)[number];

/** Names of required secrets that are empty. Only Vercel production is checked. */
export function missingProductionConfig(
  env: Record<ProductionKey, string>,
  vercelEnv: string | undefined,
): ProductionKey[] {
  if (vercelEnv !== "production") return [];
  return REQUIRED_IN_PRODUCTION.filter((key) => !env[key].trim());
}

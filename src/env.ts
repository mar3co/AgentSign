import { z } from "zod";

const envSchema = z.object({
  PORT: z.string().default("3000"),
  DATABASE_URL: z.string().default(""),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  STORAGE_BUCKET: z.string().default("envelopes"),
  STORAGE_DIR: z.string().default(""),
  APP_URL: z.string().default(""),
  APP_ORIGIN: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  FROM_EMAIL: z.string().default("sign@localhost"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_PRO: z.string().default(""),
  CRON_SECRET: z.string().default(""),
  WEBHOOK_KEK: z.string().default(""),
  SIGNING_WINDOW_DAYS: z.string().default("7"),
  FREE_KEEP_DAYS: z.string().default("7"),
  PRO_KEEP_DAYS: z.string().default("365"),
  FREE_SEND_LIMIT: z.string().default("20"),
  FREE_SEND_WINDOW_DAYS: z.string().default("30"),
  P12_PATH: z.string().default(""),
  P12_PASSPHRASE: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Lazy parse so importing this module during tests does not throw. */
export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}

/** Public origin for mail CTAs. APP_URL, else APP_ORIGIN, else localhost. */
export function appOrigin(): string {
  const env = getEnv();
  const raw = (env.APP_URL || env.APP_ORIGIN || "http://localhost:3000").trim();
  return raw.replace(/\/+$/, "");
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${appOrigin()}${p}`;
}

import { describe, it, expect } from "vitest";
import { missingProductionConfig } from "../lib/prodConfig.js";

const full = {
  DATABASE_URL: "postgres://x",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  APP_URL: "https://agentsign.co",
  RESEND_API_KEY: "re_x",
  FROM_EMAIL: "AgentSign <sign@agentsign.co>",
  CRON_SECRET: "c",
  WEBHOOK_KEK: "k",
  P12_PATH: "/var/cert.p12",
};

describe("missingProductionConfig", () => {
  it("returns nothing when every production secret is set", () => {
    expect(missingProductionConfig(full, "production")).toEqual([]);
  });

  it("names each missing secret in production", () => {
    const env = { ...full, SUPABASE_ANON_KEY: "", FROM_EMAIL: "", CRON_SECRET: " " };
    expect(missingProductionConfig(env, "production")).toEqual([
      "SUPABASE_ANON_KEY",
      "FROM_EMAIL",
      "CRON_SECRET",
    ]);
  });

  it("requires nothing outside Vercel production", () => {
    const env = { ...full, RESEND_API_KEY: "", CRON_SECRET: "" };
    expect(missingProductionConfig(env, "preview")).toEqual([]);
    expect(missingProductionConfig(env, undefined)).toEqual([]);
  });
});

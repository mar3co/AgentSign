import { describe, it, expect } from "vitest";
import { missingProductionConfig } from "../lib/prodConfig.js";

const full = {
  DATABASE_URL: "postgres://x",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  APP_URL: "https://agentsign.co",
  RESEND_API_KEY: "re_x",
  CRON_SECRET: "c",
  WEBHOOK_KEK: "k",
  P12_PATH: "/var/cert.p12",
  P12_BASE64: "",
};

describe("missingProductionConfig", () => {
  it("returns nothing when every production secret is set", () => {
    expect(missingProductionConfig(full, "production")).toEqual([]);
  });

  it("names each missing secret in production", () => {
    const env = { ...full, RESEND_API_KEY: "", CRON_SECRET: " " };
    expect(missingProductionConfig(env, "production")).toEqual(["RESEND_API_KEY", "CRON_SECRET"]);
  });

  it("accepts P12_BASE64 in place of P12_PATH", () => {
    const env = { ...full, P12_PATH: "", P12_BASE64: "MIIabc=" };
    expect(missingProductionConfig(env, "production")).toEqual([]);
  });

  it("names the seal cert once when neither P12 form is set", () => {
    const env = { ...full, P12_PATH: "", P12_BASE64: "" };
    expect(missingProductionConfig(env, "production")).toEqual(["P12_BASE64 or P12_PATH"]);
  });

  it("requires nothing outside Vercel production", () => {
    const env = { ...full, RESEND_API_KEY: "", CRON_SECRET: "" };
    expect(missingProductionConfig(env, "preview")).toEqual([]);
    expect(missingProductionConfig(env, undefined)).toEqual([]);
  });
});

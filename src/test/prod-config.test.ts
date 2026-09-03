import { describe, it, expect } from "vitest";
import { missingProductionConfig } from "../lib/prodConfig.js";

const full = {
  DATABASE_URL: "postgres://x",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  APP_URL: "https://openseal.me",
  APP_ORIGIN: "",
  RESEND_API_KEY: "re_x",
  FROM_EMAIL: "OpenSeal <sign@openseal.me>",
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
    const env = { ...full, SUPABASE_ANON_KEY: "", FROM_EMAIL: "", CRON_SECRET: " " };
    expect(missingProductionConfig(env, "production")).toEqual([
      "SUPABASE_ANON_KEY",
      "FROM_EMAIL",
      "CRON_SECRET",
    ]);
  });

  it("accepts P12_BASE64 in place of P12_PATH", () => {
    const env = { ...full, P12_PATH: "", P12_BASE64: "MIIabc=" };
    expect(missingProductionConfig(env, "production")).toEqual([]);
  });

  it("names the seal cert once when neither P12 form is set", () => {
    const env = { ...full, P12_PATH: "", P12_BASE64: "" };
    expect(missingProductionConfig(env, "production")).toEqual(["P12_BASE64 or P12_PATH"]);
  });

  it("accepts APP_ORIGIN in place of APP_URL, since every reader takes either", () => {
    const env = { ...full, APP_URL: "", APP_ORIGIN: "https://openseal.me" };
    expect(missingProductionConfig(env, "production")).toEqual([]);
  });

  it("does not require WEBHOOK_KEK when CRON_SECRET covers the webhook key", () => {
    const env = { ...full, WEBHOOK_KEK: "" };
    expect(missingProductionConfig(env, "production")).toEqual([]);
  });

  it("requires nothing outside Vercel production", () => {
    const env = { ...full, RESEND_API_KEY: "", CRON_SECRET: "" };
    expect(missingProductionConfig(env, "preview")).toEqual([]);
    expect(missingProductionConfig(env, undefined)).toEqual([]);
  });
});

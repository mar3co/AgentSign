import { afterEach } from "vitest";
import { resetDeps } from "../lib/deps.js";
import { ENV_KEYS, FLAG_DEFAULTS, type FlagName } from "../lib/flags.js";

if (!process.env.WEBHOOK_KEK) process.env.WEBHOOK_KEK = "sign-test-webhook-kek";

// Pin every flag to its built-in default. Without an override the flag client
// reads the Vercel dashboard, and on a linked machine that makes the suite
// depend on live dashboard state. Tests that need another value stub the env
// var themselves; vi.unstubAllEnvs() restores these.
for (const [name, on] of Object.entries(FLAG_DEFAULTS) as [
  FlagName,
  boolean,
][]) {
  process.env[ENV_KEYS[name]] = on ? "1" : "0";
}

afterEach(() => {
  resetDeps();
});

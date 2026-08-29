import { afterEach, expect, it, vi } from "vitest";
import { flagOn } from "../lib/flags.js";
import { resetEnvCache } from "../env.js";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

it("agent_only_attest defaults off and env 1 turns it on", async () => {
  expect(await flagOn("agent_only_attest")).toBe(false);
  vi.stubEnv("SIGN_FLAG_AGENT_ONLY_ATTEST", "1");
  resetEnvCache();
  expect(await flagOn("agent_only_attest")).toBe(true);
});

it("SIGN_FLAG_AGENT_PARTIES=0 turns agent_parties off", async () => {
  vi.stubEnv("SIGN_FLAG_AGENT_PARTIES", "0");
  resetEnvCache();
  expect(await flagOn("agent_parties")).toBe(false);
});

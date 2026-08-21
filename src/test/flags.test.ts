import { afterEach, describe, expect, it } from "vitest";
import { flagOn } from "../lib/flags.js";
import { resetEnvCache } from "../env.js";

afterEach(() => {
  delete process.env.SIGN_FLAG_AGENT_PARTIES;
  delete process.env.SIGN_FLAG_AGENT_ONLY_ATTEST;
  resetEnvCache();
});

it("agent_only_attest defaults off and env 1 turns it on", async () => {
  expect(await flagOn("agent_only_attest")).toBe(false);
  process.env.SIGN_FLAG_AGENT_ONLY_ATTEST = "1";
  resetEnvCache();
  expect(await flagOn("agent_only_attest")).toBe(true);
});

it("SIGN_FLAG_AGENT_PARTIES=0 turns agent_parties off", async () => {
  process.env.SIGN_FLAG_AGENT_PARTIES = "0";
  resetEnvCache();
  expect(await flagOn("agent_parties")).toBe(false);
});

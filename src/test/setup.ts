import { afterEach } from "vitest";
import { resetDeps } from "../lib/deps.js";

if (!process.env.WEBHOOK_KEK) process.env.WEBHOOK_KEK = "sign-test-webhook-kek";

afterEach(() => {
  resetDeps();
});

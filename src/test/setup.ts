import { afterEach } from "vitest";
import { resetDeps } from "../lib/deps.js";

afterEach(() => {
  resetDeps();
});

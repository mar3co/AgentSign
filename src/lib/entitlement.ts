import { getEnv } from "../env.js";

export const TEAM_CAP = 10;
export const TEMPLATE_CAP = 50;
export const AGENT_CAP = 10;
export const LOGO_MAX_BYTES = 256 * 1024;

export function isEntitled(account: { plan: string } | null | undefined): boolean {
  const flag = getEnv().SELF_HOST.trim().toLowerCase();
  if (flag === "1" || flag === "true") return true;
  return account?.plan === "pro";
}

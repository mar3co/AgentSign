import { getEnv } from "../../src/env.js";
import { missingProductionConfig } from "../../src/lib/prodConfig.js";

export const runtime = "nodejs";

export function GET() {
  const missing = missingProductionConfig(getEnv(), process.env.VERCEL_ENV);
  if (missing.length > 0) {
    return Response.json({ ok: false, missing }, { status: 503 });
  }
  return Response.json({ ok: true });
}

import { getBranding, putBranding } from "../../../src/routes/branding.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getBranding(req);
}

export async function PUT(req: Request): Promise<Response> {
  return putBranding(req);
}

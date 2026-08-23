import { createTemplate, listTemplates } from "../../../src/routes/templates.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return listTemplates(req);
}

export async function POST(req: Request): Promise<Response> {
  return createTemplate(req);
}

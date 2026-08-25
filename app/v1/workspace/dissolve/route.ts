import { dissolveWorkspace } from "../../../../src/routes/workspace.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return dissolveWorkspace(req);
}

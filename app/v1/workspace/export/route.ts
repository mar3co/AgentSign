import { exportWorkspace } from "../../../../src/routes/workspace.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return exportWorkspace(req);
}

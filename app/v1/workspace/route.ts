import { getWorkspace, patchWorkspace } from "../../../src/routes/workspace.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return getWorkspace(req);
}

export async function PATCH(req: Request): Promise<Response> {
  return patchWorkspace(req);
}

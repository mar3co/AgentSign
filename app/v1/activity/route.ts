import { listActivity } from "../../../src/routes/activity.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return listActivity(req);
}

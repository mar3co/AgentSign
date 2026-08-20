import { runShredCron } from "../../../src/routes/cron.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return runShredCron(req);
}

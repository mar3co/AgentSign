import { postDetectFields } from "../../../src/routes/detect.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return postDetectFields(req);
}

import { postPasskeyOptions } from "../../../../src/routes/auth.js";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return postPasskeyOptions();
}

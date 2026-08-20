import { postDecline } from "../../../../src/routes/signing.js";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx?: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = (await ctx?.params) ?? { token: "" };
  return postDecline(req, token);
}

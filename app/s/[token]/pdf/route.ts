import { getCeremonyPdf } from "../../../../src/routes/signing.js";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  return getCeremonyPdf(req, token);
}

import { getCeremonyPdf } from "../../../../src/routes/signing.js";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx?: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = (await ctx?.params) ?? { token: "" };
  return getCeremonyPdf(token);
}

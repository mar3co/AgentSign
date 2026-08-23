import { verifyDocumentOtp } from "../../../../../src/routes/otp.js";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return verifyDocumentOtp(req, id);
}

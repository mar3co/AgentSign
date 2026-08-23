import { rejectDocument } from "../../../../../src/routes/attest.js";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return rejectDocument(req, id);
}

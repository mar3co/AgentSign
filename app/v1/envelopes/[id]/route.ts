import {
  deleteEnvelope,
  getEnvelope,
} from "../../../../src/routes/envelopes.js";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return getEnvelope(req, id);
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return deleteEnvelope(req, id);
}

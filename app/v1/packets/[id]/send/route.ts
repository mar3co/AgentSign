import { sendPacket } from "../../../../../src/routes/packets.js";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return sendPacket(req, id);
}

import { revokeAgent } from "../../../../src/routes/agents.js";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return revokeAgent(req, id);
}

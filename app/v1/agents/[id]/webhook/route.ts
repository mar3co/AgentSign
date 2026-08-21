import { putAgentWebhook } from "../../../../../src/routes/agents.js";

export const runtime = "nodejs";

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return putAgentWebhook(req, id);
}

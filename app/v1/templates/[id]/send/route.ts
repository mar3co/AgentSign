import { sendTemplate } from "../../../../../src/routes/templates.js";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return sendTemplate(req, id);
}

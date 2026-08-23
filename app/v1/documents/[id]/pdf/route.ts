import { getDocumentPdf } from "../../../../../src/routes/documents.js";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  return getDocumentPdf(req, id);
}

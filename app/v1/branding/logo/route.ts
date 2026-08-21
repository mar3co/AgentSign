import { deleteBrandingLogo } from "../../../../src/routes/branding.js";

export const runtime = "nodejs";

export async function DELETE(req: Request): Promise<Response> {
  return deleteBrandingLogo(req);
}

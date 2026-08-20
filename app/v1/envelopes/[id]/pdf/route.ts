export const runtime = "nodejs";

/** Stub until Task 11: signer tokens are not API keys. */
export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("sign_tmp_") && !token.startsWith("sign_live_")) {
    return Response.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }
  return Response.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
}

import { authorizationServerMetadata } from "../../../src/routes/oauth.js";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(authorizationServerMetadata());
}

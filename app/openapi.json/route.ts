import { openapi } from "../../src/openapi.js";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(openapi);
}

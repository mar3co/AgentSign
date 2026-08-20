import { handleMcpHttp } from "../../src/mcp/server.js";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return handleMcpHttp(req);
}

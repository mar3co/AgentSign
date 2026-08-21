import { createAgent, listAgents } from "../../../src/routes/agents.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return listAgents(req);
}

export async function POST(req: Request): Promise<Response> {
  return createAgent(req);
}

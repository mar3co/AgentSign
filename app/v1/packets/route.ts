import { createPacket, listPackets } from "../../../src/routes/packets.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return listPackets(req);
}

export async function POST(req: Request): Promise<Response> {
  return createPacket(req);
}

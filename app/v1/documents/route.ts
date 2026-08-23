import { createDocument, listDocuments } from "../../../src/routes/documents.js";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  return listDocuments(req);
}

export async function POST(req: Request): Promise<Response> {
  return createDocument(req);
}

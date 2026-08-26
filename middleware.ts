import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "./src/db/client.js";
import { documents, signers } from "./src/db/schema.js";
import { getDeps } from "./src/lib/deps.js";
import { ceremonyFrameHeaders } from "./src/lib/embed.js";
import { hashSigningToken } from "./src/lib/tokens.js";

/** Next.js forbids page.tsx and route.ts in the same segment. POST stays the API. */
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/team/accept" && request.method === "POST") {
    const url = request.nextUrl.clone();
    url.pathname = "/internal/team/accept";
    return NextResponse.rewrite(url);
  }
  if (request.nextUrl.pathname === "/oauth/authorize" && request.method === "POST") {
    const url = request.nextUrl.clone();
    url.pathname = "/internal/oauth/authorize";
    return NextResponse.rewrite(url);
  }

  const path = request.nextUrl.pathname;
  const match = path.match(/^\/s\/([^/]+)/);
  if (match) {
    const token = match[1]!;
    let embedOrigin: string | null = null;
    try {
      const db = getDeps().db ?? getDb();
      const [row] = await db
        .select({ embedOrigin: documents.embedOrigin })
        .from(signers)
        .innerJoin(documents, eq(signers.documentId, documents.id))
        .where(eq(signers.tokenHash, hashSigningToken(token)))
        .limit(1);
      if (row) embedOrigin = row.embedOrigin;
    } catch {
      embedOrigin = null;
    }
    const response = NextResponse.next();
    const headers = ceremonyFrameHeaders(embedOrigin);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/team/accept",
    "/oauth/authorize",
    "/s/:token",
    "/s/:token/:path*",
  ],
  runtime: "nodejs",
};

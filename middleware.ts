import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Next.js forbids page.tsx and route.ts in the same segment. POST stays the API. */
export function middleware(request: NextRequest) {
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
  return NextResponse.next();
}

export const config = {
  matcher: ["/team/accept", "/oauth/authorize"],
};

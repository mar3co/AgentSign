/**
 * Client IP for anonymous rate keys, as reported by the deployment's proxy.
 * Vercel strips the client's copies of these headers; a self-hosted reverse
 * proxy must overwrite them too, or callers can pick their own bucket.
 */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "anonymous"
  );
}

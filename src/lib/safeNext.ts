/** Same-origin path only. Reject protocol-relative, backslash, and CR/LF. */
export function safeNext(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\") || next.includes("\n") || next.includes("\r")) return "/";
  return next;
}

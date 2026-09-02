/** Short date for lists and confirmations, in the team's timezone when known. */
export function formatSentDate(iso?: string, timeZone?: string | null): string {
  if (!iso) return "\u2014";
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "2-digit",
  };
  if (timeZone) opts.timeZone = timeZone;
  return new Date(iso).toLocaleDateString("en-US", opts);
}

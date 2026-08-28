/**
 * Per-instance sliding-window rate limiter. Coarse protection for expensive
 * work (model calls, browser launches) against runaway loops and abuse — the
 * capped resource is this instance's CPU and memory, so per-instance state is
 * a feature here, not a shortcoming. Not a billing-grade quota.
 */
export function slidingWindowLimiter(
  limit: number,
  windowMs: number,
): (key: string, now?: number) => boolean {
  const recentByKey = new Map<string, number[]>();
  return (key, now = Date.now()) => {
    const cutoff = now - windowMs;
    if (recentByKey.size > 1000) {
      for (const [id, times] of recentByKey) {
        if (times.every((t) => t <= cutoff)) recentByKey.delete(id);
      }
    }
    const times = (recentByKey.get(key) ?? []).filter((t) => t > cutoff);
    if (times.length >= limit) {
      recentByKey.set(key, times);
      return true;
    }
    times.push(now);
    recentByKey.set(key, times);
    return false;
  };
}

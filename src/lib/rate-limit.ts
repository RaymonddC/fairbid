// A small sliding-window limiter, kept in memory. Each Cloud Run instance counts on
// its own (at most 3 instances), which is enough to stop password guessing at speed.
// Pure apart from the clock, which tests pass in.

export interface Limiter {
  /** Records one attempt for `key`. Returns false when the key is over its limit. */
  hit(key: string, now?: number): boolean;
  /** Clears a key, for example after a successful sign-in. */
  reset(key: string): void;
}

export function createLimiter(max: number, windowMs: number): Limiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      recent.push(now);
      hits.set(key, recent);
      // Keep memory bounded: forget keys with nothing recent.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
      }
      return recent.length <= max;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}

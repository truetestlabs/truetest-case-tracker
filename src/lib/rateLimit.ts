/**
 * Simple in-memory rate limiter for public API routes.
 *
 * Single-region serverless caveat: each Vercel cold start gets its own Map,
 * so the effective limit per IP is `limit * cold_starts_per_minute`. That's
 * still a meaningful brake against drive-by abuse and accidental loops, and
 * it's stateless enough to not require Redis/KV until we actually need to
 * defend against motivated attackers. When that day comes, swap the storage
 * here for Upstash Ratelimit or Vercel KV without touching call sites.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Periodic GC so the Map can't grow without bound on a hot lambda.
let lastGc = 0;
function maybeGc(now: number) {
  if (now - lastGc < 60_000) return;
  lastGc = now;
  for (const [k, v] of buckets) {
    if (v.resetAt < now) buckets.delete(k);
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

/**
 * Check and increment the rate-limit counter for a (key, window) pair.
 * Returns ok:false when the caller has exceeded the limit.
 *
 * @param key       Stable identifier — typically `${route}:${ip}`
 * @param limit     Max requests permitted within the window
 * @param windowMs  Window length in milliseconds (default: 60_000 = 1 min)
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();
  maybeGc(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt < now) {
    const next = { count: 1, resetAt: now + windowMs };
    buckets.set(key, next);
    return { ok: true, remaining: limit - 1, resetAt: next.resetAt };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/**
 * Best-effort client IP. Trusts Vercel's `x-forwarded-for` header (Vercel
 * sets this and discards client-supplied values). Falls back to a literal
 * "unknown" so we still rate-limit collectively rather than not at all.
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

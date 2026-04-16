/**
 * HMAC-SHA256 signature verification for inbound webhooks and the marketing
 * site's order POST. The signing party (us, on the marketing site, or USDTL
 * later) computes hex(hmac_sha256(secret, rawBody)) and sends it in the
 * `X-TrueTest-Signature` header. We recompute and compare with a
 * timing-safe equality check.
 *
 * Reuse this helper for both the public order endpoint and the future
 * `/api/webhooks/usdtl` endpoint.
 */
import { createHmac, timingSafeEqual } from "crypto";

export function computeHmacHex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyHmac(
  secret: string,
  rawBody: string,
  providedHex: string | null | undefined
): boolean {
  if (!providedHex) return false;
  const expected = computeHmacHex(secret, rawBody);
  if (expected.length !== providedHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(providedHex, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify HMAC with replay protection. The signer must include a
 * `timestamp` (Unix seconds) in the signed payload: the HMAC is
 * computed over `${timestamp}.${rawBody}` and the timestamp is sent
 * in the `X-TrueTest-Timestamp` header. We reject if the timestamp
 * is outside ±5 minutes, preventing captured signatures from being
 * replayed after the window closes.
 *
 * Falls back gracefully: if no timestamp header is provided, delegates
 * to the basic `verifyHmac` (body-only). This lets us roll out the
 * marketing-site change without a hard cutover.
 */
export function verifyHmacWithTimestamp(
  secret: string,
  rawBody: string,
  providedHex: string | null | undefined,
  timestampHeader: string | null | undefined,
  maxAgeMs = 5 * 60 * 1000
): { valid: boolean; reason?: string } {
  if (!providedHex) return { valid: false, reason: "missing signature" };

  // If no timestamp header, fall back to basic HMAC (backwards compat)
  if (!timestampHeader) {
    return { valid: verifyHmac(secret, rawBody, providedHex) };
  }

  const ts = parseInt(timestampHeader, 10);
  if (Number.isNaN(ts)) return { valid: false, reason: "invalid timestamp" };

  const nowMs = Date.now();
  const tsMs = ts * 1000;
  if (Math.abs(nowMs - tsMs) > maxAgeMs) {
    return { valid: false, reason: "timestamp expired" };
  }

  // Signed payload includes the timestamp to bind them together
  const payload = `${ts}.${rawBody}`;
  const expected = computeHmacHex(secret, payload);
  if (expected.length !== providedHex.length) return { valid: false, reason: "bad signature" };
  try {
    const ok = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(providedHex, "hex"));
    return ok ? { valid: true } : { valid: false, reason: "bad signature" };
  } catch {
    return { valid: false, reason: "bad signature" };
  }
}

/**
 * Parse an env-var-style allowlist into a Set: comma-separated, trimmed.
 * Used for both CORS origins and IP allowlists.
 */
export function parseAllowlist(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

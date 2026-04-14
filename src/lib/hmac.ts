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

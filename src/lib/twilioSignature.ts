import twilio from "twilio";

/**
 * Twilio webhook signature validation.
 *
 * Twilio signs every webhook with HMAC-SHA1 over the full request URL +
 * sorted form params, keyed on the account auth token. Reject any
 * request whose signature doesn't match — otherwise anyone who knows
 * the webhook URL can trigger our voice agent (and rack up Claude /
 * Twilio bills).
 *
 * Behavior:
 * - In production: signature mismatch returns false (caller should 403).
 * - If TWILIO_AUTH_TOKEN is not set (local dev without Twilio), logs a
 *   warning and returns true so the developer isn't blocked.
 * - Set VOICE_SKIP_SIGNATURE=1 to bypass during local tunneling with
 *   ngrok when needed.
 */
export function validateTwilioSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>
): boolean {
  if (process.env.VOICE_SKIP_SIGNATURE === "1") return true;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("[voice] TWILIO_AUTH_TOKEN not set — skipping signature validation");
    return true;
  }
  if (!signature) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}

/**
 * Build the canonical URL Twilio signs — Twilio uses the public URL
 * they posted to, NOT whatever our proxy rewrites to internally. We
 * derive it from the x-forwarded-* headers Vercel sets.
 */
export function canonicalRequestUrl(req: Request): string {
  const headers = req.headers;
  const proto = headers.get("x-forwarded-proto") ?? "https";
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
  const url = new URL(req.url);
  return `${proto}://${host}${url.pathname}${url.search}`;
}

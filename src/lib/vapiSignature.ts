/**
 * Vapi webhook authentication.
 *
 * Vapi supports a shared-secret header on all server webhooks. We set
 * the secret in the assistant config (via serverUrlSecret / tool
 * server.secret) and Vapi echoes it back on every request as
 * `x-vapi-secret`. Reject any request without it.
 *
 * This protects /api/vapi/tool and /api/vapi/events from anyone who
 * figures out the URLs and tries to forge tool calls or inject fake
 * end-of-call reports.
 */

export function validateVapiSecret(req: Request): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) {
    console.warn("[vapi] VAPI_WEBHOOK_SECRET not set — accepting all webhooks");
    return true;
  }
  const got =
    req.headers.get("x-vapi-secret") ??
    req.headers.get("x-vapi-signature") ??
    "";
  if (!got) return false;
  // Constant-time compare to avoid timing leaks.
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

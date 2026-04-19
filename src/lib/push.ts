/**
 * Web Push wrapper for the donor portal.
 *
 * VAPID keys live in env:
 *   - VAPID_PUBLIC_KEY   — served to the browser for subscription creation
 *   - VAPID_PRIVATE_KEY  — used server-side to sign push requests
 *   - VAPID_SUBJECT      — mailto: or https URL identifying us to push services
 *
 * Generate a fresh pair once with:
 *   npx web-push generate-vapid-keys
 */
import webpush from "web-push";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) {
    throw new Error(
      "[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT must be set"
    );
  }
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export type PushTarget = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/**
 * Send a notification to a single subscription.
 * Throws on fatal errors (HTTP 4xx/5xx) so callers can mark jobs failed
 * and — on 404/410 — delete the dead subscription.
 */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<void> {
  configure();
  await webpush.sendNotification(
    { endpoint: target.endpoint, keys: target.keys },
    JSON.stringify(payload)
  );
}

/** True if the endpoint is gone (404/410) and should be deleted. */
export function isDeadSubscriptionError(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  return code === 404 || code === 410;
}

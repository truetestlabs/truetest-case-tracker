import twilio from "twilio";

/**
 * Thin Twilio wrapper for outbound SMS.
 *
 * Silently no-ops if TWILIO_* env vars are missing (so local dev and
 * staging can skip sending without crashing the request). All errors
 * are swallowed — an SMS failure must never block a booking or case
 * creation flow.
 */

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

/** Normalize a user-entered phone string to E.164 for Twilio. */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[sms] Twilio env vars not set — skipping SMS");
    return { ok: false, error: "twilio_not_configured" };
  }
  if (!to?.trim()) {
    return { ok: false, error: "no_phone" };
  }
  try {
    const client = twilio(accountSid, authToken);
    const msg = await client.messages.create({
      from: fromNumber,
      to: toE164(to),
      body,
    });
    console.log(`[sms] sent to ${toE164(to)} sid=${msg.sid} status=${msg.status}`);
    return { ok: true, sid: msg.sid };
  } catch (e) {
    console.error("[sms] send failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/** Build a friendly confirmation SMS for a new appointment. */
export function formatAppointmentConfirmation(firstName: string, startTime: Date): string {
  const timeStr = startTime.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
  return `Hi ${firstName}, you're booked with TrueTest Labs for ${timeStr}. Address: 2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007. Reply to this message if you need to reschedule.`;
}

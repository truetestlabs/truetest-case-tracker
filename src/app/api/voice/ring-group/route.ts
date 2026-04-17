import { NextRequest, NextResponse } from "next/server";
import {
  canonicalRequestUrl,
  validateTwilioSignature,
} from "@/lib/twilioSignature";

/**
 * POST /api/voice/ring-group
 *
 * Designed for after the Phone.com → Twilio port is complete. Point
 * the Twilio number's Voice webhook at this route (instead of
 * /api/voice/incoming) and the call will:
 *
 *   1. Simultaneously ring every number in RING_GROUP_NUMBERS
 *      (e.g. Matt's cell + Colleen's cell / desk SIP) for
 *      RING_GROUP_TIMEOUT_SEC seconds. First to answer takes the call.
 *   2. If no one picks up, Twilio falls through the <Dial> and the
 *      <Redirect> kicks the call over to /api/voice/incoming — the
 *      AI agent picks up exactly as it does today behind Phone.com.
 *
 * Env:
 *   RING_GROUP_NUMBERS         comma-separated E.164 list
 *   RING_GROUP_TIMEOUT_SEC     seconds to ring before failover (default 20)
 *   RING_GROUP_CALLER_ID       optional: the number staff should see
 *                               as caller ID. If omitted, Twilio uses
 *                               the original caller's number.
 *
 * Keep this route narrow — it doesn't touch the database. We only
 * log the call (into CallLog) once it actually reaches the AI agent.
 * That way Phone.com-era "Matt answered his cell in 8 seconds"
 * outcomes stay off the dashboard.
 */

export const runtime = "nodejs";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  const signature = req.headers.get("x-twilio-signature");
  const url = canonicalRequestUrl(req);
  if (!validateTwilioSignature(signature, url, params)) {
    console.warn("[voice/ring-group] signature rejected");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const numbers = (process.env.RING_GROUP_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const timeout = parseInt(process.env.RING_GROUP_TIMEOUT_SEC ?? "20", 10) || 20;
  const callerId = process.env.RING_GROUP_CALLER_ID?.trim();

  // If no ring-group is configured, skip straight to the agent.
  // Useful for the pre-port period when we only want Twilio to handle
  // the AI fallback leg and Phone.com still handles staff ringing.
  if (numbers.length === 0) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">/api/voice/incoming</Redirect></Response>`;
    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const dialAttrs = [
    `timeout="${timeout}"`,
    `answerOnBridge="true"`,
    callerId ? `callerId="${escapeXml(callerId)}"` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const numberTags = numbers.map((n) => `<Number>${escapeXml(n)}</Number>`).join("");

  // If <Dial> completes with someone answering, Twilio stops reading
  // TwiML after <Dial> — the <Redirect> never fires. If nobody
  // answers (timeout / busy / failed), Twilio continues reading and
  // the <Redirect> hands the call to the agent.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${dialAttrs}>${numberTags}</Dial><Redirect method="POST">/api/voice/incoming</Redirect></Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

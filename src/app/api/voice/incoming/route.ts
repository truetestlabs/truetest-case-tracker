import { NextRequest, NextResponse } from "next/server";
import { createInboundCallLog, appendTurn } from "@/lib/callLog";
import { twimlSay, twimlHangup } from "@/lib/twiml";
import {
  canonicalRequestUrl,
  validateTwilioSignature,
} from "@/lib/twilioSignature";

/**
 * POST /api/voice/incoming
 *
 * Twilio posts here the moment an inbound call lands on our Twilio
 * number. Responds with TwiML: greet, then <Gather> the caller's first
 * utterance and send it to /api/voice/turn.
 *
 * Setup checklist (production):
 *   1. Twilio number Voice webhook → https://<app>/api/voice/incoming (POST)
 *   2. Twilio number Status Callback → https://<app>/api/voice/status (POST),
 *      events: completed
 *   3. Phone.com call forwarding: ring cell + Elk Grove first, then forward
 *      on no-answer to the Twilio number (see docs/phone.com-setup).
 *   4. Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *      TWILIO_FROM_NUMBER, ANTHROPIC_API_KEY. Optional: STAFF_NOTIFY_NUMBERS.
 */

// Force Node runtime — we use Prisma (pg) which doesn't work on Edge.
export const runtime = "nodejs";

const GREETING =
  "Thanks for calling TrueTest Labs, this is the virtual receptionist. How can I help you?";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  const signature = req.headers.get("x-twilio-signature");
  const url = canonicalRequestUrl(req);
  if (!validateTwilioSignature(signature, url, params)) {
    console.warn("[voice/incoming] signature rejected", { url });
    return new NextResponse("Forbidden", { status: 403 });
  }

  const callSid = params["CallSid"];
  const from = params["From"] ?? "";
  const to = params["To"] ?? "";

  if (!callSid) {
    // Malformed request. Play a short apology and hang up.
    return new NextResponse(
      twimlHangup("Sorry, we're having trouble taking your call. Please try again shortly."),
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  try {
    const call = await createInboundCallLog({
      twilioCallSid: callSid,
      fromNumber: from,
      toNumber: to,
    });
    await appendTurn(call.id, {
      role: "agent",
      text: GREETING,
      at: new Date().toISOString(),
    });
    const twiml = twimlSay(GREETING, {
      kind: "gather",
      action: `/api/voice/turn?callLogId=${call.id}`,
    });
    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e) {
    console.error("[voice/incoming] failed to start call:", e);
    return new NextResponse(
      twimlHangup("Sorry, we're having trouble taking your call. Please try again shortly."),
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }
}

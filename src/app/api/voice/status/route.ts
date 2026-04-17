import { NextRequest, NextResponse } from "next/server";
import {
  finalizeCall,
  getCallLogBySid,
  markRecapSent,
  markStaffNotified,
  readTranscript,
} from "@/lib/callLog";
import { writePostCallSummary } from "@/lib/voiceAgent";
import {
  canonicalRequestUrl,
  validateTwilioSignature,
} from "@/lib/twilioSignature";
import { sendSms } from "@/lib/sms";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/voice/status
 *
 * Twilio posts call lifecycle events here (configured as the number's
 * status callback). We only act on "completed": finalize duration,
 * write a summary with Sonnet, text a recap to the caller, and ping
 * the on-call staff numbers.
 *
 * Optional env:
 *   STAFF_NOTIFY_NUMBERS — comma-separated E.164 list. Each gets an
 *                          SMS summary after every call.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  const signature = req.headers.get("x-twilio-signature");
  const url = canonicalRequestUrl(req);
  if (!validateTwilioSignature(signature, url, params)) {
    console.warn("[voice/status] signature rejected");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const callSid = params["CallSid"];
  const callStatus = params["CallStatus"];
  const duration = parseInt(params["CallDuration"] ?? "0", 10) || undefined;
  const recordingUrl = params["RecordingUrl"] || undefined;

  if (!callSid) return NextResponse.json({ ok: true });
  if (callStatus !== "completed") {
    // Other statuses (ringing, in-progress, etc.) are informational
    // only — we don't need to persist them for Phase 1.
    return NextResponse.json({ ok: true });
  }

  const log = await getCallLogBySid(callSid);
  if (!log) {
    console.warn("[voice/status] no CallLog for sid", callSid);
    return NextResponse.json({ ok: true });
  }

  // Post-call summary (best-effort — if Claude fails, keep going).
  let summary: string | undefined;
  try {
    const transcript = await readTranscript(log.id);
    summary = await writePostCallSummary(transcript);
  } catch (e) {
    console.error("[voice/status] summary failed:", e);
  }

  await finalizeCall(log.id, {
    durationSec: duration,
    recordingUrl,
    endedAt: new Date(),
    summary,
    outcome: log.outcome ?? "hung_up",
  });

  // Recap SMS back to the caller. Skip if we never got a usable
  // outcome (e.g., the caller immediately hung up) or if we didn't
  // manage to collect a callback number / reason.
  const fresh = await prisma.callLog.findUnique({ where: { id: log.id } });
  if (fresh?.outcome === "message_taken" && fresh.fromNumber) {
    const body = buildRecapSmsBody({
      callerName: fresh.callerName,
      reason: fresh.summary,
    });
    const res = await sendSms(fresh.fromNumber, body);
    if (res.ok) await markRecapSent(log.id, body);
  }

  // Notify staff on every completed call so they see it in real time.
  const staffNumbers = (process.env.STAFF_NOTIFY_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (staffNumbers.length > 0 && fresh) {
    const staffBody = buildStaffNotifyBody(fresh);
    await Promise.all(staffNumbers.map((n) => sendSms(n, staffBody)));
    await markStaffNotified(log.id);
  }

  return NextResponse.json({ ok: true });
}

function buildRecapSmsBody(opts: { callerName: string | null; reason: string | null | undefined }) {
  const name = opts.callerName?.split(" ")[0] ?? "there";
  const reason = opts.reason ? ` about ${opts.reason.toLowerCase()}` : "";
  return `Hi ${name}, this is TrueTest Labs. Thanks for your call${reason}. Someone will follow up with you shortly. Reply here if it's urgent.`;
}

function buildStaffNotifyBody(log: {
  callerName: string | null;
  fromNumber: string;
  callbackNumber: string | null;
  intent: string | null;
  segment: string | null;
  urgency: string | null;
  summary: string | null;
}) {
  const name = log.callerName ?? "Unknown caller";
  const cb = log.callbackNumber ?? log.fromNumber;
  const tag = [log.intent, log.segment, log.urgency].filter(Boolean).join(" / ");
  const summary = log.summary ?? "(no summary)";
  return `TrueTest AI call: ${name} · ${cb}${tag ? ` · ${tag}` : ""}\n${summary}`;
}

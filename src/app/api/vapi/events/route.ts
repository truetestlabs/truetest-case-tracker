import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateVapiSecret } from "@/lib/vapiSignature";
import {
  createInboundCallLog,
  finalizeCall,
  markRecapSent,
  markStaffNotified,
} from "@/lib/callLog";
import { sendSms } from "@/lib/sms";
import type { TranscriptTurn } from "@/lib/voiceAgent";

/**
 * POST /api/vapi/events
 *
 * Vapi posts lifecycle webhooks here:
 *   - status-update: call is ringing / in-progress / ended
 *   - end-of-call-report: final summary, transcript, recording, cost
 *   - transcript: incremental (optional; we ignore it to keep cost down)
 *
 * We only act on end-of-call-report: finalize the CallLog, capture
 * Vapi's own summary + analysis, send the recap SMS, and ping staff.
 */

export const runtime = "nodejs";

type VapiMessageRole = "assistant" | "user" | "system" | "bot" | "tool";

type VapiTranscriptEntry = {
  role?: VapiMessageRole;
  message?: string;
  content?: string;
  time?: number; // ms epoch
  secondsFromStart?: number;
};

type VapiCall = {
  id?: string;
  assistantId?: string;
  customer?: { number?: string };
  phoneNumber?: { number?: string };
};

type VapiEndOfCallReport = {
  call?: VapiCall;
  endedReason?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  summary?: string;
  transcript?: string;
  messages?: VapiTranscriptEntry[];
  analysis?: {
    summary?: string;
    structuredData?: {
      callerName?: string;
      callbackNumber?: string;
      intent?: string;
      segment?: string;
      urgency?: string;
      language?: string;
      reason?: string;
    };
  };
};

type VapiWebhookBody = {
  message?: (VapiEndOfCallReport & { type?: string });
};

export async function POST(req: NextRequest) {
  if (!validateVapiSecret(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = (await req.json()) as VapiWebhookBody;
  const msg = body.message ?? {};
  const type = msg.type ?? "";
  const call = msg.call ?? {};

  // Ensure a CallLog row exists early in the call lifecycle, even on
  // status-update events — that way the dashboard can start showing
  // in-progress calls if we ever want that view later.
  const externalCallId = call.id;
  if (externalCallId) {
    await createInboundCallLog({
      externalCallId,
      provider: "vapi",
      fromNumber: call.customer?.number ?? "",
      toNumber: call.phoneNumber?.number,
      assistantId: call.assistantId,
    });
  }

  if (type !== "end-of-call-report") {
    return NextResponse.json({ ok: true });
  }
  if (!externalCallId) {
    return NextResponse.json({ ok: true });
  }

  const row = await prisma.callLog.findUnique({ where: { externalCallId } });
  if (!row) return NextResponse.json({ ok: true });

  // Materialize the transcript in our own shape. Vapi uses { role,
  // message } per turn — translate to { role, text, at }.
  const turns: TranscriptTurn[] = (msg.messages ?? [])
    .filter((m) => m.message || m.content)
    .map((m) => ({
      role: mapRole(m.role),
      text: (m.message ?? m.content ?? "").trim(),
      at: m.time ? new Date(m.time).toISOString() : new Date().toISOString(),
    }))
    .filter((t) => t.text.length > 0);

  // Let Vapi's own analysis fill in any fields the tool-call path
  // missed (short calls where the assistant didn't manage to call
  // take_message before the caller hung up, for example).
  const structured = msg.analysis?.structuredData ?? {};
  const summary = msg.analysis?.summary ?? msg.summary ?? row.summary ?? undefined;

  await prisma.callLog.update({
    where: { id: row.id },
    data: {
      callerName: row.callerName ?? structured.callerName ?? null,
      callbackNumber: row.callbackNumber ?? structured.callbackNumber ?? null,
      intent: row.intent ?? structured.intent ?? null,
      segment: row.segment ?? structured.segment ?? null,
      urgency: row.urgency ?? structured.urgency ?? null,
      language: row.language ?? structured.language ?? null,
      transcript: turns as unknown as object,
    },
  });

  await finalizeCall(row.id, {
    durationSec: msg.durationSeconds ? Math.round(msg.durationSeconds) : undefined,
    recordingUrl: msg.recordingUrl,
    endedAt: new Date(),
    summary,
    outcome: row.outcome ?? mapEndedReason(msg.endedReason),
  });

  // Post-finalize SMS side effects.
  const fresh = await prisma.callLog.findUnique({ where: { id: row.id } });
  if (fresh?.outcome === "message_taken" && fresh.fromNumber) {
    const body = buildRecapSmsBody({
      callerName: fresh.callerName,
      reason: fresh.summary,
    });
    const res = await sendSms(fresh.fromNumber, body);
    if (res.ok) await markRecapSent(row.id, body);
  }

  const staffNumbers = (process.env.STAFF_NOTIFY_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  if (staffNumbers.length > 0 && fresh) {
    const staffBody = buildStaffNotifyBody(fresh);
    await Promise.all(staffNumbers.map((n) => sendSms(n, staffBody)));
    await markStaffNotified(row.id);
  }

  return NextResponse.json({ ok: true });
}

function mapRole(role: VapiMessageRole | undefined): TranscriptTurn["role"] {
  if (role === "assistant" || role === "bot") return "agent";
  if (role === "user") return "caller";
  return "system";
}

function mapEndedReason(reason: string | undefined): string {
  if (!reason) return "hung_up";
  if (reason.includes("assistant-ended")) return "message_taken";
  if (reason.includes("customer-ended")) return "hung_up";
  if (reason.includes("silence")) return "failed";
  if (reason.includes("error")) return "failed";
  return "hung_up";
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

import { NextRequest, NextResponse } from "next/server";
import { appendTurn, readTranscript } from "@/lib/callLog";
import { runTurn } from "@/lib/voiceAgent";
import { twimlSay, twimlHangup } from "@/lib/twiml";
import {
  canonicalRequestUrl,
  validateTwilioSignature,
} from "@/lib/twilioSignature";

/**
 * POST /api/voice/turn?callLogId=...
 *
 * Called by Twilio after each <Gather> completes. SpeechResult holds
 * the transcribed caller utterance. We run one turn of the agent and
 * return TwiML to either speak + gather again or speak + hang up.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  const signature = req.headers.get("x-twilio-signature");
  const url = canonicalRequestUrl(req);
  if (!validateTwilioSignature(signature, url, params)) {
    console.warn("[voice/turn] signature rejected");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const callLogId = searchParams.get("callLogId");
  if (!callLogId) {
    return new NextResponse(twimlHangup("Sorry, something went wrong."), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  const userText = (params["SpeechResult"] ?? "").trim();

  // Empty speech result usually means the caller said nothing — hand off
  // gracefully instead of looping forever.
  if (!userText) {
    await appendTurn(callLogId, {
      role: "system",
      text: "empty_speech_result",
      at: new Date().toISOString(),
    });
    const bye =
      "I didn't catch that. I'll have someone follow up shortly. Goodbye.";
    await appendTurn(callLogId, {
      role: "agent",
      text: bye,
      at: new Date().toISOString(),
    });
    return new NextResponse(twimlHangup(bye), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }

  try {
    await appendTurn(callLogId, {
      role: "caller",
      text: userText,
      at: new Date().toISOString(),
    });
    const transcript = await readTranscript(callLogId);
    // runTurn expects the history WITHOUT the utterance we just
    // appended (it adds it back as the final user message itself).
    const history = transcript.slice(0, -1);
    const result = await runTurn(callLogId, history, userText);
    await appendTurn(callLogId, {
      role: "agent",
      text: result.agentText,
      at: new Date().toISOString(),
    });

    if (result.action === "hangup") {
      return new NextResponse(twimlHangup(result.agentText), {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      });
    }

    const twiml = twimlSay(result.agentText, {
      kind: "gather",
      action: `/api/voice/turn?callLogId=${callLogId}`,
    });
    return new NextResponse(twiml, {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  } catch (e) {
    console.error("[voice/turn] agent error:", e);
    const bye =
      "Sorry, I'm having trouble right now. I'll have someone call you back shortly.";
    try {
      await appendTurn(callLogId, {
        role: "agent",
        text: bye,
        at: new Date().toISOString(),
      });
    } catch {
      // best-effort logging only
    }
    return new NextResponse(twimlHangup(bye), {
      status: 200,
      headers: { "Content-Type": "text/xml" },
    });
  }
}

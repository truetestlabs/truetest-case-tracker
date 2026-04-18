import { claude } from "./claude";
import { prisma } from "./prisma";
import { AGENT_SYSTEM_PROMPT } from "./voiceAgentPrompt";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Twilio-native voice agent. Runs one "turn" per caller utterance,
 * replying through <Gather>/<Say> TwiML.
 *
 * NOTE: for production we're migrating to Vapi (see src/lib/vapiAgent.ts)
 * because a managed realtime platform gets us sub-second latency,
 * native barge-in, and ElevenLabs voices — all things the TwiML
 * approach can't match. This file stays as a reference implementation
 * and a fallback path.
 */

// Haiku is the right model for per-turn voice work: latency matters far
// more than depth here, and the post-call summary uses a bigger model.
const TURN_MODEL = "claude-haiku-4-5-20251001";
const SUMMARY_MODEL = "claude-sonnet-4-6";

export type TranscriptTurn = {
  role: "agent" | "caller" | "system";
  text: string;
  at: string;
};

export type TurnResult = {
  agentText: string;
  action: "continue" | "hangup" | "transfer";
  transferTo?: string;
};

const SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "take_message",
    description:
      "Record everything gathered so staff can follow up. Call this once you have at least the caller's name and reason, and ideally a callback number. Can be called again to update fields.",
    input_schema: {
      type: "object",
      properties: {
        callerName: { type: "string", description: "Full name as given" },
        callbackNumber: {
          type: "string",
          description:
            "Best number to reach them. If same as caller ID, pass the same string; if different, pass the new one.",
        },
        reason: {
          type: "string",
          description: "Short 1-2 sentence reason for the call in the caller's own words where possible.",
        },
        intent: {
          type: "string",
          enum: [
            "new_client",
            "status_inquiry",
            "appointment",
            "vendor",
            "legal",
            "partnership",
            "spam",
            "other",
          ],
        },
        segment: {
          type: "string",
          enum: ["family_law", "dot", "non_dot", "dna", "unknown"],
        },
        urgency: { type: "string", enum: ["low", "normal", "high"] },
        language: { type: "string", enum: ["en", "es", "other"] },
      },
      required: ["callerName", "reason", "intent", "urgency"],
    },
  },
  {
    name: "end_call",
    description:
      "End the call. Use after you have said goodbye, or if the caller is spam / wrong number, or after two failed attempts to understand them.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["message_taken", "spam", "unintelligible", "caller_hung_up", "other"],
        },
      },
      required: ["reason"],
    },
  },
];

type MessageParam = Anthropic.MessageParam;

function transcriptToMessages(transcript: TranscriptTurn[]): MessageParam[] {
  const msgs: MessageParam[] = [];
  for (const t of transcript) {
    if (t.role === "caller") msgs.push({ role: "user", content: t.text });
    else if (t.role === "agent") msgs.push({ role: "assistant", content: t.text });
  }
  return msgs;
}

async function executeTool(
  callLogId: string,
  name: string,
  input: Record<string, unknown>
): Promise<{ result: string; hangup: boolean }> {
  if (name === "take_message") {
    const {
      callerName,
      callbackNumber,
      reason,
      intent,
      segment,
      urgency,
      language,
    } = input as {
      callerName?: string;
      callbackNumber?: string;
      reason?: string;
      intent?: string;
      segment?: string;
      urgency?: string;
      language?: string;
    };
    await prisma.callLog.update({
      where: { id: callLogId },
      data: {
        callerName: callerName ?? undefined,
        callbackNumber: callbackNumber ?? undefined,
        intent: intent ?? undefined,
        segment: segment ?? undefined,
        urgency: urgency ?? undefined,
        language: language ?? undefined,
        summary: reason ?? undefined,
        outcome: "message_taken",
      },
    });
    return { result: JSON.stringify({ ok: true }), hangup: false };
  }
  if (name === "end_call") {
    const { reason } = input as { reason?: string };
    const outcomeMap: Record<string, string> = {
      message_taken: "message_taken",
      spam: "hung_up",
      unintelligible: "failed",
      caller_hung_up: "hung_up",
      other: "hung_up",
    };
    await prisma.callLog.update({
      where: { id: callLogId },
      data: { outcome: outcomeMap[reason ?? "other"] ?? "hung_up" },
    });
    return { result: JSON.stringify({ ok: true }), hangup: true };
  }
  return { result: JSON.stringify({ error: "unknown_tool" }), hangup: false };
}

export async function runTurn(
  callLogId: string,
  transcript: TranscriptTurn[],
  userText: string
): Promise<TurnResult> {
  const messages: MessageParam[] = transcriptToMessages(transcript);
  messages.push({ role: "user", content: userText });

  let hangup = false;
  let safety = 0;

  while (safety++ < 4) {
    const response = await claude.messages.create({
      model: TURN_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const { result, hangup: shouldHangup } = await executeTool(
          callLogId,
          block.name,
          block.input as Record<string, unknown>
        );
        if (shouldHangup) hangup = true;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // end_turn — collect all text blocks as agent speech
    const agentText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    return {
      agentText: agentText || "Thanks for calling TrueTest Labs. Someone will follow up shortly.",
      action: hangup ? "hangup" : "continue",
    };
  }

  return {
    agentText:
      "Thanks for calling TrueTest Labs. I'll have someone follow up with you shortly.",
    action: "hangup",
  };
}

/**
 * Post-call: ask a bigger model to write a clean 1-3 sentence summary
 * for the staff dashboard. Runs once from the Twilio status callback.
 */
export async function writePostCallSummary(transcript: TranscriptTurn[]): Promise<string> {
  if (transcript.length === 0) return "No caller audio captured.";
  const convo = transcript
    .filter((t) => t.role !== "system")
    .map((t) => `${t.role === "agent" ? "Agent" : "Caller"}: ${t.text}`)
    .join("\n");

  const response = await claude.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 200,
    system:
      "Summarize this phone call in 1-3 sentences for TrueTest Labs staff. Lead with who called and why. Mention anything time-sensitive. Plain prose, no bullets, no preamble.",
    messages: [{ role: "user", content: convo }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
  return text || "Call summary unavailable.";
}

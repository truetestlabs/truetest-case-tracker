import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateVapiSecret } from "@/lib/vapiSignature";
import { createInboundCallLog } from "@/lib/callLog";
import { VAPI_TOOL_NAMES } from "@/lib/vapiAgent";

/**
 * POST /api/vapi/tool
 *
 * Single endpoint Vapi hits for every tool call the assistant makes.
 * Dispatches by tool name and returns the structured result Vapi
 * hands back to the LLM as the tool response.
 *
 * Vapi request shape (simplified):
 *   {
 *     message: {
 *       type: "tool-calls",
 *       toolCalls: [{ id, function: { name, arguments } }],
 *       call: { id, customer: { number }, assistantId, phoneNumber: { number } }
 *     }
 *   }
 *
 * Response shape Vapi expects:
 *   { results: [{ toolCallId, result: "..." }] }
 */

export const runtime = "nodejs";

type VapiToolCall = {
  id: string;
  function?: { name?: string; arguments?: Record<string, unknown> | string };
  // Vapi has shipped multiple shapes over time — tolerate both.
  name?: string;
  arguments?: Record<string, unknown> | string;
};

type VapiRequestBody = {
  message?: {
    type?: string;
    toolCalls?: VapiToolCall[];
    toolCallList?: VapiToolCall[];
    functionCall?: { name?: string; parameters?: Record<string, unknown> };
    call?: {
      id?: string;
      assistantId?: string;
      customer?: { number?: string };
      phoneNumber?: { number?: string };
    };
  };
};

function parseArgs(raw: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

export async function POST(req: NextRequest) {
  if (!validateVapiSecret(req)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = (await req.json()) as VapiRequestBody;
  const message = body.message ?? {};
  const call = message.call ?? {};
  const externalCallId = call.id;
  if (!externalCallId) {
    return NextResponse.json({ results: [] });
  }

  // Make sure a CallLog row exists for this call. The /events webhook
  // also does this, but tool calls can arrive before the first event
  // depending on ordering — upsert keeps us safe either way.
  const fromNumber = call.customer?.number ?? "";
  const toNumber = call.phoneNumber?.number;
  const assistantId = call.assistantId;
  const row = await createInboundCallLog({
    externalCallId,
    provider: "vapi",
    fromNumber,
    toNumber,
    assistantId,
  });

  // Normalize both Vapi shapes into a single list.
  const rawCalls: VapiToolCall[] =
    message.toolCalls ?? message.toolCallList ?? (
      message.functionCall
        ? [{ id: "legacy", name: message.functionCall.name, arguments: message.functionCall.parameters }]
        : []
    );

  const results: { toolCallId: string; result: string }[] = [];

  for (const tc of rawCalls) {
    const name = tc.function?.name ?? tc.name ?? "";
    const args = parseArgs(tc.function?.arguments ?? tc.arguments);
    const result = await handleTool(row.id, name, args);
    results.push({ toolCallId: tc.id, result });
  }

  return NextResponse.json({ results });
}

async function handleTool(
  callLogId: string,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name === VAPI_TOOL_NAMES.takeMessage) {
    const {
      callerName,
      callbackNumber,
      reason,
      intent,
      segment,
      urgency,
      language,
    } = args as {
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
    return JSON.stringify({ ok: true });
  }

  if (name === VAPI_TOOL_NAMES.endCall) {
    const { reason } = args as { reason?: string };
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
    // Vapi hangs up when the assistant emits an "end-call" marker; our
    // return value just acknowledges the tool.
    return JSON.stringify({ ok: true });
  }

  return JSON.stringify({ error: "unknown_tool", name });
}

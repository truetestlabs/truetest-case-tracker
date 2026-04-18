import { prisma } from "./prisma";
import type { TranscriptTurn } from "./voiceAgent";

/**
 * Thin wrapper around the CallLog Prisma model. The voice agent uses
 * this to append turns to the transcript — turns are stored as an
 * append-only JSON array so we can replay a call deterministically
 * and so post-call summarization has the full context.
 */

export async function createInboundCallLog(params: {
  externalCallId: string;
  provider: "twilio" | "vapi";
  fromNumber: string;
  toNumber?: string;
  assistantId?: string;
}) {
  // Upsert: the ring-group TwiML + <Redirect> fallback, and Vapi's
  // retry behavior on webhooks, can both deliver the same external
  // ID twice. One row per physical call.
  return prisma.callLog.upsert({
    where: { externalCallId: params.externalCallId },
    update: {},
    create: {
      externalCallId: params.externalCallId,
      provider: params.provider,
      assistantId: params.assistantId,
      fromNumber: params.fromNumber,
      toNumber: params.toNumber,
      aiDisclosed: true,
      transcript: [],
    },
  });
}

export async function getCallLog(id: string) {
  return prisma.callLog.findUnique({ where: { id } });
}

export async function getCallLogByExternalId(externalCallId: string) {
  return prisma.callLog.findUnique({ where: { externalCallId } });
}

export async function readTranscript(id: string): Promise<TranscriptTurn[]> {
  const row = await prisma.callLog.findUnique({
    where: { id },
    select: { transcript: true },
  });
  const raw = row?.transcript;
  if (!Array.isArray(raw)) return [];
  return raw as unknown as TranscriptTurn[];
}

export async function appendTurn(id: string, turn: TranscriptTurn) {
  const existing = await readTranscript(id);
  const next = [...existing, turn];
  await prisma.callLog.update({
    where: { id },
    data: { transcript: next as unknown as object },
  });
  return next;
}

export async function finalizeCall(
  id: string,
  params: {
    durationSec?: number;
    recordingUrl?: string;
    endedAt?: Date;
    summary?: string;
    outcome?: string;
  }
) {
  await prisma.callLog.update({
    where: { id },
    data: {
      durationSec: params.durationSec,
      recordingUrl: params.recordingUrl,
      endedAt: params.endedAt ?? new Date(),
      summary: params.summary,
      outcome: params.outcome,
    },
  });
}

export async function markRecapSent(id: string, body: string) {
  await prisma.callLog.update({
    where: { id },
    data: { recapSmsSentAt: new Date(), recapSmsBody: body },
  });
}

export async function markStaffNotified(id: string) {
  await prisma.callLog.update({
    where: { id },
    data: { notifiedStaffAt: new Date() },
  });
}

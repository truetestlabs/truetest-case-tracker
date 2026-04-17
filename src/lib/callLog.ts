import { prisma } from "./prisma";
import type { TranscriptTurn } from "./voiceAgent";

/**
 * Thin wrapper around the CallLog Prisma model. The voice agent uses
 * this to append turns to the transcript — turns are stored as an
 * append-only JSON array so we can replay a call deterministically
 * and so post-call summarization has the full context.
 */

export async function createInboundCallLog(params: {
  twilioCallSid: string;
  fromNumber: string;
  toNumber?: string;
}) {
  return prisma.callLog.create({
    data: {
      twilioCallSid: params.twilioCallSid,
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

export async function getCallLogBySid(sid: string) {
  return prisma.callLog.findUnique({ where: { twilioCallSid: sid } });
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

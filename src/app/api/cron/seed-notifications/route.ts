import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardCron } from "@/lib/cronAuth";

/**
 * GET /api/cron/seed-notifications  (Vercel Cron — runs once daily pre-dawn)
 *
 * For every RandomSelection scheduled for today that hasn't already been
 * acknowledged, enqueue NotificationJob rows on the escalating cadence:
 *
 *   07:00 — push + SMS
 *   09:00 — push + SMS
 *   11:00 — push + email
 *   13:00 — voice (deferred in Phase 3 launch; flag-gated for later)
 *
 * Idempotent: if jobs already exist for a selection (e.g. the cron fires
 * twice or a new selection is inserted after the seed), we only add jobs
 * that aren't already in the queue (dedup by selectionId + channel +
 * sendAt).
 *
 * Time zone note: `selectedDate` is stored at UTC midnight; "today" here
 * is the UTC day. `sendAt` is also UTC so schedule interpretation is the
 * operator's responsibility (set the cron's hours in vercel.json to the
 * desired local times).
 */

// Hours are UTC. Map to America/Chicago roughly (CDT = UTC-5):
//   12 UTC = 7a CDT
//   14 UTC = 9a CDT
//   16 UTC = 11a CDT
// DST drifts this by an hour in winter — accept the one-hour seasonal slide
// rather than pulling in a tz library for a single cadence table. Operators
// can adjust these hours directly when the business moves to a different
// region or wants the launch times shifted.
const SCHEDULE: { hour: number; channels: string[] }[] = [
  { hour: 12, channels: ["push", "sms"] },
  { hour: 14, channels: ["push", "sms"] },
  { hour: 16, channels: ["push", "email"] },
  // Voice deferred — add { hour: 18, channels: ["voice"] } when Twilio Voice is wired.
];

export async function GET(request: NextRequest) {
  const block = guardCron(request);
  if (block) return block;

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const selections = await prisma.randomSelection.findMany({
    where: {
      selectedDate: { gte: today, lt: tomorrow },
      acknowledgedAt: null,
      status: { in: ["pending", "notified"] },
      schedule: { is: { active: true } },
    },
    select: { id: true },
  });

  let enqueued = 0;
  for (const sel of selections) {
    // Build the full plan for this selection.
    const plan = SCHEDULE.flatMap(({ hour, channels }) => {
      const sendAt = new Date(today);
      sendAt.setUTCHours(hour, 0, 0, 0);
      return channels.map((channel) => ({ selectionId: sel.id, channel, sendAt }));
    });

    // Dedup against anything already queued (idempotent re-runs).
    const existing = await prisma.notificationJob.findMany({
      where: {
        selectionId: sel.id,
        sendAt: { gte: today, lt: tomorrow },
      },
      select: { channel: true, sendAt: true },
    });
    const seen = new Set(existing.map((e) => `${e.channel}@${e.sendAt.toISOString()}`));
    const toInsert = plan.filter(
      (p) => !seen.has(`${p.channel}@${p.sendAt.toISOString()}`)
    );

    if (toInsert.length > 0) {
      await prisma.notificationJob.createMany({ data: toInsert });
      enqueued += toInsert.length;
    }
  }

  return NextResponse.json({
    ok: true,
    selectionsConsidered: selections.length,
    jobsEnqueued: enqueued,
  });
}

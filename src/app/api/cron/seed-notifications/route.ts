import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardCron } from "@/lib/cronAuth";
import {
  chicagoTodayAsUtcMidnight,
  utcInstantForChicagoHour,
} from "@/lib/dateChicago";

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

// Email-only escalation cadence. Four dispatches per selected day at the
// America/Chicago wall-clock hours below — DST-aware: `sendAt` is computed
// via `utcInstantForChicagoHour` so 6/8/10/12 local stays correct year-
// round regardless of whether Chicago is on CST or CDT. Run-notifications
// short-circuits as soon as the donor acknowledges the selection via the
// portal, so subsequent jobs for the same day get marked 'skipped' with
// errorMessage='acknowledged'.
//
// SMS channel intentionally disabled until TCPA-compliant opt-in is built.
// Re-enabling requires: consent capture page, logged consent records on Donor,
// STOP/HELP webhook handling, and dispatch-time consent guard.
//
// Push channel left out until the donor-portal subscription UI ships; zero
// active PushSubscription rows today so it would just "skip: no subscriptions"
// on every dispatch.
const SCHEDULE: { localHour: number; channels: string[] }[] = [
  { localHour: 6,  channels: ["email"] },
  { localHour: 8,  channels: ["email"] },
  { localHour: 10, channels: ["email"] },
  { localHour: 12, channels: ["email"] },
  // Voice deferred — add { localHour: N, channels: ["voice"] } when Twilio Voice is wired.
];

export async function GET(request: NextRequest) {
  const block = guardCron(request);
  if (block) return block;

  // "Today" is the donor's Chicago calendar day, encoded as UTC midnight
  // to match how `selectedDate` is stored. Using the Chicago day (not UTC
  // day) makes the cron safe for manual triggers during the Chicago
  // evening window when UTC has already rolled to the next calendar day.
  const today = chicagoTodayAsUtcMidnight();
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
    // Build the full plan for this selection. `sendAt` is the UTC instant
    // corresponding to `localHour:00 America/Chicago` — DST-correct for
    // both CDT (UTC-5) and CST (UTC-6).
    const plan = SCHEDULE.flatMap(({ localHour, channels }) => {
      const sendAt = utcInstantForChicagoHour(today, localHour);
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

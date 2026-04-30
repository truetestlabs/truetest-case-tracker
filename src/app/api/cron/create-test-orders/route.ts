import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardCron } from "@/lib/cronAuth";
import { logAudit } from "@/lib/audit";
import { ensureSystemUser } from "@/lib/systemUser";
import { createTestOrderWithPatchDetails } from "@/lib/createTestOrder";
import {
  chicagoTodayAsUtcMidnight,
  utcInstantForChicagoHour,
} from "@/lib/dateChicago";

/**
 * GET /api/cron/create-test-orders  (Vercel Cron — fires at 09 and 10 UTC)
 *
 * For every RandomSelection scheduled for today (donor's Chicago calendar
 * day) that hasn't already been acknowledged and doesn't already have a
 * linked TestOrder, create a TestOrder populated from the schedule's
 * TestCatalog and back-link it to the selection. Operators fill in the
 * remaining details (paymentMethod, collectionSite, appointmentDate) in
 * the UI when they finalize the order.
 *
 * DST: Vercel Cron is UTC-only, so the cron fires at BOTH 09 UTC (= 4 AM
 * CDT) and 10 UTC (= 4 AM CST). The handler short-circuits when "now" is
 * more than 90 min from 4 AM Chicago today, so exactly one firing per
 * calendar day actually does work.
 *
 * Idempotency: we only pick up selections whose `testOrderId` is null, so
 * re-running the cron (or the second DST firing slipping inside the
 * drift window) is a no-op.
 */

export async function GET(request: NextRequest) {
  const block = guardCron(request);
  if (block) return block;
  if (process.env.CRON_CREATE_ORDERS_DISABLED === "1") {
    return NextResponse.json({ ok: true, skipped: "kill switch" });
  }
  // DST-safe firing gate. `utcInstantForChicagoHour` returns the UTC
  // moment corresponding to 04:00 America/Chicago on today's Chicago
  // calendar day. Whichever of the two cron firings falls within 90 min
  // of that instant is the real one; the other reports "skipped".
  const today = chicagoTodayAsUtcMidnight();
  const fourAmCT = utcInstantForChicagoHour(today, 4);
  const driftMs = Math.abs(Date.now() - fourAmCT.getTime());
  if (driftMs > 90 * 60 * 1000) {
    return NextResponse.json({
      ok: true,
      skipped: "not 4am Chicago",
      now: new Date().toISOString(),
      target: fourAmCT.toISOString(),
    });
  }

  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const selections = await prisma.randomSelection.findMany({
    where: {
      selectedDate: { gte: today, lt: tomorrow },
      testOrderId: null,
      acknowledgedAt: null,
      status: { in: ["pending", "notified"] },
      schedule: { is: { active: true } },
    },
    include: {
      schedule: {
        include: { testCatalog: true, case: true },
      },
    },
  });

  const systemUserId = await ensureSystemUser();

  let created = 0;
  for (const sel of selections) {
    const { schedule } = sel;
    const cat = schedule.testCatalog; // non-null by schema

    try {
      const order = await prisma.$transaction(async (tx) => {
        // Sweat-patch-aware create: if cat.specimenType === 'sweat_patch',
        // helper also creates the PatchDetails row inside this same tx.
        const o = await createTestOrderWithPatchDetails(tx, {
          caseId: schedule.caseId,
          testCatalogId: cat.id,
          testDescription: cat.testName,
          specimenType: cat.specimenType,
          lab: cat.lab,
          collectionType: schedule.collectionType,
          collectionDate: today, // UTC midnight of donor's Chicago day
          testStatus: "order_created",
          // paymentMethod / collectionSite / collectionSiteType left
          // null by design — operator fills in when they finalize.
        });

        await tx.randomSelection.update({
          where: { id: sel.id },
          data: { testOrderId: o.id },
        });

        await tx.statusLog.create({
          data: {
            caseId: schedule.caseId,
            testOrderId: o.id,
            oldStatus: "—",
            newStatus: "order_created",
            changedBy: "cron-auto-create",
            note: `Auto-created from monitoring schedule for ${cat.testName}`,
          },
        });

        // Mirror the manual POST's one-time intake→active bump
        // (src/app/api/cases/[id]/test-orders/route.ts:84).
        if (schedule.case.caseStatus === "intake") {
          await tx.case.update({
            where: { id: schedule.caseId },
            data: { caseStatus: "active" },
          });
        }

        return o;
      });

      // Fire-and-forget audit, matching the manual POST pattern
      // (src/app/api/cases/[id]/test-orders/route.ts:74).
      logAudit({
        userId: systemUserId,
        action: "test_order.create",
        resource: "test_order",
        resourceId: order.id,
        metadata: {
          caseId: schedule.caseId,
          specimenType: cat.specimenType,
          lab: cat.lab,
          source: "cron-auto-create",
          selectionId: sel.id,
        },
      }).catch((e) => console.error("[create-test-orders] audit failed:", e));

      created += 1;
    } catch (e) {
      // Don't let one selection fail the whole batch — log and continue.
      console.error(
        `[create-test-orders] failed for selection ${sel.id}:`,
        e,
      );
    }
  }

  return NextResponse.json({
    ok: true,
    selectionsConsidered: selections.length,
    ordersCreated: created,
  });
}

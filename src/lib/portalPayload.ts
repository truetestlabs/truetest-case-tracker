/**
 * Helpers shared across portal auth routes — extracted out of route.ts
 * so Next.js App Router doesn't treat them as route-segment exports.
 */
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { setPortalSession } from "@/lib/portalSession";
import {
  chicagoTodayAsUtcMidnight,
  isUnlockedForSelection,
  unlockInstantForSelection,
} from "@/lib/dateChicago";
import type { OrderFields } from "@/lib/extractOrder";

export type PortalOrderPdf = {
  fileName: string;
  /** True iff Date.now() >= 4:00 AM America/Chicago on selection day. */
  unlocked: boolean;
  /** ISO instant of the 4 AM CT unlock — used by the UI to render a clock. */
  unlockAtISO: string;
  /**
   * Extracted fields shown on the donor's authed view when unlocked.
   * Intentionally omitted when !unlocked so the payload itself leaks
   * nothing about the contents before unlock.
   */
  fields: OrderFields | null;
};

export type PortalPayload = {
  donorName: string;
  testName: string;
  selected: boolean;
  selection: {
    id: string;
    status: string;
    acknowledgedAt: Date | null;
    orderPdf: PortalOrderPdf | null;
  } | null;
};

/** Today's selection + order-PDF metadata for the given schedule.
 *
 * Note: the signed download URL is NOT embedded here. The donor requests
 * it on demand via GET /api/portal/selection/pdf so (a) the 10-min TTL
 * doesn't expire while the portal sits open, and (b) we get a per-tap
 * audit row. */
export async function buildSessionPayload(scheduleId: string): Promise<PortalPayload | null> {
  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      case: { select: { donor: { select: { firstName: true, lastName: true } } } },
      testCatalog: { select: { testName: true } },
    },
  });
  if (!schedule) return null;

  // "Today" must be the donor's America/Chicago calendar day, not the
  // server's UTC day — selectedDate is stored as UTC-midnight of the
  // intended Chicago day, and the UTC day rolls over at ~7 PM CT. Using
  // UTC here would skip the donor's current-day selection all evening.
  const today = chicagoTodayAsUtcMidnight();
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const selection = await prisma.randomSelection.findFirst({
    where: {
      scheduleId: schedule.id,
      selectedDate: { gte: today, lt: tomorrow },
      status: { in: ["pending", "notified", "completed"] },
    },
    include: {
      documents: {
        where: { documentType: "monitoring_order" },
        orderBy: { uploadedAt: "desc" },
        take: 1,
        select: { id: true, fileName: true, filePath: true, extractedData: true },
      },
    },
  });

  const donorName = schedule.case.donor
    ? `${schedule.case.donor.firstName} ${schedule.case.donor.lastName}`
    : "Donor";

  let orderPdf: PortalOrderPdf | null = null;
  const doc = selection?.documents[0];
  if (doc && selection) {
    const unlocked = isUnlockedForSelection(selection.selectedDate);
    orderPdf = {
      fileName: doc.fileName,
      unlocked,
      unlockAtISO: unlockInstantForSelection(selection.selectedDate).toISOString(),
      // Defense in depth: never surface extracted fields until unlock,
      // even though the donor would have had to authenticate to reach
      // this code path.
      fields: unlocked ? ((doc.extractedData as OrderFields | null) ?? null) : null,
    };
  }

  return {
    donorName,
    testName: schedule.testCatalog.testName,
    selected: !!selection,
    selection: selection
      ? {
          id: selection.id,
          status: selection.status,
          acknowledgedAt: selection.acknowledgedAt,
          orderPdf,
        }
      : null,
  };
}

/**
 * Create/refresh a TrustedDevice row and attach session + device cookies
 * to the given response. Called after successful OTP verification.
 */
export async function issueTrustedDeviceAndSession(
  res: NextResponse,
  scheduleId: string,
  ip: string,
  userAgent: string | null,
  existingDeviceId: string | null
): Promise<string> {
  let deviceId = existingDeviceId || randomBytes(24).toString("hex");

  const existing = await prisma.trustedDevice.findUnique({ where: { deviceId } });
  if (!existing || existing.revokedAt || existing.scheduleId !== scheduleId) {
    if (existing && existing.scheduleId !== scheduleId) {
      deviceId = randomBytes(24).toString("hex");
    }
    await prisma.trustedDevice.create({
      data: {
        scheduleId,
        deviceId,
        userAgent,
        ipAddress: ip === "unknown" ? null : ip,
      },
    });
  } else {
    await prisma.trustedDevice.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        userAgent: userAgent ?? existing.userAgent,
        ipAddress: ip === "unknown" ? null : ip,
      },
    });
  }

  setPortalSession(res, scheduleId, deviceId);
  return deviceId;
}

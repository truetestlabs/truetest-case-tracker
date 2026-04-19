/**
 * Helpers shared across portal auth routes — extracted out of route.ts
 * so Next.js App Router doesn't treat them as route-segment exports.
 */
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { createSignedUrl } from "@/lib/storage";
import { setPortalSession } from "@/lib/portalSession";

export type PortalPayload = {
  donorName: string;
  testName: string;
  selected: boolean;
  selection: {
    id: string;
    status: string;
    acknowledgedAt: Date | null;
    orderPdf: { fileName: string; url: string } | null;
  } | null;
};

/** Today's selection + signed order PDF URL for the given schedule. */
export async function buildSessionPayload(scheduleId: string): Promise<PortalPayload | null> {
  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      case: { select: { donor: { select: { firstName: true, lastName: true } } } },
      testCatalog: { select: { testName: true } },
    },
  });
  if (!schedule) return null;

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
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
        select: { id: true, fileName: true, filePath: true },
      },
    },
  });

  let orderPdfUrl: string | null = null;
  const doc = selection?.documents[0];
  if (doc) {
    try {
      orderPdfUrl = await createSignedUrl(doc.filePath, 600);
    } catch (err) {
      console.error("[portal] sign failed for", doc.filePath, err);
    }
  }

  const donorName = schedule.case.donor
    ? `${schedule.case.donor.firstName} ${schedule.case.donor.lastName}`
    : "Donor";

  return {
    donorName,
    testName: schedule.testCatalog.testName,
    selected: !!selection,
    selection: selection
      ? {
          id: selection.id,
          status: selection.status,
          acknowledgedAt: selection.acknowledgedAt,
          orderPdf: doc && orderPdfUrl ? { fileName: doc.fileName, url: orderPdfUrl } : null,
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

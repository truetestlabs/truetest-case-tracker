import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Reminder = {
  id: string;
  type: string;
  message: string;
  caseId: string;
  caseNumber: string;
  age: string; // "1 hour ago", "3 days ago"
  draftId?: string; // for email_draft type
};

function timeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return "just now";
}

export async function GET() {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const reminders: Reminder[] = [];

    // Run all 6 checks in parallel
    const [
      collectionNotSent,
      resultsNotReleased,
      staleOrders,
      unpaidCollected,
      noTestOrders,
      noSchedule,
      pendingDrafts,
    ] = await Promise.all([
      // 1. Collection notice not sent (1 hour grace)
      prisma.testOrder.findMany({
        where: {
          testStatus: { in: ["specimen_collected", "specimen_held", "sent_to_lab"] },
          collectionDate: { lt: oneHourAgo },
          statusLogs: { none: { notificationSent: true, note: { contains: "collection" } } },
        },
        select: {
          id: true,
          testDescription: true,
          collectionDate: true,
          case: { select: { id: true, caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
        },
        take: 20,
      }),

      // 2. Results ready but not released (1 hour grace)
      prisma.testOrder.findMany({
        where: {
          testStatus: "results_received",
          resultsReceivedDate: { lt: oneHourAgo },
          statusLogs: { none: { notificationSent: true, note: { contains: "results" } } },
        },
        select: {
          id: true,
          testDescription: true,
          resultsReceivedDate: true,
          case: { select: { id: true, caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
        },
        take: 20,
      }),

      // 3. Stale test orders (2 days)
      prisma.testOrder.findMany({
        where: {
          testStatus: "order_created",
          updatedAt: { lt: twoDaysAgo },
          case: { caseStatus: { not: "closed" } },
        },
        select: {
          id: true,
          testDescription: true,
          updatedAt: true,
          case: { select: { id: true, caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
        },
        take: 20,
      }),

      // 4. Unpaid collected specimens (7 days)
      prisma.testOrder.findMany({
        where: {
          testStatus: { in: ["specimen_collected", "specimen_held", "sent_to_lab"] },
          paymentMethod: null,
          collectionDate: { lt: sevenDaysAgo },
          case: { caseStatus: { not: "closed" } },
        },
        select: {
          id: true,
          testDescription: true,
          collectionDate: true,
          case: { select: { id: true, caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
        },
        take: 20,
      }),

      // 5. Cases with no test orders (3 days)
      prisma.case.findMany({
        where: {
          caseStatus: { not: "closed" },
          createdAt: { lt: threeDaysAgo },
          testOrders: { none: {} },
        },
        select: { id: true, caseNumber: true, createdAt: true },
        take: 20,
      }),

      // 6. Monitored cases with no random schedule (3 days)
      prisma.case.findMany({
        where: {
          caseStatus: { not: "closed" },
          isMonitored: true,
          createdAt: { lt: threeDaysAgo },
          monitoringSchedules: { none: {} },
        },
        select: { id: true, caseNumber: true, createdAt: true },
        take: 20,
      }),

      // 7. Pending email drafts (no grace period — show immediately)
      prisma.emailDraft.findMany({
        where: { status: "pending" },
        include: {
          case: { select: { id: true, caseNumber: true, donor: { select: { firstName: true, lastName: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    // Build reminder list — email drafts first (highest priority)
    for (const d of pendingDrafts) {
      const donor = d.case.donor;
      const name = donor ? `${donor.lastName}, ${donor.firstName}` : "Unknown";
      const label = d.draftType === "results_mro" ? "MRO results email" : "Results email";
      reminders.push({
        id: `draft-${d.id}`,
        type: "email_draft",
        message: `${label} ready for review — ${name}`,
        caseId: d.case.id,
        caseNumber: d.case.caseNumber,
        age: timeAgo(d.createdAt),
        draftId: d.id,
      });
    }

    for (const t of collectionNotSent) {
      const donor = t.case.donor;
      const name = donor ? `${donor.lastName}, ${donor.firstName[0]}.` : "Unknown";
      reminders.push({
        id: `collect-${t.id}`,
        type: "collection_notice",
        message: `Collection notice not sent — ${name}, ${t.testDescription}`,
        caseId: t.case.id,
        caseNumber: t.case.caseNumber,
        age: timeAgo(t.collectionDate!),
      });
    }

    for (const t of resultsNotReleased) {
      const donor = t.case.donor;
      const name = donor ? `${donor.lastName}, ${donor.firstName[0]}.` : "Unknown";
      reminders.push({
        id: `results-${t.id}`,
        type: "results_not_released",
        message: `Results ready but not released — ${name}`,
        caseId: t.case.id,
        caseNumber: t.case.caseNumber,
        age: timeAgo(t.resultsReceivedDate!),
      });
    }

    for (const t of staleOrders) {
      const donor = t.case.donor;
      const name = donor ? `${donor.lastName}, ${donor.firstName[0]}.` : "Unknown";
      const days = Math.floor((now.getTime() - t.updatedAt.getTime()) / (1000 * 60 * 60 * 24));
      reminders.push({
        id: `stale-${t.id}`,
        type: "stale_order",
        message: `Stale test order — ${name} at 'Ordered' for ${days} days`,
        caseId: t.case.id,
        caseNumber: t.case.caseNumber,
        age: `${days} days`,
      });
    }

    for (const t of unpaidCollected) {
      const donor = t.case.donor;
      const name = donor ? `${donor.lastName}, ${donor.firstName[0]}.` : "Unknown";
      reminders.push({
        id: `unpaid-${t.id}`,
        type: "unpaid_collected",
        message: `Specimen collected but unpaid — ${name}`,
        caseId: t.case.id,
        caseNumber: t.case.caseNumber,
        age: timeAgo(t.collectionDate!),
      });
    }

    for (const c of noTestOrders) {
      reminders.push({
        id: `notest-${c.id}`,
        type: "no_test_orders",
        message: `Case ${c.caseNumber} has no test orders`,
        caseId: c.id,
        caseNumber: c.caseNumber,
        age: timeAgo(c.createdAt),
      });
    }

    for (const c of noSchedule) {
      reminders.push({
        id: `nosched-${c.id}`,
        type: "no_schedule",
        message: `Monitored case ${c.caseNumber} has no random schedule`,
        caseId: c.id,
        caseNumber: c.caseNumber,
        age: timeAgo(c.createdAt),
      });
    }

    return NextResponse.json({ reminders, count: reminders.length });
  } catch (error) {
    console.error("Error computing reminders:", error);
    return NextResponse.json({ reminders: [], count: 0 });
  }
}

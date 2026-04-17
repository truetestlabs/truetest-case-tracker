import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendResultsReleasedEmail, sendNoShowEmail } from "@/lib/email";
import { deleteCalendarEvent } from "@/lib/gcal";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { createTestOrderSchema, formatZodError } from "@/lib/validation/schemas";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = createTestOrderSchema.passthrough().safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(formatZodError(parsed.error), { status: 400 });
  }
  const body = parsed.data as Record<string, any>;

  try {

    // Look up catalog item for lab cost (internal only)
    let labCost = null;
    if (body.testCatalogId) {
      const catalogItem = await prisma.testCatalog.findUnique({
        where: { id: body.testCatalogId },
      });
      if (catalogItem) labCost = catalogItem.labCost;
    }

    const testOrder = await prisma.testOrder.create({
      data: {
        caseId,
        testCatalogId: body.testCatalogId || null,
        testDescription: body.testDescription,
        specimenType: body.specimenType,
        lab: body.lab,
        testStatus: body.testStatus || "order_created",
        collectionType: body.collectionType || "unobserved",
        schedulingType: body.schedulingType || "scheduled",
        collectionSite: body.collectionSite || null,
        collectionSiteType: body.collectionSiteType || null,
        clientPrice: body.clientPrice || null,
        labCost,
        squarePaymentLink: body.squarePaymentLink || null,
        paymentMethod: body.paymentMethod || null,
        notes: body.notes || null,
      },
    });

    // Log it
    await prisma.statusLog.create({
      data: {
        caseId,
        testOrderId: testOrder.id,
        oldStatus: "—",
        newStatus: testOrder.testStatus,
        changedBy: user.email || user.name || "admin",
        note: `Test ordered: ${body.testDescription}`,
      },
    });

    logAudit({
      userId: user.id,
      action: "test_order.create",
      resource: "test_order",
      resourceId: testOrder.id,
      metadata: { caseId, specimenType: testOrder.specimenType, lab: testOrder.lab },
    }).catch((e) => console.error("[test-orders] audit failed:", e));

    // Update case to active if it's still in intake
    const caseData = await prisma.case.findUnique({ where: { id: caseId } });
    if (caseData && caseData.caseStatus === "intake") {
      await prisma.case.update({
        where: { id: caseId },
        data: { caseStatus: "active" },
      });
    }

    return NextResponse.json(testOrder, { status: 201 });
  } catch (error) {
    console.error("Error creating test order:", error);
    return NextResponse.json({ error: "Failed to create test order" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    const body = await request.json();
    const { testOrderId, ...updateData } = body;

    if (!testOrderId) {
      return NextResponse.json({ error: "testOrderId required" }, { status: 400 });
    }

    const existing = await prisma.testOrder.findUnique({ where: { id: testOrderId } });
    if (!existing || existing.caseId !== caseId) {
      return NextResponse.json({ error: "Test order not found" }, { status: 404 });
    }

    // Build update — set date fields automatically based on status changes
    const data: Record<string, unknown> = {};
    const now = new Date();

    if (updateData.testStatus) {
      data.testStatus = updateData.testStatus;

      if (updateData.testStatus === "order_released" && !existing.orderReleasedDate) {
        data.orderReleasedDate = now;
      }
      if (updateData.testStatus === "specimen_collected" && !existing.collectionDate) {
        data.collectionDate = now;
      }
      if (updateData.testStatus === "specimen_held") {
        data.specimenHeld = true;
      }
      if (updateData.testStatus === "sent_to_lab" && !existing.sentToLabDate) {
        data.sentToLabDate = now;
        data.specimenHeld = false;
      }
      if (updateData.testStatus === "results_received" && !existing.resultsReceivedDate) {
        data.resultsReceivedDate = now;
      }
      if (updateData.testStatus === "results_released" && !existing.resultsReleasedDate) {
        data.resultsReleasedDate = now;
      }
    }

    // Allow manual field updates too
    const manualFields = [
      "collectionSite", "collectionSiteType", "schedulingType",
      "paymentMethod", "appointmentDate", "collectionDate", "labAccessionNumber",
      "invoiceNumber", "notes", "collectionType", "specimenId",
      "testCatalogId", "testDescription", "specimenType", "lab", "clientPrice"
    ];
    // Date fields need conversion from ISO string to Date object
    const dateFields = new Set(["appointmentDate", "collectionDate"]);
    for (const field of manualFields) {
      if (updateData[field] !== undefined) {
        const val = updateData[field];
        data[field] = dateFields.has(field) && val ? new Date(val as string) : val;
      }
    }

    // Auto-manage paymentDate based on paymentMethod transitions
    if (updateData.paymentMethod !== undefined) {
      const oldMethod = existing.paymentMethod;
      const newMethod = updateData.paymentMethod;
      if (!oldMethod && newMethod) {
        data.paymentDate = new Date();

        // Workflow unblock: if this test was sitting in results_held waiting
        // for payment, the moment payment arrives we can advance it to
        // results_received. Without this, the "Release Results" button on
        // the case page never appears (the UI branch requires testStatus ===
        // "results_received" AND paymentMethod set), and the user has to
        // manually drag the status bar between states.
        //
        // Only fire when the caller isn't already changing testStatus in
        // the same PATCH — otherwise we'd clobber an explicit override.
        // Note: the Edit Test Order modal always ships the current testStatus
        // in its PATCH payload, so we treat "same as existing" as "not changing"
        // to avoid blocking the auto-advance in that flow.
        const callerChangingStatus =
          updateData.testStatus !== undefined &&
          updateData.testStatus !== existing.testStatus;
        if (existing.testStatus === "results_held" && !callerChangingStatus) {
          updateData.testStatus = "results_received";
          data.testStatus = "results_received";
          if (!existing.resultsReceivedDate) {
            data.resultsReceivedDate = now;
          }
          updateData.statusNote =
            updateData.statusNote ||
            "Auto-advanced results_held → results_received after payment was recorded.";
        }
      } else if (oldMethod && !newMethod) {
        data.paymentDate = null;
      }
    }

    console.log("[PATCH test-order] updating:", testOrderId, "data keys:", Object.keys(data), "collectionDate:", data.collectionDate);

    const updated = await prisma.testOrder.update({
      where: { id: testOrderId },
      data,
    });

    console.log("[PATCH test-order] saved collectionDate:", updated.collectionDate);

    // Log status change + trigger email notifications
    if (updateData.testStatus && updateData.testStatus !== existing.testStatus) {
      const log = await prisma.statusLog.create({
        data: {
          caseId,
          testOrderId,
          oldStatus: existing.testStatus,
          newStatus: updateData.testStatus,
          changedBy: "admin",
          note: updateData.statusNote || null,
        },
      });

      // Fire emails for key status transitions (best-effort, non-blocking)
      let sentTo: string[] = [];
      try {
        // No Show fires automatically
        if (updateData.testStatus === "no_show") {
          sentTo = await sendNoShowEmail(caseId, testOrderId);
          console.log("[Email] no_show sent to:", sentTo);
        }
        // Results Released does NOT auto-send — use the manual "Send Results Email" button
      } catch (emailErr) {
        console.error("[Email] Send error:", emailErr);
      }

      // Update log with notification info if emails were sent
      if (sentTo.length > 0) {
        await prisma.statusLog.update({
          where: { id: log.id },
          data: {
            notificationSent: true,
            notificationRecipients: sentTo,
          },
        });
      }
    }

    // Auto-close test orders when they reach their terminal pre-close status:
    //  - results_released (non-MRO path) → auto-advance to closed
    //  - mro_released (MRO path) → auto-advance to closed
    // For MRO tests at results_released, we DON'T auto-close — wait for mro_released.
    const autoCloseStatuses = ["results_released", "mro_released"];
    if (autoCloseStatuses.includes(updated.testStatus)) {
      let shouldAutoClose = true;

      if (updated.testStatus === "results_released") {
        // Check if this test has MRO involvement — look for at_mro in status
        // history or an MRO email draft on the case
        const mroLog = await prisma.statusLog.findFirst({
          where: {
            testOrderId,
            OR: [
              { newStatus: "at_mro" },
              { oldStatus: "at_mro" },
            ],
          },
        });
        const mroDraft = await prisma.emailDraft.findFirst({
          where: {
            caseId,
            draftType: "results_mro",
          },
        });
        if (mroLog || mroDraft) {
          // MRO involved — don't close yet, wait for mro_released
          shouldAutoClose = false;
        }
      }

      if (shouldAutoClose) {
        const prevStatus = updated.testStatus;
        await prisma.testOrder.update({
          where: { id: testOrderId },
          data: { testStatus: "closed" },
        });
        updated.testStatus = "closed";

        await prisma.statusLog.create({
          data: {
            caseId,
            testOrderId,
            oldStatus: prevStatus,
            newStatus: "closed",
            changedBy: "auto",
            note: prevStatus === "mro_released"
              ? "Test auto-closed after MRO report released"
              : "Test auto-closed after results released",
          },
        });
      }
    }

    // Cancel linked Google Calendar appointment when test is cancelled/no_show
    if (["cancelled", "no_show"].includes(updated.testStatus)) {
      const appointments = await prisma.appointment.findMany({
        where: { caseId, status: "booked" },
        select: { id: true, googleEventId: true },
      });
      // If ALL tests on this case are now cancelled/no_show/closed, cancel the appointment
      const activeTests = await prisma.testOrder.count({
        where: { caseId, testStatus: { notIn: ["cancelled", "no_show", "closed"] }, id: { not: testOrderId } },
      });
      if (activeTests === 0) {
        for (const appt of appointments) {
          if (appt.googleEventId) {
            await deleteCalendarEvent(appt.googleEventId);
          }
          await prisma.appointment.update({
            where: { id: appt.id },
            data: { status: "cancelled" },
          });
        }
      }
    }

    // Check if all tests on this case are now closed — prompt to close case
    let promptCloseCase = false;
    if (updated.testStatus === "closed") {
      const openTests = await prisma.testOrder.count({
        where: { caseId, testStatus: { notIn: ["closed", "cancelled"] }, id: { not: testOrderId } },
      });
      if (openTests === 0) {
        promptCloseCase = true;
      }
    }

    return NextResponse.json({ ...updated, promptCloseCase });
  } catch (error) {
    console.error("Error updating test order:", error);
    return NextResponse.json({ error: "Failed to update test order" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;
  const { searchParams } = new URL(request.url);
  const testOrderId = searchParams.get("testOrderId");

  if (!testOrderId) {
    return NextResponse.json({ error: "testOrderId required" }, { status: 400 });
  }

  try {
    const existing = await prisma.testOrder.findUnique({ where: { id: testOrderId } });
    if (!existing || existing.caseId !== caseId) {
      return NextResponse.json({ error: "Test order not found" }, { status: 404 });
    }

    // If this was the last active test, cancel linked appointments
    const remainingActive = await prisma.testOrder.count({
      where: { caseId, id: { not: testOrderId }, testStatus: { notIn: ["cancelled", "no_show", "closed"] } },
    });
    if (remainingActive === 0) {
      const appointments = await prisma.appointment.findMany({
        where: { caseId, status: "booked" },
        select: { id: true, googleEventId: true },
      });
      for (const appt of appointments) {
        if (appt.googleEventId) {
          await deleteCalendarEvent(appt.googleEventId);
        }
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { status: "cancelled" },
        });
      }
    }

    // Delete related status logs first
    await prisma.statusLog.deleteMany({ where: { testOrderId } });

    // Delete the test order
    await prisma.testOrder.delete({ where: { id: testOrderId } });

    // Log deletion
    await prisma.statusLog.create({
      data: {
        caseId,
        oldStatus: existing.testStatus,
        newStatus: "deleted",
        changedBy: "admin",
        note: `Deleted test order: ${existing.testDescription}`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting test order:", error);
    return NextResponse.json({ error: "Failed to delete test order" }, { status: 500 });
  }
}

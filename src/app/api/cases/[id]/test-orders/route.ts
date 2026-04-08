import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendResultsReleasedEmail, sendNoShowEmail } from "@/lib/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: caseId } = await params;

  try {
    const body = await request.json();

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
        changedBy: "admin",
        note: `Test ordered: ${body.testDescription}`,
      },
    });

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
      "paymentMethod", "appointmentDate", "labAccessionNumber",
      "invoiceNumber", "notes", "collectionType", "specimenId",
      "testCatalogId", "testDescription", "specimenType", "lab", "clientPrice"
    ];
    for (const field of manualFields) {
      if (updateData[field] !== undefined) data[field] = updateData[field];
    }

    // Auto-manage paymentDate based on paymentMethod transitions
    if (updateData.paymentMethod !== undefined) {
      const oldMethod = existing.paymentMethod;
      const newMethod = updateData.paymentMethod;
      if (!oldMethod && newMethod) {
        data.paymentDate = new Date();
      } else if (oldMethod && !newMethod) {
        data.paymentDate = null;
      }
    }

    const updated = await prisma.testOrder.update({
      where: { id: testOrderId },
      data,
    });

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

    // Check if all tests on this case are now closed — prompt to close case
    let promptCloseCase = false;
    if (updateData.testStatus === "closed") {
      const openTests = await prisma.testOrder.count({
        where: { caseId, testStatus: { not: "closed" }, id: { not: testOrderId } },
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

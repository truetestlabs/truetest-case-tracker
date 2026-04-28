import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> }
) {
  const { id: caseId, orderId: testOrderId } = await params;

  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const body = raw as { testCatalogId?: unknown };
  if (typeof body.testCatalogId !== "string" || !body.testCatalogId) {
    return NextResponse.json({ error: "testCatalogId required" }, { status: 400 });
  }
  const { testCatalogId } = body;

  try {
    const order = await prisma.testOrder.findUnique({ where: { id: testOrderId } });
    if (!order || order.caseId !== caseId) {
      return NextResponse.json({ error: "Test order not found" }, { status: 404 });
    }

    if (order.testCatalogId) {
      return NextResponse.json({ error: "Order already confirmed" }, { status: 409 });
    }

    const catalog = await prisma.testCatalog.findUnique({ where: { id: testCatalogId } });
    if (!catalog) {
      return NextResponse.json({ error: "Test catalog item not found" }, { status: 404 });
    }

    if (catalog.specimenType !== order.specimenType) {
      return NextResponse.json({ error: "Specimen type mismatch" }, { status: 422 });
    }

    const [updated] = await prisma.$transaction([
      prisma.testOrder.update({
        where: { id: testOrderId },
        data: {
          testCatalogId: catalog.id,
          testDescription: catalog.testName,
          lab: catalog.lab,
          clientPrice: catalog.clientPrice,
          labCost: catalog.labCost,
        },
      }),
      prisma.statusLog.create({
        data: {
          caseId,
          testOrderId,
          oldStatus: order.testStatus,
          newStatus: order.testStatus,
          changedBy: user.email || user.name || "admin",
          note: `Test confirmed by staff: ${catalog.testName}`,
        },
      }),
    ]);

    logAudit({
      userId: user.id,
      action: "test_order.confirm",
      resource: "test_order",
      resourceId: testOrderId,
      metadata: {
        caseId,
        testCatalogId: catalog.id,
        specimenType: order.specimenType,
        lab: catalog.lab,
      },
    }).catch((e) => console.error("[test-orders/confirm] audit failed:", e));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error confirming test order:", error);
    return NextResponse.json({ error: "Failed to confirm test order" }, { status: 500 });
  }
}

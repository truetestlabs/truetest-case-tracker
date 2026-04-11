import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { approveDraft } from "@/lib/kiosk-approve";

/** GET /api/kiosk/intakes/[id] — get single intake draft */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const draft = await prisma.intakeDraft.findUnique({ where: { id } });
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(draft);
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

/** PATCH /api/kiosk/intakes/[id] — approve, reject, or edit a draft */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const draft = await prisma.intakeDraft.findUnique({ where: { id } });
    if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Approve → create case via shared helper
    if (body.action === "approve") {
      try {
        const result = await approveDraft(id, body.reviewedBy || "admin");
        return NextResponse.json({
          approved: true,
          caseId: result.caseId,
          caseNumber: result.caseNumber,
        });
      } catch (error) {
        console.error("Intake approve error:", error);
        return NextResponse.json({ error: "Failed to approve" }, { status: 500 });
      }
    }

    // Reject
    if (body.action === "reject") {
      await prisma.intakeDraft.update({
        where: { id },
        data: {
          status: "rejected",
          reviewedAt: new Date(),
          reviewedBy: body.reviewedBy || "admin",
        },
      });
      return NextResponse.json({ rejected: true });
    }

    // Edit fields
    const updates: Record<string, unknown> = {};
    const editableFields = ["firstName", "lastName", "phone", "email", "caseType", "courtCaseNumber", "county", "judgeName", "orderedBy", "paymentResponsibility", "notes"];
    for (const field of editableFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    if (Object.keys(updates).length > 0) {
      await prisma.intakeDraft.update({ where: { id }, data: updates });
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error("Intake PATCH error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

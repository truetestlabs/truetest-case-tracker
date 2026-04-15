/**
 * PATCH /api/lab-results/[id]/resolve
 *
 * Resolve one of the cross-check mismatches recorded on a LabResult. The
 * user chose one of three actions per finding:
 *   - "accept_theirs" : apply the lab's value to the TestOrder (for
 *                       collection_date only; specimen_id is never overwritten
 *                       from here — a specimen mix-up needs investigation,
 *                       not a click).
 *   - "keep_ours"     : do nothing to the TestOrder; mark the finding
 *                       resolved with our existing value.
 *   - "flag"          : mark resolved but record that human review found a
 *                       real issue (used for audit trail).
 *
 * Any action writes a StatusLog entry on the TestOrder so the paper trail
 * survives even if someone later edits the mismatch data.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const resolveSchema = z.object({
  action: z.enum(["accept_theirs", "keep_ours", "flag"]),
  findingIndex: z.number().int().min(0),
  reviewNote: z.string().max(2000).optional().nullable(),
});

type Mismatch = {
  type: string;
  severity: string;
  ourValue: string;
  theirValue: string;
  message: string;
  resolved?: boolean;
  resolvedAction?: string;
  resolvedAt?: string;
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: labResultId } = await params;

  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = resolveSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action, findingIndex, reviewNote } = parsed.data;

  try {
    const labResult = await prisma.labResult.findUnique({
      where: { id: labResultId },
      include: { testOrder: true },
    });
    if (!labResult) {
      return NextResponse.json({ error: "LabResult not found" }, { status: 404 });
    }

    const mismatches = (labResult.mismatches as Mismatch[] | null) ?? [];
    const finding = mismatches[findingIndex];
    if (!finding) {
      return NextResponse.json({ error: "Finding not found at that index" }, { status: 404 });
    }
    if (finding.resolved) {
      return NextResponse.json({ error: "Finding already resolved" }, { status: 409 });
    }

    // Apply the action to the TestOrder if the user accepted the lab's value.
    // We currently only handle collection_date here — specimen_id mismatches
    // are too serious to resolve with a click and need a separate investigation
    // flow.
    if (action === "accept_theirs" && finding.type === "collection_date") {
      const isoMatch = finding.theirValue.match(/(\w+)\s(\d+),?\s(\d{4})/);
      // finding.theirValue is formatted by labResultCrosscheck as
      // "Month D, YYYY"; fall back to parsing the stored reportedCollectionDate
      // which is the authoritative source.
      let newDate: Date | null = null;
      if (labResult.reportedCollectionDate) {
        newDate = labResult.reportedCollectionDate;
      } else if (isoMatch) {
        newDate = new Date(finding.theirValue);
        if (Number.isNaN(newDate.getTime())) newDate = null;
      }
      if (newDate) {
        await prisma.testOrder.update({
          where: { id: labResult.testOrderId },
          data: { collectionDate: newDate },
        });
      }
    }

    // Update the mismatch entry in place.
    const now = new Date();
    const updatedMismatches = mismatches.map((m, i) =>
      i === findingIndex
        ? {
            ...m,
            resolved: true,
            resolvedAction: action,
            resolvedAt: now.toISOString(),
            resolvedBy: user.email || user.name,
            reviewNote: reviewNote ?? null,
          }
        : m
    );

    const allResolved = updatedMismatches.every((m) => m.resolved);
    const updated = await prisma.labResult.update({
      where: { id: labResultId },
      data: {
        mismatches: updatedMismatches,
        ...(allResolved ? { mismatchesResolvedAt: now, mismatchesResolvedBy: user.email || user.name } : {}),
      },
    });

    // Paper trail.
    await prisma.statusLog.create({
      data: {
        caseId: labResult.testOrder.caseId,
        testOrderId: labResult.testOrderId,
        oldStatus: labResult.testOrder.testStatus,
        newStatus: labResult.testOrder.testStatus, // not a status change, just a log entry
        changedBy: user.email || user.name || "admin",
        note:
          `Lab result cross-check resolved by ${user.email || user.name}: ${action} on ${finding.type}. ` +
          `Ours: "${finding.ourValue}" | Theirs: "${finding.theirValue}"` +
          (reviewNote ? `. Note: ${reviewNote}` : ""),
      },
    });

    logAudit({
      userId: user.id,
      action: `lab_result.mismatch.${action}`,
      resource: "lab_result",
      resourceId: labResultId,
      metadata: { findingType: finding.type, severity: finding.severity },
    }).catch((e) => console.error("[lab-results/resolve] audit failed:", e));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error resolving lab result mismatch:", error);
    return NextResponse.json({ error: "Failed to resolve mismatch" }, { status: 500 });
  }
}

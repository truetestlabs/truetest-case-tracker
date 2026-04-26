import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { cancelPatchWithReplacement } from "@/lib/patchStatus";
import {
  computeWearDays,
  PATCH_WEAR_THRESHOLDS,
} from "@/lib/patchValidation";
import type { PatchCancellationKind } from "@prisma/client";

// POST /api/cases/[id]/cancel-patch
//
// Cancels a sweat-patch order. If the donor received a fresh patch in
// the same visit, also creates the replacement TestOrder + PatchDetails
// atomically. Triggers the cancellation-report email-draft path on the
// client side after a successful response.
//
// Body shape:
//   {
//     patchDetailsId: string,
//     cancelledAt?: ISO-string,            // defaults to now
//     kind?: 'cancelled' | 'lab_cancelled' | 'expired',  // optional;
//                                                       //   inferred if absent
//     replacement:
//       | { applied: false }
//       | { applied: true, applicationDate: ISO-string, specimenId: string }
//   }
//
// kind inference (when absent): if wear days at cancellation ≥ 30, kind is
// 'expired'; otherwise 'cancelled'. The CancelPatchModal never sends a
// kind value — staff don't see this as a user-facing choice. The
// 'lab_cancelled' kind exists in the schema for future flows (e.g.,
// CRL rejection ingestion) but is not selectable here. Admin tooling
// or a future endpoint can pass kind explicitly when needed.
//
// Returns 201 with { cancelledPatchDetailsId, replacementOrderId, replacementPatchDetailsId, kind }.

const VALID_KINDS: ReadonlyArray<PatchCancellationKind> = [
  "cancelled",
  "lab_cancelled",
  "expired",
];

// CRL specimen IDs are exactly 9 digits, no prefix, no separators.
// Reject any non-matching value at the boundary so we don't write a
// malformed ID into a fresh PatchDetails record.
const CRL_SPECIMEN_ID_RE = /^\d{9}$/;

// Pure function: derive cancellationKind from wear-day count at the
// cancellation moment. ≥30 days = expired (matches the wear-band red
// threshold and the existing PATCH_WEAR_THRESHOLDS.expiredCancelMin
// constant — keep both in sync). Returns 'cancelled' when applicationDate
// is unknown (can't compute wear days).
function inferCancellationKind(
  applicationDate: Date | null,
  cancelledAt: Date,
): PatchCancellationKind {
  if (!applicationDate) return "cancelled";
  const wearDays = computeWearDays(applicationDate, cancelledAt);
  if (wearDays >= PATCH_WEAR_THRESHOLDS.expiredCancelMin) return "expired";
  return "cancelled";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;

  const auth = await requireAuth(request);
  if (auth.response) return auth.response;
  const user = auth.user;

  let body: {
    patchDetailsId?: string;
    kind?: string;
    cancelledAt?: string;
    replacement?:
      | { applied: false }
      | { applied: true; applicationDate?: string; specimenId?: string };
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Validate inputs ──────────────────────────────────────────────────
  if (!body.patchDetailsId || typeof body.patchDetailsId !== "string") {
    return NextResponse.json(
      { error: "patchDetailsId is required" },
      { status: 400 },
    );
  }
  // kind is optional. If passed, it must be valid; if absent, we infer
  // it server-side from wear-days. The modal never sends kind.
  if (body.kind && !VALID_KINDS.includes(body.kind as PatchCancellationKind)) {
    return NextResponse.json(
      { error: `kind, if provided, must be one of: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }
  const cancelledAt = body.cancelledAt ? new Date(body.cancelledAt) : undefined;
  if (cancelledAt && Number.isNaN(cancelledAt.getTime())) {
    return NextResponse.json(
      { error: "cancelledAt is not a valid date" },
      { status: 400 },
    );
  }

  let replacement:
    | { applied: false }
    | { applied: true; applicationDate: Date; specimenId: string };

  if (!body.replacement || body.replacement.applied === false) {
    replacement = { applied: false };
  } else if (body.replacement.applied === true) {
    if (!body.replacement.applicationDate || !body.replacement.specimenId) {
      return NextResponse.json(
        {
          error:
            "replacement.applicationDate and replacement.specimenId are required when applied=true",
        },
        { status: 400 },
      );
    }
    const appDate = new Date(body.replacement.applicationDate);
    if (Number.isNaN(appDate.getTime())) {
      return NextResponse.json(
        { error: "replacement.applicationDate is not a valid date" },
        { status: 400 },
      );
    }
    const trimmedSpecimenId = body.replacement.specimenId.trim();
    if (!CRL_SPECIMEN_ID_RE.test(trimmedSpecimenId)) {
      return NextResponse.json(
        {
          error:
            "replacement.specimenId must be exactly 9 digits (CRL specimen ID format)",
          field: "replacement.specimenId",
          received: trimmedSpecimenId,
        },
        { status: 422 },
      );
    }
    replacement = {
      applied: true,
      applicationDate: appDate,
      specimenId: trimmedSpecimenId,
    };
  } else {
    return NextResponse.json(
      { error: "replacement.applied must be a boolean" },
      { status: 400 },
    );
  }

  // ── Verify the patch belongs to this case ────────────────────────────
  // Avoid the foot-gun where a malformed client request cancels a patch
  // on a different case but routes the side effects (status logs, audit)
  // through the wrong case id. Also pull applicationDate so we can infer
  // the cancellation kind below.
  const existing = await prisma.patchDetails.findUnique({
    where: { id: body.patchDetailsId },
    select: {
      id: true,
      applicationDate: true,
      cancellationKind: true,
      testOrder: { select: { id: true, caseId: true } },
    },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "PatchDetails not found" },
      { status: 404 },
    );
  }
  if (existing.testOrder.caseId !== caseId) {
    return NextResponse.json(
      { error: "PatchDetails does not belong to this case" },
      { status: 400 },
    );
  }
  if (existing.cancellationKind) {
    return NextResponse.json(
      { error: "Patch is already cancelled" },
      { status: 409 },
    );
  }

  // Resolve cancellation kind: explicit > inferred. Modal callers don't
  // send a kind value; admin/future flows can pass one explicitly.
  const resolvedCancelledAt = cancelledAt ?? new Date();
  const resolvedKind: PatchCancellationKind = body.kind
    ? (body.kind as PatchCancellationKind)
    : inferCancellationKind(existing.applicationDate, resolvedCancelledAt);

  // ── Execute the cancellation + optional replacement in one tx ────────
  try {
    const result = await prisma.$transaction((tx) =>
      cancelPatchWithReplacement(tx, {
        patchDetailsId: body.patchDetailsId!,
        kind: resolvedKind,
        cancelledAt: resolvedCancelledAt,
        replacement,
      }),
    );

    // Log status change on the original test order. We log against the
    // existing TestStatus enum (TestOrder.testStatus) staying as-is but
    // record the patch-level cancellation in the StatusLog note so it
    // shows up in the activity feed.
    const replacementNote = replacement.applied
      ? `Replacement patch applied on ${replacement.applicationDate.toISOString().slice(0, 10)} (specimen ${replacement.specimenId}).`
      : "No replacement patch applied.";

    await prisma.statusLog.create({
      data: {
        caseId,
        testOrderId: existing.testOrder.id,
        oldStatus: "—",
        newStatus: "patch_cancelled",
        changedBy: user.email || user.name || "admin",
        note: `Patch cancelled (${resolvedKind}). ${replacementNote}`,
      },
    });

    if (result.replacementOrderId) {
      await prisma.statusLog.create({
        data: {
          caseId,
          testOrderId: result.replacementOrderId,
          oldStatus: "—",
          newStatus: "specimen_collected",
          changedBy: user.email || user.name || "admin",
          note: `Replacement patch for cancelled order ${existing.testOrder.id}.`,
        },
      });
    }

    logAudit({
      userId: user.id,
      action: "patch.cancel",
      resource: "patch_details",
      resourceId: body.patchDetailsId,
      metadata: {
        caseId,
        kind: resolvedKind,
        kindSource: body.kind ? "explicit" : "inferred",
        replacementApplied: replacement.applied,
        replacementOrderId: result.replacementOrderId,
      },
    }).catch((e) => console.error("[cancel-patch] audit failed:", e));

    return NextResponse.json(
      {
        cancelledPatchDetailsId: result.cancelled.id,
        replacementOrderId: result.replacementOrderId,
        replacementPatchDetailsId: result.replacementPatchDetailsId,
        kind: resolvedKind,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error cancelling patch:", error);
    const msg = error instanceof Error ? error.message : "Failed to cancel patch";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

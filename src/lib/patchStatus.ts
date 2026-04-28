import type {
  Document,
  PatchCancellationKind,
  PatchDetails,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { createTestOrderWithPatchDetails } from "@/lib/createTestOrder";

/**
 * Prisma-aware lifecycle operations for sweat-patch test orders.
 *
 * Pair this with `src/lib/patchValidation.ts` (pure helpers, no DB). The
 * mutating helpers here all require a `Prisma.TransactionClient` — they
 * intentionally won't accept the global `prisma` client — to force
 * callers to wrap them in `prisma.$transaction` and keep the
 * patch + test-order state changes atomic.
 *
 * Read helpers accept either client.
 */

// Prisma client variant the read helpers accept. Mutating helpers
// always require a TransactionClient (positional `tx` arg).
type ReadClient = Prisma.TransactionClient | PrismaClient;

// ──────────────────────────────────────────────────────────────────────
// executePatchCoc
// ──────────────────────────────────────────────────────────────────────
//
// Run when staff upload an EXECUTED chain-of-custody for a sweat patch:
//   - PatchDetails.executedDocumentId  ← newly-uploaded doc id
//   - PatchDetails.workingCopyDocumentId ← null  (working copy is now
//     archived in place; the Document row itself is NEVER deleted —
//     "archive not delete" per the locked design decisions)
//   - PatchDetails.removalDate ← caller-supplied removal date (extracted
//     from the executed CoC by Vision/regex; may already be set if the
//     UI captured it, in which case caller can pass undefined and we
//     leave the existing value alone)
//   - TestOrder.collectionDate ← mirror of removalDate, only when a new
//     removal date is supplied (per the "removal/collection mirror"
//     decision; this is what feeds downstream collection-based logic)
//
// Returns the updated PatchDetails. Throws if patchDetailsId doesn't
// resolve — that's a programmer error, not a user error.

export async function executePatchCoc(
  tx: Prisma.TransactionClient,
  input: {
    patchDetailsId: string;
    executedDocumentId: string;
    removalDate?: Date;
  },
): Promise<PatchDetails> {
  const updated = await tx.patchDetails.update({
    where: { id: input.patchDetailsId },
    data: {
      executedDocumentId: input.executedDocumentId,
      workingCopyDocumentId: null,
      ...(input.removalDate ? { removalDate: input.removalDate } : {}),
    },
  });

  // Mirror to TestOrder.collectionDate only when a removal date is
  // supplied — silently leaving collectionDate untouched when the
  // caller didn't provide one is the right call (we don't want to
  // null-out a previously-set collectionDate just because this path
  // didn't carry the date).
  if (input.removalDate) {
    await tx.testOrder.update({
      where: { id: updated.testOrderId },
      data: { collectionDate: input.removalDate },
    });
  }

  return updated;
}

// ──────────────────────────────────────────────────────────────────────
// replaceWorkingCopy
// ──────────────────────────────────────────────────────────────────────
//
// Run when staff upload a NEW working-copy chain-of-custody before the
// patch has been removed (e.g., re-scan because the first scan was
// blurry). Replaces the FK; the previous Document row stays in the DB
// and shows up via getArchivedPatchCocDocuments below. No archiving
// state changes elsewhere.

export async function replaceWorkingCopy(
  tx: Prisma.TransactionClient,
  input: { patchDetailsId: string; newDocumentId: string },
): Promise<PatchDetails> {
  return tx.patchDetails.update({
    where: { id: input.patchDetailsId },
    data: { workingCopyDocumentId: input.newDocumentId },
  });
}

// ──────────────────────────────────────────────────────────────────────
// cancelPatch
// ──────────────────────────────────────────────────────────────────────
//
// Mark a sweat patch as cancelled. Sets `cancellationKind` and stamps
// `cancelledAt` (defaults to now). Does NOT clear FKs to the working
// or executed CoC documents — cancellation can happen at any lifecycle
// stage, and we want the audit trail to keep what was uploaded.
//
// `kind` semantics (per locked design):
//   - cancelled      — staff cancelled, generic reason
//   - lab_cancelled  — CRL rejected the specimen
//   - expired        — manual cancel after 30+ wear-days (red badge)

export async function cancelPatch(
  tx: Prisma.TransactionClient,
  input: {
    patchDetailsId: string;
    kind: PatchCancellationKind;
    cancelledAt?: Date;
  },
): Promise<PatchDetails> {
  return tx.patchDetails.update({
    where: { id: input.patchDetailsId },
    data: {
      cancellationKind: input.kind,
      cancelledAt: input.cancelledAt ?? new Date(),
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// cancelPatchWithReplacement
// ──────────────────────────────────────────────────────────────────────
//
// Cancels the existing patch AND optionally creates a fresh sweat-patch
// TestOrder + PatchDetails row on the same case for the replacement.
// Both writes happen in the caller's transaction; if the replacement
// create fails, the cancellation rolls back too.
//
// Stamps `replacementPatchApplied` and (if applied) `replacementPatchDate`
// on the cancelled PatchDetails so the audit trail is queryable directly
// from the cancelled row without joining through Case → TestOrders.
//
// The replacement order copies these fields from the cancelled order:
//   - lab, testCatalogId, testDescription, specimenType,
//     collectionType, schedulingType, collectionSite, collectionSiteType
//   - panel (from the cancelled PatchDetails)
// And sets these fresh:
//   - applicationDate ← input.replacement.applicationDate
//   - specimenId ← input.replacement.specimenId
//   - testStatus = 'specimen_collected' (the patch IS on the donor)
//
// We deliberately do NOT copy: appointmentDate, collectionDate,
// orderReleasedDate, paymentDate, sentToLabDate, results dates,
// invoiceNumber, squarePaymentId/Link, labAccessionNumber,
// testvaultOrderId, notes — those are per-instance state and would be
// misleading on the new row.
//
// We also deliberately do NOT copy `paymentMethod`, `clientPrice`, or
// `labCost` — payment and pricing are handled fresh for the replacement
// order. Reusing the prior payment marker would falsely show the new
// order as "already paid" and skip the invoicing step that's expected
// for a separate test order.
//
// Returns both rows so the caller can log/respond.

export async function cancelPatchWithReplacement(
  tx: Prisma.TransactionClient,
  input: {
    patchDetailsId: string;
    kind: PatchCancellationKind;
    cancelledAt?: Date;
    replacement:
      | { applied: false }
      | { applied: true; applicationDate: Date; specimenId: string };
  },
): Promise<{
  cancelled: PatchDetails;
  replacementOrderId: string | null;
  replacementPatchDetailsId: string | null;
}> {
  // Load the source patch + its order so we can copy the relevant fields.
  const source = await tx.patchDetails.findUnique({
    where: { id: input.patchDetailsId },
    include: { testOrder: true },
  });
  if (!source) {
    throw new Error(`PatchDetails ${input.patchDetailsId} not found`);
  }

  const cancelledAt = input.cancelledAt ?? new Date();

  const cancelled = await tx.patchDetails.update({
    where: { id: input.patchDetailsId },
    data: {
      cancellationKind: input.kind,
      cancelledAt,
      replacementPatchApplied: input.replacement.applied,
      replacementPatchDate: input.replacement.applied
        ? input.replacement.applicationDate
        : null,
    },
  });

  if (!input.replacement.applied) {
    return {
      cancelled,
      replacementOrderId: null,
      replacementPatchDetailsId: null,
    };
  }

  // Create the replacement order + PatchDetails atomically. The patch
  // is already on the donor (staff applied it in the same visit they
  // cancelled the prior one), so testStatus = 'specimen_collected'.
  const src = source.testOrder;
  const newOrder = await createTestOrderWithPatchDetails(
    tx,
    {
      caseId: src.caseId,
      testCatalogId: src.testCatalogId,
      testDescription: src.testDescription,
      specimenType: src.specimenType,
      lab: src.lab,
      testStatus: "specimen_collected",
      collectionType: src.collectionType,
      schedulingType: src.schedulingType,
      collectionSite: src.collectionSite,
      collectionSiteType: src.collectionSiteType,
      // INTENTIONAL: paymentMethod, clientPrice, labCost are NOT copied.
      // The replacement order is billed fresh — copying paymentMethod
      // would mark the new order as already-paid and bypass invoicing.
      specimenId: input.replacement.specimenId,
    },
    { patchPanel: source.panel },
  );

  // Stamp the application date on the new PatchDetails row.
  const newPatchDetails = await tx.patchDetails.update({
    where: { testOrderId: newOrder.id },
    data: { applicationDate: input.replacement.applicationDate },
  });

  return {
    cancelled,
    replacementOrderId: newOrder.id,
    replacementPatchDetailsId: newPatchDetails.id,
  };
}

// ──────────────────────────────────────────────────────────────────────
// getArchivedPatchCocDocuments
// ──────────────────────────────────────────────────────────────────────
//
// Returns chain-of-custody Documents linked to a sweat-patch TestOrder
// that are NOT currently the working copy or the executed copy on
// PatchDetails. These are "archived" working copies — superseded by a
// later upload but kept as audit trail.
//
// **NULL-safety is the whole point of this helper.** A naive Prisma
// filter like `id: { notIn: [pd.workingCopyDocumentId, pd.executedDocumentId] }`
// passes NULL into the SQL `NOT IN (...)` clause. Postgres semantics:
// `x NOT IN (NULL, ...)` is `UNKNOWN`, which never matches. Result:
// zero rows returned, even though there ARE archived copies. The
// `buildArchivedDocsWhere` helper below filters NULLs out before
// construction, which is the coalesce-equivalent in Prisma's API.
//
// Returned in upload-time descending order (newest archived first).

export async function getArchivedPatchCocDocuments(
  client: ReadClient,
  testOrderId: string,
): Promise<Document[]> {
  const pd = await client.patchDetails.findUnique({
    where: { testOrderId },
    select: { workingCopyDocumentId: true, executedDocumentId: true },
  });
  if (!pd) return [];

  return client.document.findMany({
    where: {
      testOrderId,
      documentType: "chain_of_custody",
      ...buildArchivedDocsWhere(
        pd.workingCopyDocumentId,
        pd.executedDocumentId,
      ),
    },
    orderBy: { uploadedAt: "desc" },
  });
}

// ──────────────────────────────────────────────────────────────────────
// buildArchivedDocsWhere — exported for unit-testing the NULL safety
// ──────────────────────────────────────────────────────────────────────
//
// Returns a Prisma `where` fragment that excludes the current working
// and executed CoC document IDs. Two important behaviors:
//   1. NULLs are filtered out (never reach Prisma's `notIn`).
//   2. If both inputs are NULL, returns an empty fragment — i.e. NO
//      filter, every CoC document is "archived" because nothing is
//      currently linked. (Without this, a `notIn: []` would still
//      return all rows, but the call to `notIn` is wasted SQL.)

export function buildArchivedDocsWhere(
  workingCopyDocumentId: string | null,
  executedDocumentId: string | null,
): { id?: { notIn: string[] } } {
  const excluded = [workingCopyDocumentId, executedDocumentId].filter(
    (v): v is string => Boolean(v),
  );
  return excluded.length > 0 ? { id: { notIn: excluded } } : {};
}

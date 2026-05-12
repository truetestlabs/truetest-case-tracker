import type { DocumentType, SpecimenType, TestStatus } from "@prisma/client";

/**
 * Test-order statuses considered "pre-collection" — a CoC upload from
 * any of these advances the order to specimen_collected (subject to the
 * patch carve-out below). Other statuses are left untouched, since
 * uploading a CoC after the order has moved past collection shouldn't
 * roll it backward or skip ahead.
 */
const PRE_COLLECTION_STATUSES: readonly TestStatus[] = [
  "order_created",
  "awaiting_payment",
  "payment_received",
];

/**
 * Predicate: should uploading this CoC document auto-advance the test
 * order's testStatus from a pre-collection state to specimen_collected?
 *
 * Sweat-patch carve-out (Option A, 2026-05): when an Application CoC is
 * uploaded for a sweat_patch order, the patch has just been APPLIED to
 * the donor — the specimen has not been collected yet (it gets collected
 * when the patch is removed days later). Advancing testStatus at
 * application time would (a) misrepresent the lifecycle, and (b) trigger
 * the EditTestOrderModal's Removal-Date-required validator before any
 * removal has happened (Bug 1). Removal CoC uploads on patches DO still
 * advance — that's when the specimen actually becomes "collected" and
 * begins moving toward the lab.
 *
 * Pure function (no DB or env reads), kept in src/lib to match the
 * project's existing test-helper convention (see patchStatus.test.ts,
 * dateChicago.test.ts).
 */
export function shouldAutoAdvanceOnCocUpload(input: {
  documentType: DocumentType;
  currentTestStatus: TestStatus;
  specimenType: SpecimenType;
}): boolean {
  if (!PRE_COLLECTION_STATUSES.includes(input.currentTestStatus)) return false;
  if (
    input.specimenType === "sweat_patch" &&
    input.documentType === "coc_application"
  ) {
    return false;
  }
  return true;
}

/**
 * Companion predicate for the TestOrder.collectionDate write that
 * accompanies the auto-advance. Today the CoC upload also writes the
 * confirmed collection date onto the order; under the Option A
 * carve-out, the Application CoC does NOT yet have a meaningful
 * "collection date" for a sweat patch (collection happens at removal).
 * Removal CoC and non-patch CoCs continue to set collectionDate.
 */
export function shouldWriteCollectionDateOnCocUpload(input: {
  documentType: DocumentType;
  specimenType: SpecimenType;
}): boolean {
  return !(
    input.specimenType === "sweat_patch" &&
    input.documentType === "coc_application"
  );
}

import { describe, expect, it } from "vitest";
import {
  shouldAutoAdvanceOnCocUpload,
  shouldWriteCollectionDateOnCocUpload,
} from "./cocAdvanceRule";

/**
 * Regression tests for the CoC-upload auto-advance rule.
 *
 * The behavior under test is what gates the testStatus + collectionDate
 * writes inside src/app/api/cases/[id]/documents/route.ts' CoC-commit
 * block. Pure unit tests here; integration coverage lives in dev-branch
 * walkthrough. Reflects the Option A carve-out (2026-05): sweat-patch
 * Application CoC uploads no longer auto-advance the order, because the
 * patch has been applied but the specimen hasn't been collected yet.
 */

describe("shouldAutoAdvanceOnCocUpload", () => {
  it("advances a non-patch CoC at order_created (regression baseline)", () => {
    expect(
      shouldAutoAdvanceOnCocUpload({
        documentType: "chain_of_custody",
        currentTestStatus: "order_created",
        specimenType: "urine",
      }),
    ).toBe(true);
  });

  it("does NOT advance a sweat-patch coc_application at order_created (Option A)", () => {
    expect(
      shouldAutoAdvanceOnCocUpload({
        documentType: "coc_application",
        currentTestStatus: "order_created",
        specimenType: "sweat_patch",
      }),
    ).toBe(false);
  });

  it("advances a sweat-patch coc_removal at order_created (removal still triggers)", () => {
    expect(
      shouldAutoAdvanceOnCocUpload({
        documentType: "coc_removal",
        currentTestStatus: "order_created",
        specimenType: "sweat_patch",
      }),
    ).toBe(true);
  });

  it("does not advance from non-pre-collection statuses", () => {
    // Sanity: once an order is past order_created/awaiting_payment/
    // payment_received, a CoC upload should never roll it back or
    // re-trigger the advance.
    expect(
      shouldAutoAdvanceOnCocUpload({
        documentType: "chain_of_custody",
        currentTestStatus: "sent_to_lab",
        specimenType: "urine",
      }),
    ).toBe(false);
    expect(
      shouldAutoAdvanceOnCocUpload({
        documentType: "coc_removal",
        currentTestStatus: "specimen_collected",
        specimenType: "sweat_patch",
      }),
    ).toBe(false);
  });

  it("advances a non-patch coc_application (carve-out is patch-specific)", () => {
    // coc_application was added for sweat patches in PR #47 but the
    // enum value isn't patch-only. If a non-patch order ever carried
    // a coc_application document type, it should advance normally.
    expect(
      shouldAutoAdvanceOnCocUpload({
        documentType: "coc_application",
        currentTestStatus: "order_created",
        specimenType: "urine",
      }),
    ).toBe(true);
  });
});

describe("shouldWriteCollectionDateOnCocUpload", () => {
  it("writes collectionDate for non-patch CoCs", () => {
    expect(
      shouldWriteCollectionDateOnCocUpload({
        documentType: "chain_of_custody",
        specimenType: "urine",
      }),
    ).toBe(true);
  });

  it("skips collectionDate for sweat-patch coc_application", () => {
    expect(
      shouldWriteCollectionDateOnCocUpload({
        documentType: "coc_application",
        specimenType: "sweat_patch",
      }),
    ).toBe(false);
  });

  it("writes collectionDate for sweat-patch coc_removal", () => {
    expect(
      shouldWriteCollectionDateOnCocUpload({
        documentType: "coc_removal",
        specimenType: "sweat_patch",
      }),
    ).toBe(true);
  });
});

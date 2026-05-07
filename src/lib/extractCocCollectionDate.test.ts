import { describe, it, expect } from "vitest";
import { matchPrintedCollectionDate } from "./extractCocCollectionDate";

// These tests cover the text-mode label matcher only — the deterministic
// half of the extractor. The Vision fallback is exercised in manual
// verification against real PharmChek forms (no automated coverage; same
// gap as the rest of the route).

describe("matchPrintedCollectionDate — working_copy mode (default)", () => {
  it("matches 'Date Collected: 04/21/2026' (USDTL CCF style)", () => {
    expect(matchPrintedCollectionDate("Date Collected: 04/21/2026")).toBe(
      "2026-04-21",
    );
  });

  it("matches 'Collection Date 2026-04-21' (ISO)", () => {
    expect(matchPrintedCollectionDate("Collection Date 2026-04-21")).toBe(
      "2026-04-21",
    );
  });

  it("matches 'Date of Collection 4/21/26' (2-digit year)", () => {
    expect(matchPrintedCollectionDate("Date of Collection 4/21/26")).toBe(
      "2026-04-21",
    );
  });

  it("returns null when no collection-date label is present", () => {
    expect(matchPrintedCollectionDate("Patient: John Doe   DOB: 01/15/1980")).toBeNull();
  });

  it("does NOT match removal-date labels in working_copy mode", () => {
    expect(
      matchPrintedCollectionDate("Removal Date: 04/22/2026", "working_copy"),
    ).toBeNull();
  });

  it("returns null for malformed dates (month=13)", () => {
    expect(matchPrintedCollectionDate("Date Collected: 13/45/2026")).toBeNull();
  });

  it("explicit working_copy mode matches collection labels (parameter pass-through)", () => {
    expect(
      matchPrintedCollectionDate("Date Collected: 04/21/2026", "working_copy"),
    ).toBe("2026-04-21");
  });
});

describe("matchPrintedCollectionDate — executed mode", () => {
  it("matches 'Removal Date: 04/22/2026'", () => {
    expect(
      matchPrintedCollectionDate("Removal Date: 04/22/2026", "executed"),
    ).toBe("2026-04-22");
  });

  it("matches 'Date Removed 2026-04-22'", () => {
    expect(
      matchPrintedCollectionDate("Date Removed 2026-04-22", "executed"),
    ).toBe("2026-04-22");
  });

  it("matches 'Date of Removal 4/22/26' (2-digit year)", () => {
    expect(
      matchPrintedCollectionDate("Date of Removal 4/22/26", "executed"),
    ).toBe("2026-04-22");
  });

  it("matches 'Patch Removal Date: 04/22/2026'", () => {
    expect(
      matchPrintedCollectionDate("Patch Removal Date: 04/22/2026", "executed"),
    ).toBe("2026-04-22");
  });

  it("does NOT match collection-date labels in executed mode", () => {
    expect(
      matchPrintedCollectionDate("Date Collected: 04/15/2026", "executed"),
    ).toBeNull();
  });

  it("returns null when no removal-date label is present", () => {
    expect(
      matchPrintedCollectionDate("PharmChek Application 4/15/26", "executed"),
    ).toBeNull();
  });

  it("isolates removal date when both labels appear in the text", () => {
    // Realistic case: a typed PharmChek where both sections have dates.
    const text =
      "PharmChek Application Date: 04/15/2026\nPharmChek Removal\nRemoval Date: 04/22/2026";
    expect(matchPrintedCollectionDate(text, "executed")).toBe("2026-04-22");
    expect(matchPrintedCollectionDate(text, "working_copy")).toBeNull();
  });
});

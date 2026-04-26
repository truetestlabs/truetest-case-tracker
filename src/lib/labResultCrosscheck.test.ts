import { describe, expect, it } from "vitest";
import {
  runLabResultCrosschecks,
  type TestOrderSnapshot,
} from "./labResultCrosscheck";
import type { ExtractedLabResult } from "./resultExtract";

/**
 * Tests focus on:
 *   1. Backward compatibility — existing callers without `patchDetails`
 *      keep working and don't get patch-specific findings.
 *   2. Specimen ID prefix tolerance via specimenIdsMatch — the CRL
 *      "X" prefix should no longer false-flag.
 *   3. Each new patch-specific MismatchType fires in the right
 *      conditions (and only in the right conditions).
 *
 * Date math reminder: dates here are constructed via the same pattern
 * the codebase uses for date-picker values (noon UTC, which lands
 * unambiguously in the corresponding Chicago day under CDT).
 */

// Minimal extracted result with just the fields used by the crosscheck.
// Cast through unknown so we don't have to populate every optional
// ExtractedLabResult field for each test.
function extracted(
  partial: Partial<ExtractedLabResult>,
): ExtractedLabResult {
  return partial as unknown as ExtractedLabResult;
}

describe("runLabResultCrosschecks — backward compatibility", () => {
  it("returns no patch findings when patchDetails is absent", () => {
    const order: TestOrderSnapshot = {
      collectionDate: new Date("2026-04-15T12:00:00Z"),
      specimenId: "12345",
      labAccessionNumber: null,
    };
    const result = extracted({
      reportedCollectionDate: "2026-04-15",
      labSpecimenId: "12345",
    });
    const findings = runLabResultCrosschecks(result, order);
    expect(findings).toEqual([]);
  });

  it("returns no patch findings when patchDetails is null", () => {
    const order: TestOrderSnapshot = {
      collectionDate: new Date("2026-04-15T12:00:00Z"),
      specimenId: "12345",
      labAccessionNumber: null,
      patchDetails: null,
    };
    const result = extracted({ reportedCollectionDate: "2026-04-15" });
    const findings = runLabResultCrosschecks(result, order);
    expect(findings).toEqual([]);
  });
});

describe("runLabResultCrosschecks — specimen ID prefix tolerance", () => {
  // Pre-existing behavior: lab IDs that don't match our IDs raise a
  // CRITICAL finding. The change here is that "X12345" should now be
  // treated as matching "12345" thanks to specimenIdsMatch.
  const baseOrder: TestOrderSnapshot = {
    collectionDate: null,
    specimenId: "12345",
    labAccessionNumber: null,
  };

  it("does NOT flag when lab adds X prefix", () => {
    const findings = runLabResultCrosschecks(
      extracted({ labSpecimenId: "X12345" }),
      baseOrder,
    );
    expect(findings.find((f) => f.type === "specimen_id")).toBeUndefined();
  });

  it("does NOT flag when our ID has X prefix and lab's doesn't", () => {
    const findings = runLabResultCrosschecks(
      extracted({ labSpecimenId: "12345" }),
      { ...baseOrder, specimenId: "X12345" },
    );
    expect(findings.find((f) => f.type === "specimen_id")).toBeUndefined();
  });

  it("STILL flags when numeric bodies differ", () => {
    const findings = runLabResultCrosschecks(
      extracted({ labSpecimenId: "X99999" }),
      baseOrder,
    );
    const f = findings.find((f) => f.type === "specimen_id");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("critical");
  });

  it("matches against labAccessionNumber too (either-or)", () => {
    const findings = runLabResultCrosschecks(
      extracted({ labSpecimenId: "X-ACC-77" }),
      { ...baseOrder, specimenId: "12345", labAccessionNumber: "ACC-77" },
    );
    expect(findings.find((f) => f.type === "specimen_id")).toBeUndefined();
  });
});

describe("runLabResultCrosschecks — patch_application_date", () => {
  it("flags CRITICAL when application is after lab's reported collection", () => {
    const order: TestOrderSnapshot = {
      collectionDate: null,
      specimenId: null,
      labAccessionNumber: null,
      patchDetails: {
        applicationDate: new Date("2026-04-10T12:00:00Z"), // Apr 10
        removalDate: new Date("2026-04-17T12:00:00Z"), // Apr 17
        panel: "WA07",
      },
    };
    // Lab reports collection on Apr 8 — before our application of Apr 10
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-08" }),
      order,
    );
    const f = findings.find((f) => f.type === "patch_application_date");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("critical");
  });

  it("does NOT flag when application equals lab collection (boundary)", () => {
    const order: TestOrderSnapshot = {
      collectionDate: null,
      specimenId: null,
      labAccessionNumber: null,
      patchDetails: {
        applicationDate: new Date("2026-04-15T12:00:00Z"),
        removalDate: null,
        panel: "WA07",
      },
    };
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-15" }),
      order,
    );
    expect(
      findings.find((f) => f.type === "patch_application_date"),
    ).toBeUndefined();
  });
});

describe("runLabResultCrosschecks — patch_removal_date", () => {
  it("flags WARNING when removal is after lab's reported collection", () => {
    const order: TestOrderSnapshot = {
      collectionDate: null,
      specimenId: null,
      labAccessionNumber: null,
      patchDetails: {
        applicationDate: new Date("2026-04-10T12:00:00Z"),
        removalDate: new Date("2026-04-20T12:00:00Z"),
        panel: "WA07",
      },
    };
    // Lab says they collected Apr 17 but we say we removed Apr 20
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-17" }),
      order,
    );
    const f = findings.find((f) => f.type === "patch_removal_date");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("warning");
  });

  it("does NOT fire when removal date is null", () => {
    const order: TestOrderSnapshot = {
      collectionDate: null,
      specimenId: null,
      labAccessionNumber: null,
      patchDetails: {
        applicationDate: new Date("2026-04-10T12:00:00Z"),
        removalDate: null,
        panel: "WA07",
      },
    };
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-17" }),
      order,
    );
    expect(
      findings.find((f) => f.type === "patch_removal_date"),
    ).toBeUndefined();
  });
});

describe("runLabResultCrosschecks — patch_wear_days", () => {
  const baseOrder = {
    collectionDate: null,
    specimenId: null,
    labAccessionNumber: null,
  } as const;

  it("flags INFO when wear is 0 days (same-day apply/remove)", () => {
    const order: TestOrderSnapshot = {
      ...baseOrder,
      patchDetails: {
        applicationDate: new Date("2026-04-15T12:00:00Z"),
        removalDate: new Date("2026-04-15T18:00:00Z"),
        panel: "WA07",
      },
    };
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-16" }),
      order,
    );
    const f = findings.find((f) => f.type === "patch_wear_days");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("info");
  });

  it("flags WARNING when wear is >14 days", () => {
    const order: TestOrderSnapshot = {
      ...baseOrder,
      patchDetails: {
        applicationDate: new Date("2026-04-01T12:00:00Z"),
        removalDate: new Date("2026-04-20T12:00:00Z"), // 19 days
        panel: "WA07",
      },
    };
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-21" }),
      order,
    );
    const f = findings.find((f) => f.type === "patch_wear_days");
    expect(f).toBeDefined();
    expect(f?.severity).toBe("warning");
  });

  it("does NOT fire for typical 7-day wear", () => {
    const order: TestOrderSnapshot = {
      ...baseOrder,
      patchDetails: {
        applicationDate: new Date("2026-04-08T12:00:00Z"),
        removalDate: new Date("2026-04-15T12:00:00Z"), // 7 days
        panel: "WA07",
      },
    };
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-16" }),
      order,
    );
    expect(
      findings.find((f) => f.type === "patch_wear_days"),
    ).toBeUndefined();
  });

  it("does NOT fire on the band boundary (14 days exactly)", () => {
    const order: TestOrderSnapshot = {
      ...baseOrder,
      patchDetails: {
        applicationDate: new Date("2026-04-01T12:00:00Z"),
        removalDate: new Date("2026-04-15T12:00:00Z"), // 14 days
        panel: "WA07",
      },
    };
    const findings = runLabResultCrosschecks(
      extracted({ reportedCollectionDate: "2026-04-16" }),
      order,
    );
    expect(
      findings.find((f) => f.type === "patch_wear_days"),
    ).toBeUndefined();
  });
});

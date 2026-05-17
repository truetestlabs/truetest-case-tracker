import { describe, expect, it } from "vitest";
import {
  PATCH_WEAR_THRESHOLDS,
  computeWearDays,
  computeWearStatus,
  wearBadgeFor,
  patchLifecycleStatus,
  isPatchClosed,
  requiresApplicationCocFirst,
  patchProgressStage,
  validatePatchDates,
  stripNonDigitPrefix,
  specimenIdsMatch,
} from "./patchValidation";

// Notes on date construction:
// - Tests use UTC ISO strings, but the helpers bucket by CHICAGO
//   calendar day. April is CDT (UTC-5), so 12:00 UTC = 7am Chicago,
//   00:00 UTC = 7pm Chicago the prior day. We deliberately mix both
//   to exercise the "UTC instant lands in different Chicago day"
//   edge — that's the whole point of using Chicago-local diff.
// - In CDT, the Chicago day flips at 05:00 UTC. So 04:00 UTC and
//   06:00 UTC on the same UTC date sit in different Chicago days.

describe("PATCH_WEAR_THRESHOLDS", () => {
  // Locked design constants — don't drift without product approval.
  // If you're updating these, also update wear-day status callers and
  // the locked-decisions table in the handoff doc.
  it("matches the locked thresholds", () => {
    expect(PATCH_WEAR_THRESHOLDS.neutralMax).toBe(6);
    expect(PATCH_WEAR_THRESHOLDS.yellowMax).toBe(9);
    expect(PATCH_WEAR_THRESHOLDS.orangeMax).toBe(29);
    expect(PATCH_WEAR_THRESHOLDS.expiredCancelMin).toBe(30);
  });
});

describe("computeWearDays", () => {
  it("is 0 when application is today (UTC same day, different hour)", () => {
    const a = new Date("2026-04-25T08:00:00Z");
    const b = new Date("2026-04-25T22:30:00Z");
    expect(computeWearDays(a, b)).toBe(0);
  });

  it("is 1 across a single Chicago midnight even when both UTC dates match", () => {
    // Both these instants fall on UTC date 2026-04-26, but they sit on
    // either side of the Chicago midnight (05:00 UTC during CDT).
    //   04:00 UTC = 23:00 Chicago Apr 25
    //   06:00 UTC = 01:00 Chicago Apr 26
    // Chicago diff = 1 day. (UTC-truncated diff would say 0.)
    const a = new Date("2026-04-26T04:00:00Z"); // 11pm Chicago Apr 25
    const b = new Date("2026-04-26T06:00:00Z"); // 1am Chicago Apr 26
    expect(computeWearDays(a, b)).toBe(1);
  });

  it("is 0 across a single UTC midnight when both fall in the same Chicago day", () => {
    // Inverse of the above: Chicago Apr 25 from 6pm to 8pm spans a UTC
    // midnight but stays in one Chicago day. Demonstrates the helper
    // is bucketing Chicago-local, not UTC-local.
    const a = new Date("2026-04-25T23:00:00Z"); // 6pm Chicago Apr 25
    const b = new Date("2026-04-26T01:00:00Z"); // 8pm Chicago Apr 25
    expect(computeWearDays(a, b)).toBe(0);
  });

  it("is 7 for a standard week of wear", () => {
    const a = new Date("2026-04-01T12:00:00Z");
    const b = new Date("2026-04-08T06:00:00Z");
    expect(computeWearDays(a, b)).toBe(7);
  });

  it("clamps negative diffs (asOf before application) to 0", () => {
    const a = new Date("2026-04-25T00:00:00Z");
    const b = new Date("2026-04-20T00:00:00Z");
    expect(computeWearDays(a, b)).toBe(0);
  });

  it("crosses month and year boundaries correctly", () => {
    const a = new Date("2025-12-30T00:00:00Z");
    const b = new Date("2026-01-04T00:00:00Z");
    expect(computeWearDays(a, b)).toBe(5);
  });
});

describe("computeWearStatus", () => {
  it("returns neutral for 0–6 days", () => {
    for (const d of [0, 1, 3, 5, 6]) {
      expect(computeWearStatus(d)).toBe("neutral");
    }
  });

  it("returns yellow for 7–9 days", () => {
    for (const d of [7, 8, 9]) {
      expect(computeWearStatus(d)).toBe("yellow");
    }
  });

  it("returns orange for 10–29 days", () => {
    for (const d of [10, 15, 29]) {
      expect(computeWearStatus(d)).toBe("orange");
    }
  });

  it("returns red for 30+ days", () => {
    for (const d of [30, 60, 365]) {
      expect(computeWearStatus(d)).toBe("red");
    }
  });

  it("transitions exactly at the threshold boundaries", () => {
    expect(computeWearStatus(6)).toBe("neutral");
    expect(computeWearStatus(7)).toBe("yellow");
    expect(computeWearStatus(9)).toBe("yellow");
    expect(computeWearStatus(10)).toBe("orange");
    expect(computeWearStatus(29)).toBe("orange");
    expect(computeWearStatus(30)).toBe("red");
  });
});

describe("wearBadgeFor", () => {
  const now = new Date("2026-04-25T12:00:00Z");

  it("returns no_application when applicationDate is null and no cancellation", () => {
    const badge = wearBadgeFor(
      {
        applicationDate: null,
        removalDate: null,
        cancellationKind: null,
        cancelledAt: null,
      },
      now,
    );
    expect(badge).toEqual({ kind: "no_application" });
  });

  it("returns cancelled regardless of removal/application state", () => {
    const cancelledAt = new Date("2026-04-23T00:00:00Z");
    const badge = wearBadgeFor(
      {
        applicationDate: new Date("2026-04-10T00:00:00Z"),
        removalDate: new Date("2026-04-23T00:00:00Z"),
        cancellationKind: "expired",
        cancelledAt,
      },
      now,
    );
    expect(badge).toEqual({
      kind: "cancelled",
      reason: "expired",
      at: cancelledAt,
    });
  });

  it("handles legacy cancellation rows where cancelledAt is null", () => {
    const badge = wearBadgeFor(
      {
        applicationDate: new Date("2026-04-10T00:00:00Z"),
        removalDate: null,
        cancellationKind: "lab_cancelled",
        cancelledAt: null,
      },
      now,
    );
    expect(badge).toEqual({
      kind: "cancelled",
      reason: "lab_cancelled",
      at: null,
    });
  });

  it("returns removed (with wear-days frozen at removal time)", () => {
    const applied = new Date("2026-04-15T00:00:00Z");
    const removed = new Date("2026-04-22T00:00:00Z");
    const badge = wearBadgeFor(
      {
        applicationDate: applied,
        removalDate: removed,
        cancellationKind: null,
        cancelledAt: null,
      },
      now,
    );
    expect(badge).toEqual({ kind: "removed", removedAt: removed, wearDays: 7 });
  });

  it("returns wearing with live status when in-flight", () => {
    const applied = new Date("2026-04-23T08:00:00Z"); // 2 days before now
    const badge = wearBadgeFor(
      {
        applicationDate: applied,
        removalDate: null,
        cancellationKind: null,
        cancelledAt: null,
      },
      now,
    );
    expect(badge).toEqual({ kind: "wearing", days: 2, status: "neutral" });
  });

  it("escalates wearing status as days pass", () => {
    // Use noon UTC for the applied dates so they sit unambiguously in
    // the corresponding Chicago calendar day (07:00 Chicago CDT in April,
    // 06:00 Chicago CST in March — both far from the day boundary).
    // `now` is Chicago Apr 25 (07:00 Chicago).
    const cases: Array<{ applied: string; expected: string }> = [
      { applied: "2026-04-19T12:00:00Z", expected: "neutral" }, // 6 days
      { applied: "2026-04-18T12:00:00Z", expected: "yellow" }, // 7 days
      { applied: "2026-04-15T12:00:00Z", expected: "orange" }, // 10 days
      { applied: "2026-03-26T12:00:00Z", expected: "red" }, // 30 days
    ];
    for (const c of cases) {
      const badge = wearBadgeFor(
        {
          applicationDate: new Date(c.applied),
          removalDate: null,
          cancellationKind: null,
          cancelledAt: null,
        },
        now,
      );
      expect(badge.kind).toBe("wearing");
      if (badge.kind === "wearing") expect(badge.status).toBe(c.expected);
    }
  });
});

describe("validatePatchDates", () => {
  const asOf = new Date("2026-04-25T12:00:00Z");

  it("returns no errors when both dates are absent", () => {
    expect(validatePatchDates({ asOf })).toEqual([]);
  });

  it("returns no errors for valid past application + same-day-or-later removal", () => {
    expect(
      validatePatchDates({
        applicationDate: new Date("2026-04-18T00:00:00Z"),
        removalDate: new Date("2026-04-25T00:00:00Z"),
        asOf,
      }),
    ).toEqual([]);
  });

  it("allows same-day application and removal (immediate removal scenario)", () => {
    expect(
      validatePatchDates({
        applicationDate: new Date("2026-04-25T08:00:00Z"),
        removalDate: new Date("2026-04-25T16:00:00Z"),
        asOf,
      }),
    ).toEqual([]);
  });

  it("flags future application date (Chicago-local)", () => {
    // Chicago noon Apr 26 = 17:00 UTC Apr 26. asOf is Chicago Apr 25,
    // so this is one Chicago day in the future.
    const errs = validatePatchDates({
      applicationDate: new Date("2026-04-26T17:00:00Z"),
      asOf,
    });
    expect(errs).toContain("Application date cannot be in the future.");
  });

  it("flags future removal date (Chicago-local)", () => {
    const errs = validatePatchDates({
      removalDate: new Date("2026-04-30T17:00:00Z"),
      asOf,
    });
    expect(errs).toContain("Removal date cannot be in the future.");
  });

  it("does NOT flag late-night-Chicago dates that look like UTC tomorrow", () => {
    // 2026-04-26T03:00:00Z is 22:00 Chicago Apr 25 — same Chicago day
    // as asOf (Chicago Apr 25). UTC-truncated logic would falsely flag
    // this as "tomorrow"; Chicago-local logic correctly accepts it.
    expect(
      validatePatchDates({
        applicationDate: new Date("2026-04-26T03:00:00Z"),
        asOf,
      }),
    ).toEqual([]);
  });

  it("flags removal-before-application", () => {
    const errs = validatePatchDates({
      applicationDate: new Date("2026-04-20T00:00:00Z"),
      removalDate: new Date("2026-04-15T00:00:00Z"),
      asOf,
    });
    expect(errs).toContain("Removal date cannot be before application date.");
  });

  it("aggregates multiple errors", () => {
    // Use noon UTC so both clearly land in their visible Chicago dates.
    const errs = validatePatchDates({
      applicationDate: new Date("2026-04-30T17:00:00Z"), // future Chicago Apr 30
      removalDate: new Date("2026-05-15T17:00:00Z"), // future Chicago May 15
      asOf,
    });
    expect(errs.length).toBeGreaterThanOrEqual(2);
    expect(errs).toContain("Application date cannot be in the future.");
    expect(errs).toContain("Removal date cannot be in the future.");
  });
});

describe("stripNonDigitPrefix", () => {
  it("strips a single leading X (the CRL convention)", () => {
    expect(stripNonDigitPrefix("X12345")).toBe("12345");
  });

  it("strips multi-character non-digit prefixes", () => {
    expect(stripNonDigitPrefix("LAB-12345")).toBe("12345");
  });

  it("trims surrounding whitespace before stripping", () => {
    expect(stripNonDigitPrefix("  X12345  ")).toBe("12345");
  });

  it("returns input unchanged when it already starts with a digit", () => {
    expect(stripNonDigitPrefix("12345")).toBe("12345");
  });

  it("returns empty string for all-non-digit input", () => {
    expect(stripNonDigitPrefix("XYZ")).toBe("");
    expect(stripNonDigitPrefix("X")).toBe("");
  });

  it("does not strip non-digits embedded mid-string", () => {
    expect(stripNonDigitPrefix("X12-345")).toBe("12-345");
  });
});

describe("specimenIdsMatch", () => {
  it("matches when only one side has the X prefix", () => {
    expect(specimenIdsMatch("12345", "X12345")).toBe(true);
    expect(specimenIdsMatch("X12345", "12345")).toBe(true);
  });

  it("matches when both sides have prefixes (different prefixes too)", () => {
    expect(specimenIdsMatch("X12345", "LAB-12345")).toBe(true);
  });

  it("does not match different numeric bodies", () => {
    expect(specimenIdsMatch("12345", "12346")).toBe(false);
  });

  it("returns false for nullish inputs (no false-positive on missing IDs)", () => {
    expect(specimenIdsMatch(null, "12345")).toBe(false);
    expect(specimenIdsMatch("12345", null)).toBe(false);
    expect(specimenIdsMatch(null, null)).toBe(false);
    expect(specimenIdsMatch(undefined, "12345")).toBe(false);
    expect(specimenIdsMatch("", "12345")).toBe(false);
  });

  it("returns false when stripping leaves either side empty", () => {
    // "X" alone strips to "", so even matching all-junk shouldn't count.
    expect(specimenIdsMatch("X", "X")).toBe(false);
    expect(specimenIdsMatch("X", "12345")).toBe(false);
  });

  it("tolerates whitespace around the IDs", () => {
    expect(specimenIdsMatch("  X12345  ", "12345")).toBe(true);
  });
});

describe("patchLifecycleStatus", () => {
  const D = new Date("2026-04-20T12:00:00Z");
  const REMOVED = new Date("2026-04-27T12:00:00Z");

  it("returns null when applicationDate is missing", () => {
    expect(
      patchLifecycleStatus({
        applicationDate: null,
        cancellationKind: null,
        removalDate: null,
        hasLabResult: false,
      }),
    ).toBeNull();
  });

  it("returns CANCELLED when cancellationKind is set, regardless of other fields", () => {
    // Cancellation precedence: covers each kind and verifies that
    // removalDate / hasLabResult downstream signals don't override it.
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: "cancelled",
        removalDate: REMOVED,
        hasLabResult: true,
      }),
    ).toBe("CANCELLED");
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: "lab_cancelled",
        removalDate: null,
        hasLabResult: false,
      }),
    ).toBe("CANCELLED");
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: "expired",
        removalDate: null,
        hasLabResult: false,
      }),
    ).toBe("CANCELLED");
  });

  it("returns CANCELLED even when applicationDate is null but cancellation is stamped", () => {
    // A patch can be cancelled before it was ever applied (e.g., staff
    // notes a bad batch). Cancellation takes precedence over the
    // null-applicationDate "no badge" rule.
    expect(
      patchLifecycleStatus({
        applicationDate: null,
        cancellationKind: "cancelled",
        removalDate: null,
        hasLabResult: false,
      }),
    ).toBe("CANCELLED");
  });

  it("returns WORN when applied but no removalDate and no results", () => {
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: null,
        removalDate: null,
        hasLabResult: false,
      }),
    ).toBe("WORN");
  });

  it("returns AT_LAB when removalDate is set but no lab result yet", () => {
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: null,
        removalDate: REMOVED,
        hasLabResult: false,
      }),
    ).toBe("AT_LAB");
  });

  it("stays AT_LAB when a lab result exists but removalDate is null", () => {
    // COMPLETE requires BOTH a LabResult and a removalDate. A result
    // without the corresponding removal CoC is an incomplete record —
    // surfacing as AT_LAB forces staff to investigate the missing
    // removal date rather than silently promoting to COMPLETE.
    //
    // Backward-compat: covers the historical population (17 prod rows
    // as of 2026-05-17) of patches that have lab results but never had
    // removalDate set — these continue to render as AT_LAB.
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: null,
        removalDate: null,
        hasLabResult: true,
      }),
    ).toBe("AT_LAB");
  });

  it("returns COMPLETE only when removalDate AND lab result are both present", () => {
    expect(
      patchLifecycleStatus({
        applicationDate: D,
        cancellationKind: null,
        removalDate: REMOVED,
        hasLabResult: true,
      }),
    ).toBe("COMPLETE");
  });

  it("walks the full happy-path transition: null → WORN → AT_LAB → COMPLETE", () => {
    // Single test case marching one field at a time, so a regression
    // that breaks one transition surfaces with the offending step in
    // the failure message.
    const base = {
      applicationDate: null as Date | null,
      cancellationKind: null,
      removalDate: null as Date | null,
      hasLabResult: false,
    };
    expect(patchLifecycleStatus(base)).toBeNull();
    expect(
      patchLifecycleStatus({ ...base, applicationDate: D }),
    ).toBe("WORN");
    expect(
      patchLifecycleStatus({
        ...base,
        applicationDate: D,
        removalDate: REMOVED,
      }),
    ).toBe("AT_LAB");
    expect(
      patchLifecycleStatus({
        ...base,
        applicationDate: D,
        removalDate: REMOVED,
        hasLabResult: true,
      }),
    ).toBe("COMPLETE");
  });
});

describe("isPatchClosed", () => {
  // List-segregation predicate. Both signals are independent; the
  // predicate ORs them to mirror the non-patch isTerminalTest behavior.

  it("returns false when neither cancellationKind nor terminal testStatus", () => {
    expect(
      isPatchClosed({
        cancellationKind: null,
        testStatus: "specimen_collected",
      }),
    ).toBe(false);
    // Also covers a freshly-created order pre-application.
    expect(
      isPatchClosed({
        cancellationKind: null,
        testStatus: "order_created",
      }),
    ).toBe(false);
  });

  it("returns true when cancellationKind is set, regardless of testStatus", () => {
    // Cancellation is orthogonal to TestOrder.testStatus per the
    // PatchDetails schema — the order can still be in-flight by status
    // even after staff cancel the patch. Predicate must catch that.
    expect(
      isPatchClosed({
        cancellationKind: "cancelled",
        testStatus: "order_created",
      }),
    ).toBe(true);
    expect(
      isPatchClosed({
        cancellationKind: "lab_cancelled",
        testStatus: "specimen_collected",
      }),
    ).toBe(true);
    expect(
      isPatchClosed({
        cancellationKind: "expired",
        testStatus: "results_received",
      }),
    ).toBe(true);
  });

  it("returns true for each terminal testStatus when not cancelled", () => {
    for (const status of ["closed", "cancelled", "no_show"] as const) {
      expect(
        isPatchClosed({ cancellationKind: null, testStatus: status }),
      ).toBe(true);
    }
  });

  it("returns true when both signals are present", () => {
    expect(
      isPatchClosed({ cancellationKind: "expired", testStatus: "closed" }),
    ).toBe(true);
  });
});

describe("requiresApplicationCocFirst", () => {
  const D = new Date("2026-04-20T12:00:00Z");

  it("returns true for sweat-patch Removal CoC when applicationDate is null", () => {
    expect(
      requiresApplicationCocFirst({
        documentType: "coc_removal",
        specimenType: "sweat_patch",
        applicationDate: null,
      }),
    ).toBe(true);
  });

  it("returns false for sweat-patch Removal CoC when applicationDate is set", () => {
    expect(
      requiresApplicationCocFirst({
        documentType: "coc_removal",
        specimenType: "sweat_patch",
        applicationDate: D,
      }),
    ).toBe(false);
  });

  it("returns false for sweat-patch Application CoC (no ordering on the first upload)", () => {
    expect(
      requiresApplicationCocFirst({
        documentType: "coc_application",
        specimenType: "sweat_patch",
        applicationDate: null,
      }),
    ).toBe(false);
  });

  it("returns false for non-patch specimens regardless of CoC type", () => {
    // The single chain_of_custody flow has no ordering constraint.
    expect(
      requiresApplicationCocFirst({
        documentType: "coc_removal",
        specimenType: "urine",
        applicationDate: null,
      }),
    ).toBe(false);
    expect(
      requiresApplicationCocFirst({
        documentType: "chain_of_custody",
        specimenType: "hair",
        applicationDate: null,
      }),
    ).toBe(false);
  });
});

describe("patchProgressStage", () => {
  const APPLIED = new Date("2026-04-20T12:00:00Z");
  const REMOVED = new Date("2026-04-27T12:00:00Z");

  // ── Early stages: testStatus stays at a pre-collection value, dates discriminate ──

  it("returns 'ordered' when testStatus is order_created and no dates set", () => {
    // The empty-patch mis-render case — Colleen's regression. Before
    // this helper, the rail showed "Patch Applied" lit for this state.
    expect(
      patchProgressStage({
        testStatus: "order_created",
        applicationDate: null,
        removalDate: null,
      }),
    ).toBe("ordered");
  });

  it("returns 'ordered' for other pre-collection testStatus values when no dates set", () => {
    // testStatus values that all collapse to the "Ordered" stage when
    // no application has happened yet.
    for (const status of [
      "awaiting_payment",
      "payment_received",
      "order_released",
      "awaiting_collection",
    ]) {
      expect(
        patchProgressStage({
          testStatus: status,
          applicationDate: null,
          removalDate: null,
        }),
      ).toBe("ordered");
    }
  });

  it("returns 'applied' when applicationDate is set and testStatus is still order_created", () => {
    // The cocAdvanceRule carve-out: Application CoC writes
    // applicationDate but does NOT advance testStatus to
    // specimen_collected (specimen isn't collected until removal).
    // Date-driven detection is the whole point of this helper.
    expect(
      patchProgressStage({
        testStatus: "order_created",
        applicationDate: APPLIED,
        removalDate: null,
      }),
    ).toBe("applied");
  });

  it("returns 'removed' when removalDate is set (even if testStatus hasn't advanced yet)", () => {
    // Defensive: covers the narrow window during the two-step CoC
    // commit where removalDate could be written before testStatus
    // flips. Mirrors the resolver's removalDate-first preference.
    expect(
      patchProgressStage({
        testStatus: "order_created",
        applicationDate: APPLIED,
        removalDate: REMOVED,
      }),
    ).toBe("removed");
  });

  // ── Late stages: testStatus is canonical ──

  it("returns 'removed' for specimen_collected and specimen_held", () => {
    for (const status of ["specimen_collected", "specimen_held"]) {
      expect(
        patchProgressStage({
          testStatus: status,
          applicationDate: APPLIED,
          removalDate: REMOVED,
        }),
      ).toBe("removed");
    }
  });

  it("returns testStatus-matching stage for late-stage statuses", () => {
    const cases: Array<[string, string]> = [
      ["sent_to_lab", "sent_to_lab"],
      ["results_received", "results_received"],
      ["results_held", "results_received"],
      ["results_released", "results_released"],
      ["at_mro", "at_mro"],
      ["mro_released", "mro_released"],
    ];
    for (const [status, expected] of cases) {
      expect(
        patchProgressStage({
          testStatus: status,
          applicationDate: APPLIED,
          removalDate: REMOVED,
        }),
      ).toBe(expected);
    }
  });

  it("returns terminal stages for closed / cancelled / no_show", () => {
    for (const status of ["closed", "cancelled", "no_show"] as const) {
      expect(
        patchProgressStage({
          testStatus: status,
          applicationDate: APPLIED,
          removalDate: REMOVED,
        }),
      ).toBe(status);
    }
  });

  it("walks the full happy-path transition through the early stages", () => {
    // Single test marching one field at a time to keep the failure
    // message pinpointed when a regression breaks one transition.
    const base = {
      testStatus: "order_created",
      applicationDate: null as Date | null,
      removalDate: null as Date | null,
    };
    expect(patchProgressStage(base)).toBe("ordered");
    expect(
      patchProgressStage({ ...base, applicationDate: APPLIED }),
    ).toBe("applied");
    expect(
      patchProgressStage({
        ...base,
        applicationDate: APPLIED,
        removalDate: REMOVED,
      }),
    ).toBe("removed");
    expect(
      patchProgressStage({
        testStatus: "specimen_collected",
        applicationDate: APPLIED,
        removalDate: REMOVED,
      }),
    ).toBe("removed");
    expect(
      patchProgressStage({
        testStatus: "sent_to_lab",
        applicationDate: APPLIED,
        removalDate: REMOVED,
      }),
    ).toBe("sent_to_lab");
  });
});

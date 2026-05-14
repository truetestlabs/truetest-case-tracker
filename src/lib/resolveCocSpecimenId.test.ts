import { describe, it, expect } from "vitest";
import {
  resolveCocSpecimenId,
  detectCocSpecimenIdMismatch,
} from "./resolveCocSpecimenId";

describe("resolveCocSpecimenId — priority", () => {
  it("returns null when the order already has a specimenId (never overwrite)", () => {
    // Existing wins even when manual and parsed are present and different.
    expect(
      resolveCocSpecimenId({
        existing: "762296171",
        manual: "999999999",
        parsed: "888888888",
      }),
    ).toBeNull();
  });

  it("returns the manual value when no existing and manual is present", () => {
    expect(
      resolveCocSpecimenId({
        existing: null,
        manual: "762296192",
        parsed: "888888888",
      }),
    ).toBe("762296192");
  });

  it("falls back to parsed when no existing and no manual", () => {
    expect(
      resolveCocSpecimenId({
        existing: null,
        manual: null,
        parsed: "762296192",
      }),
    ).toBe("762296192");
  });

  it("returns null when no source has a value", () => {
    expect(
      resolveCocSpecimenId({
        existing: null,
        manual: null,
        parsed: null,
      }),
    ).toBeNull();
  });

  it("treats empty strings and whitespace as null", () => {
    expect(
      resolveCocSpecimenId({
        existing: "",
        manual: "   ",
        parsed: "762296192",
      }),
    ).toBe("762296192");
  });

  it("trims whitespace from the resolved value", () => {
    expect(
      resolveCocSpecimenId({
        existing: null,
        manual: "  762296192  ",
        parsed: null,
      }),
    ).toBe("762296192");
  });

  it("handles undefined inputs gracefully (route passes optional values)", () => {
    expect(
      resolveCocSpecimenId({
        existing: undefined,
        manual: undefined,
        parsed: "762296192",
      }),
    ).toBe("762296192");
  });

  it("regression: Brian Anderson case — no existing, no manual, no parsed → null update (write path safe)", () => {
    // TTL-FL-2026-0095 had specimenId null on prod, both CoCs uploaded
    // returned null parsed values (the Vision extraction failed on the
    // legacy scans). Resolver returns null → route omits the field from
    // the update spread → no crash, no overwrite, status quo.
    expect(
      resolveCocSpecimenId({
        existing: null,
        manual: null,
        parsed: null,
      }),
    ).toBeNull();
  });
});

describe("detectCocSpecimenIdMismatch", () => {
  it("both populated and equal → no mismatch", () => {
    expect(detectCocSpecimenIdMismatch("762296192", "762296192")).toBe(false);
  });

  it("both populated and different → mismatch", () => {
    expect(detectCocSpecimenIdMismatch("762296192", "762296171")).toBe(true);
  });

  it("parsed null → short-circuits to false", () => {
    expect(detectCocSpecimenIdMismatch(null, "762296192")).toBe(false);
  });

  it("reference null → short-circuits to false", () => {
    expect(detectCocSpecimenIdMismatch("762296192", null)).toBe(false);
  });

  it("both null → false", () => {
    expect(detectCocSpecimenIdMismatch(null, null)).toBe(false);
  });

  it("whitespace and empty strings are treated as null", () => {
    expect(detectCocSpecimenIdMismatch("  ", "762296192")).toBe(false);
    expect(detectCocSpecimenIdMismatch("762296192", "")).toBe(false);
  });

  it("ignores leading/trailing whitespace when comparing", () => {
    expect(detectCocSpecimenIdMismatch(" 762296192 ", "762296192")).toBe(false);
  });

  it("undefined inputs are treated as null", () => {
    expect(detectCocSpecimenIdMismatch(undefined, "762296192")).toBe(false);
    expect(detectCocSpecimenIdMismatch("762296192", undefined)).toBe(false);
  });
});

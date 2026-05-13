import { describe, it, expect } from "vitest";
import { parsePatchDateInput } from "./patchDateInput";

// vitest.setup.ts pins TZ=UTC, so outputs are deterministic regardless
// of the developer's local timezone.

describe("parsePatchDateInput", () => {
  it("treats bare YYYY-MM-DD as a Chicago calendar day and returns noon CT", () => {
    // 2026-05-13 is in CDT (UTC-5); noon CT = 17:00 UTC.
    const result = parsePatchDateInput("2026-05-13");
    expect(result?.toISOString()).toBe("2026-05-13T17:00:00.000Z");
  });

  it("handles CST (winter): noon CT = 18:00 UTC", () => {
    // 2026-01-15 is in CST (UTC-6); noon CT = 18:00 UTC.
    const result = parsePatchDateInput("2026-01-15");
    expect(result?.toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });

  it("never returns UTC midnight for bare YYYY-MM-DD (regression guard for the date-key footgun)", () => {
    const result = parsePatchDateInput("2026-05-13");
    expect(result?.getUTCHours()).not.toBe(0);
  });

  it("trusts full ISO strings with a time component", () => {
    const result = parsePatchDateInput("2026-05-13T17:00:00.000Z");
    expect(result?.toISOString()).toBe("2026-05-13T17:00:00.000Z");
  });

  it("trusts non-canonical full ISO strings", () => {
    // A Chicago-local browser running EditTestOrderModal would have
    // produced this exact value via `new Date(s + "T12:00:00").toISOString()`.
    // Accept it unchanged for compatibility with existing client writes.
    const result = parsePatchDateInput("2026-05-13T17:00:00Z");
    expect(result?.toISOString()).toBe("2026-05-13T17:00:00.000Z");
  });

  it("returns null for unparseable input", () => {
    expect(parsePatchDateInput("not a date")).toBeNull();
    expect(parsePatchDateInput("")).toBeNull();
    expect(parsePatchDateInput("2026-13-45")).toBeNull();
  });
});

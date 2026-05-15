import { describe, expect, it } from "vitest";
import {
  parseIsoDateUtcNoon,
  unlockInstantForSelection,
  utcInstantForChicagoHour,
} from "./dateChicago";

/**
 * DST correctness for `utcInstantForChicagoHour`. The notification seed
 * cron depends on this helper producing "6/8/10/12 AM Chicago local" for
 * the donor's selection day, year-round. Easy to break if anyone swaps
 * the two-pass offset resolver for a naive single-pass or forgets to
 * account for the DST transition.
 *
 * Input: UTC-midnight date-key of a Chicago calendar day.
 * Output: UTC instant at `hourCT:00` on that day.
 */
describe("utcInstantForChicagoHour", () => {
  it("maps 6 AM Chicago to 11:00 UTC during CDT (April)", () => {
    // 2026-04-27 is firmly in CDT (UTC-5).
    const dayKey = new Date("2026-04-27T00:00:00Z");
    const result = utcInstantForChicagoHour(dayKey, 6);
    expect(result.toISOString()).toBe("2026-04-27T11:00:00.000Z");
  });

  it("maps 12 PM Chicago to 17:00 UTC during CDT", () => {
    const dayKey = new Date("2026-04-27T00:00:00Z");
    const result = utcInstantForChicagoHour(dayKey, 12);
    expect(result.toISOString()).toBe("2026-04-27T17:00:00.000Z");
  });

  it("maps 6 AM Chicago to 12:00 UTC during CST (January)", () => {
    // 2026-01-15 is firmly in CST (UTC-6).
    const dayKey = new Date("2026-01-15T00:00:00Z");
    const result = utcInstantForChicagoHour(dayKey, 6);
    expect(result.toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });

  it("maps 12 PM Chicago to 18:00 UTC during CST", () => {
    const dayKey = new Date("2026-01-15T00:00:00Z");
    const result = utcInstantForChicagoHour(dayKey, 12);
    expect(result.toISOString()).toBe("2026-01-15T18:00:00.000Z");
  });

  it("handles the day after spring-forward (CDT active from 3 AM onward)", () => {
    // 2026-03-09 — the day after spring-forward on 2026-03-08. Chicago is
    // firmly in CDT at 6 AM local.
    const dayKey = new Date("2026-03-09T00:00:00Z");
    const result = utcInstantForChicagoHour(dayKey, 6);
    expect(result.toISOString()).toBe("2026-03-09T11:00:00.000Z");
  });

  it("handles the day after fall-back (CST active)", () => {
    // 2026-11-02 — the day after fall-back on 2026-11-01. Chicago is on CST.
    const dayKey = new Date("2026-11-02T00:00:00Z");
    const result = utcInstantForChicagoHour(dayKey, 6);
    expect(result.toISOString()).toBe("2026-11-02T12:00:00.000Z");
  });

  it("backward-compat: unlockInstantForSelection still returns 4 AM CT", () => {
    // Spot-check the delegating wrapper for both seasons.
    const cdtDay = new Date("2026-04-27T00:00:00Z");
    expect(unlockInstantForSelection(cdtDay).toISOString()).toBe("2026-04-27T09:00:00.000Z");
    const cstDay = new Date("2026-01-15T00:00:00Z");
    expect(unlockInstantForSelection(cstDay).toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });
});

/**
 * Guard the date-only form-input parser used by EditTestOrderModal and the
 * documents upload route. The whole point of this helper is to be
 * TZ-independent: it uses `Date.UTC` internally so the result is the same
 * regardless of `process.env.TZ` or the browser's local zone. The bug it
 * replaces — `new Date(s + "T12:00:00").toISOString()` — parses the string
 * in the local zone, so a Denver developer's "2026-05-15" lands at 1 PM
 * Chicago (or 6 PM UTC) instead of noon Chicago, which shifts the calendar
 * day display in some downstream formatters.
 */
describe("parseIsoDateUtcNoon", () => {
  it("parses YYYY-MM-DD to noon UTC of that calendar day (TZ-independent)", () => {
    expect(parseIsoDateUtcNoon("2026-05-15")?.toISOString()).toBe(
      "2026-05-15T12:00:00.000Z",
    );
  });
});

import { utcInstantForChicagoHour } from "@/lib/dateChicago";

/**
 * Parse a client-supplied patch date (applicationDate, removalDate, or
 * replacementPatchDate) into the canonical PatchDetails storage shape:
 * noon America/Chicago serialized as a UTC instant.
 *
 * Two input shapes accepted:
 *   1. Bare `YYYY-MM-DD` (typical `<input type="date">` value): treated
 *      as a Chicago calendar day. Returns the UTC instant for noon CT on
 *      that day — DST-correct and TZ-independent (so the server can run
 *      under TZ=UTC and still produce the same value a Chicago-local
 *      browser would).
 *   2. Full ISO with a time component (e.g.
 *      `2026-05-13T17:00:00.000Z`): trusted as-is. Matches what
 *      EditTestOrderModal.tsx serializes via
 *      `new Date(s + "T12:00:00").toISOString()` — that pattern produces
 *      a correct noon-CT instant only on a Chicago-local browser. New
 *      server-side callers should prefer the bare-date form.
 *
 * Returns null on unparseable input. Callers should respond 400.
 *
 * See `prisma/schema.prisma` PatchDetails date-field comments for the
 * storage-convention rationale.
 */
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parsePatchDateInput(input: string): Date | null {
  if (ISO_DATE_ONLY.test(input)) {
    const [y, m, d] = input.split("-").map((n) => parseInt(n, 10));
    // Round-trip check: reject overflow nonsense like "2026-13-45" that
    // JS Date silently normalizes into a valid future date.
    const utcMidnight = new Date(Date.UTC(y, m - 1, d));
    if (
      utcMidnight.getUTCFullYear() !== y ||
      utcMidnight.getUTCMonth() !== m - 1 ||
      utcMidnight.getUTCDate() !== d
    ) {
      return null;
    }
    return utcInstantForChicagoHour(utcMidnight, 12);
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resolve which specimen ID value should land on TestOrder.specimenId
 * after a CoC upload, given three potential sources:
 *
 *   - existing: TestOrder.specimenId in the DB right now. If set, it
 *     was confirmed by an operator on a previous upload — NEVER
 *     overwrite. Returning `null` here means "no change."
 *   - manual: the value the operator typed (or edited) in the CoC
 *     confirmation modal. Wins over the extracted value because the
 *     operator's eyes-on confirmation outranks AI extraction.
 *   - parsed: what `extractCocSpecimenId` pulled out of the PDF.
 *     Falls back to this when the operator didn't override and the
 *     order doesn't already have a value.
 *
 * Returns:
 *   - `null` to mean "do not update the TestOrder.specimenId field"
 *     (either because the order already has one, or no candidate
 *     value is available).
 *   - A string when the field should be updated with that value.
 *
 * Whitespace is trimmed on the inputs before comparison; empty strings
 * are treated as null. The function does NOT validate format (9-digit
 * CRL pattern) — that's the extractor's responsibility upstream, and
 * the operator can override anyway.
 */
export function resolveCocSpecimenId(input: {
  existing: string | null | undefined;
  manual: string | null | undefined;
  parsed: string | null | undefined;
}): string | null {
  const existing = input.existing?.trim() || null;
  if (existing) return null; // already set — preserve

  const manual = input.manual?.trim() || null;
  if (manual) return manual;

  const parsed = input.parsed?.trim() || null;
  if (parsed) return parsed;

  return null;
}

/**
 * Detect a specimen-ID mismatch between the PDF (AI-extracted) and the
 * existing reference value on the order. Returns true ONLY when both
 * values are present AND differ. Either side missing short-circuits to
 * false — we can't claim a mismatch when one of the values is unknown.
 *
 * Whitespace is trimmed before comparison; empty strings are treated as
 * missing.
 */
export function detectCocSpecimenIdMismatch(
  parsed: string | null | undefined,
  reference: string | null | undefined,
): boolean {
  const p = parsed?.trim() || null;
  const r = reference?.trim() || null;
  if (!p || !r) return false;
  return p !== r;
}

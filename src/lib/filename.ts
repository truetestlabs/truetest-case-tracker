/**
 * Filename helpers for document uploads (CCF chain-of-custody, etc.).
 *
 * `sanitizeDonorName` strips filesystem-unsafe characters while preserving
 * the casing stored in the DB. Hyphens and spaces are preserved. Apostrophes
 * are dropped ("O'Brien" → "OBrien"). Accented characters are normalized to
 * ASCII via NFD decomposition ("Núñez" → "Nunez").
 *
 * Kept here (not inlined in the upload route) so it can be reused by any
 * code path that writes a filename, and unit-tested independently.
 */

export function sanitizeDonorName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/['`’]/g, "")            // drop apostrophes (straight + curly)
    .replace(/[\/\\:*?"<>|]/g, "")    // fs-unsafe chars
    .replace(/\s+/g, " ")             // collapse whitespace
    .trim();
}

/**
 * Build the display filename for a CCF chain-of-custody PDF.
 *
 * Format: `{specimenId} {Donor Name}.pdf` — no date.
 *
 * Example: `8079180 Alexis Covello.pdf`
 *
 * Falls back to `{Donor Name} COC{ext}` if the specimen ID is missing —
 * should be rare in practice because the upload flow prompts for it, but
 * defensively covers the case so we never crash on an empty specimenId.
 */
export function buildCcfFilename(
  specimenId: string | null | undefined,
  donorFirst: string,
  donorLast: string,
  ext: string = ".pdf"
): string {
  const donor = sanitizeDonorName(`${donorFirst} ${donorLast}`);
  const id = (specimenId ?? "").trim();
  if (!id) return `${donor} COC${ext}`;
  return `${id} ${donor}${ext}`;
}

import { claude } from "@/lib/claude";

/**
 * Extract the donor specimen collection date from a chain-of-custody PDF.
 *
 * Strategy mirrors `extractCocSpecimenId`:
 *   1. Try pdf-parse text extraction first (catches digitally-printed dates
 *      on USDTL CCFs and similar).
 *   2. Fall back to Claude Vision for handwritten / scanned forms.
 *   3. Return null on any error — the caller (the upload route) shows the
 *      confirm modal with an empty date field and a "could not extract"
 *      banner so staff can type the date in. We never block the upload on
 *      extraction failure, and we never silently substitute a guess.
 *
 * The Vision prompt is intentionally strict: handwriting recognition for
 * dates is the historical pain point (a wrong day silently stored is worse
 * than asking the user to type it). The model is told to return null on
 * any ambiguity rather than guess.
 */

export type CocCollectionDateResult = {
  collectionDate: string | null; // YYYY-MM-DD
  source: "text" | "vision" | null;
};

/**
 * Which date the extractor should target.
 *   "working_copy" — application date (existing behavior; non-patch CoCs and
 *                    sweat-patch working-copy uploads).
 *   "executed"     — patch removal date from box 10 of a PharmChek sweat-patch
 *                    CoC (executed-copy upload). Field is in the "PharmChek
 *                    Removal" section of the same physical form.
 *
 * The return shape is unchanged across modes — caller decides whether to
 * write the resulting date to TestOrder.collectionDate, PatchDetails
 * .applicationDate, or PatchDetails.removalDate. The JSON key returned by
 * the Vision pass also stays "collectionDate" so the response shape is
 * stable across modes; the field name is a vestige of pre-patch usage.
 */
export type CocUploadType = "working_copy" | "executed";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sanity guard: if the AI returns a date more than this many days from
 * today (in either direction), reject it as "could not extract." Catches
 * the dominant Vision failure mode — misreading a single handwritten
 * digit (e.g. "2026" → "2006", "04/28" → "04/25" in a different month).
 *
 * 30 days handles backlog uploads of recent collections without forcing
 * staff to re-type every CoC. Anything further out probably indicates
 * a misread; the modal will fall back to an empty input + the
 * "could not extract" banner so staff types the date in by hand.
 */
const RECENCY_WINDOW_DAYS = 30;

function isWithinRecencyWindow(iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, y, mo, d] = m;
  const date = new Date(
    Date.UTC(parseInt(y, 10), parseInt(mo, 10) - 1, parseInt(d, 10), 12, 0, 0)
  );
  if (Number.isNaN(date.getTime())) return false;
  const diffDays =
    Math.abs(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= RECENCY_WINDOW_DAYS;
}

export async function extractCocCollectionDate(
  buffer: Buffer,
  uploadType: CocUploadType = "working_copy"
): Promise<CocCollectionDateResult> {
  // --- Text pass -----------------------------------------------------------
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const PDFParseClass = pdfParse.PDFParse || pdfParse.default || pdfParse;
    const uint8 = new Uint8Array(buffer);
    const parser =
      typeof PDFParseClass === "function" && PDFParseClass.prototype
        ? new PDFParseClass(uint8)
        : null;
    if (parser) {
      await parser.load();
      const result = await parser.getText();
      const text: string = result.text || "";
      if (text.trim().length > 50) {
        const fromText = matchPrintedCollectionDate(text, uploadType);
        if (fromText) {
          if (!isWithinRecencyWindow(fromText)) {
            console.warn(
              `[extractCocCollectionDate] text-extracted ${fromText} is outside the ${RECENCY_WINDOW_DAYS}-day window — rejecting as a likely misread`
            );
          } else {
            return { collectionDate: fromText, source: "text" };
          }
        }
      }
    }
  } catch (e) {
    console.error("[extractCocCollectionDate] text parse error:", e);
  }

  // --- Vision fallback -----------------------------------------------------
  if (!process.env.ANTHROPIC_API_KEY) {
    return { collectionDate: null, source: null };
  }

  try {
    const base64 = buffer.toString("base64");
    const visionPrompt =
      uploadType === "executed"
        ? `Return the PATCH REMOVAL DATE from this PharmChek sweat-patch chain-of-custody form.

The PharmChek CoC has two sections: an Application section (top, around boxes 2–9) and a Removal section (right side, around boxes 10–16). The removal date is in the **PharmChek Removal** section, in the field labeled with the **number 10** ("Date" field of the Removal portion). It is the date the patch was physically removed from the donor.

DO NOT return:
- The application date (top section, in the "PharmChek Application" portion, often labeled with the number 4 — that's a different date)
- The donor's date of birth
- The signature date (observer or donor signatures)
- The ship date / received-by-lab date / "Date Sent" / "Date Rec'd"
- The order date / requisition date
- Any printed form-revision date in the page footer

Date handling rules — these are critical:
- If the date in box 10 is clearly printed (typed/digital), return it.
- If the date is HANDWRITTEN and you cannot read it with high confidence — including any ambiguity about the day, month, or year — return null. DO NOT guess. A wrong date silently saved is worse than asking the user to type it.
- If box 10 is blank or you cannot identify the PharmChek Removal section, return null.
- If the year is missing or ambiguous, return null.
- A 2-digit year like "26" should be interpreted as 2026.

Respond with JSON only, in this exact shape:
{"collectionDate": "YYYY-MM-DD"}
or
{"collectionDate": null}`
        : `Return the donor specimen collection date from this chain-of-custody form.

The collection date is the date the donor's specimen (urine/oral fluid/hair/sweat patch) was physically collected from the donor. It is typically in a field labeled "Date Collected", "Collection Date", "Date of Collection", or similar, on the collector's portion of the form (Step 4 / Step 5 on USDTL CCFs).

DO NOT return:
- The donor's date of birth
- The signature date (collector or donor)
- The ship date / received-by-lab date
- The MRO verification date
- The order date / requisition date
- Any printed form-revision date in the page footer

Date handling rules — these are critical:
- If the date is clearly printed (typed/digital), return it.
- If the date is HANDWRITTEN and you cannot read it with high confidence — including any ambiguity about the day, month, or year — return null. DO NOT guess. A wrong date silently saved is worse than asking the user to type it.
- If multiple plausible collection dates appear and you can't tell which is the donor specimen collection, return null.
- If the year is missing or ambiguous, return null.

Respond with JSON only, in this exact shape:
{"collectionDate": "YYYY-MM-DD"}
or
{"collectionDate": null}`;

    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 128,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: visionPrompt },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "";
    const jsonMatch = text.match(/\{[^{}]*\}/);
    if (!jsonMatch) return { collectionDate: null, source: null };

    const parsed = JSON.parse(jsonMatch[0]) as {
      collectionDate?: string | null;
    };
    const raw = parsed.collectionDate;
    if (typeof raw === "string" && ISO_DATE.test(raw.trim())) {
      const trimmed = raw.trim();
      if (!isWithinRecencyWindow(trimmed)) {
        console.warn(
          `[extractCocCollectionDate] vision-extracted ${trimmed} is outside the ${RECENCY_WINDOW_DAYS}-day window — rejecting as a likely handwriting misread`
        );
        return { collectionDate: null, source: "vision" };
      }
      return { collectionDate: trimmed, source: "vision" };
    }
    return { collectionDate: null, source: "vision" };
  } catch (e) {
    console.error("[extractCocCollectionDate] Claude Vision error:", e);
    return { collectionDate: null, source: null };
  }
}

/**
 * Look for a printed date in the extracted PDF text. Tries label-anchored
 * regexes (the safe path) and returns YYYY-MM-DD or null.
 *
 * Conservative on purpose — if the format isn't clearly anchored to the
 * expected label (collection vs removal), return null and let the Vision
 * pass handle it. Sweat-patch CoCs are typically scanned paper forms with
 * handwritten dates, so text-mode rarely succeeds for `executed`; the
 * patterns below are best-effort for the rare case where a PharmChek form
 * has a typed removal date.
 *
 * Exported for unit testing — keep the surface narrow.
 */
export function matchPrintedCollectionDate(
  text: string,
  uploadType: CocUploadType = "working_copy"
): string | null {
  const labelPatterns =
    uploadType === "executed"
      ? [
          // Sweat-patch executed: "Removal Date: 04/22/2026", "Date Removed 2026-04-22", etc.
          /(?:date\s*removed|removal\s*date|date\s*of\s*removal|patch\s*removal\s*date)[:\s]*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4})/i,
        ]
      : [
          // Working-copy / non-patch: "Date Collected: 04/21/2026", "Collection Date 2026-04-21", etc.
          /(?:date\s*collected|collection\s*date|date\s*of\s*collection)[:\s]*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4})/i,
        ];
  for (const re of labelPatterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const iso = normalizeToIso(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}

function normalizeToIso(raw: string): string | null {
  const sep = raw.includes("-") ? "-" : raw.includes("/") ? "/" : ".";
  const parts = raw.split(sep).map((p) => p.trim());
  if (parts.length !== 3) return null;

  let y: number, mo: number, d: number;
  if (parts[0].length === 4) {
    // YYYY-MM-DD
    y = parseInt(parts[0], 10);
    mo = parseInt(parts[1], 10);
    d = parseInt(parts[2], 10);
  } else {
    // MM/DD/YYYY or MM/DD/YY (US default — USDTL forms)
    mo = parseInt(parts[0], 10);
    d = parseInt(parts[1], 10);
    const yRaw = parseInt(parts[2], 10);
    if (parts[2].length === 2) {
      // 2-digit year — assume 2000s
      y = 2000 + yRaw;
    } else {
      y = yRaw;
    }
  }

  if (
    !Number.isInteger(y) ||
    !Number.isInteger(mo) ||
    !Number.isInteger(d) ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    d > 31 ||
    y < 2000 ||
    y > 2100
  ) {
    return null;
  }

  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

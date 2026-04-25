import { claude } from "@/lib/claude";

/**
 * Extract the printed specimen ID from a chain-of-custody PDF. Narrow-scope
 * helper — we deliberately do NOT read handwritten fields here, because
 * handwriting recognition (especially dates) produces silent misreads that
 * we cannot distinguish from a correct read.
 *
 * Lab formats this needs to handle:
 *   - USDTL: digitally-generated PDF, specimen ID printed in a "CONTROL #" box.
 *   - Quest: typically scanned/rasterized; barcode header has two numbers
 *     stacked together (account # on the left, specimen ID on the right) above
 *     a "SPECIMEN ID NO." label. The text-pass regex won't match here — Vision
 *     picks it up via the format guide in the prompt below.
 *
 * Strategy:
 *   1. Try pdf-parse text extraction first (fast, free, reliable for
 *      digitally-generated lab PDFs like USDTL).
 *   2. Fall back to Claude Vision if text extraction returns nothing or
 *      doesn't contain a CONTROL # field — handles scanned PDFs (Quest) and
 *      forms with non-USDTL labels.
 *   3. Return null on any error. Callers treat null as "skip validation,
 *      proceed with upload" — we never block the user on extraction failures.
 */

export type CocSpecimenIdResult = {
  specimenId: string | null;
  source: "text" | "vision" | null;
};

export async function extractCocSpecimenId(
  buffer: Buffer
): Promise<CocSpecimenIdResult> {
  // --- Text pass -----------------------------------------------------------
  try {
    // Lazy import so Vercel "collect page data" build phase doesn't blow up
    // if pdf-parse has transitively broken anything.
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
        const match = text.match(/CONTROL\s*#\s*\n?\s*(\d{5,})/i);
        if (match?.[1]) {
          return { specimenId: match[1], source: "text" };
        }
      }
    }
  } catch (e) {
    console.error("[extractCocSpecimenId] text parse error:", e);
  }

  // --- Vision fallback -----------------------------------------------------
  if (!process.env.ANTHROPIC_API_KEY) {
    return { specimenId: null, source: null };
  }

  try {
    const base64 = buffer.toString("base64");
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
            {
              type: "text",
              text: `Return the printed/barcoded specimen ID from this chain-of-custody form. The specimen ID is the lab-issued number that is pre-printed or barcoded — NEVER a handwritten value.

Lab format guide:
- USDTL forms: the specimen ID is the number in the "CONTROL #" box (typically 7 digits).
- Quest Diagnostics forms: under the barcode at the top of STEP 1, TWO numbers are printed side-by-side. The LEFT number (usually 8 digits) is the ACCOUNT number — do NOT return this. The RIGHT number (usually 7 digits), which sits immediately to the left of the "SPECIMEN ID NO." label, IS the specimen ID. Example layout: "10814630  4070549  SPECIMEN ID NO." → return "4070549".
- Other labs: look for a printed/barcoded field labeled "Specimen ID", "Control #", "Accession #", or equivalent.

If the printed specimen ID is not clearly legible, return null. Do not guess. Do not return a handwritten number, an account number, an MRO/employer phone or fax, or any other unrelated digits on the form.

Respond with JSON only, in this exact shape:
{"specimenId": "1234567"}
or
{"specimenId": null}`,
            },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "";
    // Tolerate minor response-format drift: look for the first {...} block.
    const jsonMatch = text.match(/\{[^{}]*\}/);
    if (!jsonMatch) return { specimenId: null, source: null };

    const parsed = JSON.parse(jsonMatch[0]) as { specimenId?: string | null };
    const raw = parsed.specimenId;
    if (typeof raw === "string" && /^\d{5,}$/.test(raw.trim())) {
      return { specimenId: raw.trim(), source: "vision" };
    }
    return { specimenId: null, source: "vision" };
  } catch (e) {
    console.error("[extractCocSpecimenId] Claude Vision error:", e);
    return { specimenId: null, source: null };
  }
}

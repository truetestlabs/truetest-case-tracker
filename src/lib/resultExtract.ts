/**
 * Structured extraction of a lab result PDF into a LabResult row.
 *
 * Uses Claude with forced tool use to guarantee a JSON-shaped response. The
 * output is intentionally permissive — every field is optional and the caller
 * should assume any field may be null/missing on a given report. We'd rather
 * write a partial row than reject a result because we couldn't parse one
 * field.
 *
 * This is the PDF-upload path. The future HL7 webhook path will write the
 * same LabResult shape from structured HL7 segments and share the downstream
 * consumers (UI, MRO routing, email composer).
 *
 * Kept separate from resultSummary.ts so that:
 *   - The (good, working, battle-tested) narrative summary prompt stays
 *     untouched.
 *   - This new structured extractor can evolve independently, and its
 *     parserVersion can be bumped without risking the summary quality.
 */
import { claude } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const LAB_RESULT_PARSER_VERSION = "resultExtract/v2-2026-04-14";

export type AnalyteResult = {
  name: string;
  cutoff?: string | null;
  value?: string | null;
  result: "negative" | "positive" | "inconclusive";
  notes?: string | null;
};

export type ExtractedLabResult = {
  overallStatus:
    | "negative"
    | "positive"
    | "dilute"
    | "adulterated"
    | "invalid"
    | "mixed"
    | "mro_pending"
    | "mro_verified_negative"
    | "unknown";
  reportedCollectionDate?: string | null; // YYYY-MM-DD
  receivedAtLab?: string | null;
  reportDate?: string | null;
  mroVerificationDate?: string | null;
  labReportNumber?: string | null;
  labSpecimenId?: string | null;
  labName?: string | null; // e.g. "usdtl", "quest", "crl", "labcorp", "nms"
  analytes: AnalyteResult[];
  specimenValidity?: {
    creatinine?: string | null;
    ph?: string | null;
    status?: "valid" | "dilute" | "adulterated" | "invalid" | null;
  } | null;
};

const TOOL_SCHEMA: Anthropic.Tool = {
  name: "record_lab_result",
  description:
    "Record structured data extracted from a drug or alcohol test result report. Every date field uses ISO 8601 (YYYY-MM-DD). Pass null for any field you cannot determine.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallStatus: {
        type: "string",
        enum: [
          "negative",
          "positive",
          "dilute",
          "adulterated",
          "invalid",
          "mixed",
          "mro_pending",
          "mro_verified_negative",
          "unknown",
        ],
        description:
          "Overall verdict of the report. Use 'dilute' ONLY if the lab report itself explicitly prints the word DILUTE as a formal designation — never infer dilute from creatinine or specific gravity values alone. 'mixed' = some analytes positive and some MRO-downgraded. 'mro_pending' = awaiting MRO review. 'mro_verified_negative' = MRO downgraded a lab positive to negative.",
      },
      reportedCollectionDate: {
        type: ["string", "null"],
        description: "Date the specimen was collected, as printed on the report (YYYY-MM-DD).",
      },
      receivedAtLab: {
        type: ["string", "null"],
        description: "Date the lab received/accessioned the specimen (YYYY-MM-DD).",
      },
      reportDate: {
        type: ["string", "null"],
        description: "Date the lab finalized and released the report (YYYY-MM-DD).",
      },
      mroVerificationDate: {
        type: ["string", "null"],
        description: "Date the MRO signed off on review, if applicable (YYYY-MM-DD).",
      },
      labReportNumber: {
        type: ["string", "null"],
        description: "Lab's unique report / accession number.",
      },
      labSpecimenId: {
        type: ["string", "null"],
        description:
          "The specimen ID the lab has on record (sometimes called Control Number, Specimen ID, or Chain of Custody Number).",
      },
      labName: {
        type: ["string", "null"],
        enum: ["usdtl", "quest", "crl", "labcorp", "nms", "medipro", "truetest_inhouse", null],
        description: "Which lab processed this result. Match to known labs; use null if unknown.",
      },
      analytes: {
        type: "array",
        description: "Each substance tested in the panel. Include ALL analytes listed on the report, not just positives.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Substance name, e.g. 'Amphetamine', 'Cocaine metabolite (BZE)', 'Delta-9-THC metabolite', 'PEth'.",
            },
            cutoff: {
              type: ["string", "null"],
              description:
                "Cutoff threshold with units if present, e.g. '500 ng/mL', '100 pg/mg'. Include whether it's initial or confirm if stated.",
            },
            value: {
              type: ["string", "null"],
              description:
                "Quantitative value with units, or 'Negative' / '<LOD' / 'Not detected' if below cutoff.",
            },
            result: {
              type: "string",
              enum: ["negative", "positive", "inconclusive"],
              description: "Per-analyte verdict.",
            },
            notes: {
              type: ["string", "null"],
              description: "Free-text notes on this analyte, e.g. MRO status, secondary metabolite, etc.",
            },
          },
          required: ["name", "result"],
        },
      },
      specimenValidity: {
        type: ["object", "null"],
        description: "Urine-only validity indicators. Pass null for hair, blood, sweat patch, etc.",
        properties: {
          creatinine: { type: ["string", "null"] },
          ph: { type: ["string", "null"] },
          status: {
            type: ["string", "null"],
            enum: ["valid", "dilute", "adulterated", "invalid", null],
            description: "Use 'dilute' ONLY if the lab report explicitly designates the specimen as DILUTE. Never infer dilute from creatinine or specific gravity values alone — the lab makes that call.",
          },
        },
      },
    },
    required: ["overallStatus", "analytes"],
  },
} as const;

/**
 * PDF-direct extraction: forces tool_use while Claude reads the PDF. Works
 * for some reports but empirically unreliable on many real lab PDFs — the
 * combined "read PDF + structure output" task seems to be harder for the
 * model than either alone. Kept as a fallback path; prefer
 * extractLabResultFromText whenever we already have a narrative summary.
 */
export async function extractLabResultStructured(
  pdfBuffer: Buffer
): Promise<ExtractedLabResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const base64 = pdfBuffer.toString("base64");
    const response = await claude.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 4000,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "record_lab_result" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            {
              type: "text",
              text: `Extract the structured data from this drug or alcohol test result report by calling the record_lab_result tool. Include EVERY analyte listed on the report (not just positives). Use YYYY-MM-DD for all dates. If any field isn't printed on the report, pass null rather than guessing.`,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.warn("[resultExtract] Claude did not return a tool_use block");
      return null;
    }
    return toolUse.input as ExtractedLabResult;
  } catch (e) {
    console.error("[resultExtract] extraction error:", e);
    return null;
  }
}

/**
 * Text-based extraction: takes the already-generated narrative summary
 * (from generateResultSummary) and parses it into structured data. This is
 * the PREFERRED path — the summary is clean prose that the model can
 * reliably map into the tool schema, and this call is cheaper and faster
 * than the PDF-direct path (sonnet handles it easily; no base64 blob).
 */
export async function extractLabResultFromText(
  summaryText: string
): Promise<ExtractedLabResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!summaryText || summaryText.length < 20) return null;
  try {
    const response = await claude.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 4000,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "tool", name: "record_lab_result" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Parse this drug/alcohol test result summary into the record_lab_result tool.

Rules:
- Include EVERY analyte mentioned in the summary (including negatives listed in phrases like "all substances tested negative") as separate entries in the analytes array.
- For PEth results, the single "analyte" is "PEth" with the numeric value and cutoff.
- Dates must be ISO 8601 (YYYY-MM-DD). Convert "March 11, 2026" → "2026-03-11".
- If the summary mentions MRO verification, set overallStatus to "mro_verified_negative" if it was downgraded, "mro_pending" if it's in review, "mixed" if partially downgraded.
- Use null for any field the summary doesn't mention rather than guessing.
- Lab names are matched to the enum if possible: usdtl, quest, crl, labcorp, nms, medipro, truetest_inhouse.

---

${summaryText}`,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.warn("[resultExtract] from-text: Claude did not return a tool_use block");
      return null;
    }
    return toolUse.input as ExtractedLabResult;
  } catch (e) {
    console.error("[resultExtract] from-text extraction error:", e);
    return null;
  }
}

/**
 * Orchestrator: prefer text-based extraction (reliable, cheap) when a
 * summary is available, fall back to PDF-direct (Opus with document input)
 * only when we don't have one. If text-based succeeds but returns zero
 * analytes, also retry against the PDF.
 */
export async function extractLabResult({
  pdfBuffer,
  summaryText,
}: {
  pdfBuffer?: Buffer;
  summaryText?: string | null;
}): Promise<ExtractedLabResult | null> {
  if (summaryText && summaryText.length >= 20) {
    const fromText = await extractLabResultFromText(summaryText);
    if (fromText && (fromText.analytes?.length ?? 0) > 0) return fromText;
  }
  if (pdfBuffer) {
    return await extractLabResultStructured(pdfBuffer);
  }
  return null;
}

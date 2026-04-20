/**
 * Claude Vision extractor for drug-test order PDFs.
 *
 * Staff upload a Quest "QPassport" order PDF (or an equivalent form from
 * another lab, which we treat as ~15% of the volume). We extract a small
 * structured blob — enough to render a mobile-friendly card on the donor
 * portal without the donor needing to open the raw PDF.
 *
 * Design: never throw on a bad PDF. If extraction fails or the model
 * returns something unparseable, we return an all-null OrderFields so
 * the upload still succeeds and the donor can still download the raw
 * PDF at unlock time.
 */
import { claude } from "@/lib/claude";

export interface OrderFields {
  /** Barcode / order number shown at top of the PDF, e.g. "Q21903933". */
  qPassportId: string | null;
  collectionSite: {
    name: string | null;
    /** Single-line merged address. */
    address: string | null;
    phone: string | null;
    /** Free-form hours string, e.g. "M-F 9:30 am-4:00 pm". */
    hours: string | null;
  };
  /** Expiration / deadline as printed on the form (not normalized). */
  expiresOn: string | null;
  /** Test type, e.g. "65304N - DOT DRUG PANEL W/TS (Urine)". */
  testType: string | null;
  /** e.g. "Split", "Single". */
  collectionService: string | null;
  donorName: string | null;
  orderedDate: string | null;
  /**
   * Whether the order is a direct-observed collection. `null` when the
   * form has no observed field at all (e.g. a lab whose template doesn't
   * include it) — the portal card then treats it as "not observed" but
   * we preserve the distinction for audit.
   */
  observed: boolean | null;
}

const EMPTY: OrderFields = {
  qPassportId: null,
  collectionSite: { name: null, address: null, phone: null, hours: null },
  expiresOn: null,
  testType: null,
  collectionService: null,
  donorName: null,
  orderedDate: null,
  observed: null,
};

const PROMPT = `You are extracting structured data from a drug-test collection order PDF.
The dominant format is Quest Diagnostics "QPassport"; other labs use
equivalent forms with different labels. Map equivalents when needed
(e.g. "Order #" → qPassportId, "Lab:" → collectionSite.name).

Return a single JSON object matching this exact TypeScript schema:

{
  "qPassportId": string | null,
  "collectionSite": {
    "name": string | null,
    "address": string | null,
    "phone": string | null,
    "hours": string | null
  },
  "expiresOn": string | null,
  "testType": string | null,
  "collectionService": string | null,
  "donorName": string | null,
  "orderedDate": string | null,
  "observed": boolean | null
}

Rules:
- Use null for any field not present. NEVER fabricate.
- qPassportId is the barcode number at the top of the form (e.g. "Q21903933").
- collectionSite.address must be a single line (merge multi-line addresses with ", ").
- Preserve the raw string form for expiresOn and orderedDate — do not normalize.
- observed is true only when the form clearly indicates a direct-observed
  collection (e.g. a checked "Observed" or "Direct observed collection"
  box, or the collection service says "Observed"). Use false when the
  form has an observed field that is explicitly un-checked / "No". Use
  null only when the form has no observed field at all.
- Output ONLY the JSON object. No markdown fences, no prose.`;

function sanitize(raw: unknown): OrderFields {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;
  const site = (r.collectionSite && typeof r.collectionSite === "object"
    ? (r.collectionSite as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const bool = (v: unknown): boolean | null =>
    typeof v === "boolean" ? v : null;
  return {
    qPassportId: str(r.qPassportId),
    collectionSite: {
      name: str(site.name),
      address: str(site.address),
      phone: str(site.phone),
      hours: str(site.hours),
    },
    expiresOn: str(r.expiresOn),
    testType: str(r.testType),
    collectionService: str(r.collectionService),
    donorName: str(r.donorName),
    orderedDate: str(r.orderedDate),
    observed: bool(r.observed),
  };
}

/**
 * Extract order fields from a PDF buffer. Never throws — returns all-null
 * fields on any failure (missing API key, network error, unparseable JSON,
 * or a non-standard PDF the model can't make sense of).
 */
export async function extractOrderFields(pdf: Buffer): Promise<OrderFields> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[extractOrder] ANTHROPIC_API_KEY not set — returning empty fields");
    return EMPTY;
  }

  try {
    const response = await claude.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdf.toString("base64"),
              },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text")?.text || "";
    // Tolerate a leading code fence or prose — pull out the first {...} block.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn("[extractOrder] no JSON object in response:", text.slice(0, 200));
      return EMPTY;
    }
    const parsed = JSON.parse(match[0]);
    return sanitize(parsed);
  } catch (err) {
    console.error("[extractOrder] extraction failed:", err);
    return EMPTY;
  }
}

import PDFDocument from "pdfkit";
import { formatChicagoMediumDate } from "@/lib/dateChicago";

/**
 * Sweat-patch cancellation notice — the document that goes to attorneys,
 * GALs, and other case recipients when a patch is cancelled. Modeled on
 * src/lib/pdf/compliance-report.ts so the two documents look like
 * siblings: same navy header, same footer, same typographic palette.
 *
 * Locked content rules (reviewed and approved before this file existed):
 *   - No characterization of the cancellation reason. The doc never
 *     mentions cancellationKind ("expired", "lab_cancelled", etc.) — only
 *     the dates and the binary replacement statement.
 *   - No clinical or evidentiary commentary. No panel name, no lab name,
 *     no wear-day count, no result-status language.
 *   - The two replacement sentences are verbatim from the spec:
 *       "A replacement patch was applied on [date]."
 *       "No replacement patch was applied."
 *   - The two bridging sentences ("This notice confirms..." and
 *     "This document is issued for informational and recordkeeping
 *     purposes...") are also locked verbatim.
 *
 * Anyone editing the copy here should re-read the locked rules above
 * and confirm with product/legal before changing the wording — these
 * documents land in contested custody-case files.
 */

const NAVY = "#1e3a5f";
const SLATE_DARK = "#0f172a";
const SLATE_MID = "#334155";
const GRAY = "#64748b";
const PANEL_FILL = "#f8fafc";
const PANEL_STROKE = "#e2e8f0";
const FOOTER_RULE = "#cbd5e1";

// Hard cap for header-row identifier fields (donor name, case number,
// court case number). Each sits in a half-page column ~256pt wide; at
// 12-13pt font that's ~35 chars before wrap risk into the adjacent
// column. Truncate with a single-char ellipsis rather than wrapping —
// these fields exist in the case record and the email body in full,
// so the PDF only needs to identify the row visually.
const HEADER_FIELD_MAX = 35;

function truncateHeader(value: string): string {
  if (value.length <= HEADER_FIELD_MAX) return value;
  return value.slice(0, HEADER_FIELD_MAX - 1) + "…";
}

export type CancelledTestReportInput = {
  caseNumber: string;
  courtCaseNumber: string | null;
  donorName: string; // already formatted "First Last"; "Donor name not on record" if missing
  specimenId: string | null;
  applicationDate: Date | null;
  cancellationDate: Date;
  replacement:
    | { applied: true; applicationDate: Date }
    | { applied: false };
};

export async function generateCancelledTestReportPDF(
  input: CancelledTestReportInput,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width;
    const contentLeft = 50;
    const contentRight = pageWidth - 50;
    const contentWidth = contentRight - contentLeft;

    // ── Header bar ────────────────────────────────────────────────────
    doc.rect(0, 0, pageWidth, 70).fill(NAVY);
    doc.fontSize(9).fillColor("#ffffff80").text("TRUETEST LABS", 50, 20);
    doc
      .fontSize(16)
      .fillColor("#ffffff")
      .text("Sweat Patch Cancellation Notice", 50, 35);

    // ── Case + issue metadata block ──────────────────────────────────
    let y = 95;
    const colLeft = contentLeft;
    const colRight = contentLeft + contentWidth / 2;

    // Left column: Case → Donor (truncate to keep within half-page width)
    doc.fontSize(9).fillColor(GRAY).text("Case", colLeft, y);
    doc
      .fontSize(13)
      .fillColor(SLATE_DARK)
      .text(truncateHeader(input.caseNumber), colLeft, y + 12, {
        lineBreak: false,
      });

    doc.fontSize(9).fillColor(GRAY).text("Donor", colLeft, y + 38);
    doc
      .fontSize(12)
      .fillColor(SLATE_DARK)
      .text(truncateHeader(input.donorName), colLeft, y + 50, {
        lineBreak: false,
      });

    // Right column: Date Issued → Court Case No. (only render court row if set)
    doc.fontSize(9).fillColor(GRAY).text("Date Issued", colRight, y);
    doc
      .fontSize(12)
      .fillColor(SLATE_DARK)
      .text(formatChicagoMediumDate(new Date()), colRight, y + 12, {
        lineBreak: false,
      });

    if (input.courtCaseNumber) {
      doc
        .fontSize(9)
        .fillColor(GRAY)
        .text("Court Case No.", colRight, y + 38);
      doc
        .fontSize(12)
        .fillColor(SLATE_DARK)
        .text(truncateHeader(input.courtCaseNumber), colRight, y + 50, {
          lineBreak: false,
        });
    }

    y += 80;

    // ── Specimen + dates panel ───────────────────────────────────────
    const panelHeight = 88;
    doc
      .rect(contentLeft, y, contentWidth, panelHeight)
      .fill(PANEL_FILL)
      .stroke(PANEL_STROKE);

    const labelX = contentLeft + 18;
    const valueX = contentLeft + 170;
    let py = y + 14;

    const rows: Array<[string, string]> = [
      ["Specimen ID", input.specimenId ?? "Not on record"],
      [
        "Application Date",
        input.applicationDate
          ? formatChicagoMediumDate(input.applicationDate)
          : "Not on record",
      ],
      ["Cancellation Date", formatChicagoMediumDate(input.cancellationDate)],
    ];

    for (const [label, value] of rows) {
      doc.fontSize(10).fillColor(GRAY).text(label, labelX, py);
      doc.fontSize(11).fillColor(SLATE_DARK).text(value, valueX, py);
      py += 22;
    }

    y += panelHeight + 24;

    // ── Bridging sentence 1 (LOCKED VERBATIM) ────────────────────────
    doc
      .fontSize(11)
      .fillColor(SLATE_MID)
      .text(
        "This notice confirms that the sweat patch identified above, applied to the donor on the date shown, was cancelled before completion of the standard wear period.",
        contentLeft,
        y,
        { width: contentWidth, align: "left" },
      );

    y = doc.y + 18;

    // ── Replacement statement (LOCKED VERBATIM, one of two) ──────────
    const replacementSentence = input.replacement.applied
      ? `A replacement patch was applied on ${formatChicagoMediumDate(input.replacement.applicationDate)}.`
      : "No replacement patch was applied.";

    doc
      .fontSize(11)
      .fillColor(SLATE_DARK)
      .text(replacementSentence, contentLeft, y, {
        width: contentWidth,
        align: "left",
      });

    y = doc.y + 18;

    // ── Bridging sentence 2 (LOCKED VERBATIM) ────────────────────────
    doc
      .fontSize(11)
      .fillColor(SLATE_MID)
      .text(
        "This document is issued for informational and recordkeeping purposes. Please retain it with your case file.",
        contentLeft,
        y,
        { width: contentWidth, align: "left" },
      );

    // ── Footer ────────────────────────────────────────────────────────
    const footerY = doc.page.height - 60;
    doc
      .moveTo(contentLeft, footerY)
      .lineTo(contentRight, footerY)
      .lineWidth(0.5)
      .stroke(FOOTER_RULE);
    doc.fontSize(7).fillColor(GRAY);
    doc.text(
      "TrueTest Labs · 2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007 · (847) 258-3966",
      contentLeft,
      footerY + 8,
    );
    doc.text(
      `Generated: ${formatChicagoMediumDate(new Date())}`,
      contentLeft,
      footerY + 20,
    );

    doc.end();
  });
}

// Filename builder — kept here so the generation route and any future
// regenerate path agree on the format. Cancellation date (not generation
// date) so the filename is stable across regenerations.
export function buildCancellationReportFilename(
  donorFirstName: string,
  donorLastName: string,
  cancellationDate: Date,
): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  // ISO date for filename stability across timezones
  const isoDate = cancellationDate.toISOString().slice(0, 10);
  return `${safe(donorLastName) || "Donor"}_${safe(donorFirstName) || "Unknown"}_PatchCancellation_${isoDate}.pdf`;
}

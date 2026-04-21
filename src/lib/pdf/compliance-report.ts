import PDFDocument from "pdfkit";
import type { ComplianceReport } from "@/lib/compliance";
import { formatChicagoMediumDate } from "@/lib/dateChicago";

const NAVY = "#1e3a5f";
const GREEN = "#059669";
const RED = "#dc2626";
const AMBER = "#d97706";
const GRAY = "#64748b";

export async function generateComplianceReportPDF(report: ComplianceReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
    doc.fontSize(9).fillColor("#ffffff80").text("TRUETEST LABS", 50, 20);
    doc.fontSize(16).fillColor("#ffffff").text("Random Testing Compliance Report", 50, 35);

    // ── Case info ──
    let y = 90;
    doc.fontSize(10).fillColor(GRAY).text("Case", 50, y);
    doc.fontSize(14).fillColor("#0f172a").text(report.schedule.caseNumber, 50, y + 14);
    doc.fontSize(10).fillColor(GRAY).text("Donor", 50, y + 36);
    doc.fontSize(12).fillColor("#0f172a").text(report.schedule.donorName, 50, y + 50);

    doc.fontSize(10).fillColor(GRAY).text("Test Type", 300, y);
    doc.fontSize(12).fillColor("#0f172a").text(report.schedule.testName, 300, y + 14);
    doc.fontSize(10).fillColor(GRAY).text("Schedule", 300, y + 36);
    doc.fontSize(10).fillColor("#0f172a").text(report.schedule.patternSummary, 300, y + 50);

    // ── Report period ──
    y += 80;
    doc.rect(50, y, doc.page.width - 100, 35).fill("#f8fafc").stroke("#e2e8f0");
    doc.fontSize(9).fillColor(GRAY).text("Report Period", 60, y + 5);
    doc.fontSize(10).fillColor("#0f172a").text(
      `${formatDate(report.period.from)} through ${formatDate(report.period.to)} — ${report.summary.totalWeekdays} weekdays`,
      60, y + 18
    );

    // ── Summary stats ──
    y += 50;
    const statWidth = (doc.page.width - 100 - 40) / 5;
    const stats = [
      { label: "Check-Ins", value: String(report.summary.checkInsMade), sub: `of ${report.summary.totalWeekdays}` },
      { label: "Missed", value: String(report.summary.checkInsMissed), sub: "" },
      { label: "Selected", value: String(report.summary.daysSelected), sub: "" },
      { label: "Tested", value: String(report.summary.daysTested), sub: "", color: GREEN },
      { label: "Refused", value: String(report.summary.daysRefused), sub: "", color: RED },
    ];
    stats.forEach((stat, i) => {
      const x = 50 + i * (statWidth + 10);
      doc.rect(x, y, statWidth, 50).stroke("#e2e8f0");
      doc.fontSize(8).fillColor(GRAY).text(stat.label, x + 8, y + 6);
      doc.fontSize(18).fillColor(stat.color || "#0f172a").text(stat.value, x + 8, y + 18);
      if (stat.sub) doc.fontSize(7).fillColor(GRAY).text(stat.sub, x + 8, y + 38);
    });

    // ── Compliance rates ──
    y += 65;
    const rateWidth = (doc.page.width - 100 - 10) / 2;
    [
      { label: "Check-In Rate", value: `${report.summary.checkInRate}%`, detail: `${report.summary.checkInsMade}/${report.summary.totalWeekdays} weekdays` },
      { label: "Compliance Rate", value: `${report.summary.complianceRate}%`, detail: `${report.summary.daysTested}/${report.summary.daysSelected} selected days` },
    ].forEach((rate, i) => {
      const x = 50 + i * (rateWidth + 10);
      const color = parseInt(rate.value) >= 90 ? GREEN : parseInt(rate.value) >= 70 ? AMBER : RED;
      doc.rect(x, y, rateWidth, 45).lineWidth(2).stroke(color);
      doc.fontSize(8).fillColor(color).text(rate.label.toUpperCase(), x + 10, y + 6);
      doc.fontSize(20).fillColor(color).text(rate.value, x + 10, y + 16);
      doc.fontSize(7).fillColor(GRAY).text(rate.detail, x + 80, y + 22);
    });

    // ── Day-by-day table ──
    y += 60;
    doc.fontSize(10).fillColor("#0f172a").text("Day-by-Day Log", 50, y);
    y += 18;

    // Table header
    const colX = [50, 160, 240, 310, 370, 450];
    const colLabels = ["Date", "Checked In", "Time", "Selected", "Outcome"];
    doc.fontSize(7).fillColor(GRAY);
    colLabels.forEach((label, i) => doc.text(label.toUpperCase(), colX[i], y));
    y += 12;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(1).stroke("#cbd5e1");
    y += 4;

    // Table rows
    for (const entry of report.entries) {
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }
      const isSelected = entry.wasSelected;
      if (isSelected) {
        doc.rect(48, y - 2, doc.page.width - 96, 14).fill("#eff6ff");
      }
      doc.fontSize(8).fillColor("#334155");
      doc.text(`${entry.dayName.slice(0, 3)} ${formatDate(entry.date)}`, colX[0], y);
      doc.fillColor(entry.checkedIn ? GREEN : RED).text(entry.checkedIn ? "Yes" : "Missed", colX[1], y);
      doc.fillColor(GRAY).text(entry.checkInTime || "—", colX[2], y);
      doc.fillColor(isSelected ? "#1d4ed8" : GRAY).text(isSelected ? "SELECTED" : "—", colX[3], y);
      const outcomeColor = entry.outcome === "tested" ? GREEN : entry.outcome === "refused" ? RED : GRAY;
      const outcomeText = entry.outcome === "tested" ? "Tested" : entry.outcome === "refused" ? "Refused" : entry.outcome === "pending" ? "Pending" : "—";
      doc.fillColor(outcomeColor).text(outcomeText, colX[4], y);
      y += 14;
    }

    // ── Footer ──
    y = doc.page.height - 60;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(0.5).stroke("#cbd5e1");
    doc.fontSize(7).fillColor(GRAY);
    doc.text("TrueTest Labs · 2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007 · (847) 258-3966", 50, y + 8);
    doc.text(`Generated: ${formatChicagoMediumDate(new Date())}`, 50, y + 20);

    doc.end();
  });
}

function formatDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

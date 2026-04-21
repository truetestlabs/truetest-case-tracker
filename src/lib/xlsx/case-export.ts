import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { formatChicagoShortDate, formatChicagoTime } from "@/lib/dateChicago";

export async function generateCaseExportXLSX(caseId: string): Promise<Buffer> {
  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    include: {
      donor: true,
      caseContacts: { include: { contact: true } },
      testOrders: { orderBy: { createdAt: "desc" } },
      statusLogs: { orderBy: { changedAt: "desc" }, take: 50 },
    },
  });

  if (!caseData) throw new Error("Case not found");

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Case Info ──
  const caseInfo = [
    ["Case Number", caseData.caseNumber],
    ["Case Type", caseData.caseType.replace(/_/g, " ")],
    ["Case Status", caseData.caseStatus],
    ["Court Case Number", caseData.courtCaseNumber || ""],
    ["County", caseData.county || ""],
    ["Judge", caseData.judgeName || ""],
    ["Monitored", caseData.isMonitored ? "Yes" : "No"],
    ["Created", formatChicagoShortDate(caseData.createdAt)],
    [""],
    ["Donor Name", caseData.donor ? `${caseData.donor.firstName} ${caseData.donor.lastName}` : ""],
    ["Donor Email", caseData.donor?.email || ""],
    ["Donor Phone", caseData.donor?.phone || ""],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(caseInfo);
  ws1["!cols"] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Case Info");

  // ── Sheet 2: Test Orders ──
  const testHeaders = ["Test", "Specimen ID", "Specimen Type", "Lab", "Status", "Collection Type", "Payment", "Client Price", "Collection Date", "Sent to Lab", "Results Received", "Results Released"];
  const testRows = caseData.testOrders.map((t) => [
    t.testDescription,
    t.specimenId || "",
    t.specimenType,
    t.lab,
    t.testStatus.replace(/_/g, " "),
    t.collectionType,
    t.paymentMethod || "Unpaid",
    t.clientPrice ? Number(t.clientPrice).toFixed(2) : "",
    t.collectionDate ? formatChicagoShortDate(t.collectionDate) : "",
    t.sentToLabDate ? formatChicagoShortDate(t.sentToLabDate) : "",
    t.resultsReceivedDate ? formatChicagoShortDate(t.resultsReceivedDate) : "",
    t.resultsReleasedDate ? formatChicagoShortDate(t.resultsReleasedDate) : "",
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([testHeaders, ...testRows]);
  ws2["!cols"] = testHeaders.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, ws2, "Test Orders");

  // ── Sheet 3: Contacts ──
  const contactHeaders = ["Name", "Role", "Firm", "Email", "Phone", "Receives Results", "Receives Status"];
  const contactRows = caseData.caseContacts.map((cc) => [
    `${cc.contact.firstName} ${cc.contact.lastName}`,
    cc.roleInCase.replace(/_/g, " "),
    cc.contact.firmName || "",
    cc.contact.email || "",
    cc.contact.phone || "",
    cc.receivesResults ? "Yes" : "No",
    cc.receivesStatus ? "Yes" : "No",
  ]);
  const ws3 = XLSX.utils.aoa_to_sheet([contactHeaders, ...contactRows]);
  ws3["!cols"] = contactHeaders.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws3, "Contacts");

  // ── Sheet 4: Activity Log ──
  const logHeaders = ["Date", "From", "To", "Note"];
  const logRows = caseData.statusLogs.map((log) => [
    `${formatChicagoShortDate(log.changedAt)} ${formatChicagoTime(log.changedAt)}`,
    log.oldStatus.replace(/_/g, " "),
    log.newStatus.replace(/_/g, " "),
    log.note || "",
  ]);
  const ws4 = XLSX.utils.aoa_to_sheet([logHeaders, ...logRows]);
  ws4["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Activity Log");

  // Generate buffer
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}

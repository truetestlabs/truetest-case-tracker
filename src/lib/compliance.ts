import { prisma } from "@/lib/prisma";
import { chicagoDateKey, utcInstantForChicagoDayStart } from "@/lib/dateChicago";

export type ComplianceEntry = {
  date: string; // YYYY-MM-DD
  dayName: string; // "Monday"
  checkedIn: boolean;
  checkInTime: string | null; // "8:32 AM"
  wasSelected: boolean;
  selectionStatus: string | null;
  outcome: "none" | "tested" | "refused" | "pending";
};

export type ComplianceReport = {
  schedule: {
    scheduleId: string;
    caseId: string;
    caseNumber: string;
    donorName: string;
    testName: string;
    patternSummary: string;
    pin: string;
    startDate: string;
    endDate: string | null;
    collectionType: string;
  };
  period: { from: string; to: string };
  entries: ComplianceEntry[];
  summary: {
    totalWeekdays: number;
    checkInsMade: number;
    checkInsMissed: number;
    daysSelected: number;
    daysTested: number;
    daysRefused: number;
    checkInRate: number; // % of weekdays with check-in
    complianceRate: number; // % of selected days where donor tested
  };
};

function isWeekday(d: Date): boolean {
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function patternLabel(patternType: string, targetCount: number): string {
  if (patternType === "range_count") return `${targetCount} random tests over range`;
  if (patternType === "per_month") return `${targetCount}× per month`;
  if (patternType === "per_week") return `${targetCount}× per week`;
  return patternType;
}

export async function buildComplianceReport(
  scheduleId: string,
  fromDate: Date,
  toDate: Date
): Promise<ComplianceReport | null> {
  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id: scheduleId },
    include: {
      testCatalog: { select: { testName: true } },
      case: {
        select: {
          id: true,
          caseNumber: true,
          donor: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });

  if (!schedule) return null;

  // `from`/`to` are UTC-midnight markers of America/Chicago calendar days.
  const from = utcMidnight(fromDate);
  const to = utcMidnight(toDate);

  // checkedInAt is a real timestamp — its range must be the UTC instants
  // bounding the Chicago calendar days [from, to], not UTC midnights.
  // Using UTC midnights here would drop evening (7 PM–midnight CT)
  // check-ins on `to` and pick up late-evening check-ins from the day
  // before `from`.
  const checkInRangeStart = utcInstantForChicagoDayStart(from);
  const checkInRangeEnd = utcInstantForChicagoDayStart(addDays(to, 1));

  const checkIns = await prisma.checkIn.findMany({
    where: {
      scheduleId,
      checkedInAt: { gte: checkInRangeStart, lt: checkInRangeEnd },
    },
    orderBy: { checkedInAt: "asc" },
  });

  // selectedDate is stored as UTC-midnight of the Chicago day, so the
  // UTC-midnight boundaries work directly here.
  const selections = await prisma.randomSelection.findMany({
    where: {
      scheduleId,
      selectedDate: { gte: from, lt: addDays(to, 1) },
    },
  });

  // Bucket check-ins by the donor's Chicago calendar day so a 9 PM CT
  // check-in is counted on its own day, not bumped to tomorrow.
  const checkInByDate = new Map<string, { time: string }>();
  for (const ci of checkIns) {
    const k = chicagoDateKey(ci.checkedInAt);
    if (!checkInByDate.has(k)) {
      checkInByDate.set(k, {
        time: new Date(ci.checkedInAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Chicago",
        }),
      });
    }
  }

  const selectionByDate = new Map<string, { status: string }>();
  for (const sel of selections) {
    const k = dateKey(sel.selectedDate);
    // If multiple selections (e.g. replacement), prefer non-cancelled
    if (!selectionByDate.has(k) || sel.status !== "cancelled") {
      selectionByDate.set(k, { status: sel.status });
    }
  }

  // Build day-by-day entries (weekdays only)
  const entries: ComplianceEntry[] = [];
  let d = from;
  while (d.getTime() <= to.getTime()) {
    if (isWeekday(d)) {
      const k = dateKey(d);
      const ci = checkInByDate.get(k);
      const sel = selectionByDate.get(k);
      const wasSelected = !!sel && sel.status !== "cancelled";
      let outcome: ComplianceEntry["outcome"] = "none";
      if (wasSelected) {
        if (sel!.status === "completed") outcome = "tested";
        else if (sel!.status === "refused") outcome = "refused";
        else outcome = "pending";
      }
      entries.push({
        date: k,
        dayName: d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
        checkedIn: !!ci,
        checkInTime: ci?.time || null,
        wasSelected,
        selectionStatus: sel?.status || null,
        outcome,
      });
    }
    d = addDays(d, 1);
  }

  // Summary stats
  const totalWeekdays = entries.length;
  const checkInsMade = entries.filter((e) => e.checkedIn).length;
  const checkInsMissed = totalWeekdays - checkInsMade;
  const daysSelected = entries.filter((e) => e.wasSelected).length;
  const daysTested = entries.filter((e) => e.outcome === "tested").length;
  const daysRefused = entries.filter((e) => e.outcome === "refused").length;
  const checkInRate = totalWeekdays > 0 ? Math.round((checkInsMade / totalWeekdays) * 100) : 100;
  const complianceRate = daysSelected > 0 ? Math.round((daysTested / daysSelected) * 100) : 100;

  const donorName = schedule.case.donor
    ? `${schedule.case.donor.firstName} ${schedule.case.donor.lastName}`
    : "Unknown";

  return {
    schedule: {
      scheduleId: schedule.id,
      caseId: schedule.case.id,
      caseNumber: schedule.case.caseNumber,
      donorName,
      testName: schedule.testCatalog.testName,
      patternSummary: patternLabel(schedule.patternType, schedule.targetCount),
      pin: schedule.checkInPin,
      startDate: dateKey(schedule.startDate),
      endDate: schedule.endDate ? dateKey(schedule.endDate) : null,
      collectionType: schedule.collectionType,
    },
    period: { from: dateKey(from), to: dateKey(to) },
    entries,
    summary: {
      totalWeekdays,
      checkInsMade,
      checkInsMissed,
      daysSelected,
      daysTested,
      daysRefused,
      checkInRate,
      complianceRate,
    },
  };
}

/** Format a report as CSV */
export function reportToCSV(report: ComplianceReport): string {
  const lines: string[] = [];
  lines.push(`TrueTest Labs Compliance Report`);
  lines.push(`Case,${report.schedule.caseNumber}`);
  lines.push(`Donor,${report.schedule.donorName}`);
  lines.push(`Test,${report.schedule.testName}`);
  lines.push(`Schedule,${report.schedule.patternSummary}`);
  lines.push(`Period,${report.period.from} through ${report.period.to}`);
  lines.push("");
  lines.push(`Total Weekdays,${report.summary.totalWeekdays}`);
  lines.push(`Check-Ins Made,${report.summary.checkInsMade}`);
  lines.push(`Check-Ins Missed,${report.summary.checkInsMissed}`);
  lines.push(`Days Selected,${report.summary.daysSelected}`);
  lines.push(`Days Tested,${report.summary.daysTested}`);
  lines.push(`Days Refused,${report.summary.daysRefused}`);
  lines.push(`Check-In Rate,${report.summary.checkInRate}%`);
  lines.push(`Compliance Rate,${report.summary.complianceRate}%`);
  lines.push("");
  lines.push("Date,Day,Checked In,Check-In Time,Selected,Outcome");
  for (const e of report.entries) {
    lines.push(
      [
        e.date,
        e.dayName,
        e.checkedIn ? "Yes" : "No",
        e.checkInTime || "",
        e.wasSelected ? "Selected" : "",
        e.outcome === "none" ? "" : e.outcome,
      ].join(",")
    );
  }
  return lines.join("\n");
}

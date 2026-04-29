import { prisma } from "@/lib/prisma";
import { listCalendarEvents, type CalendarEventLite } from "@/lib/gcal";
import { generateCaseNumber } from "@/lib/case-utils";

/**
 * Calendar → Case sync.
 *
 * Reconciles Google Calendar events into our local Appointment table and,
 * for unmatched bookings (typically Square Appointments events without a
 * case number), creates a new donor + case + appointment chain.
 *
 * Matching pipeline runs in priority order:
 *   A) Case number regex in summary or description (in-app phone-intake
 *      events have "Case: TTL-FL-2026-0123" in the description).
 *   B) Attendee email → Contact.email → most recent open case.
 *   C) Phone digits in description → Contact.phone → most recent open case.
 *
 * If none match and the event has a parseable donor name + at least one
 * contact method (email or phone), AUTO-CREATE a new case under the
 * "voluntary" type with `createdBy: "calendar-sync"` so staff can
 * distinguish synthesized cases from manual intake.
 *
 * Safeguards against creating fake cases from unrelated personal events:
 *   - Title must not contain personal-life keywords (lunch, dentist, etc.)
 *   - Event must yield BOTH a parseable name and at least one contact key
 *
 * Idempotent — events with a matching `Appointment.googleEventId` are
 * always skipped.
 */

export type CalendarSyncSkip = {
  eventId: string;
  summary: string | null;
  reason: string;
};

export type CalendarSyncSummary = {
  scanned: number;
  alreadyImported: number;
  linkedToExistingCase: number;
  createdNewCase: number;
  skipped: CalendarSyncSkip[];
  errors: { eventId: string; error: string }[];
  rangeStart: string;
  rangeEnd: string;
};

export type SyncOptions = {
  lookbackDays?: number; // default 7
  lookaheadDays?: number; // default 90
  /** When true, run all matching/parsing but make NO database writes.
   * Returns the same summary as a real run — useful for previewing. */
  dryRun?: boolean;
  /** When false, never auto-create a new case for unmatched events; just
   * skip with reason "no_match_no_autocreate". Default true. */
  autoCreateCases?: boolean;
};

const CASE_NUMBER_REGEX = /TTL-[A-Z]{2}-\d{4}-\d{4}/;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// Heuristics to avoid auto-creating cases from personal calendar events
// that happen to land on the same calendar. Conservative — false negatives
// (real bookings skipped) are better than false positives (fake cases).
const PERSONAL_EVENT_KEYWORDS = [
  "lunch",
  "dinner",
  "breakfast",
  "coffee",
  "dentist",
  "doctor",
  "haircut",
  "gym",
  "workout",
  "personal",
  "vacation",
  "off ",
  "out of office",
  "ooo",
  "birthday",
  "anniversary",
];

function looksPersonal(summary: string | null): boolean {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  return PERSONAL_EVENT_KEYWORDS.some((k) => lower.includes(k));
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function extractPhoneFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(
    /(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})/
  );
  if (!m) return null;
  return m[1] + m[2] + m[3];
}

function extractEmailFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(EMAIL_REGEX);
  return m ? m[0].toLowerCase() : null;
}

function parseDonorName(
  summary: string | null
): { firstName: string; lastName: string } | null {
  if (!summary) return null;
  // Strip common prefixes ("TrueTest — Jane Smith", "Appointment: Jane Smith")
  let cleaned = summary
    .replace(/^TrueTest\s*[—\-:]\s*/i, "")
    .replace(/^Appointment\s*[:\-]\s*/i, "")
    .replace(/^Square\s*[—\-:]\s*/i, "")
    .trim();
  // Strip trailing parenthesized notes ("Jane Smith (5-panel urine)")
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function formatPhoneForStorage(digits10: string): string {
  return `(${digits10.slice(0, 3)}) ${digits10.slice(3, 6)}-${digits10.slice(6)}`;
}

export async function syncCalendarToCases(
  opts: SyncOptions = {}
): Promise<CalendarSyncSummary> {
  const lookbackDays = opts.lookbackDays ?? 7;
  const lookaheadDays = opts.lookaheadDays ?? 90;
  const dryRun = opts.dryRun ?? false;
  const autoCreateCases = opts.autoCreateCases ?? true;

  const rangeStart = new Date(Date.now() - lookbackDays * 86_400_000);
  const rangeEnd = new Date(Date.now() + lookaheadDays * 86_400_000);

  const summary: CalendarSyncSummary = {
    scanned: 0,
    alreadyImported: 0,
    linkedToExistingCase: 0,
    createdNewCase: 0,
    skipped: [],
    errors: [],
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
  };

  const events = await listCalendarEvents(rangeStart, rangeEnd);
  summary.scanned = events.length;
  if (events.length === 0) return summary;

  // Dedupe — find which event IDs already have an Appointment row
  const existing = await prisma.appointment.findMany({
    where: { googleEventId: { in: events.map((e) => e.id) } },
    select: { googleEventId: true },
  });
  const alreadyImported = new Set(
    existing.map((a) => a.googleEventId).filter((v): v is string => !!v)
  );
  summary.alreadyImported = alreadyImported.size;

  for (const event of events) {
    if (alreadyImported.has(event.id)) continue;

    try {
      const matchedCaseId =
        (await matchByCaseNumber(event)) ??
        (await matchByEmail(event)) ??
        (await matchByPhone(event));

      if (matchedCaseId) {
        if (!dryRun) await linkEventToCase(event, matchedCaseId);
        summary.linkedToExistingCase++;
        continue;
      }

      if (!autoCreateCases) {
        summary.skipped.push({
          eventId: event.id,
          summary: event.summary,
          reason: "no_match_autocreate_disabled",
        });
        continue;
      }

      if (looksPersonal(event.summary)) {
        summary.skipped.push({
          eventId: event.id,
          summary: event.summary,
          reason: "looks_like_personal_event",
        });
        continue;
      }

      const created = dryRun
        ? await canAutoCreate(event)
        : await tryAutoCreateCase(event);

      if (created) {
        summary.createdNewCase++;
      } else {
        summary.skipped.push({
          eventId: event.id,
          summary: event.summary,
          reason: "no_donor_info",
        });
      }
    } catch (e) {
      summary.errors.push({
        eventId: event.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return summary;
}

async function matchByCaseNumber(event: CalendarEventLite): Promise<string | null> {
  const haystack = `${event.summary ?? ""}\n${event.description ?? ""}`;
  const m = haystack.match(CASE_NUMBER_REGEX);
  if (!m) return null;
  const c = await prisma.case.findUnique({
    where: { caseNumber: m[0] },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function matchByEmail(event: CalendarEventLite): Promise<string | null> {
  const emails = new Set<string>(event.attendeeEmails);
  const descEmail = extractEmailFromText(event.description);
  if (descEmail) emails.add(descEmail);
  if (emails.size === 0) return null;

  const contact = await prisma.contact.findFirst({
    where: {
      contactType: "donor",
      email: { in: Array.from(emails), mode: "insensitive" },
    },
    select: {
      donorCases: {
        where: { caseStatus: { not: "closed" } },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  return contact?.donorCases[0]?.id ?? null;
}

async function matchByPhone(event: CalendarEventLite): Promise<string | null> {
  const phone = normalizePhone(extractPhoneFromText(event.description));
  if (!phone) return null;

  // Phones in the DB aren't stored in a normalized form. Pull the candidate
  // donor pool (small enough to scan) and compare normalized digits.
  const candidates = await prisma.contact.findMany({
    where: { contactType: "donor", phone: { not: null } },
    select: {
      id: true,
      phone: true,
      donorCases: {
        where: { caseStatus: { not: "closed" } },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  for (const c of candidates) {
    if (normalizePhone(c.phone) === phone) {
      return c.donorCases[0]?.id ?? null;
    }
  }
  return null;
}

async function linkEventToCase(
  event: CalendarEventLite,
  caseId: string
): Promise<void> {
  await prisma.appointment.create({
    data: {
      caseId,
      startTime: event.start,
      endTime: event.end,
      googleEventId: event.id,
      createdBy: "calendar-sync",
      notes: event.summary ?? null,
    },
  });
  await prisma.testOrder.updateMany({
    where: {
      caseId,
      testStatus: "order_created",
      appointmentDate: null,
    },
    data: {
      appointmentDate: event.start,
      collectionSiteType: "truetest",
    },
  });
  await prisma.statusLog.create({
    data: {
      caseId,
      oldStatus: "—",
      newStatus: "appointment_synced",
      changedBy: "calendar-sync",
      note: `Linked Google Calendar event "${event.summary ?? "(no title)"}" (${event.id}) to this case.`,
    },
  });
}

/** Returns true if the event has enough info for tryAutoCreateCase to succeed. */
async function canAutoCreate(event: CalendarEventLite): Promise<boolean> {
  const name = parseDonorName(event.summary);
  if (!name) return false;
  const email = event.attendeeEmails[0] ?? extractEmailFromText(event.description);
  const phone = normalizePhone(extractPhoneFromText(event.description));
  return !!(email || phone);
}

async function tryAutoCreateCase(event: CalendarEventLite): Promise<boolean> {
  const name = parseDonorName(event.summary);
  if (!name) return false;

  const email =
    event.attendeeEmails[0] ?? extractEmailFromText(event.description);
  const phoneDigits = normalizePhone(extractPhoneFromText(event.description));
  if (!email && !phoneDigits) return false;

  // Find or create donor
  let donor = await prisma.contact.findFirst({
    where: {
      contactType: "donor",
      firstName: { equals: name.firstName, mode: "insensitive" },
      lastName: { equals: name.lastName, mode: "insensitive" },
    },
  });
  if (!donor) {
    donor = await prisma.contact.create({
      data: {
        contactType: "donor",
        firstName: name.firstName,
        lastName: name.lastName,
        email: email ?? null,
        phone: phoneDigits ? formatPhoneForStorage(phoneDigits) : null,
        preferredContact: phoneDigits ? "text" : "email",
        represents: "na",
      },
    });
  }

  // Generate next case number for the current year
  const currentYear = new Date().getFullYear();
  const lastCase = await prisma.case.findFirst({
    where: { caseNumber: { startsWith: `TTL-FL-${currentYear}` } },
    orderBy: { caseNumber: "desc" },
  });
  const sequence = lastCase
    ? parseInt(lastCase.caseNumber.split("-").pop() || "0", 10) + 1
    : 1;
  const caseNumber = generateCaseNumber(sequence);

  const newCase = await prisma.case.create({
    data: {
      caseNumber,
      caseType: "voluntary",
      caseStatus: "active",
      donorId: donor.id,
      createdBy: "calendar-sync",
      notes: `Auto-created from Google Calendar event "${event.summary ?? "(no title)"}".`,
    },
  });

  await prisma.caseContact.create({
    data: {
      caseId: newCase.id,
      contactId: donor.id,
      roleInCase: "donor",
      receivesResults: false,
      receivesStatus: true,
      receivesInvoices: false,
      canOrderTests: false,
      isPrimaryContact: false,
    },
  });

  await prisma.appointment.create({
    data: {
      caseId: newCase.id,
      donorId: donor.id,
      startTime: event.start,
      endTime: event.end,
      googleEventId: event.id,
      createdBy: "calendar-sync",
      notes: event.summary ?? null,
    },
  });

  await prisma.statusLog.create({
    data: {
      caseId: newCase.id,
      oldStatus: "—",
      newStatus: "case_created_from_calendar",
      changedBy: "calendar-sync",
      note: `Auto-created from Google Calendar event "${event.summary ?? "(no title)"}" (${event.id}). Donor: ${name.firstName} ${name.lastName}.`,
    },
  });

  return true;
}

import { prisma } from "@/lib/prisma";
import { getBusyIntervals } from "@/lib/gcal";

/**
 * Appointment availability helpers.
 *
 * Business hours are hardcoded constants — TrueTest Labs EGV is M-F 8am-5pm
 * with 30-minute slots, America/Chicago timezone.
 *
 * CRITICAL: All time calculations use explicit UTC construction from
 * YYYY-MM-DD strings + Chicago timezone offset. We NEVER rely on
 * `new Date(y, m, d)` or `setHours()` because those use the server's
 * local timezone, which is UTC on Vercel — off by 5-6 hours from Chicago.
 */

export const BUSINESS_HOURS = {
  startHour: 8,
  endHour: 17,
  slotMinutes: 30,
  daysOfWeek: [1, 2, 3, 4, 5] as number[],
  timeZone: "America/Chicago",
};

export type SlotStatus = "available" | "booked" | "past";

export type Slot = {
  start: string;
  end: string;
  status: SlotStatus;
  appointmentId?: string;
};

/**
 * Convert a YYYY-MM-DD date string + hour (in Chicago) to a UTC Date.
 * Handles DST correctly.
 *
 * Strategy: We want "8 AM in Chicago" → the UTC instant for that.
 * 1. Pretend the Chicago time IS UTC: Date.UTC(y, m-1, d, hour)
 * 2. Ask Intl what Chicago time that UTC instant maps to
 * 3. The difference tells us the offset
 * 4. Apply the offset to get the real UTC time
 */
function chicagoToUtc(dateStr: string, hour: number): Date {
  const [y, m, d] = dateStr.split("-").map(Number);

  // Step 1: Create a "fake" UTC date using the Chicago hour
  const fakeUtc = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));

  // Step 2: What does Chicago read at this UTC instant?
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(fakeUtc);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || "0", 10);
  const chicagoH = get("hour") === 24 ? 0 : get("hour"); // midnight edge case
  const chicagoAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), chicagoH, get("minute"), get("second"));

  // Step 3: offset = what Chicago shows - what UTC is
  // If UTC is 08:00 and Chicago shows 03:00, offset = 3-8 = -5 hours (CDT)
  const offsetMs = chicagoAsUtc - fakeUtc.getTime();

  // Step 4: To get "8 AM Chicago" in UTC, subtract the offset
  // 8 AM Chicago CDT: UTC = 8 - (-5) = 13:00 UTC ✓
  return new Date(Date.UTC(y, m - 1, d, hour, 0, 0) - offsetMs);
}

/**
 * Get day-of-week (0=Sun..6=Sat) for a YYYY-MM-DD in Chicago.
 */
function chicagoDow(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Noon UTC is safe from DST edge cases for getting the correct calendar day
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(ref);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr] ?? 0;
}

/**
 * Generate every 30-minute slot for a given date string (YYYY-MM-DD),
 * using America/Chicago business hours.
 *
 * Accepts a string to avoid timezone-shifting bugs that happen when
 * `new Date(y, m, d)` is used on a UTC server.
 */
export async function getAvailableSlots(dateStr: string): Promise<Slot[]> {
  const dow = chicagoDow(dateStr);
  if (!BUSINESS_HOURS.daysOfWeek.includes(dow)) return [];

  const dayStart = chicagoToUtc(dateStr, BUSINESS_HOURS.startHour);
  const dayEnd = chicagoToUtc(dateStr, BUSINESS_HOURS.endHour);

  const [caseTrackerAppts, googleBusy] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        startTime: { gte: dayStart, lt: dayEnd },
        status: { in: ["booked", "completed"] },
      },
      select: { id: true, startTime: true, endTime: true },
    }),
    getBusyIntervals(dayStart, dayEnd),
  ]);

  const slots: Slot[] = [];
  const now = new Date();
  const slotMs = BUSINESS_HOURS.slotMinutes * 60 * 1000;

  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += slotMs) {
    const start = new Date(t);
    const end = new Date(t + slotMs);

    const trackerClash = caseTrackerAppts.find(
      (a) => a.startTime.getTime() === start.getTime()
    );
    const googleClash = googleBusy.some((b) => b.start < end && b.end > start);

    let status: SlotStatus = "available";
    if (trackerClash || googleClash) status = "booked";
    else if (start < now) status = "past";

    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      status,
      appointmentId: trackerClash?.id,
    });
  }
  return slots;
}

/**
 * Last-second check before inserting an appointment.
 */
export async function isSlotFree(start: Date): Promise<boolean> {
  const end = new Date(start.getTime() + BUSINESS_HOURS.slotMinutes * 60 * 1000);

  const [conflict, googleBusy] = await Promise.all([
    prisma.appointment.findFirst({
      where: {
        status: { in: ["booked", "completed"] },
        startTime: { lt: end },
        endTime: { gt: start },
      },
      select: { id: true },
    }),
    getBusyIntervals(start, end),
  ]);

  if (conflict) return false;
  if (googleBusy.some((b) => b.start < end && b.end > start)) return false;
  return true;
}

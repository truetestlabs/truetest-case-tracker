import { prisma } from "@/lib/prisma";
import { getBusyIntervals } from "@/lib/gcal";

/**
 * Appointment availability helpers.
 *
 * Business hours are hardcoded constants — TrueTest Labs EGV is M-F 8am-5pm
 * with 30-minute slots. When the schedule ever varies (holidays, early
 * closes, second location), move this into a config table.
 *
 * IMPORTANT: All business-hour calculations are done in America/Chicago.
 * The server may be in UTC (Vercel) or local time (dev), so we never use
 * setHours() directly — we construct dates via explicit timezone math.
 */

export const BUSINESS_HOURS = {
  startHour: 8, // 8:00 AM Chicago
  endHour: 17, // 5:00 PM Chicago — last slot starts at 4:30
  slotMinutes: 30,
  daysOfWeek: [1, 2, 3, 4, 5] as number[], // Sun=0 ... Sat=6 → Mon-Fri
  timeZone: "America/Chicago",
};

export type SlotStatus = "available" | "booked" | "past";

export type Slot = {
  start: string; // ISO string — JSON-safe for API responses
  end: string;
  status: SlotStatus;
  appointmentId?: string;
};

/**
 * Convert a YYYY-MM-DD date string + hour (in Chicago time) to a UTC Date.
 * Handles DST correctly by using Intl to find the real UTC offset for that
 * specific date/time in America/Chicago.
 */
function chicagoToUtc(dateStr: string, hour: number, minute = 0): Date {
  // Create a date object in UTC for the given date/time as if it were Chicago
  // Then figure out the real Chicago offset for that moment
  const [y, m, d] = dateStr.split("-").map(Number);

  // Use Intl.DateTimeFormat to get the UTC offset for Chicago at this date/time
  // by formatting a reference date and parsing the offset
  const refDate = new Date(Date.UTC(y, m - 1, d, hour + 6, minute)); // +6 as rough guess to land on correct day
  const chicagoStr = refDate.toLocaleString("en-US", { timeZone: "America/Chicago" });
  const chicagoDate = new Date(chicagoStr);
  const offsetMs = refDate.getTime() - chicagoDate.getTime();

  // Now construct the exact UTC time: Chicago local time + offset = UTC
  return new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0) + offsetMs);
}

/**
 * Get the day-of-week for a date in Chicago timezone.
 */
function chicagoDow(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Create a date at noon UTC — safe from DST edge cases
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).formatToParts(ref);
  const dayName = parts.find((p) => p.type === "weekday")?.value || "";
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayName] ?? ref.getDay();
}

/**
 * Generate every 30-minute slot for a given date (YYYY-MM-DD format),
 * using America/Chicago business hours. Marks each slot as
 * available / booked / past.
 *
 * Returns an empty array for weekends.
 */
export async function getAvailableSlots(date: Date): Promise<Slot[]> {
  // Extract the YYYY-MM-DD that the client intended (from the ?date= param)
  // The `date` param was constructed from YYYY-MM-DD parts in the route handler,
  // so we reconstruct the date string to avoid any timezone shifting.
  const pad = (n: number) => String(n).padStart(2, "0");
  // Use UTC methods since the availability route constructs the date with new Date(y, m-1, d)
  // which uses local time — but on Vercel that's UTC. To be safe, format in Chicago.
  const chicagoFormatted = date.toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); // en-CA gives YYYY-MM-DD
  const dateStr = chicagoFormatted; // YYYY-MM-DD in Chicago time

  const dow = chicagoDow(dateStr);
  if (!BUSINESS_HOURS.daysOfWeek.includes(dow)) return [];

  const dayStart = chicagoToUtc(dateStr, BUSINESS_HOURS.startHour);
  const dayEnd = chicagoToUtc(dateStr, BUSINESS_HOURS.endHour);

  // Pull both sources in parallel
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
 * Last-second check before inserting an appointment. Prevents two staff
 * members on two phones from racing into the same slot.
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

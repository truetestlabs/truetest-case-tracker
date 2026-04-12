import { prisma } from "@/lib/prisma";
import { getBusyIntervals } from "@/lib/gcal";

/**
 * Appointment availability helpers.
 *
 * Business hours are hardcoded constants — TrueTest Labs EGV is M-F 8am-5pm
 * with 30-minute slots. When the schedule ever varies (holidays, early
 * closes, second location), move this into a config table.
 */

export const BUSINESS_HOURS = {
  startHour: 8, // 8:00 AM local (America/Chicago)
  endHour: 17, // 5:00 PM local — last slot starts at 4:30
  slotMinutes: 30,
  daysOfWeek: [1, 2, 3, 4, 5] as number[], // Sun=0 ... Sat=6 → Mon-Fri
};

export type SlotStatus = "available" | "booked" | "past";

export type Slot = {
  start: string; // ISO string — JSON-safe for API responses
  end: string;
  status: SlotStatus;
  appointmentId?: string;
};

/**
 * Generate every 30-minute slot for a given calendar date (interpreted in
 * server local time), marking each as available / booked / past.
 *
 * Returns an empty array for weekends or any day outside BUSINESS_HOURS.
 */
export async function getAvailableSlots(date: Date): Promise<Slot[]> {
  const dow = date.getDay();
  if (!BUSINESS_HOURS.daysOfWeek.includes(dow)) return [];

  const dayStart = new Date(date);
  dayStart.setHours(BUSINESS_HOURS.startHour, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(BUSINESS_HOURS.endHour, 0, 0, 0);

  // Pull both sources in parallel:
  // - case-tracker Appointment rows (belt-and-suspenders in case a booking
  //   wrote to our DB but failed to sync to Google)
  // - Google Calendar busy intervals (the source of truth — includes
  //   Square walk-in bookings synced in from outside)
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
    // Any Google event that overlaps this 30-min window blocks the slot
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
 * members on two phones from racing into the same slot: whoever wins the
 * POST first gets the slot, the second one sees a 409 and picks again.
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

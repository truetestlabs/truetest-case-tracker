import { prisma } from "@/lib/prisma";

/**
 * Appointment availability helpers (v1).
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

  // Any non-cancelled appointment on this day counts as "taken"
  const existing = await prisma.appointment.findMany({
    where: {
      startTime: { gte: dayStart, lt: dayEnd },
      status: { in: ["booked", "completed"] },
    },
    select: { id: true, startTime: true, endTime: true },
  });

  const slots: Slot[] = [];
  const now = new Date();
  const slotMs = BUSINESS_HOURS.slotMinutes * 60 * 1000;

  for (let t = dayStart.getTime(); t < dayEnd.getTime(); t += slotMs) {
    const start = new Date(t);
    const end = new Date(t + slotMs);
    const clash = existing.find((a) => a.startTime.getTime() === start.getTime());
    let status: SlotStatus = "available";
    if (clash) status = "booked";
    else if (start < now) status = "past";
    slots.push({
      start: start.toISOString(),
      end: end.toISOString(),
      status,
      appointmentId: clash?.id,
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
  const conflict = await prisma.appointment.findFirst({
    where: {
      status: { in: ["booked", "completed"] },
      startTime: { lt: end },
      endTime: { gt: start },
    },
    select: { id: true },
  });
  return conflict === null;
}

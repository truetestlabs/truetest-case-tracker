import { NextRequest, NextResponse } from "next/server";
import { getAvailableSlots } from "@/lib/appointments";

/**
 * GET /api/appointments/availability?date=YYYY-MM-DD
 *
 * Returns 30-minute slots for a given local-time date, each marked as
 * available | booked | past. Used by the phone-intake page slot picker.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  if (!dateParam) {
    return NextResponse.json({ error: "date query param required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Parse as local-time midnight (not UTC)
  const [y, m, d] = dateParam.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) {
    return NextResponse.json({ error: "invalid date format" }, { status: 400 });
  }
  const date = new Date(y, m - 1, d);

  try {
    const slots = await getAvailableSlots(date);
    return NextResponse.json({ date: dateParam, slots });
  } catch (error) {
    console.error("[appointments/availability] error:", error);
    return NextResponse.json({ error: "failed to load availability" }, { status: 500 });
  }
}

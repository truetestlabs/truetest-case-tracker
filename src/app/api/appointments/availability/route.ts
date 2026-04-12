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

  // Validate YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: "invalid date format" }, { status: 400 });
  }

  try {
    // Pass the date STRING directly — never go through new Date() which
    // shifts timezone on UTC servers (Vercel).
    const slots = await getAvailableSlots(dateParam);
    return NextResponse.json({ date: dateParam, slots });
  } catch (error) {
    console.error("[appointments/availability] error:", error);
    return NextResponse.json({ error: "failed to load availability" }, { status: 500 });
  }
}

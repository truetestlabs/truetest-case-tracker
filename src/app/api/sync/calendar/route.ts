import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { syncCalendarToCases, type SyncOptions } from "@/lib/calendarSync";

// Sync may take 30+ seconds when scanning a 90-day window with auto-create.
export const maxDuration = 60;

/**
 * POST /api/sync/calendar
 *
 * Reconciles Google Calendar events into the case tracker:
 *   - Phone-intake events → linked to existing case via case-number regex
 *   - Square Appointments events → linked to donor by email/phone, or
 *     auto-create a new case if the donor isn't matched
 *
 * Body (all optional):
 *   {
 *     lookbackDays?: number,    // default 7
 *     lookaheadDays?: number,   // default 90
 *     dryRun?: boolean,         // default false — preview without writing
 *     autoCreateCases?: boolean // default true
 *   }
 *
 * Response:
 *   {
 *     scanned, alreadyImported, linkedToExistingCase, createdNewCase,
 *     skipped: [{ eventId, summary, reason }],
 *     errors: [{ eventId, error }],
 *     rangeStart, rangeEnd
 *   }
 */
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.response) return auth.response;

  let body: SyncOptions = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed;
  } catch {
    // empty body is fine — use defaults
  }

  try {
    const summary = await syncCalendarToCases(body);
    return NextResponse.json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[/api/sync/calendar] error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

/**
 * Gate for Vercel Cron endpoints. Vercel adds
 * `Authorization: Bearer $CRON_SECRET` to scheduled invocations; any
 * unsolicited request gets 401. In dev (no CRON_SECRET set) the check
 * short-circuits to allow manual curl testing.
 *
 * Returns a NextResponse to short-circuit, or null when the request is
 * allowed to proceed.
 */
export function guardCron(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // Dev / unconfigured — don't 401 ourselves.
  const got = request.headers.get("authorization");
  if (got !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientIp, rateLimit } from "@/lib/rateLimit";
import { verifyOtp } from "@/lib/portalOtp";
import { buildSessionPayload, issueTrustedDeviceAndSession } from "@/lib/portalPayload";
import { PORTAL_DEVICE_COOKIE } from "@/lib/portalSession";
import { logPortalEvent, tarpit } from "@/lib/portalAudit";

/**
 * POST /api/portal/otp/verify
 *
 * Body: { scheduleId: string, code: string }
 *
 * Called after /api/portal/login returned `{ otpRequired: true, scheduleId }`.
 * On success: sets the trusted-device + session cookies and returns the
 * same payload shape as the trusted-device login. On failure: returns a
 * 401/423 and logs the attempt.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;

  const gate = rateLimit(`portal-otp-verify:${ip}`, 20, 60_000);
  if (!gate.ok) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  let body: { scheduleId?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const scheduleId = String(body.scheduleId || "").trim();
  const code = String(body.code || "").trim();
  if (!scheduleId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  // Short-circuit if the schedule is already locked.
  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { id: scheduleId },
    select: { id: true, active: true, pinLockedUntil: true },
  });
  if (!schedule || !schedule.active) {
    logPortalEvent({ scheduleId, action: "otp_verify", success: false, reason: "bad_schedule", ipAddress: ip, userAgent });
    return NextResponse.json({ error: "Invalid" }, { status: 404 });
  }
  if (schedule.pinLockedUntil && schedule.pinLockedUntil.getTime() > Date.now()) {
    logPortalEvent({ scheduleId, action: "otp_verify", success: false, reason: "locked", ipAddress: ip, userAgent });
    return NextResponse.json(
      { error: "This PIN is temporarily locked. Try again later or contact the lab." },
      { status: 423 }
    );
  }

  const r = await verifyOtp(scheduleId, code);
  if (!r.ok) {
    await tarpit(20 - gate.remaining);
    logPortalEvent({
      scheduleId,
      action: "otp_verify",
      success: false,
      reason: r.reason,
      ipAddress: ip,
      userAgent,
    });
    if (r.reason === "locked") {
      return NextResponse.json(
        { error: "Too many bad codes. PIN is locked for 1 hour." },
        { status: 423 }
      );
    }
    if (r.reason === "expired") {
      return NextResponse.json({ error: "Code expired. Sign in again to resend." }, { status: 410 });
    }
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  const existingDeviceId = request.cookies.get(PORTAL_DEVICE_COOKIE)?.value || null;
  const payload = await buildSessionPayload(scheduleId);
  const res = NextResponse.json(payload);
  await issueTrustedDeviceAndSession(res, scheduleId, ip, userAgent, existingDeviceId);

  await prisma.checkIn.create({
    data: {
      scheduleId,
      wasSelected: !!payload?.selection,
      selectionId: payload?.selection?.id || null,
      ipAddress: ip === "unknown" ? null : ip,
      userAgent,
    },
  });
  logPortalEvent({
    scheduleId,
    action: "otp_verify",
    success: true,
    ipAddress: ip,
    userAgent,
  });
  return res;
}

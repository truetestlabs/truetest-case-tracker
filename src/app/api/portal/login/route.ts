import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { setPortalSession, PORTAL_DEVICE_COOKIE } from "@/lib/portalSession";
import { issueOtp } from "@/lib/portalOtp";
import { logPortalEvent, tarpit } from "@/lib/portalAudit";
import { buildSessionPayload } from "@/lib/portalPayload";

/** Partially obscure an email for display — e.g. `m••••@mac.com`. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
}

/**
 * POST /api/portal/login  (PUBLIC — no staff session)
 *
 * Donor login flow. The client posts `{ pin, deviceId? }`. Possible outcomes:
 *
 *   1. `pinLockedUntil > now`                → 423 "locked"
 *   2. PIN doesn't match                     → 404 "invalid_pin" (tarpit)
 *   3. PIN matches + deviceId is a trusted,
 *      non-revoked device for this schedule  → success: set session cookie,
 *                                              return the session payload
 *   4. PIN matches + no trusted device       → 202 "otp_required": issue
 *                                              email OTP to donor email on
 *                                              file; client prompts for the
 *                                              code
 *
 * Rate-limiting:
 *   - 10/min/IP on this route
 *   - Per-schedule lockout is enforced in portalOtp.verifyOtp
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent") || null;

  const gate = rateLimit(`portal-login:${ip}`, 10, 60_000);
  if (!gate.ok) {
    logPortalEvent({ action: "login", success: false, reason: "ip_rate_limited", ipAddress: ip, userAgent });
    return NextResponse.json(
      { error: "Too many attempts. Please wait a minute and try again." },
      { status: 429 }
    );
  }

  let body: { pin?: string; deviceId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = String(body.pin || "").trim();
  // Allow client to pass deviceId explicitly (from localStorage fallback) or
  // rely on the device cookie below.
  const submittedDeviceId =
    String(body.deviceId || "").trim() ||
    request.cookies.get(PORTAL_DEVICE_COOKIE)?.value ||
    null;

  if (!pin || pin.length < 4) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 400 });
  }

  const schedule = await prisma.monitoringSchedule.findUnique({
    where: { checkInPin: pin },
    include: {
      case: {
        select: {
          donor: { select: { firstName: true, lastName: true, phone: true, email: true } },
        },
      },
      testCatalog: { select: { testName: true } },
    },
  });

  if (!schedule || !schedule.active) {
    await tarpit(10 - gate.remaining);
    logPortalEvent({ action: "login", success: false, reason: "invalid_pin", ipAddress: ip, userAgent });
    return NextResponse.json({ error: "Invalid PIN" }, { status: 404 });
  }

  // Lockout gate — someone hit the OTP fail threshold recently.
  if (schedule.pinLockedUntil && schedule.pinLockedUntil.getTime() > Date.now()) {
    logPortalEvent({
      scheduleId: schedule.id,
      action: "login",
      success: false,
      reason: "locked",
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      { error: "This PIN is temporarily locked. Try again later or contact the lab." },
      { status: 423 }
    );
  }

  // Trusted-device fast path.
  const trustedDevice = submittedDeviceId
    ? await prisma.trustedDevice.findUnique({ where: { deviceId: submittedDeviceId } })
    : null;

  const deviceOk =
    trustedDevice &&
    trustedDevice.scheduleId === schedule.id &&
    !trustedDevice.revokedAt;

  if (!deviceOk) {
    // Untrusted device — challenge with an email OTP to the donor's address.
    const email = schedule.case.donor?.email || null;
    const phone = schedule.case.donor?.phone || null;
    if (!email) {
      logPortalEvent({
        scheduleId: schedule.id,
        action: "login",
        success: false,
        reason: "no_donor_email",
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        { error: "No email on file for this donor. Contact the lab to update your contact info." },
        { status: 409 }
      );
    }
    const r = await issueOtp(schedule.id, email, phone);
    if (!r.ok) {
      logPortalEvent({
        scheduleId: schedule.id,
        action: "otp_request",
        success: false,
        reason: r.reason || "issue_failed",
        ipAddress: ip,
        userAgent,
      });
      return NextResponse.json(
        { error: "Too many code requests. Try again in an hour." },
        { status: 429 }
      );
    }
    logPortalEvent({
      scheduleId: schedule.id,
      action: "otp_request",
      success: true,
      ipAddress: ip,
      userAgent,
    });
    return NextResponse.json(
      {
        otpRequired: true,
        scheduleId: schedule.id,
        emailMasked: maskEmail(email),
      },
      { status: 202 }
    );
  }

  // Trusted device — issue session cookie + return payload.
  await prisma.trustedDevice.update({
    where: { id: trustedDevice!.id },
    data: {
      lastSeenAt: new Date(),
      userAgent: userAgent ?? trustedDevice!.userAgent,
      ipAddress: ip === "unknown" ? null : ip,
    },
  });

  const payload = await buildSessionPayload(schedule.id);
  const res = NextResponse.json(payload);
  setPortalSession(res, schedule.id, trustedDevice!.deviceId);

  await prisma.checkIn.create({
    data: {
      scheduleId: schedule.id,
      wasSelected: !!payload?.selection,
      selectionId: payload?.selection?.id || null,
      ipAddress: ip === "unknown" ? null : ip,
      userAgent,
    },
  });
  logPortalEvent({
    scheduleId: schedule.id,
    action: "login",
    success: true,
    reason: "trusted_device",
    ipAddress: ip,
    userAgent,
  });
  return res;
}


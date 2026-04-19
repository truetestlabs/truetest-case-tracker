/**
 * One-time email code issuance + verification for donor-portal logins
 * from an untrusted device.
 *
 * Flow:
 *   1. Donor enters PIN on a device with no `ttl_portal_device` cookie
 *      (or whose device was revoked).
 *   2. We call `issueOtp(scheduleId, email)` which creates a PortalOtp row
 *      (5-minute TTL, SHA256-hashed code) and emails the 6-digit code via
 *      Resend. Email was chosen over SMS because our Twilio numbers lack
 *      toll-free verification / A2P 10DLC registration — carriers silently
 *      drop the texts. Resend delivery is reliable.
 *   3. Donor types the code; `verifyOtp(scheduleId, code)` consumes the
 *      most recent unconsumed row for the schedule. On success we return
 *      ok; on failure we increment `attempts` and after 5 we lock the
 *      schedule for an hour.
 */
import { createHash, randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendPortalOtpEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rateLimit";

const OTP_TTL_MS = 5 * 60 * 1000;      // 5 min
const MAX_ATTEMPTS_PER_OTP = 5;
const LOCKOUT_MS = 60 * 60 * 1000;     // 1 hour
const LOCKOUT_THRESHOLD = 5;           // after 5 cumulative OTP fails → lock schedule

function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function newCode(): string {
  // Cryptographically random 6-digit, zero-padded.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Request a new OTP. Rate-limited to 3/hour/schedule so an attacker who
 * knows a valid PIN can't run up the Resend bill. Returns `ok:false` if
 * over the limit; otherwise creates + sends. The caller is responsible
 * for verifying the PIN before calling.
 *
 * The `phone` on the PortalOtp row is kept for audit/backwards-compat; it's
 * not used for delivery.
 */
export async function issueOtp(
  scheduleId: string,
  email: string,
  phone: string | null = null
): Promise<{ ok: boolean; reason?: string }> {
  const gate = rateLimit(`portal-otp:${scheduleId}`, 3, 60 * 60 * 1000);
  if (!gate.ok) return { ok: false, reason: "too_many_requests" };

  const code = newCode();
  await prisma.portalOtp.create({
    data: {
      scheduleId,
      phone: phone ?? "",
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  await sendPortalOtpEmail({ toEmail: email, code });

  return { ok: true };
}

/**
 * Verify a submitted code against the most recent unconsumed OTP for the
 * schedule. On success the row is marked consumed and we zero the fail
 * counter. On failure we increment and, if cumulative OTP failures on this
 * schedule cross the threshold, we set pinLockedUntil.
 */
export async function verifyOtp(
  scheduleId: string,
  code: string
): Promise<{ ok: boolean; reason?: "no_otp" | "expired" | "too_many_attempts" | "bad_code" | "locked" }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "bad_code" };

  const otp = await prisma.portalOtp.findFirst({
    where: { scheduleId, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false, reason: "no_otp" };
  if (otp.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  if (otp.attempts >= MAX_ATTEMPTS_PER_OTP) return { ok: false, reason: "too_many_attempts" };

  const match = hashCode(code) === otp.codeHash;

  if (!match) {
    await prisma.portalOtp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    // Bump cumulative schedule-level fail counter; lock when threshold hit.
    const sched = await prisma.monitoringSchedule.update({
      where: { id: scheduleId },
      data: { pinFailCount: { increment: 1 } },
      select: { pinFailCount: true },
    });
    if (sched.pinFailCount >= LOCKOUT_THRESHOLD) {
      await prisma.monitoringSchedule.update({
        where: { id: scheduleId },
        data: { pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) },
      });
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "bad_code" };
  }

  // Success — consume the OTP and reset the fail counter.
  await prisma.$transaction([
    prisma.portalOtp.update({
      where: { id: otp.id },
      data: { consumedAt: new Date() },
    }),
    prisma.monitoringSchedule.update({
      where: { id: scheduleId },
      data: { pinFailCount: 0, pinLockedUntil: null },
    }),
  ]);

  return { ok: true };
}

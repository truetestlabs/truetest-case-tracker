/**
 * Donor-portal session cookie.
 *
 * Encodes `{ scheduleId, deviceId, iat }` and signs it with HMAC-SHA256
 * using `PORTAL_SESSION_SECRET`. The cookie is the proof of a completed
 * PIN + trusted-device (or PIN + OTP) login — presenting it on a future
 * request is equivalent to re-typing the PIN.
 *
 * Cookie attributes: HttpOnly + Secure + SameSite=Lax so that:
 *   - JS on the page cannot read the cookie (mitigates XSS exfiltration).
 *   - It only travels over HTTPS (mitigates wifi sniffing).
 *   - It IS sent on top-level GET navigations (so donors clicking the
 *     portal link from their instructions email / SMS land logged-in
 *     instead of getting OTP-challenged every time — Strict breaks this
 *     on iOS Safari and Chrome's link-handling).
 *   - It is NOT sent on cross-site POST/iframe requests (mitigates CSRF
 *     to state-changing endpoints without needing a separate token layer).
 *
 * Revocation: a TrustedDevice row is created alongside the cookie and the
 * cookie is rejected if that row has `revokedAt` set. Staff can revoke a
 * stolen device from the schedule UI without invalidating other sessions.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

export const PORTAL_COOKIE = "ttl_portal_session";
export const PORTAL_DEVICE_COOKIE = "ttl_portal_device";

// 30 days. Trusted device + session ride together — the cookie expires,
// but the TrustedDevice row persists so re-login from the same device
// skips OTP as long as it isn't revoked.
const SESSION_TTL_SEC = 60 * 60 * 24 * 30;

type SessionPayload = {
  scheduleId: string;
  deviceId: string;
  iat: number; // issued-at, unix seconds
};

function secret(): string {
  const s = process.env.PORTAL_SESSION_SECRET;
  if (!s) throw new Error("PORTAL_SESSION_SECRET is not set");
  return s;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(s: string): Buffer {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: SessionPayload): string {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64urlEncode(
    createHmac("sha256", secret()).update(body, "utf8").digest()
  );
  return `${body}.${sig}`;
}

function verifySig(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64urlEncode(
    createHmac("sha256", secret()).update(body, "utf8").digest()
  );
  // Timing-safe compare.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (
      typeof payload?.scheduleId !== "string" ||
      typeof payload?.deviceId !== "string" ||
      typeof payload?.iat !== "number"
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Attach a fresh session cookie to a response. Also writes a
 * companion device cookie so the client can present its deviceId
 * (for OTP-skip) before completing a PIN auth on a subsequent login.
 */
export function setPortalSession(
  res: NextResponse,
  scheduleId: string,
  deviceId: string
) {
  const token = sign({ scheduleId, deviceId, iat: Math.floor(Date.now() / 1000) });
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SEC,
  };
  res.cookies.set(PORTAL_COOKIE, token, cookieOpts);
  // Device cookie intentionally NOT HttpOnly-signed — it holds the
  // deviceId so the JS login form can send it to /api/portal/login
  // to skip OTP. Even if read by a rogue script, alone it is useless
  // without a valid PIN on an IP/UA the attacker will have to survive.
  res.cookies.set(PORTAL_DEVICE_COOKIE, deviceId, {
    httpOnly: false,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 400, // ~13 months — persists across session cookie rotations
  });
}

export function clearPortalSession(res: NextResponse) {
  res.cookies.set(PORTAL_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Read + verify the portal cookie. Returns the active TrustedDevice and
 * its schedule if the cookie is valid, signature checks out, and the
 * device hasn't been revoked. Never throws.
 */
export async function getPortalSession(request: NextRequest) {
  const token = request.cookies.get(PORTAL_COOKIE)?.value;
  if (!token) return null;

  let payload: SessionPayload | null;
  try {
    payload = verifySig(token);
  } catch {
    return null;
  }
  if (!payload) return null;

  // Enforce absolute session lifetime — redundant with cookie maxAge but
  // useful if someone restores a cookie from a backup.
  const age = Math.floor(Date.now() / 1000) - payload.iat;
  if (age < 0 || age > SESSION_TTL_SEC) return null;

  const device = await prisma.trustedDevice.findUnique({
    where: { deviceId: payload.deviceId },
    include: { schedule: { select: { id: true, active: true, pinLockedUntil: true } } },
  });

  if (!device) return null;
  if (device.revokedAt) return null;
  if (device.scheduleId !== payload.scheduleId) return null;
  if (!device.schedule.active) return null;

  // Touch last-seen for staff visibility.
  prisma.trustedDevice
    .update({ where: { id: device.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {}); // fire-and-forget

  return { scheduleId: device.scheduleId, deviceId: device.deviceId, deviceRowId: device.id };
}

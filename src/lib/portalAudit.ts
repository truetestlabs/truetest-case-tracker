/**
 * Donor-portal event log — a narrow, schedule-scoped analogue to AuditLog
 * (which is keyed on User, and donors are not Users). Used for forensics
 * after an incident and as the source-of-truth for anomaly alerts.
 *
 * Fire-and-forget: never block the calling request on log failure.
 */
import { prisma } from "@/lib/prisma";

export type PortalEventAction = "login" | "otp_request" | "otp_verify" | "logout" | "acknowledge" | "pdf_fetch";

export async function logPortalEvent(params: {
  scheduleId?: string | null;
  action: PortalEventAction;
  success: boolean;
  reason?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.portalLoginAttempt.create({
      data: {
        scheduleId: params.scheduleId ?? null,
        action: params.action,
        success: params.success,
        reason: params.reason ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
      },
    });
  } catch (e) {
    console.error("[portalAudit] failed to log:", e);
  }
}

/**
 * Progressive delay on failed auth — turns a 10/s brute-force script into
 * ~1/s without real donors noticing. Keyed on a simple counter so repeat
 * failures from the same IP keep getting slower. Safe to call with 0.
 */
export async function tarpit(failCount: number): Promise<void> {
  // 0 → no wait, 1 → 500ms, 2 → 1000ms, 3+ → 2500ms
  const ms = failCount <= 0 ? 0 : failCount === 1 ? 500 : failCount === 2 ? 1000 : 2500;
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

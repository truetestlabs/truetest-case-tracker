import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";
import { getClientIp } from "@/lib/rateLimit";

/**
 * Extract request context (IP + user-agent) for audit enrichment.
 * Call this once in your handler and spread into the metadata object.
 */
export function auditContext(request: NextRequest): { ip: string; userAgent: string | null } {
  return {
    ip: getClientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
  };
}

/**
 * Log an audit event. Fire-and-forget — errors are logged but never
 * block the calling request.
 */
export async function logAudit(params: {
  userId: string;
  action: string;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        resource: params.resource || null,
        resourceId: params.resourceId || null,
        metadata: params.metadata ? JSON.parse(JSON.stringify(params.metadata)) : undefined,
      },
    });
  } catch (e) {
    console.error("[audit] failed to log:", e);
  }
}

import { prisma } from "@/lib/prisma";

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

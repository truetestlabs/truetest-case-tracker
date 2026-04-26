import type { Prisma, TestOrder, PatchPanel } from "@prisma/client";

/**
 * Creates a TestOrder and, when `specimenType === 'sweat_patch'`, also
 * creates the associated PatchDetails row in the same transaction.
 *
 * Why this exists: sweat-patch orders carry lifecycle state (panel,
 * application/removal dates, executed-CoC tracking, cancellation kind)
 * that lives on PatchDetails — never on TestOrder itself. The invariant
 * we're protecting is "every sweat-patch TestOrder has exactly one
 * PatchDetails row." Routing all creates through this helper keeps that
 * invariant true from the moment the order lands in the DB; otherwise
 * any new create site silently produces orphans (we already have 8 such
 * orphans in prod from before this helper existed — see the handoff doc).
 *
 * Caller contract:
 *   - MUST be called inside a `prisma.$transaction(async (tx) => ...)`
 *     so the order + PatchDetails commit atomically. The function takes
 *     a `tx: Prisma.TransactionClient` rather than the global `prisma`
 *     to enforce this at the type level.
 *   - `patchPanel` is optional; defaults to 'WA07' for sweat-patch
 *     orders (the standard CRL panel — ~95% of cases per product).
 *     Pass 'WC82' explicitly for expanded-panel orders, or leave the
 *     default and edit later via the order detail page.
 *   - For non-sweat-patch specimen types, `patchPanel` is ignored.
 */
export async function createTestOrderWithPatchDetails(
  tx: Prisma.TransactionClient,
  data: Prisma.TestOrderUncheckedCreateInput,
  options: { patchPanel?: PatchPanel } = {},
): Promise<TestOrder> {
  const order = await tx.testOrder.create({ data });

  if (order.specimenType === "sweat_patch") {
    await tx.patchDetails.create({
      data: {
        testOrderId: order.id,
        panel: options.patchPanel ?? "WA07",
      },
    });
  }

  return order;
}

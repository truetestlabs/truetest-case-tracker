/**
 * One-off deletion of Michael Gammel's test sweat-patch stub from prod.
 *
 * Background: during the Bug 1 / Bug 2 investigation, five sweat-patch
 * PatchDetails stubs were identified in prod. Four are real donors
 * (Mundt x2, Tanner, Bartlett); one is Michael's own test row. Per
 * Adjustment 4 of the bug-fix approval, the test row is to be deleted
 * entirely — both the PatchDetails row and the parent TestOrder row.
 *
 * Target — confirmed test data, not real:
 *   - Case:         TTL-FL-2026-0058 (cmo5u6xsh0004la04ortboi5j)
 *   - Donor:        Mike Gammel
 *   - TestOrder:    cmor72fee000tl704eo0ebu19
 *   - PatchDetails: cmor72fes000vl704v9avj4yl
 *
 * Safety:
 *   - Dry-run by default; pass --apply to actually delete.
 *   - Verifies donor name + caseId + testOrderId fingerprints before
 *     deleting. Aborts if any check mismatches.
 *   - Wraps both deletes in a single transaction so we don't end up
 *     with an orphan PatchDetails or TestOrder if one half fails.
 *   - Cascades on related rows (StatusLog) handled by the schema —
 *     TestOrder.onDelete=Cascade for PatchDetails (verified in
 *     prisma/schema.prisma:487). StatusLog FK is not Cascade, so we
 *     delete those explicitly first; same pattern as the
 *     /api/cases/[id]/test-orders DELETE handler.
 *
 * Run order: independent of the data-correction script. Can run any
 * time after Michael approves the deletion.
 *
 * Run:  npx tsx scripts/delete-mike-gammel-test-stub.ts          (dry-run)
 *       npx tsx scripts/delete-mike-gammel-test-stub.ts --apply  (delete)
 */
import { prisma } from "@/lib/prisma";

const TARGET = {
  patchDetailsId: "cmor72fes000vl704v9avj4yl",
  expectedTestOrderId: "cmor72fee000tl704eo0ebu19",
  expectedCaseId: "cmo5u6xsh0004la04ortboi5j",
  expectedDonorLower: "mike gammel",
};

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "[delete-mike-gammel-test-stub] APPLY mode — rows will be deleted."
      : "[delete-mike-gammel-test-stub] DRY-RUN mode — no deletes. Pass --apply to execute.",
  );

  const pd = await prisma.patchDetails.findUnique({
    where: { id: TARGET.patchDetailsId },
    include: {
      testOrder: {
        include: {
          case: { include: { donor: true } },
        },
      },
    },
  });

  if (!pd) {
    console.log(
      `[delete-mike-gammel-test-stub] PatchDetails ${TARGET.patchDetailsId} not found — already deleted? No-op.`,
    );
    await prisma.$disconnect();
    return;
  }

  const donor = pd.testOrder.case.donor;
  const actualDonorLower = `${donor?.firstName ?? ""} ${donor?.lastName ?? ""}`
    .toLowerCase()
    .trim();

  const checks: Array<[string, unknown, unknown]> = [
    ["testOrderId", pd.testOrderId, TARGET.expectedTestOrderId],
    ["caseId", pd.testOrder.caseId, TARGET.expectedCaseId],
    ["donor", actualDonorLower, TARGET.expectedDonorLower],
  ];
  let mismatched = false;
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) {
      console.error(
        `  ✗ ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
      );
      mismatched = true;
    }
  }
  if (mismatched) {
    console.error(
      "[delete-mike-gammel-test-stub] Fingerprint mismatch. Refusing to delete.",
    );
    process.exit(1);
  }

  // Audit-trail counts for the dry-run printout.
  const [statusLogCount, documentCount, labResultCount] = await Promise.all([
    prisma.statusLog.count({ where: { testOrderId: pd.testOrderId } }),
    prisma.document.count({ where: { testOrderId: pd.testOrderId } }),
    prisma.labResult.count({ where: { testOrderId: pd.testOrderId } }),
  ]);

  console.log(`  • donor:           ${actualDonorLower}`);
  console.log(`  • case:            ${pd.testOrder.caseId}`);
  console.log(`  • testOrderId:     ${pd.testOrderId}`);
  console.log(`  • patchDetailsId:  ${pd.id}`);
  console.log(`  • StatusLog rows:  ${statusLogCount}  (will be deleted)`);
  console.log(`  • Document rows:   ${documentCount}   (will block deletion if > 0)`);
  console.log(`  • LabResult rows:  ${labResultCount}  (will block deletion if > 0)`);

  if (documentCount > 0 || labResultCount > 0) {
    console.error(
      "[delete-mike-gammel-test-stub] Unexpected child rows present. Aborting — investigate before deleting.",
    );
    process.exit(1);
  }

  console.log(`  → will delete: StatusLog × ${statusLogCount}, then PatchDetails, then TestOrder.`);

  if (!apply) {
    console.log(
      "\n[delete-mike-gammel-test-stub] DRY-RUN complete. Re-run with --apply to delete.",
    );
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.statusLog.deleteMany({ where: { testOrderId: pd.testOrderId } });
    // PatchDetails has FK testOrderId → TestOrder onDelete=Cascade, so
    // deleting the TestOrder also drops the PatchDetails row. We delete
    // the PatchDetails explicitly first to keep the operation order
    // mirrored to the dry-run printout.
    await tx.patchDetails.delete({ where: { id: pd.id } });
    await tx.testOrder.delete({ where: { id: pd.testOrderId } });
  });

  console.log(
    "\n[delete-mike-gammel-test-stub] APPLY complete. Rows deleted.",
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[delete-mike-gammel-test-stub] fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});

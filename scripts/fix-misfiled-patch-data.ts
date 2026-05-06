/**
 * One-off data correction for two sweat-patch stubs in prod where staff
 * entered patch application dates via the Edit modal but the data landed
 * on TestOrder.collectionDate instead of PatchDetails.applicationDate.
 *
 * Background: see the investigation that produced commit d6fcf91. The
 * Edit modal's "Application Date" label wrote to the form field named
 * collectionDate, which the PATCH endpoint routed to TestOrder. The
 * fix in d6fcf91 closes the bug going forward; this script moves the
 * already-misfiled values to the right column for the two affected
 * stubs, and leaves TestOrder.collectionDate in place (no breakage of
 * code that reads it).
 *
 * Targets — confirmed by Michael against TestVault records:
 *   - Mundt    PatchDetails cmomybij2... → applicationDate = 2026-05-05
 *   - Bartlett PatchDetails cmorfe4o6... → applicationDate = 2026-05-04
 *
 * The third row that has TestOrder.collectionDate set (the Mike Gammel
 * test stub cmor72fes...) is NOT in scope for this script — it is
 * deleted entirely by scripts/delete-mike-gammel-test-stub.ts.
 *
 * Safety:
 *   - Dry-run by default; pass --apply to actually write.
 *   - Verifies expected donor + expected collectionDate before writing.
 *   - Refuses to overwrite a non-null PatchDetails.applicationDate.
 *   - Aborts the entire run if any single row fails verification.
 *   - Each successful update prints before/after for the audit trail.
 *
 * Run order:
 *   1. Bug fix d6fcf91 deployed and verified working on at least one
 *      real stub.
 *   2. Dry-run: `npx tsx scripts/fix-misfiled-patch-data.ts`
 *      (DATABASE_URL must point at prod; nothing is written.)
 *   3. Apply: `npx tsx scripts/fix-misfiled-patch-data.ts --apply`
 */
import { prisma } from "@/lib/prisma";

type Target = {
  patchDetailsId: string;
  expectedTestOrderId: string;
  expectedCaseId: string;
  expectedDonorLower: string;
  expectedCollectionDateYmd: string;
};

const TARGETS: Target[] = [
  {
    patchDetailsId: "cmomybij2000ljr04f5lwujv0",
    expectedTestOrderId: "cmomybiip000jjr04opp0moac",
    expectedCaseId: "cmnhpys7o00097v7vlcqx18lu",
    expectedDonorLower: "benjamin mundt",
    expectedCollectionDateYmd: "2026-05-05",
  },
  {
    patchDetailsId: "cmorfe4o60009la04pd2yhg50",
    expectedTestOrderId: "cmorfe4nu0007la04f2ibg0dt",
    expectedCaseId: "cmnge56y1000o7ve3j92zikm8",
    expectedDonorLower: "chris bartlett",
    expectedCollectionDateYmd: "2026-05-04",
  },
];

function utcDateYmd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "[fix-misfiled-patch-data] APPLY mode — writes will be performed."
      : "[fix-misfiled-patch-data] DRY-RUN mode — no writes. Pass --apply to execute.",
  );

  let anyFailed = false;

  for (const t of TARGETS) {
    console.log(`\n[${t.patchDetailsId}] checking…`);

    const pd = await prisma.patchDetails.findUnique({
      where: { id: t.patchDetailsId },
      include: {
        testOrder: {
          include: {
            case: { include: { donor: true } },
          },
        },
      },
    });

    if (!pd) {
      console.error(`  ✗ PatchDetails not found.`);
      anyFailed = true;
      continue;
    }

    const donor = pd.testOrder.case.donor;
    const actualDonorLower = `${donor?.firstName ?? ""} ${donor?.lastName ?? ""}`
      .toLowerCase()
      .trim();
    const actualCollYmd = utcDateYmd(pd.testOrder.collectionDate);

    // Verify the row matches the expected fingerprint. If anything has
    // shifted since the investigation, we abort instead of writing to a
    // potentially-different row.
    const checks: Array<[string, unknown, unknown]> = [
      ["testOrderId", pd.testOrderId, t.expectedTestOrderId],
      ["caseId", pd.testOrder.caseId, t.expectedCaseId],
      ["donor", actualDonorLower, t.expectedDonorLower],
      ["collectionDateYmd", actualCollYmd, t.expectedCollectionDateYmd],
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
      anyFailed = true;
      continue;
    }

    if (pd.applicationDate !== null) {
      console.log(
        `  • applicationDate already set to ${utcDateYmd(pd.applicationDate)} — skipping (no-op).`,
      );
      continue;
    }

    const newApplicationDate = pd.testOrder.collectionDate;
    if (!newApplicationDate) {
      // Belt-and-suspenders: collectionDateYmd matched expected, so
      // collectionDate must be non-null. Guard for the type-narrowing.
      console.error(`  ✗ collectionDate is null after passing the YMD check — bug.`);
      anyFailed = true;
      continue;
    }

    console.log(
      `  • donor:               ${actualDonorLower}`,
    );
    console.log(
      `  • current applicationDate: null`,
    );
    console.log(
      `  • current collectionDate:  ${newApplicationDate.toISOString()}`,
    );
    console.log(
      `  → will set PatchDetails.applicationDate = ${newApplicationDate.toISOString()}`,
    );
    console.log(
      `  → TestOrder.collectionDate left unchanged.`,
    );

    if (apply) {
      const updated = await prisma.patchDetails.update({
        where: { id: t.patchDetailsId },
        data: { applicationDate: newApplicationDate },
      });
      console.log(
        `  ✓ wrote applicationDate=${updated.applicationDate?.toISOString() ?? "null"}.`,
      );
    }
  }

  if (anyFailed) {
    console.error(
      "\n[fix-misfiled-patch-data] One or more rows failed verification. No partial writes were performed beyond rows that passed.",
    );
    process.exit(1);
  }

  console.log(
    apply
      ? "\n[fix-misfiled-patch-data] APPLY complete."
      : "\n[fix-misfiled-patch-data] DRY-RUN complete. Re-run with --apply to write.",
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("[fix-misfiled-patch-data] fatal:", e);
  await prisma.$disconnect();
  process.exit(1);
});

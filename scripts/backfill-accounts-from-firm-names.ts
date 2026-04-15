/**
 * One-off backfill: promote the free-text Contact.firmName field into
 * normalized Account rows, and link existing Cases to the right account
 * through their referring_party CaseContacts.
 *
 * Idempotent:
 *   - Accounts are upserted by normalized name, so re-running never
 *     duplicates.
 *   - Contact.accountId is set only if unset (existing links are kept).
 *   - Case.referringAccountId is set only if unset.
 *
 * Does NOT delete Contact.firmName — that field stays as a transitional
 * display string so existing UI keeps working while we migrate callers.
 *
 * Run with: set -a && source .env && set +a && npx tsx scripts/backfill-accounts-from-firm-names.ts
 */
import { prisma } from "@/lib/prisma";

// Normalization: lowercase, trim, collapse whitespace, strip common
// trailing punctuation. The normalized form is ONLY used for deduping —
// we store the original casing/formatting on Account.name.
function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .toLowerCase();
}

async function main() {
  console.log("=== Backfill: Contact.firmName → Account ===\n");

  // 1. Collect every distinct firmName currently on Contact.
  const contacts = await prisma.contact.findMany({
    where: { firmName: { not: null } },
    select: { id: true, firmName: true, accountId: true },
  });

  console.log(`Contacts with firmName: ${contacts.length}`);

  // Group by normalized name, preserving the first-seen original casing
  // for Account.name.
  const groups = new Map<string, { displayName: string; contactIds: string[] }>();
  for (const c of contacts) {
    if (!c.firmName) continue;
    const norm = normalize(c.firmName);
    if (!norm) continue;
    const existing = groups.get(norm);
    if (existing) {
      existing.contactIds.push(c.id);
    } else {
      groups.set(norm, { displayName: c.firmName.trim(), contactIds: [c.id] });
    }
  }

  console.log(`Distinct normalized firm names: ${groups.size}\n`);

  let accountsCreated = 0;
  let accountsFound = 0;
  let contactsLinked = 0;
  let casesLinked = 0;

  for (const [norm, { displayName, contactIds }] of groups) {
    // 2. Find or create the Account. Match by case-insensitive name so a
    // second run doesn't duplicate a previously-created account that we
    // already upserted, even if someone normalized whitespace differently.
    const existing = await prisma.account.findFirst({
      where: { name: { equals: displayName, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    let accountId: string;
    if (existing) {
      accountId = existing.id;
      accountsFound++;
    } else {
      const created = await prisma.account.create({
        data: {
          name: displayName,
          type: "other",
          active: true,
        },
        select: { id: true },
      });
      accountId = created.id;
      accountsCreated++;
    }

    console.log(
      `  "${displayName}" (${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}) → ${
        existing ? "existing" : "created"
      } account ${accountId}`
    );

    // 3. Link contacts that don't already have an accountId.
    const linked = await prisma.contact.updateMany({
      where: {
        id: { in: contactIds },
        accountId: null,
      },
      data: { accountId },
    });
    contactsLinked += linked.count;

    // 4. For each contact now attached to this account, find every Case
    // where that contact holds a "referring-ish" role and backfill
    // referringAccountId if it isn't already set.
    //
    // The roleInCase enum has `referring_party` but in practice (audited
    // against live data) attorneys are tagged with petitioner_attorney,
    // respondent_attorney, or gal instead. Precedence is applied via
    // multiple passes below: an earlier pass wins and the later passes
    // skip cases that already have an account set.
    const rolePrecedence: Array<
      "referring_party" | "petitioner_attorney" | "respondent_attorney" | "gal"
    > = ["referring_party", "petitioner_attorney", "respondent_attorney", "gal"];

    for (const role of rolePrecedence) {
      const links = await prisma.caseContact.findMany({
        where: { contactId: { in: contactIds }, roleInCase: role },
        select: { caseId: true },
      });
      const caseIds = [...new Set(links.map((cc) => cc.caseId))];
      if (caseIds.length === 0) continue;

      const updated = await prisma.case.updateMany({
        where: {
          id: { in: caseIds },
          referringAccountId: null, // skip already-set cases (precedence)
        },
        data: { referringAccountId: accountId },
      });
      casesLinked += updated.count;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Accounts created:   ${accountsCreated}`);
  console.log(`Accounts reused:    ${accountsFound}`);
  console.log(`Contacts linked:    ${contactsLinked}`);
  console.log(`Cases linked:       ${casesLinked}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

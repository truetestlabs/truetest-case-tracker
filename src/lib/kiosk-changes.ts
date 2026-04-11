import { prisma } from "@/lib/prisma";
import type { IntakeDraft } from "@prisma/client";

/**
 * Structured diff describing what a returning client changed vs. the info
 * already on file in their most recent case. When every field is empty,
 * `detectChanges` returns null — signaling to the POST /api/kiosk/intake
 * handler that it's safe to auto-approve the draft silently.
 */
export type DetectedChanges = {
  phone?: { old: string | null; new: string };
  email?: { old: string | null; new: string };
  caseType?: { old: string; new: string };
  attorneysAdded?: Array<{ name: string; firm?: string }>;
  galAdded?: { name: string; firm?: string };
  evaluatorsAdded?: Array<{ name: string; firm?: string }>;
  recipientsAdded?: Array<{ name?: string; email: string }>;
};

type KioskContact = { name: string; firm?: string; email?: string; phone?: string; contactId?: string };
type KioskRecipient = { name?: string; email: string };

function normalizePhone(p: string | null | undefined): string {
  return (p || "").replace(/\D/g, "");
}

function normalizeEmail(e: string | null | undefined): string {
  return (e || "").trim().toLowerCase();
}

function nameKey(first: string, last: string): string {
  return `${first.trim().toLowerCase()} ${last.trim().toLowerCase()}`.trim();
}

function splitName(full: string): { first: string; last: string } {
  const [first, ...rest] = full.trim().split(" ");
  return { first: first || "", last: rest.join(" ") || "" };
}

/**
 * Compare a just-submitted IntakeDraft against the donor's existing Contact
 * and most recent Case. Returns null if nothing changed (safe to auto-approve)
 * or a structured diff object describing what's new.
 *
 * Only additions and field-value changes count as "changes". Removing a
 * pre-filled attorney on the kiosk is not flagged — staff will see the current
 * state on the review page regardless.
 *
 * Note: test types are NOT flagged. Every visit has test types — that's the
 * whole purpose of the visit. Placeholder TestOrders get created fresh on
 * every approval (auto or manual). Recipients are only flagged when the email
 * isn't already linked to the existing case.
 */
export async function detectChanges(
  draft: IntakeDraft,
  existingDonorId: string
): Promise<DetectedChanges | null> {
  const donor = await prisma.contact.findUnique({ where: { id: existingDonorId } });
  if (!donor) return null; // can't compare if donor gone

  const mostRecentCase = await prisma.case.findFirst({
    where: { donorId: existingDonorId },
    orderBy: { updatedAt: "desc" },
    include: {
      caseContacts: {
        include: { contact: true },
      },
    },
  });

  // No existing case — nothing to compare. Caller should NOT call this if
  // there's no case; returning null here would be ambiguous (null means
  // "auto-approve OK"). The POST handler guards against this by checking
  // for the case separately. If we get here without a case, default to
  // returning null and let the caller decide.
  if (!mostRecentCase) return null;

  const changes: DetectedChanges = {};

  // Phone
  if (draft.phone && normalizePhone(draft.phone) !== normalizePhone(donor.phone)) {
    changes.phone = { old: donor.phone, new: draft.phone };
  }

  // Email
  if (draft.email && normalizeEmail(draft.email) !== normalizeEmail(donor.email)) {
    changes.email = { old: donor.email, new: draft.email };
  }

  // Case type
  if (draft.caseType && draft.caseType !== mostRecentCase.caseType) {
    changes.caseType = { old: mostRecentCase.caseType, new: draft.caseType };
  }

  // Build sets of existing attorney/GAL/evaluator contacts on the most recent case
  const existingContactIds = new Set<string>();
  const existingAttorneyNames = new Set<string>();
  const existingGalNames = new Set<string>();
  const existingEvaluatorNames = new Set<string>();

  for (const cc of mostRecentCase.caseContacts) {
    existingContactIds.add(cc.contactId);
    const key = nameKey(cc.contact.firstName, cc.contact.lastName);
    if (cc.contact.contactType === "attorney" || cc.roleInCase === "petitioner_attorney" || cc.roleInCase === "respondent_attorney") {
      existingAttorneyNames.add(key);
    }
    if (cc.contact.contactType === "gal" || cc.roleInCase === "gal") {
      existingGalNames.add(key);
    }
    if (cc.contact.contactType === "evaluator" || cc.roleInCase === "evaluator") {
      existingEvaluatorNames.add(key);
    }
  }

  // Attorneys
  const submittedAttorneys = (draft.attorneys as KioskContact[] | null) || [];
  const attorneysAdded: Array<{ name: string; firm?: string }> = [];
  for (const a of submittedAttorneys) {
    if (!a.name?.trim()) continue;
    if (a.contactId && existingContactIds.has(a.contactId)) continue;
    const { first, last } = splitName(a.name);
    if (existingAttorneyNames.has(nameKey(first, last))) continue;
    attorneysAdded.push({ name: a.name.trim(), firm: a.firm || undefined });
  }
  if (attorneysAdded.length > 0) changes.attorneysAdded = attorneysAdded;

  // GAL (single)
  const gal = draft.galInfo as KioskContact | null;
  if (gal?.name?.trim()) {
    const inByContactId = gal.contactId && existingContactIds.has(gal.contactId);
    const { first, last } = splitName(gal.name);
    const inByName = existingGalNames.has(nameKey(first, last));
    if (!inByContactId && !inByName) {
      changes.galAdded = { name: gal.name.trim(), firm: gal.firm || undefined };
    }
  }

  // Evaluators
  const submittedEvaluators = (draft.evaluators as KioskContact[] | null) || [];
  const evaluatorsAdded: Array<{ name: string; firm?: string }> = [];
  for (const e of submittedEvaluators) {
    if (!e.name?.trim()) continue;
    if (e.contactId && existingContactIds.has(e.contactId)) continue;
    const { first, last } = splitName(e.name);
    if (existingEvaluatorNames.has(nameKey(first, last))) continue;
    evaluatorsAdded.push({ name: e.name.trim(), firm: e.firm || undefined });
  }
  if (evaluatorsAdded.length > 0) changes.evaluatorsAdded = evaluatorsAdded;

  // Test types are NOT flagged — they're the purpose of every visit.
  // Placeholder TestOrders get created fresh on each approval.

  // Additional result recipients — only flag emails not already on the case.
  const existingEmails = new Set<string>();
  for (const cc of mostRecentCase.caseContacts) {
    if (cc.contact.email) existingEmails.add(normalizeEmail(cc.contact.email));
  }
  const submittedRecipients = ((draft.additionalRecipients as KioskRecipient[]) || [])
    .filter((r) => r.email?.trim());
  const recipientsAdded: KioskRecipient[] = [];
  for (const r of submittedRecipients) {
    if (!existingEmails.has(normalizeEmail(r.email))) {
      recipientsAdded.push(r);
    }
  }
  if (recipientsAdded.length > 0) changes.recipientsAdded = recipientsAdded;

  // If every field is empty, nothing changed — auto-approve OK.
  if (Object.keys(changes).length === 0) return null;
  return changes;
}

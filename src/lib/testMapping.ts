/**
 * Maps form checkbox values from individual.html to TestCatalog entries.
 *
 * Uses runtime pattern matching against the database so the mapping stays
 * correct even if catalog IDs change.
 */

import { prisma } from "@/lib/prisma";

type CatalogMatch = {
  id: string;
  testName: string;
  specimenType: string;
  lab: string;
};

/**
 * Resolve a single form test value (e.g., "Hair/Nail – 17 Panel") to a
 * TestCatalog entry. Returns null if no match found.
 */
async function findCatalogMatch(formValue: string): Promise<CatalogMatch | null> {
  // Normalize
  const v = formValue.trim();

  // ── Alcohol tests ──
  if (v.includes("PEth")) {
    return findByPattern("PEth", "blood");
  }
  if (v.includes("Hair EtG")) {
    return findByPattern("EtG Hair", "hair");
  }
  if (v.includes("Urine EtG")) {
    return findByPattern("Urine EtG/EtS", "urine");
  }
  if (v.includes("Breath Alcohol")) {
    return findByPattern("Breath Alcohol", "breath");
  }

  // ── Hair/Nail panels ──
  const hairMatch = v.match(/^Hair\/Nail\s*[–-]\s*(\d+)\s*Panel$/i);
  if (hairMatch) {
    return findByPattern(`${hairMatch[1]} Panel Hair`, "hair");
  }

  // ── Urine Lab panels ──
  const urineMatch = v.match(/^Urine Lab\s*[–-]\s*(\d+)\s*Panel$/i);
  if (urineMatch) {
    return findByPattern(`${urineMatch[1]} Panel Urine`, "urine");
  }

  // ── Child Guard ──
  const childMatch = v.match(/^Child Guard Hair\s*[–-]\s*(\d+)\s*Panel$/i);
  if (childMatch) {
    return findByPattern(`ChildGuard ${childMatch[1]} Panel`, "hair");
  }

  // ── Other tests ──
  if (v === "Oral Fluids") {
    return findByPattern("Oral Fluid", "oral_fluid");
  }
  if (v === "Sweat Patch") {
    return findByPattern("Sweat Patch", "sweat_patch");
  }

  return null;
}

async function findByPattern(
  namePattern: string,
  specimenType: string
): Promise<CatalogMatch | null> {
  const result = await prisma.testCatalog.findFirst({
    where: {
      active: true,
      isAddOn: false,
      specimenType: specimenType as never,
      testName: { contains: namePattern, mode: "insensitive" },
    },
    select: { id: true, testName: true, specimenType: true, lab: true },
    orderBy: { testName: "asc" },
  });
  return result;
}

export type ResolvedTest = {
  testCatalogId: string | null;
  testDescription: string;
  specimenType: string;
  lab: string;
};

/**
 * Resolve an array of form test values to TestCatalog entries.
 * Returns one ResolvedTest per input value. Unmatched values get
 * testCatalogId: null with the raw description preserved.
 */
export async function resolveFormTests(formTests: string[]): Promise<ResolvedTest[]> {
  const results: ResolvedTest[] = [];

  for (const formValue of formTests) {
    const match = await findCatalogMatch(formValue);
    if (match) {
      results.push({
        testCatalogId: match.id,
        testDescription: match.testName,
        specimenType: match.specimenType,
        lab: match.lab,
      });
    } else {
      // Fallback: use raw form value as description, guess specimen type
      const specimenType = formValue.toLowerCase().includes("hair") ? "hair"
        : formValue.toLowerCase().includes("urine") ? "urine"
        : formValue.toLowerCase().includes("blood") ? "blood"
        : "urine";
      results.push({
        testCatalogId: null,
        testDescription: formValue,
        specimenType,
        lab: "usdtl",
      });
    }
  }

  return results;
}

/**
 * Map form reason to CaseType enum value.
 */
export function mapReasonToCaseType(reason: string): "court_ordered" | "voluntary" | "by_agreement" {
  const r = reason.toLowerCase();
  if (r.includes("personal") || r.includes("self-request")) return "voluntary";
  if (r.includes("agreement")) return "by_agreement";
  return "court_ordered";
}

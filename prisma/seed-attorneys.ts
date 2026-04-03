/**
 * Bulk import family law attorneys from the HubSpot-sourced markdown directory
 * into the case tracker's Contact table via Prisma upsert.
 *
 * Usage: npx tsx prisma/seed-attorneys.ts
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const prisma = new PrismaClient();

const MD_PATH =
  "/Users/michaelgammel/.claude/projects/-Users-michaelgammel-playground/memory/reference_attorney_directory.md";

interface AttorneyRow {
  firstName: string;
  lastName: string;
  firmName: string | null;
  email: string | null;
  phone: string | null;
}

function parseName(raw: string): { firstName: string; lastName: string } {
  const name = raw.trim();
  const parts = name.split(/\s+/);

  if (parts.length === 1) {
    // Single name like "Allison" or "Dorothy" — use as firstName, empty lastName
    return { firstName: parts[0], lastName: "" };
  }

  // First token is firstName, rest is lastName
  // Handles "Anna Markley Bush" -> firstName: "Anna", lastName: "Markley Bush"
  // Handles "C. Barone" -> firstName: "C.", lastName: "Barone"
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

function parseEmail(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // If multiple emails separated by " / ", take the first
  const first = trimmed.split("/")[0].trim();
  return first || null;
}

function parsePhone(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed || null;
}

function parseFirm(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "(solo)") return null;
  return trimmed;
}

function parseMarkdownTable(content: string): AttorneyRow[] {
  const rows: AttorneyRow[] = [];

  const lines = content.split("\n");

  // Find the "## Individual Attorneys" section
  let inSection = false;
  let headerFound = false;

  for (const line of lines) {
    // Start of our target section
    if (line.startsWith("## Individual Attorneys")) {
      inSection = true;
      continue;
    }

    // Stop at the next section
    if (inSection && line.startsWith("## ")) {
      break;
    }

    if (!inSection) continue;

    // Skip the header row and separator row
    if (line.includes("| Name |") || line.includes("|------")) {
      headerFound = true;
      continue;
    }

    if (!headerFound) continue;

    // Parse table rows: | Name | Firm | Email | Phone |
    if (!line.startsWith("|")) continue;

    const cells = line.split("|").map((c) => c.trim());
    // Split by | gives: ["", "Name", "Firm", "Email", "Phone", ""]
    if (cells.length < 5) continue;

    const rawName = cells[1];
    const rawFirm = cells[2];
    const rawEmail = cells[3];
    const rawPhone = cells[4];

    if (!rawName) continue;

    const { firstName, lastName } = parseName(rawName);
    const email = parseEmail(rawEmail);
    const firmName = parseFirm(rawFirm);
    const phone = parsePhone(rawPhone);

    rows.push({ firstName, lastName, firmName, email, phone });
  }

  return rows;
}

async function main() {
  const content = fs.readFileSync(MD_PATH, "utf-8");
  const attorneys = parseMarkdownTable(content);

  console.log(`Parsed ${attorneys.length} attorneys from markdown file.\n`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const atty of attorneys) {
    // If no email, we cannot use upsert-by-email — insert directly
    if (!atty.email) {
      console.log(
        `  SKIP (no email): ${atty.firstName} ${atty.lastName}`.trim()
      );
      skipped++;
      continue;
    }

    try {
      const existing = await prisma.contact.findFirst({
        where: { email: atty.email },
      });

      await prisma.contact.upsert({
        where: { id: existing?.id ?? "" },
        update: {
          firstName: atty.firstName,
          lastName: atty.lastName,
          firmName: atty.firmName,
          phone: atty.phone,
          contactType: "attorney",
        },
        create: {
          contactType: "attorney",
          firstName: atty.firstName,
          lastName: atty.lastName,
          firmName: atty.firmName,
          email: atty.email,
          phone: atty.phone,
          preferredContact: "email",
          represents: "na",
        },
      });

      if (existing) {
        updated++;
        console.log(`  UPDATED: ${atty.firstName} ${atty.lastName} (${atty.email})`);
      } else {
        created++;
        console.log(`  CREATED: ${atty.firstName} ${atty.lastName} (${atty.email})`);
      }
    } catch (err) {
      console.error(
        `  ERROR: ${atty.firstName} ${atty.lastName} (${atty.email}):`,
        err
      );
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total parsed:  ${attorneys.length}`);
  console.log(`Created:       ${created}`);
  console.log(`Updated:       ${updated}`);
  console.log(`Skipped:       ${skipped}`);
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

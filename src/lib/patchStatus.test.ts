import { describe, expect, it } from "vitest";
import { buildArchivedDocsWhere } from "./patchStatus";

/**
 * NULL-safety regression tests for the archived-CoC-documents query.
 *
 * The bug we're guarding against: Postgres `NOT IN (NULL, ...)` returns
 * UNKNOWN, which never matches, so a naive query that passes NULL FK
 * values into Prisma's `notIn` filter silently returns zero rows even
 * when the table has matching records. `buildArchivedDocsWhere` filters
 * NULLs out before they reach Prisma. These tests pin that behavior.
 *
 * (The full Prisma round-trip lives in integration land — these are
 * pure tests of the filter-construction logic.)
 */

describe("buildArchivedDocsWhere — NULL-safety", () => {
  it("returns an empty filter when BOTH FKs are null (key NULL-safety case)", () => {
    // The bug we're preventing: passing [null, null] into `notIn` —
    // Postgres `NOT IN (NULL, NULL)` is UNKNOWN, so zero rows. We
    // expect ALL CoC docs to surface as archived in this case (none
    // are currently linked), so the filter must omit `notIn` entirely.
    expect(buildArchivedDocsWhere(null, null)).toEqual({});
  });

  it("excludes only the working copy when executed is null", () => {
    expect(buildArchivedDocsWhere("doc-working-1", null)).toEqual({
      id: { notIn: ["doc-working-1"] },
    });
  });

  it("excludes only the executed copy when working is null", () => {
    expect(buildArchivedDocsWhere(null, "doc-executed-1")).toEqual({
      id: { notIn: ["doc-executed-1"] },
    });
  });

  it("excludes both when both FKs are set", () => {
    const where = buildArchivedDocsWhere("doc-working-1", "doc-executed-1");
    expect(where).toEqual({
      id: { notIn: ["doc-working-1", "doc-executed-1"] },
    });
  });

  it("preserves order in the notIn list (working then executed)", () => {
    // Order doesn't matter for SQL semantics, but pinning it makes the
    // generated query deterministic in logs/snapshots.
    const where = buildArchivedDocsWhere("a", "b");
    expect(where.id?.notIn).toEqual(["a", "b"]);
  });

  it("treats empty strings as falsy and filters them out", () => {
    // Defensive — Prisma string FKs shouldn't ever be "" in practice,
    // but if a caller stringifies a missing value they'd get "" rather
    // than null. Either way we don't want it as an exclusion key.
    expect(buildArchivedDocsWhere("", "")).toEqual({});
    expect(buildArchivedDocsWhere("", "doc-executed")).toEqual({
      id: { notIn: ["doc-executed"] },
    });
  });
});

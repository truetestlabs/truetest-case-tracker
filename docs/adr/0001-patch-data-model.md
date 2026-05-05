---
status: Proposed
date: 2026-05-05
deciders: Michael Gammel (with workflow-truth input from Colleen via docs/patch-workflow.md)
supersedes: the locked decisions in `~/.claude/plans/sweat-patch-schema-handoff.md` ("Option C", recorded as outcome but not as deliberated tradeoff)
---

# ADR-0001: Patch data model

## Context

The tracker today models a sweat patch as a `TestOrder` with a 1:1 `PatchDetails` sidecar. That shape was chosen for convention consistency with the rest of the tracker's TestOrder-centric flow and was recorded in `~/.claude/plans/sweat-patch-schema-handoff.md` as "Option C". The discovery report at `~/.claude/plans/discovery-task-only-harmonic-pine.md` confirmed that no Option A / B / C comparison document exists — the decision was recorded as an outcome but never compared against alternatives. This ADR is that comparison, retroactively, with the workflow spec at [`docs/patch-workflow.md`](../patch-workflow.md) as the new ground truth.

The spec catalogs (in section 10) the structural mismatches between the patch workflow and the single-event TestOrder shape: two-event lifecycle with a wear period in between, two-stage CoC, per-event collector identity, multi-patch cycles, distinct cancellation taxonomy, payment-gated shipment, and a notification-review workflow that didn't exist when the original Option C was decided. These mismatches surface today as work-arounds: patch-specific fields squeezed into TestOrder semantics, patch lifecycle states derived in code rather than stored, and patch notifications absent from the email system entirely (zero patch-specific functions in [`src/lib/email.ts`](../../src/lib/email.ts)).

This ADR compares three options for resolving the mismatches and recommends one. It is being written before any code changes — the rebuild has not started — so the recommendation has the full menu of options open to it.

## Decision criteria (locked, in priority order)

1. **Fit to the spec's workflow truths.** The rebuild exists because the current model doesn't fit; a new model that also doesn't fit defeats the purpose. Highest weight.
2. **Build cost** (engineering time to ship). Real cost, secondary to fit. We are explicitly accepting longer build time in exchange for correctness.
3. **Migration cost.** 25 patches in tracker (manually rebuildable per handoff) plus 8 orphan sweat-patch TestOrders in prod.
4. **Risk of regression in non-patch flows.** Urine, hair, and breath flows must keep working unchanged.
5. **Opportunity cost.** Weeks not spent on USDTL onboarding, the CRL native-cocaine extractor bug, or items #5–#7 from the prior handoff. Real cost, not allowed to drive against criterion 1.

## Options

### Option 1 — Status quo+

Keep the 1:1 `PatchDetails` ↔ `TestOrder` shape and extend `PatchDetails` with the fields the spec requires.

**(a) Shape.** A schema sketch of the additions:

```
PatchDetails (extended)
├── existing fields (panel, applicationDate, removalDate, working/executed CoC, cancellationKind, cancelledAt, replacement fields)
├── pharmchekNumber: String?           — per-patch chain-verification key (spec 3.10, 5.10)
├── applicationCollectorId: String?    — per-event collector (spec 3.10)
├── removalCollectorId: String?        — per-event collector
├── cancellationBilling: enum?         — donor_caused | truetest_caused (spec 7.2)
├── cancellationOverrideReason: String?— for the 3 overridable categories (spec 8.2, 8.3, 11.4)
├── holdStartedAt: DateTime?           — held-sub-state (spec 4.2, 11.4)
└── shippedAt: DateTime?               — to express the spec's Shipped state distinct from AT_LAB

PatchCancellationKind (enum, expanded)
├── existing 3 values
└── ~9 new values mapping to spec 8.1's reason taxonomy

PATCH_WEAR_THRESHOLDS (constants, corrected)
├── 14-day hard cancel (replaces 30) — spec 3.6
└── reminder bands shifted to 7 / 10 / 14

EmailDraft.draftType (string, expanded)
└── new values: patch_application, patch_removal_paid, patch_removal_unpaid,
    patch_cancellation_pre_ship, patch_cancellation_post_ship, patch_held_shipped
```

How spec workflow truths express under this option:
- **Per-event collectors**: column pair on PatchDetails. Adequate.
- **Appointment as unit of work**: *no expression* — Appointment model still doesn't link to PatchDetails.
- **Patch as forensic atom**: still conflated with TestOrder.
- **Cycle as derived view**: derivable by querying TestOrders on a case filtered to sweat_patch — works.
- **Held sub-state**: split between `TestOrder.testStatus = specimen_held` (existing) and new `holdStartedAt` field. Two sources of truth.
- **14-day rule**: corrected via constants update. Clean.
- **PharmChek-number chain check**: new field. Clean.
- **Cancellation taxonomy + billing**: enum expansion + new field. Clean but bolted-on.
- **Notification review workflow**: new EmailDraft `draftType` values. Clean.

**(b) Migration.** ALTER TABLE on PatchDetails to add columns; backfill `null` for the 25 existing rows (Colleen rebuilds on a per-patch basis as she touches them); ALTER TYPE on `PatchCancellationKind` to add the new values; constants change in `patchValidation.ts`. The 8 orphan sweat-patch TestOrders remain orphans — they are not addressed by this option (separate cleanup needed).

**(c) Build effort: 1–2 weeks.** Schema migration: 1–2 days. UI extensions to the Edit modal, PatchSection, and CancelPatchModal: 3–5 days. Notification draft hooks at patch lifecycle events: 2–3 days. Wear threshold + test updates: 1 day. Edit-modal save bug fix (the gap PR #25 exposed): 1–2 days. No structural rewiring required.

**(d) Regression surface for non-patch flows.** Minimal. All changes are additive to PatchDetails or to enums. `TestOrder.collectionDate` mirror behavior unchanged. `TestStatus.specimen_held` continues to be shared with urine/hair (semantics differ but the enum value is reused). [`labResultCrosscheck.ts`](../../src/lib/labResultCrosscheck.ts) already has patch-specific paths. **No anticipated regression to urine, hair, or breath flows.**

**(e) Where this option is weak.**
- It does not address the spec's structural critiques in section 10. Specifically, spec 10.3 says: *"Modeling a patch as a TestOrder forces either appointment-as-TestOrder (which loses the patch as the forensic atom) or patch-as-TestOrder (which loses the appointment as the unit of work). The current tracker approach … chose the latter."* Option 1 keeps the chosen-the-latter shape and adds fields around it. The structural mismatch the rebuild exists to fix is not fixed.
- The 8 orphan TestOrders are evidence that the tracker's create paths can produce incomplete patches. Adding more fields to PatchDetails without addressing the structural shape doesn't reduce the orphan risk going forward.
- Held sub-state ends up encoded in two places (`TestOrder.testStatus` and `PatchDetails.holdStartedAt`). Future readers will ask which is authoritative.
- `Appointment` still doesn't link to patches. Spec section 3.1 names appointment as the unit of work; under Option 1 the unit of work has no representation.
- Recommending Option 1 amounts to recommending against the rebuild this whole effort exists to enable.

**(f) Where this option is strong.**
- Cheapest by a wide margin. 1–2 weeks ships and we're back to USDTL/CRL extractor work.
- Lowest regression risk to non-patch flows.
- Lowest migration cost — 25 patches need no row-level transformation.
- Reversible if Colleen's workflow shifts again.

### Option 2 — Patch as first-class lane

A separate `Patch` model decoupled from `TestOrder`. Patches become their own primary entity. TestOrder is for non-patch tests (urine, hair, breath); the `sweat_patch` value of `SpecimenType` becomes vestigial or is removed from new-record paths.

**(a) Shape.**

```
Patch (new top-level model)
├── id, caseId → Case, donorId → Contact
├── panel: PatchPanel                  — WA07 | WC82 | S229 (S229 is new — spec 5.3)
├── specimenId: String                 — unique, immutable after creation (spec 5.8)
├── pharmchekNumber: String?           — set at application, immutable thereafter (spec 5.10)
├── applicationDate: DateTime?
├── removalDate: DateTime?
├── applicationAppointmentId: String?  → Appointment
├── removalAppointmentId: String?      → Appointment
│   (the same Appointment can be referenced by removalAppointmentId
│   on patch N AND applicationAppointmentId on patch N+1 — that is
│   how a removal-and-application appointment expresses double-duty)
├── applicationCollectorId: String?    → User
├── removalCollectorId: String?        → User
├── workingCopyDocumentId: String?     → Document (partial CoC, internal-only)
├── executedCocDocumentId: String?     → Document (post-removal CoC)
├── lifecycleState: PatchLifecycleState — applied | removed | held | shipped | released | cancelled
├── holdStartedAt: DateTime?           — when held=true within Removed sub-state
├── shippedAt: DateTime?               — Shipped transition
├── releasedAt: DateTime?              — Released transition (after circulation)
├── cancellationKind: PatchCancellationKind?    — 12-value enum aligned to spec 8.1
├── cancellationBilling: BillingClassification? — donor_caused | truetest_caused (spec 7.2)
├── cancellationOverrideReason: String?
├── cancelledAt: DateTime?
└── replacementPatchId: String?        → Patch (self-relation)

LabResult (existing)
└── add patchId: String? → Patch   (testOrderId stays for non-patch results;
                                     polymorphic-by-FK, not by tag)

Document (existing)
└── add patchId: String? → Patch   (chain_of_custody docs link to Patch
                                     instead of TestOrder for sweat patches)

EmailDraft (existing)
└── add patchId: String? → Patch   (so notification drafts hang off the patch
                                     directly, not off a vestigial TestOrder)

Appointment (existing)
└── inverse relations from Patch.applicationAppointmentId / removalAppointmentId
    surface "what was touched at this appointment" via two queries

(removed)
PatchDetails — dropped after migration. PatchCancellationKind enum keeps the
              existing 3 values for migration compatibility, expanded to 12
              for new records.
```

How spec workflow truths express under this option:
- **Per-event collectors**: column pair on Patch (`applicationCollectorId`, `removalCollectorId`). Workable but a known smell — see weaknesses.
- **Appointment as unit of work**: two FKs on Patch + the inverse relation from Appointment. The "two patches at one appointment" case expresses correctly (one Appointment row, two Patch rows pointing at it from different FK columns).
- **Patch as forensic atom**: clean. Patch is its own row.
- **Cycle as derived view**: query Patches on a case ordered by applicationDate, group by gaps. Clean.
- **Held sub-state**: `lifecycleState: held` plus `holdStartedAt` timestamp. One source of truth.
- **14-day rule**: constants change.
- **PharmChek-number chain check**: dedicated field, immutable after application. Clean.
- **Cancellation taxonomy + billing**: dedicated fields with proper enum values. Clean.
- **Notification review workflow**: EmailDraft has `patchId`; review queue, modal, and "Approve & Send" pattern reuse intact.

**(b) Migration.**
1. Create `Patch` table, `PatchLifecycleState` and `BillingClassification` enums, `PatchCancellationKind` 12-value expansion.
2. For each existing `PatchDetails` row: insert a corresponding `Patch` row. Copy `panel`, `applicationDate`, `removalDate`, `cancellationKind`, `cancelledAt`, `workingCopyDocumentId`→`workingCopyDocumentId`, `executedDocumentId`→`executedCocDocumentId`. Compute `lifecycleState` from current state (cancellationKind→`cancelled`; executedDocumentId+labResult→`released`; executedDocumentId only→`shipped`; removalDate only→`removed`; applicationDate only→`applied`). Leave `pharmchekNumber`, `applicationCollectorId`, `removalCollectorId`, `applicationAppointmentId`, `removalAppointmentId` null — Colleen backfills as she touches each patch.
3. Add `patchId` columns to `LabResult`, `Document`, `EmailDraft`. For each existing row whose `testOrderId` points at a sweat-patch TestOrder, copy the resolved `patchId`. Nullable; non-patch rows untouched.
4. Drop `PatchDetails` table after a verification window.
5. **8 orphan TestOrders**: triage with Colleen. Per the prior handoff, all 8 are `truetest_inhouse` lab; 3 pre-collection, 5 post-lab, 0 cancelled. Three options per orphan: (a) hand-reconstruct as a `Patch` row from Colleen's paper records, (b) tombstone as cancelled with reason `data_loss`, (c) delete the orphan TestOrder if it's known-junk. Likely a mix.
6. Existing 25 valid patches: data-preserving migration, no Colleen-side rebuild required (her rebuild capacity is reserved for the orphans + any that surface migration anomalies).

Honest cost acknowledgment: the migrated 25 patches will land in the new model with `pharmchekNumber`, `applicationCollectorId`, `removalCollectorId`, `applicationAppointmentId`, and `removalAppointmentId` all null. The schema permits this (these fields are optional), but it means every existing patch is forensically incomplete in the new model until Colleen touches it in normal workflow. The rebuild ships with 25 patches that read correctly for current state but lack the chain-verification and per-event identity fields the new model is designed to capture. This is a deliberate tradeoff — the alternative is asking Colleen to backfill 25 patches' worth of data from paper records, which is real labor with real risk of transcription error. The data model accommodates incomplete-by-migration rows as a first-class case, not an exception.

**(c) Build effort: 6–10 weeks (no contingency).** Schema design + review: 3–5 days. Migration script + dry-run on a copy of prod: 1 week. Patch UI rewrite (`PatchSection`, new `EditPatchModal`, updated `CancelPatchModal`, new `AddPatch`): 1.5–2 weeks. Helpers rewrite (`patchValidation.ts`, `patchStatus.ts`, `createTestOrder.ts` sweat-patch branch removal): 3–5 days. Notification draft creation hooks at lifecycle events (3 reviewed + 3 fire-immediate per spec 11.7): 1 week. LabResult / Document / EmailDraft FK migration + code rewiring: 3–5 days. Test coverage updates: 3–5 days. Manual UAT with Colleen: 3–5 days. This estimate assumes serial execution and no scope creep. Real software projects with this volume of rewiring routinely run 50–80% over initial estimates; a working assumption of 8–12 calendar weeks from build-start to ship is more realistic than the schedule-summed 6–10. The ADR records the schedule sum for precision but the planning number should be the realistic one.

**(d) Regression surface for non-patch flows.** Limited.
- Discovery confirmed *no files outside the patch domain currently read PatchDetails or assume the 1:1 TestOrder:PatchDetails shape.* That is the load-bearing finding for this option.
- `LabResult` and `Document` keep `testOrderId` for non-patch results; they gain `patchId` as a parallel FK for patch-bound rows. Polymorphic-by-FK rather than polymorphic-by-tag. Non-patch flows continue using `testOrderId` and never see `patchId`.
- `TestStatus.specimen_held` enum value remains for urine/hair held-results semantics. Patch held-state moves to `Patch.lifecycleState`. Semantics now separated cleanly.
- `SpecimenType.sweat_patch` enum value: keep for backwards compatibility on `TestCatalog` rows (the catalog still has sweat-patch entries for pricing); remove from `TestOrder.specimenType` write paths (no new sweat-patch TestOrders are created — patches go through Patch creation flow instead).

Files in patch domain that change (every one of these is rewritten or removed):
- [`src/lib/createTestOrder.ts`](../../src/lib/createTestOrder.ts) — sweat-patch branch removed
- [`src/lib/patchValidation.ts`](../../src/lib/patchValidation.ts) — rewritten against Patch shape
- [`src/lib/patchStatus.ts`](../../src/lib/patchStatus.ts) — rewritten against Patch shape
- [`src/lib/labResultCrosscheck.ts`](../../src/lib/labResultCrosscheck.ts) — joins against `patchId` instead of `patchDetails.testOrderId`
- [`src/components/cases/PatchSection.tsx`](../../src/components/cases/PatchSection.tsx) — rewired to Patch
- [`src/components/cases/CancelPatchModal.tsx`](../../src/components/cases/CancelPatchModal.tsx) — relations updated
- [`src/components/cases/EditTestOrderModal.tsx`](../../src/components/cases/EditTestOrderModal.tsx) — sweat-patch branch removed (the panel dropdown side-channel goes away)
- New `src/components/cases/EditPatchModal.tsx`, `src/components/cases/AddPatch.tsx`
- [`src/app/api/cases/[id]/cancel-patch/route.ts`](../../src/app/api/cases/[id]/cancel-patch/route.ts) — relations updated
- [`src/app/api/cases/[id]/cancellation-report/route.ts`](../../src/app/api/cases/[id]/cancellation-report/route.ts)
- [`src/app/api/cases/[id]/route.ts`](../../src/app/api/cases/[id]/route.ts) — include block updated (Patch instead of testOrders.patchDetails)
- [`src/app/cases/[id]/page.tsx`](../../src/app/cases/[id]/page.tsx) — patch lane fed from Patch query, not from TestOrder filter

**(e) Where this option is weak.**
- Per-event nature is captured via column pairs on a single Patch row. Spec 3.1 says the unit of work is the appointment; the spec's framing implies events as a primary modeling unit. Option 2 collapses the two events back into one row. For per-event collectors and per-event appointment links this is workable; for per-event metadata that the spec already names (tampering assessment at removal, donor signature presence at apply vs. remove, photos at either event) the column-pair pattern starts to multiply.
- A removal-and-application appointment's "two patches touched" relationship is implicit: it's the case where two Patch rows happen to share an Appointment id across different FK columns. Queryable but not structurally obvious.
- More UI rewiring than Option 1 — every patch surface changes shape.
- The 8 orphan TestOrders need manual reconstruction or tombstone decisions, requiring Colleen's time.
- Vestigial `SpecimenType.sweat_patch` and `TestStatus.specimen_held` enum values remain in the schema for backwards compatibility and may confuse future readers.

**(f) Where this option is strong.**
- Resolves the spec section 10.3 critique: patch is no longer a TestOrder; the conflation goes away.
- Held-state moves out of the TestStatus enum shared with urine/hair — semantics no longer overloaded.
- Cancellation taxonomy and billing classification model fully without contortion.
- PharmChek number gets a real field with real immutability semantics.
- Notification review workflow per spec 11.7 has clean per-patch-event hooks.
- Cycle-as-derived-view per spec 6 is natural — query Patches on case ordered by applicationDate.
- Future-proof for cycle reasoning and patch-volume growth.
- Non-patch flows untouched.

### Option 3 — Per-event row model

Patch as the forensic atom (a row). Apply and remove as primary entities (`PatchEvent` rows). The spec's section 3.1 framing ("appointment is unit of work, patch is unit of record") is the structural claim; Option 3 takes it literally.

**(a) Shape.**

```
Patch (the forensic atom — identity and disposition only)
├── id, caseId → Case, donorId → Contact
├── panel: PatchPanel
├── specimenId: String                 — unique, immutable
├── pharmchekNumber: String?           — set when the apply event lands; copied
│                                        from PatchEvent for query convenience
├── lifecycleState: PatchLifecycleState — derived/cached from PatchEvents +
│                                        cancellation/shipment/release fields
├── shippedAt, releasedAt: DateTime?
├── cancellationKind, cancellationBilling, cancellationOverrideReason, cancelledAt
└── replacementPatchId: String? → Patch

PatchEvent (the appointment-touches-patch unit)
├── id, patchId → Patch
├── eventType: PatchEventType         — apply | remove
├── eventDate: DateTime               — handwritten on CoC at the appointment
├── appointmentId: String? → Appointment
├── collectorId: String? → User
├── cocDocumentId: String? → Document — partial scan at apply, executed at remove
├── tamperingAssessed: Boolean?       — meaningful only at remove
├── tamperingNotes: String?
├── donorAcknowledgmentPresent: Boolean? — initials at apply, signature at remove
├── photos: Json?                     — references to per-event photo Documents
└── notes: String?

(invariants)
- Each Patch has 0 or 1 apply event and 0 or 1 remove event
- A remove event for a Patch cannot pre-date its apply event
- A single Appointment can be referenced by 1 or 2 PatchEvents (one of each type
  for different patches, expressing the removal-and-application appointment)
```

How spec workflow truths express:
- **Per-event collectors**: native — `collectorId` on PatchEvent. The cleanest expression of any option.
- **Appointment as unit of work**: native — query `PatchEvent.where(appointmentId=X)` returns "everything that happened at this appointment." A removal-and-application appointment yields two events.
- **Patch as forensic atom**: clean.
- **Cycle as derived view**: derived from Patch sequence on case (the Patch row is the unit of cycle).
- **Held sub-state, 14-day rule, cancellation taxonomy, notification review**: all express equivalently to Option 2 — these aren't per-event concerns.
- **PharmChek-number chain check**: lives on the apply PatchEvent (where it's transcribed). Cached on Patch for query convenience or read by joining.

**(b) Migration.** Same as Option 2 plus an additional event-row construction step. For each existing PatchDetails row: insert one Patch row, then one PatchEvent(apply) if applicationDate is set, then one PatchEvent(remove) if removalDate is set. Collector identity columns null (PatchDetails has no collector data to migrate). Same 8-orphan triage process.

**(c) Build effort: 8–12 weeks.** Schema design + review: 1 week (more complex shape, more invariants to enforce). Migration script + dry-run: 1.5 weeks (more transformations and event-shape validation). Patch UI rewrite (must operate on Patch + PatchEvent aggregate, with event-aware editing surfaces): 2.5–3 weeks. Helpers rewrite (substantially new logic — every read becomes a join, every state transition becomes an event insertion): 1 week. Event-aware notification hooks: 1 week. LabResult / Document / EmailDraft FK migration + rewiring: 3–5 days. Test coverage including invariant tests: 1 week. UAT: 1 week.

**(d) Regression surface for non-patch flows.** Same as Option 2 — no non-patch flow reads PatchDetails today, so non-patch is unaffected by separation.

**(e) Where this option is weak.**
- Schema complexity is higher than the workload requires. A patch has exactly 1 or 2 events, bounded by type. Per-event modeling pays for itself when the per-parent event count is unbounded (audit logs, transaction histories, work tickets). Patches do not have unbounded events.
- Common queries are 2-table joins. "Show me this patch's full state" is `SELECT * FROM Patch JOIN PatchEvent ON ... WHERE Patch.id = ?` returning 1–3 rows. Over the life of the codebase, every patch read pays this small tax.
- Invariants must be enforced in code or via DB constraints (no >1 apply event per patch, no remove without apply, no remove pre-dating apply). Easy to introduce inconsistencies through hand-written queries.
- Highest UI rewiring cost: every patch surface must understand the aggregate.
- Highest build cost — 3–4 weeks more than Option 2 — competes directly against USDTL onboarding and items #5–#7.
- For 25 patches and a low-volume workflow, the structural fidelity gain over Option 2 is marginal in practice. Most reads care about the Patch's current state, which Option 2 expresses on a single row.

**(f) Where this option is strong.**
- Most faithful to spec section 3.1's framing. The unit-of-work-vs.-unit-of-record distinction is structurally encoded.
- Per-event collector identity is native, not a column-pair compromise.
- Removal-and-application appointment double-duty is structurally explicit (two PatchEvents pointing at one Appointment) rather than implicit.
- Per-event metadata (tampering, signatures, photos, notes) lives where it semantically belongs — on the event row.
- Cancellation can attach to a specific event ("cancelled at remove because of broken seal" vs. "cancelled at apply because wrong CoC pulled"). Useful for the spec 8.2 / 8.3 override-with-reason cases.
- Best long-term shape if patch workflows multiply or per-event semantics deepen.

## Comparison

| Criterion | Option 1 (Status quo+) | Option 2 (Patch lane) | Option 3 (Per-event) |
|---|---|---|---|
| 1. Fit to spec workflow truths | **weak** — keeps the patch-as-TestOrder distortion the spec explicitly critiques | **strong** — resolves the structural critique; per-event nuance handled via column pairs | **strong** — fully expresses spec 3.1's framing; per-event nuance is native |
| 2. Build cost | **strong** — 1–2 weeks | **adequate** — 6–10 weeks (no contingency) | **weak** — 8–12 weeks |
| 3. Migration cost | **strong** — ALTER + backfill, no row transforms | **adequate** — script + dry-run, 25 rows transform cleanly, 8 orphans need triage | **adequate** — same as Option 2 plus event-row construction |
| 4. Regression risk to non-patch | **strong** — additive only | **strong** — discovery confirmed no non-patch reads of PatchDetails; FK additions are nullable | **strong** — same as Option 2 |
| 5. Opportunity cost | **strong** — fast back to USDTL/extractor | **adequate** — meaningful weeks but bounded | **weak** — substantial weeks; competes directly with USDTL onboarding |

## Recommendation

**Option 2.**

The criteria put fit highest. Option 1's fit is materially weak — the spec's section 10 catalog of structural mismatches is exactly what Option 1 declines to fix. Recommending Option 1 would amount to recommending against the rebuild this whole effort exists to enable. It is rejected on criterion 1.

Between Options 2 and 3, the fit difference is real but narrow. Option 3 is more structurally honest about spec 3.1's "appointment is unit of work, patch is unit of record" framing — per-event collectors, per-event appointment links, per-event metadata all live naturally on PatchEvent rows. Option 2 expresses the same workflow truths via column pairs on a single Patch row, which is a known smell but a manageable one.

The decisive test: per-event modeling earns its keep when the event count per parent is unbounded. Patches have *exactly* 1 apply event and 0–1 remove events, bounded by type. That is the canonical case for column pairs, not for an event table. Per-event modeling here would be paying unbounded-event-table costs (extra joins on every read, invariant enforcement, more complex UI aggregation) for a strictly bounded event count. The structural fidelity gain over Option 2 is real but marginal; the cost premium is approximately 2 schedule-sum weeks plus ongoing query and complexity overhead.

Option 2 captures the spec's workflow truths cleanly enough that a future engineer reading the code recognizes them. The reader sees `applicationCollectorId` and `removalCollectorId` on Patch and immediately understands per-event collectors. They see `applicationAppointmentId` and `removalAppointmentId` and understand the appointment relationships. The understanding requires no joins to construct.

Recommendation is Option 2 with these explicit acknowledgments:

1. **Option 2 is structurally less honest than Option 3 about the two-event nature of a patch.** The column-pair pattern is a deliberate compromise. This ADR records that the compromise was made knowingly, not by oversight.

2. **Conditions under which Option 3 should be revisited.** If patch volume grows materially (say 10× current — 250+ active patches), if the per-patch event count becomes unbounded (e.g., interim inspection events during wear), or if the workflow gains per-event semantics that don't fit naturally on a single Patch row (e.g., per-event approvals from multiple collectors), the per-event model should be reopened. None of those conditions hold today.

3. **The recommendation depends on a discovery finding.** Specifically: that no files outside the patch domain currently read PatchDetails or assume the 1:1 TestOrder:PatchDetails shape. If a hidden non-patch consumer surfaces during build, the regression-risk score for Options 2 and 3 worsens together; the relative ranking is unchanged but absolute costs rise.

4. **Forensic legibility in testimony.** A future reader of the codebase — including a defense expert reviewing it during litigation — will see the column-pair pattern (`applicationCollectorId`, `removalCollectorId`; `applicationAppointmentId`, `removalAppointmentId`) and recognize it immediately as "this patch had two events, captured on one row." Whether that one-row representation reads cleanly in deposition years from now — when an attorney may ask why the apply event and the remove event are conflated into a single record — is a real cost paid for build-time savings. Option 3's PatchEvent table would read more honestly under that adversarial lens. This recommendation accepts the column-pair pattern's deposition-legibility cost in exchange for approximately 2 schedule-sum weeks and a simpler query surface. If experience reveals that deposition-legibility is the operative criterion (e.g., opposing counsel exploits the conflation), the conditions under which Option 3 should be revisited (acknowledgment 2 above) include this case.

## Decisions resolved during drafting

These decisions emerged during ADR drafting and are recorded here so they don't sit in the open-questions queue:

1. **Held sub-state representation: RESOLVED.** Use `lifecycleState: held` as its own enum value with a `holdStartedAt` timestamp. Spec 4.2 frames held as a sub-state of Removed in workflow terms; making the data model reflect that framing literally (option b) would force every UI surface and query consumer to derive held-ness from multiple fields. The lifecycleState field is the canonical readout every consumer uses to know what to show; held belongs on it. Workflow-truth and data-model-shape do not have to be isomorphic.

2. **`SpecimenType.sweat_patch` enum value: RESOLVED.** Keep the enum value for `TestCatalog` row compatibility (the catalog still prices sweat-patch entries). Block new writes of `TestOrder.specimenType = sweat_patch` via application-code refusal in the create paths — patches go through the new Patch creation flow instead. Note as a follow-up to retire the enum value entirely once `TestCatalog` is restructured to support Patch as a first-class catalog item; that restructure is out-of-scope for this ADR.

## Open questions for the decision-maker

These must be resolved before the rebuild starts. They are scoped to Option 2.

1. **PharmChek number immutability enforcement.** Spec 5.10 requires it. Enforce in application code (refuse to update via API), via DB trigger, or via Prisma middleware? Pick one.

2. **Cycle representation in queries.** Spec 6.3 says cycle is derived. Confirm: does the case-detail GET response include a computed `cycleId` per Patch (server-side grouping), or does the UI derive cycle boundaries client-side from the Patch list?

3. **Cancellation reason → billing classification mapping.** Spec 8.1 has 12 reasons; 7.2 has 2 billing classes; 3 reasons (8.2, 8.3, 11.4) allow override. Enforce the default mapping in code with explicit override, or allow both fields to be set independently with a validation rule?

4. **8 orphan TestOrders.** Hand-reconstruct, tombstone, or delete? Decision needed per orphan from Colleen.

5. **Appointment ↔ Patch back-references.** Add inverse Prisma relations for "Patches whose applicationAppointmentId is this Appointment" and same for removal? Useful for "what was touched at this appointment" queries.

6. **Replacement-patch chaining.** Current schema has `replacementPatchApplied: Boolean?` and `replacementPatchDate: DateTime?` (a deceptively-named pair, not a FK). Option 2 changes to `replacementPatchId: String?` self-relation. Confirm.

7. **EmailDraft polymorphism.** Add `patchId` as nullable parallel to `testOrderId` (polymorphic-by-FK), or introduce a tagged-polymorphism pattern (`parentType`, `parentId`)? Current codebase uses the former pattern elsewhere; consistency argues for FK-parallel.

8. **Document polymorphism.** Same question for `Document.testOrderId` — add `patchId` parallel? Or keep Document.testOrderId for non-patches and let Patch hold direct FKs to working/executed CoC documents (Document still has a `caseId` link so it's discoverable from the case)?

9. **Build sequencing.** Migrate schema first and dual-write for a period, then cut over? Or migrate and cut over in one shot? The 25-patch volume and "manually rebuildable" property argue for cut-over with a verification window.

10. **Items #5–#7 from the prior handoff: PARTIALLY DECOUPLED.** The CRL native-cocaine fix in `resultExtract.ts` (the tool-schema / prompt change to mandate paired Cocaine + Benzoylecgonine emission on CRL sweat-patch reports) is independent of the new data model and should ship in parallel with the rebuild — not after it. Per the discovery report, this bug currently produces forensically incomplete extraction on every CRL sweat-patch result; deferring it 5–8 weeks behind the rebuild leaves a known forensic-accuracy gap untouched throughout that period. The remainder of items #5–#7 (parserVersion bump, model bump, `testOrderContext` threading, `LabResult.create` patchSnapshot, `resultSummary.ts` patch-context update including Example F redo and Example O re-gating) does depend on the new model and ships after the rebuild. Confirm sequencing: native-cocaine fix in parallel, remainder after.

## Appendix A — Spec quotes that drive specific design choices

These passages from `docs/patch-workflow.md` are the load-bearing claims for the recommendation. Quoted verbatim with section refs so a future reader has the evidence trail without chasing sources.

**On per-event collectors (drives Patch column pair, or PatchEvent.collectorId in Option 3):**

> *Spec 3.10:* "The collector also signs and initials the CoC at both events — once at application, again at removal. The application-side and removal-side collector signatures can be **different people**: the collector who applied a patch is not necessarily the collector who removes it. The CoC captures both identities independently, and the data model must support a per-event collector identity rather than a single per-patch or per-cycle collector."

**On appointment as unit of work and patch as forensic atom (drives separation from TestOrder):**

> *Spec 3.1:* "The unit of work is an **appointment**. The unit of record for a patch is the pair of dates — **application date** and **removal date** — that bound its wear period. A single appointment can produce one or both of these dates depending on what physically happens."

> *Spec 10.3:* "A TestOrder cannot represent this without distortion. Modeling a patch as a TestOrder forces either appointment-as-TestOrder (which loses the patch as the forensic atom) or patch-as-TestOrder (which loses the appointment as the unit of work). The current tracker approach — patch as TestOrder with a sidecar PatchDetails table — chose the latter."

**On cycle as derived view (drives the no-Cycle-table design):**

> *Spec 6.3:* "Because a cycle has no metadata, no initiator, no terminator, and no rules of its own, it does not need to be a first-class entity in the data model. A cycle can be **derived** from the sequence of patches on a case."

**On the system invariant for concurrent patches (drives a unique-active-patch-per-case constraint):**

> *Spec 6.4:* "A donor cannot have two cycles running concurrently. **Only one patch is on the donor at a time.** This is a system invariant: at any moment in time, for any (case, donor) pair, there is at most one patch in the Applied or Wear-period state. If the data model permits two patches to be in those states for the same donor simultaneously, the data model is wrong."

**On held sub-state and reminder cadence (drives the held representation and reminders rewrite):**

> *Spec 4.2:* "**Held (sub-state of Removed)** — payment for the test has not yet been received. The sealed specimen is stored at the TrueTest office indefinitely, awaiting payment."

> *Spec 11.4:* "**1 month** — first reminder. … **3 months** — second reminder, same prompt. **6 months** — third reminder, same prompt."

**On the 14-day hard ceiling (drives `expiredCancelMin` correction):**

> *Spec 3.6:* "**Hard ceiling: 14 days.** A patch worn 14 days or longer is cancelled. No sample is sent to the lab."

**On PharmChek number chain verification (drives the new field):**

> *Spec 3.10:* "At application, the collector transcribes this number onto Box 3 of the CoC. At removal, **before anything else happens at the appointment**, the collector reads the PharmChek number off the physical patch on the donor and compares it to the number recorded on the CoC. This is the chain-of-custody verification that the patch being removed is the same patch that was applied."

> *Spec 5.10:* "**PharmChek number** — captured from Box 3 at application (transcribed by collector from the physical patch). **Handwritten by the collector.** The tracker must not auto-populate or guess this value. … Immutable after confirmation."

**On specimen ID immutability (drives the immutable-after-creation rule):**

> *Spec 5.8:* "**System invariant:** A specimen ID, once bound to a patch in the tracker, cannot be reassigned. … The tracker should refuse any operation that would change a patch's specimen ID after binding."

**On cancellation taxonomy and billing classification (drives the enum expansion + new billing field):**

> *Spec 7.2:* "When a patch is cancelled in the tracker, the tracker records which category the cancellation falls into. This classification is the audit trail for the downstream billing decision but does not itself trigger a charge or refund."

> *Spec 8.1* (the 12 reason codes — see spec for the full enumeration; not duplicated here)

**On notification review workflow (drives the EmailDraft hooks):**

> *Spec 11.7:* "Notifications fall into one of two paths based on whether they describe an event or make a claim about disposition or billing. … Reviewed notifications use the existing `EmailDraft` / 'Approve & Send' pattern."

## Appendix B — Gap inventory, 2026-05-05

The eight-question gap analysis from the session that preceded this ADR. Status as of `prisma/schema.prisma` HEAD on `main` (commit `696b0e6`, including the spec-add merge but not the 11.7 amendment which is doc-only).

| # | Spec area | Current expression | Status |
|---|---|---|---|
| 1 | Per-event collector identity (3.10, 10.7) | `TestOrder.collectedBy: String?` — single field, free-text. Zero usages outside schema. No PatchDetails collector field. | **ABSENT** |
| 2 | Patch as forensic atom vs. appointment as unit of work (3.1, 10) | TestOrder primary; PatchDetails 1:1 sidecar. `Appointment` model exists but does not link to TestOrder, PatchDetails, or any patch event. | **CONFLICTS** |
| 3 | Cycle as derived view (6, 6.4) | No cycle storage (matches spec). The 6.4 invariant ("only one WORN patch per case at a time") is unenforced — schema permits multiple WORN PatchDetails on a case. | **PARTIAL** |
| 4 | Held as sub-state of Removed (4.2, 11.4) | `TestStatus.specimen_held` enum value + `TestOrder.specimenHeld: Boolean`. Reminders fire at **2 days non-patch / 7 days sweat-patch**, vs spec's 1/3/6 months. Held not visible in `patchLifecycleStatus`. No "held sample disposed" cancellation reason. | **PARTIAL / CONFLICTS** |
| 5 | Five-state lifecycle vs. four-state derivation (4.2) | Current `patchLifecycleStatus()` returns WORN \| AT_LAB \| COMPLETE \| CANCELLED. Spec adds Removed (no current expression — `removalDate` alone does not change status) and Held sub-state. Released loosely matches COMPLETE but spec ties release to circulation, not just upload. | **PARTIAL** |
| 6 | Cancellation taxonomy with billing classification (8.1, 7.2) | `PatchCancellationKind` has 3 values (`cancelled` / `lab_cancelled` / `expired`). Spec has 12 reasons + 2 billing classes + override flag for 3 specific reasons. `PATCH_WEAR_THRESHOLDS.expiredCancelMin: 30` — spec 3.6 says **14 days**. | **PARTIAL with one CONFLICT (14d vs 30d)** |
| 7 | Notification triggers per patch lifecycle event (11.2, 11.7) | 12 email functions in `email.ts`, **zero patch-specific** (grep `patch\|sweat` in `email.ts`: zero matches). Generic 7-day stale ping covers wear escalation; no day-10 elevation, no day-14 auto-cancel. | **ABSENT for event triggers; PARTIAL for wear escalation** |
| 8 | Specimen ID matching (5.1, 4.6) | `stripNonDigitPrefix` strips any leading non-digit (including `X`). `specimenIdsMatch` is exact `===` after strip. | **PARTIAL/ADEQUATE** — slightly more permissive than spec's "X-only" rule but functionally correct for CRL output |

**Other gaps surfaced (not in the original 8 questions, all material to data-model viability):**

- **PharmChek number** (3.10, 5.10, 8.1): zero schema fields. Mentioned only in schema *comments*. **ABSENT**.
- **14-day vs 30-day wear ceiling**: `patchValidation.ts:49` `expiredCancelMin: 30` directly conflicts with spec 3.6's 14-day hard ceiling. **CONFLICTS**.
- **Confirmation steps for handwritten fields** (5.6, 5.10): spec mandates "you entered X — confirm" for PharmChek number, application date, removal date. Edit modal saves without confirmation. **ABSENT**.
- **Partial CoC scan internal-only flag** (5.6): `workingCopyDocumentId` exists; spec specifies the partial scan is internal-only and never circulated. No flag distinguishes internal-only from circulated. **PARTIAL**.
- **Three-panel selection** (5.3): `PatchPanel` enum has WA07 + WC82 only. Spec adds Standard plus Fentanyl add-on (S229) as a third option. **PARTIAL**.
- **Cancelled-CoC document of record** (5.7): cancellation flow generates a separate cancellation-notice PDF. Spec frames the **annotated original CoC** as the document of record. **PARTIAL** (worth confirming intent during build).
- **Result.COLLECTED vs. tracker.applicationDate cross-check** (4.6): `labResultCrosscheck.ts` adds a `patch_application_date` mismatch type — likely already implemented; verify during build.

The 14-day, PharmChek-number, and per-event-collector gaps were spot-checked against `prisma/schema.prisma` and `src/lib/patchValidation.ts` immediately before drafting this ADR. All three were confirmed.

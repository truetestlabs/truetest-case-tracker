# Patch rebuild gap audit
**Date:** 2026-05-06
**Author:** Claude Code (with Michael)
**Branch:** `audit/patch-lifecycle-gaps`
**Scope:** Normal-case patch lifecycle only — created → applied → at-lab/held → complete. Cancellation, multi-patch cycles, billing classification, and the existing 5 stubs / 10 orphans are explicitly out of scope.

## Summary

**12 capabilities audited; 3 are BLOCKING gaps, 3 IMPORTANT, 1 NICE-TO-HAVE, 5 already work.** The dominant pattern is that the patch CoC upload path is structurally unwired — the schema, helpers, and UI all anticipate it but no API endpoint or UI surface ever invokes the patch-specific lifecycle helpers. Once CoC upload (working-copy + executed) is wired, the rest of the lifecycle largely flows through existing infrastructure (lab result ingestion, result summary, email drafts) with minor patch-aware tweaks. **Estimated MVP build: ~400–450 lines across 4–5 files.** Stop conditions did not trigger — no silent data-misfile bugs beyond yesterday's PR #30 fix; "anticipated but never implemented" describes ~25% of the surface, not 80%+.

**Critical framing:** this is a **cutover problem, not a migration problem**. TestVault is authoritative for patches today and remains authoritative through parallel run. The tracker holds no production patch lifecycle data that needs to be carried forward. See Cap 0 for implications, and Cutover Criteria + Parallel Run sections below for what happens after MVP ships.

## Gap-by-gap findings

### 0. Current state & cutover (not migration)

**Status:** Greenfield for patches in the case tracker.

TestVault is the authoritative system of record for all patch cases today and has been for ~10 years. Colleen runs patch collections, CoC handling, shipment, and result filing through TestVault end-to-end. The case tracker holds no production patch lifecycle data that needs to be migrated forward.

This is a cutover problem, not a migration problem. There is no dirty in-flight data to clean up. Any patch records currently in the tracker DB are partial/test artifacts and can be wiped before MVP ship without loss.

**Implication for MVP:** ship the lifecycle wiring against an empty patch table. First real patch case enters the tracker only after MVP is deployed and parallel-run begins (see Cutover Criteria below).

**Implication for testing:** because TestVault remains authoritative through parallel run, a bug in the tracker during parallel run does not break chain of custody — TestVault is the backstop. This relaxes the pre-ship automated-test bar; state-machine tests can be written during or after parallel run, informed by what actually breaks in real cases. Pull test coverage forward to full before cutover, not before ship.

### 1. Working-copy CoC upload (at application)

- **Status: NEVER IMPLEMENTED** — for the patch-specific path
- **Evidence:**
  - [patchStatus.ts:88-96](src/lib/patchStatus.ts:88) defines `replaceWorkingCopy(tx, { patchDetailsId, newDocumentId })` — sets `PatchDetails.workingCopyDocumentId`. **Grep confirms zero callers** (only references are the definition, comments, and the `executePatchCoc` companion function).
  - [PatchSection.tsx:302-333](src/components/cases/PatchSection.tsx:302) has only `Cancel patch` and `Edit` buttons in the row's action area. No upload control.
  - The generic upload path at [documents/route.ts](src/app/api/cases/[id]/documents/route.ts:408) handles `chain_of_custody` for any test order, but: (a) writes the confirmed date to `TestOrder.collectionDate` (not `PatchDetails.applicationDate`), (b) advances `testStatus` to `specimen_collected` (wrong for a patch *at application* — collection happens at removal), and (c) doesn't touch `PatchDetails.workingCopyDocumentId`. So even pointing the existing UI at a patch row would mis-shape the data.
  - [CocConfirmModal.tsx](src/components/cases/CocConfirmModal.tsx) — the date-confirmation modal — exists and is invoked from `TestOrderDocuments`. **It is reusable** for the patch flow with no changes.
- **Severity: BLOCKING** — patches cannot leave the WORN state without this. Soak testing is gated.
- **Build cost: ~150 lines, 2 files**
  - PatchSection: add upload control row (mirrors `TestOrderDocuments`'s file-picker pattern, ~40 lines)
  - New endpoint `POST /api/cases/[id]/patches/[patchDetailsId]/working-copy-coc` — uploads via existing presigned-URL path, runs CoC date extraction, returns 409 for `coc_needs_confirmation`, on confirm: creates Document → calls `replaceWorkingCopy` → sets `PatchDetails.applicationDate` → leaves `testStatus = order_created` (~110 lines)
  - Reuses: `extractCocCollectionDate`, `extractCocSpecimenId`, `CocConfirmModal`, `/api/upload-url`

### 2. Executed CoC upload (at removal)

- **Status: NEVER IMPLEMENTED**
- **Evidence:**
  - [patchStatus.ts:46-76](src/lib/patchStatus.ts:46) defines `executePatchCoc(tx, { patchDetailsId, executedDocumentId, removalDate })` — sets `executedDocumentId`, nullifies `workingCopyDocumentId`, mirrors `removalDate` to `TestOrder.collectionDate`. **Grep confirms zero callers.**
  - Same UI gap as Cap 1 — no executed-CoC upload control in PatchSection.
  - The generic path at [documents/route.ts](src/app/api/cases/[id]/documents/route.ts:408) gets *some* of this right for an executed CoC (advances `testStatus` to `specimen_collected`, sets `collectionDate`) but misses: setting `executedDocumentId`, setting `removalDate` on PatchDetails, and (subtly) the working-copy archival via `executePatchCoc`'s nullification of `workingCopyDocumentId`.
- **Severity: BLOCKING** — without this, patches stay WORN forever; AT_LAB and COMPLETE are unreachable.
- **Build cost: ~120 lines, 1–2 files**
  - Same shape as Cap 1's endpoint, but at the executed-stage URL (e.g. `POST /api/cases/[id]/patches/[patchDetailsId]/executed-coc` — or merge with Cap 1 as `/coc?stage=working|executed`).
  - Calls `executePatchCoc` instead of `replaceWorkingCopy`. Sets `removalDate`. Advances `testStatus` to `specimen_collected` or `sent_to_lab` (decision deferred — see Cap 12).

### 3. Date extraction from CoC PDFs

- **Status: WORKS** — text + Vision fallback both still in code
- **Evidence:**
  - [extractCocCollectionDate.ts](src/lib/extractCocCollectionDate.ts) implements the two-stage pipeline: pdf-parse text first, Claude Vision fallback for handwritten dates.
  - Returns `{ collectionDate, source: "text" | "vision" | null }` per [line 23](src/lib/extractCocCollectionDate.ts:23). Vision fallback intact at [lines 88-156](src/lib/extractCocCollectionDate.ts:88).
  - 30-day recency window guards against handwriting misreads ([line 31](src/lib/extractCocCollectionDate.ts:31)).
  - Same pipeline for specimen ID via `extractCocSpecimenId`.
- **Severity: WORKS** — no build needed
- **Build cost: 0**
- **Note:** The user's brief mentioned "Vision-based date extraction was removed earlier this year per CoC pipeline overhaul memory." That memory appears stale or referred to a different subsystem — the CoC date extractor still uses Vision. No code change needed; possibly a memory update.

### 4. Lifecycle state transitions

- **Status: PARTIAL** — derivation works, but one transition is unreachable due to Cap 2
- **Evidence:**
  - [patchValidation.ts:194-202](src/lib/patchValidation.ts:194) `patchLifecycleStatus` is a pure function that derives `WORN | AT_LAB | COMPLETE | CANCELLED | null` from `{ applicationDate, cancellationKind, executedDocumentId, hasLabResult }`. **No state machine — state is derived from data presence.**
  - Transitions:
    - `null → WORN`: applicationDate gets set (works post-PR-30 via Edit modal)
    - `WORN → AT_LAB`: executedDocumentId gets set OR LabResult gets created (executedDocumentId path is **unreachable** — see Cap 2; LabResult path works for the back-door case where a result lands without a CoC, which is the data-integrity escape hatch documented at [patchValidation.ts:175-180](src/lib/patchValidation.ts:175))
    - `AT_LAB → COMPLETE`: requires BOTH executedDocumentId AND LabResult (both unreachable in normal flow until Cap 2 ships)
    - `* → CANCELLED`: works via `cancel-patch` route
- **Severity: PARTIAL** — derivation logic is fine; gap is upstream in Cap 2.
- **Build cost: 0** (gap closes when Cap 2 ships)

### 5. Lab result ingestion for patches

- **Status: PARTIAL** — generic ingestion works; CRL native-cocaine extractor bug is the known gap
- **Evidence:**
  - [documents/route.ts:199-346](src/app/api/cases/[id]/documents/route.ts:199) handles `result_report` uploads generically — calls `extractLabResult` and `generateResultSummary`, runs cross-checks, creates LabResult row, advances testStatus to `results_received` / `results_held`. **No patch-specific routing in the upload path — but it works correctly because the existing flow doesn't need patch-specific behavior here.**
  - [resultExtract.ts](src/lib/resultExtract.ts): only patch-aware mention is line 147 ("Urine-only validity indicators. Pass null for hair, blood, sweat patch, etc.") — correctly handled.
  - **CRL native-cocaine bug**: per ADR-0001 resolution #10 and the close-out yesterday, the extractor's tool schema doesn't mandate paired Cocaine + Benzoylecgonine emission for CRL sweat-patch reports. Forensic-accuracy gap. Independent of lifecycle wiring per the ADR, ships in parallel.
- **Severity: BLOCKER FOR CUTOVER, not for MVP ship.** Generic ingestion path WORKS for the normal-case. The CRL native-cocaine bug is reclassified — see the dedicated section below ("CRL Native-Cocaine Extractor Bug — Reclassified") for sequencing.
- **Build cost: ~30–50 lines for the CRL fix alone** (tool-schema/prompt change in `resultExtract.ts`). Sequenced after MVP ship, before cutover.

### 6. Result summary generation for patches

- **Status: WORKS** — patch-aware
- **Evidence:**
  - [resultSummary.ts:166-175](src/lib/resultSummary.ts:166) Example F is a fully-worked Negative Sweat Patch summary.
  - [resultSummary.ts:411](src/lib/resultSummary.ts:411) defines the sweat-patch panel substances and the rule that monitoring recommendations must verify the sweat patch can detect the positive substance.
  - [resultSummary.ts:421+](src/lib/resultSummary.ts:421) recommendation rules differentiate sweat patch vs urine vs hair, with explicit guards (e.g. "do NOT recommend sweat patch for PEth/EtG/EtS — sweat patches don't detect alcohol" at line 366).
- **Severity: WORKS** — no build needed for MVP
- **Build cost: 0**
- **Note:** A separate Legal Results Summary Chat Project may have richer interpretive rules not yet merged. Out of scope unless surfaced separately — orthogonal to lifecycle wiring.

### 7. Email draft generation for patch results

- **Status: WORKS** — uses generic `results` / `results_mro_complete` draftType, summary is patch-aware via Cap 6
- **Evidence:**
  - [/api/cases/[id]/compose-results/route.ts](src/app/api/cases/[id]/compose-results/route.ts) handles result drafts generically. Same flow for patches as for urine/PEth.
  - `EmailDraft.draftType` is freeform string. Existing values: `results`, `results_mro`, `results_mro_complete`, **`patch_cancellation`** (per [cancellation-report/route.ts:179](src/app/api/cases/[id]/cancellation-report/route.ts:179) — already shipped, not in CLAUDE.md). No collision with adding new values later.
  - When a patch lab result lands, the staff-triggered compose-results flow generates a draft using the patch-aware summary. Already wired via the same UI button on the case page that handles non-patch results.
- **Severity: WORKS**
- **Build cost: 0**
- **Note:** The ADR's anticipated patch lifecycle draftTypes (`patch_application`, `patch_removal_paid`, `patch_removal_unpaid`, `patch_cancellation_pre_ship`, `patch_cancellation_post_ship`, `patch_held_shipped`) are NOT shipped. They tie to Cap 8 (lifecycle notifications), not result drafts. Whether to ship them depends on Cap 8's auto-fire vs staff-trigger decision.

### 8. Notifications to case contacts on lifecycle events

- **Status: NEVER IMPLEMENTED** for patches; existing non-patch lifecycle notifications are staff-triggered (not auto-fire), so the pattern is reusable
- **Evidence:**
  - **No patch-specific email functions in [email.ts](src/lib/email.ts)** — grep returned zero matches for `patch` or `sweat`.
  - Existing non-patch lifecycle emails:
    - `sendSampleCollectedEmail` ([email.ts:512](src/lib/email.ts:512)) — fired manually via [POST /api/cases/[id]/send-collection](src/app/api/cases/[id]/send-collection/route.ts:29), not auto from upload route
    - `sendResultsHeldEmail` ([email.ts:970](src/lib/email.ts:970)) — fired manually via [POST /api/cases/[id]/send-results-held](src/app/api/cases/[id]/send-results-held/route.ts:28)
    - `sendResultsReleasedEmail` — fired manually from compose-results approval flow
  - Pattern: staff approves → email fires. No auto-fire on testStatus transitions for any test type (only sendNoShowEmail in [test-orders/route.ts:289](src/app/api/cases/[id]/test-orders/route.ts:289) when status changes to `no_show`).
  - For patches: APPLIED, AT_LAB, HELD notifications all need either (a) new email functions + new manual-trigger endpoints (matching the existing pattern), or (b) auto-fire from the new patch CoC endpoints.
- **Severity: IMPORTANT** — depends on the user's intent. If MVP needs patch-applied notification to fire when staff finishes the working-copy CoC upload, it must be wired up.
- **Build cost: ~150 lines**
  - 3 new email functions in `email.ts` (sendPatchAppliedEmail, sendPatchAtLabEmail, sendPatchHeldEmail) — each ~40 lines, mirrors `sendSampleCollectedEmail`'s shape with patch-specific copy
  - Either: fire from the new endpoints in Caps 1–2 (auto, ~10 lines each), or build matching `/send-patch-applied`, `/send-patch-at-lab`, `/send-patch-held` endpoints (~30 lines each)
- **Open design question:** auto-fire vs staff-trigger. Auto-fire is consistent with the patch flow being "I uploaded the CoC, the donor should know." Staff-trigger is consistent with the rest of the case-tracker's notification style. **Recommend: staff-trigger for MVP** — minimal departure from existing patterns; can flip to auto-fire later if soak shows staff routinely click immediately after upload.

### 9. Reminder/cron logic for patches

- **Status: PARTIAL** — minimal patch-awareness in reminders, none in crons
- **Evidence:**
  - [reminders/route.ts:79-98](src/app/api/reminders/route.ts:79) has the `staleOrders` query: sweat patches go stale after 7 days vs 2 days for others. Filters on `testStatus = "order_created"` — so a WORN patch (testStatus stays `order_created` post-PR-30) would still be flagged as stale once it crosses 7 days. **This is incorrect** for actively-WORN patches; they aren't stale, they're worn.
  - **No "patch worn 7 days, time to remove" reminder.** The `wearBadgeFor` function ([patchValidation.ts:118](src/lib/patchValidation.ts:118)) generates an in-UI yellow/orange/red wear-overdue band (yellow at 7d, orange at 10d, red at 30d) but this is rendering-only — no email or reminder bell entry.
  - The 11 UTC `seed-notifications` and 12-19 UTC `run-notifications` crons are donor-portal random-test reminders, not patch lifecycle.
  - The `create-test-orders` cron creates test orders from monitoring selections; patch-aware ([line 81](src/app/api/cron/create-test-orders/route.ts:81)) for the create-side but not relevant to lifecycle reminders.
- **Severity: NICE-TO-HAVE** for explicit reminders; **IMPORTANT** for the staleOrders bug — actively-WORN patches will appear in the reminder bell as stale after 7 days, which would be noisy and misleading.
- **Build cost: ~30–50 lines** — extend `staleOrders` query to exclude patches with `applicationDate IS NOT NULL` (they're WORN, not stale); optionally add a new "patch overdue for removal" reminder query.

### 10. Document type coverage for patch documents

- **Status: WORKS**
- **Evidence:**
  - [schema.prisma:130-140](prisma/schema.prisma:130) — `DocumentType` enum has 9 values including all patch-relevant ones: `chain_of_custody`, `result_report`, `cancellation_notice`, `correspondence`. Plus `monitoring_order` and `other`.
  - No anticipated documentType missing. CLAUDE.md is slightly out of date (missing `monitoring_order` and `cancellation_notice` from its list) but the schema is complete.
- **Severity: OUT-OF-SCOPE** — no gap
- **Build cost: 0**

### 11. PatchSection UI surface for lifecycle states

- **Status: WORKS in code, blocked in practice**
- **Evidence:**
  - [PatchSection.tsx:343-351](src/components/cases/PatchSection.tsx:343) `LIFECYCLE_STYLES` defines all 4 states: WORN, AT_LAB, COMPLETE, CANCELLED. Each renders with its own color and label.
  - [PatchSection.tsx:394-449](src/components/cases/PatchSection.tsx:394) `SubtitleForStatus` handles all 4 states with appropriate subtitle text (e.g. "Removed [date]" for AT_LAB, "Results received [date]" for COMPLETE, "Cancelled [date] · A replacement patch was applied [date]" for CANCELLED).
  - Action buttons are correctly state-gated:
    - "Cancel patch" only renders when lifecycle === "WORN" ([line 303](src/components/cases/PatchSection.tsx:303))
    - "Generate cancellation notice" only renders when lifecycle === "CANCELLED" ([line 312](src/components/cases/PatchSection.tsx:312))
    - "Edit" always renders
  - **In practice: only WORN is reachable** because Caps 1–2 are unwired. Once those land, the UI will render all states correctly without changes.
- **Severity: WORKS** — UI is forward-looking
- **Build cost: 0** for the existing 4 states. **Add one button (~15 lines)** in the WORN row for "Upload Removal CoC" or similar, to expose Cap 2's flow when the patch is removed.

### 12. TestOrder.testStatus vs patch lifecycle

- **Status: PARTIAL** — loose coupling; current sync is mostly correct but breaks if generic CoC route is reused for patch application
- **Evidence:**
  - For patches, current testStatus journey:
    - Created: `order_created` (correct)
    - After applicationDate set via Edit modal (post-PR-30): stays `order_created` ([test-orders/route.ts:259-271](src/app/api/cases/[id]/test-orders/route.ts:259) — patch side-channel doesn't touch testStatus). **Correct** — patch is in flight, no specimen has been collected from the lab's perspective.
    - After CoC upload via the existing generic route (Cap 1, would-be application time): **WOULD advance to `specimen_collected`** at [documents/route.ts:443](src/app/api/cases/[id]/documents/route.ts:443). **Wrong for application** — patch is on the donor, no specimen at the lab yet.
    - After CoC upload at removal (Cap 2): SHOULD advance to `specimen_collected` (correct — patch removed, going to lab).
    - After results land: `results_received` or `results_held` (correct, generic).
  - Generic flows reading `testStatus`:
    - Reminders' `staleOrders` query (Cap 9) — needs to exclude actively-WORN patches.
    - Phone-intake / case detail filters that group by status — should still work since order_created is correct for WORN patches.
    - `cron/create-test-orders` — only reads catalog + monitoring selection state, not testStatus.
  - **The problem isn't synchronization itself; it's that the generic `documents/route.ts` CoC commit logic is hostile to patches at application time.** Caps 1–2 should use *patch-specific endpoints* that bypass the generic commit logic, not the shared route. That avoids the sync problem entirely for application; for removal, the new endpoint can advance testStatus correctly to `specimen_collected`.
- **Severity: IMPORTANT** — needs intentional handling, but mostly resolves naturally if Caps 1–2 use patch-specific endpoints (recommended).
- **Build cost: ~30 lines** (the staleOrders query fix in reminders/route.ts; the rest is a non-issue if Caps 1–2 don't reuse the generic CoC route).

## Cross-cutting observations

1. **All CoC-related work for patches is unwired.** `replaceWorkingCopy` and `executePatchCoc` were written in the schema/helpers layer but no caller exists. The schema + helpers anticipated the lifecycle but the API/UI never delivered. PatchSection's UI shape (lifecycle badges + subtitle for all 4 states) confirms the *intent* was there.

2. **The generic CoC upload route is hostile to patches at application time.** [documents/route.ts:408](src/app/api/cases/[id]/documents/route.ts:408) advances `testStatus` to `specimen_collected` whenever a CoC lands, which is correct for non-patch tests and for patch *removal* but wrong for patch *application*. Pointing the existing UI at a patch row would mis-shape the data — same kind of misfile bug as PR #30 fixed for application/removal dates. **Patch CoC upload needs its own endpoint, not a parameter on the generic one.**

3. **The result side of the lifecycle is in much better shape than the CoC side.** Result extraction, result summary, and email draft generation all flow through generic infrastructure that's already patch-aware (resultSummary explicitly) or patch-agnostic-but-correct (compose-results). Once a patch reaches results_received, the rest of the flow is normal.

4. **Notifications across the case-tracker are staff-triggered, not auto-fire.** Patches can follow the same pattern with minimal effort — three new email functions + three new send-* endpoints. Auto-fire is a deliberate decision point, not the default.

5. **PatchSection UI is forward-looking.** All 4 lifecycle states render correctly when their conditions are met. The blocker is purely the data layer; once CoC upload lands, the UI activates without changes.

6. **No silent data-misfile bugs found beyond yesterday's PR #30 fix.** Stop condition #1 did not trigger. The closest analog — the generic CoC route's testStatus advance at application — is correctly characterized as "would be wrong if reused" rather than "currently silently wrong" because no patch UI invokes it today.

## Recommended MVP scope

For the normal-case patch lifecycle, the minimum buildable set:

1. **Cap 1: Working-copy CoC upload** (~150 lines, BLOCKING)
   - PatchSection upload control in WORN-and-pre-application rows
   - New endpoint `POST /api/cases/[id]/patches/[patchDetailsId]/coc` (or split into working/executed) that creates Document, calls `replaceWorkingCopy`, sets `applicationDate`, leaves `testStatus = order_created`
   - Reuses CocConfirmModal, extractCocCollectionDate, /api/upload-url

2. **Cap 2: Executed CoC upload** (~120 lines, BLOCKING)
   - Same shape as Cap 1 but at removal stage
   - Calls `executePatchCoc`, sets `removalDate`, advances `testStatus` to `specimen_collected`
   - Triggered from a "Upload removal CoC" button in WORN rows that already have an applicationDate

3. **Cap 8: Lifecycle notifications** (~150 lines, IMPORTANT)
   - Three email functions: `sendPatchAppliedEmail`, `sendPatchAtLabEmail`, `sendPatchHeldEmail`
   - Three staff-trigger endpoints (matches existing pattern)
   - Recommend staff-trigger for MVP, not auto-fire

4. **Cap 9 partial: Reminders staleOrders fix** (~30 lines, IMPORTANT)
   - Exclude actively-WORN patches (those with `applicationDate IS NOT NULL`) from the stale-order check

5. **Cap 11 partial: PatchSection upload-CoC button** (~15 lines, BLOCKING — surfaces Cap 2)
   - One button in the WORN row to open the executed-CoC upload flow

**Total: ~465 lines, 4–5 files touched.**

Out of MVP:
- **CRL native-cocaine extractor fix** (Cap 5) — reclassified as blocker for cutover, not MVP ship. See dedicated section below.
- **Wear-overdue email/reminder cron** (Cap 9 nice-to-have) — UI band is sufficient signal until soak shows otherwise
- **Auto-fire vs staff-trigger for notifications** — design decision deferred; MVP uses staff-trigger
- **Anything in scope of ADR-0001 rebuild** — patch table separation, polymorphic FKs, etc.
- **5 existing PatchDetails stubs + 10 historical orphans** — wipe before MVP ship per Cap 0 (greenfield framing); no migration

## Cutover Criteria

Before the case tracker becomes the authoritative system of record for patch cases (and TestVault drops to backup-only for patches), all of the following must be true:

- [ ] 5 consecutive patch cases run end-to-end in the tracker with zero manual DB edits required at any lifecycle stage
- [ ] All 4 lifecycle states (PENDING → APPLIED → WORN → REMOVED) render correctly in the UI for those 5 cases
- [ ] Working-copy CoC and executed CoC both upload, parse, and land in the correct DB columns for those 5 cases
- [ ] Removal date correctly triggers the shipment reminder email
- [ ] Lab result ingests and the result summary reads correctly in court-ready format for at least 2 of the 5 cases (need actual results back, not just collection)
- [ ] CRL native-cocaine extractor bug is fixed and verified against eval fixtures (blocker for cutover, not for MVP ship)
- [ ] Side-by-side comparison of tracker output vs TestVault output for those 5 cases shows no material discrepancy in CoC dates, specimen IDs, or result interpretation

If any criterion fails, parallel run continues and the failing item goes on the fix list. Do not cut over on partial criteria.

## Parallel Run

**Duration:** minimum 5 completed patch cases AND minimum 30 days, whichever comes second. Both gates must clear before cutover is considered.

**What gets double-entered:** every patch case during parallel run is entered into both TestVault (authoritative) and the case tracker. No exceptions, no "this one's simple, just put it in the tracker." The whole point is to surface discrepancies, which only happens with full double entry.

**Owner:** Colleen runs the double entry. Michael owns the side-by-side comparison after each case completes (CoC dates, specimen IDs, result text, summary output, email triggers).

**Failure mode to watch for:** double entry quietly stops around week two because it's annoying and the tracker "seems to be working." If this happens, the parallel run is invalid and the clock resets — five cases of single-entry tracker data is not evidence the tracker is correct, it's just evidence nothing has gone visibly wrong yet.

**Exit:** when both duration gates clear AND all Cutover Criteria are met, flip the tracker to authoritative for new patch cases. TestVault continues as backup-only for patches (matching its current role for non-patch tests).

## CRL Native-Cocaine Extractor Bug — Reclassified

**Previous classification:** "Already works (modulo CRL bug)" under Cap 5 (result ingestion); deferred as out-of-MVP.

**Revised classification:** Blocker for cutover. NOT a blocker for MVP ship.

**Reasoning:** while TestVault is authoritative during parallel run, the human-readable lab PDF stored in TestVault is what stands in court. The tracker's structured extraction is a convenience layer. A miss on native cocaine in the tracker during parallel run is recoverable — the source PDF still has it.

The moment cutover happens and the tracker becomes authoritative, that same miss becomes a forensic defect: a positive parent-drug result misreported as metabolite-only reads materially differently in family court.

**Sequencing:** ship MVP → begin parallel run → fix CRL extractor bug (tool schema + prompt update in `resultExtract.ts`) → verify fix against eval fixtures including the case from the 2026-04-26 backfill dry-run that surfaced this → only then cut over.

## Items deferred (with reasoning)

1. **Result-summary improvements from the Legal Results Summary Chat Project** — Mentioned in the user's brief as having richer interpretive rules not yet merged into `resultSummary.ts`. Orthogonal to lifecycle wiring; existing summary is already patch-aware enough for MVP.

2. **Auto-fire notifications on lifecycle transitions** — The design question (auto-fire from CoC upload endpoints vs staff-triggered like all other case-tracker notifications). Recommend deferring the decision: ship staff-triggered for MVP, observe parallel-run behavior, flip if staff routinely click immediately. Auto-fire adds complexity for behavior that may already happen organically.

3. **Wear-overdue email reminder** — The UI-side wear band (yellow/orange/red chip) already gives staff visibility from the reminder bell context. Adding email reminders is a noise-vs-value question best answered by parallel-run data, not by the audit.

4. **Vision-removed memory note** — The user's brief mentioned a memory note that Vision was removed from CoC date extraction. The code shows Vision is still active. Either the memory is stale or it referred to a different subsystem. Worth a memory check independently; not a code change.

5. **Patch-specific draftTypes from ADR (`patch_application`, `patch_removal_paid`, etc.)** — These are anticipated but not shipped. They'd be relevant if Cap 8's notifications use `EmailDraft` rows for review-before-send (the "approve and send" pattern from spec §11.7). For MVP recommend direct send (matches existing `sendSampleCollectedEmail` pattern), not draft-then-approve. If review pattern is desired, add ~50 lines to use draftType.

6. **Cap 12 generic-route hostility documentation** — Not a code change, but worth noting in CLAUDE.md or a code comment in `documents/route.ts` that the CoC commit logic is non-patch-only by design. Prevents future regressions where someone wires a patch route to it.

## Out of scope for this audit (per user brief)

Confirmed not investigated:
- Cancellation flow (separate audit forthcoming)
- Multi-patch cycles
- HELD sub-states beyond "unpaid"
- Billing classification
- 10 historical orphan TestOrders — leave as-is permanently
- 5 existing PatchDetails stubs — wipe before MVP ship per Cap 0 greenfield framing

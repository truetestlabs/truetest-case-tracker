# Session handoff — 2026-05-10 evening (post-PR-#48-prerequisite work)

## Where we started

Today's objective was PR #48: fix Bug 1 (Removal Date validator on Edit Test Order modal) and Bug 2 (no auto-prompt for Application Date after CoC upload). Prep work flagged dev Supabase auth as deferred — "five minutes to fix" — so the session opened by unblocking dev verification before the bug-fix PR.

That five-minute task became the whole evening. Four configuration/seed drift bugs were uncovered and fixed; the original PR #48 was not started.

## Where we ended

**Merged:** chore(seed): hashed-slug CUIDs, post-PR-#47 CoC type, CRL catalog fixture (PR #__, see GitHub). Branch deleted, main is clean locally.

**Dev environment status:** Mostly working.
- `.env` correctly points all variables at dev project `dbgiinfiddvnbpwcagml`.
- Seed runs idempotent: 2 Cases, 2 TestOrders, 2 PatchDetails, 1 Document, 1 TestCatalog, 2 Contacts.
- ALPHA case (`/cases/cfa0f9424054e14b0c4dda343`) renders clean pre-application state.
- BETA case (`/cases/cfa274ae38518b521ad39904c`) renders placeholder PDF in Application CoC slot (not Legacy).
- Dev auth user: `mgammel@mac.com`, UID `304ffb57-64d4-4540-b996-6c65a32863ba`.

**Dev environment NOT working:**
- Document uploads from the browser fail at the Supabase Storage call with `Invalid Compact JWS` (403). Root cause not yet diagnosed. See "Open issue" below.
- Cases list page shows "no cases found" even though seeded cases exist — likely a user/ownership filter on the list query. Not investigated. Direct URL navigation works.

## What was actually shipped today

Each PR represented a discovery that wasn't visible from code review alone:

1. **PR (merged)** — seed fixtures (hashed-slug CUIDs + BETA documentType + CRL catalog row)
2. **prisma db push to dev** — PR #47's `coc_application` and `coc_removal` enum values weren't on dev DB; pushed manually
3. **`.env` reconfiguration** — NEXT_PUBLIC_SUPABASE_URL and ANON_KEY were pointing at prod (scenario 1 confirmed: local dev was hitting prod for at least a day, possibly longer)
4. **Dev auth user creation** — auth.users in dev was empty; created via dashboard

## Original PR #48 scope — still pending

Two bugs from the original handoff, neither touched today:

**Bug 1 (validator):** Edit Test Order modal blocks save with "Please fill out this field" on Removal Date when operator is just setting Application Date. The `*` on Removal Date and the helper text "Required when marking specimen collected" disagree. Fix: make Removal Date validation conditional on `testStatus === "specimen_collected"`. Also strip the unconditional `*` from the label.

**Bug 2 (UX):** After uploading Application CoC, no prompt fires for application date. Operator has to click Edit → fill Application Date → Save manually. Fix per original design: modal fires only after Application CoC upload, pre-fills with today (Chicago), application date required to complete the upload, cancel-keeps-modal-open. **Open design question:** what if operator uploads Application CoC before the donor visit happens? (E.g. paperwork uploaded ahead of an appointment.) If that workflow exists, option (b) creates a sharp edge. Need to answer this before writing the modal.

## Open issue — needs investigation tomorrow

**Title:** Storage uploads fail on dev with "Invalid Compact JWS" (403)

**What we know:**
- The `sb_secret_*` key from dev project's API Keys → Secret keys section is rejected by Supabase Storage as "Invalid Compact JWS"
- The same code path on **prod is working fine** — confirmed by reading prod `Document` rows: most recent upload was 2026-05-10 22:29:38 (sean tanner COC.pdf, coc_application type), multiple successful uploads daily including hours before this session ended
- Code is a single shared path (`src/lib/storage.ts` + `src/app/api/upload-url/route.ts`), no env branching
- `SUPABASE_SERVICE_ROLE_KEY` is now set in dev `.env` (one rotation was forced after a leak in this session — the current value is post-rotation)

**Hypothesis to test first:** Vercel's prod env var for `SUPABASE_SERVICE_ROLE_KEY` may still hold a JWT-format key (from before 2026-05-09 remediation) even though the public docs say to migrate. The dev project's `sb_secret_*` key may be the new format, which Storage's HTTP API doesn't accept the way the code currently calls it.

**Tomorrow's diagnostic steps:**
1. Open Vercel dashboard → truetest-case-tracker project → Environment Variables. Look at `SUPABASE_SERVICE_ROLE_KEY` (prod scope). Is its value a JWT (three `.`-separated base64 segments) or an opaque `sb_secret_*` token?
2. Check the "Legacy anon, service_role API keys" tab on the dev project's Supabase API Keys page. Is a JWT-format service-role key still available there?
3. If yes: use that JWT-format key on dev. If it works, that confirms the hypothesis — the 2026-05-09 remediation didn't fully migrate Storage to the new key format, and prod has been working only because its env var still holds the old JWT.
4. The fix is then either:
   - **Option A:** keep prod and dev both on the legacy JWT for now, document that the 2026-05-09 remediation is incomplete for Storage. Open a separate, scoped PR to fully migrate Storage to the new key format.
   - **Option B:** update `src/lib/storage.ts` to use the new Supabase client SDK pattern that handles both formats. Cleaner but bigger PR.

**Why this is worth doing first thing tomorrow:** every PR that touches an upload path is verification-blind on dev until this is fixed. Same problem the dev auth gap caused this whole evening.

## Other findings worth noting (not blocking, but real)

**The Cases list "no cases found" thing.** Seed cases exist in DB and load via direct URL. The Cases list query is probably filtering by user/ownership in a way the seed doesn't satisfy. Easy to debug once dev is fully usable. Tomorrow or whenever.

**Sean Tanner / TTL-FL-2026-0011 has two `sean tanner COC.pdf` Document rows on prod, ~30 minutes apart** — one as `chain_of_custody` (legacy), one as `coc_application` (post-PR-#47). Operator probably re-uploaded after seeing the Legacy slot. Worth a heads-up that the Legacy row will keep showing alongside the Application CoC unless deleted. Cosmetic, not urgent.

**`prisma db push` vs `prisma migrate deploy`** continues to be deferred tech debt. Today added one more silent enum-additive migration to prod and required a manual push to dev. Eventually this needs to become migration files. Not tomorrow's task either.

**Memory bug fixed mid-session:** Memory had been resurfacing "rotate dev DB password (outstanding from 2026-04-27)" as a current task for two weeks. The rotation actually happened 2026-05-01 during the sweat patch workflow fix. Added memory edit to stop the resurface.

## Verification approach going forward

The pattern that worked tonight:
- Every "this is shipped" claim is gated on browser walkthrough, not on tsc + tests passing
- Every destructive operation gets a dry-run preview printed before execution
- Secrets never appear in chat — use the clipboard-free script pattern (cat > /tmp/foo.txt → paste → enter → ctrl+D → script reads from file → script deletes file)

The pattern that did NOT work tonight:
- Trusting the memory-flagged "outstanding" list without verification — surfaced stale items as live tasks
- Bundling a fix into the in-flight PR when it's actually a separate concern (Storage auth)

## Recommended tomorrow

1. **First thing:** Diagnose the Storage auth issue per the hypothesis above. ~30-60 minutes. Either fixes dev permanently or surfaces a prod-affecting bug we didn't know we had.
2. **Then:** Original PR #48. Bug 1 and Bug 2 from the morning handoff. With dev fully working, this PR's verification can happen on dev without burning prod cycles.
3. **Bug 2 design question** (from this morning's session): answer the "what if Application CoC arrives before donor visit" question before writing the modal. Thirty seconds of decision time saves an hour of rework.

After that, continue walking the patch lifecycle on dev (transitions 3-7 on the state-transition inventory). 1 of 8 was verified at start of today; ALPHA + BETA fixtures unblock 2-3 more. Each gap surfaced on dev is one less surprise on prod.

## State files

- Branch: main (clean, working tree clean)
- Last commit on main: the seed-fix squash
- Dev `.env`: configured for dev project, post-rotation secret key, seed-user UID populated
- Dev DB: 10 fixture rows + 1 catalog row + 1 auth user + 1 pre-existing Case/TestOrder/Contact from before seed-fix-PR

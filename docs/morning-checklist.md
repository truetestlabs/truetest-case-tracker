# Morning Checklist — Wrap up Phase 1 deploy

**Goal:** Get last night's security changes deployed without breaking the marketing site's order form. ~30–45 minutes total.

**Important pivot from the plan:** The marketing site is a static HTML site on Cloudflare Pages. A static site can't safely hold an HMAC secret — anyone viewing page source can read it. So we're going to **make HMAC optional** on `/api/public/order` (origin allowlist + rate limit do the heavy lifting), and reserve real HMAC for the future USDTL webhook where it actually makes sense.

---

## Part A — Generate and store the HMAC secret (5 min)

We're still going to generate and store the secret. It's not used by the marketing site, but it's the same value the future USDTL webhook will use, and it costs nothing to set it now.

1. Open Terminal.
2. Generate the secret:
   ```bash
   openssl rand -hex 32
   ```
   You'll get a 64-character hex string — copy it.
3. Save it somewhere durable:
   - 1Password / Bitwarden / your password manager of choice
   - Title: `TrueTest Case Tracker — PUBLIC_ORDER_HMAC_SECRET`
   - Notes: "Used for HMAC verification of inbound webhooks to /api/public/order and (eventually) /api/webhooks/usdtl. Not used by the marketing site."

---

## Part B — Set the Vercel environment variables (10 min)

1. Open https://vercel.com in your browser, sign in.
2. Click into the **truetest-case-tracker** project.
3. Top nav → **Settings** → left sidebar → **Environment Variables**.
4. Add the first variable:
   - **Key:** `PUBLIC_ORDER_ALLOWED_ORIGINS`
   - **Value:** `https://truetestlabs.com,https://www.truetestlabs.com`
   - **Environments:** check all three — Production, Preview, Development
   - Click **Save**
5. Add the second variable:
   - **Key:** `PUBLIC_ORDER_HMAC_SECRET`
   - **Value:** (paste the secret from Part A)
   - **Environments:** check all three
   - **Sensitive:** check the box (hides the value in the UI after save)
   - Click **Save**
6. While you're here, double-check these vars also exist (they should already):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `GOOGLE_SERVICE_ACCOUNT_KEY` / `GOOGLE_CALENDAR_ID`
   - `TWILIO_*`
   If any are missing, the relevant feature will throw on first use post-deploy.

---

## Part C — Have me relax the HMAC requirement (10 min)

Once you're back at the keyboard with me, just say **"relax HMAC on public/order"** and I will:

1. Edit `src/app/api/public/order/route.ts` so the HMAC check becomes:
   - **If `X-TrueTest-Signature` header is present** → verify it; reject with 401 on mismatch.
   - **If absent** → continue, relying on the origin allowlist + rate limit + zod validation for protection.
2. Update the comment block at the top of the file to explain *why* (so future-me doesn't "fix" it back).
3. Run typecheck + production build.
4. Commit and push.

The marketing site keeps working with no changes. The HMAC capability stays in place for the day we plug in USDTL or any other server-to-server caller that *can* hold a secret.

---

## Part D — Verify the deploy (5 min)

1. Watch the Vercel deploy on the project's **Deployments** tab. It should auto-trigger from the push in Part C. Wait for the green check.
2. Smoke test in production:
   - Load https://truetestlabs.com (the marketing site, currently the WordPress one — does the order form still render and submit cleanly?)
   - Open the case tracker, log in, create a test case to confirm the new auth + audit logging works
   - Check `/dashboard/audit-log` to see if the audit row landed
3. If anything blows up, the rollback is one git revert: `git revert 048b478 646a4e8 && git push`.

---

## Part E — Optional: Turnstile on the marketing form (defer)

If you want real bot protection on the order form (separate from HMAC), the right tool is **Cloudflare Turnstile** — it's free, no PII, no ugly captcha. We add a small widget to the form, the marketing site sends the token in the POST body, and `/api/public/order` verifies the token with Cloudflare before processing.

This is a separate ~30-minute task and should happen *after* the Cloudflare Pages cutover (since the marketing site is moving from WordPress to Pages soon anyway, and Turnstile fits naturally on Pages). Don't do this in the morning — just put it in the backlog.

---

## What we're NOT doing in the morning

- ❌ **Phase 2** (schema changes, WebhookEvent, LabResult, resultReceived service) — still gated on the USDTL discovery call answering question 3 (who assigns the accession number).
- ❌ **Sending the USDTL reply email** — that's a one-line copy/paste, do it whenever you want, no dependency on this checklist.
- ❌ **Marketing site changes** — none needed for the order form to keep working with the relaxed HMAC.
- ❌ **Tidiness items** from the deferred backlog (dead schema fields, prisma migrations dir, etc.) — separate session.

---

## TL;DR — the morning in 4 lines

1. Generate `openssl rand -hex 32`, save in 1Password.
2. Add `PUBLIC_ORDER_ALLOWED_ORIGINS` and `PUBLIC_ORDER_HMAC_SECRET` to Vercel (Production + Preview + Dev).
3. Tell me "relax HMAC on public/order" and I'll patch + commit + push.
4. Watch the deploy go green and click around to make sure nothing's broken.

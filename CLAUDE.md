# CLAUDE.md — TrueTest Labs Case Tracker

## Project status (as of 2026-04-16)

- **Case tracker:** Next.js 15 + Supabase (project `ydziufgdiqmikkmdxafx`) + Prisma 6 ORM. Deployed on Vercel (truetestlabs-projects). Active development.
- **Live website:** WordPress on GoDaddy at truetestlabs.com. Email: mgammel@truetestlabs.com.
- **New website:** Static HTML in `~/playground/truetest-site` (Cloudflare Pages). Not yet live.

## Build

- `npm run build` runs `prisma generate && next build`
- TypeScript/ESLint checks are **skipped in Vercel build** (`ignoreBuildErrors: true` in `next.config.ts`) to avoid OOM on Vercel workers. Run `npx tsc --noEmit` locally before pushing.
- If Vercel build fails in under 2 minutes, suspect an env var issue (not OOM). Check `npx vercel env ls`.

## Stack & key files

- **Auth:** Supabase SSR auth. Sidebar + pages require login.
- **Layout:** `ConditionalLayout.tsx` — sidebar hidden on mobile, hamburger drawer on small screens. Standalone routes (login, /intake, /kiosk, /checkin, /reports) skip sidebar.
- **Email:** Resend via `src/lib/email.ts`. `sendDraftEmail()` attaches PDFs from Supabase Storage.
- **SMS:** Twilio via `src/lib/sms.ts`. Local number `(231) 880-3966`. A2P 10DLC not yet registered — some carriers may filter messages.
- **Storage:** Supabase Storage via `src/lib/storage.ts`. `downloadFile()` returns `{ buffer }`.
- **AI:** Anthropic SDK via `src/lib/claude.ts` (claude-opus-4-5). `generateResultSummary()` and `generateMroSummary()` in `src/lib/resultSummary.ts`.
- **Test catalog:** Seeded via `prisma/seed.ts`. Seed does full `deleteMany()` then re-inserts. If FK constraints block the seed (e.g., MonitoringSchedule references), use SQL directly via Supabase MCP.
- **Email drafts:** Stored in `EmailDraft` table with `draftType`: `results`, `results_mro`, `results_mro_complete`. Draft body/subject editable and regenerable from the reminder bell modal.

## Key workflows

- **Phone Intake** (`/dashboard/phone-intake`): Staff booking flow. Sends SMS + email confirmation on book. Optimized for mobile — add to home screen for app-like use. Quick Intake (`/intake`) removed from sidebar.
- **Results email flow:** `POST /api/cases/[id]/compose-results` creates an `EmailDraft`. Staff reviews/edits in the reminder bell, then approves to send. MRO-complete drafts parse the MRO PDF with Claude on demand and cache the summary in `document.extractedData`.
- **MRO flow:** Upload correspondence doc → "Release MRO Report" button → creates draft with AI summary → attach MRO PDF + lab result PDF on send. Regenerate button in draft modal re-parses without resetting test status.
- **Document upload:** Two-step — client gets presigned URL from `/api/upload-url`, uploads directly to Supabase, then POSTs metadata to `/api/cases/[id]/documents` for parsing/AI summary/status advancement.

## Document types

`result_report`, `chain_of_custody`, `correspondence` (MRO reports), `other`, `court_order`, `invoice`, `agreement`

## Test order statuses (in order)

`order_created` → `awaiting_payment` → `payment_received` → `specimen_collected` → `sent_to_lab` → `results_received` / `results_held` → `results_released` → `at_mro` → `mro_released` → `closed`

## External services

- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (+12318803966)
- **Resend:** `RESEND_API_KEY`, `FROM_EMAIL`, `REPLY_TO_EMAIL`
- **Google Calendar:** `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_KEY`
- **Anthropic:** `ANTHROPIC_API_KEY`
- **Supabase:** `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

## AI phone agent

Callers reach a virtual receptionist that greets, takes a message, classifies intent/segment/urgency, texts the caller a confirmation, and logs everything to `CallLog`. Two runtime paths co-exist on this branch:

### Vapi (primary — production path)

Vapi is a managed voice-AI platform: they run STT (Deepgram Nova-3), LLM (Anthropic Sonnet 4.6), TTS (ElevenLabs Sarah, turbo v2.5), turn-taking, and barge-in. Our server only answers webhooks for tool calls and end-of-call reports. Sub-second latency, natural voice, caller-can-interrupt.

- **Assistant config:** `src/lib/vapiAgent.ts` — builds the full JSON from the shared system prompt in `src/lib/voiceAgentPrompt.ts`. Voice, model, transcriber, tools, analysis plan all live here.
- **Webhooks:**
  - `POST /api/vapi/tool` — dispatches `take_message` + `end_call` tool calls.
  - `POST /api/vapi/events` — consumes `end-of-call-report` (populates transcript, summary, Vapi structured analysis), then fires recap SMS + staff SMS.
  - `GET /api/vapi/config` — auth-required; returns the assistant JSON for paste into the Vapi dashboard or `POST https://api.vapi.ai/assistant`.
- **Env vars:**
  - `VAPI_WEBHOOK_SECRET` — shared secret echoed as `x-vapi-secret` on every webhook. Reject if missing/wrong.
  - `PUBLIC_APP_URL` — absolute origin used in the generated config (otherwise we fall back to the request origin).
  - `STAFF_NOTIFY_NUMBERS` — comma-separated E.164 list that gets an SMS summary after every completed call.
- **Setup:**
  1. Sign up for Vapi, buy a phone number (or BYO a Twilio number and connect it).
  2. `GET /api/vapi/config` while signed in, paste the JSON into Vapi → Assistants → Create.
  3. In the Vapi dashboard, set the phone number's assistant to the new one and confirm the server URL shows `/api/vapi/events`.
  4. Set `VAPI_WEBHOOK_SECRET` in Vercel to match the value Vapi sends.
  5. Place a test call. Verify transcript + summary land on `/dashboard/calls` and the recap SMS arrives.
- **DOT/HIPAA posture:** agent never reads results aloud and doesn't confirm whether a specific person is a client. `hipaaEnabled: true` in the Vapi config disables their retention of transcripts/recordings beyond the webhook delivery.

### Twilio-native fallback (reference / Phase 1 path)

Earlier pure-Vercel implementation using TwiML `<Gather>` + Polly voices + Claude Haiku per turn. Left in place as a reference and as a fallback if we ever need to run without a third-party voice platform. Higher per-turn latency (~2–4s) and no barge-in — not recommended for production traffic.

- **Routes:** `POST /api/voice/incoming`, `POST /api/voice/turn?callLogId=...`, `POST /api/voice/status`. All three validate `X-Twilio-Signature`.
- **Ring-group:** `POST /api/voice/ring-group` dials `RING_GROUP_NUMBERS` for `RING_GROUP_TIMEOUT_SEC`s, then `<Redirect>`s to `/api/voice/incoming`. For post-port Twilio-only setups.
- **Extra env:** `VOICE_SKIP_SIGNATURE=1` for local ngrok testing only.

## Domain & DNS

- truetestlabs.com is on GoDaddy (no Cloudflare). Edge redirects not possible until Pages cutover.
- After Pages cutover, `_redirects` in `truetest-site` is the canonical place for path redirects.

## Lab result PDFs — hard requirement

For **every** lab integration (USDTL and any future lab), we must retrieve and store the **unaltered, lab-produced final PDF** of the result report. That original PDF is what gets attached to client results emails, the MRO referral email, and stored in Supabase Storage as a `result_report` document. Never regenerate, re-render, or modify it. AI summaries live in the email body or a separate doc — the lab PDF passes through byte-for-byte. Note: lab reports are **not** signed — MRO signatures are a separate DOT-regulated step that happens downstream. If a lab can't provide the final PDF (only structured data), they aren't a viable partner.

## UI rules

Before editing any UI component: describe layout, colors, spacing, mobile behavior, and button states. Get approval before implementing.

# Monitoring / Random Schedule — Redesign Vision

Captured 2026-04-19 during review of TestVault's scheduling UI as a reference.

## Current state

- Schedule model is single-test per schedule (one `testCatalogId`).
- Random selections are generated 60 days ahead at creation; no rolling regeneration.
- Donor check-in is PIN-based via `POST /api/checkin?pin=...` — donor calls in M–F to learn if they're selected.
- No donor-facing portal, no push notifications, no auto-generated order PDF.
- UI is a flat card showing upcoming + past selections on one page.

## Near-term (shipping now)

- **Tab-based card layout** on `MonitoringScheduleCard`: Selections | Details | Call Log. Pure UI restructure, no schema/API changes.

## Mid-term vision

### Donor-facing portal (PWA + web fallback)

- Installable PWA for donors who will use it; plain website at the same URL for those who claim they can't install apps.
- Login by 6-digit PIN (already on the schedule).
- On selected days: the portal shows "You're selected today, report by [time], here's your order" with the Quest ESP-generated PDF (uploaded manually by staff on selection day for now; eventually automatable via a Quest API or drop folder).
- The order PDF has a barcode; donor shows it on their phone at the collection site; collection site scans it.

### Notification cadence (escalating, not constant)

Better than either "check M–F" or "every 5 min" — use an **escalating
cadence on selection days only**:

1. 7am — initial push notification + SMS
2. 9am — repeat push + SMS if no PIN ack
3. 11am — repeat + email
4. 1pm — automated phone call
5. All stop the moment the donor enters their PIN (acknowledges receipt)

Non-selection days: app is silent. This avoids conditioning donors to
ignore notifications (which is what kills the "daily check-in" model)
without hammering them every 5 minutes.

### Order PDF generation

For now: staff manually uploads the Quest ESP-generated PDF on selection
day, linked to the random selection record. Donor sees it in the portal.
Later, if Quest exposes an API, we can auto-fetch.

### Chain of custody

The lab's pre-printed paper COC remains the legal chain-of-custody
document. What we show in the portal is a requisition/order, not the
COC. Collection site still uses the lab's paper COC when the donor
arrives.

## Later / open questions

- Multi-specimen schedules (urine + hair on same random date).
- Rolling selection generation (nightly cron to extend the 60-day
  lookahead window; currently schedules silently deplete).
- "Mark Completed" UI action (data model supports it; UI doesn't).
- DOT flag (skipped for now — family-law/private-pay focus).

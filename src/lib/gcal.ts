import { google, calendar_v3 } from "googleapis";
import { JWT } from "google-auth-library";

/**
 * Google Calendar integration for TrueTest Case Tracker.
 *
 * Google Calendar is the source of truth for appointment availability —
 * Square walk-in bookings already sync into the shared TrueTest calendar,
 * and this module lets the case tracker READ busy intervals from Google
 * (to render the slot grid) and WRITE events back (when phone-intake
 * books an appointment).
 *
 * ONE-TIME SETUP (Michael):
 *   1. console.cloud.google.com → create project → enable Calendar API
 *   2. IAM → Service Accounts → create "truetest-case-tracker"
 *      → Keys → Add key → JSON → download
 *   3. Open Google Calendar settings for the shared "TrueTest Labs"
 *      calendar → Share with specific people → add the service account
 *      email (truetest-case-tracker@<project>.iam.gserviceaccount.com)
 *      → permission: "Make changes to events"
 *   4. Copy the Calendar ID from that same settings page
 *   5. Add to .env.local (and Vercel env):
 *        GOOGLE_SERVICE_ACCOUNT_KEY='<the whole JSON on one line>'
 *        GOOGLE_CALENDAR_ID='abc123@group.calendar.google.com'
 *
 * If either env var is missing, this module is a silent no-op —
 * local dev and staging run without Google creds. All API errors are
 * swallowed: a Google outage must never block a case-tracker booking.
 */

/**
 * GOOGLE_CALENDAR_ID — the primary calendar where new events are WRITTEN.
 * GOOGLE_CALENDAR_IDS — comma-separated list of ALL calendars to check for
 * busy intervals (freebusy). If not set, falls back to just GOOGLE_CALENDAR_ID.
 *
 * Example:
 *   GOOGLE_CALENDAR_ID="michael@truetestlabs.com"
 *   GOOGLE_CALENDAR_IDS="michael@truetestlabs.com,ab990ea3d73b...@group.calendar.google.com"
 */
const primaryCalendarId = process.env.GOOGLE_CALENDAR_ID;
const allCalendarIds = process.env.GOOGLE_CALENDAR_IDS
  ? process.env.GOOGLE_CALENDAR_IDS.split(",").map((s) => s.trim()).filter(Boolean)
  : primaryCalendarId
  ? [primaryCalendarId]
  : [];
const serviceAccountKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

let cachedClient: calendar_v3.Calendar | null = null;
let initAttempted = false;

function getClient(): calendar_v3.Calendar | null {
  if (cachedClient) return cachedClient;
  if (initAttempted) return null;
  initAttempted = true;
  if (!primaryCalendarId || !serviceAccountKeyRaw) {
    console.warn("[gcal] env vars missing — Google Calendar sync disabled");
    return null;
  }
  try {
    // Accept either raw JSON or base64-encoded JSON (some hosts prefer b64
    // to avoid newline/quote escaping in env config)
    let keyJson = serviceAccountKeyRaw.trim();
    if (!keyJson.startsWith("{")) {
      keyJson = Buffer.from(keyJson, "base64").toString("utf-8");
    }
    const key = JSON.parse(keyJson);
    const auth = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/calendar"],
      // Domain-Wide Delegation: impersonate the Workspace user so the
      // service account has full access to their calendars without needing
      // explicit sharing (which Workspace admin policies were blocking).
      subject: process.env.GOOGLE_CALENDAR_IMPERSONATE || "michael@truetestlabs.com",
    });
    cachedClient = google.calendar({ version: "v3", auth });
    console.log(`[gcal] client initialized. subject=${auth.subject}, email=${auth.email}`);
    return cachedClient;
  } catch (e) {
    console.error("[gcal] failed to init client:", e);
    return null;
  }
}

export type BusyInterval = { start: Date; end: Date };

/**
 * Query ALL events on the configured calendars for a time range. Returns
 * their start/end times as busy intervals that block appointment slots.
 *
 * Uses the Events list API instead of freebusy so that events marked as
 * "Free" (the Lab calendar default) still block slots. The freebusy API
 * only returns events with status=busy, which misses most Lab events.
 *
 * Fails open: returns [] on error so read failures don't block booking.
 */
export async function getBusyIntervals(
  rangeStart: Date,
  rangeEnd: Date
): Promise<BusyInterval[]> {
  const client = getClient();
  if (!client || allCalendarIds.length === 0) return [];

  const allBusy: BusyInterval[] = [];

  for (const calId of allCalendarIds) {
    try {
      console.log(`[gcal] events.list calId=${calId} range=${rangeStart.toISOString()}..${rangeEnd.toISOString()}`);
      const res = await client.events.list({
        calendarId: calId,
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        singleEvents: true, // expand recurring events
        orderBy: "startTime",
        maxResults: 100,
        // Only need start/end — minimize data transfer
        fields: "items(start,end,status)",
      });
      const events = res.data.items ?? [];
      console.log(`[gcal] events.list returned ${events.length} events for ${calId}`);
      for (const ev of events) {
        // Skip cancelled events
        if (ev.status === "cancelled") continue;
        const start = ev.start?.dateTime ?? ev.start?.date;
        const end = ev.end?.dateTime ?? ev.end?.date;
        if (start && end) {
          allBusy.push({
            start: new Date(start),
            end: new Date(end),
          });
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[gcal] events.list failed for ${calId}: ${msg}`);
      // Continue to next calendar — don't let one failure block all
    }
  }

  return allBusy;
}

export type CreateEventParams = {
  summary: string; // "TrueTest — Jane Smith"
  description?: string;
  start: Date;
  end: Date;
  /**
   * Donor email. NOT added as an event attendee — service accounts can't
   * invite attendees without Domain-Wide Delegation of Authority, which
   * is a much bigger privilege than we need. Instead the email is just
   * appended to the event description for staff reference. Client gets
   * the booking confirmation via SMS, not a calendar invite.
   */
  attendeeEmail?: string;
  location?: string;
};

/**
 * Create an event on the shared TrueTest calendar. Returns the Google
 * event ID on success (caller stores it on the Appointment row), or null
 * on failure (caller logs and continues — the Appointment row is still
 * valid in the case tracker, just not yet mirrored to Google).
 */
export async function createCalendarEvent(params: CreateEventParams): Promise<string | null> {
  const client = getClient();
  if (!client || !primaryCalendarId) return null;
  try {
    // Fold the donor email into the description instead of the attendees
    // list — service accounts aren't allowed to invite attendees.
    const fullDescription = [
      params.description,
      params.attendeeEmail ? `Email: ${params.attendeeEmail}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const res = await client.events.insert({
      calendarId: primaryCalendarId!,
      sendUpdates: "none", // internal-only; client gets the SMS instead
      requestBody: {
        summary: params.summary,
        description: fullDescription || undefined,
        location:
          params.location ?? "2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007",
        start: {
          dateTime: params.start.toISOString(),
          timeZone: "America/Chicago",
        },
        end: {
          dateTime: params.end.toISOString(),
          timeZone: "America/Chicago",
        },
      },
    });
    return res.data.id ?? null;
  } catch (e) {
    console.error("[gcal] event insert failed:", e);
    return null;
  }
}

/**
 * Delete an event by ID (used when cancelling an appointment). Soft-fails —
 * if Google doesn't know about the event or the request fails, we log and
 * move on.
 */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const client = getClient();
  if (!client || !primaryCalendarId) return;
  try {
    await client.events.delete({ calendarId: primaryCalendarId!, eventId, sendUpdates: "none" });
  } catch (e) {
    console.error("[gcal] event delete failed:", e);
  }
}

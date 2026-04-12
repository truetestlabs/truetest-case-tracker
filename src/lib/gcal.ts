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

const calendarId = process.env.GOOGLE_CALENDAR_ID;
const serviceAccountKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

let cachedClient: calendar_v3.Calendar | null = null;
let initAttempted = false;

function getClient(): calendar_v3.Calendar | null {
  if (cachedClient) return cachedClient;
  if (initAttempted) return null;
  initAttempted = true;
  if (!calendarId || !serviceAccountKeyRaw) {
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
    });
    cachedClient = google.calendar({ version: "v3", auth });
    return cachedClient;
  } catch (e) {
    console.error("[gcal] failed to init client:", e);
    return null;
  }
}

export type BusyInterval = { start: Date; end: Date };

/**
 * Query busy intervals on the shared calendar for a time range. Used by
 * the availability helper to hide slots that overlap anything already on
 * Google Calendar (including Square walk-ins synced in from outside).
 *
 * Uses the freebusy API — only returns start/end times, never event
 * titles or attendees. Fails open: returns [] on error so read failures
 * don't block booking.
 */
export async function getBusyIntervals(
  rangeStart: Date,
  rangeEnd: Date
): Promise<BusyInterval[]> {
  const client = getClient();
  if (!client || !calendarId) return [];
  try {
    const res = await client.freebusy.query({
      requestBody: {
        timeMin: rangeStart.toISOString(),
        timeMax: rangeEnd.toISOString(),
        items: [{ id: calendarId }],
      },
    });
    const busy = res.data.calendars?.[calendarId]?.busy ?? [];
    return busy.map((b) => ({
      start: new Date(b.start as string),
      end: new Date(b.end as string),
    }));
  } catch (e) {
    console.error("[gcal] freebusy query failed:", e);
    return [];
  }
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
  if (!client || !calendarId) return null;
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
      calendarId,
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
  if (!client || !calendarId) return;
  try {
    await client.events.delete({ calendarId, eventId, sendUpdates: "none" });
  } catch (e) {
    console.error("[gcal] event delete failed:", e);
  }
}

/**
 * Minimal TwiML builders. We stay away from the Twilio helper library
 * for the TwiML response side — the output is small, and inlining it
 * keeps the voice routes easy to read.
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Amazon Polly neural voice via Twilio <Say>. Joanna-Neural is a
// natural-sounding American English voice; swap later if we want to
// layer ElevenLabs in front.
const DEFAULT_VOICE = "Polly.Joanna-Neural";

export type GatherAction = {
  kind: "gather";
  /** Absolute or relative URL Twilio will POST the caller's speech to. */
  action: string;
};

export type HangupAction = { kind: "hangup" };

export function twimlSay(
  text: string,
  next: GatherAction | HangupAction,
  opts?: { voice?: string; language?: string }
): string {
  const voice = opts?.voice ?? DEFAULT_VOICE;
  const lang = opts?.language ?? "en-US";
  const say = `<Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(text)}</Say>`;

  if (next.kind === "hangup") {
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
  }

  // speechTimeout="auto" lets Twilio decide when the caller is done
  // speaking based on silence. speechModel=experimental_conversations
  // is Twilio's best model for back-and-forth phone dialog.
  const gather = `<Gather input="speech" action="${escapeXml(next.action)}" method="POST" speechTimeout="auto" language="${escapeXml(lang)}" enhanced="true" speechModel="experimental_conversations"/>`;
  // If the Gather times out with no input, fall through to a polite
  // wrap-up so we don't leave the caller hanging in silence.
  const fallback = `<Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">I didn't catch that. I'll have someone follow up shortly. Goodbye.</Say><Hangup/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}${gather}${fallback}</Response>`;
}

export function twimlHangup(text?: string, opts?: { voice?: string; language?: string }): string {
  const voice = opts?.voice ?? DEFAULT_VOICE;
  const lang = opts?.language ?? "en-US";
  const say = text
    ? `<Say voice="${escapeXml(voice)}" language="${escapeXml(lang)}">${escapeXml(text)}</Say>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup/></Response>`;
}

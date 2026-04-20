"use client";

import { useEffect, useState } from "react";

// Format the 4 AM CT unlock instant as a reader-friendly date string
// ("Monday, April 20"). Rendering in the Chicago timezone matters:
// the unlock gate is defined in CT, so the phone's local zone must
// not drift the shown date.
function formatUnlockDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/Chicago",
    });
  } catch {
    return "";
  }
}

// Convert base64url VAPID key into the Uint8Array PushManager expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      }));
    const raw = sub.toJSON();
    if (!raw.endpoint || !raw.keys) return;
    await fetch("/api/portal/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscription: { endpoint: raw.endpoint, keys: raw.keys },
        userAgent: navigator.userAgent,
      }),
    });
  } catch (err) {
    console.warn("[portal] push subscribe failed:", err);
  }
}

type OrderFields = {
  qPassportId: string | null;
  collectionSite: {
    name: string | null;
    address: string | null;
    phone: string | null;
    hours: string | null;
  };
  expiresOn: string | null;
  testType: string | null;
  collectionService: string | null;
  donorName: string | null;
  orderedDate: string | null;
};

type PortalOrderPdf = {
  fileName: string;
  unlocked: boolean;
  unlockAtISO: string;
  fields: OrderFields | null;
};

type PortalSelection = {
  id: string;
  status: string;
  acknowledgedAt: string | null;
  orderPdf: PortalOrderPdf | null;
};

type PortalSession = {
  donorName: string;
  testName: string;
  selected: boolean;
  selection: PortalSelection | null;
  serverDay: string;
  serverNowISO: string;
  upcomingSelections: Array<{ selectedDate: string; status: string }>;
};

// selectedDate is stored as UTC-midnight where the UTC Y/M/D already
// encode the intended Chicago calendar day. Read the UTC components
// directly — applying an America/Chicago tz conversion would subtract
// ~5h and shift every label to the prior day (e.g. Apr 20 → Apr 19).
function isoToChicagoDay(iso: string): string {
  return iso.slice(0, 10);
}

// Diagnostic clock shown above the portal card. Renders the donor's
// current America/Chicago time (ticking once a second) and, when
// authed, the server's view of "today" in the same zone. Disagreement
// between the two is the telltale sign the server's "today" query
// missed a current-day selection.
function PortalClock({ serverDay }: { serverDay: string | null }) {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Chicago",
  });
  // Chicago Y-M-D on the client to compare with serverDay.
  const clientDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const drift = serverDay && clientDay !== serverDay;
  return (
    <div className="text-center mb-3">
      <p className="text-xs font-mono text-slate-500">
        {dateStr} · {timeStr} CT
      </p>
      {serverDay && (
        <p className={`text-xs font-mono mt-0.5 ${drift ? "text-red-600" : "text-slate-400"}`}>
          Server day: {serverDay}
          {drift ? ` ≠ ${clientDay} (drift!)` : ""}
        </p>
      )}
    </div>
  );
}

type Stage = "loading" | "pin" | "otp" | "authed" | "recover";

export default function PortalPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [otpScheduleId, setOtpScheduleId] = useState<string | null>(null);
  const [emailMasked, setEmailMasked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ackState, setAckState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [recoverPhone, setRecoverPhone] = useState("");
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverChannel, setRecoverChannel] = useState<"sms" | "email">("sms");
  const [recoverSent, setRecoverSent] = useState(false);

  // Auto-logout after 60s of inactivity on the authed view. A donor who
  // leaves the phone sitting on the "selected today" screen shouldn't
  // expose their status indefinitely. Resets on any tap/scroll/keypress.
  useEffect(() => {
    if (stage !== "authed") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        logout(false);
      }, 60_000);
    };
    const events: Array<keyof WindowEventMap> = [
      "pointerdown",
      "touchstart",
      "keydown",
      "scroll",
    ];
    reset();
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // On mount: try the session cookie first; fall through to PIN if none.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portal/session", { credentials: "include" });
        if (cancelled) return;
        if (res.ok) {
          const data: PortalSession = await res.json();
          setSession(data);
          setAckState(data.selection?.acknowledgedAt ? "done" : "idle");
          setStage("authed");
          maybeRequestPush();
          return;
        }
      } catch {
        // Network error — fall through to PIN.
      }
      if (!cancelled) setStage("pin");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function maybeRequestPush() {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      subscribeToPush();
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") subscribeToPush();
      });
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) {
      setError("Please enter your full PIN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Belt-and-suspenders: read the device cookie via JS and pass it in
      // the body too. Some mobile browsers (in-app webviews for Gmail,
      // Outlook etc.) don't forward cookies on arrival navigations even
      // with SameSite=Lax, so the server-side cookie read can miss. The
      // login route accepts either source.
      const deviceId = (() => {
        if (typeof document === "undefined") return null;
        const m = document.cookie.match(/(?:^|; )ttl_portal_device=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
        try {
          return localStorage.getItem("ttl_portal_device") || null;
        } catch {
          return null;
        }
      })();
      const res = await fetch("/api/portal/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, deviceId }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
        return;
      }
      if (res.status === 423) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || "This PIN is temporarily locked.");
        return;
      }
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || "Missing donor phone on file.");
        return;
      }
      if (res.status === 404 || res.status === 400) {
        setError("Invalid PIN. Please check and try again.");
        return;
      }
      if (res.status === 202) {
        // OTP challenge — untrusted device.
        const j = await res.json();
        setOtpScheduleId(j.scheduleId);
        setEmailMasked(j.emailMasked || null);
        setStage("otp");
        setError("");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }
      const data: PortalSession = await res.json();
      setSession(data);
      setAckState(data.selection?.acknowledgedAt ? "done" : "idle");
      setStage("authed");
      maybeRequestPush();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otpScheduleId || !/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code we emailed you.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: otpScheduleId, code }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Wait a minute and try again.");
        return;
      }
      if (res.status === 423) {
        const j = await res.json().catch(() => ({}));
        setError(j?.error || "PIN is locked. Try again in an hour.");
        setStage("pin");
        setCode("");
        return;
      }
      if (res.status === 410) {
        setError("Code expired. Enter your PIN to get a new code.");
        setStage("pin");
        setCode("");
        return;
      }
      if (res.status === 401) {
        setError("That code didn't match. Try again.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }
      const data: PortalSession = await res.json();
      setSession(data);
      setAckState(data.selection?.acknowledgedAt ? "done" : "idle");
      setStage("authed");
      setCode("");
      // Mirror the device cookie into localStorage so it survives
      // cookie purges (iOS Safari ITP, in-app webviews, private mode).
      try {
        const m = document.cookie.match(/(?:^|; )ttl_portal_device=([^;]+)/);
        if (m) localStorage.setItem("ttl_portal_device", decodeURIComponent(m[1]));
      } catch {
        // localStorage disabled (private mode on older Safari) — fine, cookie-only.
      }
      maybeRequestPush();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function acknowledge() {
    if (!session?.selection) return;
    setAckState("saving");
    try {
      const res = await fetch(`/api/monitoring/selections/${session.selection.id}/acknowledge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setAckState("error");
        return;
      }
      setAckState("done");
    } catch {
      setAckState("error");
    }
  }

  async function submitRecover(e: React.FormEvent) {
    e.preventDefault();
    let url: string;
    let payload: Record<string, string>;
    if (recoverChannel === "sms") {
      const digits = recoverPhone.replace(/\D/g, "");
      if (digits.length < 10) {
        setError("Enter the phone number on file (at least 10 digits).");
        return;
      }
      url = "/api/portal/recover-pin";
      payload = { phone: recoverPhone };
    } else {
      const email = recoverEmail.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError("Enter the email address on file.");
        return;
      }
      url = "/api/portal/recover-pin-email";
      payload = { email };
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        setError("Too many requests. Wait 30 minutes and try again.");
        return;
      }
      // Always success-shaped response (intentional anti-enumeration).
      setRecoverSent(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadOrderPdf() {
    try {
      const res = await fetch("/api/portal/selection/pdf", { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j?.error || "Could not open your order PDF. Please try again.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      alert("Network error. Please try again.");
    }
  }

  async function logout(revokeDevice: boolean) {
    try {
      await fetch("/api/portal/logout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeDevice }),
      });
    } catch {
      // Best-effort; UI resets regardless.
    }
    setSession(null);
    setPin("");
    setCode("");
    setOtpScheduleId(null);
    setEmailMasked(null);
    setError("");
    setAckState("idle");
    setStage("pin");
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start pt-8 sm:pt-16 px-4 pb-12"
      style={{ backgroundColor: "#f8fafc" }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">TrueTest Labs</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">Donor Portal</h1>
        </div>

        <PortalClock serverDay={session?.serverDay ?? null} />


        {stage === "loading" ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 text-center text-sm text-slate-500">
            Checking your session…
          </div>
        ) : stage === "pin" ? (
          <form onSubmit={submitPin} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <label htmlFor="pin" className="block text-sm font-medium text-slate-700 mb-2">
              Enter Your PIN
            </label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 text-2xl text-center font-mono tracking-widest border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="00000000"
              aria-describedby={error ? "pin-error" : undefined}
              aria-invalid={!!error}
            />
            {error && <p id="pin-error" role="alert" className="text-red-600 text-sm mt-2">{error}</p>}
            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="w-full mt-4 px-4 py-3 bg-blue-600 text-white rounded-lg text-base font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              {loading ? "Checking..." : "Sign In"}
            </button>
            <p className="text-xs text-slate-500 text-center mt-4">
              First sign-in on this device? We&apos;ll text a 6-digit code to confirm it&apos;s you,
              and remember you next time.
            </p>
            <div className="mt-3 text-center text-xs text-slate-500">
              Forgot your PIN?{" "}
              <button
                type="button"
                onClick={() => {
                  setRecoverChannel("sms");
                  setStage("recover");
                  setError("");
                  setRecoverSent(false);
                }}
                className="text-blue-700 hover:text-blue-900 underline"
              >
                Text it to me
              </button>
              {" · "}
              <button
                type="button"
                onClick={() => {
                  setRecoverChannel("email");
                  setStage("recover");
                  setError("");
                  setRecoverSent(false);
                }}
                className="text-blue-700 hover:text-blue-900 underline"
              >
                Email it to me
              </button>
            </div>
          </form>
        ) : stage === "recover" ? (
          <form onSubmit={submitRecover} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <label
              htmlFor={recoverChannel === "sms" ? "recover-phone" : "recover-email"}
              className="block text-sm font-medium text-slate-700 mb-1"
            >
              {recoverChannel === "sms" ? "Phone number on file" : "Email on file"}
            </label>
            <p className="text-xs text-slate-500 mb-2">
              {recoverChannel === "sms"
                ? "Enter the phone number TrueTest Labs has for you. If it matches an active schedule, we'll text your PIN."
                : "Enter the email address TrueTest Labs has for you. If it matches an active schedule, we'll email your instructions and PIN."}
            </p>
            {recoverSent ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-2">
                <p className="text-sm text-green-900 font-semibold">
                  {recoverChannel === "sms" ? "✓ Check your texts." : "✓ Check your email."}
                </p>
                <p className="text-xs text-green-800 mt-1">
                  {recoverChannel === "sms"
                    ? "If this phone is on file, your PIN is on its way. It can take up to a minute."
                    : "If this email is on file, your schedule instructions have been sent. Check your spam folder if you don't see it."}
                  {" "}Still don&apos;t see it? Call the lab at (847) 258-3966.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStage("pin");
                    setRecoverSent(false);
                    setRecoverPhone("");
                    setRecoverEmail("");
                    setError("");
                  }}
                  className="w-full mt-4 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                {recoverChannel === "sms" ? (
                  <input
                    id="recover-phone"
                    type="tel"
                    inputMode="tel"
                    autoFocus
                    value={recoverPhone}
                    onChange={(e) => setRecoverPhone(e.target.value)}
                    className="w-full px-4 py-3 text-lg border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="(555) 123-4567"
                    aria-invalid={!!error}
                  />
                ) : (
                  <input
                    id="recover-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoFocus
                    value={recoverEmail}
                    onChange={(e) => setRecoverEmail(e.target.value)}
                    className="w-full px-4 py-3 text-lg border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="you@example.com"
                    aria-invalid={!!error}
                  />
                )}
                {error && <p role="alert" className="text-red-600 text-sm mt-2">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 px-4 py-3 bg-blue-600 text-white rounded-lg text-base font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading
                    ? "Sending..."
                    : recoverChannel === "sms"
                    ? "Text me my PIN"
                    : "Email me my instructions"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRecoverChannel(recoverChannel === "sms" ? "email" : "sms");
                    setError("");
                  }}
                  className="w-full mt-3 text-xs text-blue-700 hover:text-blue-900 underline"
                >
                  {recoverChannel === "sms" ? "Use email instead" : "Use text message instead"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage("pin");
                    setError("");
                  }}
                  className="w-full mt-2 px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
                >
                  Back to sign in
                </button>
              </>
            )}
          </form>
        ) : stage === "otp" ? (
          <form onSubmit={submitOtp} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
              <p className="text-sm font-semibold text-blue-900">
                We just emailed you a one-time 6-digit code
              </p>
              <p className="text-xs text-blue-800 mt-1">
                {emailMasked
                  ? `Sent to ${emailMasked}. Enter it below to finish signing in — this only happens the first time on a new device.`
                  : "Check your email and enter the code below to finish signing in. This only happens the first time on a new device."}
              </p>
            </div>
            <label htmlFor="code" className="block text-sm font-medium text-slate-700 mb-1">
              Enter the 6-digit code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 text-2xl text-center font-mono tracking-widest border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="000000"
              aria-describedby={error ? "code-error" : undefined}
              aria-invalid={!!error}
            />
            {error && <p id="code-error" role="alert" className="text-red-600 text-sm mt-2">{error}</p>}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full mt-4 px-4 py-3 bg-blue-600 text-white rounded-lg text-base font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              {loading ? "Checking..." : "Verify"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStage("pin");
                setCode("");
                setError("");
              }}
              className="w-full mt-2 px-4 py-2 text-sm text-slate-600 hover:text-slate-800"
            >
              Use a different PIN
            </button>
            <p className="text-xs text-slate-500 text-center mt-4">
              Code expires in 5 minutes. Didn&apos;t get it? Re-enter your PIN to send a new code.
            </p>
          </form>
        ) : session?.selected && session.selection ? (
          <div className="bg-white rounded-xl border-2 border-red-400 shadow-lg overflow-hidden">
            <div className="bg-red-600 text-white px-6 py-4 text-center">
              <p className="text-sm font-semibold uppercase tracking-wider opacity-90">Selected Today</p>
              <h2 className="text-3xl font-bold mt-1">Report Today</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-slate-500 text-sm">Donor</p>
                <p className="text-xl font-bold text-slate-900">{session.donorName}</p>
              </div>
              <div>
                <p className="text-slate-500 text-sm">Test</p>
                <p className="text-base font-semibold text-slate-800">{session.testName}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-900 font-semibold text-sm">
                  Report to TrueTest Labs today by 5:00 PM
                </p>
                <p className="text-red-800 text-sm mt-1">
                  2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007
                </p>
                <p className="text-red-800 text-sm mt-1">Phone: (847) 258-3966</p>
              </div>

              {session.selection.orderPdf ? (
                !session.selection.orderPdf.unlocked ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <p className="text-sm font-semibold text-slate-800">
                      📄 Your order details unlock at 4:00 AM CT
                    </p>
                    <p className="text-sm text-slate-600 mt-1">
                      {formatUnlockDate(session.selection.orderPdf.unlockAtISO)}
                    </p>
                    <p className="text-xs text-slate-500 mt-2">
                      Come back after that time to see your collection site and download your order.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {session.selection.orderPdf.fields?.qPassportId && (
                      <div className="border-2 border-slate-300 rounded-lg p-3 text-center">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Order Number
                        </p>
                        <p className="text-2xl font-mono font-bold text-slate-900 mt-1 tracking-wider">
                          {session.selection.orderPdf.fields.qPassportId}
                        </p>
                      </div>
                    )}
                    {session.selection.orderPdf.fields?.collectionSite.name && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                          Collection Site
                        </p>
                        <p className="text-base font-bold text-slate-900">
                          {session.selection.orderPdf.fields.collectionSite.name}
                        </p>
                        {session.selection.orderPdf.fields.collectionSite.address && (
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(
                              session.selection.orderPdf.fields.collectionSite.address
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-sm text-blue-700 hover:text-blue-900 underline mt-1"
                          >
                            {session.selection.orderPdf.fields.collectionSite.address}
                          </a>
                        )}
                        {session.selection.orderPdf.fields.collectionSite.phone && (
                          <a
                            href={`tel:${session.selection.orderPdf.fields.collectionSite.phone.replace(/\D/g, "")}`}
                            className="block text-sm text-blue-700 hover:text-blue-900 mt-0.5"
                          >
                            {session.selection.orderPdf.fields.collectionSite.phone}
                          </a>
                        )}
                        {session.selection.orderPdf.fields.collectionSite.hours && (
                          <p className="text-xs text-slate-600 mt-1">
                            {session.selection.orderPdf.fields.collectionSite.hours}
                          </p>
                        )}
                      </div>
                    )}
                    {session.selection.orderPdf.fields?.expiresOn && (
                      <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        Expires: {session.selection.orderPdf.fields.expiresOn}
                      </p>
                    )}
                    {session.selection.orderPdf.fields?.testType && (
                      <p className="text-xs text-slate-600">
                        Test: {session.selection.orderPdf.fields.testType}
                      </p>
                    )}
                    <button
                      onClick={downloadOrderPdf}
                      className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
                    >
                      📄 Download Order PDF
                    </button>
                    {!session.selection.orderPdf.fields && (
                      <p className="text-xs text-slate-500 text-center">
                        Tap Download to view your order details.
                      </p>
                    )}
                  </div>
                )
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
                  <p className="text-sm text-slate-600">
                    Your order PDF isn&apos;t available yet. Check back shortly —
                    staff will upload it before your collection window.
                  </p>
                </div>
              )}

              {ackState === "done" ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-sm font-semibold text-green-800">
                    ✓ Acknowledged — we&apos;ll stop sending reminders today.
                  </p>
                </div>
              ) : (
                <button
                  onClick={acknowledge}
                  disabled={ackState === "saving"}
                  className="w-full px-4 py-3 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                  {ackState === "saving" ? "Saving..." : "I see this — acknowledge"}
                </button>
              )}
              {ackState === "error" && (
                <p className="text-red-600 text-xs text-center">
                  Could not save your acknowledgment. Please try again.
                </p>
              )}

              <div className="pt-2 border-t border-slate-200 flex gap-2">
                <button
                  onClick={() => logout(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Sign out
                </button>
                <button
                  onClick={() => logout(true)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-xs hover:bg-slate-50"
                  title="Forget this device — next sign-in will require a new email code"
                >
                  Not my device
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border-2 border-green-400 shadow-lg overflow-hidden">
            <div className="bg-green-600 text-white px-6 py-4 text-center">
              <p className="text-sm font-semibold uppercase tracking-wider opacity-90">Not Selected Today</p>
              <h2 className="text-3xl font-bold mt-1">No Test Today</h2>
            </div>
            <div className="p-6">
              <p className="text-slate-500 text-sm">Donor</p>
              <p className="text-xl font-bold text-slate-900 mb-4">{session?.donorName}</p>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-green-900 text-sm">
                  You are not required to test today. Check back tomorrow.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => logout(false)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
                >
                  Sign out
                </button>
                <button
                  onClick={() => logout(true)}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-xs hover:bg-slate-50"
                  title="Forget this device"
                >
                  Not my device
                </button>
              </div>
            </div>
          </div>
        )}

        {stage === "authed" && session && session.upcomingSelections && (
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Diagnostic · your upcoming dates
            </p>
            <p className="text-[11px] font-mono text-slate-500 mb-2">
              Server today: {session.serverDay} · now:{" "}
              {session.serverNowISO}
            </p>
            {session.upcomingSelections.length === 0 ? (
              <p className="text-xs text-slate-600">
                No upcoming selections on file for this schedule. Staff may need to
                regenerate it.
              </p>
            ) : (
              <ul className="text-[11px] font-mono text-slate-700 space-y-1 break-all">
                {session.upcomingSelections.map((u, i) => {
                  const day = isoToChicagoDay(u.selectedDate);
                  const isToday = day === session.serverDay;
                  return (
                    <li key={i} className={isToday ? "font-bold text-red-700" : ""}>
                      CT:{day} · raw:{u.selectedDate} · {u.status}
                      {isToday ? " ← today" : ""}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

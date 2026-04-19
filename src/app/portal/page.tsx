"use client";

import { useState } from "react";

// Convert base64url VAPID key into the Uint8Array PushManager expects.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function subscribeToPush(pin: string) {
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
        // Cast to BufferSource — TS's DOM lib types bicker about ArrayBufferLike
        // vs ArrayBuffer for PushSubscribeOptions.applicationServerKey.
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      }));
    const raw = sub.toJSON();
    if (!raw.endpoint || !raw.keys) return;
    await fetch("/api/portal/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pin,
        subscription: { endpoint: raw.endpoint, keys: raw.keys },
        userAgent: navigator.userAgent,
      }),
    });
  } catch (err) {
    console.warn("[portal] push subscribe failed:", err);
  }
}

type PortalSelection = {
  id: string;
  status: string;
  acknowledgedAt: string | null;
  orderPdf: { fileName: string; url: string } | null;
};

type PortalSession = {
  donorName: string;
  testName: string;
  selected: boolean;
  selection: PortalSelection | null;
};

export default function PortalPage() {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState<PortalSession | null>(null);
  const [ackState, setAckState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) {
      setError("Please enter your full PIN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
        return;
      }
      if (res.status === 404 || res.status === 400) {
        setError("Invalid PIN. Please check and try again.");
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        return;
      }
      const data: PortalSession = await res.json();
      setSession(data);
      setAckState(data.selection?.acknowledgedAt ? "done" : "idle");

      // Best-effort: ask for notification permission and register the push
      // subscription so future selection-day notifications can reach them
      // even when the portal isn't open. Silent if unsupported or denied.
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") subscribeToPush(pin);
        });
      } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        subscribeToPush(pin);
      }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
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

  function reset() {
    setSession(null);
    setPin("");
    setError("");
    setAckState("idle");
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-start pt-8 sm:pt-16 px-4 pb-12"
      style={{ backgroundColor: "#f8fafc" }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">TrueTest Labs</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">Donor Portal</h1>
        </div>

        {!session ? (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <label htmlFor="pin" className="block text-sm font-medium text-slate-700 mb-2">
              Enter Your PIN
            </label>
            <input
              id="pin"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="w-full px-4 py-4 text-2xl text-center font-mono tracking-widest border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="000000"
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
              Sign in any time. We&apos;ll show you today&apos;s status and, if you&apos;re selected,
              the order details you need at the collection site.
            </p>
          </form>
        ) : session.selected && session.selection ? (
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
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 flex items-center justify-between gap-2 border-b border-slate-200">
                    <p className="text-xs font-semibold text-slate-700 truncate">
                      Order: {session.selection.orderPdf.fileName}
                    </p>
                    <a
                      href={session.selection.orderPdf.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="text-xs px-2 py-1 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 flex-shrink-0"
                    >
                      Download
                    </a>
                  </div>
                  <iframe
                    src={session.selection.orderPdf.url}
                    title="Today's collection order"
                    className="w-full h-[420px] bg-white"
                  />
                  <p className="bg-amber-50 text-amber-900 text-xs px-4 py-2 border-t border-amber-200">
                    Show the barcode on this order at the collection site.
                  </p>
                </div>
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

              <button
                onClick={reset}
                className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Done
              </button>
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
              <p className="text-xl font-bold text-slate-900 mb-4">{session.donorName}</p>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-green-900 text-sm">
                  You are not required to test today. Check back tomorrow.
                </p>
              </div>
              <button
                onClick={reset}
                className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

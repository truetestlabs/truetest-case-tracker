"use client";

import { useState } from "react";

type CheckinResult = {
  selected: boolean;
  donorName: string;
  testDescription?: string;
  message: string;
};

export default function CheckInPage() {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 4) {
      setError("Please enter your full PIN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (res.status === 404) {
        setError("Invalid PIN. Please check and try again.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setPin("");
    setError("");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-8 sm:pt-16 px-4" style={{ backgroundColor: "#f8fafc" }}>
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">TrueTest Labs</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-1">Random Testing Check-In</h1>
        </div>

        {!result ? (
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
            />
            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
            <button
              type="submit"
              disabled={loading || pin.length < 4}
              className="w-full mt-4 px-4 py-3 bg-blue-600 text-white rounded-lg text-base font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              {loading ? "Checking..." : "Check In"}
            </button>
            <p className="text-xs text-slate-500 text-center mt-4">
              Call in every weekday (Mon–Fri) to see if you are selected for testing today.
            </p>
          </form>
        ) : result.selected ? (
          <div className="bg-white rounded-xl border-2 border-red-400 shadow-lg overflow-hidden">
            <div className="bg-red-600 text-white px-6 py-4 text-center">
              <p className="text-sm font-semibold uppercase tracking-wider opacity-90">Selected Today</p>
              <h2 className="text-3xl font-bold mt-1">Report Today</h2>
            </div>
            <div className="p-6">
              <p className="text-slate-500 text-sm">Donor</p>
              <p className="text-xl font-bold text-slate-900 mb-4">{result.donorName}</p>
              {result.testDescription && (
                <>
                  <p className="text-slate-500 text-sm">Test</p>
                  <p className="text-base font-semibold text-slate-800 mb-4">{result.testDescription}</p>
                </>
              )}
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-900 font-semibold text-sm">Report to TrueTest Labs today by 5:00 PM</p>
                <p className="text-red-800 text-sm mt-1">2256 Landmeier Rd Ste A, Elk Grove Village, IL 60007</p>
                <p className="text-red-800 text-sm mt-1">Phone: (847) 258-3966</p>
              </div>
              <button onClick={reset} className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
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
              <p className="text-xl font-bold text-slate-900 mb-4">{result.donorName}</p>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                <p className="text-green-900 text-sm">You are not required to test today. Check back tomorrow.</p>
              </div>
              <button onClick={reset} className="w-full px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

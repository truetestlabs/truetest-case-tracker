"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = createSupabaseBrowser();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message === "Invalid login credentials"
          ? "Invalid email or password"
          : authError.message);
        setLoading(false);
        return;
      }

      // Redirect to the page they tried to access, or /cases
      const redirect = searchParams.get("redirect") || "/cases";
      router.push(redirect);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
      <div className="w-full max-w-sm">
        {/* Logo + heading */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#1e3a5f] mb-4">
            <span className="text-2xl text-white font-bold">TT</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">TrueTest Labs</h1>
          <p className="text-sm text-gray-500">Case Tracker</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              placeholder="you@truetestlabs.com"
              autoComplete="email"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-base p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-[#1e3a5f]"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#1e3a5f] text-white rounded-xl text-base font-semibold hover:bg-[#162c47] disabled:opacity-50 transition-all"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-4">
          Contact admin for account access
        </p>
      </div>
    </div>
  );
}

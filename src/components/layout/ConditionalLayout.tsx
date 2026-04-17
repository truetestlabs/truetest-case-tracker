"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sidebar } from "./Sidebar";

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = pathname === "/login" || pathname === "/intake" || pathname === "/checkin" || pathname?.startsWith("/kiosk") || pathname?.startsWith("/reports/") === true;

  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — always visible on md+, slide-in drawer on mobile */}
      {/* NOTE: no transform on md+ to avoid creating a stacking context that
          traps fixed-position children (the draft review modal) inside the
          sidebar width. On mobile we use translate for the slide-in effect,
          but md:transform-none resets it so fixed children escape correctly. */}
      <div
        className={`fixed md:static z-40 h-full flex-shrink-0 transition-transform duration-200 md:transform-none ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-20">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <img src="/logo.png" alt="TrueTest Labs" className="h-7 w-auto" />
        </div>

        <div className="px-4 py-4 md:px-7 md:py-6">{children}</div>
      </main>
    </div>
  );
}

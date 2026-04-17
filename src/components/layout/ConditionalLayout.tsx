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
      {/* Sidebar — always in flex flow on desktop, hidden behind hamburger on mobile */}
      <div className="hidden md:block flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile overlay + drawer */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-30 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-40 md:hidden">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </div>
        </>
      )}

      <main className="flex-1 overflow-auto min-w-0">
        {/* Mobile top bar — hamburger + logo */}
        <div className="flex md:hidden items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white sticky top-0 z-20">
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

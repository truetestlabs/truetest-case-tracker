"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone = pathname === "/intake" || pathname === "/checkin" || pathname?.startsWith("/kiosk") || pathname?.startsWith("/reports/") === true;

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="px-7 py-6">{children}</div>
      </main>
    </div>
  );
}

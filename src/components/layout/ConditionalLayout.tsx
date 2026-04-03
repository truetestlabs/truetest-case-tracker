"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isIntake = pathname === "/intake";

  if (isIntake) {
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

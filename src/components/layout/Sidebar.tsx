"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navigation = [
  { name: "Quick Intake", href: "/intake", icon: ZapIcon },
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboardIcon },
  { name: "Cases", href: "/cases", icon: BriefcaseIcon },
  { name: "Monitored", href: "/cases/monitored", icon: MonitorIcon },
  { name: "Closed Cases", href: "/cases/closed", icon: ArchiveIcon },
  { name: "Upload Order", href: "/cases/upload-order", icon: UploadIcon },
  { name: "Contacts", href: "/contacts", icon: UsersIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 flex flex-col flex-shrink-0" style={{ background: "linear-gradient(180deg, #1a3352 0%, #162c47 100%)" }}>
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.15)" }}>
          <FlaskIcon className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-white leading-tight tracking-tight">TrueTest Labs</h1>
          <p className="text-xs text-white/50 leading-tight">Case Tracker</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navigation.map((item, index) => {
          const isActive =
            item.href === "/cases"
              ? pathname === "/cases" || (pathname?.startsWith("/cases/") && !pathname?.startsWith("/cases/closed") && !pathname?.startsWith("/cases/monitored") && !pathname?.startsWith("/cases/upload"))
              : pathname === item.href || pathname?.startsWith(item.href + "/");
          const isQuickIntake = item.href === "/intake";
          return (
            <span key={item.name}>
              {index === 1 && <div className="my-2 mx-1 border-t border-white/10" />}
              <Link
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? isQuickIntake
                      ? "text-white shadow-sm"
                      : "bg-white/15 text-white shadow-sm"
                    : isQuickIntake
                    ? "text-[#d4a843] hover:bg-white/8 hover:text-[#f0c060]"
                    : "text-white/60 hover:bg-white/8 hover:text-white/90"
                }`}
                style={
                  isActive
                    ? isQuickIntake
                      ? { background: "rgba(212,168,67,0.2)", boxShadow: "inset 3px 0 0 #d4a843" }
                      : { boxShadow: "inset 3px 0 0 rgba(255,255,255,0.6)" }
                    : {}
                }
              >
                <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? (isQuickIntake ? "text-[#d4a843]" : "text-white") : isQuickIntake ? "text-[#d4a843]" : "text-white/50"}`} />
                {item.name}
              </Link>
            </span>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" style={{ boxShadow: "0 0 6px rgba(74,222,128,0.6)" }} />
          <span className="text-xs text-white/40">Elk Grove Village, IL</span>
        </div>
      </div>
    </aside>
  );
}

function ZapIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" />
    </svg>
  );
}

function FlaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M9 3v8l-4 9h14l-4-9V3" />
      <path d="M7 16h10" />
    </svg>
  );
}

function LayoutDashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}

function BriefcaseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21,8 21,21 3,21 3,8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17,8 12,3 7,8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function MonitorIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12,6 12,12 16,14" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

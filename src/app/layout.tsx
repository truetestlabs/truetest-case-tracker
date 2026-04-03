import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";

export const metadata: Metadata = {
  title: "TrueTest Labs - Case Tracker",
  description: "Family Law Drug & Alcohol Testing Case Management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen" style={{ backgroundColor: "#f8fafc" }} suppressHydrationWarning>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-auto">
            <div className="px-7 py-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "TrueTest Labs - Check In",
  description: "Client intake form for TrueTest Labs",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TrueTest Labs",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <link rel="manifest" href="/manifest.json" />
      <link rel="apple-touch-icon" href="/logo.png" />
      {children}
    </div>
  );
}

import type { Metadata, Viewport } from "next";
import { PortalServiceWorker } from "./PortalServiceWorker";

/**
 * Portal has its own metadata so the PWA installs as "TrueTest Donor
 * Portal" regardless of what the root layout declares, and so iOS and
 * Android both get the manifest + theme color on this entry point.
 */
export const metadata: Metadata = {
  title: "TrueTest Donor Portal",
  description: "Random drug testing check-in for TrueTest Labs donors.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "TrueTest",
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PortalServiceWorker />
      {children}
    </>
  );
}

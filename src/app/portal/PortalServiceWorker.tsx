"use client";

import { useEffect } from "react";

/**
 * Registers the portal's service worker. Split into its own client
 * component so PortalLayout can stay a server component (metadata +
 * viewport exports need that).
 */
export function PortalServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Register at root scope so the SW can intercept /portal navigations.
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[portal] SW registration failed:", err);
    });
  }, []);

  return null;
}

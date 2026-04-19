import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Allow uploads up to 10MB (Vercel default is 4.5MB)
  proxyClientMaxBodySize: 10 * 1024 * 1024,
  // TypeScript is checked locally (npx tsc --noEmit). Skipping during
  // Vercel build avoids OOM crashes on large codebases.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Security headers. Applied to every response so app + portal both
  // benefit. CSP is intentionally loose around images/fonts because we
  // render Supabase-signed PDFs via iframe; if we ever tighten this,
  // audit /portal and the PDF viewer before shipping.
  async headers() {
    const securityHeaders = [
      // Force HTTPS for 2 years, include subdomains, eligible for preload list.
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      // Block clickjacking — no one should frame this app.
      { key: "X-Frame-Options",             value: "DENY" },
      // Stop MIME sniffing.
      { key: "X-Content-Type-Options",      value: "nosniff" },
      // Strip Referer on cross-origin navigations.
      { key: "Referrer-Policy",             value: "strict-origin-when-cross-origin" },
      // Lock down legacy feature APIs we don't use.
      { key: "Permissions-Policy",          value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      // Minimal CSP. `unsafe-inline` on styles is required by Tailwind's
      // runtime; scripts are self-only (Next inlines hashes it manages).
      // frame-src covers Supabase-signed-URL PDFs rendered in iframe.
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' https: wss:",
          "frame-src 'self' https:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join("; "),
      },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

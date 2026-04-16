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
};

export default nextConfig;

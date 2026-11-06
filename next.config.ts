import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["postgres"],
  // Earlier addresses of the plan pages keep working.
  async redirects() {
    return [
      { source: "/base", destination: "/portfolio", permanent: true },
      { source: "/base/new", destination: "/protect", permanent: true },
      { source: "/base/vaults/:address", destination: "/plans/:address", permanent: true },
      { source: "/plans", destination: "/portfolio", permanent: true },
      { source: "/plans/new", destination: "/protect", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Scripts only from this site (Next.js needs its inline bootstrap). Wallet extensions'
          // own scripts aren't bound by a page's policy, so they keep working.
          {
            key: "Content-Security-Policy",
            value: `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
      // A signed-in account's data: never kept by a browser or a CDN.
      { source: "/api/base/:path((?!markets|prices).*)", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
      { source: "/api/agent/vaults/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;

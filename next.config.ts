import type { NextConfig } from "next";

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
          // No strict script-src: browser wallet extensions inject scripts into the page. Everything
          // that can be locked down without breaking them is.
          {
            key: "Content-Security-Policy",
            value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { MetadataRoute } from "next";

/** Public pages may be indexed; signed-in areas, shared plans and the API may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/plans/", "/portfolio", "/protect", "/withdraw", "/account", "/base/vaults/", "/base/new"] },
  };
}

import type { MetadataRoute } from "next";
import { LEGAL_DOCS } from "@/lib/legal";
import { siteUrl } from "@/lib/ui/site";

/** The public pages, for search engines. Signed-in areas and proof pages (one per attestation) aren't listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const pages = ["/", "/how-it-works", "/metrics", "/agents", "/integrate", ...LEGAL_DOCS.map((d) => d.href)];
  return pages.map((path) => ({
    url: new URL(path, base).toString(),
    changeFrequency: path.startsWith("/legal") ? "monthly" : "weekly",
    priority: path === "/" ? 1 : 0.6
  }));
}

// The site's public address, for absolute links (social images, the sitemap) and the legal pages.
// NEXT_PUBLIC_SITE_URL is what the operator configured; Netlify's URL is the site's main address.

/** The configured public address, or null when none is set (local development). */
export function configuredSiteUrl(): URL | null {
  for (const v of [process.env.NEXT_PUBLIC_SITE_URL, process.env.URL]) {
    try {
      if (v) return new URL(v);
    } catch {
      /* not a URL: try the next */
    }
  }
  return null;
}

export function siteUrl(): URL {
  return configuredSiteUrl() ?? new URL("http://localhost:3000");
}

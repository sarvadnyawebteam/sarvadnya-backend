import type { MetadataRoute } from 'next';

// CHANGE: 2026-10-06 — SP-4: this deployment (the admin panel) must NEVER be indexed.
// Was: allow '/' with disallow lists and a sitemap pointing at the FRONTEND's URL
// (sarvadnya-infotech.vercel.app) — the wrong deployment's sitemap advertised here.
// Owner rule: no SEO, no indexing, never linked from the public site. Layer 1 of 3
// (layer 2 = middleware X-Robots-Tag, layer 3 = root layout metadata).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
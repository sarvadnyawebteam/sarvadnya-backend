import type { MetadataRoute } from 'next';

// CHANGE: 2026-10-06 — SP-4: noindex layer — this deployment ships NO sitemap at all.
// Was a full copy of the public site's route list with a placeholder baseUrl that
// pointed at the frontend deployment. Owner rule: no SEO/indexing for the admin panel.
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
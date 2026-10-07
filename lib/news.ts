export type NewsItem = {
  id?: string;
  _id?: string;
  title: string;
  date: string;
  category: string;
  description: string;
  content: string;
  link: string;
  // CHANGE: 2026-10-07 — hand-ported from the frontend repo (P1 SEO sprint, §10.4). Optional
  // FAQ block for news posts; the FRONTEND article page renders it as a visible FAQ section
  // plus FAQPage JSON-LD. Nested repo doesn't port the JSON-LD page work (no lib/seo.ts here;
  // its (site) pages are unused) — the field is additive and harmless for the admin side.
  faqs?: { q: string; a: string }[];
};

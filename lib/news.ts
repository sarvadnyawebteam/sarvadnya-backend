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
  // CHANGE: 2026-10-08 — blog/SEO fields hand-ported with lib/news-utils.ts (§10.4). They
  // are OPTIONAL (legacy admin writes don't set them), but enrichNews()'s return type is
  // NewsItem and it derives `slug` etc., so the type must carry them or getNewsBySlug
  // fails typecheck (TS2339 on `.slug`). Explicit values win over auto-derived ones.
  slug?: string;           // URL slug; explicit > auto-derived (title-slug + id tail)
  seoTitle?: string;       // Overrides the <title>/H1 keyword treatment when set
  seoDescription?: string; // Overrides the meta description when set
  excerpt?: string;        // Short teaser (derived from description/content when absent)
  readingTime?: number;    // Read minutes (derived when absent)
  tags?: string[];         // Derived from title words + category when absent
  author?: string;         // Defaults to the company name when absent
  coverImage?: string;
};

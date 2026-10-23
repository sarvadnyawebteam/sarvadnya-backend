// CHANGE: 2026-10-22 — TypeScript declarations for lib/sara-catalog.mjs.
// WHY: TS cannot infer types for a .mjs import; this companion file (the same pattern as
// lib/prices-catalog.d.mts, lib/email-autoreply.d.mts, lib/careers-referral.d.mts) types the
// pure-ESM catalogue for Next.js while the Node test suites import the .mjs directly.

export type CatalogCategory = 'product' | 'cloud' | 'service' | 'module' | 'learning';

export interface CatalogItem {
  id: string;
  label: string;
  category: CatalogCategory;
  /** One line saying what it does and who it is for. */
  detail: string;
  /** Internal path (no origin). */
  url: string;
  /** Matching terms used by suggestCatalog(). */
  keywords: string[];
}

export interface CatalogAddon extends CatalogItem {
  category: 'addon';
}

export interface CatalogLesson extends CatalogItem {
  /** Section id inside the knowledge hub. */
  section: string;
}

export interface CatalogSuggestions {
  products: CatalogItem[];
  addons: CatalogAddon[];
  guides: CatalogLesson[];
  modules: CatalogItem[];
  learning: CatalogItem[];
}

export const PRODUCTS: CatalogItem[];
export const ADDONS_CATALOGUE: CatalogItem;
// CHANGE: 2026-10-22 (ADMIN FORK) — the Tally Insights knowledge hub does NOT exist in this
// deployment yet (it is newer than the fork), so INSIGHTS_HUB / LEARNING_SECTIONS /
// LEARNING_LESSONS are deliberately NOT declared here. Port the hub first, then port the
// lesson list from the public repo (root AGENTS.md 10, rule 4: shared code is ported BY HAND).

/** The SALES catalogue block, generated from the data above. */
export function buildCatalogPromptBlock(): string;
/** The LEARN catalogue block (the free Tally Insights guides). */
export function buildGuidesPromptBlock(): string;
/** Deterministic catalogue matching (a business problem -> the item that solves it). */
export function suggestCatalog(
  query: string,
  options?: { limit?: number; minScore?: number },
): CatalogSuggestions;
/** A short "we have exactly this" reply, or null when nothing matches confidently. */
export function catalogSuggestionReply(query: string): string | null;
/** A short "we wrote a guide for that" reply (Learn Sara), or null when nothing matches. */
export function guideSuggestionReply(query: string): string | null;

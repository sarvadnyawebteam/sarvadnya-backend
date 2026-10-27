// CHANGE: 2026-10-17 — Single source of truth for the "unique visitor" definition used by
// the admin panel (the Visitors screen and the dashboard's Site Visitors KPI).
//
// WHY THIS EXISTS: a `visitors` document is ONE SESSION. The public site's tracker keeps a
// `svd_vid` cookie for a year, so a returning browser updates its own document and the visit
// count grows — but anything that does not keep the cookie (headless crawlers above all)
// mints a fresh session id every run and therefore becomes a NEW document each time. Live
// data had `13.57.148.235` split across 50 documents and `54.183.149.156` across 46, all the
// same HeadlessChrome UA with visitCount 1 (owner: "same visitor marked as multiple visits as
// separate entry").
//
// THE FIX (read-side only — no data migration, raw session documents are untouched): sessions
// are grouped by an IP + device signature key. This module owns that key so the API route and
// any other consumer can never define "unique visitor" differently.
//
// This file is nested-admin-only (the public frontend has no admin surface), so it
// deliberately does NOT live in lib/visitors.ts — that file is a hand-ported copy of the
// public repo's tracker and must stay byte-comparable.

/** Mongo `$group` key: one group == one unique visitor (IP + device signature). */
export const VISITOR_KEY_EXPR = {
  ip: { $ifNull: ['$ip', ''] },
  type: { $ifNull: ['$device.type', 'unknown'] },
  browser: { $ifNull: ['$device.browser', ''] },
  os: { $ifNull: ['$device.os', ''] },
} as const;

// CHANGE: 2026-10-26 — read-side crawler reclassification (owner: "AI/bot seperation r
// visitor list [is wrong]").
//
// WHY: `device.type` is decided by `parseDevice()` in lib/visitors.ts AT WRITE TIME, and the
// old pattern only knew `bot|spider|crawler|slurp|curl|wget|headless|puppeteer|phantom|
// preview`. Measured on the live collection (1,327 session docs, 2026-10-26): 16 docs of
// `facebookexternalhit/1.1` (Meta's link-preview fetcher), 2 of `Google-NotebookLM` and 2 of
// `(compatible; Dataprovider.com)` were stored as `device.type: 'unknown'` and therefore
// appeared in the Humans tab and inflated the "unique visitors" KPI by 18 groups.
//
// The WRITE side is fixed in lib/visitors.ts (`BOT_UA_PATTERN`), which only helps from the
// next deploy onward. This pattern is the SAME source, applied at READ time, so the thousands
// of historical rows are classified correctly with **no data migration** — the same
// read-side approach this module already uses for session grouping.
//
// ⚠️ Keep this string byte-identical to `BOT_UA_PATTERN` in lib/visitors.ts. The two repos
// cannot import from each other (this is the nested admin fork), so the duplication is
// deliberate; `scripts/visitors-admin-test.mjs` asserts they match.
export const BOT_UA_PATTERN =
  'bot|spider|crawler|slurp|archiver|scrapy|scraper' +
  '|facebookexternalhit|facebookcatalog|meta-external|embedly|skypeuripreview|vkshare' +
  '|chatgpt|openai|gptbot|oai-searchbot|claude|anthropic|perplexity|cohere|youbot|ccbot|' +
  'bytespider|petal|notebooklm|googleother|google-extended|mediapartners|storebot' +
  '|ahrefs|semrush|mj12|dotbot|dataprovider|bitsight|hubspot|canvabot|sogou|yandex|baidu|' +
  'duckduck|seznam|qwant|lighthouse|pagespeed|gtmetrix|uptime|pingdom|monitor|censys|' +
  'shodan|masscan|zgrab|nmap' +
  '|headless|puppeteer|playwright|phantom|prerender|preview' +
  '|curl|wget|libwww|httpclient|okhttp|go-http-client|python-requests|python-urllib|axios|' +
  'node-fetch|undici|java\\/|jakarta|apache-http';

/** The same rule as a Mongo operator, for `$match`. */
export const BOT_UA_MONGO = { $regex: BOT_UA_PATTERN, $options: 'i' } as const;

/**
 * HUMANS = not flagged at write time AND the UA is not a crawler.
 *
 * A plain, **spreadable** object on purpose: callers do
 * `{ $match: { ...HUMAN_MATCH, lastSeen: { $gte: … } } }`. A missing `userAgent` field passes
 * `$not`, which is the safe default (we must never hide a real visitor because a field is
 * absent).
 */
export const HUMAN_MATCH = {
  'device.type': { $ne: 'bot' },
  userAgent: { $not: BOT_UA_MONGO },
} as const;

/**
 * BOTS = flagged at write time OR the UA is a crawler (covers legacy rows).
 *
 * ⚠️ NOT spreadable — it is a top-level `$or`. Callers MUST wrap it:
 * `{ $match: { $and: [BOT_MATCH, …] } }`. Spreading it into an object that also sets `$or`
 * (the `q` search does) silently drops one of the two conditions.
 */
export const BOT_MATCH = { $or: [{ 'device.type': 'bot' }, { userAgent: BOT_UA_MONGO }] } as const;


/** Session history is only carried for the detail modal + group delete, so it is bounded. */
export const MAX_SESSION_REFS = 500;

/**
 * Stable string identity for a grouped visitor. MUST use the same four fields as
 * `VISITOR_KEY_EXPR`, because it doubles as the React key / detail-modal identity in the
 * panel (a grouped row has no single Mongo `_id`).
 */
export function visitorKeyOf(group: { _id?: Record<string, unknown> } | null | undefined): string {
  const k = (group && group._id) || {};
  return `${k.ip ?? ''}|${k.type ?? ''}|${k.browser ?? ''}|${k.os ?? ''}`;
}

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

// Bots are flagged at write time by lib/visitors.ts `parseDevice`
// (bot|spider|crawler|slurp|curl|wget|headless|puppeteer|phantom|preview).
// `$ne` also matches documents with no device field.
export const HUMAN_MATCH = { 'device.type': { $ne: 'bot' } } as const;
export const BOT_MATCH = { 'device.type': 'bot' } as const;

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

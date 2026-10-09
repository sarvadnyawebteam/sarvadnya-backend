// CHANGE: 2026-10-09 — Defensive Date coercion (hand-ported from the public repo).
//
// The shared production DB was re-imported from a JSON dump that serialised BSON
// Dates as ISO *strings*. Code that assumed a real `Date` and called `.getTime()`
// on a stored value then threw, e.g. `expireAt.getTime is not a function` in
// lib/visitors.ts (lookupGeo / recordVisitor) — the same crash the public repo's
// /api/identify hit. `toDateMs` accepts Date | number | string (or anything else)
// and always returns a number or NaN, so a legacy/malformed value can never crash
// this deployment either. Dependency-free (no Mongo/React/next) → plain `node` can
// test it.
export function toDateMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string') {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  return NaN;
}

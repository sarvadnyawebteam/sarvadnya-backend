// CHANGE: 2026-10-06 — SP-4: admin-guard primitives extracted from proxy.ts so the LIVE
// middleware.ts can enforce them. proxy.ts was DORMANT on Next 15 (Next only reads
// middleware.ts; frontend AGENTS §10) — every /api/admin/* route here ran with ZERO auth.
// next/*-FREE on purpose (the lib/status-history.ts house pattern) so
// scripts/admin-guard-test.mjs exercises the real logic under plain `node` type
// stripping — middleware.ts itself cannot be imported by Node (its bare `next/server`
// import has no package "exports" for ESM resolution).
//
// Deliberate deltas vs proxy.ts (full rulings in the SP-4 ledger):
//  1. FAIL-CLOSED: proxy's isAdminRequest returned TRUE when ADMIN_ACCESS_KEY was unset —
//     a deployment missing the env var was wide open. This mirrors isRequestAuthorized()
//     in lib/admin-auth.ts, which was already fail-closed.
//  2. ADMIN_GUARD_EXEMPT: proxy would have 401'd POST /api/admin/login (no cookie exists
//     yet) and /api/admin/email/process (schedulers send `Authorization: Bearer`, not
//     admin cookies). Both flows never ran while proxy was dormant, so nobody noticed.
//     The set is pinned at exactly 2 entries by the test — additions are security decisions.
//  3. /api/admin/login is now behind the rate limiter (credential-stuffing brake); proxy
//     excluded the whole /api/admin/* prefix from limiting.
//  4. isAdminPath is segment-exact; proxy used startsWith('/admin'), which over-matched
//     public-looking paths such as '/administrator'.

const RATE_LIMIT = 60;
const RATE_WINDOW = 60_000;

// Paths the middleware guard must NOT block. Reasons documented above (delta 2).
export const ADMIN_GUARD_EXEMPT: ReadonlySet<string> = new Set([
  '/api/admin/login',        // the login POST carries no cookie yet
  '/api/admin/email/process' // route re-verifies admin session OR scheduler signature
]);

// Segment-exact (delta 4): '/administrator' and '/api/administrator' are public paths.
export function isAdminPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/')
  );
}

function base64Decode(str: string): string {
  try {
    return Buffer.from(str, 'base64url').toString('utf-8');
  } catch {
    return '';
  }
}

// Same payload contract as createToken()/verifyToken() in lib/admin-auth.ts:
// base64url(JSON { s: ADMIN_ACCESS_KEY, t: issuedAtMs }) — valid for 24h.
export function verifyAdminToken(token: string): boolean {
  try {
    const masterKey = process.env.ADMIN_ACCESS_KEY;
    if (!masterKey) return false;
    const payload = JSON.parse(base64Decode(token));
    return payload.s === masterKey && Date.now() - payload.t < 86_400_000;
  } catch {
    return false;
  }
}

// Credential check over a plain Headers-like object (works with NextRequest.headers and
// the Headers tests construct). Cookie parsing mirrors isRequestAuthorized():
// `admin_key` compared raw; `__admin_token` URI-decoded then verified. FAIL-CLOSED
// (delta 1): no master key in env means NO request is trusted.
export function isAdminRequest(headers: { get(name: string): string | null }): boolean {
  const masterKey = process.env.ADMIN_ACCESS_KEY;
  if (!masterKey) return false;

  const headerKey = headers.get('x-admin-key');
  if (headerKey && headerKey === masterKey) return true;

  const cookieHeader = headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 'admin_key' && value === masterKey) return true;
    if (key === '__admin_token' && verifyAdminToken(decodeURIComponent(value))) return true;
  }

  return false;
}

// 60 req / 60 s per IP (proxy port). Injectable `now` keeps the suite deterministic.
// retryAfterSec feeds the 429 Retry-After header. The Map is per-isolate, exactly as
// proxy.ts designed it (Vercel does not share middleware memory).
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  ip: string,
  now: number = Date.now()
): { limited: boolean; retryAfterSec: number } {
  let entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + RATE_WINDOW };
    rateLimitMap.set(ip, entry);
  }
  entry.count += 1;

  if (entry.count > RATE_LIMIT) {
    return { limited: true, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }

  // Bound memory: purge expired entries once the map grows (proxy port).
  if (rateLimitMap.size > 1000) {
    const threshold = Date.now();
    for (const [key, val] of rateLimitMap) {
      if (val.resetAt < threshold) rateLimitMap.delete(key);
    }
  }

  return { limited: false, retryAfterSec: 0 };
}

// Content-Type gate for writes (proxy port): POST/PUT/PATCH must be JSON or multipart.
export function isUnsupportedWrite(method: string, contentType: string | null): boolean {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;
  const ct = contentType || '';
  return !ct.includes('multipart/form-data') && !ct.includes('application/json');
}
// CHANGE: 2026-10-06 — SP-4 Task 2 test: the admin guard (ported from the DORMANT
// proxy.ts into the LIVE middleware.ts) + the 3-layer noindex of this deployment.
// WHY: proxy.ts is never read on Next 15 (MIDDLEWARE_FILENAME only — frontend AGENTS
// §10), so every /api/admin/* route here ran with zero auth until this merge. The guard
// primitives live in lib/admin-guard.ts (next/*-FREE, the house pattern established by
// lib/status-history.ts) so this suite runs under plain `node` type stripping — importing
// middleware.ts directly is impossible because its bare `next/server` import has no
// exports map for Node ESM resolution.
//
// Sections 2-6 exercise the guard module behaviourally; sections 7-8 assert the
// middleware wiring and the noindex layers at source level (like
// scripts/frontend-admin-surface-test.mjs in the public repo).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); failures += 1; };
const check = (label, cond, hint) => {
  if (cond) pass(label);
  else fail(hint ? `${label} — ${hint}` : label);
};

// Load .env the way Next would (test needs ADMIN_ACCESS_KEY; never print its value).
// Existing process.env always wins so a shell-provided value is respected.
function loadEnv(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch { /* no .env -> rely on process.env */ }
}
loadEnv(join(ROOT, '.env'));
const KEY = process.env.ADMIN_ACCESS_KEY;

// ─── 1. Guard module imports under plain node ────────────────────────────────
console.log('\n🚪 1. lib/admin-guard.ts (next/*-free) imports under plain node');
let G = null;
try {
  G = await import(new URL('../lib/admin-guard.ts', import.meta.url));
  pass('module imports (node native type stripping)');
} catch (e) {
  fail(`module missing or broken — ${String(e.message).split('\n')[0]}`);
}

// ─── 2. isAdminPath — segment-exact ──────────────────────────────────────────
console.log('\n🚪 2. isAdminPath (segment-exact, no over-match)');
if (G) {
  check('/admin is admin', G.isAdminPath('/admin') === true);
  check('/admin/users is admin', G.isAdminPath('/admin/users') === true);
  check('/api/admin is admin', G.isAdminPath('/api/admin') === true);
  check('/api/admin/prices is admin', G.isAdminPath('/api/admin/prices') === true);
  check('/administrator is NOT admin', G.isAdminPath('/administrator') === false,
    'a prefix startsWith("/admin") would over-match public paths');
  check('/api/administrator is NOT admin', G.isAdminPath('/api/administrator') === false);
  check('/careers is NOT admin', G.isAdminPath('/careers') === false);
  check('/api/contact is NOT admin', G.isAdminPath('/api/contact') === false);
}

// ─── 3. isAdminRequest — credential checks + FAIL-CLOSED ruling ─────────────
console.log('\n🚪 3. isAdminRequest (fail-closed; proxy.ts failed OPEN)');
if (G) {
  // NOTE: the unit suite injects a KNOWN key — its job is the credential LOGIC, and
  // the local .env's ADMIN_ACCESS_KEY is CRLF-mangled (multi-line, gitignored). The
  // real value fed to the deployment is exercised by the dev-server smoke probe
  // (scripts load it via @next/env exactly like Next does).
  const savedKey = process.env.ADMIN_ACCESS_KEY;
  const TEST_KEY = 'test-admin-key-for-guard-suite';
  process.env.ADMIN_ACCESS_KEY = TEST_KEY;

  const H = (init = {}) => new Headers(init);
  check('no credentials -> false', G.isAdminRequest(H()) === false);
  check('x-admin-key matches -> true', G.isAdminRequest(H({ 'x-admin-key': TEST_KEY })) === true);
  check('admin_key cookie matches -> true',
    G.isAdminRequest(H({ cookie: `admin_key=${TEST_KEY}` })) === true);
  const token = Buffer.from(JSON.stringify({ s: TEST_KEY, t: Date.now() })).toString('base64url');
  check('fresh valid __admin_token cookie -> true',
    G.isAdminRequest(H({ cookie: `__admin_token=${token}` })) === true);
  check('garbage __admin_token -> false',
    G.isAdminRequest(H({ cookie: '__admin_token=garbage' })) === false);
  check('wrong x-admin-key -> false',
    G.isAdminRequest(H({ 'x-admin-key': 'not-the-key' })) === false);

  delete process.env.ADMIN_ACCESS_KEY;
  check('FAIL-CLOSED: key unset + presented x-admin-key -> false',
    G.isAdminRequest(H({ 'x-admin-key': TEST_KEY })) === false,
    "proxy.ts returned TRUE here (fail-open) — a deployment without the env var was wide open");
  check('FAIL-CLOSED: key unset + no credentials -> false', G.isAdminRequest(H()) === false);

  if (savedKey !== undefined && savedKey.length >= 8) process.env.ADMIN_ACCESS_KEY = savedKey;
  else delete process.env.ADMIN_ACCESS_KEY;
} else if (G) {
  fail('guard module loaded but section could not run');
}

// ─── 4. Exemptions — login + scheduler drain ────────────────────────────────
console.log('\n🚪 4. ADMIN_GUARD_EXEMPT (each exemption needs a reason)');
if (G) {
  check('ADMIN_GUARD_EXEMPT is a Set', G.ADMIN_GUARD_EXEMPT instanceof Set);
  check("exempts '/api/admin/login' — the login POST has no cookie yet; proxy.ts's own\n      guard would have 401'd it (it never ran, so nobody noticed)",
    G.ADMIN_GUARD_EXEMPT.has('/api/admin/login'));
  check("exempts '/api/admin/email/process' — the route has complete own auth\n      (admin session OR scheduler signature) and middleware would break the cron path",
    G.ADMIN_GUARD_EXEMPT.has('/api/admin/email/process'));
  check('list pinned at exactly 2 — adding an exemption is a security decision',
    G.ADMIN_GUARD_EXEMPT.size === 2, `size=${G.ADMIN_GUARD_EXEMPT.size}`);
}

// ─── 5. checkRateLimit — 60/min per IP (proxy.ts port) ─────────────────────
console.log('\n🚪 5. checkRateLimit (60 req / 60s per IP)');
if (G) {
  const ip = '203.0.113.7';
  const t = Date.now();
  const first = G.checkRateLimit(ip, t);
  check('first request passes', !!first && first.limited === false);
  let at60 = null;
  for (let i = 2; i <= 60; i++) at60 = G.checkRateLimit(ip, t);
  check('requests 2..60 pass', !!at60 && at60.limited === false);
  const over = G.checkRateLimit(ip, t);
  check('61st -> limited with retryAfterSec >= 1',
    !!over && over.limited === true && over.retryAfterSec >= 1,
    JSON.stringify(over));
  check('a different IP is unaffected', G.checkRateLimit('198.51.100.9', t).limited === false);
  check('window expiry resets the counter', G.checkRateLimit(ip, t + 61_000).limited === false);
}

// ─── 6. isUnsupportedWrite — Content-Type gate (proxy.ts port) ──────────────
console.log('\n🚪 6. isUnsupportedWrite (writes must be JSON or multipart)');
if (G) {
  check('POST text/plain -> rejected', G.isUnsupportedWrite('POST', 'text/plain') === true);
  check('POST application/json -> allowed', G.isUnsupportedWrite('POST', 'application/json') === false);
  check('POST multipart/form-data -> allowed (chunked uploads)',
    G.isUnsupportedWrite('POST', 'multipart/form-data; boundary=--x') === false);
  check('POST without content-type -> rejected', G.isUnsupportedWrite('POST', null) === true);
  check('GET is never gated', G.isUnsupportedWrite('GET', 'text/plain') === false);
  check('PATCH text/plain -> rejected', G.isUnsupportedWrite('PATCH', 'text/plain') === true);
}

// ─── 7. middleware.ts wiring (source-level — comments stripped) ─────────────
console.log('\n🔧 7. middleware.ts wires the LIVE guard');
const mwRaw = readFileSync(join(ROOT, 'middleware.ts'), 'utf8');
const mw = mwRaw.replace(/^\s*\/\/.*$/gm, '');
check("imports the guard from './lib/admin-guard.ts'", mw.includes("from './lib/admin-guard.ts"));
check('calls isAdminPath(pathname)', /isAdminPath\(pathname\)/.test(mw));
check('calls isAdminRequest(request.headers)', /isAdminRequest\(request\.headers\)/.test(mw));
check('honours ADMIN_GUARD_EXEMPT', mw.includes('ADMIN_GUARD_EXEMPT'));
check('unauthenticated admin API -> 401',
  /isAdminPath\(pathname\)[\s\S]{0,700}401/.test(mw),
  'the guard must return 401 for /api/admin/* without credentials');
check('X-Robots-Tag: noindex on responses', /X-Robots-Tag/.test(mw) && /noindex/.test(mw));
check("matcher covers '/admin/:path*'", /matcher:[\s\S]*?'\/admin\/:path\*'/.test(mw));
check("matcher covers '/api/:path*'", /matcher:[\s\S]*?'\/api\/:path\*'/.test(mw));
check('CORS Allow-Origin still set (merge must not drop CORS)', /Access-Control-Allow-Origin/.test(mw));
check('OPTIONS preflight 204 preserved', /status:\s*204/.test(mw));
check('rate limiter wired in', /checkRateLimit\(/.test(mw));
check('content-type gate wired in', /isUnsupportedWrite\(/.test(mw));

// ─── 8. noindex layers + dormant proxy.ts removed ───────────────────────────
console.log('\n🔎 8. noindex (3 layers) + proxy.ts removed');
const robots = readFileSync(join(ROOT, 'app', 'robots.ts'), 'utf8');
check('robots.ts disallows everything', /disallow:\s*'\/'/.test(robots));
check('robots.ts no longer allows crawling', !/\ballow:/.test(robots),
    'this deployment must never be indexed (owner rule)');
check('robots.ts drops the sitemap pointer', !/sitemap:/.test(robots));
const layout = readFileSync(join(ROOT, 'app', 'layout.tsx'), 'utf8');
check('root layout metadata carries robots noindex', /robots:\s*\{[^}]*index:\s*false/.test(layout));
const sitemap = readFileSync(join(ROOT, 'app', 'sitemap.ts'), 'utf8');
check('sitemap.ts returns no URLs', /return\s*\[\s*\]/.test(sitemap));
check('proxy.ts deleted after the merge (Next 15 never read it; two guards would drift)',
  !existsSync(join(ROOT, 'proxy.ts')));

// ─── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '━'.repeat(60));
if (failures > 0) {
  console.log(`❌ admin guard + noindex: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('✅ admin guard + noindex: all checks passed');

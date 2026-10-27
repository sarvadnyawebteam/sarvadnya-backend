// CHANGE: 2026-10-17 — E2E for the "unique visitor" rework of the Visitors panel
// (owner: "same visitor marked as multiple visits as separate entry. We need to show
// unique visitor and increment their visit as latest, ensure bots are separated").
//
// WHAT IT PROVES (against a locally-spawned nested dev server + the SAME DB the panel reads):
//   1. scope=humans collapses many SESSION docs sharing (ip + device-signature) into ONE
//      row, with visits/pageViews SUMMED, firstSeen=min, lastSeen=max, and the newest
//      session's fields used for display (the "increment their visit as latest" ask).
//   2. A DIFFERENT device signature on the same IP is a SEPARATE unique visitor.
//   3. scope=bots shows the crawler population; scope=humans EXCLUDES it.
//   4. The headline meta is humans-only: inserting a bot group does NOT move meta.total
//      (it moves meta.botVisitors); inserting a new human group DOES move meta.total;
//      adding a SECOND session to an existing signature does NOT move meta.total.
//   5. Device / country filters and the search box narrow correctly, and sort=visitCount
//      orders by the SUMMED value.
//   6. CHANGE: 2026-10-26 — a crawler that was STORED as a human (an old/unknown bot UA,
//      e.g. facebookexternalhit / Google-NotebookLM / Dataprovider.com) is reclassified on
//      READ: it appears under scope=bots and NOT under scope=humans. No migration needed.
//   7. The write-side BOT_UA_PATTERN here is byte-identical to the READ-side copy in
//      lib/visitor-groups.ts, so one UA can never be a human on one screen and a bot on
//      the other.
//   8. The dashboard KPI `visitorsLast24h` equals the Visitors panel's `meta.activeToday`
//      (both window on lastSeen), so the two screens cannot report different populations.
//   9. DELETE ?ids=a,b,c removes every session of the row; legacy ?id= removes one session;
//      malformed id -> 400, unknown id -> 404, oversized id list -> 400.
//  10. Teardown leaves zero residue (the shared Atlas DB must never keep test data).
//
// Conventions mirrored from accounts-admin-test.mjs: raw .env parse (the CRLF-mangled
// ADMIN_ACCESS_KEY — @next/env reads only the first whitespace-delimited token), free
// port, direct-DB assertions, always-cleanup, always-kill-server.
//
// Reserved-for-documentation IPs (RFC 5737 TEST-NET-3, 203.0.113.0/24) are used so the
// synthetic docs can never collide with a real visitor; every doc also carries a marker
// field so teardown is exact.
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(ROOT, '.env');

function rawEnv(key) {
  if (!existsSync(ENV_PATH)) return null;
  const text = readFileSync(ENV_PATH, 'utf8');
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) return null;
  return m[1].replace(/\r$/, '');
}

const MONGODB_URI = rawEnv('MONGODB_URI');
const ADMIN_KEY = (rawEnv('ADMIN_ACCESS_KEY') || '').split(/\s/)[0].trim();
if (!MONGODB_URI) {
  console.error('FAIL — MONGODB_URI not found in nested .env');
  process.exit(1);
}
if (!ADMIN_KEY) {
  console.error('FAIL — ADMIN_ACCESS_KEY not found in nested .env');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`PASS  — ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL  — ${name}${extra ? ` (${extra})` : ''}`);
  }
  return cond;
}
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';

const BASE = 'http://127.0.0.1:';
let server = null;
let port = 0;
let db = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${port}${path}`, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body };
}

const authHeaders = () => ({ 'x-admin-key': ADMIN_KEY });

async function getVisitors(qs, headers = authHeaders()) {
  return api(`/api/admin/visitors?${qs}`, { headers });
}

// ---------------------------------------------------------------------------
// Synthetic data — reserved IPs, unique device signatures
// ---------------------------------------------------------------------------
const MARK = '__e2e_visitor__';
// CHANGE: 2026-10-26 — appended .60–.92 for the bot-reclassification assertions below
// (facebookexternalhit / Google-NotebookLM / Dataprovider.com vs a human control).
// Every new fixture IP MUST be listed here, because cleanup() and the teardown
// residue assertions both key off this array — an unlisted IP would leak a live DB doc.
const TEST_IPS = [
  '203.0.113.10', '203.0.113.20', '203.0.113.30', '203.0.113.40', '203.0.113.50',
  '203.0.113.60', '203.0.113.70', '203.0.113.80', '203.0.113.90', '203.0.113.91', '203.0.113.92',
];

function nowMs() {
  return Date.now();
}
const HOUR = 60 * 60 * 1000;

function sessionDoc({
  ip,
  device,
  visitCount,
  pageViews,
  firstSeen,
  lastSeen,
  entryPath,
  lastPath,
  paths,
  sectionViews = [],
  geo = null,
  userAgent = '',
  language = 'en-IN',
}) {
  return {
    sessionId: randomUUID(),
    firstSeen: new Date(firstSeen),
    lastSeen: new Date(lastSeen),
    updatedAt: new Date(lastSeen),
    visitCount,
    pageViews,
    entryPath,
    lastPath,
    referrer: '',
    lastReferrer: '',
    paths,
    sectionViews,
    ip,
    userAgent,
    device,
    language,
    secGpc: false,
    secFetchSite: 'none',
    geo,
    geoAt: geo ? new Date(lastSeen) : null,
    gpcRespected: false,
    marker: MARK,
  };
}

const GEO_IN = {
  country: 'India',
  countryCode: 'IN',
  region: 'Maharashtra',
  city: 'Navi Mumbai',
  postal: '400614',
  latitude: 19.0,
  longitude: 73.0,
  timezone: 'Asia/Kolkata',
  isp: 'E2E Test ISP',
  org: 'E2E',
  asn: 'AS0',
  currency: 'INR',
  proxy: false,
  hosting: false,
};
const GEO_US = { ...GEO_IN, country: 'United States', countryCode: 'US', city: 'Ashburn', isp: 'E2E US ISP' };

const DEV_DESKTOP = { type: 'desktop', browser: 'Chrome', os: 'Windows', engine: 'Blink', mobile: false };
const DEV_MOBILE = { type: 'mobile', browser: 'Safari', os: 'iOS', engine: 'WebKit', mobile: true };
const DEV_TABLET = { type: 'tablet', browser: 'Chrome', os: 'Android', engine: 'Blink', mobile: false };
const DEV_BOT = { type: 'bot', browser: 'Unknown', os: 'Linux', engine: '', mobile: false };

async function cleanup() {
  if (!db) return;
  try {
    const col = db.collection('visitors');
    await col.deleteMany({ marker: MARK });
    await col.deleteMany({ ip: { $in: TEST_IPS } });
  } catch (err) {
    console.error('cleanup error:', err.message);
  }
}

async function waitForServer() {
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1500);
  }
  return false;
}

function findGroup(body, ip) {
  return (body?.visitors || []).find((v) => v.ip === ip) || null;
}

(async () => {
  const net = await import('node:net');
  port = await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', String(port)], {
    cwd: ROOT,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d.toString(); });
  server.stderr.on('data', (d) => { serverLog += d.toString(); });

  try {
    console.log(`Spawning nested dev server on port ${port}…`);
    if (!(await waitForServer())) {
      check('dev server ready', false, serverLog.slice(-800));
      process.exitCode = 1;
      return;
    }
    console.log('dev server ready');

    // --- auth guard -------------------------------------------------------
    let r = await getVisitors('scope=humans', {});
    check('bare visitors GET -> 401 (middleware guard)', r.status === 401, `got ${r.status}`);

    // --- DB + synthetic sessions -----------------------------------------
    const client = new MongoClient(MONGODB_URI, { connectTimeoutMS: 8000, serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db();
    await cleanup(); // clear any residue from an aborted prior run

    const col = db.collection('visitors');
    const t = nowMs();

    // H1: same IP + SAME device signature, 2 sessions (must merge)
    const h1a = sessionDoc({
      ip: TEST_IPS[0], device: DEV_DESKTOP, visitCount: 1, pageViews: 3,
      firstSeen: t - 3 * HOUR, lastSeen: t - 3 * HOUR,
      entryPath: '/h1-entry', lastPath: '/h1-page-a',
      paths: [{ path: '/h1-entry', at: new Date(t - 3 * HOUR) }],
      sectionViews: ['hero'], geo: GEO_IN, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
    });
    const h1b = sessionDoc({
      ip: TEST_IPS[0], device: DEV_DESKTOP, visitCount: 2, pageViews: 4,
      firstSeen: t - 1 * HOUR, lastSeen: t - 1 * HOUR,
      entryPath: '/h1-entry-2', lastPath: '/h1-page-b',
      paths: [{ path: '/h1-page-b', at: new Date(t - 1 * HOUR) }],
      sectionViews: ['pricing', 'hero'], geo: GEO_IN, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120',
    });
    // H2: different IP + DIFFERENT signature (mobile) -> separate unique visitor
    const h2 = sessionDoc({
      ip: TEST_IPS[2], device: DEV_MOBILE, visitCount: 5, pageViews: 9,
      firstSeen: t - 2 * HOUR, lastSeen: t - 2 * HOUR,
      entryPath: '/h2-entry', lastPath: '/h2-page',
      paths: [{ path: '/h2-page', at: new Date(t - 2 * HOUR) }],
      geo: GEO_US, userAgent: 'Mozilla/5.0 (iPhone) Safari/604',
    });
    // B1: bot IP, 2 sessions (must merge, must NOT appear in humans)
    const b1a = sessionDoc({
      ip: TEST_IPS[1], device: DEV_BOT, visitCount: 1, pageViews: 1,
      firstSeen: t - 4 * HOUR, lastSeen: t - 4 * HOUR,
      entryPath: '/bot-a', lastPath: '/bot-a', paths: [{ path: '/bot-a', at: new Date(t - 4 * HOUR) }],
      userAgent: 'Mozilla/5.0 HeadlessChrome/141',
    });
    const b1b = sessionDoc({
      ip: TEST_IPS[1], device: DEV_BOT, visitCount: 1, pageViews: 1,
      firstSeen: t - 30 * 60 * 1000, lastSeen: t - 30 * 60 * 1000,
      entryPath: '/bot-b', lastPath: '/bot-b', paths: [{ path: '/bot-b', at: new Date(t - 30 * 60 * 1000) }],
      userAgent: 'Mozilla/5.0 HeadlessChrome/141',
    });
    await col.insertMany([h1a, h1b, h2, b1a, b1b]);

    // --- 1) humans collapses + sums --------------------------------------
    r = await getVisitors('scope=humans&limit=100&q=203.0.113');
    check('humans q=203.0.113 -> 200', r.status === 200, `got ${r.status}`);
    const humanRows = r.body?.visitors || [];
    check('humans list excludes the bot IP (2 human groups)', humanRows.length === 2 && humanRows.every((v) => v.ip !== TEST_IPS[1]),
      `rows=${humanRows.map((v) => v.ip).join(',')}`);

    const H1 = findGroup(r.body, TEST_IPS[0]);
    check('H1 merged into ONE row', !!H1);
    if (H1) {
      check('H1 sessionCount === 2', H1.sessionCount === 2, `got ${H1.sessionCount}`);
      check('H1 visitCount SUMMED (1+2) === 3', H1.visitCount === 3, `got ${H1.visitCount}`);
      check('H1 pageViews SUMMED (3+4) === 7', H1.pageViews === 7, `got ${H1.pageViews}`);
      check('H1 lastSeen === newest session (t-1h)', Math.abs(new Date(H1.lastSeen).getTime() - (t - 1 * HOUR)) < 2000,
        `got ${H1.lastSeen}`);
      check('H1 firstSeen === oldest session (t-3h)', Math.abs(new Date(H1.firstSeen).getTime() - (t - 3 * HOUR)) < 2000,
        `got ${H1.firstSeen}`);
      check('H1 entryPath from OLDEST session', H1.entryPath === '/h1-entry', `got ${H1.entryPath}`);
      check('H1 lastPath from NEWEST session', H1.lastPath === '/h1-page-b', `got ${H1.lastPath}`);
      check('H1 device signature surfaced (Chrome · Windows)', H1.device?.browser === 'Chrome' && H1.device?.os === 'Windows',
        JSON.stringify(H1.device));
      check('H1 sessions[] carries both sessions', Array.isArray(H1.sessions) && H1.sessions.length === 2);
      check('H1 sessionIds[] carries both ids', Array.isArray(H1.sessionIds) && H1.sessionIds.length === 2);
      check('H1 merged sectionViews (hero+pricing, no dupes)',
        Array.isArray(H1.sectionViews) && H1.sectionViews.includes('hero') && H1.sectionViews.includes('pricing') && H1.sectionViews.length === 2,
        JSON.stringify(H1.sectionViews));
      check('H1 visitorKey === ip|type|browser|os', H1.visitorKey === `203.0.113.10|desktop|Chrome|Windows`, `got ${H1.visitorKey}`);
    }

    const H2 = findGroup(r.body, TEST_IPS[2]);
    check('H2 distinct signature stays its OWN row', !!H2 && H2.sessionCount === 1 && H2.visitCount === 5,
      H2 ? `sc=${H2.sessionCount} vc=${H2.visitCount}` : 'missing');

    // default sort lastSeen desc -> H1 (t-1h) before H2 (t-2h)
    check('default sort: most-recent visitor first (H1 before H2)',
      humanRows[0]?.ip === TEST_IPS[0] && humanRows[1]?.ip === TEST_IPS[2],
      humanRows.map((v) => v.ip).join(','));

    // --- 2) bots scope ----------------------------------------------------
    r = await getVisitors('scope=bots&limit=100&q=203.0.113');
    const botRows = r.body?.visitors || [];
    check('bots q=203.0.113 -> exactly the bot group', botRows.length === 1 && botRows[0].ip === TEST_IPS[1],
      `rows=${botRows.map((v) => v.ip).join(',')}`);
    const B1 = botRows[0];
    check('bot group merged 2 sessions + summed visits',
      !!B1 && B1.sessionCount === 2 && B1.visitCount === 2 && B1.device?.type === 'bot',
      B1 ? `sc=${B1.sessionCount} vc=${B1.visitCount} type=${B1.device?.type}` : 'missing');

    // --- 3) bot IP hidden from humans scope ------------------------------
    r = await getVisitors('scope=humans&limit=100&q=203.0.113.20');
    check('humans scope for a BOT ip -> 0 rows', (r.body?.visitors || []).length === 0,
      `got ${(r.body?.visitors || []).length}`);

    // --- 4) meta is humans-only (behavioural proof) ----------------------
    const m0 = (await getVisitors('scope=humans')).body?.meta || {};
    const baseTotal = m0.total || 0;
    const baseBots = m0.botVisitors || 0;

    // insert a NEW bot group -> total unchanged, botVisitors +1
    await col.insertOne(sessionDoc({
      ip: TEST_IPS[3], device: DEV_BOT, visitCount: 1, pageViews: 1,
      firstSeen: t, lastSeen: t, entryPath: '/bot3', lastPath: '/bot3', paths: [],
      userAgent: 'HeadlessChrome/141',
    }));
    let m = (await getVisitors('scope=humans')).body?.meta || {};
    check('meta.total UNCHANGED after inserting a bot group', m.total === baseTotal, `${m.total} vs ${baseTotal}`);
    check('meta.botVisitors +1 after inserting a bot group', m.botVisitors === baseBots + 1, `${m.botVisitors} vs ${baseBots + 1}`);

    // insert a NEW human group -> total +1
    const h3a = sessionDoc({
      ip: TEST_IPS[4], device: DEV_TABLET, visitCount: 1, pageViews: 1,
      firstSeen: t, lastSeen: t, entryPath: '/h3-a', lastPath: '/h3-a', paths: [],
      geo: GEO_IN, userAgent: 'Mozilla/5.0 (Linux; Android) Chrome/120',
    });
    await col.insertOne(h3a);
    m = (await getVisitors('scope=humans')).body?.meta || {};
    check('meta.total +1 after inserting a new human group', m.total === baseTotal + 1, `${m.total} vs ${baseTotal + 1}`);
    check('meta.botVisitors unchanged by the human insert', m.botVisitors === baseBots + 1, `${m.botVisitors} vs ${baseBots + 1}`);

    // second session, SAME signature -> NOT a new unique visitor
    await col.insertOne(sessionDoc({
      ip: TEST_IPS[4], device: DEV_TABLET, visitCount: 3, pageViews: 3,
      firstSeen: t, lastSeen: t, entryPath: '/h3-b', lastPath: '/h3-b', paths: [],
      geo: GEO_IN, userAgent: 'Mozilla/5.0 (Linux; Android) Chrome/120',
    }));
    m = (await getVisitors('scope=humans')).body?.meta || {};
    check('meta.total UNCHANGED after a 2nd session on the SAME signature', m.total === baseTotal + 1, `${m.total} vs ${baseTotal + 1}`);
    r = await getVisitors('scope=humans&limit=100&q=203.0.113.50');
    const H3 = findGroup(r.body, TEST_IPS[4]);
    check('same-signature 2nd session merged (sessionCount 2, visits 4)',
      !!H3 && H3.sessionCount === 2 && H3.visitCount === 4,
      H3 ? `sc=${H3.sessionCount} vc=${H3.visitCount}` : 'missing');

    // --- 5) meta internal consistency ------------------------------------
    r = await getVisitors('scope=humans&limit=1');
    check('humans pagination.total === meta.total', r.body?.pagination?.total === r.body?.meta?.total,
      `${r.body?.pagination?.total} vs ${r.body?.meta?.total}`);
    r = await getVisitors('scope=bots&limit=1');
    check('bots pagination.total === meta.botVisitors', r.body?.pagination?.total === r.body?.meta?.botVisitors,
      `${r.body?.pagination?.total} vs ${r.body?.meta?.botVisitors}`);

    // --- 6) filters + search + sort --------------------------------------
    r = await getVisitors('scope=humans&limit=100&device=mobile&q=203.0.113');
    check('device=mobile filter keeps only the mobile group',
      (r.body?.visitors || []).length === 1 && r.body.visitors[0].ip === TEST_IPS[2],
      (r.body?.visitors || []).map((v) => v.ip).join(','));

    r = await getVisitors(`scope=humans&limit=100&country=${encodeURIComponent('United States')}&q=203.0.113`);
    check('country filter keeps only the US group',
      (r.body?.visitors || []).length === 1 && r.body.visitors[0].ip === TEST_IPS[2],
      (r.body?.visitors || []).map((v) => v.ip).join(','));

    r = await getVisitors('scope=humans&limit=100&q=Safari');
    const safariRows = r.body?.visitors || [];
    check('search over device.browser matches the Safari group',
      safariRows.some((v) => v.ip === TEST_IPS[2]), safariRows.map((v) => v.ip).join(','));

    r = await getVisitors('scope=humans&limit=100&q=203.0.113&sortBy=visitCount&sortDir=desc');
    const sorted = r.body?.visitors || [];
    check('sortBy=visitCount desc -> highest SUMMED visits first (H2=5 before H1=3)',
      sorted[0]?.ip === TEST_IPS[2], sorted.map((v) => `${v.ip}:${v.visitCount}`).join(','));

    // --- 7) read-side bot reclassification --------------------------------
    // CHANGE: 2026-10-26 — a crawler stored as a HUMAN (device.type 'desktop', set by an
    // older write-side regex that did not know the UA) must still surface under Bots.
    // The route classifies at READ time, so no migration of historical docs is needed.
    // Each doc below is deliberately written with DEV_DESKTOP + a crawler UA: if the read
    // side did NOT reclassify, these three would sit in `humans` and this group would fail.
    // Baseline for the population counters. NOTE: this suite writes to the SHARED live DB, so
    // real traffic can arrive at any moment — the deltas below are therefore asserted as
    // ">= base + n" (real visitors can only ADD), never as exact equality. The per-IP scope
    // assertions are the exact proof; the counters prove they were counted on the right side.
    const metaBefore = (await getVisitors('scope=humans&limit=1')).body?.meta || {};
    const botBase = metaBefore.botVisitors || 0;
    const totalBase = metaBefore.total || 0;
    const crawlerFixtures = [
      { ip: TEST_IPS[5], ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      { ip: TEST_IPS[6], ua: 'Mozilla/5.0 (compatible; Google-NotebookLM/1.0; +https://notebooklm.google.com)' },
      { ip: TEST_IPS[7], ua: 'Mozilla/5.0 (compatible; Dataprovider.com/1.0; +https://www.dataprovider.com)' },
    ];
    await col.insertMany(crawlerFixtures.map((f) => sessionDoc({
      ip: f.ip, device: DEV_DESKTOP, visitCount: 1, pageViews: 1,
      firstSeen: t - 10 * 60 * 1000, lastSeen: t - 10 * 60 * 1000,
      entryPath: '/crawler-probe', lastPath: '/crawler-probe', paths: [],
      geo: GEO_IN, userAgent: f.ua,
    })));
    // human control on a crawler-free UA — must stay in `humans`
    await col.insertOne(sessionDoc({
      ip: TEST_IPS[8], device: DEV_DESKTOP, visitCount: 1, pageViews: 1,
      firstSeen: t - 10 * 60 * 1000, lastSeen: t - 10 * 60 * 1000,
      entryPath: '/human-control', lastPath: '/human-control', paths: [],
      geo: GEO_IN, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    }));

    for (const f of crawlerFixtures) {
      const inBots = await getVisitors(`scope=bots&limit=100&q=${encodeURIComponent(f.ip)}`);
      check(`reclassify: ${f.ip} (stored human) -> 1 row under scope=bots`,
        (inBots.body?.visitors || []).length === 1 && inBots.body.visitors[0].ip === f.ip,
        `rows=${(inBots.body?.visitors || []).map((v) => v.ip).join(',')}`);
      const inHumans = await getVisitors(`scope=humans&limit=100&q=${encodeURIComponent(f.ip)}`);
      check(`reclassify: ${f.ip} -> 0 rows under scope=humans`,
        (inHumans.body?.visitors || []).length === 0,
        `rows=${(inHumans.body?.visitors || []).map((v) => v.ip).join(',')}`);
    }
    r = await getVisitors(`scope=humans&limit=100&q=${encodeURIComponent(TEST_IPS[8])}`);
    check('reclassify: human control stays under scope=humans (1 row)',
      (r.body?.visitors || []).length === 1 && r.body.visitors[0].ip === TEST_IPS[8],
      `rows=${(r.body?.visitors || []).map((v) => v.ip).join(',')}`);
    r = await getVisitors(`scope=bots&limit=100&q=${encodeURIComponent(TEST_IPS[8])}`);
    check('reclassify: human control absent from scope=bots',
      (r.body?.visitors || []).length === 0, `rows=${(r.body?.visitors || []).map((v) => v.ip).join(',')}`);
    // Population counters: the 3 crawler fixtures must land on the BOT side, and the human
    // control must land on the HUMAN side. Asserted as ">= base + n" because the suite writes
    // to the shared live DB and real visitors can add to either counter while it runs.
    const metaAfter = (await getVisitors('scope=humans')).body?.meta || {};
    check('reclassify: crawler fixtures counted as BOTS (meta.botVisitors >= base+3)',
      (metaAfter.botVisitors || 0) >= botBase + 3, `${metaAfter.botVisitors} vs ${botBase}+3`);
    check('reclassify: human control counted as HUMAN (meta.total >= base+1)',
      (metaAfter.total || 0) >= totalBase + 1, `${metaAfter.total} vs ${totalBase}+1`);

    // --- 8) BOT_UA_PATTERN parity (write side vs read side) ----------------
    // CHANGE: 2026-10-26 — the pattern lives in lib/visitors.ts (write) and is duplicated in
    // lib/visitor-groups.ts (read, comment-free). If they drift, a UA gets stored as a human
    // here and reclassified as a bot there (or vice versa) — the exact bug this session fixed.
    const patternOf = (file) => {
      const src = readFileSync(join(ROOT, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
      const start = src.indexOf('export const BOT_UA_PATTERN');
      if (start === -1) return '';
      const end = src.indexOf(';', start);
      if (end === -1) return '';
      return (src.slice(start, end).match(/'[^']*'|"[^"]*"/g) || [])
        .map((s) => s.slice(1, -1))
        .join('');
    };
    const writePattern = patternOf('lib/visitors.ts');
    const readPattern = patternOf('lib/visitor-groups.ts');
    check('parity: lib/visitors.ts exports BOT_UA_PATTERN', writePattern.length > 0, `len=${writePattern.length}`);
    check('parity: lib/visitor-groups.ts carries BOT_UA_PATTERN', readPattern.length > 0, `len=${readPattern.length}`);
    check('parity: write-side and read-side patterns are IDENTICAL', writePattern === readPattern,
      `write=${writePattern.length} read=${readPattern.length}`);
    check('parity: pattern covers the crawlers this session fixed',
      ['notebooklm', 'dataprovider', 'facebookexternalhit'].every((k) => writePattern.includes(k)),
      writePattern.slice(0, 120));

    // --- 9) dashboard KPI agrees with the visitors panel -------------------
    // CHANGE: 2026-10-26 — `visitorsLast24h` used to window on firstSeen, so a returning
    // visitor who came back today was invisible (the panel counted them on lastSeen). Both
    // now use lastSeen; this assertion is what keeps them from drifting apart again.
    r = await api('/api/admin/stats', { headers: authHeaders() });
    check('stats: GET /api/admin/stats -> 200', r.status === 200, `got ${r.status}`);
    const kpi24h = r.body?.visitorsLast24h;
    const panelActive = (await getVisitors('scope=humans&limit=1')).body?.meta?.activeToday;
    check('stats: visitorsLast24h is a number', typeof kpi24h === 'number', `${typeof kpi24h}`);
    check('stats: visitorsLast24h >= 1 (the fixtures are counted, so the check is not vacuous)',
      typeof kpi24h === 'number' && kpi24h >= 1, `got ${kpi24h}`);
    check('stats: visitorsLast24h === visitors meta.activeToday', kpi24h === panelActive,
      `${kpi24h} vs ${panelActive}`);

    // --- 10) delete -------------------------------------------------------
    if (H1) {
      const ids = H1.sessionIds.join(',');
      r = await api(`/api/admin/visitors?ids=${encodeURIComponent(ids)}`, { method: 'DELETE', headers: authHeaders() });
      check('DELETE ?ids=<both H1 sessions> -> deleted 2', r.status === 200 && r.body?.deleted === 2,
        `status=${r.status} body=${JSON.stringify(r.body)}`);
      check('H1 docs gone from DB', (await col.countDocuments({ ip: TEST_IPS[0], marker: MARK })) === 0);
      r = await getVisitors('scope=humans&limit=100&q=203.0.113.10');
      check('H1 no longer returned', (r.body?.visitors || []).length === 0,
        `got ${(r.body?.visitors || []).length}`);
    }

    // legacy single-session delete (H2's only session — insertMany assigned its _id)
    r = await api(`/api/admin/visitors?id=${String(h2._id)}`, { method: 'DELETE', headers: authHeaders() });
    check('DELETE ?id=<one session> -> deleted 1', r.status === 200 && r.body?.deleted === 1,
      `status=${r.status} body=${JSON.stringify(r.body)}`);
    check('H2 session gone from DB', (await col.countDocuments({ ip: TEST_IPS[2], marker: MARK })) === 0);

    // error paths
    r = await api('/api/admin/visitors?ids=not-an-objectid', { method: 'DELETE', headers: authHeaders() });
    check('DELETE ?ids=malformed -> 400', r.status === 400, `got ${r.status}`);
    r = await api('/api/admin/visitors?ids=', { method: 'DELETE', headers: authHeaders() });
    check('DELETE ?ids= (empty) -> 400', r.status === 400, `got ${r.status}`);
    r = await api('/api/admin/visitors', { method: 'DELETE', headers: authHeaders() });
    check('DELETE with no id -> 400', r.status === 400, `got ${r.status}`);
    r = await api('/api/admin/visitors?ids=64b7f9c2e5f1a2b3c4d5e6f7', { method: 'DELETE', headers: authHeaders() });
    check('DELETE ?ids=<unknown valid id> -> 404', r.status === 404, `got ${r.status}`);
    const many = Array.from({ length: 501 }, (_, i) => `64b7f9c2e5f1a2b3c4d5${String(i).padStart(4, '0').slice(-4)}`).join(',');
    r = await api(`/api/admin/visitors?ids=${encodeURIComponent(many)}`, { method: 'DELETE', headers: authHeaders() });
    check('DELETE ?ids=<501 ids> -> 400 (bounded)', r.status === 400, `got ${r.status}`);

    // --- teardown ---------------------------------------------------------
    await cleanup();
    const residue = await col.countDocuments({ marker: MARK });
    const residueIps = await col.countDocuments({ ip: { $in: TEST_IPS } });
    check('teardown: zero marked docs left', residue === 0, `left ${residue}`);
    check('teardown: zero reserved-IP docs left', residueIps === 0, `left ${residueIps}`);

    await client.close();
    db = null;

    const color = failed === 0 ? GREEN : RED;
    console.log(`\n${color}${failed === 0 ? 'ALL VISITORS-ADMIN ASSERTIONS PASSED' : `${failed} ASSERTIONS FAILED`} (${passed} passed / ${failed} failed)${RESET}`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error('SUITE ERROR:', err);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  } finally {
    if (server) {
      server.kill('SIGTERM');
      await sleep(500);
      if (server.exitCode === null) server.kill('SIGKILL');
    }
  }
})();

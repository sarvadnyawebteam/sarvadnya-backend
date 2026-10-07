// CHANGE: 2026-10-07 — Task 4 E2E: career candidate Accounts admin + job
// visibility toggle, against a locally-spawned nested dev server.
//
// CHANGE: 2026-10-07 — owner follow-up: manual account creation (POST
// /api/admin/careers/users) + the merge of Accounts INTO the Careers page.
// The suite now also asserts: POST create -> 201 (passwordHash stored hashed,
// never serialized), duplicate email -> 409, invalid email / short password ->
// 400, a POST-created account is deletable via the existing DELETE, and the
// standalone /admin/accounts page route is GONE (404 — the Accounts admin now
// lives inside /admin/careers).
//
// Covers:
//   1. middleware guard: bare /api/admin/careers/users -> 401, with x-admin-key -> 200
//   2. CRUD cycle on a MARKED test doc (email __e2e_test__@example.com) —
//      insert via direct DB, PATCH name/phone/email, GET detail, DELETE —
//      plus: DELETE also removes the account's sessions; invalid ObjectId -> 400/404
//   3. visibility toggle: marked test job -> PATCH visible:false -> DB write +
//      the frontend filter (`visible: { $ne: false }`) no longer matches
//      (the PUBLIC repo's /api/careers/list + /api/careers/visible use exactly
//      that filter — Task 1), PATCH visible:true -> matches again
//   4. teardown ALWAYS removes every marked doc (users, sessions, jobs) and
//      kills the dev server — the shared Atlas DB must never keep residue.
//
// Conventions mirrored from admin-guard-test.mjs: never print the access key;
// .env parsed raw (CRLF-mangled ADMIN_ACCESS_KEY — @next/env reads the first
// whitespace-delimited token, so the test sends exactly that token).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MongoClient } from 'mongodb';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(ROOT, '.env');

// --- env helpers (raw parse; the .env is CRLF and ADMIN_ACCESS_KEY is mangled) ---
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

// --- tiny harness ---
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
    /* non-JSON */
  }
  return { status: res.status, body };
}

const authHeaders = () => ({ 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' });

const TEST_EMAIL = '__e2e_test__@example.com';
const TEST_JOB_TITLE = '__e2e_visibility_test__';

async function cleanup() {
  if (!db) return;
  try {
    const users = db.collection('careers_users');
    const testUsers = await users.find({ email: TEST_EMAIL }).toArray();
    const ids = testUsers.map((u) => u._id);
    await users.deleteMany({ email: TEST_EMAIL });
    if (ids.length) {
      await db.collection('careers_sessions').deleteMany({ userId: { $in: ids } });
    }
    await db.collection('careers').deleteMany({ title: TEST_JOB_TITLE });
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

(async () => {
  // pick a free port
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

    // 1. Guard
    let r = await api('/api/admin/careers/users');
    check('bare users GET -> 401 (middleware guard)', r.status === 401, `got ${r.status}`);
    r = await api('/api/admin/careers/users', { headers: { 'x-admin-key': ADMIN_KEY } });
    check('x-admin-key users GET -> 200 array', r.status === 200 && Array.isArray(r.body), `got ${r.status}`);

    // 2. Direct-DB insert of the marked test user + a session
    const client = new MongoClient(MONGODB_URI, { connectTimeoutMS: 8000, serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db();
    const usersCol = db.collection('careers_users');
    const now = new Date();
    const ins = await usersCol.insertOne({
      email: TEST_EMAIL,
      passwordHash: 'x'.repeat(128),
      fullName: 'E2E Test Account',
      phone: '90000 00000',
      createdAt: now,
      updatedAt: now,
    });
    const userId = ins.insertedId;
    await db.collection('careers_sessions').insertOne({
      userId,
      token: 'x'.repeat(64),
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: now,
    });

    // 3. PATCH edit
    r = await api(`/api/admin/careers/users/${String(userId)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ fullName: 'E2E Renamed', phone: '98213 09060' }),
    });
    check('PATCH edit -> 200', r.status === 200 && r.body?.fullName === 'E2E Renamed', `got ${r.status} ${JSON.stringify(r.body)}`);
    const dbUser = await usersCol.findOne({ _id: userId });
    check('PATCH persisted in DB (name+phone)', dbUser?.fullName === 'E2E Renamed' && dbUser?.phone === '98213 09060');

    // 4. PATCH invalid ObjectId -> 400/404, never 200
    r = await api('/api/admin/careers/users/not-an-objectid', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ fullName: 'X' }),
    });
    check('PATCH invalid ObjectId -> 400/404', r.status === 400 || r.status === 404, `got ${r.status}`);

    // 5. GET detail
    r = await api(`/api/admin/careers/users/${String(userId)}`, { headers: { 'x-admin-key': ADMIN_KEY } });
    check('GET detail -> 200 with updated name', r.status === 200 && r.body?.fullName === 'E2E Renamed', `got ${r.status}`);

    // 6. DELETE removes account + sessions
    r = await api(`/api/admin/careers/users/${String(userId)}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    check('DELETE -> 200', r.status === 200, `got ${r.status}`);
    check('user doc gone', (await usersCol.findOne({ _id: userId })) === null);
    check(
      'session docs gone (delete cascades sessions)',
      (await db.collection('careers_sessions').countDocuments({ userId })) === 0
    );

    // 6b. Manual create (owner follow-up — POST /api/admin/careers/users)
    r = await api('/api/admin/careers/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: TEST_EMAIL, password: 'secret123', fullName: 'Created By Admin', phone: '98213 09060' }),
    });
    check('POST create -> 201', r.status === 201 && r.body?.email === TEST_EMAIL, `got ${r.status} ${JSON.stringify(r.body)}`);
    check('POST create response never serializes passwordHash', !('passwordHash' in (r.body || {})));
    const createdDoc = await usersCol.findOne({ email: TEST_EMAIL });
    check(
      'created doc persisted with hashed password + name/phone',
      !!createdDoc?.passwordHash &&
        createdDoc.passwordHash !== 'secret123' &&
        createdDoc?.fullName === 'Created By Admin' &&
        createdDoc?.phone === '98213 09060'
    );

    // 6c. Duplicate email -> 409 (unique-lite, like the public signup)
    r = await api('/api/admin/careers/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: TEST_EMAIL, password: 'secret123' }),
    });
    check('POST duplicate email -> 409', r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`);

    // 6d. Invalid email / short password -> 400
    r = await api('/api/admin/careers/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: 'not-an-email', password: 'secret123' }),
    });
    check('POST invalid email -> 400', r.status === 400, `got ${r.status}`);
    r = await api('/api/admin/careers/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email: 'another__e2e__@example.com', password: '123' }),
    });
    check('POST short password -> 400', r.status === 400, `got ${r.status}`);

    // 6e. POST-created account is deletable via the existing DELETE route
    const createdId = String(createdDoc._id);
    r = await api(`/api/admin/careers/users/${createdId}`, {
      method: 'DELETE',
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    check('DELETE on POST-created account -> 200', r.status === 200, `got ${r.status}`);

    // 6f. Merge: the standalone /admin/accounts page route is gone (404) — the
    // Accounts admin now lives INSIDE /admin/careers as a third tab.
    r = await api('/admin/accounts');
    check('standalone /admin/accounts page -> 404 (merged into /admin/careers)', r.status === 404, `got ${r.status}`);

    // 7. Visibility toggle
    const jobsCol = db.collection('careers');
    const jobIns = await jobsCol.insertOne({
      title: TEST_JOB_TITLE,
      department: 'E2E',
      location: 'Test',
      type: 'Full-time',
      postedAt: now,
    });
    const jobId = String(jobIns.insertedId);
    r = await api(`/api/admin/careers/${jobId}/visibility`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ visible: false }),
    });
    check('visibility PATCH hide -> 200', r.status === 200 && r.body?.visible === false, `got ${r.status} ${JSON.stringify(r.body)}`);
    const hidden = await jobsCol.findOne({ _id: jobIns.insertedId });
    check('visibility persisted (visible === false)', hidden?.visible === false);
    check(
      'hidden job does NOT match the public filter visible:{$ne:false}',
      (await jobsCol.countDocuments({ _id: jobIns.insertedId, visible: { $ne: false } })) === 0
    );
    r = await api(`/api/admin/careers/${jobId}/visibility`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ visible: true }),
    });
    check('visibility PATCH show -> 200', r.status === 200 && r.body?.visible === true, `got ${r.status}`);
    check(
      'shown job matches the public filter again',
      (await jobsCol.countDocuments({ _id: jobIns.insertedId, visible: { $ne: false } })) === 1
    );
    // invalid id on the visibility route is also 400/404, not 200
    r = await api('/api/admin/careers/not-an-id/visibility', {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ visible: false }),
    });
    check('visibility PATCH invalid ObjectId -> 400/404', r.status === 400 || r.status === 404, `got ${r.status}`);

    // 8. Teardown assertions
    await cleanup();
    const residueUsers = await usersCol.countDocuments({ email: TEST_EMAIL });
    const residueJobs = await jobsCol.countDocuments({ title: TEST_JOB_TITLE });
    check('teardown: zero test users left', residueUsers === 0, `left ${residueUsers}`);
    check('teardown: zero test jobs left', residueJobs === 0, `left ${residueJobs}`);

    await client.close();
    db = null;

    const color = failed === 0 ? GREEN : RED;
    console.log(`\n${color}${failed === 0 ? 'ALL ACCOUNTS-ADMIN ASSERTIONS PASSED' : `${failed} ASSERTIONS FAILED`} (${passed} passed / ${failed} failed)${RESET}`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error('SUITE ERROR:', err.message);
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
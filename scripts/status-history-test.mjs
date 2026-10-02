// CHANGE: 2026-10-02 — pure-function tests for the status-change audit trail (SP-2).
// Zero-dependency, matching the scripts/sara-topics-test.mjs precedent.
// No DB, no network, no dev server required.
//
// lib/status-history.ts is imported DIRECTLY: Node >= 22.6 strips TypeScript types
// natively, so the tests run against the real source rather than a hand-rolled
// transpile that could drift from it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'lib', 'status-history.ts');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(
    `FATAL: needs Node >= 22.6 for native TypeScript type stripping; this is ${process.versions.node}.\n` +
      `Install the project runtime first (see AGENTS.md §9).`,
  );
  process.exit(1);
}

// lib/ has no "type" field in package.json, so Node re-parses the .ts as ESM and
// warns. That is expected here, not a defect. Capture the original first — calling
// process.emitWarning from inside its own replacement recurses until the stack blows.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, name, ...rest) => {
  if ((rest[0] ?? {})?.type === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  return emitWarning(warning, name, ...rest);
};

const {
  STATUS_ACTOR,
  TSS_RENEWAL_STATUSES,
  statusChangeUpdate,
  isValidStatus,
  buildTimeline,
} = await import(pathToFileURL(SRC).href);

let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${e.message}`);
  }
};

const AT = new Date('2026-10-02T10:00:00.000Z');
const ev = (to, ms, note) => ({
  to,
  at: new Date(ms),
  actor: 'admin',
  ...(note ? { note } : {}),
});

console.log('\nstatusChangeUpdate — atomic pairing');

test('sets status and updatedAt from injected at', () => {
  const u = statusChangeUpdate('contacted', { at: AT });
  assert.equal(u.$set.status, 'contacted');
  assert.equal(u.$set.updatedAt.getTime(), AT.getTime());
});

test('pushes an event whose to matches the requested status', () => {
  const u = statusChangeUpdate('renewed', { at: AT });
  assert.equal(u.$push.statusHistory.to, 'renewed');
});

test('one document does both set and push', () => {
  const u = statusChangeUpdate('contacted', { at: AT });
  assert.ok(u.$set && u.$push, 'both operators present');
  assert.equal(Object.keys(u).length, 2);
});

test('actor is always the admin constant', () => {
  assert.equal(statusChangeUpdate('pending', { at: AT }).$push.statusHistory.actor, STATUS_ACTOR);
  assert.equal(STATUS_ACTOR, 'admin');
});

test('note key is absent entirely when not supplied', () => {
  const e = statusChangeUpdate('pending', { at: AT }).$push.statusHistory;
  assert.equal('note' in e, false, 'note must not exist as undefined');
});

test('event timestamp is the SAME instant as $set.updatedAt', () => {
  // The pairing is the whole point: status and history are one operation, so a
  // record cannot be stamped one time and audited another.
  const u = statusChangeUpdate('renewed', { at: AT });
  assert.equal(u.$push.statusHistory.at.getTime(), AT.getTime());
  assert.equal(u.$push.statusHistory.at.getTime(), u.$set.updatedAt.getTime());
});

test('event timestamp is not re-derived from the clock', () => {
  // Guards against regressing to `at: new Date()` inside the event, which would
  // drift from $set.updatedAt by however long the update took.
  const u = statusChangeUpdate('renewed', { at: AT });
  assert.notEqual(u.$push.statusHistory.at.getTime(), Date.now());
});

console.log('\nstatusChangeUpdate — note sanitising');

test('note capped at 300 chars', () => {
  const e = statusChangeUpdate('pending', { at: AT, note: 'x'.repeat(400) }).$push.statusHistory;
  assert.equal(e.note.length, 300);
});

test('control characters stripped from note', () => {
  const e = statusChangeUpdate('pending', { at: AT, note: 'a\u0000b\rc\nd' }).$push.statusHistory;
  assert.ok(!e.note.includes('\u0000'), 'no NUL');
  assert.ok(!e.note.includes('\r'), 'no CR');
  assert.ok(!e.note.includes('\n'), 'no LF');
});

test('whitespace-only note is dropped', () => {
  const e = statusChangeUpdate('pending', { at: AT, note: '   \u0000  ' }).$push.statusHistory;
  assert.equal('note' in e, false);
});

test('defaults at to now when not injected', () => {
  const e = statusChangeUpdate('pending').$push.statusHistory;
  assert.ok(e.at instanceof Date);
  assert.ok(Math.abs(Date.now() - e.at.getTime()) < 5000);
});

console.log('\nisValidStatus');

test('accepts all four statuses', () => {
  for (const s of ['pending', 'contacted', 'renewed', 'rejected']) {
    assert.equal(isValidStatus(s), true, `${s} should be valid`);
  }
});

test('rejects unknown and malformed statuses', () => {
  for (const s of ['PAID', '', 'Pending', ' renewed', 'cancelled', 'renewed ']) {
    assert.equal(isValidStatus(s), false, `${JSON.stringify(s)} should be rejected`);
  }
});

test('vocabulary is exactly the four, in order', () => {
  assert.deepEqual([...TSS_RENEWAL_STATUSES], ['pending', 'contacted', 'renewed', 'rejected']);
});

console.log('\nbuildTimeline');

test('returns newest first', () => {
  const t = buildTimeline([
    ev('pending', Date.parse('2026-10-01T09:00:00Z')),
    ev('contacted', Date.parse('2026-10-02T09:00:00Z')),
    ev('renewed', Date.parse('2026-10-03T09:00:00Z')),
  ]);
  assert.deepEqual(
    t.map((e) => e.to),
    ['renewed', 'contacted', 'pending'],
  );
});

test('derives from from the next-older to', () => {
  const t = buildTimeline([
    ev('pending', Date.parse('2026-10-01T09:00:00Z')),
    ev('contacted', Date.parse('2026-10-02T09:00:00Z')),
    ev('renewed', Date.parse('2026-10-03T09:00:00Z')),
  ]);
  assert.deepEqual(
    t.map((e) => e.from),
    ['contacted', 'pending', null],
  );
});

test('oldest entry has from null (no backfill)', () => {
  const t = buildTimeline([ev('contacted', Date.parse('2026-10-02T09:00:00Z'))]);
  assert.equal(t[0].from, null);
});

test('empty history returns empty (legacy record)', () => {
  assert.deepEqual(buildTimeline([]), []);
});

test('single event yields from null', () => {
  const t = buildTimeline([ev('renewed', Date.parse('2026-10-03T09:00:00Z'))]);
  assert.equal(t.length, 1);
  assert.equal(t[0].from, null);
  assert.equal(t[0].to, 'renewed');
});

test('handles out-of-order input', () => {
  const t = buildTimeline([
    ev('renewed', Date.parse('2026-10-03T09:00:00Z')),
    ev('pending', Date.parse('2026-10-01T09:00:00Z')),
    ev('contacted', Date.parse('2026-10-02T09:00:00Z')),
  ]);
  assert.deepEqual(
    t.map((e) => e.to),
    ['renewed', 'contacted', 'pending'],
  );
});

test('preserves note through the derivation', () => {
  const t = buildTimeline([
    ev('pending', Date.parse('2026-10-01T09:00:00Z')),
    ev('contacted', Date.parse('2026-10-02T09:00:00Z'), 'Called, no answer'),
  ]);
  assert.equal(t[0].note, 'Called, no answer');
});

test('does not mutate the input array', () => {
  const input = [
    ev('pending', Date.parse('2026-10-01T09:00:00Z')),
    ev('renewed', Date.parse('2026-10-03T09:00:00Z')),
  ];
  const before = input.map((e) => e.to);
  buildTimeline(input);
  assert.deepEqual(
    input.map((e) => e.to),
    before,
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
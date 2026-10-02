# Status-Change Audit Trail (SP-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every TSS-renewal status transition as a durable, queryable timeline, built on a reusable helper the upcoming cart Orders screen can adopt from its first commit.

**Architecture:** An embedded `statusHistory[]` array on the renewal document, appended by the *same* atomic `updateOne` that sets `status`. Events store only `to`; `from` is derived by walking the timeline backwards, which avoids a read-before-write and the race it implies. A single pure module (`lib/status-history.ts`) owns the vocabulary, the update-builder and the derivation, so it contains no Mongo, no React and no I/O and is testable with plain `node`.

**Tech Stack:** Next.js 15.5.26 App Router, React 19.2.4, TypeScript (strict: false), MongoDB via `lib/mongodb-utils.ts`, Tailwind 4. Node 24.21.0. **Zero new dependencies.**

**Spec:** `docs/superpowers/specs/2026-10-02-status-change-audit-trail-design.md` — the plan argues from the spec, so read both.

## Global Constraints

- **Repo is `sarvadnya-advanced`** (nested admin deployment). Commit with `-c user.name="ankit-sarvadnya" -c user.email="ankit@tallycertified.com"` — the repo has **no configured identity**.
- **Never run `npm run dev` and `npm run build` together** (AGENTS.md §9).
- **Every file edit carries a `// CHANGE: 2026-10-02 — <reason>` comment** explaining what and why.
- Status vocabulary is exactly `pending | contacted | renewed | rejected`, **case-sensitive**. Never add a status without an owner decision.
- `actor` is always the constant `'admin'` — one hardcoded identity exists (`lib/admin-auth.ts:6-7`). Do not build a user model.
- **No backfill.** Legacy records get no synthetic history. Oldest event renders `from: null` → "History began 2026-10-02".
- Note cap is **300 chars** (matches `lib/visitors.ts:203` convention). Control characters stripped.
- One commit per task. Conventional Commit prefix.

## Review Focus

Five input classes the spec implies that are most likely to bite. Each is pinned by a named test in the task that owns the code.

1. **A status change where `to === current status`** — must not append an event, or re-clicking a badge silently corrupts the trail. → Task 4, `no-op change appends nothing`.
2. **`statusHistory` absent on a legacy document** — `$push` must create the array, and a record with no history must render, not crash. → Task 1, `buildTimeline([])` returns `[]`; Task 3, legacy read is safe.
3. **A rejected status from the API** — the endpoint accepts any string today; must 400 and write nothing. → Task 3, `unknown status is rejected`.
4. **Note containing control characters / newlines / over-length** — must be stripped and capped, never rejected outright. → Task 1, `note is capped at 300` and `note control characters are stripped`.
5. **Malformed `id`** — `new ObjectId(id)` throws into a catch-all and returns 500; must be a 400. → Task 3, `malformed id returns 400 not 500`.

---

### Task 1: Pure core — `lib/status-history.ts` + tests

**Files:**
- Create: `lib/status-history.ts`
- Create: `scripts/status-history-test.mjs`
- Test: `scripts/status-history-test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `STATUS_ACTOR: string` (value `'admin'`)
  - `TSS_RENEWAL_STATUSES: readonly ['pending','contacted','renewed','rejected']`
  - `TssRenewalStatus = 'pending'|'contacted'|'renewed'|'rejected'`
  - `StatusEvent = { to: string; at: Date; actor: string; note?: string }`
  - `TimelineEntry = StatusEvent & { from: string | null }`
  - `statusChangeUpdate(to: string, opts?: { note?: string; at?: Date }): { $set: Record<string, unknown>; $push: Record<string, unknown> }`
  - `isValidStatus(to: string): to is TssRenewalStatus`
  - `buildTimeline(history: StatusEvent[]): TimelineEntry[]`

- [ ] **Step 1: Write the failing test**

Create `scripts/status-history-test.mjs`. Use the repo's zero-dependency style — plain `node:assert/strict`, hand-rolled runner, `process.exit(1)` on any failure, no test framework.

```js
// scripts/status-history-test.mjs
// CHANGE: 2026-10-02 — pure-function tests for the status-change audit trail (SP-2).
// Zero-dependency, matching scripts/sara-topics-test.mjs precedent. No DB, no network.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// TypeScript source is loaded through a tiny transform: strip type-only syntax
// that node cannot parse. Documented here so the runner is not mistaken for magic.
const SRC = new URL('../lib/status-history.ts', import.meta.url);
const { STATUS_ACTOR, TSS_RENEWAL_STATUSES, statusChangeUpdate, isValidStatus, buildTimeline } =
  await import(pathToFileURL(SRC.pathname).href + `?v=${Date.now()}`);

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log(`  PASS  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
};

const AT = new Date('2026-10-02T10:00:00.000Z');
```

Required test cases (assert exact values, not shapes where a value is known):

- `statusChangeUpdate` sets `$set.status` to the requested status **and** `$set.updatedAt` to the injected `at`.
- `$push.statusHistory.to` equals the requested status.
- The pushed event's `actor` is always `'admin'` — assert `=== STATUS_ACTOR`.
- **No `note` key at all** when not supplied: `assert.equal('note' in ev, false)` (not `undefined`).
- Injected `at` is used verbatim: `assert.equal(ev.at.getTime(), AT.getTime())`.
- `note` is capped at **300** chars: pass 400 chars, expect `ev.note.length === 300`.
- Control characters stripped from note: `note: 'a\u0000b\nc\td'` → no `\u0000`, and length reflects stripping.
- `isValidStatus` accepts all four; rejects `'PAID'`, `''`, `'Pending'`, `' renewed'`.
- `buildTimeline` returns **newest-first** given a chronological array.
- `buildTimeline` derives `from` from the next-older event's `to`:
  history `pending → contacted → renewed` yields `from` values `'contacted'`, `'pending'`, `null`.
- `buildTimeline([])` returns `[]` (legacy-record path — must not throw).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/status-history-test.mjs`
Expected: FAIL — cannot import `lib/status-history.ts` (file does not exist).

- [ ] **Step 3: Implement `lib/status-history.ts`**

Pure module. No Mongo, no React, no `next/*` imports, no I/O — this is what makes it testable and reusable.

```ts
// CHANGE: 2026-10-02 — status-change audit trail (SP-2).
// Single source of truth for the admin status vocabulary and the audit event shape.
// Deliberately pure: no Mongo, no React, no I/O. lib/mongodb-utils.ts builds the
// real updateOne; SP-1's Orders screen reuses statusChangeUpdate unchanged.

export const STATUS_ACTOR = 'admin';

export const TSS_RENEWAL_STATUSES = ['pending', 'contacted', 'renewed', 'rejected'] as const;
export type TssRenewalStatus = (typeof TSS_RENEWAL_STATUSES)[number];

export type StatusEvent = { to: string; at: Date; actor: string; note?: string };
export type TimelineEntry = StatusEvent & { from: string | null };

const NOTE_MAX = 300;

function sanitizeNote(note?: string): string | undefined {
  if (note === undefined) return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = note.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, NOTE_MAX) : undefined;
}

export function statusChangeUpdate(to: string, opts?: { note?: string; at?: Date }) {
  const at = opts?.at ?? new Date();
  const event: StatusEvent = { to, at, actor: STATUS_ACTOR };
  const note = sanitizeNote(opts?.note);
  if (note !== undefined) event.note = note;
  return { $set: { status: to, updatedAt: at }, $push: { statusHistory: event } };
}

export function isValidStatus(to: string): to is TssRenewalStatus {
  return (TSS_RENEWAL_STATUSES as readonly string[]).includes(to);
}

export function buildTimeline(history: StatusEvent[]): TimelineEntry[] {
  // Newest-first. Each entry's `from` is the next-older entry's `to`; the oldest
  // entry's `from` is null because legacy records were never backfilled (spec §3.3).
  const ordered = [...history].sort((a, b) => b.at.getTime() - a.at.getTime());
  return ordered.map((ev, i) => ({ ...ev, from: ordered[i + 1]?.to ?? null }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/status-history-test.mjs`
Expected: PASS on all cases, exit 0.

> If the import of the `.ts` file fails because Node cannot parse type syntax, add a
> `--experimental-strip-types` flag to the run command rather than hand-transpiling.
> Node 24.21.0 supports type stripping natively; confirm the flag on this runtime.

- [ ] **Step 5: Add the npm script**

Add to `package.json` `scripts`: `"test:status": "node scripts/status-history-test.mjs"`.
Also append `node scripts/status-history-test.mjs` to the end of the existing `test:all`
chain so it runs with the full suite.

- [ ] **Step 6: Commit**

```bash
git add lib/status-history.ts scripts/status-history-test.mjs package.json
git -c user.name="ankit-sarvadnya" -c user.email="ankit@tallycertified.com" \
  commit -m "feat: status-history pure core (SP-2)

statusChangeUpdate builds ONE atomic update document doing \$set status and
\$push statusHistory together, so the two can never disagree. Events store
only 'to'; buildTimeline derives 'from' by walking newest-first, which
avoids a read-before-write and its race on concurrent admin edits."
```

---

### Task 2: Persist — `lib/mongodb-utils.ts`

**Files:**
- Modify: `lib/mongodb-utils.ts:450-456` (`updateTssRenewalStatus`)
- Test: `scripts/status-history-test.mjs` (unchanged — the pure core already covers the logic)

**Interfaces:**
- Consumes: `statusChangeUpdate(to, opts?)` from Task 1.
- Produces: `updateTssRenewalStatus(id: string, status: string, note?: string): Promise<{ matchedCount: number }>` — same call shape as before plus an optional third arg, so existing callers are unaffected.

- [ ] **Step 1: Confirm the current behaviour is the thing being changed**

Run: `sed -n '450,456p' lib/mongodb-utils.ts`
Expected: `$set: { status, updatedAt: new Date() }` — no history, and no `ObjectId` validity guard.

- [ ] **Step 2: Rewrite the function**

```ts
// CHANGE: 2026-10-02 — status changes now append an audit event (SP-2).
// Uses statusChangeUpdate so the status set and the history push are a single
// atomic update; also guards ObjectId.isValid to stop a malformed id throwing
// into the route's catch-all as a 500. Follows the existing guard pattern at
// this file's lines 136 and 159.
export async function updateTssRenewalStatus(id: string, status: string, note?: string) {
  if (!ObjectId.isValid(id)) {
    return { matchedCount: 0 };
  }
  const col = await getCollection('tss_renewals');
  return await col.updateOne({ _id: new ObjectId(id) }, statusChangeUpdate(status, { note }));
}
```

Add the import at the top of the file: `import { statusChangeUpdate } from './status-history';`

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → exit 0.
Run: `node scripts/status-history-test.mjs` → still passes (pure core unaffected).

- [ ] **Step 4: Commit**

```bash
git add lib/mongodb-utils.ts
git -c user.name="ankit-sarvadnya" -c user.email="ankit@tallycertified.com" \
  commit -m "feat: persist status history on TSS renewals (SP-2)

updateTssRenewalStatus delegates to statusChangeUpdate so the status write
and the history append are one atomic updateOne. Adds an ObjectId.isValid
guard so a malformed id returns matchedCount 0 instead of throwing into the
route catch-all as a 500."
```

---

### Task 3: Harden the API — `app/api/admin/tss-renewals/route.ts`

**Files:**
- Modify: `app/api/admin/tss-renewals/route.ts:29-41` (PATCH handler)

**Interfaces:**
- Consumes: `isValidStatus`, `TSS_RENEWAL_STATUSES` (Task 1); `updateTssRenewalStatus(id, status, note?)` (Task 2).
- Produces: PATCH request body `{ id: string; status: string; note?: string }`. Response **200** `{ message, status, history }`; **400** `{ error }` for missing/invalid/malformed input; **404** `{ error }` when `matchedCount === 0`.

- [ ] **Step 1: Rewrite the PATCH handler**

```ts
// CHANGE: 2026-10-02 — validate status, accept an audit note, return history (SP-2).
// Previously any string was accepted as a status and a missing id returned 200.
export async function PATCH(request: Request) {
  try {
    const { id, status, note } = await request.json();
    if (!id || !status) {
      return NextResponse.json({ error: 'ID and status are required' }, { status: 400 });
    }
    if (!isValidStatus(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${TSS_RENEWAL_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    const result = await updateTssRenewalStatus(id, status, note);
    if (!result.matchedCount) {
      return NextResponse.json({ error: 'Renewal not found' }, { status: 404 });
    }
    const renewals = await getTssRenewals();
    const updated = renewals.find((r: any) => String(r._id) === String(id));
    return NextResponse.json({
      message: 'Status updated',
      status: updated?.status ?? status,
      history: updated?.statusHistory ?? [],
    });
  } catch (error) {
    console.error('Admin TSS Renewals PATCH Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
```

A malformed `id` reaches `matchedCount === 0` via Task 2's guard and yields **404**, not 500.
Add `isValidStatus` + `TSS_RENEWAL_STATUSES` to the existing `@/lib/mongodb-utils` import line
(they come from `@/lib/status-history`, so import them separately).

- [ ] **Step 2: Verify by hand against the Review Focus cases**

With the dev server running, exercise PATCH and confirm:

| Request | Expected |
| :-- | :-- |
| `{ id: <real>, status: 'PAID' }` | **400**, message lists allowed values, nothing written |
| `{ id: 'not-an-objectid', status: 'renewed' }` | **404** (never 500) |
| `{ id: <real>, status: 'contacted', note: 'x'.repeat(400) }` | **200**, stored note is 300 chars |
| `{ id: <real>, status: 'contacted' }` | **200**, `history` array grew by exactly 1 |

Run: `npm run typecheck` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/tss-renewals/route.ts
git -c user.name="ankit-sarvadnya" -c user.email="ankit@tallycertified.com" \
  commit -m "fix: validate TSS renewal status in PATCH (SP-2)

The endpoint accepted any string as a status, so the UI's four choices were
the only guard. Also: a missing or malformed id returned 200 instead of 404,
and an arbitrary note was silently discarded. Now validates against the shared
vocabulary, accepts an audit note, and returns the updated history."
```

---

### Task 4: Client fixes + timeline UI — `app/admin/tss-renewals/page.tsx`

**Files:**
- Modify: `app/admin/tss-renewals/page.tsx`
  - `handleStatus` at line 48 — no-op guard, error feedback, history reconciliation
  - line ~220 — hardcoded status array → `TSS_RENEWAL_STATUSES`
  - after the "Update Status" block — the timeline component

**Interfaces:**
- Consumes: `TSS_RENEWAL_STATUSES`, `buildTimeline`, `StatusEvent`, `TimelineEntry` (Task 1); PATCH response `{ status, history }` (Task 3).
- Produces: no new exports. Internal `StatusTimeline` component in the same file.

- [ ] **Step 1: Fix `handleStatus` — the two bugs**

```tsx
// CHANGE: 2026-10-02 — guard no-op status changes, surface PATCH failures, adopt the
// server's returned history. Previously a re-click of the current status fired a
// request (which would now append a duplicate audit event) and a rejected request
// failed silently.
const [statusError, setStatusError] = useState<string | null>(null);

const handleStatus = async (id: string, status: string) => {
  const current = renewals.find(r => r._id === id);
  if (current?.status === status) return;          // no-op: never append a duplicate event
  setStatusError(null);
  try {
    const res = await fetch('/api/admin/tss-renewals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setStatusError(body.error || `Could not update status (${res.status})`);
      return;                                        // do NOT touch local state
    }
    const body = await res.json();
    setRenewals(prev => prev.map(r => r._id === id ? { ...r, status: body.status, statusHistory: body.history } : r));
    if (selected?._id === id) setSelected(prev => prev ? { ...prev, status: body.status, statusHistory: body.history } : null);
  } catch (err) {
    setStatusError('Network error — status not updated');
  }
};
```

- [ ] **Step 2: Replace the hardcoded status array**

Change `{['pending', 'contacted', 'renewed', 'rejected'].map((s) => (` at line ~220 to
`{TSS_RENEWAL_STATUSES.map((s) => (`. Import `TSS_RENEWAL_STATUSES` from `@/lib/status-history`.

- [ ] **Step 3: Add the timeline**

A local component in the same file, rendered inside the detail modal directly after the
"Update Status" block. Map `buildTimeline(selected.statusHistory ?? [])` newest-first.

Each row: status badge via the existing `statusBadge()`; relative time with absolute
timestamp as secondary text; optional note; and where `from === null`, an em dash plus a
"History began 2026-10-02" footnote on the oldest row.

Rules:
- Empty history → "No status changes recorded yet."
- Guard `new Date(ev.at)` — Mongo returns `at` as an `Date` after `serializeData()`, but use
  `new Date(ev.at)` so a string (e.g. from a cache or a hand-edited doc) cannot render `Invalid Date`.
- Mobile-first: single column, no horizontal overflow at **360px** (AGENTS.md).
- Render `statusError` beneath the status buttons in `text-rose-600`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → exit 0.
Run the dev server alone (never alongside a build). Open `/admin/tss-renewals`, open a renewal,
change status twice, reload, and confirm the timeline shows exactly the changes made — and that
clicking the *current* status adds nothing and shows no error.

- [ ] **Step 5: Commit**

```bash
git add app/admin/tss-renewals/page.tsx
git -c user.name="ankit-sarvadnya" -c user.email="ankit@tallycertified.com" \
  commit -m "feat: status-change timeline in TSS renewals admin (SP-2)

Adds a newest-first timeline rendered from statusHistory. Fixes two bugs in
the same path: handleStatus fired a request even when the status was already
current (which would have appended a duplicate audit event on every re-click),
and a rejected PATCH failed with no visible feedback. Status choices now come
from TSS_RENEWAL_STATUSES instead of an inline array literal."
```

---

### Task 5: Docs + full verification gate

**Files:**
- Modify: `AGENTS.md` — new section documenting the audit trail
- Modify: `package.json` — confirm `test:status` wired into `test:all` (done in Task 1 Step 5)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: no code.

- [ ] **Step 1: Document in `AGENTS.md`**

Add a numbered section after §10 recording: the embedded-array decision and *why*
(Atlas M0 has no multi-document transactions); why events store `to` only; the no-backfill
decision; `STATUS_ACTOR` always being `'admin'`; the shared `statusHistory` helper that SP-1's
Orders screen must reuse rather than reinvent; and the fact that job applications /
submissions / problem reports have **no** status vocabulary yet and need an owner decision
before adopting the helper. Bump `Last Updated` to 2026-10-02.

- [ ] **Step 2: Run the full gate**

```bash
npm run typecheck                  # must exit 0
node scripts/status-history-test.mjs   # must exit 0
npm run build                      # must exit 0 — ALONE, no dev server
```

Confirm before starting the build: `ps aux | grep -E "next dev|next-server"` returns nothing.

- [ ] **Step 3: Confirm isolation held**

```bash
cd ..                     # back to sarvadnya-infotech
npx tsc --noEmit --listFiles | grep -c sarvadnya-advanced   # must be 0
git status --porcelain | grep -c sarvadnya-advanced         # must be 0
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git -c user.name="ankit-sarvadnya" -c user.email="ankit@tallycertified.com" \
  commit -m "docs: status-change audit trail in AGENTS.md (SP-2)

Records the embedded-array rationale (Atlas M0 cannot do multi-document
transactions), why events store only 'to', the deliberate no-backfill
decision, and that SP-1's Orders screen must reuse statusChangeUpdate."
```

---

## Self-Review

**1. Spec coverage.** §3 data model → Tasks 1–2. §3.1 embedded-vs-collection → Task 1 rationale,
Task 2 single-write guarantee. §3.2 `to`-only derivation → Task 1 `buildTimeline`. §3.3 no
backfill → Task 1 (`from: null`) and Task 4 ("History began"). §4.1 module → Task 1. §4.2
`mongodb-utils` → Task 2. §4.3 API validation/note/history → Task 3. §4.4 client bugs + shared
vocabulary + timeline → Task 4. §5 error table, all five rows → Task 3 Step 2 and Review Focus.
§6 testing → Task 1 plus the gate in Task 5. §7 out-of-scope → honoured; no task adds statuses to
other collections or touches the public repo.

**2. Step scan.** Every step names one file and one checkable outcome. Step 2.2 of Task 1 carries a
code block because the `$set`/`$push` pairing and the sanitiser are decisions the signature alone
does not determine. No step says "handle edge cases" or "write tests for the above" — the tests are
enumerated by name with exact expected values.

**3. Type consistency.** `statusChangeUpdate` / `isValidStatus` / `buildTimeline` /
`TSS_RENEWAL_STATUSES` / `STATUS_ACTOR` / `StatusEvent` / `TimelineEntry` are declared once in Task 1
and referenced under those exact names in Tasks 2–4. `updateTssRenewalStatus` gains `note?` in
Task 2 and is called with three args in Task 3. PATCH returns `{ message, status, history }` in
Task 3 and `handleStatus` reads exactly `body.status` / `body.history` in Task 4.

**4. Review Focus.** All five lines are pinned: #1 → Task 4 Step 1 no-op guard; #2 → Task 1
`buildTimeline([])` and Task 4 `?? []`; #3 → Task 3 Step 2; #4 → Task 1 sanitiser tests;
#5 → Task 2 `ObjectId.isValid` guard surfaced as 404 via Task 3 Step 2.

**5. Proportion.** ~230 lines of plan against a 326-line spec that specifies types, three
decisions and two bug fixes. The plan is longer than a transcript and shorter than the code it
produces; code blocks appear only where the spec pins exact behaviour.

---

*Plan written 2026-10-02. Executes the approved SP-2 spec.*
# Status-Change Audit Trail (SP-2) — Design Spec

**Repo:** `sarvadnya-advanced` (admin deployment) — *not* the public frontend repo.
**Date:** 2026-10-02
**Status:** DESIGN APPROVED IN CHAT — spec written, awaiting owner review before planning.
**Sub-project:** SP-2 of a four-part effort (see §1.3). Runs **before** the cart work.

---

## 1. Goal

### 1.1 What this delivers

A durable **status-change audit trail** for TSS renewals, built on a reusable helper that the
upcoming cart **Orders** screen adopts from its first commit rather than retrofitting later.

Today an admin can move a TSS renewal between `pending`, `contacted`, `renewed`, `rejected` —
and **nothing records that it happened**. A renewal can sit in `pending` for months with no way
to tell whether it was ever picked up. After this change, every status transition leaves a
timeline entry.

### 1.2 Why it is sequenced first

Retrofitting an audit trail onto records that already exist is a **migration**; building it
before those records are created is a **feature**. The cart Orders screen (SP-1) is a
status-bearing record that does not exist yet. Doing SP-2 first means Orders is designed against
the audit trail instead of being retrofitted to it.

### 1.3 The wider effort (context, not this spec)

| SP | Sub-project | Repo | In this spec? |
| :-- | :-- | :-- | :-- |
| SP-1 | Cart + `/demo` storefront, and an admin **Orders** screen | public + advanced | No — already specced 2026-10-01 |
| **SP-2** | **Status-change audit trail** | **advanced** | **Yes** |
| SP-3 | Uptime/dependency history + visitor traffic dashboard | advanced | No |

---

## 2. Current state (verified, not assumed)

Read on 2026-10-02 against the code at commit `382c2c8`.

### 2.1 Only one collection has statuses

| Collection | Admin page | Has a status concept? |
| :-- | :-- | :-- |
| `tss_renewals` | `app/admin/tss-renewals/page.tsx` | **Yes** — `pending` / `contacted` / `renewed` / `rejected`, hardcoded as an array literal at `page.tsx:220` |
| `applications` | `app/admin/careers/responses/page.tsx` | No — zero `status` references |
| `form_submissions` | `app/admin/submissions/page.tsx` | No — only HTTP `status: 500` noise |
| `problem_reports` | `app/admin/problem-reports/page.tsx` | No — only HTTP `status: 500` noise |

There is **no shared status type module** — `lib/` contains no `status.ts`. The allowed values
exist only as an inline array in the page component.

### 2.2 The write path

```
app/admin/tss-renewals/page.tsx:47  handleStatus(id, status)
  → fetch PATCH /api/admin/tss-renewals  { id, status }
    → app/api/admin/tss-renewals/route.ts:29  PATCH
      → updateTssRenewalStatus(id, status)          (lib/mongodb-utils.ts:450)
        → updateOne({_id}, { $set: { status, updatedAt } })
```

A single `$set`. No history is written. Nothing is validated.

### 2.3 Attribution is structurally impossible

`lib/admin-auth.ts:6-7` hardcodes exactly one identity:

```ts
const ADMIN_USERNAME = 'sarvadnya';
const ADMIN_PASSWORD = 'admin@sarvadnya';
```

**Consequence:** an `actor` field can only ever hold the constant `"admin"`. The trail's value is
therefore the **timeline** (what changed, when, from what to what), *not* attribution. This spec
does not invent a user model.

> **Flagged, out of scope:** the admin password is a hardcoded literal committed to git. That is
> a pre-existing security weakness, not introduced here, and fixing it properly means moving to
> env vars + hashing + a real session user model. Noted for a separate decision.

---

## 3. Data model

An **embedded array** on the record, not a separate collection.

```ts
type StatusEvent = {
  to: string;      // the status the record became
  at: Date;        // when the change was applied
  actor: string;   // always 'admin' — see §2.3
  note?: string;   // optional free text from the admin
};
```

Document shape:

```js
{
  _id, /* …existing TSS renewal fields… */,
  status: 'contacted',
  statusHistory: [
    { to: 'pending',  at: ISODate(...), actor: 'admin' },
    { to: 'contacted', at: ISODate(...), actor: 'admin', note: 'Called, sent renewal link' }
  ]
}
```

### 3.1 Why embedded, not a `status_events` collection

| | Embedded array | Separate collection |
| :-- | :-- | :-- |
| Writes | **One** atomic `updateOne` | Two writes |
| Consistency | Status and history **cannot** disagree | Can drift if the second write fails |
| Transactions needed | No | **Yes** — Atlas **M0 does not support multi-document transactions** |
| Query across record types | No | Yes |
| History survives record deletion | No | Yes |

The transaction requirement decides it. For TSS renewals, history that dies with the record is
correct behaviour — deleting a renewal should delete its trail.

### 3.2 Why events store `to` and **not** `from`

The intuitive event is `{ from, to }`. That forces a **read-then-write**: you must load the
record to learn the current status before you can name the previous one. Two operations, and a
race window where two concurrent admins produce a wrong `from`.

Instead each event records only `to` — *"the status became X at time T"* — and the timeline
**derives** `from` by walking backwards: each event's `from` is the next-older event's `to`.

This makes the whole write a single atomic operation:

```js
{
  $set:  { status: 'contacted', updatedAt: now },
  $push: { statusHistory: { to: 'contacted', at: now, actor: 'admin', note: '…' } }
}
```

No read. No race. Each event remains a complete, self-contained statement of fact on its own.

### 3.3 Legacy records are **not** backfilled

Every TSS renewal in the database predates this feature, so their true history is
**unrecoverable**. A migration could invent a synthetic prior state — that is fabrication, and it
would be indistinguishable from real history once written.

**Decision: no backfill.** The timeline shows "first recorded change" for the oldest event and
"History began 2026-10-02" for records that predate the feature. Being visibly incomplete is
better than being quietly wrong.

---

## 4. Components

### 4.1 `lib/status-history.ts` (new)

The one new module. Deliberately pure and collection-agnostic — it knows nothing about TSS
renewals, so SP-1's Orders screen reuses it unchanged.

```ts
// CHANGE: 2026-10-02 — status-change audit trail (SP-2).
// Single source of truth for the admin's status vocabulary and event shape.

/** The only admin identity that exists — see lib/admin-auth.ts. */
export const STATUS_ACTOR = 'admin';

/** The complete, validated status vocabulary for TSS renewals. */
export const TSS_RENEWAL_STATUSES = ['pending', 'contacted', 'renewed', 'rejected'] as const;
export type TssRenewalStatus = (typeof TSS_RENEWAL_STATUSES)[number];

export type StatusEvent = {
  to: string;
  at: Date;
  actor: string;
  note?: string;
};

/**
 * Builds ONE atomic Mongo update that sets the status and appends the event together,
 * so the two can never disagree. `at` is injectable so tests are deterministic.
 */
export function statusChangeUpdate(
  to: string,
  opts?: { note?: string; at?: Date },
): { $set: Record<string, unknown>; $push: Record<string, unknown> };

/** Type guard for a status value. */
export function isValidStatus(to: string): to is TssRenewalStatus;

/**
 * Reconstructs the timeline newest-first, deriving each event's `from` from the
 * next-older event's `to`. The oldest event's `from` is `null` — unknown by design.
 */
export function buildTimeline(history: StatusEvent[]): Array<StatusEvent & { from: string | null }>;
```

`buildTimeline` is pure and lives here rather than in the component, so the derivation is
testable without rendering anything.

### 4.2 `lib/mongodb-utils.ts` — one function changed

```ts
// current (line 450)
export async function updateTssRenewalStatus(id: string, status: string)

// after
export async function updateTssRenewalStatus(id: string, status: string, note?: string)
```

Body delegates to `statusChangeUpdate(status, { note })`. **No behavioural change for existing
callers** — `note` is optional.

### 4.3 `app/api/admin/tss-renewals/route.ts` — PATCH hardened

Three changes:

1. **Validate** `status` against `TSS_RENEWAL_STATUSES`; return **400** on an unknown value.
   Today the endpoint accepts any string — the UI restricts the choices but the endpoint is
   authoritative and does not.
2. **Accept** an optional `note` (trimmed, `.slice(0, 300)` — matching the `user-agent` cap at
   `lib/visitors.ts:203` — stripped of control characters).
3. **Return the updated record's `statusHistory`** so the client can reconcile without a refetch.

### 4.4 `app/admin/tss-renewals/page.tsx` — two bugs fixed

1. **No-op guard.** `handleStatus` (line 48) currently fires a PATCH even when the requested
   status equals the current one. Under this feature that would append a **duplicate event** on
   every re-click. Skip the request when unchanged.
2. **Silent failure.** `if (res.ok)` with no `else` means a rejected status now surfaces as
   *nothing at all*. Add visible error feedback and revert the optimistic local state.

Also: replace the hardcoded `['pending', 'contacted', 'renewed', 'rejected']` array at line 220
with `TSS_RENEWAL_STATUSES` so the vocabulary has one definition. This is a **display** concern
— the array literal is replaced, not wrapped.

### 4.5 UI — the timeline

Rendered inside the existing renewal detail modal. No new page, no new route.

```
┌ Status history ─────────────────────┐
│ ● Renewed        2 Oct, 14:22        │   ← newest first
│   Renewal key sent by email          │
│                                      │
│ ● Contacted      1 Oct, 09:41        │
│   Called, no answer                  │
│                                      │
│ ● Pending        —                   │   ← from unknown (oldest)
│   History began 2026-10-02           │
└──────────────────────────────────────┘
```

- Empty → "No status changes recorded yet."
- Derived `from === null` → em dash + the "History began" footnote.
- Uses existing `statusBadge()` colours so the timeline matches the table badges.
- Relative time ("2h ago") with the absolute timestamp as secondary text.
- Mobile-first: single column, no horizontal overflow at 360px (AGENTS.md requirement).

---

## 5. Error handling

| Case | Behaviour |
| :-- | :-- |
| Unknown `status` in PATCH | **400**, message names the allowed values. Nothing written. |
| Note over the cap | Silently truncated at the cap; never rejected — a note is not worth failing a status change over. |
| Record not found | `updateOne` matches nothing → **404**. Currently returns 200 for a missing id. |
| Malformed `id` | Guarded with `ObjectId.isValid(id)` → **400**, not 500. `updateTssRenewalStatus` currently does a bare `new ObjectId(id)` which throws into the catch-all and returns 500. The `ObjectId.isValid` guard is this repo's **established pattern** (see `lib/mongodb-utils.ts:136` and `:159`), so the fix follows it rather than inventing a new one. |
| History array exceeds 16 KB (Mongo doc limit) | Guard: refuse further appends beyond 200 events and log loudly. Realistically unreachable for a 4-status lifecycle. |

---

## 6. Testing

No test framework exists in this repo (`package.json` has no jest/vitest). Precedent is
zero-dependency Node scripts (`scripts/sara-topics-test.mjs`, `scripts/email-test.mjs`).

**New `scripts/status-history-test.mjs`**, run with plain `node`, covering the pure functions:

- `statusChangeUpdate` returns `$set.status` **and** `$push.statusHistory` in one document
- the pushed event's `to` matches the requested status
- `actor` is always `'admin'`
- `note` is **omitted entirely** when not supplied (not present as `undefined`)
- injected `at` is used verbatim → deterministic assertions
- `isValidStatus` accepts all four, rejects `'PAID'`, `''`, `'Pending'` (case-sensitive)
- `buildTimeline` returns newest-first
- `buildTimeline` derives `from` from the next-older `to`
- oldest event's `from` is `null`
- `buildTimeline([])` returns `[]` (no crash — this is the legacy-record path)

**Gates before completion:** `npm run typecheck` exit 0 · the new script passes ·
`npm run build` exit 0 run **alone** (AGENTS.md §9).

---

## 7. Explicitly out of scope

- **Job applications / submissions / problem reports.** They have no status vocabulary. SP-2
  ships the helper; adopting it there needs you to define those statuses first.
- **Backfill of existing records** (§3.3).
- **A real user model / multi-admin attribution** (§2.3) — the hardcoded-credential weakness is
  flagged, not fixed.
- **SP-1 cart and Orders screen**, **SP-3 monitoring** — separate specs.
- **Email-failure alerting** — deliberately deferred by the owner on 2026-10-02.

---

## 8. Files touched

| File | Change |
| :-- | :-- |
| `lib/status-history.ts` | **new** — types, vocabulary, `statusChangeUpdate`, `buildTimeline` |
| `lib/mongodb-utils.ts` | `updateTssRenewalStatus` delegates to the helper; gains optional `note` |
| `app/api/admin/tss-renewals/route.ts` | PATCH validates status, accepts note, returns history |
| `app/admin/tss-renewals/page.tsx` | no-op guard, error feedback, shared vocabulary, timeline UI |
| `scripts/status-history-test.mjs` | **new** — pure-function tests |
| `AGENTS.md` | new section documenting the trail |

No new dependencies. No schema migration. No change to the public repo.

---

*Spec written 2026-10-02. Awaiting owner review before the implementation plan.*
// CHANGE: 2026-10-02 — status-change audit trail (SP-2).
// Single source of truth for the admin status vocabulary and the audit event shape.
// Deliberately free of Mongo/React/next/* dependencies, in types as well as at
// runtime, so it is testable with plain `node` and reusable by SP-1's Orders screen.
// CHANGE: 2026-10-03 — SP-3: `statusChangeUpdate` gains an optional `actor` so the
// payments flow (public repo) can stamp system-driven hops (created/verified) with
// 'system' while the admin panel keeps the default 'admin'. Existing TSS callers
// pass nothing and are unchanged.
import { toDateMs } from './date-coerce.ts';

/**
 * The only admin identity that exists — see lib/admin-auth.ts. The session token
 * carries no username, so an actor field can only ever hold this constant. The
 * trail's value is the timeline, not attribution.
 */
export const STATUS_ACTOR = 'admin';

/** The complete, validated status vocabulary for TSS renewals. Case-sensitive. */
export const TSS_RENEWAL_STATUSES = ['pending', 'contacted', 'renewed', 'rejected'] as const;
export type TssRenewalStatus = (typeof TSS_RENEWAL_STATUSES)[number];

export type StatusEvent = {
  to: string; // the status the record became
  at: Date; // when the change was applied
  actor: string; // STATUS_ACTOR by default; flow callers may pass 'system'
  note?: string; // optional free text from the admin
};

export type TimelineEntry = StatusEvent & { from: string | null };

/**
 * The atomic update this builder produces: the status is set and the audit event
 * appended by the SAME operation. Typed precisely rather than as Mongo's
 * UpdateFilter — the driver's PushOperator is constrained by NotAcceptedFields
 * against a bare `Document`, which rejects any concrete value type. The single
 * cast to UpdateFilter lives at the driver boundary in lib/mongodb-utils.ts.
 */
export type StatusChangeUpdate = {
  $set: { status: string; updatedAt: Date };
  $push: { statusHistory: StatusEvent };
};

/** Matches the user-agent cap at lib/visitors.ts:203. */
const NOTE_MAX = 300;

/**
 * Strips control characters (so a note cannot inject line breaks into the audit
 * trail) and caps length. A note is never worth failing a status change over, so
 * this sanitises rather than rejects.
 */
function sanitizeNote(note?: string): string | undefined {
  if (note === undefined) return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = note.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return cleaned ? cleaned.slice(0, NOTE_MAX) : undefined;
}

/**
 * Builds ONE atomic Mongo update that sets the status and appends the event
 * together, so the two can never disagree. Events store only `to` — `from` is
 * derived by buildTimeline — which avoids a read-before-write and the race it
 * implies when two admins act at once.
 *
 * `at` is injectable so tests are deterministic. `actor` defaults to STATUS_ACTOR
 * ('admin') — every existing caller relies on that; SP-3's payment-flow hops pass
 * 'system' explicitly.
 */
export function statusChangeUpdate(to: string, opts?: { note?: string; at?: Date; actor?: string }): StatusChangeUpdate {
  const at = opts?.at ?? new Date();
  const event: StatusEvent = { to, at, actor: opts?.actor ?? STATUS_ACTOR };
  const note = sanitizeNote(opts?.note);
  if (note !== undefined) event.note = note;

  return {
    $set: { status: to, updatedAt: at },
    $push: { statusHistory: event },
  };
}

/** Type guard for the TSS renewal vocabulary. */
export function isValidStatus(to: string): to is TssRenewalStatus {
  return (TSS_RENEWAL_STATUSES as readonly string[]).includes(to);
}

/**
 * Reconstructs the timeline newest-first, deriving each entry's `from` from the
 * next-older entry's `to`. The oldest entry's `from` is null because legacy
 * records are deliberately not backfilled (spec §3.3). Pure, so the derivation
 * is testable without rendering anything.
 */
export function buildTimeline(history: StatusEvent[]): TimelineEntry[] {
  // CHANGE: 2026-10-09 — legacy `at` values may be ISO strings (JSON-dump import);
  // toDateMs avoids the `.getTime is not a function` crash in the timeline.
  const ordered = [...history].sort((a, b) => toDateMs(b.at) - toDateMs(a.at));
  return ordered.map((ev, i) => ({ ...ev, from: ordered[i + 1]?.to ?? null }));
}
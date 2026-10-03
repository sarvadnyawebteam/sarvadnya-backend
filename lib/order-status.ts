// CHANGE: 2026-10-03 — SP-3 payments admin: the ORDER status vocabulary, bound to
// the SP-2 audit builder. Per nested AGENTS.md §10, orders MUST reuse
// statusChangeUpdate rather than re-implement the $set + $push pairing — one atomic
// update keeps status and statusHistory in agreement.
//
// The actor is deliberately NOT configurable here: this module is the ADMIN side
// (refunded/fulfilled writes from the panel), so every event it stamps carries the
// default STATUS_ACTOR ('admin'). The flow-side hops (created/verified with actor
// 'system') happen in the PUBLIC repo's /api/cart/order + /api/cart/verify routes
// and are not ported here — the public fork owns the checkout path.
//
// Pure module: no Mongo/React/next/* dependency in types or at runtime, so it is
// testable with plain node (added to scripts/status-history-test.mjs).

import { statusChangeUpdate, buildTimeline } from './status-history.ts';
import type {
  StatusChangeUpdate as BaseStatusChangeUpdate,
  StatusEvent,
  TimelineEntry,
} from './status-history.ts';

/** The complete, validated order status vocabulary. Case-sensitive. */
export const ORDER_STATUSES = ['created', 'verified', 'refunded', 'fulfilled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export { buildTimeline };
export type { StatusEvent, TimelineEntry };

/** The builder's return type is the SP-2 shape (status set + event pushed). */
export type StatusChangeUpdate = BaseStatusChangeUpdate;

/** Type guard for the order vocabulary — the ONE place it lives. */
export function isValidOrderStatus(s: string): s is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(s);
}

/**
 * Builds the atomic status write for an order. `to` is type-checked to the order
 * vocabulary, so the UI cannot offer a status this endpoint rejects. Actor is the
 * module default 'admin' (see header). `at` is injectable for deterministic tests.
 */
export function orderStatusChangeUpdate(
  to: OrderStatus,
  opts?: { note?: string; at?: Date },
): StatusChangeUpdate {
  return statusChangeUpdate(to, opts);
}
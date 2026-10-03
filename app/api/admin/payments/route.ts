import { NextResponse } from 'next/server';
import type { Document } from 'mongodb';
import { getDb, serializeData, isValidObjectId } from '@/lib/mongodb-utils';
import { updateOrderStatus } from '@/lib/mongodb-utils';
// CHANGE: 2026-10-03 — SP-3 payments admin: the order status vocabulary + builder
// (Task 8) is the single source of truth; the UI and this endpoint both import it,
// so the panel can never offer a status the route rejects (nested AGENTS §10 rule).
import { ORDER_STATUSES, isValidOrderStatus, buildTimeline } from '@/lib/order-status';

// CHANGE: 2026-10-03 — SP-3 payments admin (ledger + status/note update).
// WHY: the shared `orders` collection (public repo writes it at checkout; this repo
// reads + updates status/note only). Per the owner's reframing there is NO delete,
// and NO buyer-field editing — the write surface is exactly { id, status, note? }.
//
// Auth is NOT handled here: the deployment's admin guard (proxy.ts) already
// restricts /api/admin/* — follow the sibling admin routes' convention.

export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
/** Export mode ignores pagination; cap so a runaway export cannot OOM the fn. */
const EXPORT_CAP = 5000;

function escapeRegex(input: string): string {
  // eslint-disable-next-line no-useless-escape
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') ?? '';
    if (status && !isValidOrderStatus(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    const filter: Document = {};
    if (status) filter.status = status;

    // createdAt range from ISO date strings. Unparsable values are a client bug —
    // 400 rather than silently ignoring the filter.
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const range: Document = {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid from date.' }, { status: 400 });
      }
      range.$gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid to date.' }, { status: 400 });
      }
      range.$lte = d;
    }
    if (Object.keys(range).length > 0) filter.createdAt = range;

    const q = searchParams.get('q')?.trim() ?? '';
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      // `customer` is null on pre-feature orders; a regex against a missing dotted
      // field simply never matches, which is the desired behaviour.
      filter.$or = [
        { orderId: re },
        { 'customer.name': re },
        { 'customer.email': re },
        { 'customer.phone': re },
      ];
    }

    const exportMode = searchParams.get('export') === '1';
    let page = 1;
    let limit = DEFAULT_LIMIT;
    if (!exportMode) {
      page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
      limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
    } else {
      limit = EXPORT_CAP;
    }

    const db = await getDb();
    const col = db.collection('orders');

    // Spec §4.4: the ledger is a payments record — project OUT `ip`. The `_id` is
    // KEPT (serialised by serializeData) because the POST status-change contract
    // addresses orders by their ObjectId; the plan doc's `_id: 0` shorthand was an
    // error that would have made every ledger row un-updatable.
    const projection = { ip: 0 } as const;

    const [total, docs] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter, { projection })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    return NextResponse.json({
      items: serializeData(docs),
      total,
      page: exportMode ? 1 : page,
      totalPages: exportMode ? 1 : Math.max(1, Math.ceil(total / limit)),
      export: exportMode,
    });
  } catch (error) {
    console.error('Admin payments GET Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    const status = typeof body.status === 'string' ? body.status : '';
    // note is sanitised + capped by statusChangeUpdate's sanitizeNote (300 chars,
    // control chars stripped) — this route passes it through untouched.
    const note = typeof body.note === 'string' ? body.note : undefined;

    if (!isValidObjectId(id)) {
      return NextResponse.json(
        { error: 'Validation failed', errors: { id: 'A valid order id is required.' } },
        { status: 400 },
      );
    }
    if (!isValidOrderStatus(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    const order = await updateOrderStatus(id, status, note);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Status updated',
      order: serializeData(order),
      timeline: buildTimeline(Array.isArray(order.statusHistory) ? order.statusHistory : []),
    });
  } catch (error) {
    console.error('Admin payments POST Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
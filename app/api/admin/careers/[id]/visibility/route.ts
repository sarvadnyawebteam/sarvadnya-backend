import { NextRequest, NextResponse } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// CHANGE: 2026-10-07 — Task 4: job visibility toggle, ported from the public
// repo route that was removed in Task 1 (commit 1112177 added it THERE with zero
// auth; it now lives here behind the middleware guard). Writes the SHARED
// `careers` collection — the public site's /api/careers/list + /api/careers/visible
// filter `visible: { $ne: false }` (Task 1 fix), so a hidden job leaves the
// public site immediately. Last ported line: 400 on malformed id (added here —
// the original shipped a 200 even for unmatched ids).
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { visible } = await req.json();

    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const collection = db.collection('careers');

    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { visible: !!visible, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, visible: !!visible });
  } catch (err) {
    console.error('Error updating visibility:', err);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
import { NextResponse } from 'next/server';
import { getTssRenewals, deleteTssRenewal, updateTssRenewalStatus } from '@/lib/mongodb-utils';
// CHANGE: 2026-10-02 — shared status vocabulary (SP-2). The admin page imports the
// same constants, so the UI and this endpoint can never drift apart.
import { isValidStatus, TSS_RENEWAL_STATUSES } from '@/lib/status-history';

export async function GET() {
  try {
    const renewals = await getTssRenewals();
    return NextResponse.json({ renewals });
  } catch (error) {
    console.error('Admin TSS Renewals GET Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }
    await deleteTssRenewal(id);
    return NextResponse.json({ message: 'Renewal request deleted' });
  } catch (error) {
    console.error('Admin TSS Renewals DELETE Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { id, status, note } = await request.json();
    if (!id || !status) {
      return NextResponse.json({ error: 'ID and status are required' }, { status: 400 });
    }
    // CHANGE: 2026-10-02 — validate the status and accept an audit note (SP-2).
    // This endpoint used to accept ANY string as a status, so the four buttons in
    // the UI were the only guard on what reached the database.
    if (!isValidStatus(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${TSS_RENEWAL_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    const updated = await updateTssRenewalStatus(id, status, note);
    // A malformed id is rejected by the ObjectId.isValid guard inside
    // updateTssRenewalStatus, so it lands here as a 404 rather than a 500.
    if (!updated) {
      return NextResponse.json({ error: 'Renewal not found' }, { status: 404 });
    }
    // Return the post-write state so the client reconciles without a refetch.
    return NextResponse.json({
      message: 'Status updated',
      status: updated.status,
      history: updated.statusHistory ?? [],
    });
  } catch (error) {
    console.error('Admin TSS Renewals PATCH Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

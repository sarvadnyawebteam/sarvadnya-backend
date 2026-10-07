import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getCareersUsersCollection, getCareersSessionsCollection } from '@/lib/careers-auth';
import { del } from '@vercel/blob';

// CHANGE: 2026-10-07 — Task 4: detail / edit / delete for career candidate
// accounts. DELETE must drop the account doc AND its auth sessions (a deleted
// login must not keep valid session tokens), and best-effort deletes a Vercel
// Blob resume (any failure is swallowed — a failed cleanup must never block
// account deletion). Auth: middleware guard (nested convention). email is the
// login identity, so PATCH validates it and applies unique-lite (reject a
// change that collides with another account).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type RouteCtx = { params: Promise<{ id: string }> };

function safeUser(u: any) {
  return {
    _id: String(u._id),
    email: u.email,
    fullName: u.fullName ?? null,
    phone: u.phone ?? null,
    resumeUrl: u.resumeUrl ?? null,
    resumeName: u.resumeName ?? null,
    lastLoginAt: u.lastLoginAt ?? null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function GET(_req: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const users = await getCareersUsersCollection();
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json(safeUser(user));
  } catch (err) {
    console.error('Error fetching user:', err);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (body.fullName !== undefined) updates.fullName = String(body.fullName).trim().slice(0, 120);
    if (body.phone !== undefined) updates.phone = String(body.phone).trim().slice(0, 20);
    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
      }
      updates.email = email;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No editable fields provided (fullName, phone, email)' }, { status: 400 });
    }
    updates.updatedAt = new Date();

    const users = await getCareersUsersCollection();
    if (updates.email) {
      const clash = await users.findOne({ email: updates.email, _id: { $ne: new ObjectId(id) } });
      if (clash) {
        return NextResponse.json({ error: 'That email is already in use by another account' }, { status: 409 });
      }
    }

    const updated = await users.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updates },
      { returnDocument: 'after' }
    );
    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    return NextResponse.json(safeUser(updated));
  } catch (err) {
    console.error('Error updating user:', err);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    }
    const oid = new ObjectId(id);

    const users = await getCareersUsersCollection();
    const user = await users.findOne({ _id: oid });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Best-effort resume blob cleanup — swallow every failure.
    if (
      user.resumeUrl &&
      typeof user.resumeUrl === 'string' &&
      user.resumeUrl.includes('blob.vercel-storage.com')
    ) {
      try {
        await del(user.resumeUrl);
      } catch {
        /* best-effort — never block the delete */
      }
    }

    const sessions = await getCareersSessionsCollection();
    await sessions.deleteMany({ userId: oid });
    await users.deleteOne({ _id: oid });

    return NextResponse.json({ message: 'Account deleted' });
  } catch (err) {
    console.error('Error deleting user:', err);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { getCareersUsersCollection, hashPassword } from '@/lib/careers-auth';

// CHANGE: 2026-10-07 — Task 4: career candidate Accounts list, ported from the
// public repo's route that was removed in Task 1 (commit 1112177 added it THERE
// with zero auth; it now lives here BEHIND the middleware guard — nested
// convention: no per-route auth calls). Extended over the original with an
// optional ?q= search over name/email/phone (escaped regex).
// passwordHash is never serialized anywhere in this file.
//
// CHANGE: 2026-10-07 — owner follow-up: manual account creation. POST accepts
// { fullName?, phone?, email, password } and writes a careers_user exactly like
// the public signup route (same email regex, same password floor of 6, same
// unique-lite email collision -> 409, same hashPassword). Creating an account
// here does NOT create a session/cookie — the candidate still signs in on
// /careers with the issued credentials.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();

    const users = await getCareersUsersCollection();
    const filter: Record<string, unknown> = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
    }

    const allUsers = await users.find(filter).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(allUsers.map(safeUser));
  } catch (err) {
    console.error('Error fetching users:', err);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 20) : '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const users = await getCareersUsersCollection();
    const existing = await users.findOne({ email });
    if (existing) {
      return NextResponse.json(
        { error: 'That email is already in use by another account' },
        { status: 409 },
      );
    }

    const now = new Date();
    const passwordHash = hashPassword(password);
    const result = await users.insertOne({
      email,
      passwordHash,
      fullName: fullName || '',
      phone: phone || '',
      createdAt: now,
      updatedAt: now,
    });

    const created = await users.findOne({ _id: result.insertedId });
    return NextResponse.json(safeUser(created), { status: 201 });
  } catch (err) {
    console.error('Error creating user:', err);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}
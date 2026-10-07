import { NextRequest, NextResponse } from 'next/server';
import { getCareersUsersCollection } from '@/lib/careers-auth';

// CHANGE: 2026-10-07 — Task 4: career candidate Accounts list, ported from the
// public repo's route that was removed in Task 1 (commit 1112177 added it THERE
// with zero auth; it now lives here BEHIND the middleware guard — nested
// convention: no per-route auth calls). Extended over the original with an
// optional ?q= search over name/email/phone (escaped regex).
// passwordHash is never serialized anywhere in this file.
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

    const serialized = allUsers.map((u) => ({
      _id: String(u._id),
      email: u.email,
      fullName: u.fullName ?? null,
      phone: u.phone ?? null,
      resumeUrl: u.resumeUrl ?? null,
      resumeName: u.resumeName ?? null,
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));

    return NextResponse.json(serialized);
  } catch (err) {
    console.error('Error fetching users:', err);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
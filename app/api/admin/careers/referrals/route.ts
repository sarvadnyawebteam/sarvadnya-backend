import { NextRequest, NextResponse } from 'next/server';
import { getCareersUsersCollection } from '@/lib/careers-auth';

// CHANGE: 2026-10-16 — careers referral system: read-only referral reporting for the
// Careers admin section (the public site's /careers signup writes the data).
//
// WHY a dedicated route rather than extending /api/admin/careers/users: the reporting
// needs a JOIN-with-itself (referred account -> referrer account by code) plus a
// per-referrer leaderboard, which the flat user list cannot express. Read-only, no writes.
//
// Auth: handled by this deployment's middleware guard (nested convention — no per-route auth).
// `passwordHash` is never read or serialized here.
export const dynamic = 'force-dynamic';

type MiniUser = {
  _id?: unknown;
  email?: string;
  fullName?: string | null;
  referralCode?: string | null;
  referredBy?: string | null;
  referredAt?: Date | string | null;
  createdAt?: Date | string;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim().toUpperCase();

    const users = await getCareersUsersCollection();
    const all = (await users
      .find(
        {},
        { projection: { email: 1, fullName: 1, referralCode: 1, referredBy: 1, referredAt: 1, createdAt: 1 } }
      )
      .toArray()) as MiniUser[];

    // code -> referrer account, so a referred row can show WHO owns the code.
    const byCode = new Map<string, MiniUser>();
    for (const u of all) {
      if (typeof u.referralCode === 'string' && u.referralCode) byCode.set(u.referralCode, u);
    }

    // Every referred account (referredBy present). `referredAt` is the true event time; legacy
    // docs created before this feature fall back to createdAt so the column is never blank.
    const rowsAll = all
      .filter((u) => typeof u.referredBy === 'string' && u.referredBy)
      .map((u) => {
        const code = u.referredBy as string;
        const referrer = byCode.get(code);
        const at = u.referredAt ?? u.createdAt ?? null;
        return {
          _id: String(u._id),
          email: u.email ?? null,
          fullName: u.fullName ?? null,
          code,
          referrerName: referrer?.fullName ?? null,
          referrerEmail: referrer?.email ?? null,
          referredAt: at,
        };
      })
      .sort((a, b) => new Date(b.referredAt as any).getTime() - new Date(a.referredAt as any).getTime());

    // Per-referrer leaderboard over ALL referred accounts (counts a code even if the referrer
    // account was since deleted, so the totals never silently drop).
    const counts = new Map<string, number>();
    for (const u of all) {
      if (typeof u.referredBy === 'string' && u.referredBy) {
        counts.set(u.referredBy, (counts.get(u.referredBy) || 0) + 1);
      }
    }
    const summary = [...counts.entries()]
      .map(([code, count]) => {
        const referrer = byCode.get(code);
        return {
          code,
          count,
          referrerName: referrer?.fullName ?? null,
          referrerEmail: referrer?.email ?? null,
        };
      })
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

    const rows = q
      ? rowsAll.filter(
          (r) =>
            r.code.includes(q) ||
            (r.fullName || '').toUpperCase().includes(q) ||
            (r.email || '').toUpperCase().includes(q) ||
            (r.referrerName || '').toUpperCase().includes(q) ||
            (r.referrerEmail || '').toUpperCase().includes(q)
        )
      : rowsAll;

    return NextResponse.json({
      rows,
      summary,
      totals: {
        referredAccounts: rowsAll.length,
        referrers: summary.length,
        codesAssigned: byCode.size,
      },
      filtered: Boolean(q),
    });
  } catch (err) {
    console.error('Error fetching referrals:', err);
    return NextResponse.json({ error: 'Failed to fetch referrals' }, { status: 500 });
  }
}

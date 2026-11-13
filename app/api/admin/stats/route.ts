import { NextResponse } from 'next/server';
import { getCollection } from '@/lib/mongodb-utils';
import { VISITOR_KEY_EXPR, HUMAN_MATCH } from '@/lib/visitor-groups';

// CHANGE: 2026-11-13 — dashboard data layer rebuilt for the new dashboard UI.
// WHAT: every collection handle is opened once, and every count/aggregate runs in
// PARALLEL (Promise.all) instead of ~20 sequential round-trips. Adds the numbers the
// new dashboard needs to be actionable: 24h/7d lead flow, pending TSS renewals,
// pending orders, collected revenue, and the two "recent activity" feeds.
// WHY: the old route did one await after another (slow on Atlas M0) and only exposed
// lifetime totals, so the dashboard could not say what needs attention *today*.
// All changes are additive — existing keys (visitors, visitorsLast24h, orders, …)
// keep their exact meaning, so scripts/api-test.mjs and visitors-admin-test.mjs stay green.

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const now = Date.now();
    const last24h = new Date(now - DAY_MS);
    const last7d = new Date(now - 7 * DAY_MS);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      submissionsCol,
      problemReportsCol,
      tssRenewalsCol,
      applicationsCol,
      visitorsCol,
      ordersCol,
      usersCol,
      chatsCol,
      draftsCol,
      siteContentCol,
    ] = await Promise.all([
      getCollection('form_submissions'),
      getCollection('problem_reports'),
      getCollection('tss_renewals'),
      getCollection('job_applications'),
      getCollection('visitors'),
      getCollection('orders'),
      getCollection('careers_users'),
      getCollection('chat_logs'),
      getCollection('drafts'),
      getCollection('site_content'),
    ]);

    const [
      submissions,
      submissionsLast24h,
      submissionsLast7d,
      problemReports,
      problemReportsLast24h,
      tssRenewals,
      tssPending,
      applications,
      applicationsLast24h,
      uniqueAgg,
      last24hAgg,
      orders,
      ordersToday,
      ordersPending,
      revenueAgg,
      accounts,
      chats,
      chatsLast24h,
      drafts,
      draftsLast24h,
      faqDoc,
      recentOrdersRaw,
      recentLeadsRaw,
    ] = await Promise.all([
      submissionsCol.countDocuments(),
      submissionsCol.countDocuments({ createdAt: { $gte: last24h } }),
      submissionsCol.countDocuments({ createdAt: { $gte: last7d } }),
      problemReportsCol.countDocuments(),
      problemReportsCol.countDocuments({ createdAt: { $gte: last24h } }),
      tssRenewalsCol.countDocuments(),
      tssRenewalsCol.countDocuments({ status: 'pending' }),
      applicationsCol.countDocuments(),
      applicationsCol.countDocuments({ createdAt: { $gte: last24h } }),
      // CHANGE: 2026-10-17 — these two KPIs count UNIQUE HUMAN VISITORS (sessions grouped
      // by the shared IP + device key in lib/visitor-groups.ts), never raw session docs.
      visitorsCol
        .aggregate([{ $match: HUMAN_MATCH }, { $group: { _id: VISITOR_KEY_EXPR } }, { $count: 'n' }])
        .toArray(),
      // CHANGE: 2026-10-26 — window on `lastSeen`, not `firstSeen`: a visitor document is one
      // session keyed by the 1-year cookie, so a returning visitor keeps a months-old firstSeen.
      visitorsCol
        .aggregate([
          { $match: { ...HUMAN_MATCH, lastSeen: { $gte: last24h } } },
          { $group: { _id: VISITOR_KEY_EXPR } },
          { $count: 'n' },
        ])
        .toArray(),
      ordersCol.countDocuments(),
      ordersCol.countDocuments({ createdAt: { $gte: startOfToday } }),
      ordersCol.countDocuments({ status: 'created' }),
      ordersCol
        .aggregate([
          { $match: { status: { $in: ['verified', 'fulfilled'] } } },
          { $group: { _id: null, total: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
        ])
        .toArray(),
      usersCol.countDocuments(),
      chatsCol.countDocuments(),
      chatsCol.countDocuments({ lastActiveAt: { $gte: last24h } }),
      draftsCol.countDocuments(),
      draftsCol.countDocuments({ lastActiveAt: { $gte: last24h } }),
      siteContentCol.findOne({ section: 'home_faq' }),
      ordersCol
        .find(
          {},
          {
            projection: {
              orderId: 1,
              amountPaise: 1,
              status: 1,
              createdAt: 1,
              'customer.name': 1,
            },
          }
        )
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
      submissionsCol
        .find(
          {},
          { projection: { name: 1, email: 1, formType: 1, service: 1, createdAt: 1 } }
        )
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
    ]);

    const faqCount =
      faqDoc && Array.isArray((faqDoc as any).content) ? (faqDoc as any).content.length : 0;
    const revenue = revenueAgg[0] ?? { total: 0, count: 0 };

    return NextResponse.json({
      // Lifetime counts (kept for compatibility).
      submissions,
      problemReports,
      tssRenewals,
      applications,
      visitors: uniqueAgg[0]?.n ?? 0,
      orders,
      accounts,
      chats,
      drafts,
      faq: faqCount,

      // "What needs attention" / flow metrics (new).
      submissionsLast24h,
      submissionsLast7d,
      problemReportsLast24h,
      tssPending,
      applicationsLast24h,
      visitorsLast24h: last24hAgg[0]?.n ?? 0,
      ordersToday,
      ordersPending,
      revenuePaise: Number(revenue.total) || 0,
      revenueOrders: Number(revenue.count) || 0,
      chatsLast24h,
      draftsLast24h,

      // Recent activity feeds (new). Dates serialise to ISO through NextResponse.json.
      recentOrders: recentOrdersRaw.map((o: any) => ({
        orderId: o.orderId || '',
        customerName: o.customer?.name || '',
        amountPaise: Number(o.amountPaise) || 0,
        status: o.status || 'created',
        createdAt: o.createdAt || null,
      })),
      recentLeads: recentLeadsRaw.map((s: any) => ({
        name: s.name || '',
        email: s.email || '',
        formType: s.formType || '',
        service: s.service || '',
        createdAt: s.createdAt || null,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch admin stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getCollection } from '@/lib/mongodb-utils';

export async function GET() {
  try {
    // CHANGE: 2026-10-07 — owner follow-up (dashboard KPIs): orders (commerce)
    // and career candidate accounts are now surfaced on /api/admin/stats. The
    // `orders` collection is written by the PUBLIC repo's checkout; the
    // `careers_users` collection by the public /careers signup + this panel's
    // manual create.
    const stats: any = {
      submissions: 0,
      problemReports: 0,
      tssRenewals: 0,
      applications: 0,
      modules: 0,
      learning: 0,
      reviews: 0,
      news: 0,
      partners: 0,
      faq: 0,
      visitors: 0,
      visitorsToday: 0,
      orders: 0,
      ordersToday: 0,
      accounts: 0
    };

    // Submissions count
    const submissionsCol = await getCollection('form_submissions');
    stats.submissions = await submissionsCol.countDocuments();

    // Visitors count (passive identification)
    const visitorsCol = await getCollection('visitors');
    stats.visitors = await visitorsCol.countDocuments();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    stats.visitorsToday = await visitorsCol.countDocuments({ firstSeen: { $gte: startOfToday } });

    // Problem reports count
    const problemReportsCol = await getCollection('problem_reports');
    stats.problemReports = await problemReportsCol.countDocuments();

    // TSS Renewals count
    const tssRenewalsCol = await getCollection('tss_renewals');
    stats.tssRenewals = await tssRenewalsCol.countDocuments();

    // Applications count
    const applicationsCol = await getCollection('job_applications');
    stats.applications = await applicationsCol.countDocuments();

    // Modules count
    const modulesCol = await getCollection('modules');
    stats.modules = await modulesCol.countDocuments();

    // Learning count
    const learningCol = await getCollection('learning_content');
    stats.learning = await learningCol.countDocuments();

    // Reviews count
    const reviewsCol = await getCollection('reviews');
    stats.reviews = await reviewsCol.countDocuments();

    // News count
    const newsCol = await getCollection('news');
    stats.news = await newsCol.countDocuments();

    // Partners count
    const partnersCol = await getCollection('partners');
    stats.partners = await partnersCol.countDocuments();

    // FAQ count (from site_content)
    const siteContentCol = await getCollection('site_content');
    const faqDoc = await siteContentCol.findOne({ section: 'home_faq' });
    if (faqDoc && Array.isArray(faqDoc.content)) {
      stats.faq = faqDoc.content.length;
    }

    // Orders count (SP-3 orders ledger — written by the public checkout routes)
    const ordersCol = await getCollection('orders');
    stats.orders = await ordersCol.countDocuments();
    stats.ordersToday = await ordersCol.countDocuments({ createdAt: { $gte: startOfToday } });

    // Career candidate accounts (public /careers signup + this panel's manual create)
    const usersCol = await getCollection('careers_users');
    stats.accounts = await usersCol.countDocuments();

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Failed to fetch admin stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { toDateMs } from '@/lib/date-coerce';

// CHANGE: 2026-11-13 — dashboard remade (owner: "remake dashboard with better ui and
// more clear information"). The old screen was three grids of bare numbers: no context,
// no prioritisation and no recent activity. The rebuild keeps the same data source but
//   * opens with four headline KPIs that answer "how is the business doing?",
//   * adds a "Needs attention" queue so nothing waits silently,
//   * keeps every lifetime total in labelled groups with a one-line context under each,
//   * adds recent orders + recent leads, and
//   * shows system health as a readable panel instead of tiny chips.
// The API change that feeds it is app/api/admin/stats/route.ts (parallel queries +
// 24h/7d flow, pending counts, revenue and the two recent-activity feeds).

type HealthStatus = {
  status: string;
  mongodb: string;
  timestamp: string;
  version: string;
  mongodb_error?: string;
};

type RecentOrder = {
  orderId: string;
  customerName: string;
  amountPaise: number;
  status: string;
  createdAt: string | null;
};

type RecentLead = {
  name: string;
  email: string;
  formType: string;
  service: string;
  createdAt: string | null;
};

type AdminStats = {
  submissions: number;
  problemReports: number;
  tssRenewals: number;
  applications: number;
  visitors: number;
  orders: number;
  accounts: number;
  chats: number;
  drafts: number;
  faq: number;
  submissionsLast24h: number;
  submissionsLast7d: number;
  problemReportsLast24h: number;
  tssPending: number;
  applicationsLast24h: number;
  visitorsLast24h: number;
  ordersToday: number;
  ordersPending: number;
  revenuePaise: number;
  revenueOrders: number;
  chatsLast24h: number;
  draftsLast24h: number;
  recentOrders: RecentOrder[];
  recentLeads: RecentLead[];
};

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatMoney(paise: number | undefined): string {
  if (typeof paise !== 'number' || !Number.isFinite(paise)) return '—';
  return inr.format(paise / 100);
}

function formatDateTime(value: string | null | undefined): string {
  const ms = toDateMs(value);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(value: string | null | undefined): string {
  const ms = toDateMs(value);
  if (!Number.isFinite(ms)) return '—';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const STATUS_STYLES: Record<string, string> = {
  verified: 'bg-teal-50 text-teal-700 border-teal-100',
  fulfilled: 'bg-teal-50 text-teal-700 border-teal-100',
  refunded: 'bg-rose-50 text-rose-600 border-rose-100',
  created: 'bg-amber-50 text-amber-700 border-amber-100',
};

const ICONS = {
  revenue: 'M12 3v18m4.5-13.5C16.5 6.12 14.49 5 12 5S7.5 6.12 7.5 7.5 9.51 10 12 10s4.5 1.12 4.5 2.5S14.49 15 12 15s-4.5-1.12-4.5-2.5',
  orders: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z',
  leads: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  visitors: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.5 0 4-2.5 4-9s-1.5-9-4-9-4 2.5-4 9 1.5 9 4 9zM3.5 12h17',
  submissions: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  bugs: 'M12 9v2m0 4h.01M4.75 20h14.5a2.25 2.25 0 001.95-3.38L14.2 4.62a2.25 2.25 0 00-3.9 0L2.8 16.62A2.25 2.25 0 004.75 20z',
  renewals: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  careers: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  accounts: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  chats: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  drafts: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
  refresh: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
} as const;

function Icon({ path, className = 'w-4 h-4' }: { path: string; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

type StatCardProps = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  icon: string;
  tone: string;
  iconTone: string;
};

function StatCard({ label, value, hint, href, icon, tone, iconTone }: StatCardProps) {
  const body = (
    <>
      <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${iconTone}`}>
        <Icon path={icon} />
      </div>
      <div className="mt-3">
        <p className="text-2xl font-black leading-none tracking-tight text-slate-900 tabular-nums">
          {value}
        </p>
        <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
          {label}
        </p>
        {hint && <p className="mt-1 text-xs font-medium text-slate-400">{hint}</p>}
      </div>
    </>
  );

  const className = `group flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-teal-200 hover:shadow-md ${tone}`;

  if (!href) return <div className={className}>{body}</div>;
  return (
    <Link href={href} className={className} aria-label={`${label} — open ${href}`}>
      {body}
    </Link>
  );
}

type GroupItem = {
  label: string;
  value: React.ReactNode;
  hint: string;
  href: string;
  icon: string;
};

function MetricGroup({ title, items }: { title: string; items: GroupItem[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{title}</h2>
        <div className="h-px flex-grow bg-slate-200" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {items.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3.5 transition-all hover:border-teal-200 hover:bg-teal-50/30 hover:shadow-sm"
          >
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500 transition-colors group-hover:bg-teal-50 group-hover:text-teal-700">
              <Icon path={item.icon} />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-black leading-none text-slate-900 tabular-nums">
                {item.value}
              </span>
              <span className="mt-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {item.label}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-400">
                {item.hint}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} aria-hidden="true" />;
}

export default function AdminDashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchData = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [healthRes, statsRes] = await Promise.all([
        fetch('/api/health', { cache: 'no-store' }),
        fetch('/api/admin/stats', { cache: 'no-store' }),
      ]);

      // The health route answers 500 when Mongo is down but still returns JSON, so parse
      // both bodies before deciding. Stats failing is the case worth surfacing loudly.
      const healthData = await healthRes.json().catch(() => null);
      if (healthData) setHealth(healthData);

      if (!statsRes.ok) throw new Error(`Stats request failed (${statsRes.status})`);
      const statsData = await statsRes.json();
      if (statsData?.error) throw new Error(String(statsData.error));
      setStats(statsData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
      setError(err instanceof Error ? err.message : 'Could not load dashboard data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const healthy = health?.status === 'ok';
  const dbConnected = health?.mongodb === 'connected';
  const s = stats;

  const attention = [
    {
      label: 'TSS renewals waiting',
      count: s?.tssPending ?? 0,
      description: 'Renewal requests still in the pending state.',
      href: '/admin/tss-renewals',
    },
    {
      label: 'Orders awaiting payment',
      count: s?.ordersPending ?? 0,
      description: 'Created but not verified or fulfilled.',
      href: '/admin/payments',
    },
    {
      label: 'Bug reports in last 24h',
      count: s?.problemReportsLast24h ?? 0,
      description: 'New issue reports from the public site.',
      href: '/admin/problem-reports',
    },
    {
      label: 'New leads in last 24h',
      count: s?.submissionsLast24h ?? 0,
      description: 'Contact, quote and callback form entries.',
      href: '/admin/submissions',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-700">
            Sarvadnya Infotech
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">Dashboard</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            A live view of leads, payments, visitor activity and content health.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
            role="status"
            aria-live="polite"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                loading ? 'bg-slate-300' : healthy ? 'bg-teal-500' : 'bg-rose-500'
              } ${!loading && healthy ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <span className="text-xs font-bold text-slate-700">
              {loading ? 'Checking system…' : healthy ? 'System operational' : 'System error'}
            </span>
            <span className="hidden h-4 w-px bg-slate-200 sm:block" aria-hidden="true" />
            <span
              className={`hidden text-xs font-bold sm:block ${
                dbConnected ? 'text-teal-700' : 'text-rose-600'
              }`}
            >
              DB {dbConnected ? 'connected' : 'disconnected'}
            </span>
            <span className="hidden h-4 w-px bg-slate-200 md:block" aria-hidden="true" />
            <span className="hidden text-xs font-bold text-slate-500 md:block">
              {health?.version || 'v1.1.390'}
            </span>
          </div>

          <button
            onClick={fetchData}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl bg-[#006569] px-4 py-2.5 text-xs font-bold text-white shadow-sm shadow-teal-900/10 transition-all hover:bg-[#045A57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon path={ICONS.refresh} className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {lastUpdated && (
        <p className="-mt-3 text-right text-[11px] font-medium text-slate-400">
          Last updated {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-rose-100 bg-rose-50 p-4"
        >
          <span className="mt-0.5 text-rose-500">
            <Icon path={ICONS.bugs} />
          </span>
          <div>
            <p className="text-sm font-bold text-rose-900">Dashboard data could not be loaded</p>
            <p className="mt-0.5 text-xs font-medium text-rose-700">{error}</p>
            <p className="mt-1 text-xs text-rose-600">
              Check the database connection, then press Refresh.
            </p>
          </div>
        </div>
      )}

      {health?.mongodb_error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-4">
          <p className="text-sm font-bold text-rose-900">Database connection error</p>
          <p className="mt-1 break-all font-mono text-xs text-rose-700">{health.mongodb_error}</p>
        </div>
      )}

      {/* Headline KPIs */}
      <section aria-label="Key performance indicators">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {loading || !s ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="mt-3 h-6 w-24" />
                <Skeleton className="mt-2 h-3 w-32" />
              </div>
            ))
          ) : (
            <>
              <StatCard
                label="Revenue collected"
                value={formatMoney(s.revenuePaise)}
                hint={`${s.revenueOrders} paid order${s.revenueOrders === 1 ? '' : 's'}`}
                href="/admin/payments/summary"
                icon={ICONS.revenue}
                tone=""
                iconTone="bg-teal-50 text-teal-700"
              />
              <StatCard
                label="Orders"
                value={s.orders}
                hint={`${s.ordersToday} today · ${s.ordersPending} awaiting payment`}
                href="/admin/payments"
                icon={ICONS.orders}
                tone=""
                iconTone="bg-sky-50 text-sky-700"
              />
              <StatCard
                label="New leads (24h)"
                value={s.submissionsLast24h}
                hint={`${s.submissionsLast7d} in the last 7 days`}
                href="/admin/submissions"
                icon={ICONS.leads}
                tone=""
                iconTone="bg-amber-50 text-amber-700"
              />
              <StatCard
                label="Visitors (24h)"
                value={s.visitorsLast24h}
                hint={`${s.visitors} unique visitors all-time`}
                href="/admin/visitors"
                icon={ICONS.visitors}
                tone=""
                iconTone="bg-indigo-50 text-indigo-700"
              />
            </>
          )}
        </div>
      </section>

      {/* Needs attention + system panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2" aria-label="Needs attention">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
              Needs attention
            </h2>
            <div className="h-px flex-grow bg-slate-200" />
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {loading || !s ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {attention.map((item) => (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-bold text-slate-800">{item.label}</span>
                        <span className="block truncate text-xs font-medium text-slate-400">
                          {item.description}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-black tabular-nums ${
                          item.count > 0
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-50 text-slate-400'
                        }`}
                      >
                        {item.count}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section aria-label="System health">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
              System health
            </h2>
            <div className="h-px flex-grow bg-slate-200" />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="font-medium text-slate-500">Service</dt>
                <dd className="font-bold text-slate-800">
                  {loading ? 'Checking…' : healthy ? 'Operational' : 'Error'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-medium text-slate-500">Database</dt>
                <dd className={`font-bold ${dbConnected ? 'text-teal-700' : 'text-rose-600'}`}>
                  {loading ? '…' : dbConnected ? 'Connected' : 'Disconnected'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-medium text-slate-500">Version</dt>
                <dd className="font-bold text-slate-800">{health?.version || '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="font-medium text-slate-500">Last checked</dt>
                <dd className="text-xs font-semibold text-slate-600">
                  {formatDateTime(health?.timestamp)}
                </dd>
              </div>
            </dl>
            <Link
              href="/admin/settings"
              className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-600 transition-colors hover:border-teal-200 hover:text-teal-700"
            >
              Open settings
            </Link>
          </div>
        </section>
      </div>

      {/* Lifetime totals, grouped */}
      <div className="space-y-5">
        <MetricGroup
          title="Leads & Inquiries"
          items={[
            {
              label: 'Contact Submissions',
              value: loading ? '—' : s?.submissions ?? 0,
              hint: `${s?.submissionsLast24h ?? 0} in last 24h`,
              href: '/admin/submissions',
              icon: ICONS.submissions,
            },
            {
              label: 'Bug & Issue Reports',
              value: loading ? '—' : s?.problemReports ?? 0,
              hint: `${s?.problemReportsLast24h ?? 0} in last 24h`,
              href: '/admin/problem-reports',
              icon: ICONS.bugs,
            },
            {
              label: 'TSS Renewals',
              value: loading ? '—' : s?.tssRenewals ?? 0,
              hint: `${s?.tssPending ?? 0} pending`,
              href: '/admin/tss-renewals',
              icon: ICONS.renewals,
            },
            {
              label: 'Job Applications',
              value: loading ? '—' : s?.applications ?? 0,
              hint: `${s?.applicationsLast24h ?? 0} in last 24h`,
              href: '/admin/careers',
              icon: ICONS.careers,
            },
            {
              label: 'Candidate Accounts',
              value: loading ? '—' : s?.accounts ?? 0,
              hint: 'Career sign-ups',
              href: '/admin/careers',
              icon: ICONS.accounts,
            },
          ]}
        />

        <MetricGroup
          title="Engagement"
          items={[
            {
              label: 'Unique Visitors',
              value: loading ? '—' : s?.visitors ?? 0,
              hint: 'Humans, all-time',
              href: '/admin/visitors',
              icon: ICONS.visitors,
            },
            {
              label: 'Visitors (24h)',
              value: loading ? '—' : s?.visitorsLast24h ?? 0,
              hint: 'Active in last 24h',
              href: '/admin/visitors',
              icon: ICONS.visitors,
            },
            {
              label: 'Chat Transcripts',
              value: loading ? '—' : s?.chats ?? 0,
              hint: `${s?.chatsLast24h ?? 0} active in last 24h`,
              href: '/admin/chats',
              icon: ICONS.chats,
            },
            {
              label: 'Form Drafts',
              value: loading ? '—' : s?.drafts ?? 0,
              hint: `${s?.draftsLast24h ?? 0} active in last 24h`,
              href: '/admin/drafts',
              icon: ICONS.drafts,
            },
            {
              label: 'FAQ Entries',
              value: loading ? '—' : s?.faq ?? 0,
              hint: 'On the public site',
              href: '/admin/faq',
              icon: ICONS.submissions,
            },
          ]}
        />

        <MetricGroup
          title="Commerce & Careers"
          items={[
            {
              label: 'Orders',
              value: loading ? '—' : s?.orders ?? 0,
              hint: `${s?.ordersToday ?? 0} placed today`,
              href: '/admin/payments',
              icon: ICONS.orders,
            },
            {
              label: 'Orders Today',
              value: loading ? '—' : s?.ordersToday ?? 0,
              hint: 'Since midnight',
              href: '/admin/payments',
              icon: ICONS.clock,
            },
            {
              label: 'Awaiting Payment',
              value: loading ? '—' : s?.ordersPending ?? 0,
              hint: 'Status “created”',
              href: '/admin/payments',
              icon: ICONS.orders,
            },
            {
              label: 'Paid Orders',
              value: loading ? '—' : s?.revenueOrders ?? 0,
              hint: 'Verified or fulfilled',
              href: '/admin/payments/summary',
              icon: ICONS.revenue,
            },
            {
              label: 'Revenue Collected',
              value: loading ? '—' : formatMoney(s?.revenuePaise ?? 0),
              hint: 'Verified + fulfilled',
              href: '/admin/payments/summary',
              icon: ICONS.revenue,
            },
          ]}
        />
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentPanel
          title="Recent orders"
          href="/admin/payments"
          hrefLabel="Open payments"
          loading={loading}
          empty={!loading && (s?.recentOrders?.length ?? 0) === 0}
          emptyText="No orders yet."
        >
          {(s?.recentOrders ?? []).map((o) => (
            <li
              key={o.orderId || `${o.createdAt}-${o.amountPaise}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-800">
                  {o.customerName || 'Guest customer'}
                </span>
                <span className="block truncate font-mono text-[11px] text-slate-400">
                  {o.orderId || '—'} · {formatRelative(o.createdAt)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-black tabular-nums text-slate-800">
                  {formatMoney(o.amountPaise)}
                </span>
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    STATUS_STYLES[o.status] || 'bg-slate-50 text-slate-500 border-slate-100'
                  }`}
                >
                  {o.status}
                </span>
              </span>
            </li>
          ))}
        </RecentPanel>

        <RecentPanel
          title="Recent leads"
          href="/admin/submissions"
          hrefLabel="Open submissions"
          loading={loading}
          empty={!loading && (s?.recentLeads?.length ?? 0) === 0}
          emptyText="No form submissions yet."
        >
          {(s?.recentLeads ?? []).map((lead, i) => (
            <li
              key={`${lead.email}-${lead.createdAt}-${i}`}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-800">
                  {lead.name || lead.email || 'Anonymous lead'}
                </span>
                <span className="block truncate text-[11px] text-slate-400">
                  {[lead.formType, lead.service].filter(Boolean).join(' · ') || 'General enquiry'}
                </span>
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-slate-400">
                {formatRelative(lead.createdAt)}
              </span>
            </li>
          ))}
        </RecentPanel>
      </div>

      <footer className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
          Quick links
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            { href: '/admin/payments', label: 'Payments' },
            { href: '/admin/visitors', label: 'Visitors' },
            { href: '/admin/chats', label: 'Chats' },
            { href: '/admin/drafts', label: 'Drafts' },
            { href: '/admin/email-config', label: 'Email config' },
            { href: '/admin/settings', label: 'Settings' },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:border-teal-200 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}

function RecentPanel({
  title,
  href,
  hrefLabel,
  loading,
  empty,
  emptyText,
  children,
}: {
  title: string;
  href: string;
  hrefLabel: string;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-black text-slate-800">{title}</h2>
        <Link
          href={href}
          className="text-[11px] font-bold uppercase tracking-widest text-teal-700 transition-colors hover:text-[#045A57]"
        >
          {hrefLabel}
        </Link>
      </div>
      {loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : empty ? (
        <p className="p-6 text-center text-sm font-medium text-slate-400">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-slate-100">{children}</ul>
      )}
    </section>
  );
}

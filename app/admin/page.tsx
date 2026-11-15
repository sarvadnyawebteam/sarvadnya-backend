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
//
// CHANGE: 2026-11-14 — layout rebalanced after owner feedback ("all important stats
// are below, too much scrolling, too many unwanted modules, the weaker stats come
// first"). WHAT:
//   * ONE dense six-tile KPI row is now the first thing on the page (revenue, leads
//     24h, orders today, TSS pending, visitors 24h, chats 24h) — no duplicate numbers.
//   * Recent orders / recent leads move straight below it, so activity is on screen
//     one instead of three.
//   * The three 5-card "lifetime totals" groups (15 tiles, most of them repeats of the
//     headline numbers) collapse into a single compact "Payments & careers" list.
//   * The System-health card is deleted — the header chip already carries service,
//     database and version, and the timestamp moved under the header.
//   * The Quick-links footer is deleted — the sidebar is the navigation.
//   * "Needs attention" lost its per-row description line and only shows items that
//     actually have a count, so it stops being a wall of zeros.
// Net effect: the whole dashboard fits in roughly one desktop screen instead of four.
//
// CHANGE: 2026-11-14 (follow-up) — owner: "i dontt want payment or candidate on top,
// else ensure all stats are smaller on top without scroll on desktop" + "have a last
// updated tag on refresh button". WHAT:
//   * The headline row is no longer four/six big cards. It is a 14-tile MINI grid
//     (value + label, no icon, no hint) in `grid-cols-2 sm:3 md:4 xl:7`, so every
//     non-financial stat is on screen without scrolling on a desktop.
//   * Payments (orders / awaiting / paid / revenue) and careers (applications /
//     candidate accounts) are removed from that row and live in the "Payments &
//     careers" card at the bottom, next to recent leads.
//   * TSS pending, bug reports 24h and leads 24h go amber when non-zero.
//   * The last-updated timestamp is a caption under the Refresh button.

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

// CHANGE: 2026-11-14 (follow-up) — the KPI tiles no longer carry icons, so only the two
// glyphs still in use remain: the Refresh spinner and the error-banner warning.
const ICONS = {
  bugs: 'M12 9v2m0 4h.01M4.75 20h14.5a2.25 2.25 0 001.95-3.38L14.2 4.62a2.25 2.25 0 00-3.9 0L2.8 16.62A2.25 2.25 0 004.75 20z',
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

type StatTileProps = {
  label: string;
  value: React.ReactNode;
  href: string;
  warn?: boolean;
};

// CHANGE: 2026-11-14 (follow-up) — the headline tiles are now MINI tiles: one value and
// one label, no icon, no hint. Fourteen of them fit in two rows on a desktop, so every
// non-financial stat is above the fold instead of half of them being below it. Payment
// and careers numbers were moved out of this row entirely (owner's ask) and live in the
// "Payments & careers" card at the bottom.
function StatTile({ label, value, href, warn }: StatTileProps) {
  return (
    <Link
      href={href}
      title={label}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 transition-colors hover:border-teal-200 hover:bg-teal-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-1"
    >
      <span
        className={`block truncate text-base font-black leading-none tabular-nums ${
          warn ? 'text-amber-700' : 'text-slate-900'
        }`}
      >
        {value}
      </span>
      <span className="mt-1 block truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
    </Link>
  );
}

type MiniItem = {
  label: string;
  value: React.ReactNode;
  hint?: string;
  href: string;
};

// CHANGE: 2026-11-14 — one compact label · value · hint row. Numbers that used to be
// full-width cards now share a single card, in two columns.
function MiniStat({ item }: { item: MiniItem }) {
  return (
    <Link
      href={item.href}
      title={item.hint ? `${item.label} — ${item.hint}` : item.label}
      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-teal-50/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
    >
      <span className="min-w-0 truncate text-xs font-semibold text-slate-600">{item.label}</span>
      <span className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-sm font-black text-slate-900 tabular-nums">{item.value}</span>
        {item.hint && <span className="text-[10px] font-medium text-slate-500">{item.hint}</span>}
      </span>
    </Link>
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

  // CHANGE: 2026-11-14 — only rows that actually have a count are rendered, and the
  // per-row description line is gone. The queue is a short action list now, not a
  // 4-row block of zeros with prose.
  const attention = (
    [
      {
        label: 'TSS renewals waiting',
        count: s?.tssPending ?? 0,
        href: '/admin/tss-renewals',
      },
      {
        label: 'Orders awaiting payment',
        count: s?.ordersPending ?? 0,
        href: '/admin/payments',
      },
      {
        label: 'Bug reports · last 24h',
        count: s?.problemReportsLast24h ?? 0,
        href: '/admin/problem-reports',
      },
      {
        label: 'New leads · last 24h',
        count: s?.submissionsLast24h ?? 0,
        href: '/admin/submissions',
      },
    ] as { label: string; count: number; href: string }[]
  ).filter((item) => item.count > 0);

  // CHANGE: 2026-11-14 (follow-up) — the top grid now carries every non-financial stat,
  // so this card keeps only what the owner asked to keep OFF the headline row:
  // payments and careers. Same compact label · value · hint rows.
  const ready = !loading && !!s;
  const num = (n: number | undefined) => (ready ? n ?? 0 : '—');

  const totals: MiniItem[] = [
    {
      label: 'Orders (total)',
      value: num(s?.orders),
      hint: ready ? `${s?.ordersToday ?? 0} today` : undefined,
      href: '/admin/payments',
    },
    {
      label: 'Awaiting payment',
      value: num(s?.ordersPending),
      href: '/admin/payments',
    },
    {
      label: 'Paid orders',
      value: num(s?.revenueOrders),
      href: '/admin/payments/summary',
    },
    {
      label: 'Revenue collected',
      value: ready ? formatMoney(s?.revenuePaise ?? 0) : '—',
      href: '/admin/payments/summary',
    },
    {
      label: 'Job applications',
      value: num(s?.applications),
      hint: ready ? `${s?.applicationsLast24h ?? 0}/24h` : undefined,
      href: '/admin/careers',
    },
    {
      label: 'Candidate accounts',
      value: num(s?.accounts),
      href: '/admin/careers',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-700">
            Sarvadnya Infotech
          </p>
          <h1 className="text-2xl font-black leading-tight tracking-tight text-slate-900">
            Dashboard
          </h1>
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

          {/* CHANGE: 2026-11-15 — owner: "last refresh time takes refresh button out of
              line". The caption used to be stacked UNDER the button, so that column grew
              taller than the system chip and `items-center` pushed the button up off the
              chip's centre line. It is now INLINE beside the button: the row wrapper keeps
              the timestamp glued to the button (it can never wrap away from it) and adds no
              height, so everything on the header line shares one centre. The caption sits
              BEFORE the button so a changing timestamp grows leftwards and never nudges the
              button. Button padding py-2.5 → py-2 so its height (32 px) matches the chip's.
              The caption stays outside the <button> — not clickable, plain status text. */}
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[10px] font-semibold text-slate-500">
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Not updated yet'}
            </span>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[#006569] px-4 py-2 text-xs font-bold text-white shadow-sm shadow-teal-900/10 transition-all hover:bg-[#045A57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon path={ICONS.refresh} className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

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

      {/* 1 · Every non-financial stat, as mini tiles — two rows on a desktop, so nothing
          important needs a scroll. CHANGE: 2026-11-14 (follow-up) — owner: "i dontt want
          payment or candidate on top, else ensure all stats are smaller on top without
          scroll on desktop". Payments + careers moved to the "Payments & careers" card below. */}
      <section aria-label="All site statistics">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
          {loading || !s ? (
            Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                <Skeleton className="h-4 w-10" />
                <Skeleton className="mt-2 h-2.5 w-16" />
              </div>
            ))
          ) : (
            <>
              <StatTile
                label="Leads · 24h"
                value={s.submissionsLast24h}
                href="/admin/submissions"
                warn={s.submissionsLast24h > 0}
              />
              <StatTile label="Leads · 7d" value={s.submissionsLast7d} href="/admin/submissions" />
              <StatTile label="Submissions" value={s.submissions} href="/admin/submissions" />
              <StatTile
                label="Bug reports · 24h"
                value={s.problemReportsLast24h}
                href="/admin/problem-reports"
                warn={s.problemReportsLast24h > 0}
              />
              <StatTile
                label="Bug reports"
                value={s.problemReports}
                href="/admin/problem-reports"
              />
              <StatTile
                label="TSS pending"
                value={s.tssPending}
                href="/admin/tss-renewals"
                warn={s.tssPending > 0}
              />
              <StatTile label="TSS renewals" value={s.tssRenewals} href="/admin/tss-renewals" />
              <StatTile label="Visitors · 24h" value={s.visitorsLast24h} href="/admin/visitors" />
              <StatTile label="Unique visitors" value={s.visitors} href="/admin/visitors" />
              <StatTile label="Chats · 24h" value={s.chatsLast24h} href="/admin/chats" />
              <StatTile label="Transcripts" value={s.chats} href="/admin/chats" />
              <StatTile label="Drafts · 24h" value={s.draftsLast24h} href="/admin/drafts" />
              <StatTile label="Form drafts" value={s.drafts} href="/admin/drafts" />
              <StatTile label="FAQ entries" value={s.faq} href="/admin/faq" />
            </>
          )}
        </div>
      </section>

      {/* 2 · Recent leads (2/3) + Needs attention (1/3).
          CHANGE: 2026-11-14 — activity moved up from the bottom of a four-screen
          page; the System-health card is gone (the header chip already shows
          service, database and version).
          CHANGE: 2026-11-14 (follow-up) — leads come before orders: the owner does
          not want payment content high on the page, so orders now sit last. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
                className="flex items-center justify-between gap-3 px-3 py-2.5"
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

        <section
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
          aria-label="Needs attention"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
            <h2 className="text-sm font-black text-slate-800">Needs attention</h2>
            {attention.length > 0 && (
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-black tabular-nums text-amber-700">
                {attention.length}
              </span>
            )}
          </div>
          {loading || !s ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </div>
          ) : attention.length === 0 ? (
            <p className="px-3 py-4 text-xs font-semibold text-slate-500">
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400"
                  >
                    <span className="min-w-0 truncate text-xs font-bold text-slate-700">
                      {item.label}
                    </span>
                    <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-black tabular-nums text-amber-700">
                      {item.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* 3 · Recent orders (2/3) + payments & careers (1/3) — the numbers the owner asked
          to keep OFF the headline row, deliberately LAST on the page.
          CHANGE: 2026-11-14 — this replaces the three 5-card "lifetime totals" groups
          (15 tiles, several repeating the headline KPIs). The Quick-links footer is
          gone as well — the sidebar is the navigation. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
                className="flex items-center justify-between gap-3 px-3 py-2.5"
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
        </div>

        <section
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
          aria-label="Payments and careers"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
            <h2 className="text-sm font-black text-slate-800">Payments &amp; careers</h2>
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Below the stats
            </span>
          </div>
          <div className="grid grid-cols-1 gap-x-4 p-1.5 sm:grid-cols-2">
            {totals.map((item) => (
              <MiniStat key={item.label} item={item} />
            ))}
          </div>
        </section>
      </div>
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

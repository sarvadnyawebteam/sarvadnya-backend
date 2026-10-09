'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

type HealthStatus = {
  status: string;
  mongodb: string;
  timestamp: string;
  version: string;
  mongodb_error?: string;
};

type AdminStats = {
  submissions: number;
  problemReports: number;
  tssRenewals: number;
  applications: number;
  modules: number;
  learning: number;
  reviews: number;
  news: number;
  partners: number;
  faq: number;
  visitors: number;
  visitorsToday: number;
  // CHANGE: 2026-10-07 — owner follow-up (dashboard KPIs): commerce + careers
  // metrics added (see "Commerce & Careers" group below).
  orders: number;
  ordersToday: number;
  accounts: number;
  // CHANGE: 2026-10-09 — chat transcripts + form drafts (owner: show all metrics).
  chats: number;
  drafts: number;
};

export default function AdminDashboard() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    setRefreshing(true);
    try {
      const [healthRes, statsRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/admin/stats')
      ]);
      
      const healthData = await healthRes.json();
      const statsData = await statsRes.json();
      
      setHealth(healthData);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const statGroups = [
    {
      title: 'Leads & Inquiries',
      items: [
        { label: 'Contact Submissions', desc: 'Customer inquiries and general messages', value: stats?.submissions || 0, href: '/admin/submissions', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', color: 'bg-teal-50 text-teal-600' },
        { label: 'Bug & Issue Reports', desc: 'Reported problems and technical issues', value: stats?.problemReports || 0, href: '/admin/problem-reports', icon: 'M12 9v2m0 4h.01M4.75 20h14.5a2.25 2.25 0 001.95-3.38L14.2 4.62a2.25 2.25 0 00-3.9 0L2.8 16.62A2.25 2.25 0 004.75 20z', color: 'bg-amber-50 text-amber-600' },
        { label: 'TSS Renewals', desc: 'TSS renewal requests with serial numbers', value: stats?.tssRenewals || 0, href: '/admin/tss-renewals', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', color: 'bg-cyan-50 text-cyan-600' },
        { label: 'Job Applications', desc: 'Candidate applications for open positions', value: stats?.applications || 0, href: '/admin/careers', icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', color: 'bg-blue-50 text-blue-600' },
        { label: 'Site Visitors', desc: 'Tracked browsing sessions (passive identification)', value: stats?.visitors || 0, href: '/admin/visitors', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.5 0 4-2.5 4-9s-1.5-9-4-9-4 2.5-4 9 1.5 9 4 9zM3.5 12h17', color: 'bg-cyan-50 text-cyan-600' },
        // CHANGE: 2026-10-09 — visitorsToday was fetched but never shown (owner: show all metrics).
        { label: 'Visitors Today', desc: 'New browsing sessions since midnight', value: stats?.visitorsToday || 0, href: '/admin/visitors', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', color: 'bg-sky-50 text-sky-600' },
      ]
    },
    {
      title: 'Content & Knowledge Base',
      items: [
        { label: 'Tally Modules', desc: 'Product modules and solution pages', value: stats?.modules || 0, href: '/admin/modules', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z', color: 'bg-purple-50 text-purple-600' },
        { label: 'Learning Articles', desc: 'Tutorials, guides and knowledge base', value: stats?.learning || 0, href: '/admin/learning', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5s3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', color: 'bg-orange-50 text-orange-600' },
        { label: 'News & Updates', desc: 'Published articles and announcements', value: stats?.news || 0, href: '/admin/news', icon: 'M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z', color: 'bg-rose-50 text-rose-600' },
        { label: 'FAQ Entries', desc: 'Frequently asked questions by visitors', value: stats?.faq || 0, href: '/admin/faq', icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: 'bg-teal-50 text-teal-600' },
      ]
    },
    {
      // CHANGE: 2026-10-09 — owner: recorded chat history + form drafts must be visible.
      title: 'Chats & Drafts',
      items: [
        { label: 'Chat Transcripts', desc: 'Ask Sara conversations captured from the site', value: stats?.chats || 0, href: '/admin/chats', icon: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z', color: 'bg-teal-50 text-teal-600' },
        { label: 'Form Drafts', desc: 'Form fills that were never submitted', value: stats?.drafts || 0, href: '/admin/drafts', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'bg-amber-50 text-amber-600' },
      ]
    },
    {
      title: 'Commerce & Careers',
      items: [
        { label: 'Orders', desc: 'Checkout orders processed (test-mode gateway)', value: stats?.orders || 0, href: '/admin/payments', icon: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z', color: 'bg-teal-50 text-teal-600' },
        { label: 'Orders Today', desc: 'Orders created since midnight', value: stats?.ordersToday || 0, href: '/admin/payments', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z', color: 'bg-cyan-50 text-cyan-600' },
        { label: 'Candidate Accounts', desc: 'Career sign-ups + manually created', value: stats?.accounts || 0, href: '/admin/careers', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z', color: 'bg-blue-50 text-blue-600' },
      ]
    },
    {
      title: 'Trust & Partnerships',
      items: [
        { label: 'Customer Reviews', desc: 'Verified ratings and client testimonials', value: stats?.reviews || 0, href: '/admin/reviews', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.518 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.54 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.784.57-1.838-.197-1.539-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z', color: 'bg-yellow-50 text-yellow-600' },
        { label: 'Partner Assets', desc: 'Logos, brand materials and partners', value: stats?.partners || 0, href: '/admin/partners', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z', color: 'bg-indigo-50 text-indigo-600' },
      ]
    }
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-5">
        <div>
          <h1 className="text-3xl font-black text-[#0f172a]">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Real-time overview of your business infrastructure and content.</p>
        </div>
        
        {/* CHANGE: 2026-10-09 — owner: remake the header controls; the refresh control was
            a tiny icon and is now a proper labelled button. Health panel wraps on mobile. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white px-5 py-3.5 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">System</span>
              <div className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-teal-500' : 'bg-red-500'} animate-pulse`}></div>
              <span className="text-sm font-bold text-slate-700">{loading ? 'Checking...' : health?.status === 'ok' ? 'Operational' : 'Error'}</span>
            </div>
            <div className="hidden sm:block h-6 w-px bg-slate-100"></div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Database</span>
              <span className={`text-sm font-bold ${health?.mongodb === 'connected' ? 'text-teal-600' : 'text-red-600'}`}>
                {loading ? '...' : health?.mongodb === 'connected' ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="hidden sm:block h-6 w-px bg-slate-100"></div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Version</span>
              <span className="text-sm font-bold text-[#006569]">{health?.version || 'v1.1.390'}</span>
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={refreshing}
            aria-label="Refresh dashboard data"
            className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#006569] text-white text-sm font-bold shadow-sm shadow-teal-900/10 hover:bg-[#045A57] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            <svg className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
              <path d="M21 3v5h-5"></path>
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="space-y-8">
        {statGroups.map((group, gIdx) => (
          <section key={gIdx}>
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{group.title}</h2>
              <div className="h-px flex-grow bg-slate-100"></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* CHANGE: 2026-10-09 — owner: remake the metric cards. Larger icon tile,
                  prominent value, full (non-truncated) label/description, clearer hover. */}
              {group.items.map((item, iIdx) => (
                <Link
                  key={iIdx}
                  href={item.href}
                  className="group relative overflow-hidden bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 hover:border-teal-100 transition-all"
                >
                  <div className={`absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-[0.07] transition-transform duration-500 group-hover:scale-150 ${item.color.split(' ')[0]}`}></div>

                  <div className="relative z-10 flex items-start justify-between">
                    <div className={`p-3 rounded-2xl shadow-sm ${item.color}`}>
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d={item.icon} />
                      </svg>
                    </div>
                    <svg className="w-4 h-4 text-slate-300 group-hover:text-[#006569] group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>

                  <p className="relative z-10 mt-4 text-3xl font-black text-[#0f172a] leading-none tabular-nums">
                    {loading ? <span className="text-slate-300">—</span> : item.value}
                  </p>
                  <p className="relative z-10 mt-2 text-sm font-bold text-slate-700">{item.label}</p>
                  <p className="relative z-10 mt-1 text-xs text-slate-400 leading-snug">{item.desc}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {health?.mongodb_error && (
        <div className="mt-10 p-5 bg-red-50 rounded-2xl border border-red-100 flex items-start gap-4">
          <div className="p-2 bg-red-100 text-red-600 rounded-xl">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="text-red-900 font-bold mb-1">Database Connection Error</h3>
            <p className="text-xs text-red-600 font-mono break-all">{health.mongodb_error}</p>
          </div>
        </div>
      )}
    </div>
  );
}


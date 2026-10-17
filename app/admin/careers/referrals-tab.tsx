'use client';

import React, { useCallback, useEffect, useState } from 'react';

// CHANGE: 2026-10-16 — careers referral system: read-only reporting tab.
// WHY: accounts that signed up through a referral link / code must be visible to the team in
// the SAME Careers section. Reads /api/admin/careers/referrals (auth = the middleware guard).
// No writes here — referral attribution is fixed at signup and is never edited from the panel.

type ReferralRow = {
  _id: string;
  email: string | null;
  fullName: string | null;
  code: string;
  referrerName: string | null;
  referrerEmail: string | null;
  referredAt: string | null;
};

type ReferrerSummary = {
  code: string;
  count: number;
  referrerName: string | null;
  referrerEmail: string | null;
};

type ReferralResponse = {
  rows: ReferralRow[];
  summary: ReferrerSummary[];
  totals: { referredAccounts: number; referrers: number; codesAssigned: number };
  filtered: boolean;
};

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString();
}

export default function ReferralsTab() {
  const [data, setData] = useState<ReferralResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  const fetchReferrals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/careers/referrals${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || 'Failed to load referrals');
      setData(json as ReferralResponse);
      setError('');
    } catch (err: any) {
      console.error('Error fetching referrals:', err);
      setError(err.message || 'Failed to load referrals.');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(fetchReferrals, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, fetchReferrals]);

  const totals = data?.totals;
  const rows = data?.rows ?? [];
  const summary = data?.summary ?? [];

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          placeholder="Search by code, name or email…"
          className="w-full max-w-md p-4 bg-white rounded-2xl border border-slate-100 shadow-sm focus:ring-2 focus:ring-[#006569] focus:outline-none"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">
          {error}
        </div>
      )}

      {/* Totals */}
      <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Referred Accounts', value: totals?.referredAccounts, hint: 'Candidates who signed up with a code' },
          { label: 'Referrers', value: totals?.referrers, hint: 'Codes that have referred at least one account' },
          { label: 'Codes Assigned', value: totals?.codesAssigned, hint: 'Accounts that own a referral code' },
        ].map((card) => (
          <div key={card.label} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <div className="text-3xl font-black text-[#006569] tabular-nums">
              {loading ? '…' : (card.value ?? 0)}
            </div>
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">{card.label}</div>
            <div className="text-[11px] text-slate-400 mt-1">{card.hint}</div>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <div className="mb-8">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-3">Top Referrers</h2>
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Referrer</th>
                  <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                  <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Referrals</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={3} className="text-center py-10 text-slate-400">Loading…</td></tr>
                ) : summary.length > 0 ? (
                  summary.map((s) => (
                    <tr key={s.code} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                      <td className="p-4">
                        <div className="text-sm font-bold text-[#0f172a]">
                          {s.referrerName || <span className="text-slate-400">(deleted account)</span>}
                        </div>
                        <div className="text-[10px] text-slate-400">{s.referrerEmail || '—'}</div>
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-sm font-black tracking-widest text-[#006569]">{s.code}</span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="inline-flex min-w-8 justify-center rounded-full bg-teal-50 px-2 py-1 text-sm font-black text-[#006569] tabular-nums">
                          {s.count}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="text-center py-12 text-slate-400">
                      No referrals yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Referred accounts */}
      <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-3">
        Referred Accounts {data?.filtered ? '(filtered)' : ''}
      </h2>
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Candidate</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Referral Code</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Referred By</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="text-center py-10 text-slate-400">Loading…</td></tr>
              ) : rows.length > 0 ? (
                rows.map((r) => (
                  <tr key={r._id} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                    <td className="p-4">
                      <div className="text-sm font-bold text-[#0f172a]">
                        {r.fullName || <span className="text-slate-400">—</span>}
                      </div>
                      <div className="text-[10px] text-slate-400">{r.email || '—'}</div>
                    </td>
                    <td className="p-4">
                      <span className="font-mono text-sm font-black tracking-widest text-[#006569]">{r.code}</span>
                    </td>
                    <td className="p-4">
                      <div className="text-sm font-medium text-slate-600">
                        {r.referrerName || <span className="text-slate-400">(deleted account)</span>}
                      </div>
                      <div className="text-[10px] text-slate-400">{r.referrerEmail || '—'}</div>
                    </td>
                    <td className="p-4 text-xs font-bold text-slate-500">{fmtDate(r.referredAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="text-center py-20 text-slate-400">
                    {q ? 'No referred accounts match that search.' : 'No accounts have used a referral code yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

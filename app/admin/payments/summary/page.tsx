'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import PaymentsTabs from '../tabs';
import { ORDER_STATUSES } from '@/lib/order-status';

// CHANGE: 2026-10-03 — SP-3 payments SUMMARY: totals over the filtered order set,
// with print/Save-as-PDF (scoped like the receipt) and an XLSX export of the same
// rows. Read-only; status changes live on the ledger page.

type OrderItem = {
  slug: string;
  name: string;
  qty: number;
  unitPaise: number;
  totalPaise: number;
};

type OrderLedgerItem = {
  _id: string;
  orderId: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  amountPaise: number;
  currency?: string;
  items?: OrderItem[];
  subtotalPaise?: number;
  gstPaise?: number;
  discountPaise?: number;
  customer: { name: string; email: string; phone: string; company?: string } | null;
  tssSerials?: Record<string, string>;
  status: string;
  testMode?: boolean;
  createdAt: string;
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

function formatRupees(paise: number): string {
  return inr.format(Number.isFinite(paise) ? paise / 100 : 0);
}

export default function AdminPaymentsSummary() {
  const [rows, setRows] = useState<OrderLedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Filter bar state — same shape as the ledger page so switching tabs keeps the
  // mental model (filters are NOT shared; each page fetches with its own).
  const [fStatus, setFStatus] = useState('all');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fQ, setFQ] = useState('');
  const [applied, setApplied] = useState<{ status: string; from: string; to: string; q: string }>({
    status: 'all', from: '', to: '', q: '',
  });

  const buildParams = useCallback((extra: string[][] = []) => {
    const params = new URLSearchParams(extra);
    if (applied.status !== 'all') params.set('status', applied.status);
    if (applied.from) params.set('from', `${applied.from}T00:00:00.000`);
    if (applied.to) params.set('to', `${applied.to}T23:59:59.999`);
    if (applied.q.trim()) params.set('q', applied.q.trim());
    return params;
  }, [applied]);

  // Totals need ALL filtered rows, not a page — export=1 (route caps at 5000).
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payments?${buildParams([['export', '1']]).toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      if (Array.isArray(data.items)) setRows(data.items);
    } catch (err) {
      console.error('Error fetching payments summary:', err);
      setError(err instanceof Error ? err.message : 'Failed to load payment totals.');
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const applyFilters = () => {
    setApplied({ status: fStatus, from: fFrom, to: fTo, q: fQ });
  };

  const resetFilters = () => {
    setFStatus('all');
    setFFrom('');
    setFTo('');
    setFQ('');
    setApplied({ status: 'all', from: '', to: '', q: '' });
  };

  const totals = useMemo(() => {
    let amount = 0;
    let gst = 0;
    let discount = 0;
    for (const o of rows) {
      if (Number.isFinite(o.amountPaise)) amount += o.amountPaise;
      if (Number.isFinite(o.gstPaise)) gst += o.gstPaise ?? 0;
      if (Number.isFinite(o.discountPaise)) discount += o.discountPaise ?? 0;
    }
    return {
      count: rows.length,
      amount,
      gst,
      discount,
      average: rows.length > 0 ? Math.round(amount / rows.length) : 0,
    };
  }, [rows]);

  // CHANGE: 2026-10-03 — same client-side XLSX as the ledger page.
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/admin/payments?${buildParams([['export', '1']]).toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');
      const list: OrderLedgerItem[] = Array.isArray(data.items) ? data.items : [];

      const sheetRows = list.map((o) => ({
        Date: o.createdAt ? new Date(o.createdAt).toLocaleString() : '',
        'Order ID': o.orderId || '',
        'Razorpay Order ID': o.razorpayOrderId || '',
        'Razorpay Payment ID': o.razorpayPaymentId || '',
        Name: o.customer?.name || '',
        Email: o.customer?.email || '',
        Phone: o.customer?.phone || '',
        Company: o.customer?.company || '',
        Items: (o.items ?? []).map((i) => `${i.name} × ${i.qty}`).join('; ') || '',
        'Amount (INR)': Number((o.amountPaise / 100).toFixed(2)),
        'GST (INR)': Number(((o.gstPaise ?? 0) / 100).toFixed(2)),
        Status: o.status || '',
      }));

      const ws = XLSX.utils.json_to_sheet(sheetRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Payments');
      XLSX.writeFile(wb, `payments_summary_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="relative">
      <PaymentsTabs active="summary" />

      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#006569] mb-2">Payments</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Order Summary</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Totals over the filtered order set. Print or export the same rows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            disabled={exporting}
            className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#006569] transition-all hover:border-[#006569] disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export XLSX'}
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-full bg-[#006569] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:shadow-lg hover:shadow-teal-900/15"
          >
            Print / Save PDF
          </button>
        </div>
      </header>

      {/* Filter bar — same fields as the ledger */}
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-5">
        <div>
          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">Status</label>
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-[#006569]"
          >
            <option value="all">All</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">From</label>
          <input
            type="date"
            value={fFrom}
            onChange={(e) => setFFrom(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-[#006569]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">To</label>
          <input
            type="date"
            value={fTo}
            onChange={(e) => setFTo(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-[#006569]"
          />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">Search</label>
          <input
            type="text"
            value={fQ}
            onChange={(e) => setFQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
            placeholder="Order id / name / email / phone"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-300 focus:border-[#006569]"
          />
        </div>
        <div className="col-span-2 flex items-end gap-2 md:col-span-1">
          <button
            onClick={applyFilters}
            className="flex-1 rounded-lg bg-[#006569] px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:shadow-lg hover:shadow-teal-900/15"
          >
            Apply
          </button>
          <button
            onClick={resetFilters}
            className="rounded-lg border border-slate-200 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-slate-700"
          >
            Reset
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
          {error}
        </div>
      )}

      {/* Scoped-print wrapper: mirrors the public receipt's trick — on print, EVERYTHING
          outside this block is display:none, so the PDF is a clean totals card. The
          :has() rule requires a modern engine (desktop admin panel fine); old engines
          drop the rule and print the page as-is. */}
      <style>{`
        @media print {
          body *:not(.payments-summary-print):not(.payments-summary-print *):not(:has(.payments-summary-print)) {
            display: none !important;
          }
        }
      `}</style>

      <div className="payments-summary-print">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-medium text-slate-400">
            Loading totals…
          </div>
        ) : (
          <>
            {/* Totals cards */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Orders</p>
                <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-slate-900">{totals.count}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total Collected</p>
                <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-[#006569]">{formatRupees(totals.amount)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">GST Collected</p>
                <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-slate-800">{formatRupees(totals.gst)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Average Order</p>
                <p className="mt-2 text-3xl font-black tabular-nums tracking-tight text-slate-800">{formatRupees(totals.average)}</p>
              </div>
            </div>

            {totals.discount > 0 && (
              <p className="mt-3 text-sm font-semibold text-slate-500">
                Total discounts applied: <span className="text-[#006569]">{formatRupees(totals.discount)}</span>
              </p>
            )}

            {/* Filtered rows (the print/PDF body) */}
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="p-3">Date</th>
                      <th className="p-3">Order</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">Items</th>
                      <th className="p-3 text-right">Amount</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={6} className="p-8 text-center text-sm font-medium text-slate-400">No orders match the current filters.</td></tr>
                    ) : (
                      rows.map((o) => (
                        <tr key={o._id} className="border-b border-slate-50">
                          <td className="whitespace-nowrap p-3 text-xs font-semibold text-slate-600">
                            {new Date(o.createdAt).toLocaleDateString()}
                          </td>
                          <td className="p-3 font-mono text-[11px] font-semibold text-slate-700">{o.orderId || '—'}</td>
                          <td className="max-w-[220px] p-3">
                            <p className="truncate font-semibold text-slate-700">{o.customer?.name || '—'}</p>
                            <p className="truncate text-[11px] font-medium text-slate-400">{o.customer?.email || ''}</p>
                          </td>
                          <td className="max-w-[220px] p-3">
                            <p className="truncate text-xs font-semibold text-slate-600">
                              {(o.items ?? []).map((i) => `${i.name} × ${i.qty}`).join(', ') || '—'}
                            </p>
                          </td>
                          <td className="whitespace-nowrap p-3 text-right font-bold tabular-nums text-slate-800">{formatRupees(o.amountPaise)}</td>
                          <td className="p-3 text-[10px] font-black uppercase tracking-widest text-slate-500">{o.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
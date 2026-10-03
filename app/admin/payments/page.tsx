'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import PaymentsTabs from './tabs';
// CHANGE: 2026-10-03 — SP-3 payments: the order status vocabulary + timeline come
// from the shared pure module, so the UI and the API can never disagree (the same
// rule nested AGENTS §10 applies to TSS renewals).
import { ORDER_STATUSES } from '@/lib/order-status';
import { buildTimeline, type StatusEvent } from '@/lib/status-history';

// CHANGE: 2026-10-03 — SP-3 payments ledger. Read-only list of the shared `orders`
// collection with filters + pagination + XLSX export, plus a detail modal whose
// ONLY write surface is status + note (refunded/fulfilled). No delete, no buyer
// editing — per the owner's reframing.

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
  statusHistory?: StatusEvent[];
  testMode?: boolean;
  createdAt: string;
  updatedAt?: string;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const PAGE_SIZES = [10, 25, 50];
const MAX_VISIBLE_PAGES = 5;
// The panel can only move an order to the two terminal statuses — the flow-side
// hops (created/verified) are written by the public repo's checkout routes.
const ADMIN_CHANGEABLE: readonly string[] = ['refunded', 'fulfilled'];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

function formatAmount(paise: number | undefined): string {
  if (typeof paise !== 'number' || !Number.isFinite(paise)) return '—';
  return inr.format(paise / 100);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString();
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// CHANGE: 2026-10-03 — copied from submissions/page.tsx (same pagination UI).
function getPageNumbers(current: number, totalPages: number): (number | 'ellipsis-start' | 'ellipsis-end')[] {
  if (totalPages <= MAX_VISIBLE_PAGES) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const pages: (number | 'ellipsis-start' | 'ellipsis-end')[] = [1];
  let start = Math.max(2, current - 1);
  let end = Math.min(totalPages - 1, current + 1);
  if (start > 2) pages.push('ellipsis-start');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages - 1) pages.push('ellipsis-end');
  pages.push(totalPages);
  return pages;
}

function statusBadge(status: string) {
  switch (status) {
    case 'verified': return 'bg-blue-50 text-blue-600 border-blue-100';
    case 'refunded': return 'bg-rose-50 text-rose-600 border-rose-100';
    case 'fulfilled': return 'bg-teal-50 text-teal-600 border-teal-100';
    default: return 'bg-amber-50 text-amber-600 border-amber-100';
  }
}

export default function AdminPaymentsLedger() {
  const [items, setItems] = useState<OrderLedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 25, total: 0, totalPages: 1 });

  // Filter bar state — same shape reused by the summary page (Task 11).
  const [fStatus, setFStatus] = useState('all');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fQ, setFQ] = useState('');
  const [applied, setApplied] = useState<{ status: string; from: string; to: string; q: string }>({
    status: 'all', from: '', to: '', q: '',
  });

  const [selected, setSelected] = useState<OrderLedgerItem | null>(null);
  const [newStatus, setNewStatus] = useState('refunded');
  const [note, setNote] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.limit),
      });
      if (applied.status !== 'all') params.set('status', applied.status);
      if (applied.from) params.set('from', `${applied.from}T00:00:00.000`);
      if (applied.to) params.set('to', `${applied.to}T23:59:59.999`);
      if (applied.q.trim()) params.set('q', applied.q.trim());

      const res = await fetch(`/api/admin/payments?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      if (Array.isArray(data.items)) setItems(data.items);
      setPagination((prev) => ({
        page: data.page ?? prev.page,
        limit: prev.limit,
        total: data.total ?? 0,
        totalPages: data.totalPages ?? 1,
      }));
    } catch (err) {
      console.error('Error fetching payments:', err);
      setError(err instanceof Error ? err.message : 'Failed to load payments.');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, applied]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const applyFilters = () => {
    setApplied({ status: fStatus, from: fFrom, to: fTo, q: fQ });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const resetFilters = () => {
    setFStatus('all');
    setFFrom('');
    setFTo('');
    setFQ('');
    setApplied({ status: 'all', from: '', to: '', q: '' });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const goToPage = (page: number) => {
    setPagination((prev) => ({ ...prev, page: Math.min(Math.max(1, page), prev.totalPages) }));
  };

  const changeLimit = (limit: number) => {
    setPagination({ page: 1, limit, total: pagination.total, totalPages: 1 });
  };

  // CHANGE: 2026-10-03 — same no-op guard as TSS renewals (SP-2 duplicate-event
  // bug): clicking the CURRENT status must not fire a request that would append a
  // duplicate audit event. Buttons are also disabled while a request is in flight.
  const handleStatusSave = async () => {
    if (!selected || selected.status === newStatus || savingStatus) return;
    setSavingStatus(true);
    setStatusError(null);
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected._id, status: newStatus, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not update status (HTTP ${res.status})`);

      const updated = body.order;
      // Reconcile list + modal against the server's post-write doc (single source).
      setItems((prev) => prev.map((o) => (o._id === selected._id ? { ...o, ...updated } : o)));
      if (selected?._id) {
        setSelected((prev) => (prev ? { ...prev, ...updated } : null));
      }
      setNote('');
    } catch (err) {
      console.error('Error updating status:', err);
      setStatusError(err instanceof Error ? err.message : 'Network error — status was not updated.');
    } finally {
      setSavingStatus(false);
    }
  };

  const openDetail = (o: OrderLedgerItem) => {
    setSelected(o);
    setNewStatus(ADMIN_CHANGEABLE.includes(o.status) ? o.status : 'refunded');
    setNote('');
    setStatusError(null);
  };

  const closeDetail = () => {
    setSelected(null);
    setNote('');
    setStatusError(null);
  };

  const serialsFor = (o: OrderLedgerItem): string[] => {
    if (!o.tssSerials) return [];
    // tssSerials is a { slug: serial } map populated only for TSS lines at checkout.
    return Object.values(o.tssSerials).filter(Boolean);
  };

  const itemCount = (o: OrderLedgerItem): number =>
    (o.items ?? []).reduce((n, i) => n + i.qty, 0);

  const firstItem = (o: OrderLedgerItem): string => {
    const it = o.items ?? [];
    return it.length > 0 ? `${it[0].name}${it.length > 1 ? ` +${it.length - 1} more` : ''}` : '—';
  };

  // CHANGE: 2026-10-03 — client-side XLSX per the submissions pattern: one GET with
  // export=1 (ignores pagination), then SheetJS builds the workbook. Amounts are
  // paise on the wire → rupees in the sheet.
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ export: '1' });
      if (applied.status !== 'all') params.set('status', applied.status);
      if (applied.from) params.set('from', `${applied.from}T00:00:00.000`);
      if (applied.to) params.set('to', `${applied.to}T23:59:59.999`);
      if (applied.q.trim()) params.set('q', applied.q.trim());

      const res = await fetch(`/api/admin/payments?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');

      const rows = (data.items || []).map((o: OrderLedgerItem) => ({
        Date: o.createdAt ? new Date(o.createdAt).toLocaleString() : '',
        'Order ID': o.orderId || '',
        'Razorpay Order ID': o.razorpayOrderId || '',
        'Razorpay Payment ID': o.razorpayPaymentId || '',
        Name: o.customer?.name || '',
        Email: o.customer?.email || '',
        Phone: o.customer?.phone || '',
        Company: o.customer?.company || '',
        'Items': (o.items ?? []).map((i) => `${i.name} × ${i.qty}`).join('; ') || '',
        'Item Count': itemCount(o),
        'TSS Serials': serialsFor(o).join(', '),
        'Amount (INR)': Number((o.amountPaise / 100).toFixed(2)),
        'GST (INR)': Number(((o.gstPaise ?? 0) / 100).toFixed(2)),
        Status: o.status || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Payments');
      XLSX.writeFile(wb, `payments_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const from = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const to = Math.min(pagination.page * pagination.limit, pagination.total);

  return (
    <div className="relative">
      <PaymentsTabs active="ledger" />

      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#006569] mb-2">Payments</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Order Ledger</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Read-only ledger of checkout orders. Status + note are the only editable fields.
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
            onClick={fetchData}
            className="rounded-full bg-[#006569] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:shadow-lg hover:shadow-teal-900/15"
          >
            Refresh
          </button>
        </div>
      </header>

      {/* Filter bar */}
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

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="p-3">Created</th>
                <th className="p-3">Order</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Items</th>
                <th className="p-3">TSS Serial(s)</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-sm font-medium text-slate-400">Loading orders…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-sm font-medium text-slate-400">No orders match the current filters.</td></tr>
              ) : (
                items.map((o) => (
                  <tr
                    key={o._id}
                    onClick={() => openDetail(o)}
                    className="cursor-pointer border-b border-slate-50 transition-colors hover:bg-teal-50/40"
                  >
                    <td className="whitespace-nowrap p-3">
                      <p className="font-semibold text-slate-700">{formatDate(o.createdAt)}</p>
                      <p className="text-[10px] font-medium text-slate-400">{formatTime(o.createdAt)}</p>
                    </td>
                    <td className="p-3">
                      <p className="font-mono text-[11px] font-semibold text-slate-700">{o.orderId || '—'}</p>
                      {o.testMode && (
                        <span className="mt-1 inline-flex rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-600">
                          Test
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] p-3">
                      <p className="truncate font-semibold text-slate-700">{o.customer?.name || '—'}</p>
                      <p className="truncate text-[11px] font-medium text-slate-400">{o.customer?.email || ''}</p>
                      <p className="truncate text-[11px] font-medium text-slate-400">{o.customer?.phone || ''}{o.customer?.company ? ` · ${o.customer.company}` : ''}</p>
                    </td>
                    <td className="max-w-[220px] p-3">
                      <p className="truncate font-semibold text-slate-700">{firstItem(o)}</p>
                      <p className="text-[11px] font-medium text-slate-400">{itemCount(o)} item(s)</p>
                    </td>
                    <td className="max-w-[180px] p-3">
                      <p className="truncate font-mono text-[11px] font-semibold text-[#006569]">
                        {serialsFor(o).join(', ') || '—'}
                      </p>
                    </td>
                    <td className="whitespace-nowrap p-3 text-right font-bold tabular-nums text-slate-800">
                      {formatAmount(o.amountPaise)}
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusBadge(o.status)}`}>
                        {o.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination — copied from submissions/page.tsx */}
        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 p-4 md:flex-row md:items-center md:justify-between">
          <p className="text-xs font-medium text-slate-500">
            Showing {from}–{to} of {pagination.total} order(s)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pagination.limit}
              onChange={(e) => changeLimit(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600 outline-none focus:border-[#006569]"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>{s} per page</option>
              ))}
            </select>
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#006569] disabled:opacity-40"
              >
                ‹
              </button>
              {getPageNumbers(pagination.page, pagination.totalPages).map((p, i) =>
                p === 'ellipsis-start' || p === 'ellipsis-end' ? (
                  <span key={`${p}-${i}`} className="px-1 text-xs font-bold text-slate-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => goToPage(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                      p === pagination.page ? 'bg-[#006569] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-[#006569]'
                    }`}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() => goToPage(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-[#006569] disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={closeDetail}>
          <div
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 p-5 sm:p-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#006569]">Order Detail</p>
                <h2 className="mt-1 font-mono text-lg font-black tracking-tight text-slate-900">{selected.orderId}</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {formatDate(selected.createdAt)} at {formatTime(selected.createdAt)}
                  {selected.testMode ? ' · TEST MODE' : ''}
                </p>
              </div>
              <button onClick={closeDetail} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600" aria-label="Close">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
              {/* Buyer */}
              <div>
                <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Buyer</p>
                {selected.customer ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 text-sm">
                    <p className="font-bold text-slate-800">{selected.customer.name}</p>
                    <p className="font-medium text-slate-500">{selected.customer.email}</p>
                    <p className="font-medium text-slate-500">{selected.customer.phone}</p>
                    {selected.customer.company && <p className="font-medium text-slate-500">{selected.customer.company}</p>}
                  </div>
                ) : (
                  <p className="text-sm font-medium italic text-slate-400">No buyer details captured (pre-SP-3 order).</p>
                )}
              </div>

              {/* Items + serials */}
              <div>
                <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Items</p>
                <div className="space-y-2">
                  {(selected.items ?? []).map((it) => (
                    <div key={it.slug} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-800">{it.name}</p>
                        <p className="text-[11px] font-medium text-slate-400">
                          {it.slug} · qty {it.qty} · {formatAmount(it.unitPaise)} each
                          {selected.tssSerials?.[it.slug]
                            ? ` · Serial: ${selected.tssSerials[it.slug]}`
                            : ''}
                        </p>
                      </div>
                      <p className="shrink-0 font-bold tabular-nums text-slate-800">{formatAmount(it.totalPaise)}</p>
                    </div>
                  ))}
                  {(!selected.items || selected.items.length === 0) && (
                    <p className="text-sm font-medium italic text-slate-400">No items on record.</p>
                  )}
                </div>
                <div className="mt-3 space-y-1 rounded-xl bg-slate-50/60 px-4 py-3 text-sm">
                  <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="font-semibold tabular-nums">{formatAmount(selected.subtotalPaise)}</span></div>
                  <div className="flex justify-between text-slate-500"><span>GST</span><span className="font-semibold tabular-nums">{formatAmount(selected.gstPaise)}</span></div>
                  {typeof selected.discountPaise === 'number' && selected.discountPaise > 0 && (
                    <div className="flex justify-between text-[#006569]"><span>Discount</span><span className="font-bold tabular-nums">− {formatAmount(selected.discountPaise)}</span></div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-800"><span>Total</span><span className="tabular-nums">{formatAmount(selected.amountPaise)}</span></div>
                </div>
              </div>

              {/* Razorpay ids */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Razorpay Order ID</p>
                  <p className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-700">{selected.razorpayOrderId || '—'}</p>
                </div>
                <div className="rounded-xl border border-slate-100 px-4 py-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Razorpay Payment ID</p>
                  <p className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-700">{selected.razorpayPaymentId || '—'}</p>
                </div>
              </div>

              {/* Status change — the ONLY write surface */}
              <div className="rounded-xl border border-[#E5F4F4] bg-teal-50/30 p-4">
                <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Update Status</p>
                <div className="flex flex-wrap gap-2">
                  {ADMIN_CHANGEABLE.map((s) => (
                    <button
                      key={s}
                      onClick={() => setNewStatus(s)}
                      disabled={savingStatus}
                      className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all disabled:opacity-50 ${
                        newStatus === s
                          ? `${statusBadge(s)} border-current`
                          : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note (e.g. serial sent, amount refunded)"
                  maxLength={300}
                  className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-[#006569]"
                />
                {statusError && (
                  <p role="alert" className="mt-2 text-[11px] font-semibold text-rose-600">{statusError}</p>
                )}
                <button
                  onClick={handleStatusSave}
                  disabled={!selected || selected.status === newStatus || savingStatus}
                  className="mt-3 w-full rounded-xl bg-[#006569] px-6 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-white transition-all hover:shadow-lg hover:shadow-teal-900/20 disabled:opacity-40"
                >
                  {savingStatus ? 'Saving…' : selected?.status === newStatus ? 'Already in this status' : 'Save Status Change'}
                </button>
              </div>

              {/* Timeline — same newest-first UI as TSS renewals */}
              {(() => {
                const raw: StatusEvent[] = (selected.statusHistory ?? [])
                  .map((e) => ({ ...e, at: new Date(e.at) }))
                  .filter((e) => !Number.isNaN(e.at.getTime()));
                const timeline = buildTimeline(raw);
                return (
                  <div>
                    <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Status History</p>
                    {timeline.length === 0 ? (
                      <p className="text-sm font-medium italic text-slate-400">No status changes recorded yet.</p>
                    ) : (
                      <ol className="space-y-0">
                        {timeline.map((ev, i) => (
                          <li key={`${ev.at.getTime()}-${i}`} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-[#006569]' : 'bg-slate-300'}`} />
                              {i < timeline.length - 1 && <span className="w-px grow bg-slate-200" />}
                            </div>
                            <div className="min-w-0 flex-1 pb-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-bold text-slate-400">
                                  {ev.from ? `${ev.from} →` : 'created as'}
                                </span>
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${statusBadge(ev.to)}`}>
                                  {ev.to}
                                </span>
                                {ev.actor && (
                                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{ev.actor}</span>
                                )}
                              </div>
                              <p className="mt-1 text-[10px] font-medium text-slate-400">
                                {ev.at.toLocaleString()}
                              </p>
                              {ev.note && (
                                <p className="mt-1 break-words text-sm font-medium text-slate-600">{ev.note}</p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                    {timeline.some((e) => e.from === null) && (
                      <p className="text-[10px] font-medium italic text-slate-400">
                        History began with this order — earlier changes were not recorded.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-100 bg-slate-50/70 p-5 sm:p-6">
              <button onClick={closeDetail} className="rounded-xl px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-slate-700">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
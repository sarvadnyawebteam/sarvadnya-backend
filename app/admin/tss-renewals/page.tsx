'use client';

import { useEffect, useState } from 'react';
// CHANGE: 2026-10-02 — shared vocabulary + timeline derivation (SP-2). The status
// buttons and this endpoint both read the same list, so they cannot drift apart.
import { buildTimeline, TSS_RENEWAL_STATUSES, type StatusEvent } from '@/lib/status-history';

type StatusRecord = {
  to: string;
  at: string;
  actor: string;
  note?: string;
};

type TssRenewal = {
  _id: string;
  createdAt: string;
  name: string;
  email: string;
  serialNumber: string;
  source: string;
  status: string;
  // CHANGE: 2026-10-02 — absent on records created before SP-2 (deliberately not
  // backfilled), so every read of it must tolerate undefined.
  statusHistory?: StatusRecord[];
};

// CHANGE: 2026-10-02 — relative time for the status timeline (SP-2). The repo has no
// date-fns dependency; a dependency for one label in one component costs more than
// it saves, and would need porting to both forks.
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AdminTssRenewalsPage() {
  const [renewals, setRenewals] = useState<TssRenewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TssRenewal | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/tss-renewals');
      const data = await res.json();
      if (Array.isArray(data.renewals)) setRenewals(data.renewals);
    } catch (err) {
      console.error('Error fetching TSS renewals:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this renewal request?')) return;
    try {
      const res = await fetch(`/api/admin/tss-renewals?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRenewals(prev => prev.filter(r => r._id !== id));
        if (selected?._id === id) closeDetail();
      }
    } catch (err) {
      console.error('Error deleting renewal:', err);
    }
  };

  const handleStatus = async (id: string, status: string, noteText?: string) => {
    // CHANGE: 2026-10-02 — guard the no-op, surface failures, adopt the server's
    // returned history (SP-2). Three fixes in one path:
    //  1. Re-clicking the CURRENT status used to fire a request; now that every
    //     change appends an audit event, that would duplicate history on each click.
    //  2. A rejected request used to fail with no visible feedback at all.
    //  3. The server now returns the post-write status and history, so the client
    //     reconciles against what was actually stored instead of assuming success.
    const current = renewals.find(r => r._id === id);
    if (current?.status === status) return;

    setStatusError(null);
    try {
      const res = await fetch('/api/admin/tss-renewals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, ...(noteText ? { note: noteText } : {}) })
      });
      if (!res.ok) {
        // Leave local state untouched so the UI never claims a change that failed.
        const body = await res.json().catch(() => ({}));
        setStatusError(body.error || `Could not update status (HTTP ${res.status})`);
        return;
      }
      const body = await res.json();
      setRenewals(prev => prev.map(r => r._id === id
        ? { ...r, status: body.status ?? status, statusHistory: body.history ?? r.statusHistory }
        : r));
      if (selected?._id === id) {
        setSelected(prev => prev
          ? { ...prev, status: body.status ?? status, statusHistory: body.history ?? prev.statusHistory }
          : null);
      }
      setNote('');
    } catch (err) {
      console.error('Error updating status:', err);
      setStatusError('Network error — status was not updated.');
    }
  };

  // CHANGE: 2026-10-02 — reset the transient status-change fields whenever the modal
  // opens or closes (SP-2), so a stale note or error from a previous renewal never
  // carries over into the next one.
  const openDetail = (r: TssRenewal) => {
    setSelected(r);
    setNote('');
    setStatusError(null);
  };
  const closeDetail = () => {
    setSelected(null);
    setNote('');
    setStatusError(null);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'contacted': return 'bg-blue-50 text-blue-600 border-blue-100';
      case 'renewed': return 'bg-teal-50 text-teal-600 border-teal-100';
      case 'rejected': return 'bg-rose-50 text-rose-600 border-rose-100';
      default: return 'bg-amber-50 text-amber-600 border-amber-100';
    }
  };

  return (
    <div className="relative">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[#006569] mb-2">Admin Support</p>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">TSS Renewal Requests</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Customers requesting TSS renewal with their serial number.
          </p>
        </div>
        <button
          onClick={fetchData}
          className="rounded-full bg-[#006569] px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all hover:shadow-lg hover:shadow-teal-900/15"
        >
          Refresh
        </button>
      </header>

      <div className="rounded-[2rem] border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70">
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Date</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Name</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Email</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Serial Number</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Source</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-4"><div className="h-4 bg-slate-100 rounded w-24" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-100 rounded w-32" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-100 rounded w-40" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-100 rounded w-28" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-100 rounded w-20" /></td>
                    <td className="p-4"><div className="h-4 bg-slate-100 rounded w-20" /></td>
                    <td className="p-4"><div className="h-8 bg-slate-100 rounded w-8 ml-auto" /></td>
                  </tr>
                ))
              ) : renewals.length > 0 ? (
                renewals.map((r) => (
                  <tr
                    key={r._id}
                    className="border-b border-slate-50 transition-colors hover:bg-slate-50/40 cursor-pointer"
                    onClick={() => openDetail(r)}
                  >
                    <td className="p-4 text-[11px] font-semibold text-slate-500">
                      {new Date(r.createdAt).toLocaleDateString()}
                      <br />
                      <span className="text-[9px] font-medium text-slate-400">
                        {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td className="p-4 text-sm font-semibold text-slate-900">{r.name}</td>
                    <td className="p-4 text-sm font-medium text-slate-600">{r.email}</td>
                    <td className="p-4 text-sm font-bold text-slate-900 font-mono">{r.serialNumber}</td>
                    <td className="p-4">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-slate-500">
                        {r.source || 'website'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusBadge(r.status)}`}>
                        {r.status || 'pending'}
                      </span>
                    </td>
                    <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDelete(r._id)}
                        className="rounded-full p-2 text-slate-300 transition-colors hover:text-rose-500"
                        title="Delete"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-20 text-center">
                    <div className="mb-3 text-slate-300">
                      <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold italic text-slate-400">No renewal requests yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm"
          onClick={closeDetail}
        >
          <div
            className="mt-12 mb-12 flex max-h-[calc(100vh-8rem)] w-full max-w-lg flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50/70 p-6 sm:p-8">
              <div>
                <p className="mb-1 text-[10px] font-black uppercase tracking-[0.25em] text-[#006569]">Renewal Request</p>
                <h2 className="text-2xl font-black tracking-tight text-slate-900">{selected.name}</h2>
              </div>
              <button onClick={closeDetail} className="rounded-full p-2 text-slate-400 transition-colors hover:text-slate-900">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="grow space-y-4 overflow-y-auto p-6 sm:p-8">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Email</p>
                  <p className="text-sm font-semibold text-slate-700">{selected.email}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Serial Number</p>
                  <p className="text-sm font-bold text-slate-900 font-mono">{selected.serialNumber}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Source</p>
                  <p className="text-sm font-semibold text-slate-700">{selected.source || 'website'}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Submitted</p>
                  <p className="text-sm font-semibold text-slate-700">
                    {new Date(selected.createdAt).toLocaleDateString()} at{' '}
                    {new Date(selected.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>

              <div>
                <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-slate-400">Update Status</p>
                {/* CHANGE: 2026-10-02 — the four statuses now come from the shared
                    vocabulary the API validates against (SP-2), not an inline literal. */}
                <div className="flex flex-wrap gap-2">
                  {TSS_RENEWAL_STATUSES.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleStatus(selected._id, s, note)}
                      className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider border transition-all ${
                        selected.status === s
                          ? `${statusBadge(s)} border-current`
                          : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* CHANGE: 2026-10-02 — optional audit note (SP-2). The event shape
                    has carried a note since the spec; without this input it could
                    never be set from the UI. Applies to the NEXT status click only. */}
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note for this change (e.g. called, no answer)"
                  maxLength={300}
                  className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-[#006569]"
                />

                {statusError && (
                  <p role="alert" className="mt-2 text-[11px] font-semibold text-rose-600">
                    {statusError}
                  </p>
                )}
              </div>

              {/* CHANGE: 2026-10-02 — status-change timeline (SP-2). Rendered from
                  statusHistory; `at` arrives as an ISO string (serializeData converts
                  Dates), so it is rebuilt into Date objects before buildTimeline,
                  which sorts on getTime(). Records predating SP-2 have no history. */}
              {(() => {
                // `at` arrives as an ISO string (serializeData converts Dates), so it
                // is rebuilt into Date objects before buildTimeline, which sorts on
                // getTime(). An unparseable date is dropped rather than rendered:
                // Date#toISOString() throws RangeError on an Invalid Date, which
                // would take the whole modal down.
                const raw: StatusEvent[] = (selected.statusHistory ?? [])
                  .map(e => ({ ...e, at: new Date(e.at) }))
                  .filter(e => !Number.isNaN(e.at.getTime()));
                const timeline = buildTimeline(raw);
                return (
                  <div>
                    <p className="mb-3 text-[9px] font-black uppercase tracking-widest text-slate-400">Status History</p>
                    {timeline.length === 0 ? (
                      <p className="text-sm font-medium italic text-slate-400">
                        No status changes recorded yet.
                      </p>
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
                                {/* `from` is null on the oldest entry because legacy
                                    records were deliberately not backfilled. */}
                                <span className="text-[11px] font-bold text-slate-400">
                                  {ev.from ? `${ev.from} →` : 'created as'}
                                </span>
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${statusBadge(ev.to)}`}>
                                  {ev.to}
                                </span>
                              </div>
                              <p className="mt-1 text-[10px] font-medium text-slate-400">
                                {timeAgo(ev.at.toISOString())}
                                <span className="mx-1.5">·</span>
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
                    {timeline.some(e => e.from === null) && (
                      <p className="text-[10px] font-medium italic text-slate-400">
                        History began 2026-10-02 — earlier changes were not recorded.
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
              <a
                href={`mailto:${selected.email}?subject=Your TSS Renewal Request&body=Hi ${selected.name},%0A%0AWe received your TSS renewal request (Serial: ${selected.serialNumber}). Please share the latest pricing to proceed.`}
                className="inline-flex items-center gap-2 rounded-xl bg-[#006569] px-6 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-white transition-all hover:shadow-lg hover:shadow-teal-900/20"
              >
                Reply via Email
              </a>
            </div>
          </div>
        </div>
      )}

      <p className="py-8 text-center text-[10px] font-black uppercase tracking-[0.4em] text-slate-400">
        End of TSS Renewal Log
      </p>
    </div>
  );
}

'use client'
// CHANGE: 2026-10-09 — owner: form drafts must be visible. This page previously fetched
// /api/admin/drafts, but NO list route existed, so it always rendered an empty table. The
// list endpoint now exists; rows open the full draft (fields + metadata) in a modal.
import { useEffect, useMemo, useState, useCallback } from 'react'

type DraftRow = {
  _id: string
  draftId: string
  sessionId: string
  path: string
  entryPoint: string
  source: string
  status: string
  createdAt?: string
  lastActiveAt?: string
  ip: string
  contact: string
}

type DraftFull = DraftRow & {
  updatedAt?: string
  expiresAt?: string
  fields?: Record<string, any>
  meta?: Record<string, any>
}

function fmt(v?: string) {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function DraftsPage() {
  const [items, setItems] = useState<DraftRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DraftFull | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/drafts?limit=200')
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || 'load failed')
      setItems(d.items || [])
      setTotal(d.total || 0)
      setError('')
    } catch {
      setError('Failed to load drafts.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openDraft = useCallback(async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const r = await fetch(`/api/admin/drafts/${id}`)
      const d = await r.json()
      if (r.ok) setDetail(d.item)
      else setError(d?.error || 'Failed to load draft')
    } catch {
      setError('Failed to load draft')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const close = useCallback(() => { setOpenId(null); setDetail(null) }, [])

  // CHANGE: 2026-10-12 — owner: add a Delete button (per-row + in the modal). One shared
  // confirm dialog serves both; confirming fires a hard DELETE on /api/admin/drafts/[id].
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const r = await fetch(`/api/admin/drafts/${pendingDelete.id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || 'delete failed')
      if (openId === pendingDelete.id) close()
      setPendingDelete(null)
      setError('')
      await load()
    } catch {
      setError('Failed to delete that draft. Please try again.')
    } finally {
      setDeleting(false)
    }
  }, [pendingDelete, openId, close, load])

  // Esc closes the draft modal, or cancels a pending delete.
  useEffect(() => {
    if (!openId && !pendingDelete) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (pendingDelete) setPendingDelete(null)
      else close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openId, pendingDelete, close])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((x) =>
      [x.path, x.entryPoint, x.source, x.status, x.contact, x.ip].some((v) => (v || '').toLowerCase().includes(q)),
    )
  }, [items, query])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Form Drafts</h1>
          <p className="text-xs text-slate-500 mt-1">
            Form fills that were never submitted &middot; <span className="font-bold text-slate-700">{total}</span> total
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#006569] text-white text-xs font-bold shadow-sm hover:bg-[#045A57] active:scale-[0.98] disabled:opacity-60 transition-all"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
          </svg>
          Refresh
        </button>
      </div>

      <div className="mb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by page, entry point, source, contact…"
          className="w-full max-w-md px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#006569]/30 focus:border-[#006569]"
        />
      </div>

      {error && <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-xs font-semibold text-red-700">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-4 py-3 font-bold uppercase text-[10px] tracking-widest">Last Active</th>
                <th className="text-left px-4 py-3 font-bold uppercase text-[10px] tracking-widest">Page</th>
                <th className="text-left px-4 py-3 font-bold uppercase text-[10px] tracking-widest">Entry Point</th>
                <th className="text-left px-4 py-3 font-bold uppercase text-[10px] tracking-widest">Contact</th>
                <th className="text-left px-4 py-3 font-bold uppercase text-[10px] tracking-widest">Status</th>
                <th className="text-left px-4 py-3 font-bold uppercase text-[10px] tracking-widest">IP</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading drafts…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No drafts found.</td></tr>
              )}
              {filtered.map((x) => (
                <tr key={x._id} className="border-t border-slate-100 hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmt(x.lastActiveAt || x.createdAt)}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{x.path || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{x.entryPoint || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 max-w-[16rem] truncate">{x.contact || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600">{x.status || 'draft'}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{x.ip}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => openDraft(x._id)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-[#006569] bg-teal-50 hover:bg-teal-100 transition-colors whitespace-nowrap"
                      >
                        View
                      </button>
                      <button
                        onClick={() => setPendingDelete({ id: x._id, label: x.path || 'this draft' })}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors whitespace-nowrap"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Draft detail">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={close} />
          <div className="relative z-10 w-full max-w-xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 py-3.5 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-black text-slate-900">Draft Detail</h2>
                {detail && <p className="text-[10px] text-slate-500 mt-0.5">{detail.path} &middot; {detail.source || detail.entryPoint}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPendingDelete({ id: openId, label: detail?.path || 'this draft' })}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                >
                  Delete
                </button>
                <button onClick={close} aria-label="Close draft" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-4">
              {detailLoading && <p className="py-10 text-center text-slate-400">Loading draft…</p>}
              {!detailLoading && detail && (
                <>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Captured Fields</h3>
                  {detail.fields && Object.keys(detail.fields).length > 0 ? (
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5 text-xs">
                      {Object.entries(detail.fields).map(([k, v]) => (
                        <div key={k} className="bg-slate-50 rounded-xl px-3 py-2">
                          <dt className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{k}</dt>
                          <dd className="text-slate-800 break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-xs text-slate-400 mb-5">No form fields were captured (the visitor left before typing anything).</p>
                  )}

                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Session</h3>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5 text-[10px]">
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Created</dt><dd className="text-slate-700 mt-0.5">{fmt(detail.createdAt)}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Last Active</dt><dd className="text-slate-700 mt-0.5">{fmt(detail.lastActiveAt)}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Expires</dt><dd className="text-slate-700 mt-0.5">{fmt(detail.expiresAt)}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Status</dt><dd className="text-slate-700 mt-0.5">{detail.status || '—'}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">IP</dt><dd className="text-slate-700 mt-0.5">{detail.ip}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Session</dt><dd className="text-slate-700 mt-0.5 break-all">{detail.sessionId || '—'}</dd></div>
                  </dl>

                  {detail.meta && Object.keys(detail.meta).length > 0 && (
                    <>
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Metadata</h3>
                      <div className="space-y-2 text-[11px]">
                        {Object.entries(detail.meta).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="font-bold text-slate-500 min-w-24">{k}</span>
                            <span className="text-slate-700 break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CHANGE: 2026-10-12 — shared confirm for the row + modal Delete buttons. */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirm delete">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => { if (!deleting) setPendingDelete(null) }} />
          <div className="relative z-10 w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-100 p-5">
            <h2 className="text-sm font-black text-slate-900">Delete this draft?</h2>
            <p className="text-[11px] text-slate-500 mt-1.5 break-words">
              The captured form on <span className="font-semibold text-slate-700">{pendingDelete.label}</span> will be permanently removed. This cannot be undone.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
                className="px-3.5 py-2 rounded-xl text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-3.5 py-2 rounded-xl text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

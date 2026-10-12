'use client'
// CHANGE: 2026-10-09 — owner: the recorded chat history must be visible. Rebuilt from a
// static table (which showed a broken "Turns" column and had no way to read a
// conversation) into a searchable list whose rows open the FULL transcript in a modal,
// fetched from /api/admin/chats/[id].
import { useEffect, useMemo, useState, useCallback } from 'react'

type ChatRow = {
  _id: string
  startedAt?: string
  lastActiveAt?: string
  entryPoint: string
  path: string
  endedReason: string
  ip: string
  turnCount: number
  lastMessage: string
}

type ChatMsg = { role: string; text: string; ts?: string; topic?: string | null }
type ChatFull = ChatRow & { sessionId?: string; endedAt?: string; messages?: ChatMsg[] }

function fmt(v?: string) {
  if (!v) return '—'
  const d = new Date(v)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function ChatsPage() {
  const [items, setItems] = useState<ChatRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')

  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChatFull | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/chats?limit=200')
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || 'load failed')
      setItems(d.items || [])
      setTotal(d.total || 0)
      setError('')
    } catch {
      setError('Failed to load chat logs.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openTranscript = useCallback(async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const r = await fetch(`/api/admin/chats/${id}`)
      const d = await r.json()
      if (r.ok) setDetail(d.item)
      else setError(d?.error || 'Failed to load transcript')
    } catch {
      setError('Failed to load transcript')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const close = useCallback(() => { setOpenId(null); setDetail(null) }, [])

  // CHANGE: 2026-10-12 — owner: add a Delete button (per-row + in the modal). One shared
  // confirm dialog serves both; confirming fires a hard DELETE on /api/admin/chats/[id].
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const r = await fetch(`/api/admin/chats/${pendingDelete.id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || 'delete failed')
      if (openId === pendingDelete.id) close()
      setPendingDelete(null)
      setError('')
      await load()
    } catch {
      setError('Failed to delete that transcript. Please try again.')
    } finally {
      setDeleting(false)
    }
  }, [pendingDelete, openId, close, load])

  // Esc closes the transcript modal, or cancels a pending delete.
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
      [x.path, x.entryPoint, x.ip, x.lastMessage, x.endedReason].some((v) => (v || '').toLowerCase().includes(q)),
    )
  }, [items, query])

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Chat Transcripts</h1>
          <p className="text-xs text-slate-500 mt-1">
            Ask Sara conversations captured from the live site &middot; <span className="font-bold text-slate-700">{total}</span> total
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
          placeholder="Filter by page, entry point, IP or message text…"
          className="w-full max-w-md px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-[#006569]/30 focus:border-[#006569]"
        />
      </div>

      {error && <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-xs font-semibold text-red-700">{error}</div>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-widest">Started</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-widest">Page</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-widest">Entry Point</th>
                <th className="text-right px-4 py-2.5 font-bold uppercase text-[10px] tracking-widest">Msgs</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-widest">Last Message</th>
                <th className="text-left px-4 py-2.5 font-bold uppercase text-[10px] tracking-widest">IP</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading chat logs…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No chat transcripts found.</td></tr>
              )}
              {filtered.map((x) => (
                <tr key={x._id} className="border-t border-slate-100 hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{fmt(x.startedAt)}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-800">{x.path || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500">{x.entryPoint || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-slate-800 tabular-nums">{x.turnCount}</td>
                  <td className="px-4 py-2.5 text-slate-500 max-w-[20rem] truncate">{x.lastMessage || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 font-mono whitespace-nowrap">{x.ip || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => openTranscript(x._id)}
                        className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-[#006569] bg-teal-50 hover:bg-teal-100 transition-colors whitespace-nowrap"
                      >
                        View transcript
                      </button>
                      <button
                        onClick={() => setPendingDelete({ id: x._id, label: x.path || 'this transcript' })}
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
        <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Chat transcript">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={close} />
          <div className="relative z-10 w-full max-w-2xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-100 flex flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4 px-6 py-3.5 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-black text-slate-900">Chat Transcript</h2>
                {detail && <p className="text-[10px] text-slate-500 mt-0.5">{detail.path} &middot; {detail.entryPoint}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPendingDelete({ id: openId, label: detail?.path || 'this transcript' })}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
                >
                  Delete
                </button>
                <button onClick={close} aria-label="Close transcript" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-6 py-4">
              {detailLoading && <p className="py-10 text-center text-slate-400">Loading transcript…</p>}
              {!detailLoading && detail && (
                <>
                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4 text-[10px]">
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Started</dt><dd className="text-slate-700 mt-0.5">{fmt(detail.startedAt)}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Last Active</dt><dd className="text-slate-700 mt-0.5">{fmt(detail.lastActiveAt)}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Ended</dt><dd className="text-slate-700 mt-0.5">{detail.endedReason || '—'}</dd></div>
                    <div><dt className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">IP</dt><dd className="text-slate-700 mt-0.5 font-mono">{detail.ip || '—'}</dd></div>
                    <div className="col-span-2"><dt className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Session</dt><dd className="text-slate-700 mt-0.5 break-all font-mono">{detail.sessionId || '—'}</dd></div>
                  </dl>

                  <div className="space-y-2.5">
                    {(detail.messages || []).map((m, i) => {
                      const isUser = m.role === 'user'
                      return (
                        <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[11px] leading-relaxed ${isUser ? 'bg-[#006569] text-white' : 'bg-slate-100 text-slate-800'}`}>
                            <p className="whitespace-pre-wrap break-words">{m.text}</p>
                            <div className={`mt-1 flex items-center gap-2 text-[9px] ${isUser ? 'text-teal-100' : 'text-slate-400'}`}>
                              <span className="font-bold uppercase tracking-wide">{isUser ? 'Visitor' : 'Sara'}</span>
                              {m.ts && <span>{fmt(m.ts)}</span>}
                              {m.topic && <span className="px-1.5 py-0.5 rounded bg-black/10">{m.topic}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {(detail.messages || []).length === 0 && (
                      <p className="py-6 text-center text-slate-400 text-xs">No messages recorded in this session.</p>
                    )}
                  </div>
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
            <h2 className="text-sm font-black text-slate-900">Delete this transcript?</h2>
            <p className="text-[11px] text-slate-500 mt-1.5 break-words">
              The conversation on <span className="font-semibold text-slate-700">{pendingDelete.label}</span> will be permanently removed. This cannot be undone.
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

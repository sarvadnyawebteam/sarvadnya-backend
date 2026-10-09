import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'

// CHANGE: 2026-10-09 — owner: the recorded chat history must actually be visible in the
// panel. The old list shipped only the LAST message (`messages.slice(-1)`), so the page's
// "Turns" column always read 0 or 1 and there was no way to open a conversation. This
// list now returns a compact row (real `turnCount` + a truncated `lastMessage` preview,
// masked IP); the FULL transcript is fetched on demand from /api/admin/chats/[id].
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function maskIp(ip?: string): string {
  if (!ip) return 'unknown'
  return ip.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.***')
}

function lastMessagePreview(messages: any): string {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  const last = messages[messages.length - 1]
  const text = typeof last?.text === 'string' ? last.text : ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 90)
}

export async function GET(req: NextRequest) {
  try {
    const ok = await verifyAdmin(req)
    if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { searchParams } = new URL(req.url)
    const page = Math.max(parseInt(searchParams.get('page') || '1') || 1, 1)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 200)
    const q = (searchParams.get('q') || '').trim()
    const skip = (page - 1) * limit
    const db = await getDb()
    const filter = q
      ? { $or: [{ path: new RegExp(escapeRegex(q), 'i') }, { entryPoint: new RegExp(escapeRegex(q), 'i') }] }
      : {}
    const items = await db.collection('chat_logs').find(filter).sort({ lastActiveAt: -1 }).skip(skip).limit(limit).toArray()
    const total = await db.collection('chat_logs').countDocuments(filter)
    const rows = items.map((x: any) => ({
      _id: String(x._id),
      startedAt: x.startedAt,
      lastActiveAt: x.lastActiveAt,
      entryPoint: x.entryPoint || '',
      path: x.path || '',
      endedReason: x.endedReason || '',
      ip: maskIp(x.ip),
      turnCount: Array.isArray(x.messages) ? x.messages.length : 0,
      lastMessage: lastMessagePreview(x.messages),
    }))
    return NextResponse.json({ items: rows, total, page, limit })
  } catch (e: any) { return NextResponse.json({ error: 'server_error' }, { status: 500 }) }
}

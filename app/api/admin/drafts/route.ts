import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'

// CHANGE: 2026-10-09 — owner: form drafts must be visible. The /admin/drafts page has
// always fetched /api/admin/drafts but NO list route existed (only /[id]), so the screen
// silently showed nothing. This adds the list endpoint (masked IP + the captured fields)
// and the full draft is fetched on demand from /api/admin/drafts/[id].
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function maskIp(ip?: string): string {
  if (!ip) return 'unknown'
  return ip.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.***')
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
      ? { $or: [{ path: new RegExp(escapeRegex(q), 'i') }, { entryPoint: new RegExp(escapeRegex(q), 'i') }, { source: new RegExp(escapeRegex(q), 'i') }] }
      : {}
    const items = await db.collection('drafts').find(filter).sort({ lastActiveAt: -1, updatedAt: -1 }).skip(skip).limit(limit).toArray()
    const total = await db.collection('drafts').countDocuments(filter)
    const rows = items.map((x: any) => {
      const fields = x.fields && typeof x.fields === 'object' ? x.fields : {}
      return {
        _id: String(x._id),
        draftId: x.draftId || '',
        sessionId: x.sessionId || '',
        path: x.path || '',
        entryPoint: x.entryPoint || '',
        source: x.source || '',
        status: x.status || '',
        createdAt: x.createdAt,
        lastActiveAt: x.lastActiveAt,
        ip: maskIp(x.ip || x.meta?.ip),
        // Only the three form fields the owner cares about, never the whole bag.
        contact: [fields.name, fields.email, fields.phone].filter(Boolean).join(' | '),
      }
    })
    return NextResponse.json({ items: rows, total, page, limit })
  } catch (e: any) { return NextResponse.json({ error: 'server_error' }, { status: 500 }) }
}

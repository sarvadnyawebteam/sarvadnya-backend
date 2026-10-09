import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { ObjectId } from 'mongodb'

export async function GET(req: NextRequest, context: any){
  try{
    const ok=await verifyAdmin(req)
    if (!ok) return NextResponse.json({error:'unauthorized'},{status:401})
    // CHANGE: 2026-10-09 — await params (Next 15 may hand a Promise) and reject a
    // malformed id with 400 instead of throwing into the catch-all as a 500.
    const { id } = await context.params
    if (!ObjectId.isValid(id)) return NextResponse.json({error:'invalid_id'},{status:400})
    const db=await getDb()
    const item=await db.collection('chat_logs').findOne({_id:new ObjectId(id)})
    if (!item) return NextResponse.json({error:'not_found'},{status:404})
    return NextResponse.json({item})
  }catch(e:any){ return NextResponse.json({error:'server_error'},{status:500}) }
}

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
    const item=await db.collection('drafts').findOne({_id:new ObjectId(id)})
    if (!item) return NextResponse.json({error:'not_found'},{status:404})
    return NextResponse.json({item})
  }catch(e:any){ return NextResponse.json({error:'server_error'},{status:500}) }
}

// CHANGE: 2026-10-12 — owner: add a Delete button to the Form Drafts admin. Hard delete
// of one drafts document. Same guard + id validation as GET (401 / 400 / 404) so the
// DELETE surface matches the read surface exactly.
export async function DELETE(req: NextRequest, context: any){
  try{
    const ok=await verifyAdmin(req)
    if (!ok) return NextResponse.json({error:'unauthorized'},{status:401})
    const { id } = await context.params
    if (!ObjectId.isValid(id)) return NextResponse.json({error:'invalid_id'},{status:400})
    const db=await getDb()
    const res=await db.collection('drafts').deleteOne({_id:new ObjectId(id)})
    if (!res.deletedCount) return NextResponse.json({error:'not_found'},{status:404})
    return NextResponse.json({ok:true})
  }catch(e:any){ return NextResponse.json({error:'server_error'},{status:500}) }
}

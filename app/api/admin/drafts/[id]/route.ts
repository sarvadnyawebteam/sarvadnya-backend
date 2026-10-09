import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'
import { ObjectId } from 'mongodb'

export async function GET(req: NextRequest, context: any){
  const params = context.params

  try{
    const ok=await verifyAdmin(req)
    if (!ok) return NextResponse.json({error:'unauthorized'},{status:401})
    const db=await getDb()
    const item=await db.collection('drafts').findOne({_id:new ObjectId(params.id)})
    if (!item) return NextResponse.json({error:'not_found'},{status:404})
    return NextResponse.json({item})
  }catch(e:any){ return NextResponse.json({error:'server_error'},{status:500}) }
}

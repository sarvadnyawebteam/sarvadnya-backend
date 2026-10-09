import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyAdmin } from '@/lib/admin-auth'

export async function GET(req:NextRequest){
  try{
    const ok=await verifyAdmin(req)
    if (!ok) return NextResponse.json({error:'unauthorized'},{status:401})
    const {searchParams}=new URL(req.url)
    const page=parseInt(searchParams.get('page')||'1')
    const limit=Math.min(parseInt(searchParams.get('limit')||'50'),200)
    const skip=(page-1)*limit
    const db=await getDb()
    const items=await db.collection('drafts').find({}).sort({lastActiveAt:-1}).skip(skip).limit(limit).toArray()
    const total=await db.collection('drafts').countDocuments()
    const masked=items.map(x=>({...x,ip:x.ip?x.ip.replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.***'):'unknown'}))
    return NextResponse.json({items:masked,total,page,limit})
  }catch(e:any){ return NextResponse.json({error:'server_error'},{status:500}) }
}

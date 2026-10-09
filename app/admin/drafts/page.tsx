'use client'
import { useEffect,useState } from 'react'

export default function DraftsPage(){
  const [items,setItems]=useState<any[]>([])
  const [total,setTotal]=useState(0)
  useEffect(()=>{
    fetch('/api/admin/drafts?limit=50').then(r=>r.json()).then(d=>{setItems(d.items||[]);setTotal(d.total||0)}).catch(()=>{})
  },[])
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Drafts (non-submitted) — {total}</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left p-2">Last Active</th><th className="text-left p-2">Path</th><th className="text-left p-2">EntryPoint</th><th className="text-left p-2">Email/Phone/Name</th><th className="text-left p-2">IP</th></tr></thead>
          <tbody>
            {items.map((x:any)=>(
              <tr key={x._id} className="border-t">
                <td className="p-2">{x.lastActiveAt?new Date(x.lastActiveAt).toLocaleString():'-'}</td>
                <td className="p-2">{x.path}</td>
                <td className="p-2">{x.entryPoint}</td>
                <td className="p-2">{[x.fields?.email,x.fields?.phone,x.fields?.name].filter(Boolean).join(' | ')}</td>
                <td className="p-2">{x.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

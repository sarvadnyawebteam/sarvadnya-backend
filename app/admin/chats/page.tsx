'use client'
import { useEffect,useState } from 'react'

export default function ChatsPage(){
  const [items,setItems]=useState<any[]>([])
  const [total,setTotal]=useState(0)
  useEffect(()=>{
    fetch('/api/admin/chats?limit=50').then(r=>r.json()).then(d=>{setItems(d.items||[]);setTotal(d.total||0)}).catch(()=>{})
  },[])
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Chat Logs — {total}</h1>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr><th className="text-left p-2">Started</th><th className="text-left p-2">EntryPoint</th><th className="text-left p-2">Path</th><th className="text-left p-2">Turns</th><th className="text-left p-2">IP</th></tr></thead>
          <tbody>
            {items.map((x:any)=>(
              <tr key={x._id} className="border-t">
                <td className="p-2">{x.startedAt?new Date(x.startedAt).toLocaleString():'-'}</td>
                <td className="p-2">{x.entryPoint}</td>
                <td className="p-2">{x.path}</td>
                <td className="p-2">{x.messages?.length||0}</td>
                <td className="p-2">{x.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

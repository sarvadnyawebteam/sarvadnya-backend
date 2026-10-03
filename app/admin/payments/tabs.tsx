'use client';

import Link from 'next/link';

// CHANGE: 2026-10-03 — SP-3: small Ledger | Summary switcher shared by the two
// /admin/payments pages (the sidebar has ONE entry; the tabs switch between them).
export default function PaymentsTabs({ active }: { active: 'ledger' | 'summary' }) {
  const tabs = [
    { key: 'ledger', label: 'Ledger', href: '/admin/payments' },
    { key: 'summary', label: 'Summary', href: '/admin/payments/summary' },
  ] as const;
  return (
    <div className="mb-6 inline-flex rounded-xl border border-slate-200 bg-white p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all ${
            active === t.key ? 'bg-[#006569] text-white' : 'text-slate-500 hover:text-[#006569]'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
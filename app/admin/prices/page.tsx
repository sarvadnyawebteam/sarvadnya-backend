'use client';

// CHANGE: 2026-10-02 — admin price manager (SP-1 cart build).
// WHY: the live checkout prices come from MongoDB `prices`. This page lists every item
// (priced / unpriced / inactive), edits price + GST + discount + the sellable slug itself,
// validates against the shared lib/prices.ts rules, re-bootstraps missing catalogue items,
// and deletes. Base price is edited in RUPEES (the wire format is paise — the form
// converts both ways).

import React, { useState, useEffect, useCallback } from 'react';

interface PriceDoc {
  _id: string;
  slug: string;
  name: string;
  category: string;
  validity?: string;
  basePaise: number;
  gstPct: number;
  discountPaise: number;
  payablePaise: number;
  pairsWith: string[];
  addonSlugs: string[];
  moduleSlugs: string[];
  priceStatus: 'priced' | 'unpriced' | 'inactive';
  discountLabel?: string;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

interface Draft {
  id: string | null;
  slug: string;
  name: string;
  category: string;
  validity: string;
  priceStatus: 'priced' | 'unpriced' | 'inactive';
  baseRupees: string;
  gstPct: string;
  discountRupees: string;
  discountLabel: string;
  pairsWith: string;
  addonSlugs: string;
  moduleSlugs: string;
  sortOrder: string;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  slug: '',
  name: '',
  category: 'products',
  validity: '',
  priceStatus: 'priced',
  baseRupees: '0',
  gstPct: '18',
  discountRupees: '0',
  discountLabel: '',
  pairsWith: '',
  addonSlugs: '',
  moduleSlugs: '',
  sortOrder: '0',
};

function toRupees(paise: number): string {
  return String(Number.isFinite(paise) && paise > 0 ? paise / 100 : 0);
}

const STATUS_STYLES: Record<PriceDoc['priceStatus'], string> = {
  priced: 'bg-teal-100 text-teal-800 border-teal-200',
  unpriced: 'bg-blue-50 text-blue-700 border-blue-200',
  inactive: 'bg-slate-100 text-slate-500 border-slate-200',
};

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export default function AdminPrices() {
  const [items, setItems] = useState<PriceDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/prices');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to load prices');
      setItems(data);
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Failed to load prices.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
  }, [fetchPrices]);

  const startCreate = () => {
    setEditing({ ...EMPTY_DRAFT, sortOrder: String((items.length + 1) * 10) });
    setErrors({});
  };

  const startEdit = (doc: PriceDoc) => {
    setEditing({
      id: doc._id,
      slug: doc.slug,
      name: doc.name,
      category: doc.category,
      validity: doc.validity ?? '',
      priceStatus: doc.priceStatus,
      baseRupees: toRupees(doc.basePaise),
      gstPct: String(doc.gstPct),
      discountRupees: toRupees(doc.discountPaise),
      discountLabel: doc.discountLabel ?? '',
      pairsWith: (doc.pairsWith ?? []).join(', '),
      addonSlugs: (doc.addonSlugs ?? []).join(', '),
      moduleSlugs: (doc.moduleSlugs ?? []).join(', '),
      sortOrder: String(doc.sortOrder ?? 0),
    });
    setErrors({});
  };

  const bootstrap = async () => {
    if (!window.confirm('Re-add every catalogue item that is missing from the database? Items you have already edited are left untouched.')) return;
    setBootstrapping(true);
    try {
      const res = await fetch('/api/admin/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Bootstrap failed');
      setMessage({ text: data.message, type: 'success' });
      fetchPrices();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Bootstrap failed.', type: 'error' });
    } finally {
      setBootstrapping(false);
    }
  };

  const handleDelete = async (doc: PriceDoc) => {
    if (!window.confirm(`Delete "${doc.name}" (${doc.slug})? Cart rows will no longer be sellable under this slug.`)) return;
    try {
      const res = await fetch(`/api/admin/prices?id=${encodeURIComponent(doc._id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Delete failed');
      setMessage({ text: `${doc.name} deleted.`, type: 'success' });
      if (editing?.id === doc._id) setEditing(null);
      fetchPrices();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : 'Delete failed.', type: 'error' });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setErrors({});
    const baseRupees = parseFloat(editing.baseRupees);
    const discountRupees = parseFloat(editing.discountRupees);
    const gstPct = parseInt(editing.gstPct, 10);
    const sortOrder = parseInt(editing.sortOrder, 10);
    const split = (s: string) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

    const body = {
      id: editing.id || undefined,
      slug: editing.slug.trim(),
      name: editing.name.trim(),
      category: editing.category.trim(),
      validity: editing.validity.trim() || undefined,
      priceStatus: editing.priceStatus,
      basePaise: Math.round((Number.isFinite(baseRupees) ? baseRupees : 0) * 100),
      gstPct: Number.isInteger(gstPct) && gstPct >= 0 && gstPct <= 100 ? gstPct : NaN,
      discountPaise: Math.round((Number.isFinite(discountRupees) ? discountRupees : 0) * 100),
      discountLabel: editing.discountLabel.trim() || undefined,
      pairsWith: split(editing.pairsWith),
      addonSlugs: split(editing.addonSlugs),
      moduleSlugs: split(editing.moduleSlugs),
      sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    };

    try {
      const res = await fetch('/api/admin/prices', {
        method: body.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.errors) {
          setErrors(data.errors);
          throw new Error('Please fix the highlighted fields.');
        }
        throw new Error(data.error || 'Save failed');
      }
      setMessage({ text: data.message, type: 'success' });
      setEditing(null);
      fetchPrices();
    } catch (err) {
      if (!(err instanceof Error && err.message === 'Please fix the highlighted fields.')) {
        setMessage({ text: err instanceof Error ? err.message : 'Save failed.', type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const setDraft = (patch: Partial<Draft>) => setEditing((prev) => (prev ? { ...prev, ...patch } : prev));

  const editingSlugChanged = editing?.id !== null && editing && items.find((i) => i._id === editing.id)?.slug !== editing.slug;

  const inputCls = (field: string) =>
    `w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all focus:ring-2 ${errors[field] ? 'border-red-400 focus:border-red-400 focus:ring-red-200' : 'border-slate-200 focus:border-[#006569] focus:ring-[#006569]/20'}`;

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Price Manager</h1>
          <p className="mt-1 text-sm text-slate-500">
            These prices drive the site-wide cart. Base price is edited in rupees; the wire format is paise.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={bootstrap}
            disabled={bootstrapping}
            className="rounded-lg border border-[#006569]/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#006569] transition-colors hover:bg-teal-50 disabled:opacity-50"
          >
            {bootstrapping ? 'Syncing…' : 'Add missing from catalogue'}
          </button>
          <button
            type="button"
            onClick={startCreate}
            className="rounded-lg bg-[#006569] px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-[#045A57]"
          >
            + New price
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.type === 'success' ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-red-200 bg-red-50 text-red-700'}`} role="status">
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-slate-400">Loading prices…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Base</th>
                <th className="px-4 py-3 text-right">GST</th>
                <th className="px-4 py-3 text-right">Payable</th>
                <th className="px-4 py-3 text-center">Pairs</th>
                <th className="px-4 py-3 text-center">Sort</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => (
                <tr key={doc._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-900">{doc.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">{doc.slug}</p>
                    {doc.validity && <p className="text-[11px] text-slate-400">{doc.validity}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLES[doc.priceStatus]}`}>
                      {doc.priceStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{doc.category}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{inr.format((doc.basePaise ?? 0) / 100)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{doc.gstPct}%</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-[#006569]">{inr.format((doc.payablePaise ?? 0) / 100)}</td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{doc.pairsWith?.length ?? 0}</td>
                  <td className="px-4 py-3 text-center text-xs text-slate-500">{doc.sortOrder ?? 0}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEdit(doc)}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600 transition-colors hover:border-[#006569] hover:text-[#006569]"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc)}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-red-500 transition-colors hover:border-red-300 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                    No price documents yet — use “Add missing from catalogue” to seed the collection.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[9500] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Edit price">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
                {editing.id ? `Edit — ${editing.slug}` : 'New price'}
              </h2>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Close"
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4 px-5 py-5">
              {editingSlugChanged && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                  Renaming this slug updates every other item that references it (bundle pairs, add-ons,
                  modules). Code-rendered pages still look up their ORIGINAL slug, so those rows will fall
                  back to the built-in catalogue values until the code is updated to match.
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Slug (id)</label>
                  <input value={editing.slug} onChange={(e) => setDraft({ slug: e.target.value })} className={inputCls('slug')} placeholder="tallyprime-silver" />
                  {errors.slug && <p className="mt-1 text-xs text-red-500">{errors.slug}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Name</label>
                  <input value={editing.name} onChange={(e) => setDraft({ name: e.target.value })} className={inputCls('name')} placeholder="TallyPrime Silver" />
                  {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Status</label>
                  <select value={editing.priceStatus} onChange={(e) => setDraft({ priceStatus: e.target.value as Draft['priceStatus'] })} className={inputCls('priceStatus')}>
                    <option value="priced">priced — sellable in cart</option>
                    <option value="unpriced">unpriced — structure only, cannot be added</option>
                    <option value="inactive">inactive — hidden / not sellable</option>
                  </select>
                  {errors.priceStatus && <p className="mt-1 text-xs text-red-500">{errors.priceStatus}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Category</label>
                  <input value={editing.category} onChange={(e) => setDraft({ category: e.target.value })} className={inputCls('category')} placeholder="products" />
                  {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Validity</label>
                  <input value={editing.validity} onChange={(e) => setDraft({ validity: e.target.value })} className={inputCls('validity')} placeholder="Lifetime · 1 Year · Per year" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Sort order</label>
                  <input type="number" min={0} step={1} value={editing.sortOrder} onChange={(e) => setDraft({ sortOrder: e.target.value })} className={inputCls('sortOrder')} />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Base price (₹)</label>
                  <input type="number" min={0} step="0.01" value={editing.baseRupees} onChange={(e) => setDraft({ baseRupees: e.target.value })} className={inputCls('basePaise')} />
                  {errors.basePaise && <p className="mt-1 text-xs text-red-500">{errors.basePaise}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">GST %</label>
                  <input type="number" min={0} max={100} step={1} value={editing.gstPct} onChange={(e) => setDraft({ gstPct: e.target.value })} className={inputCls('gstPct')} />
                  {errors.gstPct && <p className="mt-1 text-xs text-red-500">{errors.gstPct}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Discount (₹ off)</label>
                  <input type="number" min={0} step="0.01" value={editing.discountRupees} onChange={(e) => setDraft({ discountRupees: e.target.value })} className={inputCls('discountPaise')} />
                  {errors.discountPaise && <p className="mt-1 text-xs text-red-500">{errors.discountPaise}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Discount label</label>
                  <input maxLength={20} value={editing.discountLabel} onChange={(e) => setDraft({ discountLabel: e.target.value })} className={inputCls('discountLabel')} placeholder="10% OFF" />
                  {errors.discountLabel && <p className="mt-1 text-xs text-red-500">{errors.discountLabel}</p>}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Frequently bought with (comma-separated slugs)
                </label>
                <input value={editing.pairsWith} onChange={(e) => setDraft({ pairsWith: e.target.value })} className={inputCls('pairsWith')} placeholder="tss-single-1yr, tss-single-2yr" />
                {errors.pairsWith && <p className="mt-1 text-xs text-red-500">{errors.pairsWith}</p>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Related add-on ids</label>
                  <input value={editing.addonSlugs} onChange={(e) => setDraft({ addonSlugs: e.target.value })} className={inputCls('addonSlugs')} placeholder="addon-id-1, addon-id-2" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">Related module slugs</label>
                  <input value={editing.moduleSlugs} onChange={(e) => setDraft({ moduleSlugs: e.target.value })} className={inputCls('moduleSlugs')} placeholder="cf-agencies, garment-retail" />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-[#006569] px-5 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-[#045A57] disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save price'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
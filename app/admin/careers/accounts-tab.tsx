'use client';

import React, { useState, useEffect, useCallback } from 'react';

// CHANGE: 2026-10-07 — owner follow-up: the career candidate Accounts admin now
// lives INSIDE the Careers page as a third tab (Job Listings | Applications |
// Accounts), and gains a manual "Create Account" option. The old standalone
// /admin/accounts page was deleted (the sidebar keeps ONE Careers entry).
//
// The table/search/edit/delete behaviour is unchanged from that page; the new
// part is the header "Create Account" button -> inline create panel that POSTs
// to /api/admin/careers/users (the POST endpoint added to that route the same
// day). Created accounts are identical to self-signups on the public /careers
// page (same email validation, password floor 6, unique-lite email -> 409).

type Account = {
  _id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  resumeUrl: string | null;
  resumeName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const EMPTY_CREATE = { fullName: '', phone: '', email: '', password: '' };

export default function AccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState<{ fullName: string; phone: string; email: string }>({
    fullName: '',
    phone: '',
    email: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/careers/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      const data = await res.json();
      if (data && !Array.isArray(data) && data.error) throw new Error(data.error);
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching accounts:', err);
      setError('Failed to load accounts.');
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(fetchAccounts, q ? 350 : 0);
    return () => clearTimeout(t);
  }, [q, fetchAccounts]);

  const openCreate = () => {
    setCreating(true);
    setCreateForm(EMPTY_CREATE);
    setError('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(createForm.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (createForm.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/careers/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create account');
      setCreating(false);
      setCreateForm(EMPTY_CREATE);
      fetchAccounts();
    } catch (err: any) {
      setError(err.message || 'Failed to create account.');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({ fullName: a.fullName ?? '', phone: a.phone ?? '', email: a.email });
    setError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!EMAIL_RE.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/careers/users/${editing._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save account');
      setEditing(null);
      fetchAccounts();
    } catch (err: any) {
      setError(err.message || 'Failed to save account.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/careers/users/${deleting._id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete account');
      }
      setDeleting(null);
      setDeleteConfirm('');
      setEditing(null);
      fetchAccounts();
    } catch (err: any) {
      setError(err.message || 'Failed to delete account.');
      setDeleting(null);
      setDeleteConfirm('');
    } finally {
      setSaving(false);
    }
  };

  const openResume = (url: string | null) => {
    if (!url) {
      alert('No resume on this account.');
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  return (
    <div>
      {/* Toolbar: search + create */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="text"
          placeholder="Search by name, email or phone…"
          className="w-full max-w-md p-4 bg-white rounded-2xl border border-slate-100 shadow-sm focus:ring-2 focus:ring-[#006569] focus:outline-none"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {!creating && (
          <button
            onClick={openCreate}
            className="shrink-0 bg-[#006569] text-white px-6 py-3 rounded-2xl font-bold hover:shadow-lg transition-all"
          >
            + Create Account
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">
          {error}
        </div>
      )}

      {/* Create panel */}
      {creating && (
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm mb-8">
          <h2 className="text-xl font-bold text-[#0f172a] mb-1">Create Candidate Account</h2>
          <p className="text-sm text-slate-500 mb-6">
            The candidate signs in on /careers with these credentials (email is the login identity).
          </p>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Full Name</label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Phone</label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={createForm.phone}
                onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                placeholder="Mobile / WhatsApp"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Email (login identity)</label>
              <input
                type="email"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                placeholder="name@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Password</label>
              <input
                type="password"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="At least 6 characters"
                required
              />
            </div>
            <div className="md:col-span-2 flex gap-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-[#006569] text-white px-8 py-3 rounded-2xl font-bold hover:shadow-lg transition-all disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Account'}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="bg-slate-100 text-slate-600 px-8 py-3 rounded-2xl font-bold"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit panel */}
      {editing && (
        <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm mb-8">
          <h2 className="text-xl font-bold text-[#0f172a] mb-6">Edit Account — {editing.email}</h2>
          <form onSubmit={handleSave} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Full Name</label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Phone</label>
              <input
                type="text"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Mobile / WhatsApp"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Email (login identity)</label>
              <input
                type="email"
                className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-[#006569]"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
              <p className="text-[10px] text-slate-400 font-medium mt-1">
                Changing the email moves the login identity. A value already used by another account is rejected.
              </p>
            </div>
            <div className="md:col-span-2 flex gap-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-[#006569] text-white px-8 py-3 rounded-2xl font-bold hover:shadow-lg transition-all disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="bg-slate-100 text-slate-600 px-8 py-3 rounded-2xl font-bold"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Name</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Email</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Phone</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Resume</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Signed Up</th>
                <th className="p-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-10 text-slate-400">Loading accounts…</td></tr>
              ) : accounts.length > 0 ? (
                accounts.map((a) => (
                  <tr key={a._id} className="border-b border-slate-50 hover:bg-slate-50/30 transition-colors">
                    <td className="p-4">
                      <div className="text-sm font-bold text-[#0f172a]">{a.fullName || <span className="text-slate-400">—</span>}</div>
                      {a.lastLoginAt && (
                        <div className="text-[10px] text-slate-400">Last login {new Date(a.lastLoginAt).toLocaleString()}</div>
                      )}
                    </td>
                    <td className="p-4 text-sm font-medium text-slate-600">{a.email}</td>
                    <td className="p-4">
                      <span className="text-sm font-black text-[#006569] tabular-nums">{a.phone || '—'}</span>
                    </td>
                    <td className="p-4">
                      {a.resumeUrl ? (
                        <button
                          onClick={() => openResume(a.resumeUrl)}
                          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-[#006569] text-white rounded-xl hover:shadow-lg transition-all"
                        >
                          {a.resumeName || 'Resume'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-bold">None</span>
                      )}
                    </td>
                    <td className="p-4 text-xs font-bold text-slate-500">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => openEdit(a)}
                        className="px-3 py-1 text-xs font-bold text-[#006569] hover:bg-teal-50 rounded-lg transition-colors border border-teal-100"
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => { setDeleting(a); setDeleteConfirm(''); }}
                        className="ml-2 px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-20 text-slate-400">
                    {q ? 'No accounts match that search.' : 'No candidate accounts yet. Use "Create Account" to add one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Typed-confirm delete modal */}
      {deleting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1001] flex items-center justify-center p-4" onClick={() => setDeleting(null)}>
          <div
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-black text-[#0f172a] mb-2">Delete this account?</h3>
            <p className="text-sm text-slate-500 mb-4">
              <span className="font-bold text-[#0f172a]">{deleting.fullName || deleting.email}</span> will lose
              access immediately — their sign-in sessions are revoked and their stored resume is removed.
              This cannot be undone.
            </p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Type <span className="text-red-600">DELETE</span> to confirm
            </p>
            <input
              type="text"
              className="w-full p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-red-400 font-bold"
              placeholder="DELETE"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              autoFocus
            />
            <div className="flex gap-4 mt-6">
              <button
                onClick={handleDelete}
                disabled={deleteConfirm.trim().toUpperCase() !== 'DELETE' || saving}
                className="bg-red-600 text-white px-8 py-3 rounded-2xl font-bold hover:shadow-lg transition-all disabled:opacity-40"
              >
                {saving ? 'Deleting…' : 'Delete Account'}
              </button>
              <button
                onClick={() => setDeleting(null)}
                className="bg-slate-100 text-slate-600 px-8 py-3 rounded-2xl font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
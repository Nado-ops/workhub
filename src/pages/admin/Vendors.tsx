import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Client } from '../../lib/types'
import { amount, shortDate, todayISO } from '../../lib/format'

type Cycle = 'monthly' | 'yearly' | 'once' | 'free'
interface Vendor {
  id: string
  name: string
  category: string | null
  purpose: string | null
  website: string | null
  account_email: string | null
  client_id: string | null
  cost: number
  currency: string
  billing_cycle: Cycle
  renewal_date: string | null
  remind_days_before: number
  status: 'active' | 'cancelled'
  notes: string | null
  client?: { name: string } | null
}

const CYCLE_TEXT: Record<Cycle, string> = { monthly: 'per month', yearly: 'per year', once: 'once-off', free: 'free' }
const CATEGORIES = ['Email sending', 'Hosting', 'Domain', 'Database', 'Theme / plugin licence', 'Software', 'Remote support', 'Design', 'Other']

const money = (n: number, cur: string) => (cur === 'ZAR' ? 'R' : cur + ' ') + amount(Number(n))
/** What it costs per month, so monthly and yearly services can be added up. */
const perMonth = (v: Vendor) => (v.billing_cycle === 'monthly' ? Number(v.cost) : v.billing_cycle === 'yearly' ? Number(v.cost) / 12 : 0)
const daysUntil = (iso: string) => Math.round((new Date(iso + 'T12:00').getTime() - new Date(todayISO() + 'T12:00').getTime()) / 86400000)

/** Vendors (admin only): every service and supplier you pay for, with renewal reminders. */
export default function Vendors() {
  const [rows, setRows] = useState<Vendor[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null)
  const [search, setSearch] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('vendors').select('*, client:clients(name)').order('renewal_date', { nullsFirst: false })
    if (error) setError(error.message.includes('vendors') ? 'Run migration 006 in Supabase to switch on Vendors.' : error.message)
    setRows((data as Vendor[] | null) ?? [])
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  const active = rows.filter((v) => v.status === 'active')
  const q = search.trim().toLowerCase()
  const shown = rows
    .filter((v) => showCancelled || v.status === 'active')
    .filter((v) => !q || [v.name, v.category, v.purpose, v.client?.name, v.account_email].some((x) => x?.toLowerCase().includes(q)))

  // Monthly spend, added up separately per currency (no guessing exchange rates)
  const spend = new Map<string, number>()
  active.forEach((v) => spend.set(v.currency, (spend.get(v.currency) ?? 0) + perMonth(v)))
  const soon = active.filter((v) => v.renewal_date && daysUntil(v.renewal_date) >= 0 && daysUntil(v.renewal_date) <= 30)
  const late = active.filter((v) => v.renewal_date && daysUntil(v.renewal_date) < 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Vendors</h1>
          <p className="mt-1 text-sm text-muted">Every service and supplier you pay for. Keep passwords in a password manager, not here.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'Close' : '+ Add vendor'}</button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
        <div className="card p-4">
          <p className="text-sm text-muted">Monthly spend</p>
          <p className="mt-1.5 text-2xl font-semibold">{spend.size === 0 ? 'R0' : [...spend.entries()].map(([c, n]) => money(Math.round(n * 100) / 100, c)).join(' + ')}</p>
          <p className="mt-1 text-xs text-soft">Yearly costs spread over 12 months</p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-muted">Active vendors</p>
          <p className="mt-1.5 text-2xl font-semibold">{active.length}</p>
          <p className="mt-1 text-xs text-soft">{active.filter((v) => v.client_id).length} linked to a client</p>
        </div>
        <div className={`card p-4 ${soon.length ? 'border-warn/30 bg-accent-soft' : ''}`}>
          <p className="text-sm text-muted">Renewing in 30 days</p>
          <p className={`mt-1.5 text-2xl font-semibold ${soon.length ? 'text-warn' : ''}`}>{soon.length}</p>
          <p className="mt-1 text-xs text-soft">{soon.slice(0, 2).map((v) => v.name).join(', ') || 'Nothing coming up'}</p>
        </div>
        {late.length > 0 && (
          <div className="card border-danger/30 bg-danger-soft p-4">
            <p className="text-sm text-muted">Renewal date passed</p>
            <p className="mt-1.5 text-2xl font-semibold text-danger">{late.length}</p>
            <p className="mt-1 text-xs text-soft">Update the next renewal date</p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {editing && (
        <VendorForm
          key={editing === 'new' ? 'new' : editing.id}
          vendor={editing === 'new' ? null : editing}
          clients={clients}
          onDone={() => { setEditing(null); load() }}
          onClose={() => setEditing(null)}
        />
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <label className="flex h-10 flex-[1_1_260px] items-center gap-2 rounded-xl border border-line bg-well px-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-muted" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input aria-label="Search vendors" className="flex-1 bg-transparent text-sm outline-none" placeholder="Search by name, use, client or account" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-soft">
            <input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Show cancelled
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="p-5 text-sm text-muted">{rows.length === 0 ? 'No vendors yet. Add the services you use, like Resend, Cloudflare and Supabase.' : 'Nothing matches.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead><tr><th className="th">Vendor</th><th className="th">For</th><th className="th">Account</th><th className="th">Cost</th><th className="th">Renews</th><th className="th"></th></tr></thead>
              <tbody>
                {shown.map((v) => {
                  const d = v.renewal_date ? daysUntil(v.renewal_date) : null
                  const tone = d === null ? 'text-muted' : d < 0 ? 'text-danger' : d <= v.remind_days_before ? 'text-warn font-semibold' : 'text-soft'
                  return (
                    <tr key={v.id} className={v.status === 'cancelled' ? 'opacity-50' : ''}>
                      <td className="td">
                        <p className="font-medium">{v.name}</p>
                        <p className="text-xs text-muted">{v.category ?? '—'}{v.purpose ? ` · ${v.purpose}` : ''}</p>
                      </td>
                      <td className="td text-soft">{v.client?.name ?? 'Internal'}</td>
                      <td className="td text-xs text-soft">
                        {v.account_email ?? '—'}
                        {v.website && <a href={v.website} target="_blank" rel="noreferrer" className="block text-accent-text no-underline">Open website ↗</a>}
                      </td>
                      <td className="td">
                        <p className="font-semibold">{v.billing_cycle === 'free' ? 'Free' : money(v.cost, v.currency)}</p>
                        <p className="text-xs text-muted">{CYCLE_TEXT[v.billing_cycle]}</p>
                      </td>
                      <td className={`td ${tone}`}>
                        {v.renewal_date ? shortDate(v.renewal_date) : '—'}
                        {d !== null && <p className="text-xs">{d < 0 ? `${-d} days ago` : d === 0 ? 'today' : `in ${d} days`}</p>}
                      </td>
                      <td className="td text-right"><button className="btn-ghost h-8 px-3 text-xs" onClick={() => setEditing(v)}>Edit</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted">Every morning at 08:00 admins get one email listing anything that renews within its reminder window.</p>
    </div>
  )
}

function VendorForm({
  vendor, clients, onDone, onClose,
}: { vendor: Vendor | null; clients: Pick<Client, 'id' | 'name'>[]; onDone: () => void; onClose: () => void }) {
  const [f, setF] = useState({
    name: vendor?.name ?? '',
    category: vendor?.category ?? 'Email sending',
    purpose: vendor?.purpose ?? '',
    website: vendor?.website ?? '',
    account_email: vendor?.account_email ?? '',
    client_id: vendor?.client_id ?? '',
    cost: String(vendor?.cost ?? ''),
    currency: vendor?.currency ?? 'ZAR',
    billing_cycle: vendor?.billing_cycle ?? ('monthly' as Cycle),
    renewal_date: vendor?.renewal_date ?? '',
    remind_days_before: String(vendor?.remind_days_before ?? 14),
    status: vendor?.status ?? 'active',
    notes: vendor?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string) => setF((cur) => ({ ...cur, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    let website = f.website.trim()
    if (website && !/^https?:\/\//.test(website)) website = 'https://' + website
    const row = {
      name: f.name.trim(), category: f.category || null, purpose: f.purpose.trim() || null, website: website || null,
      account_email: f.account_email.trim() || null, client_id: f.client_id || null,
      cost: f.billing_cycle === 'free' ? 0 : Number(f.cost.replace(',', '.')) || 0, currency: f.currency, billing_cycle: f.billing_cycle,
      renewal_date: f.renewal_date || null, remind_days_before: Math.min(90, Math.max(0, Number(f.remind_days_before) || 14)),
      status: f.status, notes: f.notes.trim() || null,
    }
    const { error } = vendor ? await supabase.from('vendors').update(row).eq('id', vendor.id) : await supabase.from('vendors').insert(row)
    if (error) setError(error.message)
    else onDone()
  }
  async function remove() {
    if (!vendor) return
    const { error } = await supabase.from('vendors').delete().eq('id', vendor.id)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
      <div className="flex basis-full items-center justify-between">
        <h2 className="text-lg font-semibold">{vendor ? vendor.name : 'New vendor'}</h2>
        <button type="button" className="btn-ghost h-9" onClick={onClose}>Close</button>
      </div>
      <label className="label flex-[2_1_200px]">Name<input className="input" required value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Resend" /></label>
      <label className="label flex-[1_1_180px]">Category
        <select className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="label flex-[2_1_240px]">What we use it for<input className="input" value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="Work Hub email notifications" /></label>
      <label className="label flex-[1_1_200px]">Website<input className="input" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="resend.com" /></label>
      <label className="label flex-[1_1_220px]">Account email (which login owns it)<input className="input" type="email" value={f.account_email} onChange={(e) => set('account_email', e.target.value)} /></label>
      <label className="label flex-[1_1_200px]">For
        <select className="input" value={f.client_id} onChange={(e) => set('client_id', e.target.value)}>
          <option value="">Internal (our business)</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="label flex-[1_1_140px]">Billing
        <select className="input" value={f.billing_cycle} onChange={(e) => set('billing_cycle', e.target.value)}>
          <option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="once">Once-off</option><option value="free">Free</option>
        </select>
      </label>
      {f.billing_cycle !== 'free' && (
        <>
          <label className="label flex-[1_1_120px]">Cost<input className="input" inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></label>
          <label className="label flex-[0_1_100px]">Currency
            <select className="input" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{['ZAR', 'USD', 'EUR', 'GBP'].map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </>
      )}
      <label className="label flex-[1_1_150px]">Next renewal<input className="input" type="date" value={f.renewal_date} onChange={(e) => set('renewal_date', e.target.value)} /></label>
      <label className="label flex-[1_1_150px]">Remind me (days before)<input className="input" type="number" min={0} max={90} value={f.remind_days_before} onChange={(e) => set('remind_days_before', e.target.value)} /></label>
      <label className="label flex-[1_1_130px]">Status
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="active">Active</option><option value="cancelled">Cancelled</option></select>
      </label>
      <label className="label basis-full">Notes<textarea className="input h-20 py-2" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Plan, limits, who to contact… (no passwords)" /></label>
      <button className="btn-primary">{vendor ? 'Save changes' : 'Add vendor'}</button>
      {vendor && <button type="button" className="btn-ghost" onClick={remove}>Delete</button>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}

import { Link } from 'react-router-dom'
import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Client } from '../../lib/types'
import { rand } from '../../lib/format'

type Row = Client & { tickets: { count: number }[] }

export default function Clients() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [pick, setPick] = useState<string | null>(null)

  async function load() {
    // tickets(count) asks Supabase to count each client's tickets for us
    const { data, error } = await supabase.from('clients').select('*, tickets(count)').order('name')
    if (error) setError(error.message)
    setRows((data as Row[] | null) ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const selected = rows.find((r) => r.id === pick) ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="mt-1 text-sm text-muted">{rows.length} {rows.length === 1 ? 'client' : 'clients'}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Close' : '+ Add client'}</button>
      </div>

      {showNew && <ClientForm onSaved={() => { setShowNew(false); load() }} />}
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-start gap-4">
        <section aria-label="Client list" className="card min-w-0 flex-[1.5_1_460px] overflow-hidden">
          {loading ? <p className="p-5 text-sm text-muted">Loading…</p> : rows.length === 0 ? (
            <p className="p-5 text-sm text-muted">No clients yet. Add your first one.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr><th className="th">Client</th><th className="th">Plan</th><th className="th">Monthly</th><th className="th">Tickets</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} onClick={() => setPick(c.id)} className={`cursor-pointer ${pick === c.id ? 'bg-hover' : 'hover:bg-hover'}`}>
                    <td className="td font-medium">
                      <button className="cursor-pointer text-left" aria-pressed={pick === c.id}>{c.name}</button>
                    </td>
                    <td className="td text-soft">{c.plan || '—'}</td>
                    <td className="td text-soft">{c.monthly_fee ? rand(Number(c.monthly_fee)) : '—'}</td>
                    <td className="td">{c.tickets?.[0]?.count ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside aria-label="Client details" className="card flex min-w-0 flex-[1_1_320px] flex-col gap-4 p-5">
          {selected ? (
            <>
              <ClientForm key={selected.id} client={selected} onSaved={load} />
              <ClientPeople key={'p' + selected.id} clientId={selected.id} />
            </>
          ) : (
            <p className="text-sm text-muted">Pick a client to see and edit their details.</p>
          )}
        </aside>
      </div>
    </div>
  )
}

function ClientForm({ client, onSaved }: { client?: Client; onSaved: () => void }) {
  const [name, setName] = useState(client?.name ?? '')
  const [plan, setPlan] = useState(client?.plan ?? '')
  const [fee, setFee] = useState(String(client?.monthly_fee ?? ''))
  const [hours, setHours] = useState(String(client?.support_hours_per_month ?? ''))
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [billing, setBilling] = useState(client?.billing_details ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const row = {
      name: name.trim(),
      plan: plan.trim() || null,
      monthly_fee: Number(fee) || 0,
      support_hours_per_month: Number(hours) || 0,
      notes: notes.trim() || null,
      billing_details: billing.trim() || null,
    }
    const { error } = client
      ? await supabase.from('clients').update(row).eq('id', client.id)
      : await supabase.from('clients').insert(row)
    setBusy(false)
    setMsg(error ? error.message : 'Saved.')
    if (!error) onSaved()
  }

  return (
    <form onSubmit={submit} className={`flex flex-wrap items-end gap-3 ${client ? '' : 'card p-5'}`}>
      {client && <h2 className="basis-full text-lg font-semibold">{client.name}</h2>}
      <label className="label flex-[2_1_200px]">Company name
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="label flex-[1_1_140px]">Plan
        <input className="input" placeholder="Care plan, Nova SIS…" value={plan} onChange={(e) => setPlan(e.target.value)} />
      </label>
      <label className="label flex-[1_1_120px]">Monthly fee (R)
        <input className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
      </label>
      <label className="label flex-[1_1_120px]">Support hours / month
        <input className="input" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      <label className="label basis-full">Billing details (printed on invoices)
        <textarea className="input h-16 py-2" value={billing} onChange={(e) => setBilling(e.target.value)} placeholder={'Address\nVAT number'} />
      </label>
      <label className="label basis-full">Internal notes
        <textarea className="input h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="btn-primary" disabled={busy}>{client ? 'Save changes' : 'Add client'}</button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
      {client && <Link to={`/app/report?client=${client.id}`} className="btn-ghost no-underline">Monthly report</Link>}
      {client && (
        <p className="basis-full text-xs text-muted">
          To give someone from {client.name} a login: invite them in Supabase (Authentication → Users → Invite), then link them to this company on Team &amp; roles.
        </p>
      )}
    </form>
  )
}

interface Person { id: string; full_name: string; job_title: string | null; email: string | null; phone: string | null; is_primary: boolean }

/** The people at this client (contacts table, migration 007). Deals that are won bring their people here. */
function ClientPeople({ clientId }: { clientId: string }) {
  const [people, setPeople] = useState<Person[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('contacts').select('id, full_name, job_title, email, phone, is_primary')
      .eq('client_id', clientId).order('is_primary', { ascending: false }).order('full_name')
    if (error) setError(error.message)
    setPeople((data as Person[] | null) ?? [])
  }
  useEffect(() => { load() }, [clientId])

  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('contacts').insert({
      client_id: clientId, full_name: name.trim(), email: email.trim() || null, phone: phone.trim() || null, is_primary: people.length === 0,
    })
    if (error) return setError(error.message)
    setName(''); setEmail(''); setPhone('')
    load()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 className="font-semibold">People</h3>
      {people.length === 0 && <p className="text-sm text-muted">No people saved yet.</p>}
      {people.map((c) => (
        <div key={c.id} className="flex items-start justify-between gap-2 text-sm">
          <div>
            <p className="font-medium">{c.full_name} {c.is_primary && <span className="pill ml-1 text-accent-text">Main</span>}</p>
            <p className="text-xs text-muted">
              {[c.job_title, c.email, c.phone].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <button className="text-xs text-muted hover:text-danger" onClick={() => remove(c.id)} aria-label={`Remove ${c.full_name}`}>Remove</button>
        </div>
      ))}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <input className="input flex-[1_1_140px]" aria-label="Name" placeholder="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input flex-[1_1_160px]" aria-label="Email" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input flex-[1_1_120px]" aria-label="Phone" placeholder="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button className="btn-ghost h-11">Add</button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}

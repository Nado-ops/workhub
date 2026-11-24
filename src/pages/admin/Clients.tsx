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
                  <tr key={c.id} onClick={() => setPick(c.id)} className={`cursor-pointer ${pick === c.id ? 'bg-[#13282A]' : 'hover:bg-[#13282A]'}`}>
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
            <ClientForm key={selected.id} client={selected} onSaved={load} />
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
      <label className="label basis-full">Internal notes
        <textarea className="input h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <button className="btn-primary" disabled={busy}>{client ? 'Save changes' : 'Add client'}</button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
      {client && (
        <p className="basis-full text-xs text-muted">
          To give someone from {client.name} a login: invite them in Supabase (Authentication → Users → Invite), then link them to this company on Team &amp; roles.
        </p>
      )}
    </form>
  )
}

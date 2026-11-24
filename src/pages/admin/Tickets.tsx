import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Client, Priority, Ticket } from '../../lib/types'
import { PRIORITY_LABEL, PRIORITY_STYLE, STATUS_LABEL, STATUS_STYLE, slaClock, ticketRef, timeAgo } from '../../lib/format'

type Row = Ticket & { client: { name: string } | null; assignee: { full_name: string } | null }
type Tab = 'all' | 'action' | 'waiting' | 'escalated'

/** The support ticket queue for admin and staff, sorted by deadline. */
export default function Tickets() {
  const [rows, setRows] = useState<Row[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [tab, setTab] = useState<Tab>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [, setTick] = useState(0)

  async function load() {
    const { data, error } = await supabase
      .from('tickets')
      .select('*, client:clients(name), assignee:profiles!tickets_assignee_id_fkey(full_name)')
      .not('status', 'in', '(resolved,closed)')
      .order('due_at', { ascending: true })
    if (error) setError(error.message)
    setRows((data as Row[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
    const t = setInterval(() => setTick((n) => n + 1), 60_000) // refresh the clocks every minute
    return () => clearInterval(t)
  }, [])

  const withClock = rows.map((r) => ({ ...r, clock: slaClock(r.due_at, r.status) }))
  const counts = useMemo(() => {
    const c = { breach: 0, soon: 0, today: 0, later: 0, paused: 0 }
    withClock.forEach((r) => {
      if (r.clock.risk in c) c[r.clock.risk as keyof typeof c]++
    })
    return c
  }, [withClock])

  const needsAction = (r: (typeof withClock)[number]) => ['breach', 'soon', 'today'].includes(r.clock.risk)
  const filtered = withClock.filter((r) =>
    tab === 'all' ? true : tab === 'action' ? needsAction(r) : tab === 'waiting' ? r.status === 'waiting_on_client' : r.status === 'escalated',
  )
  const tabs: [Tab, string, number][] = [
    ['all', 'All open', withClock.length],
    ['action', 'Needs action', withClock.filter(needsAction).length],
    ['waiting', 'Waiting on client', withClock.filter((r) => r.status === 'waiting_on_client').length],
    ['escalated', 'Escalated', withClock.filter((r) => r.status === 'escalated').length],
  ]
  const atRisk = counts.breach + counts.soon

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Support tickets</h1>
          <p className="mt-1 text-sm text-muted">
            {withClock.length} open · {withClock.filter(needsAction).length} need action today · {atRisk} at deadline risk
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Close' : '+ New ticket'}</button>
      </div>

      {showNew && <NewTicketForm clients={clients} onCreated={() => { setShowNew(false); load() }} />}

      <section aria-label="Deadline risk" className="card p-4">
        <p className="text-[11px] tracking-widest text-muted">◷ DEADLINE RISK</p>
        <p className="mt-1 font-semibold">
          {atRisk === 0 ? 'Nothing is close to its deadline' : `${atRisk} ${atRisk === 1 ? 'ticket is' : 'tickets are'} late or due within 4 hours`}
        </p>
        <div className="mt-3 mb-2.5 flex h-2 gap-1">
          {([['breach', '#FF7A7A'], ['soon', '#F5C46A'], ['today', '#E8D77A'], ['later', '#3FD0B5'], ['paused', '#33464A']] as const).map(([k, c]) =>
            counts[k] > 0 ? <div key={k} className="rounded" style={{ flex: counts[k], background: c, minWidth: 12 }} /> : null,
          )}
          {withClock.length === 0 && <div className="flex-1 rounded bg-[#1A292C]" />}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-soft">
          <span><span className="text-[#FF7A7A]">●</span> Late <b>{counts.breach}</b></span>
          <span><span className="text-warn">●</span> Under 4 h <b>{counts.soon}</b></span>
          <span><span className="text-[#E8D77A]">●</span> Today <b>{counts.today}</b></span>
          <span><span className="text-accent">●</span> Later <b>{counts.later}</b></span>
          <span><span className="text-muted">●</span> Paused <b>{counts.paused}</b></span>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div role="tablist" className="flex flex-wrap gap-1 border-b border-line px-4">
          {tabs.map(([k, name, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`-mb-px h-11 cursor-pointer border-b-2 px-3 text-sm ${tab === k ? 'border-accent font-semibold text-text' : 'border-transparent text-muted'}`}
            >
              {name} <span className="ml-1 rounded-md bg-[#1A2B2E] px-1.5 py-0.5 text-[11px] text-soft">{n}</span>
            </button>
          ))}
        </div>

        {error && <p className="p-5 text-sm text-danger">{error}</p>}
        {loading ? (
          <p className="p-5 text-sm text-muted">Loading tickets…</p>
        ) : filtered.length === 0 ? (
          <p className="p-5 text-sm text-muted">No tickets here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr>
                  <th className="th">Ticket</th><th className="th">Client</th><th className="th">Priority</th>
                  <th className="th">Status</th><th className="th">Assignee</th><th className="th">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-[#13282A]">
                    <td className="td">
                      <Link to={`/app/tickets/${r.id}`} className="font-medium text-text no-underline hover:text-accent">{r.title}</Link>
                      <p className="mt-0.5 text-xs text-muted">{ticketRef(r.id)} · opened {timeAgo(r.created_at)}</p>
                    </td>
                    <td className="td text-soft">{r.client?.name ?? '—'}</td>
                    <td className="td"><span className={`pill ${PRIORITY_STYLE[r.priority]}`}>{PRIORITY_LABEL[r.priority]}</span></td>
                    <td className="td"><span className={`pill ${STATUS_STYLE[r.status]}`}>● {STATUS_LABEL[r.status]}</span></td>
                    <td className="td text-soft">{r.assignee?.full_name || <span className="text-muted">Unassigned</span>}</td>
                    <td className={`td ${r.clock.tone}`}>{r.clock.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function NewTicketForm({ clients, onCreated }: { clients: Pick<Client, 'id' | 'name'>[]; onCreated: () => void }) {
  const [clientId, setClientId] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('tickets').insert({ client_id: clientId, title: title.trim(), priority, description: description.trim() || null })
    setBusy(false)
    if (error) setError(error.message)
    else onCreated()
  }

  if (clients.length === 0) {
    return <div className="card p-5 text-sm text-muted">Add a client first (Clients page), then you can log tickets for them.</div>
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
      <label className="label flex-[1_1_200px]">Client
        <select className="input" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Choose…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="label flex-[2_1_260px]">What's the problem?
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="label flex-[1_1_140px]">Priority
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          <option value="urgent">Urgent (1 h)</option><option value="high">High (4 h)</option>
          <option value="normal">Normal (24 h)</option><option value="low">Low (3 days)</option>
        </select>
      </label>
      <label className="label basis-full">Details (optional)
        <textarea className="input h-20 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
      <button className="btn-primary" disabled={busy}>Create ticket</button>
    </form>
  )
}

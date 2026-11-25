import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { canDo, useAuth } from '../../auth/AuthProvider'
import { rand, shortDate, timeAgo, todayISO } from '../../lib/format'
import Tabs from '../../components/Tabs'
import LeadForms from '../../components/LeadForms'

type Stage = 'lead' | 'contacted' | 'proposal_sent' | 'negotiation' | 'won' | 'lost'
type Source = 'referral' | 'website' | 'social_media' | 'cold_outreach' | 'event' | 'existing_client' | 'other'
type Kind = 'call' | 'email' | 'meeting' | 'note'

interface Contact {
  id: string
  deal_id: string | null
  client_id: string | null
  full_name: string
  job_title: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
}
interface Activity {
  id: string
  kind: Kind
  summary: string
  happened_at: string
  user_id: string | null
  person: { full_name: string } | null
}
interface Deal {
  id: string
  company: string
  client_id: string | null
  description: string | null
  amount: number
  stage: Stage
  source: Source | null
  owner_id: string | null
  next_step: string | null
  next_step_on: string | null
  created_at: string
  owner: { full_name: string } | null
  contacts: Contact[]
  lead_source: { name: string } | null // the website a lead came from (migration 014)
}

const STAGES: { key: Stage; label: string; colour: string }[] = [
  { key: 'lead', label: 'Lead', colour: 'text-muted' },
  { key: 'contacted', label: 'Contacted', colour: 'text-info' },
  { key: 'proposal_sent', label: 'Proposal sent', colour: 'text-warn' },
  { key: 'negotiation', label: 'Negotiation', colour: 'text-violet' },
  { key: 'won', label: 'Won', colour: 'text-accent-text' },
]
const OPEN: Stage[] = ['lead', 'contacted', 'proposal_sent', 'negotiation']

// Where a lead came from. The database only accepts these keys (migration 007).
const SOURCES: { key: Source; label: string }[] = [
  { key: 'referral', label: 'Referral' },
  { key: 'website', label: 'Website' },
  { key: 'social_media', label: 'Social media' },
  { key: 'cold_outreach', label: 'Cold outreach' },
  { key: 'event', label: 'Event' },
  { key: 'existing_client', label: 'Existing client' },
  { key: 'other', label: 'Other' },
]
const sourceLabel = (s: Source | null) => SOURCES.find((x) => x.key === s)?.label ?? null

const KINDS: { key: Kind; label: string; icon: string }[] = [
  { key: 'call', label: 'Call', icon: '📞' },
  { key: 'email', label: 'Email', icon: '✉️' },
  { key: 'meeting', label: 'Meeting', icon: '🤝' },
  { key: 'note', label: 'Note', icon: '📝' },
]

/** The CRM pipeline: deals in columns by stage. Click a deal to see its details, people and history. */
export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [openId, setOpenId] = useState<string | 'new' | null>(null)
  const [showLost, setShowLost] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<Source | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [forms, setForms] = useState(false)
  const { profile } = useAuth()

  async function load() {
    const { data, error } = await supabase
      .from('deals')
      .select('*, owner:profiles(full_name), contacts(*), lead_source:lead_sources(name)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setDeals((data as Deal[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function move(d: Deal, stage: Stage) {
    const { error } = await supabase.from('deals').update({ stage }).eq('id', d.id)
    if (error) setError(error.message)
    else load()
  }

  const shown = sourceFilter ? deals.filter((d) => d.source === sourceFilter) : deals
  const open = shown.filter((d) => OPEN.includes(d.stage))
  const monthStart = todayISO().slice(0, 8) + '01'
  const sum = (list: Deal[]) => list.reduce((s, d) => s + Number(d.amount), 0)
  const lost = shown.filter((d) => d.stage === 'lost')
  const current = openId && openId !== 'new' ? deals.find((d) => d.id === openId) ?? null : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">CRM pipeline</h1>
          <p className="mt-1 text-sm text-muted">
            {open.length} open deals worth <b className="text-text">{rand(sum(open))}</b> · {shown.filter((d) => d.stage === 'won' && d.created_at >= monthStart).length} won this month
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input h-10 w-auto" aria-label="Lead source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as Source | '')}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {profile?.role === 'admin' && <button className="btn-ghost" onClick={() => setForms((v) => !v)}>Website forms</button>}
          <button className="btn-primary" onClick={() => setOpenId(openId === 'new' ? null : 'new')}>{openId === 'new' ? 'Close' : '+ New deal'}</button>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {forms && <LeadForms onClose={() => { setForms(false); load() }} />}
      {openId === 'new' && <DealForm key="new" deal={null} onSaved={(id) => { load(); setOpenId(id) }} onDeleted={() => {}} />}
      {current && <DealPanel key={current.id} deal={current} onChange={load} onClose={() => { setOpenId(null); load() }} />}

      <div className="overflow-x-auto pb-1.5">
        <div className="grid min-w-[980px] grid-cols-5 items-start gap-3">
          {STAGES.map((s, si) => {
            const list = shown.filter((d) => d.stage === s.key)
            return (
              <section key={s.key} aria-label={s.label} className="flex min-h-[420px] flex-col gap-2.5 rounded-2xl border border-line bg-raised p-3">
                <div className="px-1 pb-1">
                  <div className="flex justify-between"><span className={`text-sm font-semibold ${s.colour}`}>● {s.label}</span><span className="text-xs text-muted">{list.length}</span></div>
                  <p className="mt-1 text-sm text-soft">{rand(sum(list))}</p>
                </div>
                {list.map((d) => {
                  const due = d.next_step_on && d.next_step_on <= todayISO()
                  const main = d.contacts.find((c) => c.is_primary) ?? d.contacts[0]
                  return (
                    <article key={d.id} className={`flex flex-col gap-2 rounded-xl border bg-panel p-3 ${openId === d.id ? 'border-accent' : 'border-line'}`}>
                      <button className="cursor-pointer text-left font-semibold hover:text-accent-text" onClick={() => setOpenId(d.id)}>{d.company}</button>
                      {d.description && <p className="text-xs text-muted">{d.description}</p>}
                      {main && <p className="text-xs text-soft">👤 {main.full_name}{d.contacts.length > 1 ? ` +${d.contacts.length - 1}` : ''}</p>}
                      <div className="flex items-center justify-between gap-2">
                        <b className="whitespace-nowrap">{rand(Number(d.amount))}</b>
                        <span className="min-w-0 truncate text-[11px] text-muted" title={d.lead_source?.name}>{d.lead_source ? `🌐 ${d.lead_source.name}` : sourceLabel(d.source) ?? d.owner?.full_name?.split(' ')[0] ?? ''}</span>
                      </div>
                      {d.next_step && (
                        <p className={`rounded-lg px-2 py-1.5 text-xs ${due ? 'bg-warn-soft text-warn' : 'bg-raised text-soft'}`}>
                          {d.next_step}{d.next_step_on ? ` · ${shortDate(d.next_step_on)}` : ''}
                        </p>
                      )}
                      {s.key === 'won' && (d.client_id
                        ? <Link to="/app/clients" className="text-xs text-accent-text">✓ Client</Link>
                        : <button className="text-left text-xs text-accent-text hover:underline" onClick={() => setOpenId(d.id)}>Make them a client →</button>)}
                      {si < STAGES.length - 1 && (
                        <div className="flex gap-1.5">
                          <button className="btn h-8 flex-1 border border-accent/50 bg-transparent px-2 text-xs font-normal text-accent-text" onClick={() => move(d, STAGES[si + 1].key)}>
                            Move to {STAGES[si + 1].label} →
                          </button>
                          <button className="btn h-8 border border-line bg-transparent px-2 text-xs font-normal text-muted" onClick={() => move(d, 'lost')} title="Mark as lost">Lost</button>
                        </div>
                      )}
                    </article>
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>

      {lost.length > 0 && (
        <section className="card p-4">
          <button className="cursor-pointer text-sm text-soft" onClick={() => setShowLost((v) => !v)} aria-expanded={showLost}>
            {showLost ? '▾' : '▸'} {lost.length} lost {lost.length === 1 ? 'deal' : 'deals'}
          </button>
          {showLost && lost.map((d) => (
            <div key={d.id} className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-sm">
              <span>{d.company} <span className="text-muted">· {rand(Number(d.amount))}</span></span>
              <button className="btn-ghost h-8 px-3 text-xs" onClick={() => move(d, 'lead')}>Reopen</button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

/** One deal opened up: Details, People and Activity tabs, plus the "make them a client" step. */
function DealPanel({ deal, onChange, onClose }: { deal: Deal; onChange: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<'details' | 'people' | 'activity'>('activity')
  return (
    <section className="card overflow-hidden" aria-label={`Deal: ${deal.company}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-lg font-semibold">{deal.company}</h2>
          <p className="text-sm text-muted">
            {rand(Number(deal.amount))} · {deal.stage === 'lost' ? 'Lost' : STAGES.find((s) => s.key === deal.stage)?.label}
            {deal.lead_source ? ` · from ${deal.lead_source.name}` : deal.source ? ` · from ${sourceLabel(deal.source)}` : ''}
          </p>
        </div>
        <button className="btn-ghost h-9 px-3 text-sm" onClick={onClose}>Close</button>
      </div>
      <ConvertBar deal={deal} onDone={onChange} />
      <Tabs
        tabs={[
          { key: 'activity', label: 'Activity' },
          { key: 'people', label: 'People', count: deal.contacts.length },
          { key: 'details', label: 'Details' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="p-5">
        {tab === 'activity' && <ActivityTab dealId={deal.id} />}
        {tab === 'people' && <PeopleTab deal={deal} onChange={onChange} />}
        {tab === 'details' && <DealForm deal={deal} onSaved={onChange} onDeleted={onClose} bare />}
      </div>
    </section>
  )
}

/** Shows when a deal is won: turn it into a client (and a draft quote, for admins). */
function ConvertBar({ deal, onDone }: { deal: Deal; onDone: () => void }) {
  const { profile } = useAuth()
  const isAdmin = canDo(profile, 'finance') // only people who can see Finance get a draft quote
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ quote: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (deal.stage !== 'won' && deal.stage !== 'negotiation') return null

  async function convert() {
    setBusy(true); setError(null)
    // convert_deal (migration 007) creates the client, links the people, marks the deal won
    // and, for admins, makes a draft quote for the deal value.
    const { data, error } = await supabase.rpc('convert_deal', { p_deal_id: deal.id, p_make_quote: isAdmin })
    setBusy(false)
    if (error) return setError(error.message)
    setResult({ quote: Boolean((data as { quote_id: string | null }).quote_id) })
    onDone()
  }

  if (deal.client_id && !result) {
    return <p className="mx-5 mb-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-soft">✓ This deal is a client now. <Link to="/app/clients" className="text-accent-text">Open Clients</Link></p>
  }
  return (
    <div className="mx-5 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/50 bg-accent-soft px-4 py-3">
      {result ? (
        <p className="text-sm">
          ✓ Done. <Link to="/app/clients" className="text-accent-text">See the new client</Link>
          {result.quote && <> · <Link to="/app/finance" className="text-accent-text">Open the draft quote in Finance</Link></>}
        </p>
      ) : (
        <>
          <p className="text-sm text-soft">
            {deal.stage === 'won' ? 'Won! ' : 'Ready to close? '}
            Make <b className="text-text">{deal.company}</b> a client{isAdmin ? ' and start a draft quote' : ''}. Their people come along.
          </p>
          <button className="btn-primary h-9" onClick={convert} disabled={busy}>{busy ? 'Working…' : isAdmin ? 'Make client + quote' : 'Make client'}</button>
        </>
      )}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </div>
  )
}

/** Calls, emails, meetings and notes on a deal, newest first. */
function ActivityTab({ dealId }: { dealId: string }) {
  const { profile } = useAuth()
  const [items, setItems] = useState<Activity[]>([])
  const [kind, setKind] = useState<Kind>('call')
  const [summary, setSummary] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase
      .from('deal_activities')
      .select('*, person:profiles(full_name)')
      .eq('deal_id', dealId)
      .order('happened_at', { ascending: false })
    if (error) setError(error.message)
    setItems((data as Activity[] | null) ?? [])
  }
  useEffect(() => { load() }, [dealId])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!summary.trim()) return
    const { error } = await supabase.from('deal_activities').insert({ deal_id: dealId, kind, summary: summary.trim() })
    if (error) return setError(error.message)
    setSummary('')
    load()
  }
  async function remove(id: string) {
    const { error } = await supabase.from('deal_activities').delete().eq('id', id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div role="radiogroup" aria-label="Type" className="flex gap-1">
          {KINDS.map((k) => (
            <button key={k.key} type="button" role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}
              className={`h-11 rounded-xl border px-3 text-sm ${kind === k.key ? 'border-accent text-text' : 'border-line text-muted'}`}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
        <input className="input flex-[1_1_260px]" aria-label="What happened" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Spoke to Sam — wants the booking calendar too" />
        <button className="btn-primary h-11">Log it</button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
      {items.length === 0 && <p className="text-sm text-muted">Nothing logged yet. Log each call, email or meeting so the whole team can see where things stand.</p>}
      <ol className="flex flex-col">
        {items.map((a) => (
          <li key={a.id} className="flex gap-3 border-t border-line py-3 first:border-t-0">
            <span className="text-lg" aria-hidden>{KINDS.find((k) => k.key === a.kind)?.icon}</span>
            <div className="flex-1">
              <p className="text-sm">{a.summary}</p>
              <p className="mt-0.5 text-xs text-muted">{KINDS.find((k) => k.key === a.kind)?.label} · {a.person?.full_name ?? 'Someone'} · {timeAgo(a.happened_at)}</p>
            </div>
            {(profile?.role === 'admin' || a.user_id === profile?.id) && (
              <button className="text-xs text-muted hover:text-danger" onClick={() => remove(a.id)} aria-label="Delete this entry">Delete</button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The people at the company. One can be marked as the main contact. */
function PeopleTab({ deal, onChange }: { deal: Deal; onChange: () => void }) {
  const blank = { full_name: '', job_title: '', email: '', phone: '' }
  const [form, setForm] = useState(blank)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('contacts').insert({
      deal_id: deal.id,
      client_id: deal.client_id, // if the deal is already a client, the person is added there too
      full_name: form.full_name.trim(),
      job_title: form.job_title.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      is_primary: deal.contacts.length === 0, // the first person becomes the main contact
    })
    if (error) return setError(error.message)
    setForm(blank)
    onChange()
  }
  async function makeMain(c: Contact) {
    // Only one main contact per deal: clear the others first.
    await supabase.from('contacts').update({ is_primary: false }).eq('deal_id', deal.id)
    const { error } = await supabase.from('contacts').update({ is_primary: true }).eq('id', c.id)
    if (error) setError(error.message)
    onChange()
  }
  async function remove(c: Contact) {
    const { error } = await supabase.from('contacts').delete().eq('id', c.id)
    if (error) setError(error.message)
    else onChange()
  }

  return (
    <div className="flex flex-col gap-4">
      {deal.contacts.length === 0 && <p className="text-sm text-muted">No people yet. Add who you're talking to at {deal.company}.</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {deal.contacts.map((c) => (
          <li key={c.id} className="rounded-xl border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{c.full_name} {c.is_primary && <span className="pill ml-1 text-accent-text">Main</span>}</p>
                {c.job_title && <p className="text-xs text-muted">{c.job_title}</p>}
              </div>
              <div className="flex gap-2 text-xs">
                {!c.is_primary && <button className="text-muted hover:text-accent-text" onClick={() => makeMain(c)}>Make main</button>}
                <button className="text-muted hover:text-danger" onClick={() => remove(c)} aria-label={`Remove ${c.full_name}`}>Remove</button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {c.email && <a href={`mailto:${c.email}`} className="text-accent-text">{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="text-soft">{c.phone}</a>}
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
        <label className="label flex-[2_1_180px]">Name<input className="input" required value={form.full_name} onChange={(e) => set('full_name', e.target.value)} /></label>
        <label className="label flex-[1_1_150px]">Job title<input className="input" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} placeholder="Owner" /></label>
        <label className="label flex-[2_1_200px]">Email<input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="label flex-[1_1_150px]">Phone<input className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <button className="btn-primary">Add person</button>
        {error && <p className="basis-full text-sm text-danger">{error}</p>}
      </form>
    </div>
  )
}

function DealForm({ deal, onSaved, onDeleted, bare }: { deal: Deal | null; onSaved: (id: string) => void; onDeleted: () => void; bare?: boolean }) {
  const [company, setCompany] = useState(deal?.company ?? '')
  const [description, setDescription] = useState(deal?.description ?? '')
  const [amount, setAmount] = useState(String(deal?.amount ?? ''))
  const [stage, setStage] = useState<Stage>(deal?.stage ?? 'lead')
  const [source, setSource] = useState<Source | ''>(deal?.source ?? '')
  const [nextStep, setNextStep] = useState(deal?.next_step ?? '')
  const [nextOn, setNextOn] = useState(deal?.next_step_on ?? '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const row = { company: company.trim(), description: description.trim() || null, amount: Number(amount) || 0, stage, source: source || null, next_step: nextStep.trim() || null, next_step_on: nextOn || null }
    const res = deal
      ? await supabase.from('deals').update(row).eq('id', deal.id).select('id').single()
      : await supabase.from('deals').insert(row).select('id').single()
    if (res.error) return setError(res.error.message)
    setSaved(true)
    onSaved((res.data as { id: string }).id)
  }
  async function remove() {
    if (!deal || !confirmDelete(deal.company)) return
    const { error } = await supabase.from('deals').delete().eq('id', deal.id)
    if (error) setError(error.message)
    else onDeleted()
  }

  return (
    <form onSubmit={submit} className={`flex flex-wrap items-end gap-3 ${bare ? '' : 'card p-5'}`}>
      {!bare && <h2 className="basis-full text-lg font-semibold">New deal</h2>}
      <label className="label flex-[2_1_200px]">Company<input className="input" required value={company} onChange={(e) => { setCompany(e.target.value); setSaved(false) }} /></label>
      <label className="label flex-[2_1_220px]">What for<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="New website + class booking" /></label>
      <label className="label flex-[1_1_120px]">Value (R)<input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="label flex-[1_1_150px]">Stage
        <select className="input" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          <option value="lost">Lost</option>
        </select>
      </label>
      <label className="label flex-[1_1_160px]">Lead source
        <select className="input" value={source} onChange={(e) => setSource(e.target.value as Source | '')}>
          <option value="">Not sure</option>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className="label flex-[2_1_220px]">Next step<input className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Follow up on the proposal" /></label>
      <label className="label flex-[1_1_150px]">By<input className="input" type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} /></label>
      <button className="btn-primary">{deal ? 'Save' : 'Add deal'}</button>
      {deal && <button type="button" className="btn-ghost" onClick={remove}>Delete deal</button>}
      {saved && deal && <span className="text-sm text-accent-text">Saved</span>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}

// A plain browser "are you sure?" before deleting a deal and its history.
function confirmDelete(company: string) {
  return window.confirm(`Delete the deal with ${company}? Its activity history goes too.`)
}

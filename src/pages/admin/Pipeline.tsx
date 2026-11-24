import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { rand, shortDate, todayISO } from '../../lib/format'

type Stage = 'lead' | 'contacted' | 'proposal_sent' | 'negotiation' | 'won' | 'lost'
interface Deal {
  id: string
  company: string
  description: string | null
  amount: number
  stage: Stage
  owner_id: string | null
  next_step: string | null
  next_step_on: string | null
  created_at: string
  owner: { full_name: string } | null
}

const STAGES: { key: Stage; label: string; colour: string }[] = [
  { key: 'lead', label: 'Lead', colour: 'text-muted' },
  { key: 'contacted', label: 'Contacted', colour: 'text-info' },
  { key: 'proposal_sent', label: 'Proposal sent', colour: 'text-warn' },
  { key: 'negotiation', label: 'Negotiation', colour: 'text-[#C4B5FF]' },
  { key: 'won', label: 'Won', colour: 'text-accent' },
]
const OPEN: Stage[] = ['lead', 'contacted', 'proposal_sent', 'negotiation']

/** The CRM pipeline: deals in columns by stage. */
export default function Pipeline() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [editing, setEditing] = useState<Deal | 'new' | null>(null)
  const [showLost, setShowLost] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('deals').select('*, owner:profiles(full_name)').order('created_at', { ascending: false })
    if (error) setError(error.message)
    setDeals((data as Deal[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function move(d: Deal, stage: Stage) {
    const { error } = await supabase.from('deals').update({ stage }).eq('id', d.id)
    if (error) setError(error.message)
    else load()
  }

  const open = deals.filter((d) => OPEN.includes(d.stage))
  const monthStart = todayISO().slice(0, 8) + '01'
  const sum = (list: Deal[]) => list.reduce((s, d) => s + Number(d.amount), 0)
  const lost = deals.filter((d) => d.stage === 'lost')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">CRM pipeline</h1>
          <p className="mt-1 text-sm text-muted">
            {open.length} open deals worth <b className="text-text">{rand(sum(open))}</b> · {deals.filter((d) => d.stage === 'won' && d.created_at >= monthStart).length} won this month
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'Close' : '+ New deal'}</button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {editing && <DealForm key={editing === 'new' ? 'new' : editing.id} deal={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load() }} />}

      <div className="overflow-x-auto pb-1.5">
        <div className="grid min-w-[980px] grid-cols-5 items-start gap-3">
          {STAGES.map((s, si) => {
            const list = deals.filter((d) => d.stage === s.key)
            return (
              <section key={s.key} aria-label={s.label} className="flex min-h-[420px] flex-col gap-2.5 rounded-2xl border border-line bg-[#0C1719] p-3">
                <div className="px-1 pb-1">
                  <div className="flex justify-between"><span className={`text-sm font-semibold ${s.colour}`}>● {s.label}</span><span className="text-xs text-muted">{list.length}</span></div>
                  <p className="mt-1 text-sm text-soft">{rand(sum(list))}</p>
                </div>
                {list.map((d) => {
                  const due = d.next_step_on && d.next_step_on <= todayISO()
                  return (
                    <article key={d.id} className="flex flex-col gap-2 rounded-xl border border-[#1F3235] bg-panel p-3">
                      <button className="cursor-pointer text-left font-semibold hover:text-accent" onClick={() => setEditing(d)}>{d.company}</button>
                      {d.description && <p className="text-xs text-muted">{d.description}</p>}
                      <div className="flex items-center justify-between"><b>{rand(Number(d.amount))}</b><span className="text-[11px] text-muted">{d.owner?.full_name?.split(' ')[0] ?? ''}</span></div>
                      {d.next_step && (
                        <p className={`rounded-lg px-2 py-1.5 text-xs ${due ? 'bg-[#3A2A10] text-warn' : 'bg-[#132225] text-soft'}`}>
                          {d.next_step}{d.next_step_on ? ` · ${shortDate(d.next_step_on)}` : ''}
                        </p>
                      )}
                      {si < STAGES.length - 1 && (
                        <div className="flex gap-1.5">
                          <button className="btn h-8 flex-1 border border-[#24403F] bg-transparent px-2 text-xs font-normal text-[#7FE6D3]" onClick={() => move(d, STAGES[si + 1].key)}>
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

function DealForm({ deal, onDone }: { deal: Deal | null; onDone: () => void }) {
  const [company, setCompany] = useState(deal?.company ?? '')
  const [description, setDescription] = useState(deal?.description ?? '')
  const [amount, setAmount] = useState(String(deal?.amount ?? ''))
  const [stage, setStage] = useState<Stage>(deal?.stage ?? 'lead')
  const [nextStep, setNextStep] = useState(deal?.next_step ?? '')
  const [nextOn, setNextOn] = useState(deal?.next_step_on ?? '')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const row = { company: company.trim(), description: description.trim() || null, amount: Number(amount) || 0, stage, next_step: nextStep.trim() || null, next_step_on: nextOn || null }
    const { error } = deal ? await supabase.from('deals').update(row).eq('id', deal.id) : await supabase.from('deals').insert(row)
    if (error) setError(error.message)
    else onDone()
  }
  async function remove() {
    if (!deal) return
    const { error } = await supabase.from('deals').delete().eq('id', deal.id)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
      <h2 className="basis-full text-lg font-semibold">{deal ? deal.company : 'New deal'}</h2>
      <label className="label flex-[2_1_200px]">Company<input className="input" required value={company} onChange={(e) => setCompany(e.target.value)} /></label>
      <label className="label flex-[2_1_220px]">What for<input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="New website + class booking" /></label>
      <label className="label flex-[1_1_120px]">Value (R)<input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="label flex-[1_1_150px]">Stage
        <select className="input" value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          <option value="lost">Lost</option>
        </select>
      </label>
      <label className="label flex-[2_1_220px]">Next step<input className="input" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Follow up on the proposal" /></label>
      <label className="label flex-[1_1_150px]">By<input className="input" type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} /></label>
      <button className="btn-primary">{deal ? 'Save' : 'Add deal'}</button>
      {deal && <button type="button" className="btn-ghost" onClick={remove}>Delete</button>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}

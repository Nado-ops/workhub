import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import type { Client, Extra, Project, ProjectPhase, ProjectStatus } from '../../lib/types'
import { PHASES, PHASE_LABEL, rand, shortDate, todayISO } from '../../lib/format'
import Tabs from '../../components/Tabs'
import PhaseSteps from '../../components/PhaseSteps'

type Row = Project & { client: { name: string } | null; extras: Extra[] }

/** Projects for admin & staff: cards by status, plus add / edit and extra work. */
export default function Projects() {
  const [rows, setRows] = useState<Row[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [tab, setTab] = useState<ProjectStatus>('active')
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('projects').select('*, client:clients(name), extras(*)').order('due_date', { nullsFirst: false })
    if (error) setError(error.message)
    const list = (data as Row[] | null) ?? []
    setRows(list)
    // Keep the open editor in sync with fresh data
    setEditing((cur) => (cur && cur !== 'new' ? list.find((r) => r.id === cur.id) ?? null : cur))
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  const count = (s: ProjectStatus) => rows.filter((r) => r.status === s).length
  const shown = rows.filter((r) => r.status === tab)
  const dueSoon = rows.filter((r) => r.status === 'active' && r.due_date && r.due_date <= todayISO(7)).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            {count('active')} active · {dueSoon} due within a week · {rows.filter((r) => r.waiting_on_client).length} waiting on a client
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>
          {editing === 'new' ? 'Close' : '+ New project'}
        </button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {editing && (
        <ProjectEditor
          key={editing === 'new' ? 'new' : editing.id}
          project={editing === 'new' ? null : editing}
          clients={clients}
          onSaved={load}
          onClose={() => setEditing(null)}
        />
      )}

      <div className="card overflow-hidden">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'active', label: 'Active', count: count('active') },
            { key: 'on_hold', label: 'On hold', count: count('on_hold') },
            { key: 'done', label: 'Done', count: count('done') },
          ]}
        />
        {shown.length === 0 && <p className="p-5 text-sm text-muted">No projects here yet.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5 p-4">
          {shown.map((p) => (
            <ProjectCard key={p.id} p={p} onOpen={() => setEditing(p)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ p, onOpen }: { p: Row; onOpen: () => void }) {
  const approvedExtras = p.extras.filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.amount), 0)
  const waitingExtras = p.extras.filter((e) => e.status === 'waiting').length
  const soon = p.status === 'active' && p.due_date && p.due_date <= todayISO(7)
  return (
    <button onClick={onOpen} className="card flex cursor-pointer flex-col gap-3.5 p-4 text-left hover:border-[#2A4A47]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted">{p.client?.name ?? 'Internal'}</p>
          <p className="mt-0.5 font-semibold">{p.name}</p>
        </div>
        {p.type && <span className="pill shrink-0 bg-[#2A2440] text-[#C4B5FF]">{p.type}</span>}
      </div>
      <div>
        <div className="flex justify-between text-xs text-soft"><span>{PHASE_LABEL[p.phase]} phase</span><span>{p.progress}%</span></div>
        <div className="mt-1.5 h-1.5 rounded bg-[#1A292C]">
          <div className={`h-1.5 rounded ${p.status === 'on_hold' ? 'bg-[#6E8487]' : 'bg-accent'}`} style={{ width: `${p.progress}%` }} />
        </div>
      </div>
      <PhaseSteps phase={p.phase} done={p.status === 'done'} />
      <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
        <span className={soon ? 'text-warn' : 'text-soft'}>◷ {p.due_date ? `Due ${shortDate(p.due_date)}` : 'No due date'}</span>
        <span className="text-muted">
          {p.budget ? rand(Number(p.budget) + approvedExtras) : ''}
          {approvedExtras > 0 && ' incl. extras'}
        </span>
      </div>
      {p.waiting_on_client && <p className="rounded-lg bg-[#162235] px-2.5 py-2 text-xs text-info">Waiting on client approval</p>}
      {waitingExtras > 0 && <p className="rounded-lg bg-[#3A2A10] px-2.5 py-2 text-xs text-warn">{waitingExtras} extra waiting for the client's answer</p>}
    </button>
  )
}

function ProjectEditor({
  project, clients, onSaved, onClose,
}: { project: Row | null; clients: Pick<Client, 'id' | 'name'>[]; onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState({
    client_id: project?.client_id ?? '',
    name: project?.name ?? '',
    type: project?.type ?? '',
    phase: project?.phase ?? ('plan' as ProjectPhase),
    progress: String(project?.progress ?? 0),
    status: project?.status ?? ('active' as ProjectStatus),
    budget: String(project?.budget ?? ''),
    quoted_hours: String(project?.quoted_hours ?? ''),
    due_date: project?.due_date ?? '',
    waiting_on_client: project?.waiting_on_client ?? false,
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | boolean) => setF((cur) => ({ ...cur, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const row = {
      client_id: f.client_id || null,
      name: f.name.trim(),
      type: f.type.trim() || null,
      phase: f.phase,
      progress: Math.min(100, Math.max(0, Math.round(Number(f.progress) || 0))),
      status: f.status,
      budget: Number(f.budget) || 0,
      quoted_hours: Number(f.quoted_hours) || 0,
      due_date: f.due_date || null,
      waiting_on_client: f.waiting_on_client,
    }
    const { error } = project
      ? await supabase.from('projects').update(row).eq('id', project.id)
      : await supabase.from('projects').insert(row)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setMsg('Saved.')
    onSaved()
    if (!project) onClose()
  }

  return (
    <section className="card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{project ? project.name : 'New project'}</h2>
        <button className="btn-ghost h-9" onClick={onClose}>Close</button>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="label flex-[1_1_200px]">Client
          <select className="input" value={f.client_id} onChange={(e) => set('client_id', e.target.value)}>
            <option value="">Internal (no client)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="label flex-[2_1_240px]">Project name
          <input className="input" required value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="label flex-[1_1_160px]">Type
          <input className="input" list="project-types" value={f.type} onChange={(e) => set('type', e.target.value)} placeholder="Divi website" />
          <datalist id="project-types"><option value="Divi website" /><option value="Nova SIS" /><option value="Retainer" /><option value="Own product" /></datalist>
        </label>
        <label className="label flex-[1_1_130px]">Phase
          <select className="input" value={f.phase} onChange={(e) => set('phase', e.target.value)}>
            {PHASES.map((p) => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}
          </select>
        </label>
        <label className="label flex-[1_1_110px]">Progress %
          <input className="input" type="number" min={0} max={100} value={f.progress} onChange={(e) => set('progress', e.target.value)} />
        </label>
        <label className="label flex-[1_1_130px]">Status
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">Active</option><option value="on_hold">On hold</option><option value="done">Done</option>
          </select>
        </label>
        <label className="label flex-[1_1_130px]">Budget (R)
          <input className="input" inputMode="decimal" value={f.budget} onChange={(e) => set('budget', e.target.value)} />
        </label>
        <label className="label flex-[1_1_120px]">Quoted hours
          <input className="input" inputMode="decimal" value={f.quoted_hours} onChange={(e) => set('quoted_hours', e.target.value)} />
        </label>
        <label className="label flex-[1_1_150px]">Due date
          <input className="input" type="date" value={f.due_date} onChange={(e) => set('due_date', e.target.value)} />
        </label>
        <label className="flex basis-full items-center gap-2.5 text-sm text-soft">
          <input type="checkbox" className="h-4 w-4 accent-[#D4AF6A]" checked={f.waiting_on_client} onChange={(e) => set('waiting_on_client', e.target.checked)} />
          Waiting on the client (e.g. for a design approval)
        </label>
        <button className="btn-primary" disabled={busy}>{project ? 'Save changes' : 'Create project'}</button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </form>

      {project?.client_id && <ExtrasEditor project={project} onChange={onSaved} />}
    </section>
  )
}

/** Extra work outside the quote. The client approves or declines it in their portal. */
function ExtrasEditor({ project, onChange }: { project: Row; onChange: () => void }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('extras').insert({
      project_id: project.id, client_id: project.client_id, name: name.trim(), note: note.trim() || null, amount: Number(amount) || 0,
    })
    if (error) { setError(error.message); return }
    setName(''); setNote(''); setAmount('')
    onChange()
  }

  const tone = { waiting: 'bg-[#3A2A10] text-warn', approved: 'bg-[#123330] text-accent', declined: 'bg-[#16282B] text-muted' }
  const label = { waiting: 'Waiting for client', approved: 'Approved', declined: 'Declined' }

  return (
    <div className="border-t border-line pt-4">
      <h3 className="font-semibold">Extra work</h3>
      <p className="mt-0.5 text-xs text-muted">Anything outside the original quote. It shows on the client's dashboard for them to approve.</p>
      {project.extras.map((x) => (
        <div key={x.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <div className="min-w-0 flex-[1_1_220px]">
            <p className="text-sm font-medium">{x.name}</p>
            {x.note && <p className="text-xs text-muted">{x.note}</p>}
          </div>
          <b className="text-sm">{rand(Number(x.amount))}</b>
          <span className={`pill ${tone[x.status]}`}>{label[x.status]}</span>
        </div>
      ))}
      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="label flex-[2_1_220px]">Extra
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Online booking calendar" />
        </label>
        <label className="label flex-[2_1_220px]">Short note for the client
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Adds 2 days to the project" />
        </label>
        <label className="label flex-[1_1_110px]">Price (R)
          <input className="input" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <button className="btn-ghost">Send to client</button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { useTeam, personName } from '../../lib/team'
import { shortDate, todayISO, timeAgo } from '../../lib/format'
import Tabs from '../../components/Tabs'

export type TaskStatus = 'todo' | 'doing' | 'done'
export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: 'normal' | 'high'
  assignee_id: string | null
  created_by: string | null
  due_on: string | null
  client_id: string | null
  done_at: string | null
  created_at: string
  assignee: { full_name: string; email: string | null } | null
  creator: { full_name: string; email: string | null } | null
  client: { name: string } | null
}

export const TASK_SELECT = '*, assignee:profiles!tasks_assignee_id_fkey(full_name, email), creator:profiles!tasks_created_by_fkey(full_name, email), client:clients(name)'

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'doing', label: 'Doing' },
  { key: 'done', label: 'Done' },
]

/** Internal tasks: work the team gives each other that isn't a client ticket. */
export default function Tasks() {
  const { profile } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [view, setView] = useState<'mine' | 'gave' | 'all'>('mine')
  const [editing, setEditing] = useState<Task | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    // Done tasks only from the last 14 days, so the Done column doesn't grow forever.
    const { data, error } = await supabase.from('tasks').select(TASK_SELECT)
      .or(`status.neq.done,done_at.gte.${todayISO(-14)}`)
      .order('due_on', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
    if (error) setError(error.message)
    setTasks((data as Task[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  const me = profile?.id
  const shown = tasks.filter((t) => view === 'all' || (view === 'mine' ? t.assignee_id === me : t.created_by === me && t.assignee_id !== me))
  const count = (v: typeof view) => tasks.filter((t) => t.status !== 'done' && (v === 'all' || (v === 'mine' ? t.assignee_id === me : t.created_by === me && t.assignee_id !== me))).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="mt-1 text-sm text-muted">Work the team gives each other, outside client tickets.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? 'Close' : '+ New task'}</button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {editing && <TaskForm key={editing === 'new' ? 'new' : editing.id} task={editing === 'new' ? null : editing} onDone={() => { setEditing(null); load() }} />}

      <section className="card overflow-hidden">
        <Tabs
          tabs={[
            { key: 'mine', label: 'My tasks', count: count('mine') },
            { key: 'gave', label: 'I gave out', count: count('gave') },
            { key: 'all', label: 'Whole team', count: count('all') },
          ]}
          value={view}
          onChange={setView}
        />
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = shown.filter((t) => t.status === col.key)
            return (
              <div key={col.key} className="flex flex-col gap-2 rounded-xl bg-raised p-3" aria-label={col.label}>
                <p className="flex justify-between px-1 text-sm font-semibold">{col.label}<span className="font-normal text-muted">{list.length}</span></p>
                {list.length === 0 && <p className="px-1 py-3 text-xs text-muted">Nothing here.</p>}
                {list.map((t) => <TaskCard key={t.id} task={t} showAssignee={view !== 'mine'} onOpen={() => setEditing(t)} onChange={load} />)}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

/** One task as a small card. Used here and on My work. */
export function TaskCard({ task: t, showAssignee, onOpen, onChange }: { task: Task; showAssignee?: boolean; onOpen: () => void; onChange: () => void }) {
  const late = t.status !== 'done' && t.due_on && t.due_on < todayISO()
  const today = t.status !== 'done' && t.due_on === todayISO()
  async function setStatus(status: TaskStatus) {
    await supabase.from('tasks').update({ status }).eq('id', t.id)
    onChange()
  }
  return (
    <article className="flex gap-2.5 rounded-xl border border-line bg-panel p-3">
      <input
        type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#B8893A]" checked={t.status === 'done'}
        onChange={() => setStatus(t.status === 'done' ? 'todo' : 'done')} aria-label={`Done: ${t.title}`}
      />
      <div className="min-w-0 flex-1">
        <button className={`cursor-pointer text-left text-sm font-medium hover:text-accent-text ${t.status === 'done' ? 'text-muted line-through' : ''}`} onClick={onOpen}>
          {t.priority === 'high' && <span className="pill mr-1.5 bg-danger-soft px-1.5 py-0.5 text-[10px] text-danger">High</span>}
          {t.title}
        </button>
        <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
          {t.due_on && <span className={late ? 'font-semibold text-danger' : today ? 'font-semibold text-warn' : ''}>{late ? 'Late · ' : today ? 'Today · ' : 'Due '}{shortDate(t.due_on)}</span>}
          {t.client && <span>{t.client.name}</span>}
          {showAssignee && <span>→ {personName(t.assignee)}</span>}
          {t.status === 'done' && t.done_at && <span>done {timeAgo(t.done_at)}</span>}
        </p>
        {t.status === 'todo' && <button className="mt-1.5 text-xs text-accent-text hover:underline" onClick={() => setStatus('doing')}>Start →</button>}
      </div>
    </article>
  )
}

/** Add or edit a task. */
export function TaskForm({ task, onDone, defaultAssignee }: { task: Task | null; onDone: () => void; defaultAssignee?: string }) {
  const { profile } = useAuth()
  const team = useTeam()
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [assignee, setAssignee] = useState(task?.assignee_id ?? defaultAssignee ?? profile?.id ?? '')
  const [due, setDue] = useState(task?.due_on ?? '')
  const [priority, setPriority] = useState(task?.priority ?? 'normal')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [client, setClient] = useState(task?.client_id ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const row = { title: title.trim(), description: description.trim() || null, assignee_id: assignee || null, due_on: due || null, priority, status, client_id: client || null }
    const { error } = task ? await supabase.from('tasks').update(row).eq('id', task.id) : await supabase.from('tasks').insert(row)
    if (error) setError(error.message)
    else onDone()
  }
  async function remove() {
    if (!task || !window.confirm(`Delete "${task.title}"?`)) return
    const { error } = await supabase.from('tasks').delete().eq('id', task.id).select('id')
    if (error) setError(error.message)
    else onDone()
  }
  const canDelete = task && (profile?.role === 'admin' || task.created_by === profile?.id)

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
      <h2 className="basis-full text-lg font-semibold">{task ? 'Edit task' : 'New task'}</h2>
      {task && <p className="-mt-2 basis-full text-xs text-muted">Made by {personName(task.creator)} · {timeAgo(task.created_at)}</p>}
      <label className="label flex-[3_1_260px]">What needs doing<input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Renew the SSL certificate for Harbour Dental" /></label>
      <label className="label flex-[1_1_170px]">Who
        <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Nobody yet</option>
          {team.map((m) => <option key={m.id} value={m.id}>{m.id === profile?.id ? `Me (${personName(m)})` : personName(m)}</option>)}
        </select>
      </label>
      <label className="label flex-[1_1_150px]">Due<input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label className="label basis-full">Details (optional)<textarea className="input h-20 py-2" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="label flex-[1_1_170px]">For a client (optional)
        <select className="input" value={client} onChange={(e) => setClient(e.target.value)}>
          <option value="">Internal</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="label flex-[1_1_130px]">Priority
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as 'normal' | 'high')}>
          <option value="normal">Normal</option><option value="high">High</option>
        </select>
      </label>
      {task && (
        <label className="label flex-[1_1_130px]">Status
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      )}
      <button className="btn-primary">{task ? 'Save' : 'Add task'}</button>
      <button type="button" className="btn-ghost" onClick={onDone}>Cancel</button>
      {canDelete && <button type="button" className="btn-ghost text-danger" onClick={remove}>Delete</button>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
      {!task && <p className="basis-full text-xs text-muted">The person gets a notification in their bell.</p>}
    </form>
  )
}

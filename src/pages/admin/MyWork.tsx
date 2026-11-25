import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { shortDate, slaClock, ticketRef, todayISO, timeAgo } from '../../lib/format'
import type { Ticket } from '../../lib/types'
import { TASK_SELECT, TaskCard, TaskForm, type Task } from './Tasks'

type TicketRow = Ticket & { client: { name: string } | null }
interface DealStep { id: string; company: string; next_step: string | null; next_step_on: string | null }
interface Announcement { id: string; title: string; body: string | null; pinned: boolean; created_at: string }

/** Everything one person needs to do, in one place: tasks, tickets, CRM follow-ups and approvals. */
export default function MyWork() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [tasks, setTasks] = useState<Task[]>([])
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [steps, setSteps] = useState<DealStep[]>([])
  const [news, setNews] = useState<Announcement | null>(null)
  const [approvals, setApprovals] = useState({ leave: 0, claims: 0 })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)

  async function load() {
    if (!profile) return
    const me = profile.id
    supabase.from('tasks').select(TASK_SELECT).eq('assignee_id', me).neq('status', 'done')
      .order('due_on', { ascending: true, nullsFirst: false })
      .then(({ data }) => setTasks((data as Task[] | null) ?? []))
    supabase.from('tickets').select('*, client:clients(name)').eq('assignee_id', me).not('status', 'in', '(resolved,closed)').order('due_at')
      .then(({ data }) => setTickets((data as TicketRow[] | null) ?? []))
    // CRM follow-ups due in the next 7 days (or already late) on my open deals.
    supabase.from('deals').select('id, company, next_step, next_step_on').eq('owner_id', me)
      .in('stage', ['lead', 'contacted', 'proposal_sent', 'negotiation']).lte('next_step_on', todayISO(7)).order('next_step_on')
      .then(({ data }) => setSteps((data as DealStep[] | null) ?? []))
    supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setNews(((data as Announcement[] | null) ?? [])[0] ?? null))
    if (isAdmin) {
      const [l, c] = await Promise.all([
        supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
        supabase.from('claims').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
      ])
      setApprovals({ leave: l.count ?? 0, claims: c.count ?? 0 })
    }
  }
  useEffect(() => { load() }, [profile])

  const today = todayISO()
  const dueNow = tasks.filter((t) => t.due_on && t.due_on <= today).length
  const first = (profile?.full_name || '').split(' ')[0]
  const total = tasks.length + tickets.length + steps.length + approvals.leave + approvals.claims

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">My work</h1>
          <p className="mt-1 text-sm text-muted">
            {total === 0 ? `All clear${first ? `, ${first}` : ''}. Nothing waiting on you.` : `${total} things on your plate${dueNow ? ` · ${dueNow} due today or late` : ''}.`}
          </p>
        </div>
        <button className="btn-primary" onClick={() => { setAdding((v) => !v); setEditing(null) }}>{adding ? 'Close' : '+ Task for me'}</button>
      </div>

      {news && (
        <Link to="/app/announcements" className="card flex items-start gap-3 border-accent/50 bg-accent-soft p-4 no-underline text-text">
          <span aria-hidden className="text-lg">📣</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{news.title}</span>
            {news.body && <span className="line-clamp-2 block text-sm text-soft">{news.body}</span>}
            <span className="mt-0.5 block text-xs text-muted">{timeAgo(news.created_at)}</span>
          </span>
        </Link>
      )}

      {adding && <TaskForm task={null} defaultAssignee={profile?.id} onDone={() => { setAdding(false); load() }} />}
      {editing && <TaskForm key={editing.id} task={editing} onDone={() => { setEditing(null); load() }} />}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="flex justify-between font-semibold">My tasks <Link to="/app/tasks" className="text-sm font-normal text-accent-text">All tasks →</Link></h2>
          {tasks.length === 0 && <p className="text-sm text-muted">No open tasks.</p>}
          {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={() => { setEditing(t); setAdding(false) }} onChange={load} />)}
        </section>

        <div className="flex flex-col gap-4">
          <section className="card p-5">
            <h2 className="flex justify-between font-semibold">My tickets <Link to="/app/tickets" className="text-sm font-normal text-accent-text">All tickets →</Link></h2>
            {tickets.length === 0 && <p className="mt-2 text-sm text-muted">No tickets assigned to you.</p>}
            {tickets.map((t) => {
              const c = slaClock(t.due_at, t.status)
              return (
                <Link key={t.id} to={`/app/tickets/${t.id}`} className="flex items-center justify-between gap-3 border-t border-line py-2.5 no-underline text-text first-of-type:border-t-0">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{t.title}</span>
                    <span className="text-xs text-muted">{ticketRef(t.id)} · {t.client?.name}</span>
                  </span>
                  <span className={`shrink-0 text-xs ${c.tone}`}>{c.text}</span>
                </Link>
              )
            })}
          </section>

          <section className="card p-5">
            <h2 className="flex justify-between font-semibold">Follow-ups this week <Link to="/app/pipeline" className="text-sm font-normal text-accent-text">Pipeline →</Link></h2>
            {steps.length === 0 && <p className="mt-2 text-sm text-muted">No deal follow-ups due.</p>}
            {steps.map((d) => (
              <Link key={d.id} to="/app/pipeline" className="flex items-center justify-between gap-3 border-t border-line py-2.5 no-underline text-text first-of-type:border-t-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{d.company}</span>
                  <span className="text-xs text-muted">{d.next_step || 'Follow up'}</span>
                </span>
                <span className={`shrink-0 text-xs ${d.next_step_on && d.next_step_on < today ? 'font-semibold text-danger' : 'text-soft'}`}>{shortDate(d.next_step_on)}</span>
              </Link>
            ))}
          </section>

          {isAdmin && (approvals.leave > 0 || approvals.claims > 0) && (
            <section className="card p-5">
              <h2 className="font-semibold">Waiting for your approval</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {approvals.leave > 0 && <Link to="/app/hr" className="pill bg-warn-soft text-warn no-underline">{approvals.leave} leave {approvals.leave === 1 ? 'request' : 'requests'}</Link>}
                {approvals.claims > 0 && <Link to="/app/finance" className="pill bg-warn-soft text-warn no-underline">{approvals.claims} {approvals.claims === 1 ? 'claim' : 'claims'}</Link>}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

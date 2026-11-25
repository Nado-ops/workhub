import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { CLIENT_STATUS_LABEL, ticketRef } from '../../lib/format'
import type { Ticket } from '../../lib/types'

interface Project { id: string; name: string; phase: string; progress: number; due_date: string | null }

/** What a client sees first: their projects and open tickets. */
export default function ClientDashboard() {
  const { profile } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  useEffect(() => {
    // No filter needed: the database only ever returns this client's own rows.
    supabase.from('tickets').select('*').not('status', 'in', '(resolved,closed)').order('created_at', { ascending: false })
      .then(({ data }) => setTickets((data as Ticket[] | null) ?? []))
    supabase.from('projects').select('id, name, phase, progress, due_date').eq('status', 'active').order('due_date')
      .then(({ data }) => setProjects((data as Project[] | null) ?? []))
  }, [])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = (profile?.full_name || '').split(' ')[0]

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-3xl font-semibold">{greeting}{first ? `, ${first}` : ''}</h1>
        <p className="mt-1 text-sm text-muted">
          {tickets.length === 0 ? 'You have no open tickets.' : `${tickets.length} open ${tickets.length === 1 ? 'ticket' : 'tickets'}.`}
          {' '}Need help? <Link to="/portal/tickets" className="text-accent-text">Raise a ticket</Link>.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="card min-w-0 flex-[1.2_1_420px] p-5">
          <h2 className="font-semibold">Project progress</h2>
          {projects.length === 0 && <p className="mt-3 text-sm text-muted">No active projects right now.</p>}
          {projects.map((p) => (
            <div key={p.id} className="mt-4 border-t border-line pt-4">
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted capitalize">{p.phase} phase · {p.progress}%</span>
              </div>
              <div className="mt-2 h-2 rounded bg-raised"><div className="h-2 rounded bg-accent" style={{ width: `${p.progress}%` }} /></div>
              {p.due_date && <p className="mt-1.5 text-xs text-muted">Due {new Date(p.due_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</p>}
            </div>
          ))}
        </section>

        <section className="card min-w-0 flex-[1_1_320px] p-5">
          <h2 className="font-semibold">Open tickets</h2>
          {tickets.length === 0 && <p className="mt-3 text-sm text-muted">All sorted.</p>}
          {tickets.map((t) => (
            <Link key={t.id} to={`/portal/tickets/${t.id}`} className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 no-underline text-text">
              <span className="min-w-0"><span className="block text-sm font-medium">{t.title}</span><span className="text-xs text-muted">{ticketRef(t.id)}</span></span>
              <span className="text-xs text-soft">{CLIENT_STATUS_LABEL[t.status]}</span>
            </Link>
          ))}
        </section>
      </div>
    </div>
  )
}

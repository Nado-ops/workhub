import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { slaClock, ticketRef } from '../../lib/format'
import type { Ticket } from '../../lib/types'

type Row = Ticket & { client: { name: string } | null }

/** The admin & staff home page, built from live data. Staff see their own tickets. */
export default function Overview() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [tickets, setTickets] = useState<Row[]>([])
  const [clientCount, setClientCount] = useState(0)
  const [projectCount, setProjectCount] = useState(0)

  useEffect(() => {
    let q = supabase.from('tickets').select('*, client:clients(name)').not('status', 'in', '(resolved,closed)').order('due_at')
    if (!isAdmin && profile) q = q.eq('assignee_id', profile.id)
    q.then(({ data }) => setTickets((data as Row[] | null) ?? []))
    supabase.from('clients').select('id', { count: 'exact', head: true }).then(({ count }) => setClientCount(count ?? 0))
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'active').then(({ count }) => setProjectCount(count ?? 0))
  }, [isAdmin, profile])

  const clocks = tickets.map((t) => ({ t, c: slaClock(t.due_at, t.status) }))
  const urgent = clocks.filter(({ c }) => c.risk === 'breach' || c.risk === 'soon')
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const first = (profile?.full_name || '').split(' ')[0]

  const kpis = [
    { label: isAdmin ? 'Open tickets' : 'My open tickets', value: tickets.length, to: '/app/tickets' },
    { label: 'Late or due within 4 h', value: urgent.length, to: '/app/tickets', risk: urgent.length > 0 },
    { label: 'Clients', value: clientCount, to: '/app/clients' },
    { label: 'Active projects', value: projectCount, to: '/app/projects' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <p className="text-sm text-muted">{new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="mt-1 text-3xl font-semibold">{greeting}{first ? `, ${first}` : ''}</h1>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        {kpis.map((k) => (
          <Link key={k.label} to={k.to} className={`card p-4 no-underline text-text ${k.risk ? 'border-[#3A2224]' : ''}`}>
            <p className="text-sm text-muted">{k.label}</p>
            <p className={`mt-2 text-3xl font-semibold ${k.risk ? 'text-danger' : ''}`}>{k.value}</p>
          </Link>
        ))}
      </div>

      <section className="card p-5">
        <h2 className="font-semibold">Needs you today</h2>
        {clocks.filter(({ c }) => ['breach', 'soon', 'today'].includes(c.risk)).length === 0 && (
          <p className="mt-3 text-sm text-muted">Nothing is due today.</p>
        )}
        {clocks.filter(({ c }) => ['breach', 'soon', 'today'].includes(c.risk)).map(({ t, c }) => (
          <Link key={t.id} to={`/app/tickets/${t.id}`} className="mt-3 flex items-center gap-3 border-t border-line pt-3 no-underline text-text">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.title}</p>
              <p className="text-xs text-muted">{ticketRef(t.id)} · {t.client?.name}</p>
            </div>
            <span className={`text-sm ${c.tone}`}>{c.text}</span>
          </Link>
        ))}
      </section>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TicketFiles from '../../components/TicketFiles'
import { CLIENT_STATUS_LABEL, STATUS_STYLE, ticketRef, timeAgo } from '../../lib/format'
import type { Ticket, TicketMessage } from '../../lib/types'

type Msg = TicketMessage & { author: { full_name: string; role: string } | null }

/** A client's view of one ticket. Internal notes never reach this page —
 *  the database refuses to send them to client logins. */
export default function ClientTicket() {
  const { id } = useParams()
  const ticketId = Number(id)
  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('tickets').select('*').eq('id', ticketId).single()
    if (error) { setError('We couldn’t find that ticket.'); return }
    setTicket(data as Ticket)
    const { data: m } = await supabase.from('ticket_messages').select('*, author:profiles(full_name, role)').eq('ticket_id', ticketId).order('created_at')
    setMessages((m as Msg[] | null) ?? [])
  }, [ticketId])
  useEffect(() => { load() }, [load])

  async function send() {
    if (!draft.trim()) return
    const { error } = await supabase.from('ticket_messages').insert({ ticket_id: ticketId, body: draft.trim(), is_internal: false })
    if (error) setError(error.message)
    else { setDraft(''); load() }
  }

  if (error) return <p className="card p-6 text-sm text-danger">{error}</p>
  if (!ticket) return <p className="p-6 text-sm text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <Link to="/portal/tickets" className="text-sm text-accent no-underline">‹ My tickets</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold">{ticket.title}</h1>
          <span className={`pill ${STATUS_STYLE[ticket.status]}`}>● {CLIENT_STATUS_LABEL[ticket.status]}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{ticketRef(ticket.id)} · opened {timeAgo(ticket.created_at)}</p>
      </div>

      <section aria-label="Attachments" className="card p-4"><TicketFiles ticketId={ticket.id} /></section>

      <section className="card overflow-hidden">
        {ticket.description && <p className="whitespace-pre-line border-b border-line p-5 text-sm">{ticket.description}</p>}
        {messages.map((m) => (
          <article key={m.id} className="border-b border-line p-5">
            <p className="text-sm"><b>{m.author?.full_name || 'Someone'}</b> <span className="text-xs text-muted">· {timeAgo(m.created_at)}</span></p>
            <p className="mt-2 whitespace-pre-line text-sm text-[#D6E1E2]">{m.body}</p>
          </article>
        ))}
        <div className="bg-[#0C1719] p-5">
          <textarea aria-label="Your reply" rows={3} className="input h-auto py-2.5" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a reply…" />
          <div className="mt-2.5 flex justify-end"><button className="btn-primary" disabled={!draft.trim()} onClick={send}>Send reply</button></div>
        </div>
      </section>
    </div>
  )
}

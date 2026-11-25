import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import TicketFiles from '../../components/TicketFiles'
import { useAuth } from '../../auth/AuthProvider'
import type { Priority, Profile, RemoteSession, Ticket, TicketMessage, TicketStatus } from '../../lib/types'
import {
  CLIENT_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_STYLE, STATUS_LABEL, formatDuration, slaClock, ticketRef, timeAgo,
} from '../../lib/format'

type FullTicket = Ticket & { client: { id: string; name: string; support_hours_per_month: number | null } | null }
type Msg = TicketMessage & { author: { full_name: string; role: string } | null }
type Session = RemoteSession & { person: { full_name: string } | null }

export default function TicketDetail() {
  const { id } = useParams()
  const ticketId = Number(id)
  const { profile } = useAuth()

  const [ticket, setTicket] = useState<FullTicket | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [team, setTeam] = useState<Pick<Profile, 'id' | 'full_name'>[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [monthMinutes, setMonthMinutes] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: t, error } = await supabase
      .from('tickets').select('*, client:clients(id, name, support_hours_per_month)').eq('id', ticketId).single()
    if (error) { setError(error.message); return }
    setTicket(t as FullTicket)

    const { data: m } = await supabase
      .from('ticket_messages').select('*, author:profiles(full_name, role)').eq('ticket_id', ticketId).order('created_at')
    setMessages((m as Msg[] | null) ?? [])

    const { data: s } = await supabase
      .from('remote_sessions').select('*, person:profiles(full_name)').eq('ticket_id', ticketId).order('started_at', { ascending: false })
    setSessions((s as Session[] | null) ?? [])

    // Support time used by this client this month (all their remote sessions)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const { data: ms } = await supabase
      .from('remote_sessions').select('started_at, ended_at')
      .eq('client_id', (t as FullTicket).client_id).gte('started_at', monthStart.toISOString()).not('ended_at', 'is', null)
    setMonthMinutes((ms ?? []).reduce((sum, r) => sum + (new Date(r.ended_at!).getTime() - new Date(r.started_at).getTime()) / 60000, 0))
  }, [ticketId])

  useEffect(() => {
    load()
    supabase.from('profiles').select('id, full_name').in('role', ['admin', 'staff']).order('full_name')
      .then(({ data }) => setTeam(data ?? []))
  }, [load])

  async function updateTicket(patch: Partial<Ticket>) {
    const { error } = await supabase.from('tickets').update(patch).eq('id', ticketId)
    if (error) setError(error.message)
    else load()
  }

  if (error) return <p className="card p-6 text-sm text-danger">{error}</p>
  if (!ticket) return <p className="p-6 text-sm text-muted">Loading…</p>

  const clock = slaClock(ticket.due_at, ticket.status)
  const planHours = ticket.client?.support_hours_per_month ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <Link to="/app/tickets" className="text-sm text-accent-text no-underline">‹ Support tickets</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold">{ticket.title}</h1>
          <span className={`pill ${PRIORITY_STYLE[ticket.priority]}`}>{PRIORITY_LABEL[ticket.priority]}</span>
        </div>
        <p className="mt-1 text-sm text-muted">{ticketRef(ticket.id)} · {ticket.client?.name} · opened {timeAgo(ticket.created_at)}</p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <Conversation ticket={ticket} messages={messages} onSent={load} />

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <section aria-label="Deadline" className={`card p-4 ${clock.risk === 'breach' ? 'border-danger/30 bg-danger-soft' : ''}`}>
            <p className="text-[11px] tracking-widest text-muted">◷ RESPONSE DEADLINE</p>
            <p className={`mt-1 text-xl ${clock.tone}`}>{clock.text}</p>
          </section>

          <section aria-label="Attachments" className="card p-4"><TicketFiles ticketId={ticket.id} /></section>

          <RemoteSessionCard
            ticket={ticket}
            sessions={sessions}
            myId={profile?.id}
            usedMinutes={monthMinutes}
            planHours={planHours}
            onChange={load}
          />

          <section aria-label="Ticket details" className="card flex flex-col gap-3 p-4">
            <label className="label">Status
              <select className="input" value={ticket.status} onChange={(e) => updateTicket({ status: e.target.value as TicketStatus })}>
                {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="label">Assignee
              <select className="input" value={ticket.assignee_id ?? ''} onChange={(e) => updateTicket({ assignee_id: e.target.value || null })}>
                <option value="">Unassigned</option>
                {team.map((p) => <option key={p.id} value={p.id}>{p.full_name || 'No name yet'}{p.id === profile?.id ? ' (you)' : ''}</option>)}
              </select>
            </label>
            <label className="label">Priority
              <select className="input" value={ticket.priority} onChange={(e) => updateTicket({ priority: e.target.value as Priority })}>
                {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
              </select>
            </label>
            <p className="text-xs text-muted">Client sees this as: <b className="text-text">{CLIENT_STATUS_LABEL[ticket.status]}</b></p>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Conversation({ ticket, messages, onSent }: { ticket: Ticket; messages: Msg[]; onSent: () => void }) {
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const note = mode === 'note'

  async function send() {
    if (!draft.trim()) return
    setBusy(true)
    const { error } = await supabase.from('ticket_messages').insert({ ticket_id: ticket.id, body: draft.trim(), is_internal: note })
    setBusy(false)
    if (error) { setError(error.message); return }
    setDraft('')
    onSent()
  }

  const tab = (on: boolean) =>
    `h-9 cursor-pointer rounded-lg border px-3 text-sm ${on ? 'border-line-2 bg-raised font-semibold text-text' : 'border-transparent text-muted'}`

  return (
    <section aria-label="Conversation" className="card min-w-0 flex-[2_1_480px] overflow-hidden">
      {ticket.description && (
        <div className="border-b border-line p-5">
          <p className="text-xs text-muted">Original request</p>
          <p className="mt-1 whitespace-pre-line text-sm">{ticket.description}</p>
        </div>
      )}
      {messages.length === 0 && <p className="p-5 text-sm text-muted">No messages yet.</p>}
      {messages.map((m) => (
        <article key={m.id} className={`border-b border-line p-5 ${m.is_internal ? 'bg-accent-soft' : ''}`}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b>{m.author?.full_name || 'Someone'}</b>
            <span className="text-xs text-muted">· {m.author?.role === 'client' ? 'Client' : 'Team'} · {timeAgo(m.created_at)}</span>
            {m.is_internal && <span className="pill bg-warn-soft text-warn">Internal note · client can't see</span>}
          </div>
          <p className="mt-2 whitespace-pre-line text-sm text-soft">{m.body}</p>
        </article>
      ))}
      <div className="bg-raised p-5">
        <div role="tablist" className="mb-2.5 flex gap-1.5">
          <button role="tab" aria-selected={!note} className={tab(!note)} onClick={() => setMode('reply')}>Reply to client</button>
          <button role="tab" aria-selected={note} className={tab(note)} onClick={() => setMode('note')}>Internal note</button>
        </div>
        <textarea
          aria-label="Message"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={note ? 'Only your team will see this.' : 'Write a reply to the client…'}
          className={`input h-auto py-2.5 ${note ? 'border-warn/30 bg-accent-soft' : ''}`}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">{note ? 'Clients never see internal notes.' : 'The client sees this in their portal.'}</span>
          <button className="btn-primary" disabled={busy || !draft.trim()} onClick={send}>{note ? 'Add note' : 'Send reply'}</button>
        </div>
      </div>
    </section>
  )
}

function RemoteSessionCard({
  ticket, sessions, myId, usedMinutes, planHours, onChange,
}: {
  ticket: Ticket; sessions: Session[]; myId?: string; usedMinutes: number; planHours: number; onChange: () => void
}) {
  const live = sessions.find((s) => !s.ended_at && s.user_id === myId)
  const [tool, setTool] = useState('AnyDesk')
  const [ending, setEnding] = useState(false)
  const [note, setNote] = useState('')
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  // Tick every second while a session is live. The start time is saved in
  // the database, so closing the page doesn't lose the session.
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])

  async function start() {
    setError(null)
    const { error } = await supabase.from('remote_sessions').insert({ ticket_id: ticket.id, client_id: ticket.client_id, tool })
    if (error) setError(error.message)
    else onChange()
  }

  async function save() {
    if (!live) return
    const endedAt = new Date()
    const minutes = (endedAt.getTime() - new Date(live.started_at).getTime()) / 60000
    const { error } = await supabase.from('remote_sessions')
      .update({ ended_at: endedAt.toISOString(), note: note.trim() || null }).eq('id', live.id)
    if (error) { setError(error.message); return }
    await supabase.from('ticket_messages').insert({
      ticket_id: ticket.id,
      is_internal: true,
      body: `Remote session on ${live.tool} · ${formatDuration(Math.max(1, minutes))}${note.trim() ? '\n' + note.trim() : ''}`,
    })
    setEnding(false)
    setNote('')
    onChange()
  }

  const secs = live ? Math.max(0, Math.floor((now - new Date(live.started_at).getTime()) / 1000)) : 0
  const pad = (n: number) => String(n).padStart(2, '0')
  const elapsed = `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`
  const usedHours = Math.round((usedMinutes / 60) * 10) / 10

  return (
    <section aria-label="Remote session" className={`card p-4 ${live ? 'border-info/40 bg-info-soft' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] tracking-widest text-info">⧉ REMOTE SESSION</p>
        <span className="text-xs text-muted">{planHours > 0 ? `Plan: ${usedHours} of ${planHours} h used` : `${usedHours} h this month`}</span>
      </div>

      {!live && (
        <>
          <div className="mt-3 flex items-end gap-2">
            <label className="label flex-1">Tool
              <select className="input" value={tool} onChange={(e) => setTool(e.target.value)}>
                <option>AnyDesk</option><option>TeamViewer</option><option>Other</option>
              </select>
            </label>
            <button className="btn h-11 bg-info text-white" onClick={start}>▶ Start session</button>
          </div>
          <p className="mt-2 text-xs text-muted">Press start before you connect to the client's computer.</p>
        </>
      )}

      {live && !ending && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tabular-nums">{elapsed}</p>
            <p className="text-xs text-soft">● Live on {live.tool}</p>
          </div>
          <button className="btn bg-danger text-white" onClick={() => setEnding(true)}>■ End</button>
        </div>
      )}

      {live && ending && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">Session lasted <b>{formatDuration(secs / 60)}</b>. What did you do?</p>
          <textarea aria-label="Session note" rows={2} className="input h-auto py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Set up SMTP and sent a test booking" />
          <button className="btn-primary" onClick={save}>Save to ticket</button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {sessions.filter((s) => s.ended_at).map((s) => (
        <div key={s.id} className="mt-2.5 flex justify-between gap-2 border-t border-info/30 pt-2 text-xs">
          <span className="text-soft">{s.person?.full_name || 'Team'} · {s.tool} · {timeAgo(s.started_at)}</span>
          <b>{formatDuration((new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()) / 60000)}</b>
        </div>
      ))}
    </section>
  )
}

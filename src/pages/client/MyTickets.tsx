import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { ACCEPT, uploadFile } from '../../lib/files'
import { useAuth } from '../../auth/AuthProvider'
import { CLIENT_STATUS_LABEL, STATUS_STYLE, ticketRef, timeAgo } from '../../lib/format'
import type { Priority, Ticket } from '../../lib/types'

const LEVELS: [Priority, string, string][] = [
  ['normal', 'Normal', 'Reply within 1 working day'],
  ['high', 'High', 'Reply within 4 hours'],
  ['urgent', 'Urgent', 'Site down or losing business'],
]

export default function MyTickets() {
  const { profile } = useAuth()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('tickets').select('*').order('created_at', { ascending: false })
    setTickets((data as Ticket[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile?.client_id) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('tickets')
      .insert({ client_id: profile.client_id, title: title.trim(), description: description.trim() || null, priority, created_by: profile.id })
      .select('id').single()
    if (error) { setBusy(false); setError(error.message); return }
    // Attach any screenshots to the new ticket's folder
    try {
      for (const f of files) await uploadFile('ticket-files', String(data.id), f)
    } catch (e) {
      setError(`Your ticket was sent, but a file didn't upload: ${(e as Error).message}`)
    }
    setBusy(false)
    setSent(ticketRef(data.id))
    setTitle(''); setDescription(''); setPriority('normal'); setFiles([])
    load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">How can we help?</h1>
        <p className="mt-1 text-sm text-muted">Raise a ticket and we'll keep you updated here.</p>
      </div>

      {sent && (
        <p role="status" className="card border-success/30 bg-success-soft p-4 text-sm">
          <b className="text-accent-text">✓ Ticket {sent} received.</b> We'll be in touch soon.
        </p>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <form onSubmit={submit} className="card flex min-w-0 flex-[1_1_360px] flex-col gap-4 p-5">
          <h2 className="text-lg font-semibold">Raise a ticket</h2>
          <label className="label">What's the problem?
            <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Booking form shows an error" />
          </label>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs text-muted">How urgent is it?</legend>
            <div className="flex flex-wrap gap-2">
              {LEVELS.map(([value, name, hint]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={priority === value}
                  onClick={() => setPriority(value)}
                  className={`min-h-14 flex-[1_1_140px] cursor-pointer rounded-xl border px-3 py-2 text-left ${priority === value ? 'border-accent bg-success-soft' : 'border-line-2 bg-well'}`}
                >
                  <span className="block text-sm font-semibold">{name}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <label className="label">Tell us more
            <textarea className="input h-28 py-2" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened, on which page, and what you expected to see." />
          </label>
          <label className="btn h-10 w-fit cursor-pointer border border-dashed border-line-2 font-normal text-soft">
            + Attach screenshots or PDFs
            <input type="file" accept={ACCEPT} multiple className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          {files.length > 0 && <p className="text-xs text-soft">{files.map((f) => f.name).join(', ')}</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn-primary h-11 self-end" disabled={busy}>{busy ? 'Sending…' : 'Send ticket'}</button>
        </form>

        <section aria-label="Your tickets" className="card min-w-0 flex-[1.4_1_460px] overflow-hidden">
          <h2 className="px-5 pt-5 pb-2 text-lg font-semibold">Your tickets</h2>
          {tickets.length === 0 && <p className="px-5 pb-5 text-sm text-muted">No tickets yet.</p>}
          {tickets.map((t) => (
            <Link key={t.id} to={`/portal/tickets/${t.id}`} className="flex items-start justify-between gap-3 border-t border-line px-5 py-4 no-underline text-text hover:bg-hover">
              <span className="min-w-0">
                <span className="block font-medium">{t.title}</span>
                <span className="text-xs text-muted">{ticketRef(t.id)} · opened {timeAgo(t.created_at)}</span>
              </span>
              <span className={`pill ${STATUS_STYLE[t.status]}`}>● {CLIENT_STATUS_LABEL[t.status]}</span>
            </Link>
          ))}
        </section>
      </div>
    </div>
  )
}

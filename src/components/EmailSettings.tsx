import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/format'

interface Sent {
  id: number
  created_at: string
  kind: string
  to_emails: string[]
  subject: string
  status: string
  status_code: number | null
  error: string | null
}

/** Admin card: send a test email and see what the app has emailed recently. */
export default function EmailSettings() {
  const [rows, setRows] = useState<Sent[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data, error } = await supabase.rpc('recent_emails')
    if (error) setMsg(error.message.includes('recent_emails') ? 'Run migration 005 in Supabase to switch on emails.' : error.message)
    setRows((data as Sent[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function test() {
    setBusy(true)
    const { data, error } = await supabase.rpc('send_test_email')
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setMsg(data === 'not set up'
      ? 'Emails aren’t set up yet: add your Resend key in Supabase (see the README, “Emails”).'
      : 'Test email sent to you. Check your inbox (and spam) in a minute.')
    // Resend answers a few seconds later; refresh to show it
    setTimeout(load, 4000)
  }

  const state = (r: Sent) =>
    r.status === 'not set up' ? { t: 'Not set up', c: 'bg-[#3A2A10] text-warn' }
    : r.status.startsWith('error') || (r.status_code !== null && r.status_code >= 300) ? { t: 'Failed', c: 'bg-[#3A1618] text-danger' }
    : r.status_code === null ? { t: 'Sending…', c: 'bg-[#182640] text-info' }
    : { t: 'Sent', c: 'bg-[#123330] text-accent' }

  return (
    <section aria-label="Email notifications" className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Email notifications</h2>
          <p className="text-xs text-muted">New tickets, replies, assignments, and quotes &amp; invoices sent. Internal notes never email clients.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost h-9" onClick={load}>Refresh</button>
          <button className="btn-primary h-9" disabled={busy} onClick={test}>{busy ? 'Sending…' : 'Send me a test email'}</button>
        </div>
      </div>
      {msg && <p role="status" className="text-sm text-soft">{msg}</p>}
      {rows.length === 0 ? <p className="text-sm text-muted">No emails yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><tr><th className="th px-0">When</th><th className="th">To</th><th className="th">Subject</th><th className="th pr-0">Status</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const s = state(r)
                return (
                  <tr key={r.id}>
                    <td className="td px-0 text-xs text-muted">{timeAgo(r.created_at)}</td>
                    <td className="td text-xs text-soft">{r.to_emails.join(', ')}</td>
                    <td className="td text-sm">{r.subject}{r.error && <p className="mt-0.5 text-xs text-danger">{r.error}</p>}</td>
                    <td className="td pr-0"><span className={`pill ${s.c}`}>{s.t}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

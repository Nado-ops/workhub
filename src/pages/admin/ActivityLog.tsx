import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useTeam, personName } from '../../lib/team'
import { timeAgo } from '../../lib/format'

interface Entry {
  id: number
  at: string
  user_id: string | null
  table_name: string
  row_id: string | null
  label: string | null
  action: 'added' | 'changed' | 'deleted'
  changes: Record<string, unknown> | null
}

// Friendly names for the tables the audit log watches (migration 009).
const AREAS: Record<string, string> = {
  clients: 'Client', profiles: 'Person', projects: 'Project', extras: 'Extra', tickets: 'Ticket', deals: 'Deal',
  contacts: 'Contact', documents: 'Quote/invoice', document_lines: 'Quote/invoice line', claims: 'Claim',
  leave_requests: 'Leave', time_entries: 'Timesheet', vendors: 'Vendor', tasks: 'Task', kb_articles: 'Guide',
  announcements: 'Announcement', events: 'Calendar event', business_profile: 'Business details',
  sites: 'Website', site_changes: 'Website change', logs: 'Logs',
}
const ACTION_TONE = { added: 'bg-success-soft text-success', changed: 'bg-info-soft text-info', deleted: 'bg-danger-soft text-danger' }

const field = (k: string) => k.replace(/_id$/, '').replace(/_/g, ' ')
// Readable value: dates as "25 Nov 2026, 18:06", everything else as text (cut short).
const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 80)
}

/** Admin only: who added, changed or deleted what, and when. Kept for a year. */
export default function ActivityLog() {
  const team = useTeam()
  const [entries, setEntries] = useState<Entry[]>([])
  const [area, setArea] = useState('')
  const [who, setWho] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [limit, setLimit] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [clearing, setClearing] = useState(false)

  useEffect(() => {
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit)
    if (area) q = q.eq('table_name', area)
    if (who) q = q.eq('user_id', who)
    q.then(({ data, error }) => { if (error) setError(error.message); setEntries((data as Entry[] | null) ?? []) })
  }, [area, who, limit, reload])

  // Not on the team list = a client user (e.g. a client who accepted a quote).
  const nameOf = (id: string | null) => { if (!id) return 'System'; const m = team.find((t) => t.id === id); return m ? personName(m) : 'A client' }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Activity log</h1>
          <p className="mt-1 text-sm text-muted">Who added, changed or deleted what. Only admins see this. Kept for a year.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <button className="btn-ghost" onClick={() => setClearing((v) => !v)}>Clear logs…</button>
          <BackupButton />
        </div>
      </div>
      {clearing && <ClearLogs onCleared={() => setReload((r) => r + 1)} onClose={() => setClearing(false)} />}
      {error && <p className="text-sm text-danger">{error}</p>}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <select className="input h-10 w-auto" aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Everything</option>
            {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input h-10 w-auto" aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {team.map((m) => <option key={m.id} value={m.id}>{personName(m)}</option>)}
          </select>
        </div>
        {entries.length === 0 && <p className="p-5 text-sm text-muted">Nothing logged yet.</p>}
        <ul>
          {entries.map((e) => {
            const keys = e.action === 'changed' && e.changes ? Object.keys(e.changes) : []
            return (
              <li key={e.id} className="border-b border-line last:border-b-0">
                <button className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-hover" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <span className={`pill ${ACTION_TONE[e.action]}`}>{e.action}</span>
                  <span className="min-w-0 flex-[1_1_240px] text-sm">
                    {e.table_name === 'logs' ? <><b>{nameOf(e.user_id)}</b> cleared logs: {clearedText(e.changes)}</> : <>
                    <b>{nameOf(e.user_id)}</b> {e.action} {(AREAS[e.table_name] ?? e.table_name).toLowerCase()}{' '}
                    <span className="font-medium">{e.label ? `“${e.label}”` : ''}</span>
                    {keys.length > 0 && <span className="text-muted"> · {keys.slice(0, 3).map(field).join(', ')}{keys.length > 3 ? ` +${keys.length - 3}` : ''}</span>}
                    </>}
                  </span>
                  <span className="text-xs text-muted" title={new Date(e.at).toLocaleString('en-ZA')}>{timeAgo(e.at)}</span>
                </button>
                {open === e.id && e.changes && (
                  <div className="mx-4 mb-3 overflow-x-auto rounded-xl bg-raised p-3 text-xs">
                    <table className="w-full">
                      <tbody>
                        {e.action === 'changed'
                          ? Object.entries(e.changes as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => (
                              <tr key={k}><td className="py-0.5 pr-3 font-semibold">{field(k)}</td><td className="py-0.5 pr-3 text-muted line-through">{show(v.from)}</td><td className="py-0.5">{show(v.to)}</td></tr>
                            ))
                          : Object.entries(e.changes).filter(([, v]) => v !== null && v !== '').map(([k, v]) => (
                              <tr key={k}><td className="py-0.5 pr-3 font-semibold">{field(k)}</td><td className="py-0.5">{show(v)}</td></tr>
                            ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {entries.length === limit && <button className="w-full cursor-pointer border-t border-line p-3 text-sm text-accent-text hover:bg-hover" onClick={() => setLimit((l) => l + 100)}>Show more</button>}
      </section>
    </div>
  )
}

// Every table, in an order that makes sense to read. Uploaded files (receipts, HR docs, ticket
// attachments) are in Storage and aren't part of this download.
const BACKUP_TABLES = [
  'business_profile', 'clients', 'profiles', 'contacts', 'projects', 'extras', 'tickets', 'ticket_messages', 'remote_sessions',
  'deals', 'deal_activities', 'documents', 'document_lines', 'claims', 'leave_requests', 'time_entries', 'hr_documents',
  'vendors', 'tasks', 'kb_articles', 'announcements', 'events', 'study_reminders', 'email_log',
]

/** Downloads everything you can see as one JSON file — a copy to keep somewhere safe. */
function BackupButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function download() {
    setBusy(true); setMsg(null)
    const backup: Record<string, unknown[]> = {}
    let rows = 0
    for (const table of BACKUP_TABLES) {
      const all: unknown[] = []
      // Supabase returns at most 1000 rows per request, so fetch in pages.
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select('*').range(from, from + 999)
        if (error) { setMsg(`Couldn't read ${table}: ${error.message}`); break }
        all.push(...(data ?? []))
        if (!data || data.length < 1000) break
      }
      backup[table] = all
      rows += all.length
    }
    const file = new Blob([JSON.stringify({ made_at: new Date().toISOString(), tables: backup }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = `work-hub-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    setBusy(false)
    setMsg((m) => m ?? `Downloaded ${rows.toLocaleString('en-ZA')} records. Keep the file somewhere safe and private.`)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn-ghost" onClick={download} disabled={busy}>{busy ? 'Preparing…' : '⬇ Download backup'}</button>
      {msg && <p className="max-w-xs text-right text-xs text-muted">{msg}</p>}
    </div>
  )
}

/** "Activity log (20), email log (23), notifications (12), older than 25 Aug 2026" */
function clearedText(c: Record<string, unknown> | null) {
  if (!c) return ''
  const parts = [`activity log (${c.activity_entries ?? 0})`, `email log (${c.emails ?? 0})`, `notifications (${c.notifications ?? 0})`]
    .filter((_, i) => (c.cleared as string[] | undefined)?.includes(['activity', 'emails', 'notifications'][i]))
  const when = c.older_than ? `, older than ${new Date(String(c.older_than)).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''
  return parts.join(', ') + when
}

/** Admin: empty the logs after testing, or tidy away old entries. */
function ClearLogs({ onCleared, onClose }: { onCleared: () => void; onClose: () => void }) {
  const [logs, setLogs] = useState<Set<string>>(new Set(['activity', 'emails', 'notifications']))
  const [age, setAge] = useState<'all' | '30' | '90' | '365'>('all')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const OPTIONS = [
    { key: 'activity', label: 'Activity log', hint: 'who added, changed or deleted what' },
    { key: 'emails', label: 'Email log', hint: 'the list of emails sent (on Team & settings)' },
    { key: 'notifications', label: 'Everyone’s notifications', hint: 'the bell, for every person' },
  ]
  const toggle = (k: string) => setLogs((l) => { const n = new Set(l); if (n.has(k)) n.delete(k); else n.add(k); return n })

  async function clear() {
    const which = OPTIONS.filter((o) => logs.has(o.key))
    const period = age === 'all' ? 'ALL entries' : `entries older than ${age} days`
    if (!window.confirm(`Delete ${period} from: ${which.map((o) => o.label).join(', ')}?\n\nThis can't be undone. (Download a backup first if you might need them.)`)) return
    setBusy(true); setMsg(null)
    const olderThan = age === 'all' ? null : new Date(Date.now() - Number(age) * 86400000).toISOString()
    const { data, error } = await supabase.rpc('admin_clear_logs', { p_logs: which.map((o) => o.key), p_older_than: olderThan })
    setBusy(false)
    if (error) return setMsg(error.message)
    const r = data as { activity: number; emails: number; notifications: number }
    setMsg(`Cleared ${r.activity} activity entries, ${r.emails} emails and ${r.notifications} notifications.`)
    onCleared()
  }

  return (
    <div className="card p-5">
      <p className="font-semibold">Clear logs</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <label key={o.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#B8893A]" checked={logs.has(o.key)} onChange={() => toggle(o.key)} />
            <span>{o.label}<span className="block text-xs text-muted">{o.hint}</span></span>
          </label>
        ))}
      </div>
      <label className="label mt-3 max-w-sm">Which entries
        <select className="input" value={age} onChange={(e) => setAge(e.target.value as typeof age)}>
          <option value="all">Everything (e.g. after testing)</option>
          <option value="30">Older than 30 days</option>
          <option value="90">Older than 90 days</option>
          <option value="365">Older than a year</option>
        </select>
      </label>
      <p className="mt-2 text-xs text-muted">A note that you cleared the logs stays in the activity log.</p>
      {msg && <p className="mt-2 text-sm text-soft" role="status">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn h-10 bg-danger px-4 font-semibold text-white" onClick={clear} disabled={busy || logs.size === 0}>{busy ? 'Clearing…' : 'Clear'}</button>
        <button className="btn-ghost h-10" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/format'

interface Note { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

const ICON: Record<string, string> = { task: '✅', ticket: '🎫', message: '💬', announcement: '📣', leave: '🌴', claim: '🧾' }

/** The bell in the menu. Notifications are made by the database (migration 008); this shows yours. */
export default function NotificationBell() {
  const [notes, setNotes] = useState<Note[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  async function load() {
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(30)
    setNotes((data as Note[] | null) ?? [])
  }
  // Check when you change page, and every minute.
  useEffect(() => { load() }, [location.pathname])
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])
  // Close the list when you click somewhere else.
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const unread = notes.filter((n) => !n.read_at).length

  async function openNote(n: Note) {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
    load()
  }
  async function readAll() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
    load()
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
        className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-soft hover:bg-hover hover:text-text"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        // theme-light: a light panel, even though the menu is navy, so it reads like the rest of the app.
        <div className="absolute top-11 right-0 z-50 w-[min(340px,calc(100vw-40px))] overflow-hidden theme-light rounded-2xl border border-line bg-panel shadow-xl md:right-auto md:left-0">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && <button className="text-xs text-accent-text hover:underline" onClick={readAll}>Mark all read</button>}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {notes.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">You're all caught up.</li>}
            {notes.map((n) => (
              <li key={n.id}>
                <button onClick={() => openNote(n)} className={`flex w-full cursor-pointer gap-3 border-b border-line px-4 py-3 text-left hover:bg-hover ${n.read_at ? '' : 'bg-accent-soft/60'}`}>
                  <span aria-hidden>{ICON[n.kind] ?? '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}
                    <span className="block text-[11px] text-muted">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="New" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

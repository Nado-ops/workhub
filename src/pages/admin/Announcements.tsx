import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useCan } from '../../auth/AuthProvider'
import { personName } from '../../lib/team'
import { timeAgo } from '../../lib/format'

interface Announcement {
  id: string
  title: string
  body: string | null
  pinned: boolean
  created_at: string
  author: { full_name: string; email: string | null } | null
}

/** Team news. Admins post; everyone on the team gets a notification. */
export default function Announcements() {
  const can = useCan()
  const isAdmin = can('announcements') // admins, and staff whose role includes announcements
  const [items, setItems] = useState<Announcement[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('announcements').select('*, author:profiles(full_name, email)')
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50)
    if (error) setError(error.message)
    setItems((data as Announcement[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function post(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('announcements').insert({ title: title.trim(), body: body.trim() || null, pinned })
    if (error) return setError(error.message)
    setTitle(''); setBody(''); setPinned(false)
    load()
  }
  async function togglePin(a: Announcement) {
    await supabase.from('announcements').update({ pinned: !a.pinned }).eq('id', a.id)
    load()
  }
  async function remove(a: Announcement) {
    if (!window.confirm(`Delete "${a.title}"?`)) return
    await supabase.from('announcements').delete().eq('id', a.id)
    load()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">Announcements</h1>
        <p className="mt-1 text-sm text-muted">Team news in one place, so nothing gets lost in a group chat.</p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {isAdmin && (
        <form onSubmit={post} className="card flex flex-wrap items-end gap-3 p-5">
          <label className="label basis-full">Headline<input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Office closed on Friday for the public holiday" /></label>
          <label className="label basis-full">More detail (optional)<textarea className="input h-24 py-2" value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="flex items-center gap-2 text-sm text-soft"><input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top</label>
          <button className="btn-primary ml-auto">Post to the team</button>
        </form>
      )}

      <section className="flex flex-col gap-3">
        {items.length === 0 && <p className="card p-5 text-sm text-muted">No announcements yet.</p>}
        {items.map((a) => (
          <article key={a.id} className={`card p-5 ${a.pinned ? 'border-accent/50' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                {a.pinned && <span className="pill mb-1.5 bg-accent-soft text-accent-text">📌 Pinned</span>}
                <h2 className="font-semibold">{a.title}</h2>
                <p className="text-xs text-muted">{personName(a.author)} · {timeAgo(a.created_at)}</p>
              </div>
              {isAdmin && (
                <div className="flex gap-3 text-xs">
                  <button className="text-muted hover:text-text" onClick={() => togglePin(a)}>{a.pinned ? 'Unpin' : 'Pin'}</button>
                  <button className="text-muted hover:text-danger" onClick={() => remove(a)}>Delete</button>
                </div>
              )}
            </div>
            {a.body && <p className="mt-3 max-w-[70ch] text-sm leading-6 whitespace-pre-wrap text-soft">{a.body}</p>}
          </article>
        ))}
      </section>
    </div>
  )
}

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { dateKey, saHolidays } from '../../lib/holidays'

// Everything that can show on the calendar, and its colour (calm, soft tones).
type Kind = 'event' | 'leave' | 'task' | 'followup' | 'project' | 'invoice' | 'renewal' | 'study' | 'holiday'
const KINDS: Record<Kind, { label: string; chip: string; dot: string; adminOnly?: boolean }> = {
  event:    { label: 'Meetings & events', chip: 'bg-info-soft text-info',       dot: 'bg-info' },
  leave:    { label: 'Leave',             chip: 'bg-violet-soft text-violet',   dot: 'bg-violet' },
  task:     { label: 'Task due dates',    chip: 'bg-accent-soft text-accent-text', dot: 'bg-accent' },
  followup: { label: 'CRM follow-ups',    chip: 'bg-success-soft text-success', dot: 'bg-success' },
  project:  { label: 'Project deadlines', chip: 'bg-warn-soft text-warn',       dot: 'bg-warn' },
  invoice:  { label: 'Invoices due',      chip: 'bg-danger-soft text-danger',   dot: 'bg-danger', adminOnly: true },
  renewal:  { label: 'Vendor renewals',   chip: 'bg-raised text-soft',          dot: 'bg-muted', adminOnly: true },
  study:    { label: 'My study',          chip: 'bg-raised text-soft',          dot: 'bg-line-2' },
  holiday:  { label: 'Public holidays',   chip: 'bg-raised text-muted',         dot: 'bg-line-2' },
}

interface Item { key: string; kind: Kind; day: string; endDay?: string; title: string; time?: string; link?: string; event?: CalEvent }
interface CalEvent {
  id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean
  location: string | null; notes: string | null; private: boolean; created_by: string | null
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false })

/** One calendar for the whole team: meetings, leave, deadlines, follow-ups and holidays. */
export default function Calendar() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [items, setItems] = useState<Item[]>([])
  const [hidden, setHidden] = useState<Set<Kind>>(new Set())
  const [onlyMine, setOnlyMine] = useState(false)
  const [selected, setSelected] = useState(dateKey(new Date()))
  const [form, setForm] = useState<CalEvent | 'new' | null>(null)
  const [reload, setReload] = useState(0)

  // The grid shows whole weeks (Monday first), so it starts a little before the 1st.
  const gridStart = useMemo(() => {
    const d = new Date(cursor); d.setDate(1 - ((d.getDay() + 6) % 7)); return d
  }, [cursor])
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)), [gridStart])
  const from = dateKey(days[0]), to = dateKey(days[41])

  useEffect(() => {
    if (!profile) return
    const me = profile.id
    Promise.all([
      supabase.from('events').select('*').gte('starts_at', `${from}T00:00:00`).lte('starts_at', `${to}T23:59:59`),
      supabase.from('team_absences').select('*').lte('start_date', to).gte('end_date', from),
      supabase.from('tasks').select('id, title, due_on, assignee_id').neq('status', 'done').gte('due_on', from).lte('due_on', to),
      supabase.from('deals').select('id, company, next_step, next_step_on, owner_id').in('stage', ['lead', 'contacted', 'proposal_sent', 'negotiation']).gte('next_step_on', from).lte('next_step_on', to),
      supabase.from('projects').select('id, name, due_date').neq('status', 'done').gte('due_date', from).lte('due_date', to),
      isAdmin ? supabase.from('documents').select('id, number, due_date, client:clients(name)').eq('kind', 'invoice').eq('status', 'sent').gte('due_date', from).lte('due_date', to) : Promise.resolve({ data: [] }),
      isAdmin ? supabase.from('vendors').select('id, name, renewal_date').eq('status', 'active').gte('renewal_date', from).lte('renewal_date', to) : Promise.resolve({ data: [] }),
      supabase.from('study_reminders').select('id, title, remind_at').eq('user_id', me).eq('done', false).gte('remind_at', `${from}T00:00:00`).lte('remind_at', `${to}T23:59:59`),
    ]).then(([ev, leave, tasks, deals, projects, invoices, vendors, study]) => {
      const out: Item[] = []
      for (const e of (ev.data ?? []) as CalEvent[])
        out.push({ key: `e${e.id}`, kind: 'event', day: dateKey(new Date(e.starts_at)), title: e.title, time: e.all_day ? undefined : time(e.starts_at), event: e })
      for (const l of (leave.data ?? []) as { user_id: string; full_name: string; start_date: string; end_date: string }[])
        out.push({ key: `l${l.user_id}${l.start_date}`, kind: 'leave', day: l.start_date, endDay: l.end_date, title: `${l.full_name.split(' ')[0]} on leave`, link: '/app/hr' })
      for (const t of (tasks.data ?? []) as { id: string; title: string; due_on: string; assignee_id: string | null }[])
        if (!onlyMine || t.assignee_id === me) out.push({ key: `t${t.id}`, kind: 'task', day: t.due_on, title: t.title, link: '/app/tasks' })
      for (const d of (deals.data ?? []) as { id: string; company: string; next_step: string | null; next_step_on: string; owner_id: string | null }[])
        if (!onlyMine || d.owner_id === me) out.push({ key: `d${d.id}`, kind: 'followup', day: d.next_step_on, title: `${d.company}: ${d.next_step || 'follow up'}`, link: '/app/pipeline' })
      for (const p of (projects.data ?? []) as { id: string; name: string; due_date: string }[])
        out.push({ key: `p${p.id}`, kind: 'project', day: p.due_date, title: `${p.name} due`, link: '/app/projects' })
      for (const i of (invoices.data ?? []) as unknown as { id: string; number: string; due_date: string; client: { name: string } | null }[])
        out.push({ key: `i${i.id}`, kind: 'invoice', day: i.due_date, title: `${i.number} due · ${i.client?.name ?? ''}`, link: '/app/finance' })
      for (const v of (vendors.data ?? []) as { id: string; name: string; renewal_date: string }[])
        out.push({ key: `v${v.id}`, kind: 'renewal', day: v.renewal_date, title: `${v.name} renews`, link: '/app/vendors' })
      for (const s of (study.data ?? []) as { id: string; title: string; remind_at: string }[])
        out.push({ key: `s${s.id}`, kind: 'study', day: dateKey(new Date(s.remind_at)), title: s.title, time: time(s.remind_at), link: isAdmin ? '/app/study' : undefined })
      const years = new Set(days.map((d) => d.getFullYear()))
      for (const y of years) for (const [day, name] of Object.entries(saHolidays(y)))
        if (day >= from && day <= to) out.push({ key: `h${day}`, kind: 'holiday', day, title: name })
      setItems(out)
    })
  }, [from, to, onlyMine, profile, isAdmin, reload])

  // Spread leave over every day it covers.
  const byDay = useMemo(() => {
    const map: Record<string, Item[]> = {}
    const add = (k: string, it: Item) => (map[k] ??= []).push(it)
    for (const it of items) {
      if (hidden.has(it.kind)) continue
      if (it.endDay) {
        for (const d of days) { const k = dateKey(d); if (k >= it.day && k <= it.endDay) add(k, it) }
      } else add(it.day, it)
    }
    const order: Kind[] = ['holiday', 'leave', 'event', 'task', 'followup', 'project', 'invoice', 'renewal', 'study']
    for (const k in map) map[k].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.time ?? '').localeCompare(b.time ?? ''))
    return map
  }, [items, hidden, days])

  const today = dateKey(new Date())
  const month = cursor.getMonth()
  const toggle = (k: Kind) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const move = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1))
  const dayItems = byDay[selected] ?? []
  const selectedLabel = new Date(`${selected}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="mt-1 text-sm text-muted">Meetings, leave, deadlines and follow-ups in one place.</p>
        </div>
        <button className="btn-primary" onClick={() => setForm('new')}>+ New event</button>
      </div>

      {form && <EventForm key={form === 'new' ? 'new' : form.id} event={form === 'new' ? null : form} day={selected} onDone={() => { setForm(null); setReload((r) => r + 1) }} />}

      <div className="flex flex-wrap items-start gap-4">
        <section className="card min-w-0 flex-[3_1_560px] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-1">
              <button className="btn-ghost h-9 w-9 px-0" onClick={() => move(-1)} aria-label="Previous month">‹</button>
              <button className="btn-ghost h-9 w-9 px-0" onClick={() => move(1)} aria-label="Next month">›</button>
              <h2 className="ml-2 text-lg font-semibold">{cursor.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</h2>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-soft"><input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only mine</label>
              <button className="btn-ghost h-9 px-3 text-sm" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(dateKey(d)) }}>Today</button>
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold tracking-wider text-muted uppercase">
            {WEEKDAYS.map((w) => <div key={w} className="py-2">{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = dateKey(d)
              const list = byDay[k] ?? []
              const out = d.getMonth() !== month
              const holiday = list.some((i) => i.kind === 'holiday')
              return (
                <button
                  key={k} onClick={() => setSelected(k)} aria-label={`${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })}, ${list.length} items`}
                  className={`flex min-h-16 cursor-pointer flex-col gap-1 border-r border-b border-line p-1.5 text-left align-top last:border-r-0 sm:min-h-24 ${out ? 'bg-raised/60' : ''} ${selected === k ? 'outline-2 -outline-offset-2 outline-accent' : 'hover:bg-hover'}`}
                >
                  <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${k === today ? 'bg-text font-semibold text-panel' : out ? 'text-muted' : holiday ? 'font-semibold text-danger' : ''}`}>{d.getDate()}</span>
                  {/* Small screens: coloured dots. Bigger screens: up to 3 labels. */}
                  <span className="flex flex-wrap gap-0.5 sm:hidden">{list.slice(0, 5).map((i) => <span key={i.key} className={`h-1.5 w-1.5 rounded-full ${KINDS[i.kind].dot}`} />)}</span>
                  <span className="hidden flex-col gap-0.5 sm:flex">
                    {list.slice(0, 3).map((i) => <span key={i.key} className={`truncate rounded px-1.5 py-0.5 text-[11px] ${KINDS[i.kind].chip}`}>{i.time ? `${i.time} ` : ''}{i.title}</span>)}
                    {list.length > 3 && <span className="px-1.5 text-[11px] text-muted">+{list.length - 3} more</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <aside className="flex w-full flex-col gap-4 lg:w-80">
          <section className="card p-4" aria-label="Selected day">
            <h2 className="font-semibold">{selectedLabel}</h2>
            {dayItems.length === 0 && <p className="mt-2 text-sm text-muted">Nothing on this day.</p>}
            <ul className="mt-2 flex flex-col gap-2">
              {dayItems.map((i) => (
                <li key={i.key} className="flex gap-2.5 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${KINDS[i.kind].dot}`} />
                  <span className="min-w-0 flex-1">
                    {i.event ? (
                      <button className="cursor-pointer text-left font-medium hover:text-accent-text" onClick={() => setForm(i.event!)}>{i.title}</button>
                    ) : i.link ? <Link to={i.link} className="font-medium text-text hover:text-accent-text">{i.title}</Link> : <span className="font-medium">{i.title}</span>}
                    <span className="block text-xs text-muted">
                      {KINDS[i.kind].label}{i.time ? ` · ${i.time}${i.event?.ends_at ? `–${time(i.event.ends_at)}` : ''}` : ''}
                      {i.event?.location ? ` · ${i.event.location}` : ''}{i.event?.private ? ' · Private' : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <button className="mt-3 text-sm text-accent-text hover:underline" onClick={() => setForm('new')}>+ Add an event on this day</button>
          </section>

          <section className="card p-4" aria-label="Show on calendar">
            <h2 className="mb-2 text-sm font-semibold">Show</h2>
            <div className="flex flex-col gap-1.5">
              {(Object.keys(KINDS) as Kind[]).filter((k) => isAdmin || !KINDS[k].adminOnly).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-soft">
                  <input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={!hidden.has(k)} onChange={() => toggle(k)} />
                  <span className={`h-2 w-2 rounded-full ${KINDS[k].dot}`} /> {KINDS[k].label}
                </label>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

/** Add or edit a meeting / event. Times are your local time. */
function EventForm({ event, day, onDone }: { event: CalEvent | null; day: string; onDone: () => void }) {
  const { profile } = useAuth()
  const startDay = event ? dateKey(new Date(event.starts_at)) : day
  const [title, setTitle] = useState(event?.title ?? '')
  const [date, setDate] = useState(startDay)
  const [allDay, setAllDay] = useState(event?.all_day ?? false)
  const [start, setStart] = useState(event && !event.all_day ? time(event.starts_at) : '09:00')
  const [end, setEnd] = useState(event?.ends_at && !event.all_day ? time(event.ends_at) : '10:00')
  const [location, setLocation] = useState(event?.location ?? '')
  const [notes, setNotes] = useState(event?.notes ?? '')
  const [isPrivate, setPrivate] = useState(event?.private ?? false)
  const [error, setError] = useState<string | null>(null)
  const canEdit = !event || event.created_by === profile?.id || (profile?.role === 'admin' && !event.private)

  async function submit(e: FormEvent) {
    e.preventDefault()
    // new Date("2026-11-27T09:00") is read as local time, then saved in UTC by toISOString().
    const starts = allDay ? new Date(`${date}T00:00`) : new Date(`${date}T${start}`)
    const ends = allDay ? null : new Date(`${date}T${end}`)
    if (ends && ends < starts) return setError('The end time is before the start time.')
    const row = { title: title.trim(), starts_at: starts.toISOString(), ends_at: ends?.toISOString() ?? null, all_day: allDay, location: location.trim() || null, notes: notes.trim() || null, private: isPrivate }
    const { error } = event ? await supabase.from('events').update(row).eq('id', event.id) : await supabase.from('events').insert(row)
    if (error) setError(error.message)
    else onDone()
  }
  async function remove() {
    if (!event || !window.confirm(`Delete "${event.title}"?`)) return
    const { error } = await supabase.from('events').delete().eq('id', event.id)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-5">
      <h2 className="basis-full text-lg font-semibold">{event ? (canEdit ? 'Edit event' : event.title) : 'New event'}</h2>
      <fieldset disabled={!canEdit} className="contents">
        <label className="label flex-[3_1_240px]">What<input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team meeting" /></label>
        <label className="label flex-[1_1_150px]">Date<input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {!allDay && <>
          <label className="label flex-[1_1_110px]">From<input className="input" type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="label flex-[1_1_110px]">To<input className="input" type="time" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </>}
        <label className="label flex-[2_1_220px]">Where (optional)<input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Office, address or a Teams link" /></label>
        <label className="label basis-full">Notes (optional)<textarea className="input h-20 py-2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-soft"><input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day</label>
        <label className="flex items-center gap-2 text-sm text-soft"><input type="checkbox" className="h-4 w-4 accent-[#B8893A]" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} /> Private (only I see it)</label>
      </fieldset>
      <div className="ml-auto flex gap-2">
        {event && canEdit && <button type="button" className="btn-ghost text-danger" onClick={remove}>Delete</button>}
        <button type="button" className="btn-ghost" onClick={onDone}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && <button className="btn-primary">{event ? 'Save' : 'Add event'}</button>}
      </div>
      {!event && !isPrivate && <p className="basis-full text-xs text-muted">The team gets a notification about shared events.</p>}
      {error && <p className="basis-full text-sm text-danger">{error}</p>}
    </form>
  )
}

import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/format'

interface Reminder {
  id: string
  title: string
  goal: string | null
  remind_at: string | null
  minutes: number | null
  done: boolean
  created_at: string
}

const GOALS = ['JavaScript', 'TypeScript', 'Claude certification', 'Moodle', 'English writing']

const localDay = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })

/** Private study reminders. The database only ever shows you your own. */
export default function Study() {
  const [items, setItems] = useState<Reminder[]>([])
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState(GOALS[0])
  const [day, setDay] = useState(todayISO(1))
  const [time, setTime] = useState('19:30')
  const [minutes, setMinutes] = useState('45')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase.from('study_reminders').select('*').order('remind_at')
    if (error) setError(error.message)
    setItems((data as Reminder[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('study_reminders').insert({
      title: title.trim(), goal, minutes: Number(minutes) || null, remind_at: new Date(`${day}T${time}`).toISOString(),
    })
    if (error) { setError(error.message); return }
    setTitle('')
    load()
  }
  async function toggle(r: Reminder) {
    await supabase.from('study_reminders').update({ done: !r.done }).eq('id', r.id)
    load()
  }
  async function remove(r: Reminder) {
    await supabase.from('study_reminders').delete().eq('id', r.id)
    load()
  }

  const today = todayISO()
  const todays = items.filter((r) => r.remind_at && localDay(r.remind_at) === today)
  const upcoming = items.filter((r) => r.remind_at && localDay(r.remind_at) > today && !r.done)
  const overdue = items.filter((r) => r.remind_at && localDay(r.remind_at) < today && !r.done)

  // Days in the last week with at least one finished session
  const weekDays = Array.from({ length: 7 }, (_, i) => todayISO(i - 6))
  const studied = new Set(items.filter((r) => r.done && r.remind_at).map((r) => localDay(r.remind_at!)))

  const perGoal = GOALS.map((g) => {
    const all = items.filter((r) => r.goal === g)
    const done = all.filter((r) => r.done)
    return { g, done: done.length, total: all.length, mins: done.reduce((s, r) => s + (r.minutes ?? 0), 0) }
  })

  const Item = ({ r }: { r: Reminder }) => (
    <div className="flex items-center gap-3 border-t border-line py-3">
      <input type="checkbox" checked={r.done} onChange={() => toggle(r)} aria-label={`Done: ${r.title}`} className="h-5 w-5 shrink-0 accent-[#3FD0B5]" />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${r.done ? 'text-muted line-through' : ''}`}>{r.title}</p>
        <p className="text-xs text-muted">{r.goal}{r.minutes ? ` · ${r.minutes} min` : ''}</p>
      </div>
      {r.remind_at && <span className="text-xs font-semibold text-[#7FE6D3]">{localDay(r.remind_at) === today ? timeOf(r.remind_at) : new Date(r.remind_at).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
      <button aria-label="Delete reminder" className="cursor-pointer text-xs text-muted hover:text-text" onClick={() => remove(r)}>✕</button>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Study reminders</h1>
          <p className="mt-1 text-sm text-muted">Only you can see this page.</p>
        </div>
        <div className="card flex items-center gap-3 px-4 py-2.5" aria-label={`Studied ${studied.size} of the last 7 days`}>
          <span className="text-sm text-soft">Last 7 days</span>
          <span className="flex gap-1.5">
            {weekDays.map((d) => (
              <span key={d} className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold ${studied.has(d) ? 'bg-accent text-accent-ink' : 'bg-[#1A292C] text-[#6E8487]'}`}>
                {new Date(d + 'T12:00').toLocaleDateString('en-ZA', { weekday: 'narrow' })}
              </span>
            ))}
          </span>
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1.3_1_420px] flex-col gap-4">
          <section className="card p-5">
            <h2 className="font-semibold">Today</h2>
            {todays.length === 0 && <p className="mt-2 text-sm text-muted">Nothing planned for today.</p>}
            {todays.map((r) => <Item key={r.id} r={r} />)}
            {overdue.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-semibold text-warn">Missed</h3>
                {overdue.map((r) => <Item key={r.id} r={r} />)}
              </>
            )}
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Coming up</h2>
            {upcoming.length === 0 && <p className="mt-2 text-sm text-muted">Add your next session below.</p>}
            {upcoming.map((r) => <Item key={r.id} r={r} />)}
            <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2.5 border-t border-line pt-4">
              <label className="label flex-[2_1_220px]">New session<input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Arrays and loops" /></label>
              <label className="label flex-[1_1_160px]">Goal
                <select className="input" value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
              </label>
              <label className="label flex-[1_1_140px]">Day<input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
              <label className="label flex-[1_1_100px]">Time<input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
              <label className="label flex-[1_1_90px]">Minutes<input className="input" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
              <button className="btn-primary h-11">Add</button>
            </form>
          </section>
        </div>

        <section className="card flex min-w-0 flex-[1_1_300px] flex-col gap-4 p-5">
          <h2 className="font-semibold">Learning goals</h2>
          {perGoal.map((g) => (
            <div key={g.g}>
              <div className="flex justify-between text-sm"><span className="font-medium">{g.g}</span><span className="text-xs text-muted">{g.done} of {g.total} sessions</span></div>
              <div className="mt-2 h-1.5 rounded bg-[#1A292C]"><div className="h-1.5 rounded bg-accent" style={{ width: `${g.total ? Math.round((g.done / g.total) * 100) : 0}%` }} /></div>
              <p className="mt-1 text-xs text-muted">{Math.round((g.mins / 60) * 10) / 10} h studied</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

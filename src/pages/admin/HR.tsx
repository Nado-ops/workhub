import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { canDo, useAuth } from '../../auth/AuthProvider'
import type { Claim, Client, Decision, Profile } from '../../lib/types'
import { rand, shortDate, todayISO } from '../../lib/format'
import { LEAVE_POLICY } from '../../lib/business'
import Tabs from '../../components/Tabs'
import { ACCEPT, openFile, uploadFile } from '../../lib/files'

type LeaveType = 'annual' | 'sick' | 'family_responsibility' | 'unpaid'
interface Leave {
  id: string; user_id: string; type: LeaveType; start_date: string; end_date: string; days: number | null
  reason: string | null; status: Decision; created_at: string; person?: { full_name: string } | null
}
interface TimeEntry {
  id: string; user_id: string; work_date: string; minutes: number; client_id: string | null; note: string | null
  approved: boolean; person?: { full_name: string } | null; client?: { name: string } | null
}
interface HrDoc { id: string; user_id: string | null; name: string; status: string; expires_on: string | null; file_path: string | null; person?: { full_name: string } | null }
interface Absence { user_id: string; full_name: string; start_date: string; end_date: string }

const LEAVE_LABEL: Record<LeaveType, string> = { annual: 'Annual leave', sick: 'Sick leave', family_responsibility: 'Family responsibility', unpaid: 'Unpaid leave' }
const DECISION_TONE: Record<Decision, string> = { waiting: 'bg-warn-soft text-warn', approved: 'bg-success-soft text-success', declined: 'bg-raised text-muted' }
const DECISION_TEXT: Record<Decision, string> = { waiting: 'Waiting', approved: 'Approved', declined: 'Declined' }

/** Monday–Friday days between two dates, both included. */
function workingDays(from: string, to: string) {
  let n = 0
  for (const d = new Date(from + 'T12:00'); d <= new Date(to + 'T12:00'); d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) n++
  }
  return n
}
/** Monday of the week that `iso` falls in. */
function mondayOf(iso: string) {
  const d = new Date(iso + 'T12:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hours = (mins: number) => `${Math.round((mins / 60) * 10) / 10} h`

type AdminTab = 'people' | 'leave' | 'time' | 'docs'
type StaffTab = 'leave' | 'time' | 'claims' | 'docs'

/** HR & people. Admins manage everyone; staff see and manage only their own things. */
export default function HR() {
  const { profile } = useAuth()
  const isAdmin = canDo(profile, 'hr') // admins, and staff whose role includes HR
  const [adminTab, setAdminTab] = useState<AdminTab>('people')
  const [staffTab, setStaffTab] = useState<StaffTab>('leave')

  return (
    <div className="flex flex-col gap-4">
      <div className="pt-2">
        <h1 className="text-2xl font-semibold">{isAdmin ? 'HR & people' : 'My HR'}</h1>
        <p className="mt-1 text-sm text-muted">
          {isAdmin ? 'Your team, their leave, hours and paperwork.' : 'Your leave, hours, claims and documents. Only you and the admin can see this.'}
        </p>
      </div>
      <section className="card overflow-hidden">
        {isAdmin ? (
          <Tabs value={adminTab} onChange={setAdminTab} tabs={[
            { key: 'people', label: 'People' }, { key: 'leave', label: 'Leave' }, { key: 'time', label: 'Timesheets' }, { key: 'docs', label: 'Documents' },
          ]} />
        ) : (
          <Tabs value={staffTab} onChange={setStaffTab} tabs={[
            { key: 'leave', label: 'My leave' }, { key: 'time', label: 'My time' }, { key: 'claims', label: 'My claims' }, { key: 'docs', label: 'My documents' },
          ]} />
        )}
        <div className="p-5">
          {isAdmin && adminTab === 'people' && <PeopleTab />}
          {(isAdmin ? adminTab === 'leave' : staffTab === 'leave') && <LeaveTab admin={isAdmin} myId={profile?.id} />}
          {(isAdmin ? adminTab === 'time' : staffTab === 'time') && <TimeTab admin={isAdmin} myId={profile?.id} />}
          {!isAdmin && staffTab === 'claims' && <MyClaims />}
          {(isAdmin ? adminTab === 'docs' : staffTab === 'docs') && <DocsTab admin={isAdmin} />}
        </div>
      </section>
    </div>
  )
}

/* ---------- People (admin) ---------- */
function PeopleTab() {
  const [people, setPeople] = useState<(Profile & { started_on: string | null })[]>([])
  const [used, setUsed] = useState<Record<string, number>>({})
  const [saved, setSaved] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('profiles').select('id, email, full_name, job_title, role, client_id, started_on').in('role', ['admin', 'staff']).order('full_name')
    setPeople((data as (Profile & { started_on: string | null })[] | null) ?? [])
    const yearStart = todayISO().slice(0, 4) + '-01-01'
    const { data: l } = await supabase.from('leave_requests').select('user_id, days').eq('type', 'annual').eq('status', 'approved').gte('start_date', yearStart)
    const map: Record<string, number> = {}
    ;(l ?? []).forEach((r) => { map[r.user_id] = (map[r.user_id] ?? 0) + Number(r.days ?? 0) })
    setUsed(map)
  }
  useEffect(() => { load() }, [])

  async function save(id: string, patch: Record<string, string | null>) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', id)
    setSaved(error ? error.message : 'Saved.')
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
      {people.map((p) => {
        const left = LEAVE_POLICY.annualDaysPerYear - (used[p.id] ?? 0)
        return (
          <article key={p.id} className="card flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-raised font-semibold">
                {(p.full_name || p.email || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{p.full_name || p.email}</p>
                <p className="text-xs capitalize text-muted">{p.role}</p>
              </div>
            </div>
            <label className="label">Job title
              <input className="input h-9" defaultValue={p.job_title ?? ''} onBlur={(e) => e.target.value !== (p.job_title ?? '') && save(p.id, { job_title: e.target.value || null })} />
            </label>
            <label className="label">Started on
              <input className="input h-9" type="date" defaultValue={p.started_on ?? ''} onBlur={(e) => e.target.value !== (p.started_on ?? '') && save(p.id, { started_on: e.target.value || null })} />
            </label>
            <div className="rounded-xl bg-well p-3 text-xs">
              <p className="text-muted">Annual leave left this year</p>
              <p className={`mt-1 text-base font-semibold ${left < 3 ? 'text-warn' : ''}`}>{left} of {LEAVE_POLICY.annualDaysPerYear} days</p>
            </div>
          </article>
        )
      })}
      {people.length === 0 && <p className="text-sm text-muted">No team members yet. Add people on Team &amp; roles.</p>}
      {saved && <p className="text-sm text-muted">{saved}</p>}
    </div>
  )
}

/* ---------- Leave (admin approves, staff requests) ---------- */
function LeaveTab({ admin, myId }: { admin: boolean; myId?: string }) {
  const [rows, setRows] = useState<Leave[]>([])
  const [out, setOut] = useState<Absence[]>([])
  const [type, setType] = useState<LeaveType>('annual')
  const [from, setFrom] = useState(todayISO(7))
  const [to, setTo] = useState(todayISO(7))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('leave_requests').select('*, person:profiles!leave_requests_user_id_fkey(full_name)').order('start_date', { ascending: false })
    setRows((data as Leave[] | null) ?? [])
    const { data: a } = await supabase.from('team_absences').select('*').gte('end_date', todayISO()).order('start_date')
    setOut((a as Absence[] | null) ?? [])
  }
  useEffect(() => { load() }, [])

  async function request(e: FormEvent) {
    e.preventDefault()
    if (to < from) { setError('The end date is before the start date.'); return }
    const { error } = await supabase.from('leave_requests').insert({ type, start_date: from, end_date: to, days: workingDays(from, to), reason: reason.trim() || null })
    if (error) { setError(error.message); return }
    setReason(''); setError(null); load()
  }
  async function decide(l: Leave, status: Decision) {
    const { error } = await supabase.from('leave_requests').update({ status, decided_by: myId }).eq('id', l.id)
    if (error) setError(error.message)
    else load()
  }

  const yearStart = todayISO().slice(0, 4) + '-01-01'
  const mine = rows.filter((r) => r.user_id === myId)
  const usedAnnual = mine.filter((r) => r.type === 'annual' && r.status === 'approved' && r.start_date >= yearStart).reduce((s, r) => s + Number(r.days ?? 0), 0)
  const list = admin ? rows : mine

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1.3_1_420px] flex-col gap-4">
        {!admin && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-well p-4"><p className="text-xs text-muted">Annual leave left</p><p className="mt-1 text-2xl font-semibold">{LEAVE_POLICY.annualDaysPerYear - usedAnnual} days</p><p className="text-xs text-muted">of {LEAVE_POLICY.annualDaysPerYear} this year</p></div>
              <div className="rounded-xl bg-well p-4"><p className="text-xs text-muted">Waiting for approval</p><p className="mt-1 text-2xl font-semibold">{mine.filter((r) => r.status === 'waiting').length}</p></div>
            </div>
            <form onSubmit={request} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-4">
              <h3 className="basis-full font-semibold">Request leave</h3>
              <label className="label flex-[1_1_170px]">Type
                <select className="input" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
                  {Object.entries(LEAVE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className="label flex-[1_1_140px]">From<input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></label>
              <label className="label flex-[1_1_140px]">To<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <label className="label basis-full">Reason (optional, only the admin sees it)<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
              <span className="text-sm text-soft">{workingDays(from, to)} working {workingDays(from, to) === 1 ? 'day' : 'days'}</span>
              <button className="btn-primary ml-auto">Send request</button>
            </form>
          </>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div>
          <h3 className="font-semibold">{admin ? 'Leave requests' : 'My requests'}</h3>
          {list.length === 0 && <p className="mt-2 text-sm text-muted">No leave requests yet.</p>}
          {list.map((l) => (
            <div key={l.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <div className="min-w-0 flex-[1_1_240px]">
                <p className="text-sm font-medium">{admin ? `${l.person?.full_name ?? 'Someone'} · ` : ''}{LEAVE_LABEL[l.type]}</p>
                <p className="text-xs text-muted">{shortDate(l.start_date)} – {shortDate(l.end_date)} · {l.days ?? '?'} days{admin && l.reason ? ` · ${l.reason}` : ''}</p>
              </div>
              {admin && l.status === 'waiting' ? (
                <span className="flex gap-2">
                  <button className="btn-ghost h-9" onClick={() => decide(l, 'declined')}>Decline</button>
                  <button className="btn-primary h-9" onClick={() => decide(l, 'approved')}>Approve</button>
                </span>
              ) : <span className={`pill ${DECISION_TONE[l.status]}`}>{DECISION_TEXT[l.status]}</span>}
            </div>
          ))}
        </div>
      </div>

      <aside className="min-w-0 flex-[1_1_260px] rounded-xl border border-line p-4">
        <h3 className="font-semibold">Who's out</h3>
        {out.length === 0 && <p className="mt-2 text-sm text-muted">Everyone's in.</p>}
        {out.map((a, i) => (
          <p key={i} className="mt-2 text-sm"><span className="text-muted">{shortDate(a.start_date)}{a.end_date !== a.start_date ? ` – ${shortDate(a.end_date)}` : ''}</span> · {a.full_name}</p>
        ))}
        <p className="mt-3 text-xs text-muted">The team sees who's away, never the type of leave or the reason.</p>
      </aside>
    </div>
  )
}

/* ---------- Timesheets ---------- */
function TimeTab({ admin, myId }: { admin: boolean; myId?: string }) {
  const [week, setWeek] = useState(mondayOf(todayISO()))
  const [rows, setRows] = useState<TimeEntry[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [date, setDate] = useState(todayISO())
  const [hrs, setHrs] = useState('')
  const [clientId, setClientId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const weekEnd = addDays(week, 6)

  async function load() {
    const { data } = await supabase.from('time_entries')
      .select('*, person:profiles(full_name), client:clients(name)')
      .gte('work_date', week).lte('work_date', weekEnd).order('work_date')
    setRows((data as TimeEntry[] | null) ?? [])
  }
  useEffect(() => { load() }, [week])
  useEffect(() => { supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? [])) }, [])

  async function log(e: FormEvent) {
    e.preventDefault()
    const minutes = Math.round((Number(hrs.replace(',', '.')) || 0) * 60)
    if (minutes <= 0) { setError('Enter the hours, e.g. 1.5'); return }
    const { error } = await supabase.from('time_entries').insert({ work_date: date, minutes, client_id: clientId || null, note: note.trim() || null })
    if (error) { setError(error.message); return }
    setHrs(''); setNote(''); setError(null); load()
  }
  async function approve(userId: string) {
    const { error } = await supabase.from('time_entries').update({ approved: true }).eq('user_id', userId).gte('work_date', week).lte('work_date', weekEnd)
    if (error) setError(error.message)
    else load()
  }
  async function remove(id: string) {
    await supabase.from('time_entries').delete().eq('id', id)
    load()
  }

  // Group by person: client work vs internal
  const byPerson = new Map<string, { name: string; client: number; internal: number; pending: number }>()
  rows.forEach((r) => {
    const p = byPerson.get(r.user_id) ?? { name: r.person?.full_name || 'Someone', client: 0, internal: 0, pending: 0 }
    if (r.client_id) p.client += r.minutes; else p.internal += r.minutes
    if (!r.approved) p.pending++
    byPerson.set(r.user_id, p)
  })
  const mine = rows.filter((r) => r.user_id === myId)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost h-9" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</button>
        <span className="text-sm font-semibold">Week of {shortDate(week)} – {shortDate(weekEnd)}</span>
        <button className="btn-ghost h-9" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</button>
      </div>

      {admin && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead><tr><th className="th">Person</th><th className="th">Client work</th><th className="th">Internal</th><th className="th">Total</th><th className="th"></th></tr></thead>
            <tbody>
              {[...byPerson.entries()].map(([id, p]) => (
                <tr key={id}>
                  <td className="td">{p.name}</td><td className="td text-soft">{hours(p.client)}</td><td className="td text-soft">{hours(p.internal)}</td>
                  <td className="td font-semibold">{hours(p.client + p.internal)}</td>
                  <td className="td text-right">
                    {p.pending > 0 ? <button className="btn-ghost h-8 px-3 text-xs text-accent-text" onClick={() => approve(id)}>Approve week</button> : <span className="pill bg-success-soft text-success">Approved</span>}
                  </td>
                </tr>
              ))}
              {byPerson.size === 0 && <tr><td className="td text-muted" colSpan={5}>No time logged this week.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={log} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-4">
        <h3 className="basis-full font-semibold">Log my time</h3>
        <label className="label flex-[1_1_140px]">Date<input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="label flex-[1_1_90px]">Hours<input className="input" inputMode="decimal" value={hrs} onChange={(e) => setHrs(e.target.value)} placeholder="1.5" /></label>
        <label className="label flex-[1_1_180px]">Client
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Internal work</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="label flex-[2_1_220px]">What did you do?<input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className="btn-primary h-11">Log time</button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div>
        <h3 className="font-semibold">My entries this week · {hours(mine.reduce((s, r) => s + r.minutes, 0))}</h3>
        {mine.length === 0 && <p className="mt-2 text-sm text-muted">Nothing logged yet. Remote sessions on tickets are tracked separately on each ticket.</p>}
        {mine.map((r) => (
          <div key={r.id} className="mt-2 flex items-center gap-3 border-t border-line pt-2 text-sm">
            <span className="w-24 text-muted">{shortDate(r.work_date)}</span>
            <span className="min-w-0 flex-1">{r.client?.name ?? 'Internal'}{r.note ? <span className="text-muted"> · {r.note}</span> : ''}</span>
            <b>{hours(r.minutes)}</b>
            {r.approved ? <span className="pill bg-success-soft text-success">Approved</span> : (
              <button aria-label="Delete entry" className="cursor-pointer text-xs text-muted hover:text-text" onClick={() => remove(r.id)}>✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- My claims (staff) ---------- */
function MyClaims() {
  const { profile } = useAuth()
  const [receipt, setReceipt] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<(Claim & { client: { name: string } | null })[]>([])
  const [clients, setClients] = useState<Pick<Client, 'id' | 'name'>[]>([])
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Travel')
  const [amount, setAmount] = useState('')
  const [clientId, setClientId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('claims').select('*, client:clients(name)').order('created_at', { ascending: false })
    setRows((data as (Claim & { client: { name: string } | null })[] | null) ?? [])
  }
  useEffect(() => {
    load()
    supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const amt = Number(amount.replace(',', '.'))
    if (!amt) { setError('Enter the amount.'); return }
    setBusy(true)
    let receipt_path: string | null = null
    try {
      // Receipts go in the person's own folder, so only they and the admin can open them
      if (receipt && profile) receipt_path = await uploadFile('receipts', profile.id, receipt)
    } catch (e) {
      setBusy(false); setError((e as Error).message); return
    }
    const { error } = await supabase.from('claims').insert({ description: description.trim(), category, amount: amt, client_id: clientId || null, receipt_path })
    setBusy(false)
    if (error) { setError(error.message); return }
    setDescription(''); setAmount(''); setReceipt(null); setError(null); load()
  }

  const tone = { waiting: 'bg-warn-soft text-warn', approved: 'bg-info-soft text-info', paid_back: 'bg-success-soft text-success', declined: 'bg-raised text-muted' }
  const text = { waiting: 'Waiting', approved: 'Approved', paid_back: 'Paid back', declined: 'Declined' }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <form onSubmit={submit} className="flex min-w-0 flex-[1_1_340px] flex-col gap-3 rounded-xl border border-line p-4">
        <h3 className="font-semibold">New claim</h3>
        <label className="label">What did you pay for?<input className="input" required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Fuel: trip to Kloof Street Bakery" /></label>
        <div className="flex flex-wrap gap-3">
          <label className="label flex-[1_1_140px]">Type
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {['Travel', 'Software', 'Phone & data', 'Equipment', 'Client meal', 'Other'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="label flex-[1_1_110px]">Amount (R)<input className="input" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <label className="label">Was it for a client?
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">No — internal</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="btn h-10 w-fit cursor-pointer border border-dashed border-line-2 font-normal text-soft">
          {receipt ? `Receipt: ${receipt.name}` : '+ Add receipt photo or PDF'}
          <input type="file" accept={ACCEPT} capture="environment" className="sr-only" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button className="btn-primary self-end" disabled={busy}>{busy ? 'Sending…' : 'Submit claim'}</button>
      </form>

      <div className="min-w-0 flex-[1.3_1_400px]">
        <h3 className="font-semibold">My claims</h3>
        {rows.length === 0 && <p className="mt-2 text-sm text-muted">No claims yet.</p>}
        {rows.map((c) => (
          <div key={c.id} className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <div className="min-w-0 flex-[1_1_220px]">
              <p className="text-sm font-medium">{c.description}</p>
              <p className="text-xs text-muted">{c.category}{c.client ? ` · for ${c.client.name}` : ''} · {shortDate(c.created_at)}</p>
            </div>
            {c.receipt_path && <button className="cursor-pointer text-xs text-accent-text" onClick={() => openFile('receipts', c.receipt_path!)}>Receipt</button>}
            <b className="text-sm">{rand(Number(c.amount))}</b>
            <span className={`pill ${tone[c.status]}`}>{text[c.status]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- Documents ---------- */
function DocsTab({ admin }: { admin: boolean }) {
  const [docs, setDocs] = useState<HrDoc[]>([])
  const [people, setPeople] = useState<Pick<Profile, 'id' | 'full_name'>[]>([])
  const [name, setName] = useState('')
  const [userId, setUserId] = useState('')
  const [status, setStatus] = useState('Signed')
  const [expires, setExpires] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.from('hr_documents').select('*, person:profiles(full_name)').order('created_at', { ascending: false })
    setDocs((data as HrDoc[] | null) ?? [])
  }
  useEffect(() => {
    load()
    if (admin) supabase.from('profiles').select('id, full_name').in('role', ['admin', 'staff']).order('full_name').then(({ data }) => setPeople(data ?? []))
  }, [admin])

  async function add(e: FormEvent) {
    e.preventDefault()
    let file_path: string | null = null
    try {
      // Personal files go in that person's folder; policies go in "everyone"
      if (file) file_path = await uploadFile('hr-docs', userId || 'everyone', file)
    } catch (e) {
      setError((e as Error).message); return
    }
    const { error } = await supabase.from('hr_documents').insert({ name: name.trim(), user_id: userId || null, status, expires_on: expires || null, file_path })
    if (error) { setError(error.message); return }
    setName(''); setExpires(''); setFile(null); setError(null); load()
  }
  async function remove(id: string) {
    await supabase.from('hr_documents').delete().eq('id', id)
    load()
  }

  const soon = todayISO(30)
  const tone = (d: HrDoc) =>
    d.status === 'Not signed' || (d.expires_on && d.expires_on <= soon) ? 'bg-danger-soft text-danger' : d.status === 'Coming up' ? 'bg-warn-soft text-warn' : 'bg-success-soft text-success'

  return (
    <div className="flex flex-col gap-4">
      {admin && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-3 rounded-xl border border-line p-4">
          <h3 className="basis-full font-semibold">Add a document record</h3>
          <label className="label flex-[2_1_220px]">Document<input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Employment contract" /></label>
          <label className="label flex-[1_1_170px]">For
            <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone (a policy)</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name || 'No name yet'}</option>)}
            </select>
          </label>
          <label className="label flex-[1_1_140px]">Status
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {['Signed', 'Not signed', 'Coming up', 'Up to date'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="label flex-[1_1_140px]">Expires<input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
          <label className="btn h-11 cursor-pointer border border-dashed border-line-2 font-normal text-soft">
            {file ? file.name.slice(0, 24) : '+ Attach file'}
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className="btn-primary h-11">Add</button>
          <p className="basis-full text-xs text-muted">Personal files can only be opened by that person and admins. "Everyone" files can be opened by all staff.</p>
        </form>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div>
        {docs.length === 0 && <p className="text-sm text-muted">No documents yet.</p>}
        {docs.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3">
            <div className="min-w-0 flex-[1_1_240px]">
              <p className="text-sm font-medium">{d.name}</p>
              <p className="text-xs text-muted">{d.user_id ? d.person?.full_name ?? 'Someone' : 'Everyone'}{d.expires_on ? ` · expires ${shortDate(d.expires_on)}` : ''}</p>
            </div>
            {d.file_path && <button className="cursor-pointer text-xs text-accent-text" onClick={() => openFile('hr-docs', d.file_path!)}>Open</button>}
            <span className={`pill ${tone(d)}`}>{d.expires_on && d.expires_on <= soon ? 'Expires soon' : d.status}</span>
            {admin && <button aria-label="Delete document" className="cursor-pointer text-xs text-muted hover:text-text" onClick={() => remove(d.id)}>✕</button>}
          </div>
        ))}
      </div>
    </div>
  )
}

import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { canDo, useAuth } from '../../auth/AuthProvider'
import { rand, todayISO } from '../../lib/format'
import { docStatus } from '../../lib/finance'
import type { Doc, DocTotals, Ticket } from '../../lib/types'
import Tabs from '../../components/Tabs'

type Tab = 'tickets' | 'remote' | 'projects' | 'money'
type T = Ticket & { client: { name: string } | null }
interface Session { client_id: string; started_at: string; ended_at: string | null; person: { full_name: string } | null; client: { name: string; support_hours_per_month: number | null } | null }
interface Proj { id: string; name: string; progress: number; budget: number | null; quoted_hours: number | null; due_date: string | null; status: string; client: { name: string } | null }

const monthStart = () => todayISO().slice(0, 8) + '01'
const hrs = (mins: number) => Math.round((mins / 60) * 10) / 10

/** Reports from live data. Staff see everything except money. */
export default function Reports() {
  const { profile } = useAuth()
  const isAdmin = canDo(profile, 'finance') // the Money tab
  const [tab, setTab] = useState<Tab>('tickets')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'tickets', label: 'Tickets' }, { key: 'remote', label: 'Remote support' }, { key: 'projects', label: 'Projects' },
    ...(isAdmin ? [{ key: 'money' as Tab, label: 'Money' }] : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-muted">This month’s numbers, from your live data.</p>
        </div>
        <Link to="/app/report" className="btn-ghost no-underline">Client monthly reports →</Link>
      </div>
      <section className="card overflow-hidden">
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
        <div className="p-5">
          {tab === 'tickets' && <TicketsReport />}
          {tab === 'remote' && <RemoteReport />}
          {tab === 'projects' && <ProjectsReport />}
          {tab === 'money' && isAdmin && <MoneyReport />}
        </div>
      </section>
    </div>
  )
}

function Kpis({ items }: { items: { label: string; value: string | number; sub?: string; warn?: boolean }[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      {items.map((k) => (
        <div key={k.label} className="rounded-xl bg-well p-4">
          <p className="text-xs text-muted">{k.label}</p>
          <p className={`mt-1 text-2xl font-semibold ${k.warn ? 'text-warn' : ''}`}>{k.value}</p>
          {k.sub && <p className="mt-0.5 text-xs text-soft">{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

/** Paired bars (e.g. opened vs closed), drawn with plain divs. */
function Bars({ data, a, b }: { data: { label: string; a: number; b: number }[]; a: string; b: string }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.a, d.b]))
  return (
    <div>
      <div className="flex gap-4 text-xs text-soft"><span><span className="text-warn">■</span> {a}</span><span><span className="text-accent-text">■</span> {b}</span></div>
      <div role="img" aria-label={data.map((d) => `${d.label}: ${a} ${d.a}, ${b} ${d.b}`).join('; ')} className="mt-3 flex h-44 items-end gap-3 border-b border-line-2">
        {data.map((d) => (
          <div key={d.label} className="flex h-full flex-1 flex-col items-center justify-end">
            <div className="flex items-end gap-1">
              <span className="w-3.5 rounded-t bg-warn" style={{ height: Math.max(2, (d.a / max) * 150) }} />
              <span className="w-3.5 rounded-t bg-accent" style={{ height: Math.max(2, (d.b / max) * 150) }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3">{data.map((d) => <span key={d.label} className="flex-1 text-center text-[11px] text-muted">{d.label}</span>)}</div>
    </div>
  )
}

function TicketsReport() {
  const [rows, setRows] = useState<T[]>([])
  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate() - 42)
    supabase.from('tickets').select('*, client:clients(name)').or(`created_at.gte.${since.toISOString()},status.not.in.(resolved,closed)`)
      .then(({ data }) => setRows((data as T[] | null) ?? []))
  }, [])

  const ms = monthStart()
  const done = (t: T) => t.status === 'resolved' || t.status === 'closed'
  const open = rows.filter((t) => !done(t))
  const closedThisMonth = rows.filter((t) => done(t) && t.updated_at >= ms)
  const openedThisMonth = rows.filter((t) => t.created_at >= ms)
  const late = open.filter((t) => t.due_at && t.due_at < new Date().toISOString() && t.status !== 'waiting_on_client')

  // Last 6 weeks, opened vs closed
  const weeks = Array.from({ length: 6 }, (_, i) => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (start.getDay() + 6) % 7 - (5 - i) * 7)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    const inWeek = (iso: string) => iso >= start.toISOString() && iso < end.toISOString()
    return {
      label: start.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }),
      a: rows.filter((t) => inWeek(t.created_at)).length,
      b: rows.filter((t) => done(t) && inWeek(t.updated_at)).length,
    }
  })

  const byClient = new Map<string, { open: number; month: number }>()
  rows.forEach((t) => {
    const name = t.client?.name ?? '—'
    const c = byClient.get(name) ?? { open: 0, month: 0 }
    if (!done(t)) c.open++
    if (t.created_at >= ms) c.month++
    byClient.set(name, c)
  })

  return (
    <div className="flex flex-col gap-5">
      <Kpis items={[
        { label: 'Opened this month', value: openedThisMonth.length },
        { label: 'Resolved this month', value: closedThisMonth.length },
        { label: 'Still open', value: open.length },
        { label: 'Late right now', value: late.length, warn: late.length > 0 },
      ]} />
      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[1.2_1_380px]"><h3 className="mb-2 font-semibold">Tickets per week</h3><Bars data={weeks} a="Opened" b="Resolved" /></div>
        <div className="min-w-0 flex-[1_1_300px]">
          <h3 className="mb-2 font-semibold">By client</h3>
          <table className="w-full border-collapse">
            <thead><tr><th className="th px-0">Client</th><th className="th text-right">Open</th><th className="th pr-0 text-right">This month</th></tr></thead>
            <tbody>{[...byClient.entries()].sort((x, y) => y[1].month - x[1].month).map(([n, c]) => (
              <tr key={n}><td className="td px-0">{n}</td><td className="td text-right">{c.open}</td><td className="td pr-0 text-right">{c.month}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function RemoteReport() {
  const [rows, setRows] = useState<Session[]>([])
  useEffect(() => {
    supabase.from('remote_sessions').select('client_id, started_at, ended_at, person:profiles(full_name), client:clients(name, support_hours_per_month)')
      .gte('started_at', new Date(monthStart() + 'T00:00').toISOString()).not('ended_at', 'is', null)
      .then(({ data }) => setRows((data as unknown as Session[] | null) ?? []))
  }, [])

  const mins = (s: Session) => (new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()) / 60000
  const total = rows.reduce((t, s) => t + mins(s), 0)
  const byClient = new Map<string, { name: string; used: number; plan: number }>()
  const byPerson = new Map<string, { n: number; m: number }>()
  rows.forEach((s) => {
    const c = byClient.get(s.client_id) ?? { name: s.client?.name ?? '—', used: 0, plan: Number(s.client?.support_hours_per_month ?? 0) }
    c.used += mins(s); byClient.set(s.client_id, c)
    const p = byPerson.get(s.person?.full_name ?? 'Someone') ?? { n: 0, m: 0 }
    p.n++; p.m += mins(s); byPerson.set(s.person?.full_name ?? 'Someone', p)
  })
  const over = [...byClient.values()].reduce((t, c) => t + Math.max(0, hrs(c.used) - c.plan), 0)

  return (
    <div className="flex flex-col gap-5">
      <Kpis items={[
        { label: 'Remote sessions this month', value: rows.length },
        { label: 'Time connected', value: `${hrs(total)} h` },
        { label: 'Average session', value: rows.length ? `${Math.round(total / rows.length)} min` : '—' },
        { label: 'Over care-plan hours', value: `${Math.round(over * 10) / 10} h`, sub: 'Billable on the next invoice', warn: over > 0 },
      ]} />
      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[1.2_1_380px]">
          <h3 className="mb-2 font-semibold">Support hours per client: plan vs used</h3>
          {byClient.size === 0 && <p className="text-sm text-muted">No remote sessions logged this month.</p>}
          {[...byClient.values()].map((c) => {
            const used = hrs(c.used)
            const pct = c.plan ? Math.min(100, (used / c.plan) * 100) : 100
            return (
              <div key={c.name} className="mt-3">
                <div className="flex justify-between text-sm"><span>{c.name}</span><span className={c.plan && used > c.plan ? 'text-warn' : 'text-soft'}>{used} h{c.plan ? ` of ${c.plan} h` : ' (no plan)'}</span></div>
                <div className="mt-1.5 h-1.5 rounded bg-raised"><div className={`h-1.5 rounded ${c.plan && used > c.plan ? 'bg-warn' : 'bg-accent'}`} style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
        <div className="min-w-0 flex-[1_1_260px]">
          <h3 className="mb-2 font-semibold">By person</h3>
          {[...byPerson.entries()].map(([n, p]) => (
            <div key={n} className="flex justify-between border-t border-line py-2 text-sm"><span>{n}</span><span className="text-soft">{p.n} sessions · {hrs(p.m)} h</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProjectsReport() {
  const [rows, setRows] = useState<Proj[]>([])
  useEffect(() => {
    supabase.from('projects').select('id, name, progress, budget, quoted_hours, due_date, status, client:clients(name)')
      .then(({ data }) => setRows((data as unknown as Proj[] | null) ?? []))
  }, [])
  const active = rows.filter((p) => p.status === 'active')
  const late = active.filter((p) => p.due_date && p.due_date < todayISO())
  return (
    <div className="flex flex-col gap-5">
      <Kpis items={[
        { label: 'Active projects', value: active.length },
        { label: 'Past their due date', value: late.length, warn: late.length > 0 },
        { label: 'Done', value: rows.filter((p) => p.status === 'done').length },
        { label: 'Active budget', value: rand(active.reduce((s, p) => s + Number(p.budget ?? 0), 0)) },
      ]} />
      <table className="w-full border-collapse">
        <thead><tr><th className="th px-0">Project</th><th className="th">Client</th><th className="th">Progress</th><th className="th pr-0 text-right">Due</th></tr></thead>
        <tbody>
          {active.map((p) => (
            <tr key={p.id}>
              <td className="td px-0">{p.name}</td><td className="td text-soft">{p.client?.name ?? 'Internal'}</td>
              <td className="td"><div className="h-1.5 w-32 rounded bg-raised"><div className="h-1.5 rounded bg-accent" style={{ width: `${p.progress}%` }} /></div></td>
              <td className={`td pr-0 text-right ${p.due_date && p.due_date < todayISO() ? 'text-danger' : 'text-soft'}`}>{p.due_date ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MoneyReport() {
  const [docs, setDocs] = useState<(Doc & { client: { name: string } | null })[]>([])
  const [totals, setTotals] = useState<Record<string, number>>({})
  useEffect(() => {
    supabase.from('documents').select('*, client:clients(name)').eq('kind', 'invoice').neq('status', 'draft').neq('status', 'cancelled')
      .then(({ data }) => setDocs((data as (Doc & { client: { name: string } | null })[] | null) ?? []))
    supabase.from('document_totals').select('*').then(({ data }) => setTotals(Object.fromEntries(((data as DocTotals[] | null) ?? []).map((t) => [t.document_id, Number(t.total)]))))
  }, [])

  const t = (d: Doc) => totals[d.id] ?? 0
  const ms = monthStart()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i))
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return {
      label: d.toLocaleDateString('en-ZA', { month: 'short' }),
      a: Math.round(docs.filter((x) => x.issue_date.startsWith(key)).reduce((s, x) => s + t(x), 0) / 1000),
      b: Math.round(docs.filter((x) => x.status === 'paid' && (x.paid_at ?? '').startsWith(key)).reduce((s, x) => s + t(x), 0) / 1000),
    }
  })
  const owed = new Map<string, { owed: number; overdue: number }>()
  docs.filter((d) => d.status === 'sent').forEach((d) => {
    const n = d.client?.name ?? '—'
    const o = owed.get(n) ?? { owed: 0, overdue: 0 }
    o.owed += t(d); if (docStatus(d) === 'overdue') o.overdue += t(d)
    owed.set(n, o)
  })
  const overdue = [...owed.values()].reduce((s, o) => s + o.overdue, 0)

  return (
    <div className="flex flex-col gap-5">
      <Kpis items={[
        { label: 'Invoiced this month', value: rand(docs.filter((d) => d.issue_date >= ms).reduce((s, d) => s + t(d), 0)) },
        { label: 'Paid this month', value: rand(docs.filter((d) => d.status === 'paid' && (d.paid_at ?? '') >= ms).reduce((s, d) => s + t(d), 0)) },
        { label: 'Waiting to be paid', value: rand([...owed.values()].reduce((s, o) => s + o.owed, 0)) },
        { label: 'Overdue', value: rand(overdue), warn: overdue > 0 },
      ]} />
      <div className="flex flex-wrap gap-5">
        <div className="min-w-0 flex-[1.2_1_380px]"><h3 className="mb-2 font-semibold">Invoiced vs paid (R thousand)</h3><Bars data={months} a="Invoiced" b="Paid" /></div>
        <div className="min-w-0 flex-[1_1_280px]">
          <h3 className="mb-2 font-semibold">Owed by client</h3>
          {owed.size === 0 && <p className="text-sm text-muted">All invoices are paid.</p>}
          {[...owed.entries()].map(([n, o]) => (
            <div key={n} className="flex justify-between border-t border-line py-2 text-sm"><span>{n}</span><span className={o.overdue ? 'text-danger' : 'text-soft'}>{rand(o.owed)}{o.overdue ? ' · overdue' : ''}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useBusiness } from '../lib/business'
import { CLIENT_STATUS_LABEL, PHASE_LABEL, formatDuration, rand, shortDate, ticketRef } from '../lib/format'
import { STATUS_TEXT } from '../lib/finance'
import type { TicketStatus } from '../lib/types'
import PrintBar from '../components/PrintBar'

// What client_month_report() (migration 009) sends back.
interface Report {
  client: { name: string; plan: string | null; support_hours: number | null }
  month: string
  tickets: {
    opened: number; resolved: number; resolved_on_time: number; open_now: number
    list: { id: number; title: string; status: TicketStatus; created_at: string; resolved_at: string | null }[]
  }
  support: { sessions: number; minutes: number }
  projects: { name: string; phase: keyof typeof PHASE_LABEL; progress: number; status: string; due_date: string | null; waiting_on_client: boolean }[]
  billing: {
    invoiced: number; paid: number; outstanding: number
    invoices: { id: string; number: string; title: string | null; status: string; issue_date: string; due_date: string | null; total: number }[]
  }
}

/** "2026-11" for this month, or `back` months ago. */
function monthKey(back = 0) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - back)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (key: string) =>
  new Date(`${key}-01T12:00:00`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })

/**
 * A client's monthly report: support, projects and billing for one month.
 * The team picks any client (/app/report?client=…); a client sees their own (/portal/report).
 * "Download PDF" prints it as an A4 page.
 */
export default function MonthlyReport() {
  const { profile } = useAuth()
  const isClient = profile?.role === 'client'
  const business = useBusiness()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || monthKey(isClient ? 1 : 0)
  const clientId = isClient ? profile?.client_id ?? null : params.get('client')
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isClient) supabase.from('clients').select('id, name').order('name').then(({ data }) => setClients(data ?? []))
  }, [isClient])

  useEffect(() => {
    if (!clientId) return
    setReport(null); setError(null)
    supabase.rpc('client_month_report', { p_client: clientId, p_month: `${month}-01` })
      .then(({ data, error }) => { if (error) setError(error.message); else setReport(data as Report) })
  }, [clientId, month])

  useEffect(() => {
    if (report) document.title = `${report.client.name} report ${monthLabel(month)}`
    return () => { document.title = 'Work Hub' }
  }, [report, month])

  const set = (key: string, value: string) => { const p = new URLSearchParams(params); p.set(key, value); setParams(p) }
  const months = Array.from({ length: 12 }, (_, i) => monthKey(i))
  const allowance = Number(report?.client.support_hours ?? 0) * 60

  return (
    <div className="min-h-screen bg-ink print:bg-white">
      <PrintBar back={isClient ? '/portal' : '/app/reports'}>
        {!isClient && (
          <select className="input h-10 w-auto" aria-label="Client" value={clientId ?? ''} onChange={(e) => set('client', e.target.value)}>
            <option value="" disabled>Choose a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select className="input h-10 w-auto" aria-label="Month" value={month} onChange={(e) => set('month', e.target.value)}>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
      </PrintBar>

      {!clientId && <p className="p-10 text-center text-muted">Choose a client to see their report.</p>}
      {error && <p className="p-10 text-center text-danger">{error}</p>}
      {clientId && !report && !error && <p className="p-10 text-center text-muted">Loading…</p>}

      {report && (
        <main className="mx-auto my-6 w-full max-w-[210mm] bg-white px-[14mm] py-[14mm] text-[13px] text-text shadow-sm print:my-0 print:shadow-none">
          <header className="flex items-start justify-between gap-6 border-b border-line pb-6">
            <div>
              <img src="/logo-wordmark.png" alt="Work Hub" className="h-9 w-auto" />
              <p className="mt-2 text-soft">{business.name}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold tracking-widest text-muted uppercase">Monthly report</p>
              <p className="mt-1 text-2xl font-bold">{monthLabel(month)}</p>
              <p className="text-base font-semibold">{report.client.name}</p>
              {report.client.plan && <p className="text-soft">{report.client.plan}</p>}
            </div>
          </header>

          <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Summary">
            <Stat label="Tickets opened" value={String(report.tickets.opened)} />
            <Stat label="Tickets solved" value={String(report.tickets.resolved)}
              sub={report.tickets.resolved ? `${report.tickets.resolved_on_time} on time` : undefined} />
            <Stat label="Remote support" value={formatDuration(Number(report.support.minutes))}
              sub={allowance ? `of ${formatDuration(allowance)} included` : `${report.support.sessions} sessions`} />
            <Stat label="Still to pay" value={rand(Number(report.billing.outstanding))} tone={Number(report.billing.outstanding) > 0 ? 'warn' : undefined} />
          </section>

          {allowance > 0 && (
            <div className="mt-3" aria-label="Support hours used">
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div className={`h-full rounded-full ${Number(report.support.minutes) > allowance ? 'bg-danger' : 'bg-accent'}`}
                  style={{ width: `${Math.min(100, (Number(report.support.minutes) / allowance) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">{Math.round((Number(report.support.minutes) / allowance) * 100)}% of this month's support hours used</p>
            </div>
          )}

          <Section title="Support tickets">
            {report.tickets.list.length === 0 ? <Empty>No tickets this month.</Empty> : (
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-line text-left text-[11px] tracking-widest text-muted uppercase"><th className="py-2 font-semibold">Ticket</th><th className="py-2 font-semibold">Opened</th><th className="py-2 font-semibold">Solved</th><th className="py-2 text-right font-semibold">Status</th></tr></thead>
                <tbody>
                  {report.tickets.list.map((t) => (
                    <tr key={t.id} className="border-b border-line">
                      <td className="py-2 pr-3"><span className="text-muted">{ticketRef(t.id)}</span> {t.title}</td>
                      <td className="py-2 text-soft">{shortDate(t.created_at)}</td>
                      <td className="py-2 text-soft">{t.resolved_at ? shortDate(t.resolved_at) : '—'}</td>
                      <td className="py-2 text-right">{CLIENT_STATUS_LABEL[t.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {report.tickets.open_now > 0 && <p className="mt-2 text-xs text-muted">{report.tickets.open_now} ticket{report.tickets.open_now === 1 ? ' is' : 's are'} still open.</p>}
          </Section>

          <Section title="Projects">
            {report.projects.length === 0 ? <Empty>No active projects.</Empty> : report.projects.map((p) => (
              <div key={p.name} className="border-b border-line py-2.5 last:border-b-0">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-soft">{p.status === 'done' ? 'Finished' : `${PHASE_LABEL[p.phase]} · ${p.progress}%`}{p.due_date ? ` · due ${shortDate(p.due_date)}` : ''}</p>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent" style={{ width: `${p.progress}%` }} /></div>
                {p.waiting_on_client && <p className="mt-1 text-xs text-warn">We’re waiting on something from you. Check your portal.</p>}
              </div>
            ))}
          </Section>

          <Section title="Invoices">
            {report.billing.invoices.length === 0 ? <Empty>No invoices this month.</Empty> : (
              <table className="w-full border-collapse">
                <thead><tr className="border-b border-line text-left text-[11px] tracking-widest text-muted uppercase"><th className="py-2 font-semibold">Invoice</th><th className="py-2 font-semibold">Date</th><th className="py-2 font-semibold">Status</th><th className="py-2 text-right font-semibold">Amount</th></tr></thead>
                <tbody>
                  {report.billing.invoices.map((d) => (
                    <tr key={d.id} className="border-b border-line">
                      <td className="py-2 pr-3">{d.number}{d.title ? <span className="text-soft"> · {d.title}</span> : null}</td>
                      <td className="py-2 text-soft">{shortDate(d.issue_date)}</td>
                      <td className="py-2">{STATUS_TEXT[d.status] ?? d.status}</td>
                      <td className="py-2 text-right">{rand(Number(d.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
              <span className="text-soft">Invoiced: <b className="text-text">{rand(Number(report.billing.invoiced))}</b></span>
              <span className="text-soft">Paid this month: <b className="text-text">{rand(Number(report.billing.paid))}</b></span>
            </div>
          </Section>

          <p className="mt-10 text-center text-[11px] text-muted">{business.name} · Small steps. Real progress.</p>
        </main>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === 'warn' ? 'text-warn' : ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  )
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-8 break-inside-avoid-page"><h2 className="mb-2 text-base font-semibold">{title}</h2>{children}</section>
}
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-soft">{children}</p>
